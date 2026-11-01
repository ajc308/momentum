import type { WorkoutSession } from '@/types/workout'
import { workoutDay, periodKeys, dayNumber } from '@/lib/calendar'
import { creditedMinutes, creditedMiles } from '@/utils/workoutTotals'

export function selectedQuarter(year: number, now = new Date()): number {
  const today = workoutDay(now)
  const thisYear = Number(today.slice(0, 4))
  return year < thisYear ? 4 : year > thisYear ? 1 : Math.floor((Number(today.slice(5, 7)) - 1) / 3) + 1
}
export function periodMetrics(sessions: WorkoutSession[], year: number, quarter?: number, now = new Date()) {
  const { start, end } = periodKeys(year, quarter)
  const selected = sessions.filter(s => { const day = workoutDay(s.date); return day >= start && day < end })
  const totalDays = dayNumber(end) - dayNumber(start)
  const elapsed = Math.max(0, Math.min(totalDays, dayNumber(workoutDay(now)) - dayNumber(start) + 1))
  return {
    sessions: selected.length, minutes: selected.reduce((sum, s) => sum + creditedMinutes(s), 0),
    miles: selected.reduce((sum, s) => sum + creditedMiles(s), 0),
    weight: selected.reduce((sum, s) => sum + (s.weightLifted ?? 0), 0),
    fraction: elapsed / totalDays,
    daysRemaining: Math.max(0, Math.min(totalDays, dayNumber(end) - Math.max(dayNumber(start), dayNumber(workoutDay(now))))),
  }
}
export function progressPercent(actual: number, target: number): number { return target > 0 ? actual / target * 100 : 0 }
