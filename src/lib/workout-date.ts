/** Accept calendar dates or ISO timestamps with an explicit timezone. */
export function parseWorkoutDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null
  const parts = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.exec(value)
  if (!parts) return null
  const [, year, month, day, hours, minutes, seconds] = parts
  const calendar = new Date(`${year}-${month}-${day}T12:00:00Z`)
  if (Number.isNaN(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== `${year}-${month}-${day}`) return null
  if (hours !== undefined && (Number(hours) > 23 || Number(minutes) > 59 || Number(seconds) > 59)) return null
  const date = hours === undefined ? calendar : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}
