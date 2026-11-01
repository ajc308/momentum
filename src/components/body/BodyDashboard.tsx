'use client'

import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { ChevronDown, Footprints, HeartPulse, Minus, Plus, Trash2, TrendingDown, TrendingUp, Waves, Wind } from 'lucide-react'
import { civilDate, measurementCalendarDate } from '@/lib/calendar'
import { navyBodyFatPct } from '@/lib/body-fat'
import { formatNumber } from '@/lib/format'
import { shiftDay } from '@/lib/training'
import { cn } from '@/lib/utils'
import { metricSeries, useBodyMeasurements, useHealthMetrics, useToday, type DailyMetric } from '@/hooks/useFitnessData'
import type { BodyMeasurement } from '@/types/health'
import { useShell } from '../AppShell'
import { DailyBars, TrendChart } from '../charts'
import { Empty, LoadError, Section, Segmented, Skeleton } from '../ui'

type Range = '30' | '90' | '180' | '365'
const RANGES: { value: Range; label: string }[] = [
  { value: '30', label: '30d' }, { value: '90', label: '90d' }, { value: '180', label: '6m' }, { value: '365', label: '1y' },
]
const BODY_METRICS = ['resting_heart_rate', 'heart_rate_variability', 'vo2_max', 'step_count']
const STEP_GOAL = 10000

const dayOf = (m: BodyMeasurement) => m.date.toISOString().slice(0, 10)

function ChangeStat({ label, current, previous }: { label: string; current: number | null; previous: number | null }) {
  const delta = current != null && previous != null ? current - previous : null
  const flat = delta == null || Math.abs(delta) < 0.1
  const Icon = flat ? Minus : delta! > 0 ? TrendingUp : TrendingDown
  return (
    <div className="card p-4">
      <p className="eyebrow">{label}</p>
      <p className="stat-num mt-2 flex items-center gap-1.5 text-2xl sm:text-3xl">
        <Icon className={cn('h-5 w-5', flat ? 'text-fg-subtle' : delta! > 0 ? 'text-discipline-walk' : 'text-volt-ink')} aria-hidden="true" />
        {delta == null ? '—' : `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${formatNumber(Math.abs(delta), 1)}`}
        {delta != null && <span className="text-sm font-medium text-fg-subtle">lbs</span>}
      </p>
    </div>
  )
}

function MetricCard({
  title, icon: Icon, color, unit, rows, from, digits = 0, bars = false,
}: {
  title: string
  icon: typeof HeartPulse
  color: string
  unit: string
  rows: DailyMetric[]
  from: string
  digits?: number
  bars?: boolean
}) {
  const points = rows.filter(r => r.qty != null && r.day >= from).map(r => ({ day: r.day, value: r.qty as number }))
  const withValues = rows.filter(r => r.qty != null)
  const latest = withValues[withValues.length - 1] ?? null
  const avg = points.length ? points.reduce((sum, p) => sum + p.value, 0) / points.length : null
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider" style={{ color }}>
            <Icon className="h-3.5 w-3.5" aria-hidden="true" /> {title}
          </p>
          <p className="stat-num mt-1 text-3xl">
            {latest?.qty != null ? formatNumber(latest.qty, digits) : '—'}
            <span className="ml-1 text-sm font-medium text-fg-subtle">{unit}</span>
          </p>
          {latest && <p className="text-xs text-fg-subtle">Latest · {format(civilDate(latest.day), 'MMM d')}</p>}
        </div>
        <div className="text-right text-xs text-fg-subtle">
          <p>Range avg</p>
          <p className="stat-num text-base text-fg">{avg != null ? formatNumber(avg, digits) : '—'}</p>
        </div>
      </div>
      <div className="mt-3">
        {points.length > 1 ? (
          bars
            ? <DailyBars data={points} color={color} unit={unit} height={120} goal={STEP_GOAL} label={`${title} per day`} />
            : <TrendChart data={points} color={color} unit={unit} digits={digits} height={120} label={`${title} trend`} />
        ) : (
          <p className="py-8 text-center text-xs text-fg-subtle">Not enough data in this range yet.</p>
        )}
      </div>
    </div>
  )
}

