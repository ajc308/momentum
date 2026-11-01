// Pure training summaries for the dashboard (streaks, weeks, bests, totals).
// Days are LA calendar keys (YYYY-MM-DD) from workoutDay().

import { dayNumber, workoutDay } from '@/lib/calendar'

export interface TrainingWorkout {
  id: string
  date: Date
  minutes: number
  activity: string
  classTitle?: string | null
  instructor?: string | null
  calories?: number | null
  avgHeartRate?: number | null
}

export function shiftDay(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/** Monday of the week containing `key`. */
export function weekStart(key: string): string {
  const weekday = new Date(`${key}T00:00:00Z`).getUTCDay()
  return shiftDay(key, -((weekday + 6) % 7))
}

/** The 7 day keys (Mon..Sun) of the week `offset` weeks from the one containing `today`. */
export function weekDays(today: string, offset = 0): string[] {
  const monday = shiftDay(weekStart(today), offset * 7)
  return Array.from({ length: 7 }, (_, i) => shiftDay(monday, i))
}

export function groupByDay<T extends { date: Date }>(workouts: T[]): Map<string, T[]> {
  const days = new Map<string, T[]>()
  for (const workout of workouts) {
    const key = workoutDay(workout.date)
    const list = days.get(key)
    if (list) list.push(workout)
    else days.set(key, [workout])
  }
  for (const list of days.values()) list.sort((a, b) => a.date.getTime() - b.date.getTime())
  return days
}

/**
 * Consecutive active days ending today. A streak stays alive through today
 * until the day ends, so if today has no workout yet we count from yesterday.
 */
export function currentStreak(activeDays: Set<string>, today: string): { days: number; activeToday: boolean } {
  const activeToday = activeDays.has(today)
  let cursor = activeToday ? today : shiftDay(today, -1)
  let days = 0
  while (activeDays.has(cursor)) { days++; cursor = shiftDay(cursor, -1) }
  return { days, activeToday }
}

export function longestStreak(activeDays: Set<string>): number {
  const numbers = [...activeDays].map(dayNumber).sort((a, b) => a - b)
  let best = 0, run = 0
  for (let i = 0; i < numbers.length; i++) {
    run = i > 0 && numbers[i] - numbers[i - 1] === 1 ? run + 1 : 1
    best = Math.max(best, run)
  }
  return best
}

export function sumWindow(workouts: TrainingWorkout[], from: string, to: string) {
  let sessions = 0, minutes = 0
  for (const w of workouts) {
    const key = workoutDay(w.date)
    if (key >= from && key <= to) { sessions++; minutes += w.minutes }
  }
  return { sessions, minutes }
}

export function yearTotals(workouts: TrainingWorkout[], year: number) {
  const prefix = `${year}-`
  let sessions = 0, minutes = 0, calories = 0
  const days = new Set<string>()
  for (const w of workouts) {
    const key = workoutDay(w.date)
    if (!key.startsWith(prefix)) continue
    sessions++
    minutes += w.minutes
    calories += w.calories ?? 0
    days.add(key)
  }
  return { sessions, minutes, calories, activeDays: days.size }
}

export function topInstructors(workouts: TrainingWorkout[], year: number, count = 3) {
  const prefix = `${year}-`
  const tally = new Map<string, { name: string; sessions: number; minutes: number }>()
  for (const w of workouts) {
    const name = w.instructor?.trim()
    if (!name || !workoutDay(w.date).startsWith(prefix)) continue
    const entry = tally.get(name) ?? { name, sessions: 0, minutes: 0 }
    entry.sessions++
    entry.minutes += w.minutes
    tally.set(name, entry)
  }
  return [...tally.values()].sort((a, b) => b.sessions - a.sessions || b.minutes - a.minutes).slice(0, count)
}

function maxBy<T>(items: T[], value: (item: T) => number | null | undefined): T | null {
  let best: T | null = null
  let bestValue = -Infinity
  for (const item of items) {
    const v = value(item)
    if (v != null && v > bestValue) { best = item; bestValue = v }
  }
  return best
}

export function personalBests<T extends TrainingWorkout>(workouts: T[]) {
  return {
    longest: maxBy(workouts, w => w.minutes),
    mostCalories: maxBy(workouts, w => w.calories),
    highestAvgHr: maxBy(workouts, w => w.avgHeartRate),
  }
}
