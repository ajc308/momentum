'use client'

import { useMemo } from 'react'
import { format } from 'date-fns'
import { Crown, Flame, HeartPulse, Timer } from 'lucide-react'
import { workoutCalendarDate } from '@/lib/calendar'
import { workoutTitle } from '@/lib/disciplines'
import { formatHours, formatMinutes, formatNumber } from '@/lib/format'
import { personalBests, topInstructors, yearTotals } from '@/lib/training'
import type { WorkoutSession } from '@/types/workout'
import { Empty, Section } from '../ui'

export function FunStats({ workouts, year }: { workouts: WorkoutSession[]; year: number }) {
  const totals = useMemo(() => yearTotals(workouts, year), [workouts, year])
  const instructors = useMemo(() => topInstructors(workouts, year, 4), [workouts, year])
  const bests = useMemo(() => personalBests(workouts), [workouts])
  const topCount = instructors[0]?.sessions ?? 1

  const bestRows = [
    { label: 'Longest class', icon: Timer, workout: bests.longest, value: bests.longest && formatMinutes(bests.longest.minutes) },
    { label: 'Most calories', icon: Flame, workout: bests.mostCalories, value: bests.mostCalories && `${formatNumber(bests.mostCalories.calories ?? 0)} kcal` },
    { label: 'Highest avg HR', icon: HeartPulse, workout: bests.highestAvgHr, value: bests.highestAvgHr && `${bests.highestAvgHr.avgHeartRate} bpm` },
  ]

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Section id="year" title={`${year} so far`} eyebrow="Year totals">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-5">
          {[
            { label: 'Sessions', value: formatNumber(totals.sessions) },
            { label: 'Hours', value: formatHours(totals.minutes) },
            { label: 'Calories', value: totals.calories >= 10000 ? `${formatNumber(totals.calories / 1000, 1)}k` : formatNumber(totals.calories) },
            { label: 'Active days', value: formatNumber(totals.activeDays) },
          ].map(stat => (
            <div key={stat.label}>
              <dt className="eyebrow">{stat.label}</dt>
              <dd className="stat-num mt-1 text-3xl">{stat.value}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section id="instructors" title="Favorite instructors" eyebrow={`Sessions in ${year}`}>
        {instructors.length === 0 ? (
          <Empty>No instructor-led classes yet this year.</Empty>
        ) : (
          <ol className="space-y-3">
            {instructors.map((instructor, i) => (
              <li key={instructor.name}>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2 font-semibold">
                    {i === 0
                      ? <Crown className="h-4 w-4 shrink-0 text-volt-ink" aria-label="Top instructor" />
                      : <span className="w-4 text-center text-xs text-fg-subtle">{i + 1}</span>}
                    <span className="truncate">{instructor.name}</span>
                  </span>
                  <span className="shrink-0 text-xs text-fg-muted">
                    <span className="stat-num text-sm text-fg">{instructor.sessions}</span> classes · {formatHours(instructor.minutes)} h
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink-700" aria-hidden="true">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-volt-deep to-volt"
                    style={{ width: `${(instructor.sessions / topCount) * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Section id="bests" title="Personal bests" eyebrow="All time">
        {!bests.longest ? (
          <Empty>Log a workout to start setting records.</Empty>
        ) : (
          <ul className="space-y-3">
            {bestRows.map(({ label, icon: Icon, workout, value }) => (
              <li key={label} className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ink-800 text-volt-ink">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="eyebrow">{label}</p>
                  {workout ? (
                    <>
                      <p className="truncate text-sm font-semibold" title={workoutTitle(workout)}>{workoutTitle(workout)}</p>
                      <p className="text-xs text-fg-subtle">
                        {[workout.instructor, format(workoutCalendarDate(workout.date), 'MMM d, yyyy')].filter(Boolean).join(' · ')}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-fg-subtle">No data yet</p>
                  )}
                </div>
                {value && <p className="stat-num shrink-0 text-lg">{value}</p>}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}