export function BodyDashboard() {
  const { notify } = useShell()
  const { today } = useToday()
  const body = useBodyMeasurements()
  const metrics = useHealthMetrics(shiftDay(today, -365), BODY_METRICS)
  const [range, setRange] = useState<Range>('365')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [entryDate, setEntryDate] = useState(today)
  const [entryWeight, setEntryWeight] = useState('')
  const [entryNeck, setEntryNeck] = useState('')
  const [entryWaist, setEntryWaist] = useState('')
  const [entryHeight, setEntryHeight] = useState('')
  const [showHistory, setShowHistory] = useState(false)

  const from = shiftDay(today, -Number(range) + 1)
  const sorted = useMemo(() => [...(body.data ?? [])].sort((a, b) => b.date.getTime() - a.date.getTime()), [body.data])
  const latest = sorted[0] ?? null
  const lastHeight = sorted.find(m => m.heightIn != null)?.heightIn ?? null
  const height = entryHeight ? Number(entryHeight) : lastHeight
  const fatPreview = entryNeck && entryWaist && height ? navyBodyFatPct(Number(entryNeck), Number(entryWaist), height) : null
  const fatRows = sorted.filter(m => m.bodyFatPct != null)
  const latestFat = fatRows[0] ?? null
  const previousFat = fatRows[1] ?? null
  const asOf = (days: number) => {
    if (!latest) return null
    const target = shiftDay(dayOf(latest), -days)
    // Closest reading at or before the target day.
    return sorted.find(m => dayOf(m) <= target)?.weightLbs ?? null
  }
  const weightPoints = useMemo(
    () => [...sorted].reverse().filter(m => dayOf(m) >= from).map(m => ({ day: dayOf(m), value: Math.round(m.weightLbs * 10) / 10 })),
    [sorted, from],
  )

  const handleLogWeight = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setFormError(null)
    try {
      const res = await fetch('/api/body-measurements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: entryDate,
          weightLbs: Number(entryWeight),
          ...(entryNeck && entryWaist ? { neckIn: Number(entryNeck), waistIn: Number(entryWaist) } : {}),
          ...(entryHeight ? { heightIn: Number(entryHeight) } : {}),
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setFormError(data.error ?? `Save failed (HTTP ${res.status})`)
        return
      }
      const logged = Number(entryWeight)
      setEntryWeight('')
      setEntryNeck('')
      setEntryWaist('')
      setEntryHeight('')
      body.reload()
      notify('success', `Logged ${logged.toFixed(1)} lbs${fatPreview != null ? ` and ${fatPreview}% body fat` : ''} for ${format(civilDate(entryDate), 'MMM d, yyyy')}`)
    } catch (error) {
      setFormError(`Save failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (m: BodyMeasurement) => {
    if (!confirm(`Delete the ${format(measurementCalendarDate(m.date), 'MMM d')} weigh-in?`)) return
    const res = await fetch(`/api/body-measurements?id=${encodeURIComponent(m.id)}`, { method: 'DELETE' })
    if (res.ok) body.reload()
    else notify('error', `Delete failed (HTTP ${res.status})`)
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="eyebrow">Weight &amp; recovery</p>
        <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Body</h1>
      </div>

      <form onSubmit={handleLogWeight} className="card grid grid-cols-2 items-end gap-3 p-4 sm:grid-cols-[1fr_1fr_1fr_auto] sm:p-5">
        <label className="col-span-2 sm:col-span-1">
          <span className="field-label">Date</span>
          <input type="date" required value={entryDate} max={today} onChange={e => setEntryDate(e.target.value)} className="field" />
        </label>
        <label>
          <span className="field-label">Weight (lbs)</span>
          <input type="number" inputMode="decimal" required min={50} max={1000} step={0.1} value={entryWeight}
            onChange={e => setEntryWeight(e.target.value)} className="field" placeholder="185.0" />
        </label>
        <button type="submit" disabled={saving} className="btn-volt col-span-2 h-11 sm:col-span-1">
          <Plus className="h-4 w-4" aria-hidden="true" /> {saving ? 'Saving…' : 'Log weight'}
        </button>
        <details className="col-span-2 rounded-2xl border border-ink-700 bg-ink-850/60 px-4 py-3 sm:col-span-4" open={Boolean(entryNeck || entryWaist)}>
          <summary className="cursor-pointer text-sm font-semibold text-fg">
            Tape measurements <span className="font-normal text-fg-subtle">— optional, calculates body fat %</span>
          </summary>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <label>
              <span className="field-label">Neck (in)</span>
              <input type="number" inputMode="decimal" min={8} max={30} step={0.25} value={entryNeck}
                onChange={e => setEntryNeck(e.target.value)} className="field" placeholder="15.5" />
            </label>
            <label>
              <span className="field-label">Waist at navel (in)</span>
              <input type="number" inputMode="decimal" min={20} max={80} step={0.25} value={entryWaist}
                onChange={e => setEntryWaist(e.target.value)} className="field" placeholder="34" />
            </label>
            <label>
              <span className="field-label">Height (in)</span>
              <input type="number" inputMode="decimal" min={48} max={96} step={0.25} value={entryHeight}
                onChange={e => setEntryHeight(e.target.value)} className="field"
                placeholder={lastHeight != null ? String(lastHeight) : '70'} required={!lastHeight && Boolean(entryNeck || entryWaist)} />
            </label>
          </div>
          <p className="mt-2 text-xs text-fg-muted" aria-live="polite">
            {fatPreview != null
              ? <>≈ <span className="font-semibold text-fg">{fatPreview}% body fat</span> (US Navy method)</>
              : 'Soft tailor’s tape, snug not tight. Neck just below the Adam’s apple; waist at the navel after a normal breath out. Height is remembered after the first time.'}
          </p>
        </details>
        {formError && <p role="alert" className="col-span-2 text-sm text-danger sm:col-span-4">{formError}</p>}
      </form>

      {body.error && !body.data && <LoadError message={body.error} onRetry={body.reload} />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="card p-4">
          <p className="eyebrow">Current</p>
          <p className="stat-num mt-2 text-2xl sm:text-3xl">
            {latest ? formatNumber(latest.weightLbs, 1) : '—'}
            {latest && <span className="ml-1 text-sm font-medium text-fg-subtle">lbs</span>}
          </p>
          {latest && <p className="text-xs text-fg-subtle">{format(measurementCalendarDate(latest.date), 'MMM d, yyyy')}</p>}
        </div>
        <ChangeStat label="7-day change" current={latest?.weightLbs ?? null} previous={asOf(7)} />
        <ChangeStat label="30-day change" current={latest?.weightLbs ?? null} previous={asOf(30)} />
        <div className="card p-4">
          <p className="eyebrow">Body fat</p>
          <p className="stat-num mt-2 text-2xl sm:text-3xl">
            {latestFat ? `${formatNumber(latestFat.bodyFatPct!, 1)}%` : '—'}
          </p>
          <p className="text-xs text-fg-subtle">
            {latestFat
              ? <>{format(measurementCalendarDate(latestFat.date), 'MMM d')}{previousFat && ` · ${latestFat.bodyFatPct! - previousFat.bodyFatPct! > 0 ? '+' : ''}${formatNumber(latestFat.bodyFatPct! - previousFat.bodyFatPct!, 1)} since ${format(measurementCalendarDate(previousFat.date), 'MMM d')}`}</>
              : 'Add tape measurements'}
          </p>
        </div>
      </div>

      <Section id="weight-trend" title="Weight trend" action={<Segmented label="Range" value={range} onChange={setRange} options={RANGES} />}>
        {body.loading && !body.data ? (
          <Skeleton className="h-64" />
        ) : weightPoints.length > 1 ? (
          <TrendChart data={weightPoints} color="#5E9A0B" unit="lbs" digits={1} height={260} label="Weight over the selected range" />
        ) : (
          <Empty>{sorted.length === 0 ? 'No weigh-ins yet. Log one above to start your trend.' : 'Not enough weigh-ins in this range for a trend.'}</Empty>
        )}
      </Section>

      <div>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <p className="eyebrow">Apple Health</p>
            <h2 className="font-display text-xl font-bold">Recovery &amp; fitness</h2>
          </div>
          <Segmented label="Range" value={range} onChange={setRange} options={RANGES} />
        </div>
        {metrics.loading && !metrics.data ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-56" />)}</div>
        ) : metrics.error && !metrics.data ? (
          <LoadError message={metrics.error} onRetry={metrics.reload} />
        ) : (metrics.data ?? []).length === 0 ? (
          <Empty>No Apple Health data yet. It arrives from Health Auto Export on your iPhone.</Empty>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <MetricCard title="Resting HR" icon={HeartPulse} color="#E11D48" unit="bpm" rows={metricSeries(metrics.data, 'resting_heart_rate')} from={from} />
            <MetricCard title="HRV" icon={Waves} color="#0891B2" unit="ms" rows={metricSeries(metrics.data, 'heart_rate_variability')} from={from} />
            <MetricCard title="VO₂ max" icon={Wind} color="#7C3AED" unit="ml/kg·min" digits={1} rows={metricSeries(metrics.data, 'vo2_max')} from={from} />
            <MetricCard title="Steps" icon={Footprints} color="#D97706" unit="steps" rows={metricSeries(metrics.data, 'step_count')} from={from} bars />
          </div>
        )}
      </div>

      <section className="card" aria-labelledby="history-title">
        <button
          type="button"
          onClick={() => setShowHistory(v => !v)}
          aria-expanded={showHistory}
          aria-controls="weigh-in-history"
          className="flex w-full items-center justify-between rounded-3xl p-5 text-left"
        >
          <span id="history-title" className="font-display text-lg font-bold">
            Weigh-in history <span className="text-sm font-medium text-fg-subtle">({sorted.length})</span>
          </span>
          <ChevronDown className={cn('h-5 w-5 text-fg-muted transition-transform', showHistory && 'rotate-180')} aria-hidden="true" />
        </button>
        {showHistory && (
          <ul id="weigh-in-history" className="border-t border-ink-700/70 px-2 py-2">
            {sorted.length === 0 && <li className="px-3 py-6 text-center text-sm text-fg-subtle">No entries yet.</li>}
            {sorted.map(m => (
              <li key={m.id} className="flex items-center gap-3 rounded-2xl px-3 py-2 hover:bg-ink-850">
                <span className="w-28 text-sm text-fg-muted">{format(measurementCalendarDate(m.date), 'MMM d, yyyy')}</span>
                <span className="stat-num flex-1 text-base">{formatNumber(m.weightLbs, 1)} <span className="text-xs font-medium text-fg-subtle">lbs</span></span>
                <span className="w-16 text-right text-sm text-fg-muted">{m.bodyFatPct != null ? `${formatNumber(m.bodyFatPct, 1)}%` : '—'}</span>
                <span className="hidden w-20 text-right text-xs text-fg-subtle sm:block">{m.source}</span>
                <button type="button" onClick={() => handleDelete(m)} aria-label={`Delete ${format(measurementCalendarDate(m.date), 'MMM d, yyyy')} weigh-in`} className="icon-btn h-8 w-8 hover:text-danger">
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
