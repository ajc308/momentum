'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { format } from 'date-fns'
import { ArrowUpRight, HeartPulse, Scale, Waves } from 'lucide-react'
import { civilDate, measurementCalendarDate } from '@/lib/calendar'
import { formatNumber } from '@/lib/format'
import { shiftDay } from '@/lib/training'
import { metricSeries, type DailyMetric } from '@/hooks/useFitnessData'
import type { BodyMeasurement } from '@/types/health'
import { TrendChart } from '../charts'
import { Empty, LoadError, Section, Skeleton } from '../ui'

export const HEART_METRICS = ['resting_heart_rate', 'heart_rate_variability'] as const

function average(values: number[]) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
}

/** Latest value, 30-day average and change vs the 30 days before. */
export function summarize(rows: DailyMetric[], today: string) {
  const points = rows.filter(r => r.qty != null).map(r => ({ day: r.day, value: r.qty as number }))
  const latest = points[points.length - 1] ?? null
  const recent = average(points.filter(p => p.day > shiftDay(today, -30)).map(p => p.value))
  const prior = average(points.filter(p => p.day <= shiftDay(today, -30) && p.day > shiftDay(today, -60)).map(p => p.value))
  return { points, latest, recent, change: recent != null && prior != null ? recent - prior : null }
}

function MetricPanel({
  title, icon: Icon, color, unit, rows, today, betterWhenLower,
}: {
  title: string
  icon: typeof HeartPulse
  color: string
  unit: string
  rows: DailyMetric[]
  today: string
  betterWhenLower: boolean
}) {
  const s = useMemo(() => summarize(rows, today), [rows, today])
  const chartPoints = s.points.filter(p => p.day > shiftDay(today, -90))
  const improving = s.change != null && Math.abs(s.change) >= 0.5 && (betterWhenLower ? s.change < 0 : s.change > 0)
  return (
    <div className="rounded-2xl border border-ink-700/70 bg-ink-850/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider" style={{ color }}>
            <Icon className="h-3.5 w-3.5" aria-hidden="true" /> {title}
          </p>
          <p className="stat-num mt-1 text-3xl">
            {s.latest ? formatNumber(s.latest.value) : '—'}
            <span className="ml-1 text-sm font-medium text-fg-subtle">{unit}</span>
          </p>
          {s.latest && <p className="text-xs text-fg-subtle">Latest · {format(civilDate(s.latest.day), 'MMM d')}</p>}
        </div>
        <div className="text-right text-xs text-fg-subtle">
          <p>30-day avg</p>
          <p className="stat-num text-base text-fg">{s.recent != null ? formatNumber(s.recent) : '—'}</p>
          {s.change != null && (
            <p className={improving ? 'text-volt-ink' : 'text-fg-muted'}>
              {s.change > 0 ? '+' : s.change < 0 ? '−' : ''}{formatNumber(Math.abs(s.change), 1)} vs prior 30d
            </p>
          )}
        </div>
      </div>
      {chartPoints.length > 1 ? (
        <div className="mt-3">
          <TrendChart data={chartPoints} color={color} unit={unit} height={110} label={`${title} over the last 90 days`} />
        </div>
      ) : (
        <p className="mt-4 text-xs text-fg-subtle">Not enough recent data for a trend yet.</p>
      )}
    </div>
  )
}

export function HeartTrends({
  metrics, loading, error, onRetry, today,
}: {
  metrics: DailyMetric[] | null
  loading: boolean
  error: string | null
  onRetry: () => void
  today: string
}) {
  const resting = metricSeries(metrics, 'resting_heart_rate')
  const hrv = metricSeries(metrics, 'heart_rate_variability')
  return (
    <Section id="heart" title="Heart trends" eyebrow="Apple Watch · 90 days">
      {loading && !metrics ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><Skeleton className="h-48" /><Skeleton className="h-48" /></div>
      ) : error && !metrics ? (
        <LoadError message={error} onRetry={onRetry} />
      ) : resting.length === 0 && hrv.length === 0 ? (
        <Empty>No heart data yet. Resting heart rate and HRV arrive from Apple Health.</Empty>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <MetricPanel title="Resting HR" icon={HeartPulse} color="#E11D48" unit="bpm" rows={resting} today={today} betterWhenLower />
          <MetricPanel title="HRV" icon={Waves} color="#0891B2" unit="ms" rows={hrv} today={today} betterWhenLower={false} />
        </div>
      )}
    </Section>
  )
}

export function WeightCard({
  measurements, loading, error, today,
}: {
  measurements: BodyMeasurement[] | null
  loading: boolean
  error: string | null
  today: string
}) {
  const view = useMemo(() => {
    const rows = [...(measurements ?? [])].sort((a, b) => a.date.getTime() - b.date.getTime())
    const latest = rows[rows.length - 1]
    if (!latest) return null
    const latestKey = latest.date.toISOString().slice(0, 10)
    const monthAgo = [...rows].reverse().find(m => m.date.toISOString().slice(0, 10) <= shiftDay(latestKey, -30))
    return {
      latest,
      change: monthAgo ? latest.weightLbs - monthAgo.weightLbs : null,
      points: rows
        .filter(m => m.date.toISOString().slice(0, 10) > shiftDay(today, -365))
        .map(m => ({ day: m.date.toISOString().slice(0, 10), value: m.weightLbs })),
    }
  }, [measurements, today])

  return (
    <Section
      id="weight"
      title="Weight"
      eyebrow="Body"
      action={
        <Link href="/body" className="flex items-center gap-1 text-xs font-semibold text-fg-muted hover:text-volt-ink">
          Log &amp; history <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      }
    >
      {loading && !measurements ? (
        <Skeleton className="h-36" />
      ) : error && !measurements ? (
        <LoadError message={error} />
      ) : !view ? (
        <Empty>
          <Scale className="mx-auto mb-2 h-5 w-5" aria-hidden="true" />
          No weigh-ins yet. <Link href="/body" className="font-semibold text-volt-ink hover:underline">Log your first</Link>.
        </Empty>
      ) : (
        <>
          <p className="stat-num text-4xl">
            {formatNumber(view.latest.weightLbs, 1)}<span className="ml-1 text-base font-medium text-fg-subtle">lbs</span>
          </p>
          <p className="text-xs text-fg-subtle">
            {format(measurementCalendarDate(view.latest.date), 'MMM d')}
            {view.change != null && ` · ${view.change > 0 ? '+' : view.change < 0 ? '−' : ''}${formatNumber(Math.abs(view.change), 1)} lbs in 30 days`}
          </p>
          {view.points.length > 1 && (
            <div className="mt-3">
              <TrendChart data={view.points} color="#5E9A0B" unit="lbs" digits={1} height={90} showAxis={false} label="Weight over the last year" />
            </div>
          )}
        </>
      )}
    </Section>
  )
}
