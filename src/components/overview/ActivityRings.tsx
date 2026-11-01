'use client'

import { useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { Footprints } from 'lucide-react'
import { civilDate } from '@/lib/calendar'
import { formatNumber } from '@/lib/format'
import type { DailyMetric } from '@/hooks/useFitnessData'
import { Empty, LoadError, Section, Skeleton } from '../ui'

// Default daily goals (Apple's defaults are user-set; these match a typical active setup).
export const RING_GOALS = { move: 600, exercise: 30, stand: 12 } as const
export const RING_METRICS = ['active_energy', 'apple_exercise_time', 'apple_stand_hour', 'step_count'] as const

const RINGS = [
  { key: 'move', metric: 'active_energy', label: 'Move', unit: 'kcal', color: '#F0145A', goal: RING_GOALS.move },
  { key: 'exercise', metric: 'apple_exercise_time', label: 'Exercise', unit: 'min', color: '#5FBF14', goal: RING_GOALS.exercise },
  { key: 'stand', metric: 'apple_stand_hour', label: 'Stand', unit: 'hrs', color: '#06A9C9', goal: RING_GOALS.stand },
] as const

function Ring({ radius, stroke, progress, color, animate }: { radius: number; stroke: number; progress: number; color: string; animate: boolean }) {
  const circumference = 2 * Math.PI * radius
  const first = Math.min(progress, 1)
  const lap = Math.min(Math.max(progress - 1, 0), 1)
  const common = { cx: 100, cy: 100, r: radius, fill: 'none', strokeWidth: stroke, strokeLinecap: 'round' as const }
  return (
    <g transform="rotate(-90 100 100)">
      <circle {...common} stroke={color} strokeOpacity={0.16} />
      {progress > 0 && (
        <circle
          {...common}
          stroke={color}
          strokeDasharray={circumference}
          strokeDashoffset={animate ? circumference * (1 - first) : circumference}
          style={{ transition: 'stroke-dashoffset 1.2s cubic-bezier(0.2, 0.7, 0.2, 1)', filter: `drop-shadow(0 0 6px ${color}66)` }}
        />
      )}
      {lap > 0 && (
        <circle
          {...common}
          stroke={color}
          strokeDasharray={circumference}
          strokeDashoffset={animate ? circumference * (1 - lap) : circumference}
          style={{ transition: 'stroke-dashoffset 1.2s 0.6s cubic-bezier(0.2, 0.7, 0.2, 1)', filter: 'drop-shadow(0 1px 2px rgba(16,24,40,0.18))' }}
        />
      )}
    </g>
  )
}

export function ActivityRings({
  metrics, loading, error, onRetry, today,
}: {
  metrics: DailyMetric[] | null
  loading: boolean
  error: string | null
  onRetry: () => void
  today: string
}) {
  const [animate, setAnimate] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setAnimate(true))
    return () => cancelAnimationFrame(id)
  }, [])

  const view = useMemo(() => {
    const ringNames = new Set<string>(RING_METRICS)
    const rows = (metrics ?? []).filter(row => ringNames.has(row.name))
    if (rows.length === 0) return null
    const hasToday = rows.some(row => row.day === today)
    const day = hasToday ? today : rows.reduce((latest, row) => (row.day > latest ? row.day : latest), rows[0].day)
    const value = (name: string) => rows.find(row => row.name === name && row.day === day)?.qty ?? null
    return {
      day,
      isToday: day === today,
      rings: RINGS.map(ring => ({ ...ring, value: value(ring.metric) })),
      steps: value('step_count'),
    }
  }, [metrics, today])

  const title = view && !view.isToday ? `Latest · ${format(civilDate(view.day), 'EEE, MMM d')}` : 'Today'

  return (
    <Section id="rings" title="Activity rings" eyebrow={title}>
      {loading && !metrics ? (
        <div className="flex items-center gap-6"><Skeleton className="h-40 w-40 rounded-full" /><Skeleton className="h-28 flex-1" /></div>
      ) : error && !metrics ? (
        <LoadError message={error} onRetry={onRetry} />
      ) : !view ? (
        <Empty>No Apple Health data yet. Rings fill in once Health Auto Export pushes your Watch data.</Empty>
      ) : (
        <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center">
          <svg viewBox="0 0 200 200" className="h-44 w-44 shrink-0 sm:h-48 sm:w-48" aria-hidden="true">
            {view.rings.map((ring, i) => (
              <Ring key={ring.key} radius={84 - i * 26} stroke={22} progress={(ring.value ?? 0) / ring.goal} color={ring.color} animate={animate} />
            ))}
          </svg>
          <dl className="grid w-full grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-1">
            {view.rings.map(ring => (
              <div key={ring.key}>
                <dt className="text-xs font-semibold uppercase tracking-wider" style={{ color: ring.color }}>{ring.label}</dt>
                <dd className="stat-num text-2xl">
                  {ring.value == null ? '—' : formatNumber(ring.value)}
                  <span className="text-base font-medium text-fg-subtle">/{ring.goal}</span>
                  <span className="ml-1 text-xs font-medium text-fg-subtle">{ring.unit}</span>
                </dd>
              </div>
            ))}
            <div>
              <dt className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-fg-muted">
                <Footprints className="h-3.5 w-3.5" aria-hidden="true" /> Steps
              </dt>
              <dd className="stat-num text-2xl">{view.steps == null ? '—' : formatNumber(view.steps)}</dd>
            </div>
          </dl>
        </div>
      )}
    </Section>
  )
}
