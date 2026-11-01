// This personal tracker uses New York (Eastern) days for timestamped workouts.
// BodyMeasurement dates are calendar labels stored at UTC midnight, not instants.
export const TRACKER_TIME_ZONE = 'America/New_York'
const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TRACKER_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
})
export function workoutDay(date: Date): string {
  const parts = formatter.formatToParts(date)
  const value = (type: string) => parts.find(p => p.type === type)!.value
  return `${value('year')}-${value('month')}-${value('day')}`
}
export function civilDate(key: string): Date {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, month - 1, day, 12)
}
export function workoutCalendarDate(date: Date): Date { return civilDate(workoutDay(date)) }
export function measurementCalendarDate(date: Date): Date { return civilDate(date.toISOString().slice(0, 10)) }
export function dayNumber(key: string): number { return Date.parse(`${key}T00:00:00Z`) / 86_400_000 }
export function periodKeys(year: number, quarter?: number) {
  const month = quarter ? (quarter - 1) * 3 : 0
  const key = (y: number, m: number) => `${y}-${String(m + 1).padStart(2, '0')}-01`
  const next = month + (quarter ? 3 : 12)
  return { start: key(year, month), end: key(year + Math.floor(next / 12), next % 12) }
}
/** Convert a tracker calendar midnight to an instant, including DST offsets. */
export function trackerMidnight(key: string): Date {
  const target = Date.parse(`${key}T00:00:00Z`)
  let instant = target
  const clock = new Intl.DateTimeFormat('en-CA', { timeZone: TRACKER_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
  for (let i = 0; i < 3; i++) {
    const parts = clock.formatToParts(new Date(instant))
    const get = (type: string) => Number(parts.find(p => p.type === type)!.value)
    const displayed = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
    instant += target - displayed
  }
  return new Date(instant)
}
export function yearRange(year: number) {
  const keys = periodKeys(year)
  return { gte: trackerMidnight(keys.start), lt: trackerMidnight(keys.end) }
}
