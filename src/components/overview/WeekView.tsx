'use client'

import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { civilDate } from '@/lib/calendar'
import { DISCIPLINES, disciplineOf, workoutTitle } from '@/lib/disciplines'
import { formatMinutes, plural } from '@/lib/format'
import { groupByDay, weekDays } from '@/lib/training'
import { cn } from '@/lib/utils'
import type { WorkoutSession } from '@/types/workout'
import { Section, Segmented } from '../ui'

type WeekKey = 'this' | 'last'

/** Mon-Sun grid for this week and last week, each day listing its class titles. */
export function WeekView({ workouts, today }: { workouts: WorkoutSession[]; today: string }) {
  const [mobileWeek, setMobileWeek] = useState<WeekKey>('this')
  const byDay = useMemo(() => groupByDay(workouts), [workouts])
  const weeks = useMemo(() => ([
    { key: 'this' as const, label: 'This week', days: weekDays(today, 0) },
    { key: 'last' as const, label: 'Last week', days: weekDays(today, -1) },
  ]).map(week => {
    const sessions = week.days.flatMap(day => byDay.get(day) ?? [])
    return { ...week, sessions: sessions.length, minutes: sessions.reduce((sum, w) => sum + w.minutes, 0) }
  }), [byDay, today])

  return (
    <Section
      id="week"
      title="Your split"
      eyebrow="Two weeks at a glance"
      action={
        <div className="md:hidden">
          <Segmented label="Week" value={mobileWeek} onChange={setMobileWeek}
            options={[{ value: 'this', label: 'This week' }, { value: 'last', label: 'Last week' }]} />
        </div>
      }
    >
      <div className="space-y-5">
        {weeks.map(week => (
          <div key={week.key} className={cn(week.key !== mobileWeek && 'hidden md:block')}>
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold">{week.label}</h3>
              <p className="text-xs text-fg-subtle">{plural(week.sessions, 'session')} · {formatMinutes(week.minutes)}</p>
            </div>
            <ol className="grid grid-cols-1 gap-1.5 md:grid-cols-7">
              {week.days.map(day => {
                const items = byDay.get(day) ?? []
                const isToday = day === today
                const future = day > today
                return (
                  <li
                    key={day}
                    className={cn(
                      'flex min-h-[3rem] gap-3 rounded-2xl border px-3 py-2 md:min-h-[7.5rem] md:flex-col md:gap-1.5 md:p-2.5',
                      isToday ? 'border-volt/60 bg-volt/[0.06]' : 'border-ink-700/70 bg-ink-850/60',
                      future && 'opacity-50',
                    )}
                  >
                    <div className="flex w-12 shrink-0 flex-col md:w-auto md:flex-row md:items-baseline md:gap-1.5">
                      <span className={cn('text-[11px] font-semibold uppercase tracking-wider', isToday ? 'text-volt-ink' : 'text-fg-subtle')}>
                        {format(civilDate(day), 'EEE')}
                      </span>
                      <span className="stat-num text-lg leading-tight">{format(civilDate(day), 'd')}</span>
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 md:justify-start">
                      {items.length === 0 ? (
                        <span className="text-xs text-fg-subtle">{future ? '' : isToday ? 'Nothing yet' : 'Rest'}</span>
                      ) : items.map(w => {
                        const { color } = DISCIPLINES[disciplineOf(w)]
                        const title = workoutTitle(w)
                        return (
                          <span key={w.id} title={title} className="flex items-start gap-1.5 text-xs leading-snug">
                            <span aria-hidden="true" className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                            <span className="line-clamp-2 text-fg">{title}</span>
                          </span>
                        )
                      })}
                    </div>
                  </li>
                )
              })}
            </ol>
          </div>
        ))}
      </div>
    </Section>
  )
}
