'use client'

import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import { shiftDay } from '@/lib/training'
import { useBodyMeasurements, useHealthMetrics, useToday, useWorkouts } from '@/hooks/useFitnessData'
import type { WorkoutSession } from '@/types/workout'
import { WorkoutRow } from '../WorkoutRow'
import { Empty, LoadError, Section, Skeleton } from '../ui'
import { ActivityRings, RING_METRICS } from './ActivityRings'
import { FunStats } from './FunStats'
import { HEART_METRICS, HeartTrends, WeightCard } from './HeartTrends'
import { StrengthFocus } from './StrengthFocus'
import { TrainingHeatmap } from './TrainingHeatmap'
import { WeekView } from './WeekView'
import { PlanCard } from './PlanCard'
import { Hero } from './Hero'

const OVERVIEW_METRICS = [...RING_METRICS, ...HEART_METRICS]

export function OverviewDashboard() {
  const { today, hour } = useToday()
  const workouts = useWorkouts()
  const metrics = useHealthMetrics(shiftDay(today, -120), OVERVIEW_METRICS)
  const body = useBodyMeasurements()

  const rows = workouts.data
  const metricProps = { metrics: metrics.data, loading: metrics.loading, error: metrics.error, onRetry: metrics.reload, today }

  return (
    <div className="space-y-4 sm:space-y-5">
      {workouts.error && !rows && <LoadError message={workouts.error} onRetry={workouts.reload} />}

      <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-7">
          {rows ? <Hero workouts={rows} today={today} hour={hour} /> : <Skeleton className="h-80" />}
        </div>
        <div className="min-w-0 lg:col-span-5">
          <ActivityRings {...metricProps} />
        </div>
      </div>

      {rows ? (
        <WorkoutSections rows={rows} today={today} />
      ) : (
        <div className="space-y-4">
          <Skeleton className="h-64" />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12"><Skeleton className="h-96 lg:col-span-7" /><Skeleton className="h-96 lg:col-span-5" /></div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-8">
          <HeartTrends {...metricProps} />
        </div>
        <div className="min-w-0 lg:col-span-4">
          <WeightCard measurements={body.data} loading={body.loading} error={body.error} today={today} />
        </div>
      </div>

      {rows && <FunStats workouts={rows} year={Number(today.slice(0, 4))} />}
    </div>
  )
}

function WorkoutSections({ rows, today }: { rows: WorkoutSession[]; today: string }) {
  const recent = rows.slice(0, 6) // API returns newest first
  return (
    <>
      <PlanCard workouts={rows} today={today} />
      <WeekView workouts={rows} today={today} />
      <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-7">
          <StrengthFocus workouts={rows} today={today} />
        </div>
        <div className="min-w-0 lg:col-span-5">
          <Section
            id="recent"
            title="Recent workouts"
            eyebrow="Latest sessions"
            action={
              <Link href="/workouts" className="flex items-center gap-1 text-xs font-semibold text-fg-muted hover:text-volt-ink">
                All workouts <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            }
          >
            {recent.length === 0 ? (
              <Empty>No workouts yet. Hit Sync Peloton or add one on the Workouts tab.</Empty>
            ) : (
              <ul className="-mx-2 space-y-0.5">
                {recent.map(w => <li key={w.id}><WorkoutRow workout={w} /></li>)}
              </ul>
            )}
          </Section>
        </div>
      </div>
      <TrainingHeatmap workouts={rows} today={today} />
    </>
  )
}
