// Display categories for workouts. Pure (no React) so libs and tests can use it.

export type Discipline = 'strength' | 'cycling' | 'walk' | 'run' | 'cardio' | 'stretch' | 'other'

export interface DisciplineInput {
  activity: string
  discipline?: string | null
  classTitle?: string | null
}

export const DISCIPLINES: Record<Discipline, { label: string; color: string }> = {
  strength: { label: 'Strength', color: '#E11D48' },
  cycling: { label: 'Cycling', color: '#0284C7' },
  walk: { label: 'Walk', color: '#B45309' },
  run: { label: 'Run', color: '#7C3AED' },
  cardio: { label: 'Cardio', color: '#C2410C' },
  stretch: { label: 'Stretch', color: '#0F766E' },
  other: { label: 'Other', color: '#64748B' },
}

function classify(value: string): Discipline | null {
  const v = value.toLowerCase()
  if (!v) return null
  if (/strength|weight/.test(v)) return 'strength'
  if (/cycl|bike|ride|spin/.test(v)) return 'cycling'
  if (/run|jog|tread/.test(v)) return 'run'
  if (/walk|hik/.test(v)) return 'walk'
  if (/stretch|yoga|mobility|meditat|pilates|barre/.test(v)) return 'stretch'
  if (/cardio|bootcamp|hiit|row|caesar|boxing|dance|swim|elliptical/.test(v)) return 'cardio'
  return null
}

/** Peloton's discipline wins, then the stored activity, then the class title. */
export function disciplineOf(w: DisciplineInput): Discipline {
  return classify(w.discipline ?? '') ?? classify(w.activity) ?? classify(w.classTitle ?? '') ?? 'other'
}

export function isStrength(w: DisciplineInput): boolean {
  return disciplineOf(w) === 'strength'
}

/** The class title is the primary label; the generic activity is only a fallback. */
export function workoutTitle(w: { activity: string; classTitle?: string | null }): string {
  return w.classTitle?.trim() || w.activity
}
