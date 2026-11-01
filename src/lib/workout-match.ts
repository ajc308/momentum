interface TimedWorkout {
  date: Date
  minutes: number
  activity: string
}

// Calendar-only manual entries historically use midnight or UTC noon.
// They provide no evidence of when a session actually took place.
function hasStartTime(date: Date): boolean {
  return Number.isFinite(date.getTime()) && !(
    [0, 12].includes(date.getUTCHours()) && date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0
  )
}

export function sameWorkout(a: TimedWorkout, b: TimedWorkout, echo = false): boolean {
  if (a.activity !== b.activity || a.minutes <= 0 || b.minutes <= 0 ||
      !hasStartTime(a.date) || !hasStartTime(b.date)) return false
  const startDifference = Math.abs(a.date.getTime() - b.date.getTime()) / 60_000
  if (startDifference > 10) return false
  if (!echo) return Math.abs(a.minutes - b.minutes) <= Math.max(3, a.minutes * 0.1)
  const overlap = Math.min(a.date.getTime() + a.minutes * 60_000, b.date.getTime() + b.minutes * 60_000) -
    Math.max(a.date.getTime(), b.date.getTime())
  return overlap >= Math.min(a.minutes, b.minutes) * 60_000 * 0.5
}

export function uniqueWorkoutMatch<T extends TimedWorkout>(rows: T[], workout: TimedWorkout, echo = false): T | undefined {
  const matches = rows.filter(row => sameWorkout(row, workout, echo))
  return matches.length === 1 ? matches[0] : undefined
}

export function matchingWindow(date: Date) {
  return { gte: new Date(date.getTime() - 10 * 60_000), lte: new Date(date.getTime() + 10 * 60_000) }
}
