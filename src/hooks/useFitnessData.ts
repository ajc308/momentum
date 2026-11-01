'use client'

import { useCallback, useEffect, useState } from 'react'
import { useShell } from '@/components/AppShell'
import { TRACKER_TIME_ZONE, workoutDay } from '@/lib/calendar'
import type { WorkoutApiSession, WorkoutSession } from '@/types/workout'
import type { BodyMeasurement, BodyMeasurementApiRecord, HealthMetricApiRow } from '@/types/health'

export function toWorkoutSession(row: WorkoutApiSession): WorkoutSession {
  return {
    id: row.id,
    date: new Date(row.date),
    source: row.source,
    activity: row.activity,
    minutes: row.minutes,
    miles: row.miles ?? undefined,
    weightLifted: row.weightLifted ?? undefined,
    notes: row.notes ?? undefined,
    discipline: row.discipline ?? null,
    classTitle: row.classTitle ?? null,
    instructor: row.instructor ?? null,
    calories: row.calories ?? null,
    avgHeartRate: row.avgHeartRate ?? null,
    maxHeartRate: row.maxHeartRate ?? null,
    totalOutputKj: row.totalOutputKj ?? null,
  }
}

export interface Resource<T> {
  data: T | null
  error: string | null
  loading: boolean
  reload: () => void
  setData: React.Dispatch<React.SetStateAction<T | null>>
}

/** GET a JSON endpoint; refetches when `url` changes or a Peloton sync lands new data. */
function useResource<T>(url: string, parse: (json: unknown) => T, label: string): Resource<T> {
  const { version } = useShell()
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    fetch(url, { cache: 'no-store', signal: controller.signal })
      .then(async res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        setData(parse(await res.json()))
        setError(null)
      })
      .catch(err => {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setError(`Couldn't load ${label} (${err instanceof Error ? err.message : 'network error'}).`)
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
    // parse is a module-level function at every call site
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, version, nonce, label])

  const reload = useCallback(() => setNonce(n => n + 1), [])
  return { data, error, loading, reload, setData }
}

const parseWorkouts = (json: unknown) =>
  ((json as { workouts: WorkoutApiSession[] }).workouts ?? []).map(toWorkoutSession)

export function useWorkouts() {
  return useResource('/api/workouts', parseWorkouts, 'workouts')
}

export interface DailyMetric {
  name: string
  /** Calendar day label, YYYY-MM-DD */
  day: string
  qty: number | null
  min: number | null
  avg: number | null
  max: number | null
  units: string | null
}

const parseMetrics = (json: unknown): DailyMetric[] =>
  ((json as { metrics: HealthMetricApiRow[] }).metrics ?? []).map(row => ({
    name: row.name, day: row.date.slice(0, 10), qty: row.qty, min: row.min, avg: row.avg, max: row.max, units: row.units,
  }))

export function useHealthMetrics(since: string, names: string[]) {
  const query = new URLSearchParams({ since, names: names.join(',') }).toString()
  return useResource(`/api/health-metrics?${query}`, parseMetrics, 'Apple Health metrics')
}

const parseMeasurements = (json: unknown): BodyMeasurement[] =>
  (json as BodyMeasurementApiRecord[]).map(row => ({ ...row, date: new Date(row.date) }))

export function useBodyMeasurements() {
  return useResource('/api/body-measurements', parseMeasurements, 'weigh-ins')
}

/** Rows for one metric, keyed by day. */
export function metricSeries(rows: DailyMetric[] | null, name: string): DailyMetric[] {
  return (rows ?? []).filter(row => row.name === name)
}

const hourFormat = new Intl.DateTimeFormat('en-US', { timeZone: TRACKER_TIME_ZONE, hour: 'numeric', hourCycle: 'h23' })

/** Today's tracker (LA) calendar day and hour, fixed for the life of the page. */
export function useToday() {
  const [now] = useState(() => {
    const date = new Date()
    return { today: workoutDay(date), hour: Number(hourFormat.format(date)) }
  })
  return now
}
