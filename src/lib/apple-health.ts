/**
 * Apple Health ingest for the Health Auto Export iOS app ("REST API"
 * automation, JSON format). Apple Health has no web API, so the phone
 * pushes to us. Payload shape:
 *
 *   { data: { workouts: [...], metrics: [{ name, units, data: [...] }] } }
 *
 * Workouts become WorkoutSession rows (source "Apple Watch"). A workout
 * that overlaps an already-synced Peloton class is the Peloton class
 * echoed into Health: we don't duplicate it, we only copy the watch's
 * heart rate onto the Peloton row when Peloton has none.
 *
 * Metrics arrive at whatever granularity the app is set to (per minute,
 * hour or day). Each point is stored in health_samples, keyed by metric
 * and timestamp; a push replaces the stored points inside its own time
 * span, then every calendar day it touched is re-summarized from all
 * stored points into health_metrics (one row per metric per day). So
 * "since last sync" pushes, batched uploads and overlapping re-sends all
 * produce correct daily totals.
 */
import prisma from '@/lib/prisma'
import { matchingWindow } from '@/lib/workout-match'

type Qty = { qty?: number; units?: string } | undefined

interface HealthWorkout {
  id?: string
  name?: string
  start?: string
  end?: string
  duration?: number // seconds
  distance?: Qty
  activeEnergyBurned?: Qty
  activeEnergy?: Qty
  avgHeartRate?: Qty
  maxHeartRate?: Qty
  heartRate?: { avg?: Qty; max?: Qty }
}

interface HealthMetricPoint {
  date?: string
  qty?: number
  Min?: number
  Avg?: number
  Max?: number
}

interface HealthMetricSeries {
  name?: string
  units?: string
  data?: HealthMetricPoint[]
}

export interface HealthPayload {
  data?: { workouts?: HealthWorkout[]; metrics?: HealthMetricSeries[] }
}

export interface IngestResult {
  workoutsCreated: number
  workoutsUpdated: number
  workoutsMergedIntoPeloton: number
  workoutsSkipped: number
  metricDays: number
  weightDays: number
}

/** "2025-01-02 08:00:00 -0800" (the app's format) or ISO-8601 → Date. */
export function parseHealthDate(value: string | undefined): Date | null {
  if (!value) return null
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(value.trim())
  if (!m) return null
  const zone = !m[3] || m[3] === 'Z' ? 'Z' : `${m[3].slice(0, 3)}:${m[3].slice(-2)}`
  const date = new Date(`${m[1]}T${m[2]}${zone}`)
  return Number.isNaN(date.getTime()) ? null : date
}

/** The local calendar day the point belongs to, as a UTC-midnight label. */
function dayLabel(value: string | undefined): Date | null {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(value ?? '')
  return m && parseHealthDate(value) ? new Date(`${m[1]}T00:00:00Z`) : null
}

const ACTIVITY_NAMES: Array<[RegExp, string]> = [
  [/walk/i, 'Walking'],
  [/run|jog/i, 'Running'],
  [/cycl|bik/i, 'Cycling'],
  [/hik/i, 'Hiking'],
  [/swim/i, 'Swimming'],
  [/strength|weight/i, 'Weight Lifting'],
]

export function healthActivity(name: string | undefined): string {
  return ACTIVITY_NAMES.find(([re]) => re.test(name ?? ''))?.[1] ?? (name?.trim() || 'Other')
}

const finite = (n: number | undefined) => (n != null && Number.isFinite(n) ? n : undefined)
const roundOrNull = (n: number | undefined) => (finite(n) != null ? Math.round(n!) : null)

function miles(distance: Qty): number | null {
  const qty = finite(distance?.qty)
  if (qty == null || qty <= 0) return null
  const value = /^km/i.test(distance?.units ?? '') ? qty * 0.621371 : qty
  return Math.round(value * 100) / 100
}

function kcal(energy: Qty): number | null {
  const qty = finite(energy?.qty)
  if (qty == null) return null
  return Math.round(/^kj/i.test(energy?.units ?? '') ? qty / 4.184 : qty)
}

/** Starts within 5 minutes and the two overlap for at least half the shorter one. */
export function isPelotonEcho(peloton: { date: Date; minutes: number }, start: Date, minutes: number): boolean {
  if (Math.abs(peloton.date.getTime() - start.getTime()) > 5 * 60_000) return false
  const overlap = Math.min(peloton.date.getTime() + peloton.minutes * 60_000, start.getTime() + minutes * 60_000) -
    Math.max(peloton.date.getTime(), start.getTime())
  return overlap >= Math.min(peloton.minutes, minutes) * 60_000 * 0.5
}

