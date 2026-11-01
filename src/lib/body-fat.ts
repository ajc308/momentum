/**
 * US Navy circumference method (male equation), inches:
 * 86.010·log10(waist − neck) − 70.041·log10(height) + 36.76.
 * Typically within ~3–4% of DEXA; best for tracking trends. Pure, so the
 * Body page can preview it while you type.
 */
export function navyBodyFatPct(neckIn: number, waistIn: number, heightIn: number): number | null {
  if (!(waistIn > neckIn) || heightIn <= 0) return null
  const pct = 86.010 * Math.log10(waistIn - neckIn) - 70.041 * Math.log10(heightIn) + 36.76
  return pct >= 2 && pct <= 60 ? Math.round(pct * 10) / 10 : null
}
