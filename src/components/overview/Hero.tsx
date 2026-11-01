'use client'

import { useMemo } from 'react'
import { useSession } from 'next-auth/react'
import { format } from 'date-fns'
import { Flame } from 'lucide-react'
import { civilDate } from '@/lib/calendar'
import { formatMinutes, plural } from '@/lib/format'
import { currentStreak, groupByDay, longestStreak, shiftDay, sumWindow, weekStart } from '@/lib/training'
import type { WorkoutSession } from '@/types/workout'

function greeting(hour: number) {
  if (hour < 5) return 'Up late'
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

export function Hero({ workouts, today, hour }: { workouts: WorkoutSession[]; today: string; hour: number }) {
  const { data: session } = useSession()
  const firstName = session?.user?.name?.split(' ')[0]

  const stats = useMemo(() => {
    const days = new Set(groupByDay(workouts).keys())
    const monday = weekStart(today)
    const lastMonday = shiftDay(monday, -7)
    // Compare against the same number of days into last week.
    const sameDayLastWeek = shiftDay(today, -7)
    return {
      streak: currentStreak(days, today),
      longest: longestStreak(days),
      week: sumWindow(workouts, monday, today),
      lastWeekSoFar: sumWindow(workouts, lastMonday, sameDayLastWeek),
    }
  }, [workouts, today])

  const { streak, longest, week, lastWeekSoFar } = stats
  const nudge = streak.activeToday
    ? streak.days > 1 ? 'Streak extended. Keep rolling.' : 'Day one done. Come back tomorrow.'
    : streak.days > 0 ? `Train today to make it ${streak.days + 1}.` : 'Any workout today starts a new streak.'
  const delta = week.minutes - lastWeekSoFar.minutes

  return (
    <section aria-labelledby="hero-title" className="card relative animate-rise overflow-hidden p-5 sm:p-7">
      <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-volt/10 blur-3xl" />
      <p className="eyebrow">{format(civilDate(today), 'EEEE, MMMM d')}</p>
      <h1 id="hero-title" className="mt-1 font-display text-2xl font-bold tracking-tight sm:text-3xl">
        {greeting(hour)}{firstName ? `, ${firstName}` : ''}.
      </h1>

      <div className="mt-6 flex items-end gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-volt to-volt-deep text-fg shadow-volt sm:h-16 sm:w-16">
            <Flame className="h-7 w-7 sm:h-8 sm:w-8" aria-hidden="true" />
          </span>
          <div>
            <p className="stat-num text-6xl leading-none sm:text-7xl">{streak.days}</p>
          </div>
        </div>
        <div className="pb-1">
          <p className="font-display text-lg font-semibold leading-tight">day streak</p>
          <p className="text-xs text-fg-subtle">Best ever: {plural(longest, 'day')}</p>
        </div>
      </div>
      <p className="mt-3 text-sm text-fg-muted">{nudge}</p>

      <dl className="mt-6 grid grid-cols-3 gap-2 border-t border-ink-700/70 pt-5">
        <div>
          <dt className="eyebrow">This week</dt>
          <dd className="stat-num mt-1 text-2xl">{week.sessions}<span className="ml-1 text-sm font-medium text-fg-subtle">sessions</span></dd>
        </div>
        <div>
          <dt className="eyebrow">Minutes</dt>
          <dd className="stat-num mt-1 text-2xl">{week.minutes}</dd>
        </div>
        <div>
          <dt className="eyebrow">vs last week</dt>
          <dd className={`stat-num mt-1 text-2xl ${delta > 0 ? 'text-volt-ink' : delta < 0 ? 'text-fg-muted' : ''}`}>
            {delta === 0 ? 'even' : `${delta > 0 ? '+' : '−'}${formatMinutes(Math.abs(delta))}`}
          </dd>
        </div>
      </dl>
    </section>
  )
}
