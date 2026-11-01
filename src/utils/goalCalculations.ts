import { WorkoutSession, Goal, GoalProgress } from '@/types/workout'
import { periodMetrics, selectedQuarter } from '@/utils/goalPeriods'

export function calculateGoalProgress(goal: Goal, sessions: WorkoutSession[], now = new Date()): GoalProgress {
  const currentYear = goal.year
  const currentQuarter = selectedQuarter(currentYear, now)
  const quarter = periodMetrics(sessions, currentYear, currentQuarter, now)
  const year = periodMetrics(sessions, currentYear, undefined, now)
  const pair = (q: number, y: number) => ({ quarterToDate: q, yearToDate: y })
  return {
    currentQuarter, currentYear,
    actualWeightLifted: pair(quarter.weight, year.weight), actualMinutes: pair(quarter.minutes, year.minutes),
    actualSessions: pair(quarter.sessions, year.sessions),
    expectedWeightLifted: pair(goal.quarterlyWeightTarget * quarter.fraction, goal.annualWeightTarget * year.fraction),
    expectedMinutes: pair(goal.quarterlyMinutesTarget * quarter.fraction, goal.annualMinutesTarget * year.fraction),
    expectedSessions: pair(goal.quarterlySessionsTarget * quarter.fraction, goal.weeklySessionsTarget * 52 * year.fraction),
    sessionsNeededForQuarter: goal.minutesPerSession > 0 ? Math.ceil(Math.max(0, goal.quarterlyMinutesTarget - quarter.minutes) / goal.minutesPerSession) : 0,
    sessionsNeededForYear: goal.minutesPerSession > 0 ? Math.ceil(Math.max(0, goal.annualMinutesTarget - year.minutes) / goal.minutesPerSession) : 0,
    daysRemainingInQuarter: quarter.daysRemaining,
  }
}

export function createGoal(
  name: string,
  year: number,
  annualWeightTarget: number,
  minutesPerSession: number,
  weeklySessionsTarget: number
): Omit<Goal, 'id' | 'createdAt' | 'updatedAt'> {
  const weeklyMinutesTarget = minutesPerSession * weeklySessionsTarget

  return {
    name,
    year,
    annualWeightTarget,
    minutesPerSession,
    weeklySessionsTarget,
    weeklyMinutesTarget,
    annualMinutesTarget: weeklyMinutesTarget * 52,
    quarterlyWeightTarget: annualWeightTarget / 4,
    quarterlyMinutesTarget: (weeklyMinutesTarget * 52) / 4,
    quarterlySessionsTarget: weeklySessionsTarget * 13
  }
}