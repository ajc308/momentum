'use client'

import { Flame, HeartPulse, Timer } from 'lucide-react'
import { TRACKER_TIME_ZONE } from '@/lib/calendar'
import { workoutTitle } from '@/lib/disciplines'
import { formatMinutes, formatNumber } from '@/lib/format'
import type { WorkoutSession } from '@/types/workout'
import { DisciplineIcon, DisciplineTag, SourceBadge } from './ui'

const whenFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: TRACKER_TIME_ZONE, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
})

export function formatWhen(date: Date) {
  return whenFormat.format(date).replace(/, (\d)/, ' · $1')
}

export function WorkoutRow({
  workout, actions, showDate = true,
}: {
  workout: WorkoutSession
  actions?: React.ReactNode
  showDate?: boolean
}) {
  const title = workoutTitle(workout)
  const meta = [workout.instructor, showDate ? formatWhen(workout.date) : null].filter(Boolean).join(' · ')
  const mobileStats = [
    formatMinutes(workout.minutes),
    workout.calories ? `${formatNumber(workout.calories)} kcal` : null,
    workout.avgHeartRate ? `${workout.avgHeartRate} bpm` : null,
    workout.miles ? `${formatNumber(workout.miles, 1)} mi` : null,
  ].filter(Boolean).join(' · ')
  return (
    <div className="group flex items-center gap-3 rounded-2xl px-2 py-2.5 transition-colors hover:bg-ink-850 sm:gap-4 sm:px-3">
      <DisciplineIcon workout={workout} />
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 font-semibold leading-snug text-fg sm:truncate" title={title}>{title}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-subtle">
          {meta && <span className="min-w-0 truncate">{meta}</span>}
          <span className="font-semibold text-fg-muted sm:hidden">{mobileStats}</span>
          <DisciplineTag workout={workout} />
          <SourceBadge source={workout.source} />
        </div>
        {/* Synced Peloton notes just repeat the title ("<title> — w/ <instructor>"); show only real notes. */}
        {workout.notes && !(workout.classTitle && workout.notes.startsWith(workout.classTitle)) && (
          <p className="mt-1 line-clamp-1 text-xs text-fg-subtle">{workout.notes}</p>
        )}
      </div>
      <div className="hidden shrink-0 flex-col items-end gap-0.5 text-right sm:flex">
        <div className="flex items-center gap-1">
          <span className="sr-only">Duration</span>
          <Timer className="hidden h-3.5 w-3.5 text-fg-subtle sm:block" aria-hidden="true" />
          <span className="stat-num text-base">{formatMinutes(workout.minutes)}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-fg-muted">
          {workout.calories != null && workout.calories > 0 && (
            <span className="flex items-center gap-0.5">
              <span className="sr-only">Calories</span>
              <Flame className="h-3 w-3 text-discipline-cardio" aria-hidden="true" />
              <span className="tabular-nums">{formatNumber(workout.calories)}</span>
            </span>
          )}
          {workout.avgHeartRate != null && workout.avgHeartRate > 0 && (
            <span className="flex items-center gap-0.5">
              <span className="sr-only">Average heart rate</span>
              <HeartPulse className="h-3 w-3 text-discipline-strength" aria-hidden="true" />
              <span className="tabular-nums">{workout.avgHeartRate}</span>
            </span>
          )}
          {workout.miles != null && workout.miles > 0 && (
            <span className="tabular-nums">
              <span className="sr-only">Distance</span>
              <span>{formatNumber(workout.miles, 1)} mi</span>
            </span>
          )}
        </div>
      </div>
      {actions}
    </div>
  )
}
