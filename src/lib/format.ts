// Small display formatters shared by the UI.

export function formatNumber(value: number, digits = 0): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits })
}

/** 45 -> "45 min", 135 -> "2h 15m" */
export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} min`
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return m ? `${h}h ${String(m).padStart(2, '0')}m` : `${h}h`
}

export function formatHours(minutes: number): string {
  return formatNumber(minutes / 60, minutes < 600 ? 1 : 0)
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${formatNumber(count)} ${count === 1 ? one : many}`
}