async function ingestWorkout(w: HealthWorkout): Promise<'created' | 'updated' | 'merged' | 'skipped'> {
  const start = parseHealthDate(w.start)
  const end = parseHealthDate(w.end)
  if (!start) return 'skipped'
  const seconds = finite(w.duration) ?? (end ? (end.getTime() - start.getTime()) / 1000 : undefined)
  const minutes = seconds != null ? Math.round(seconds / 60) : 0
  if (minutes < 1 || minutes > 1440) return 'skipped'

  const activity = healthActivity(w.name)
  const avgHeartRate = roundOrNull(w.avgHeartRate?.qty ?? w.heartRate?.avg?.qty)
  const maxHeartRate = roundOrNull(w.maxHeartRate?.qty ?? w.heartRate?.max?.qty)
  const healthWorkoutId = w.id || `${w.name ?? 'workout'}|${start.toISOString()}`

  // Workouts also synced through Peloton (its classes, and Apple Watch
  // workouts the Peloton app imported) land in Health too; keep the
  // Peloton-synced row. The echo's activity type rarely matches (Peloton
  // cardio and bodyweight classes arrive as "Other"), so match on timing.
  const pelotonCandidates = await prisma.workoutSession.findMany({
    where: { pelotonWorkoutId: { not: null }, deletedAt: null, date: matchingWindow(start) },
  })
  // Several sessions can start together (a class plus an imported watch
  // workout); the echo is the one whose length matches best.
  const peloton = pelotonCandidates
    .filter(row => isPelotonEcho(row, start, minutes))
    .sort((a, b) => Math.abs(a.minutes - minutes) - Math.abs(b.minutes - minutes) ||
      Math.abs(a.date.getTime() - start.getTime()) - Math.abs(b.date.getTime() - start.getTime()))[0]
  if (peloton) {
    await prisma.$transaction([
      prisma.workoutSession.update({
        where: { id: peloton.id },
        data: {
          avgHeartRate: peloton.avgHeartRate ?? avgHeartRate,
          maxHeartRate: peloton.maxHeartRate ?? maxHeartRate,
        },
      }),
      // Drop a duplicate created by an earlier push before this matched.
      prisma.workoutSession.deleteMany({ where: { healthWorkoutId, source: 'Apple Watch' } }),
    ])
    return 'merged'
  }

  const data = {
    date: start,
    source: 'Apple Watch',
    activity,
    minutes,
    miles: miles(w.distance),
    calories: kcal(w.activeEnergyBurned ?? w.activeEnergy),
    avgHeartRate,
    maxHeartRate,
    classTitle: w.name?.trim() || null,
  }
  const existing = await prisma.workoutSession.findUnique({ where: { healthWorkoutId } })
  if (existing) {
    if (existing.deletedAt) return 'skipped' // deleted in the app: don't resurrect
    await prisma.workoutSession.update({ where: { id: existing.id }, data })
    return 'updated'
  }
  await prisma.workoutSession.create({ data: { ...data, healthWorkoutId } })
  return 'created'
}

// Metrics summarized into daily health_metrics rows, and how a day's points
// combine. Any other metric is still stored raw in health_samples so it can
// be summarized later without re-uploading.
const METRICS: Record<string, 'sum' | 'avg' | 'range'> = {
  heart_rate: 'range',
  resting_heart_rate: 'avg',
  heart_rate_variability: 'avg',
  walking_heart_rate_average: 'avg',
  vo2_max: 'avg',
  step_count: 'sum',
  active_energy: 'sum',
  apple_exercise_time: 'sum',
  apple_move_time: 'sum',
  apple_stand_hour: 'sum',
  apple_stand_time: 'sum',
  walking_running_distance: 'sum',
}

export interface HealthSampleRow {
  name: string
  at: Date
  day: Date // local calendar day label (UTC midnight)
  qty: number | null
  min: number | null
  avg: number | null
  max: number | null
}

/** Usable numeric points of a metric; a repeated timestamp keeps the last. */
export function parseSamples(series: HealthMetricSeries): HealthSampleRow[] {
  if (!series.name?.trim()) return []
  const byTime = new Map<number, HealthSampleRow>()
  for (const point of series.data ?? []) {
    const at = parseHealthDate(point.date)
    const day = dayLabel(point.date)
    const row = {
      name: series.name!, at: at!, day: day!,
      qty: finite(point.qty) ?? null, min: finite(point.Min) ?? null,
      avg: finite(point.Avg) ?? null, max: finite(point.Max) ?? null,
    }
    if (at && day && (row.qty != null || row.avg != null)) byTime.set(at.getTime(), row)
  }
  return [...byTime.values()]
}

