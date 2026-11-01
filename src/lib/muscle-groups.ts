// Derive muscle groups from Peloton strength class titles, e.g.
// "20 min Chest & Back Strength" -> chest, back. Pure, no React.

import { dayNumber, workoutDay } from '@/lib/calendar'
import { isStrength, workoutTitle, type DisciplineInput } from '@/lib/disciplines'
import { weekStart } from '@/lib/training'

export const MUSCLE_GROUPS = ['chest', 'back', 'shoulders', 'arms', 'core', 'legs'] as const
export type MuscleGroup = (typeof MUSCLE_GROUPS)[number]

export const MUSCLE_GROUP_LABELS: Record<MuscleGroup, string> = {
  chest: 'Chest', back: 'Back', shoulders: 'Shoulders', arms: 'Arms', core: 'Core', legs: 'Legs & Glutes',
}

const UPPER: MuscleGroup[] = ['chest', 'back', 'shoulders', 'arms']

// Specific keywords: a title naming these targets them directly.
const DIRECT: Array<[RegExp, MuscleGroup[]]> = [
  [/\b(chest|pecs?)\b/, ['chest']],
  [/\b(back|lats?)\b/, ['back']],
  [/\b(shoulders?|delts?|deltoids?)\b/, ['shoulders']],
  [/\b(arms?|biceps?|triceps?)\b/, ['arms']],
  [/\b(core|abs|abdominals?|obliques?)\b/, ['core']],
  [/\b(legs?|glutes?|quads?|hamstrings?|calves|hips?)\b/, ['legs']],
  [/\blower[\s-]?body\b/, ['legs']],
  [/\bupper[\s-]?body\b/, UPPER],
  [/\bpush\b/, ['chest', 'shoulders', 'arms']],
  [/\bpull\b/, ['back', 'arms']],
]
// Broad keywords: a whole-body class counts toward every group.
const FULL_BODY = /\b(full|total)[\s-]?body\b/
const BODYWEIGHT = /\bbody[\s-]?weight\b/

function ordered(set: Set<MuscleGroup>): MuscleGroup[] {
  return MUSCLE_GROUPS.filter(group => set.has(group))
}

/** Groups the title names explicitly (no full-body expansion). */
export function directMuscleGroups(title: string | null | undefined): MuscleGroup[] {
  const text = (title ?? '').toLowerCase()
  const hits = new Set<MuscleGroup>()
  for (const [pattern, groups] of DIRECT) if (pattern.test(text)) groups.forEach(g => hits.add(g))
  return ordered(hits)
}

/**
 * Every group a class works. "Full Body" (and a plain "Bodyweight" class
 * with no region named) counts for all groups; "Upper Body" for chest,
 * back, shoulders and arms. Unrecognized titles return [].
 */
export function muscleGroupsForTitle(title: string | null | undefined): MuscleGroup[] {
  const text = (title ?? '').toLowerCase()
  const direct = directMuscleGroups(text)
  if (FULL_BODY.test(text) || (BODYWEIGHT.test(text) && direct.length === 0)) return [...MUSCLE_GROUPS]
  return direct
}

export interface MuscleWorkout extends DisciplineInput {
  date: Date
}

export interface MuscleGroupStat {
  group: MuscleGroup
  label: string
  /**
   * LA calendar day of the latest class that targeted this group by name
   * ("Chest & Back"). Full-body classes don't count here, so one full-body
   * class doesn't make every group look freshly trained.
   */
  lastDay: string | null
  daysSince: number | null
  /** Days since any class worked this group, including full-body ones. */
  daysSinceAny: number | null
  count30: number
  count90: number
  /** Sessions per Monday-start week, oldest first; the last entry is the current (partial) week. */
  weekly: number[]
  /** Average sessions per week over the completed weeks in `weekly`. */
  perWeek: number
  /** Most recent class title that named this group directly (falls back to any hit). */
  example: string | null
}

/**
 * Per-group recency and rhythm for strength workouts.
 * `today` is an LA calendar day (YYYY-MM-DD); `weeks` is how many completed
 * weeks feed the per-week average.
 */
export function muscleGroupStats(workouts: MuscleWorkout[], today: string, weeks = 8): MuscleGroupStat[] {
  const todayNumber = dayNumber(today)
  const currentWeek = dayNumber(weekStart(today))
  const stats = new Map<MuscleGroup, MuscleGroupStat & { exampleDirect: boolean }>(MUSCLE_GROUPS.map(group => [group, {
    group, label: MUSCLE_GROUP_LABELS[group], lastDay: null, daysSince: null, daysSinceAny: null, count30: 0, count90: 0,
    weekly: Array(weeks + 1).fill(0), perWeek: 0, example: null, exampleDirect: false,
  }]))

  const sorted = workouts.filter(isStrength).sort((a, b) => b.date.getTime() - a.date.getTime())
  for (const workout of sorted) {
    const title = workoutTitle(workout)
    const groups = muscleGroupsForTitle(title)
    if (groups.length === 0) continue
    const direct = new Set(directMuscleGroups(title))
    const day = workoutDay(workout.date)
    const age = todayNumber - dayNumber(day)
    if (age < 0) continue
    const weekIndex = weeks - Math.floor((currentWeek - dayNumber(weekStart(day))) / 7)
    for (const group of groups) {
      const stat = stats.get(group)!
      if (stat.daysSinceAny == null) stat.daysSinceAny = age
      if (!stat.lastDay && direct.has(group)) { stat.lastDay = day; stat.daysSince = age }
      if (age < 30) stat.count30++
      if (age < 90) stat.count90++
      if (weekIndex >= 0) stat.weekly[weekIndex]++
      if (!stat.example || (!stat.exampleDirect && direct.has(group))) {
        stat.example = title
        stat.exampleDirect = direct.has(group)
      }
    }
  }

  return MUSCLE_GROUPS.map(group => {
    const { exampleDirect: _ignored, ...stat } = stats.get(group)!
    void _ignored
    const completed = stat.weekly.slice(0, weeks)
    return { ...stat, perWeek: weeks > 0 ? completed.reduce((sum, n) => sum + n, 0) / weeks : 0 }
  })
}

/** Most overdue groups first by last targeted class: never targeted, then longest since, then fewest recent sessions. */
export function upNext(stats: MuscleGroupStat[], count = 2): MuscleGroupStat[] {
  return [...stats].sort((a, b) => {
    const da = a.daysSince ?? Infinity
    const db = b.daysSince ?? Infinity
    if (da !== db) return db - da
    return a.count30 - b.count30
  }).slice(0, count)
}