/** One day's summary of a metric from all of that day's stored points. */
export function summarizeDay(name: string, samples: Array<Pick<HealthSampleRow, 'qty' | 'min' | 'avg' | 'max'>>) {
  const mode = METRICS[name]
  const pick = (key: 'qty' | 'min' | 'avg' | 'max') =>
    samples.map(s => s[key]).filter((v): v is number => v != null)
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
  const qty = pick('qty'), min = pick('min'), avg = pick('avg'), max = pick('max')
  return {
    qty: mode === 'sum' ? (qty.length ? qty.reduce((a, b) => a + b, 0) : null) : mean(qty),
    min: min.length ? Math.min(...min) : null,
    avg: mean(avg),
    max: max.length ? Math.max(...max) : null,
  }
}

async function ingestMetric(series: HealthMetricSeries): Promise<number> {
  const samples = parseSamples(series)
  if (samples.length === 0) return 0
  const name = samples[0].name
  const times = samples.map(s => s.at.getTime())
  const span = { gte: new Date(Math.min(...times)), lte: new Date(Math.max(...times)) }

  // Replace this push's time span, so re-sent points never double count.
  await prisma.$transaction([
    prisma.healthSample.deleteMany({ where: { name, at: span } }),
    prisma.healthSample.createMany({ data: samples }),
  ])

  const days = [...new Set(samples.map(s => s.day.getTime()))].map(t => new Date(t))
  if (!METRICS[name]) return 0 // kept raw only
  const stored = await prisma.healthSample.findMany({
    where: { name, day: { in: days } },
    select: { day: true, qty: true, min: true, avg: true, max: true },
  })
  await prisma.$transaction(days.map(date => {
    const values = { units: series.units ?? null, ...summarizeDay(name, stored.filter(s => s.day.getTime() === date.getTime())) }
    return prisma.healthMetric.upsert({
      where: { name_date: { name, date } },
      update: values,
      create: { name, date, ...values },
    })
  }))
  return days.length
}

/** Weigh-ins logged in the Health app; never overwrites a manual entry. */
async function ingestWeight(series: HealthMetricSeries): Promise<number> {
  const perDay = new Map<number, number>()
  for (const point of series.data ?? []) {
    const day = dayLabel(point.date)
    const qty = finite(point.qty)
    if (!day || qty == null) continue
    perDay.set(day.getTime(), /^kg/i.test(series.units ?? '') ? qty * 2.20462 : qty)
  }
  let written = 0
  for (const [time, lbs] of perDay) {
    const date = new Date(time)
    const existing = await prisma.bodyMeasurement.findUnique({ where: { date } })
    if (existing && existing.source !== 'Apple Health') continue
    const weightLbs = Math.round(lbs * 10) / 10
    await prisma.bodyMeasurement.upsert({
      where: { date },
      update: { weightLbs },
      create: { date, weightLbs, source: 'Apple Health' },
    })
    written++
  }
  return written
}

/**
 * Body fat % from Health (smart scales such as Renpho) onto that day's
 * weigh-in. Never overwrites a manual entry's own body fat.
 */
async function ingestBodyFat(series: HealthMetricSeries): Promise<void> {
  const perDay = new Map<number, number>()
  for (const point of series.data ?? []) {
    const day = dayLabel(point.date)
    const qty = finite(point.qty)
    if (!day || qty == null) continue
    // Some exports send a fraction (0.185) rather than a percentage.
    perDay.set(day.getTime(), qty <= 1 ? qty * 100 : qty)
  }
  for (const [time, pct] of perDay) {
    if (pct < 2 || pct > 60) continue
    const date = new Date(time)
    const existing = await prisma.bodyMeasurement.findUnique({ where: { date } })
    if (!existing || (existing.source !== 'Apple Health' && existing.bodyFatPct != null)) continue
    await prisma.bodyMeasurement.update({ where: { date }, data: { bodyFatPct: Math.round(pct * 10) / 10 } })
  }
}

export async function ingestHealthPayload(payload: HealthPayload): Promise<IngestResult> {
  const result: IngestResult = {
    workoutsCreated: 0, workoutsUpdated: 0, workoutsMergedIntoPeloton: 0, workoutsSkipped: 0, metricDays: 0, weightDays: 0,
  }

  for (const workout of payload.data?.workouts ?? []) {
    const outcome = await ingestWorkout(workout)
    if (outcome === 'created') result.workoutsCreated++
    else if (outcome === 'updated') result.workoutsUpdated++
    else if (outcome === 'merged') result.workoutsMergedIntoPeloton++
    else result.workoutsSkipped++
  }

  // Weight first, so body fat from the same push (e.g. a Renpho scale) has a row to land on.
  const metrics = [...(payload.data?.metrics ?? [])].sort((a, b) =>
    Number(b.name === 'weight_body_mass') - Number(a.name === 'weight_body_mass'))
  for (const series of metrics) {
    if (series.name === 'weight_body_mass') {
      result.weightDays += await ingestWeight(series)
      continue
    }
    if (series.name === 'body_fat_percentage') await ingestBodyFat(series)
    result.metricDays += await ingestMetric(series)
  }

  return result
}
