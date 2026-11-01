// Adaptive training plan. Pure: recomputed from workout history every time,
// so a skipped day is never "lost" — whatever was missed stays the most
// overdue focus and moves onto the next available day.

import { dayNumber, workoutDay } from '@/lib/calendar'
import { disciplineOf, isStrength, workoutTitle, type DisciplineInput } from '@/lib/disciplines'
import { directMuscleGroups, type MuscleGroup } from '@/lib/muscle-groups'
import { shiftDay, weekStart } from '@/lib/training'

export interface PlanPrefs {
  strengthDaysPerWeek: number
  sessionMinutes: number
  walksPerWeek: number
  horizonDays: number
}

// Andrew's preferences: 3 strength days, ~30 min, one walk, other days rest.
export const PLAN_PREFS: PlanPrefs = { strengthDaysPerWeek: 3, sessionMinutes: 30, walksPerWeek: 1, horizonDays: 7 }

export type Focus = 'chest_back' | 'arms_shoulders' | 'legs'

export const FOCUSES: Record<Focus, { label: string; groups: MuscleGroup[] }> = {
  chest_back: { label: 'Chest & Back', groups: ['chest', 'back'] },
  arms_shoulders: { label: 'Arms & Shoulders', groups: ['arms', 'shoulders'] },
  legs: { label: 'Glutes & Legs', groups: ['legs'] },
}
const FOCUS_ORDER: Focus[] = ['legs', 'chest_back', 'arms_shoulders']
// Core rides along: a finisher on strength days, stacked onto other days once it's this many days since the last core class.
const CORE_EVERY_DAYS = 2

export interface PlanWorkout extends DisciplineInput {
  date: Date
  minutes: number
  instructor?: string | null
  pelotonWorkoutId?: string | null
}

export interface ClassSuggestion {
  /** "main" is the day's focus class; "core" is the stacked core class. */
  role: 'main' | 'core'
  title: string
  instructor: string | null
  minutes: number
  /** The past Peloton workout this class came from (used to stack it); null for generic suggestions. */
  pelotonWorkoutId: string | null
  /** Set when the class was picked from Peloton's library (src/lib/plan-classes.ts). */
  rideId?: string | null
  url?: string | null
  airedAt?: string | null
}

export interface PlanDay {
  day: string // YYYY-MM-DD, tracker time zone
  status: 'done' | 'strength' | 'walk' | 'rest'
  isToday: boolean
  focus: Focus | null
  title: string
  reason: string
  /** A few words for compact displays, e.g. "18 days since". */
  detail: string
  /** Main class and core finisher picked from your own history. */
  suggestions: ClassSuggestion[]
  /** Class titles already done that day (today only). */
  completed: string[]
  /** One line for assistants and notifications, e.g. "Sun Nov 1 — Glutes & Legs + Core (~30 min): 1) … 2) …". */
  summary: string
}

export interface TrainingPlan {
  today: string
  prefs: PlanPrefs
  days: PlanDay[]
  /** Set when yesterday's planned strength day was skipped. */
  adapted: string | null
  /** The first upcoming day with something to do (not rest, not already done). */
  nextWorkout: PlanDay | null
}

/** The focus a class title trains, if it's one of the plan's three. */
export function classFocus(title: string): Focus | null {
  const groups = new Set(directMuscleGroups(title))
  if (groups.has('legs')) return 'legs'
  if (groups.has('chest') || groups.has('back')) return 'chest_back'
  if (groups.has('arms') || groups.has('shoulders')) return 'arms_shoulders'
  return null
}

function weekdayName(day: string) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })
}

function daysAgoText(days: number | null) {
  if (days == null) return 'not in your recent classes'
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

function classPicker(history: PlanWorkout[], role: ClassSuggestion['role']) {
  const recentFirst = [...history].sort((a, b) => b.date.getTime() - a.date.getTime())
  return (match: (w: PlanWorkout, title: string) => boolean, target: number): ClassSuggestion | null => {
    let best: PlanWorkout | null = null
    for (const w of recentFirst) {
      const title = workoutTitle(w)
      if (!w.classTitle || !match(w, title)) continue
      if (!best || Math.abs(w.minutes - target) < Math.abs(best.minutes - target)) best = w
      if (best && Math.abs(best.minutes - target) === 0) break
    }
    return best
      ? { role, title: best.classTitle!, instructor: best.instructor ?? null, minutes: best.minutes, pelotonWorkoutId: best.pelotonWorkoutId ?? null }
      : null
  }
}

const isCoreClass = (w: PlanWorkout, title: string) =>
  isStrength(w) && directMuscleGroups(title).includes('core') && classFocus(title) == null

/** A core class from history, closest to `minutes` (generic title if none). */
function coreClass(history: PlanWorkout[], minutes = 10): ClassSuggestion {
  return classPicker(history, 'core')(isCoreClass, minutes) ?? { role: 'core', title: `${minutes} min Core Strength`, instructor: null, minutes, pelotonWorkoutId: null }
}

function suggestClasses(history: PlanWorkout[], focus: Focus, prefs: PlanPrefs): ClassSuggestion[] {
  const mainTarget = Math.max(10, prefs.sessionMinutes - 10)
  const pick = classPicker(history, 'main')
  const main = pick((w, title) => isStrength(w) && classFocus(title) === focus, mainTarget)
    ?? { role: 'main' as const, title: `${mainTarget} min ${FOCUSES[focus].label} Strength`, instructor: null, minutes: mainTarget, pelotonWorkoutId: null }
  // Core finisher fills the rest of the session, capped at 10 minutes.
  const finisherMinutes = Math.min(10, prefs.sessionMinutes - main.minutes)
  return finisherMinutes >= 5 ? [main, coreClass(history, finisherMinutes)] : [main]
}

export function buildPlan(workouts: PlanWorkout[], today: string, prefs: PlanPrefs = PLAN_PREFS, detectSkip = true): TrainingPlan {
  const todayNumber = dayNumber(today)
  const history = workouts.filter(w => dayNumber(workoutDay(w.date)) <= todayNumber)

  // Latest day each muscle group was targeted by name (full body excluded).
  const lastTargeted = new Map<MuscleGroup, number>()
  const strengthDays = new Set<number>()
  const walkDays = new Set<number>()
  for (const w of history) {
    const n = dayNumber(workoutDay(w.date))
    if (isStrength(w)) {
      strengthDays.add(n)
      for (const g of directMuscleGroups(workoutTitle(w))) lastTargeted.set(g, Math.max(lastTargeted.get(g) ?? -Infinity, n))
    } else if (['walk', 'run', 'cycling', 'cardio'].includes(disciplineOf(w))) {
      walkDays.add(n)
    }
  }
  let lastStrength = Math.max(-Infinity, ...[...strengthDays])
  let lastFocus: Focus | null = null
  const latestStrength = history.filter(isStrength).sort((a, b) => b.date.getTime() - a.date.getTime())
  for (const w of latestStrength) { lastFocus = classFocus(workoutTitle(w)); if (lastFocus) break }

  const planned = new Map<number, 'strength' | 'walk'>()
  const plannedFocus = new Set<Focus>()
  const countInWeek = (set: Set<number>, kind: 'strength' | 'walk', day: string) => {
    const start = dayNumber(weekStart(day))
    let n = 0
    for (let d = start; d < start + 7; d++) if (set.has(d) || planned.get(d) === kind) n++
    return n
  }

  const days: Array<Omit<PlanDay, 'summary'>> = []
  for (let i = 0; i < prefs.horizonDays; i++) {
    const day = shiftDay(today, i)
    const n = dayNumber(day)
    const isToday = i === 0
    const doneToday = isToday ? history.filter(w => workoutDay(w.date) === today) : []

    const coreGap = () => n - (lastTargeted.get('core') ?? -Infinity)

    if (isToday && strengthDays.has(n)) {
      const stackCore = coreGap() >= CORE_EVERY_DAYS
      days.push({
        day, status: 'done', isToday, focus: null, title: 'Done',
        reason: stackCore ? 'Strength done today. Core is due — stack a 10 min core class if you have it in you.' : 'Strength done today — nice.',
        detail: `${doneToday.length} ${doneToday.length === 1 ? 'class' : 'classes'} today`,
        suggestions: stackCore ? [coreClass(history)] : [], completed: doneToday.map(workoutTitle),
      })
      if (stackCore) lastTargeted.set('core', n)
      continue
    }

    const needed = prefs.strengthDaysPerWeek - countInWeek(strengthDays, 'strength', day)
    const daysLeftInWeek = 7 - (n - dayNumber(weekStart(day)))
    const gap = n - lastStrength
    const doStrength = needed > 0 && gap >= 1 && (gap >= 2 || needed >= daysLeftInWeek)

    if (doStrength) {
      const score = (f: Focus) => Math.min(...FOCUSES[f].groups.map(g => n - (lastTargeted.get(g) ?? -Infinity)))
      const focus = [...FOCUS_ORDER]
        .filter(f => f !== lastFocus)
        .sort((a, b) => score(b) - score(a))[0]
      const lastDone = Math.max(...FOCUSES[focus].groups.map(g => lastTargeted.get(g) ?? -Infinity))
      const reason = plannedFocus.has(focus)
        ? 'Next in the rotation.'
        : Number.isFinite(lastDone)
          ? `${FOCUSES[focus].label} last targeted ${daysAgoText(todayNumber - lastDone)}.`
          : `${FOCUSES[focus].label} is ${daysAgoText(null)}.`
      const ago = todayNumber - lastDone
      const detail = plannedFocus.has(focus) ? 'Next in rotation'
        : !Number.isFinite(lastDone) ? 'Not done lately'
          : ago === 0 ? 'Trained today' : `${ago} ${ago === 1 ? 'day' : 'days'} since`
      const suggestions = suggestClasses(history, focus, prefs)
      const withCore = suggestions.length > 1
      days.push({
        day, status: 'strength', isToday, focus, title: withCore ? `${FOCUSES[focus].label} + Core` : FOCUSES[focus].label,
        reason, detail, suggestions, completed: doneToday.map(workoutTitle),
      })
      if (withCore) lastTargeted.set('core', n)
      plannedFocus.add(focus)
      planned.set(n, 'strength')
      for (const g of FOCUSES[focus].groups) lastTargeted.set(g, n)
      lastStrength = n
      lastFocus = focus
      continue
    }

    const walkNeeded = prefs.walksPerWeek - countInWeek(walkDays, 'walk', day) > 0
    if (isToday && walkDays.has(n)) {
      days.push({ day, status: 'done', isToday, focus: null, title: 'Active day', reason: 'You already moved today.', detail: 'Moved today', suggestions: [], completed: doneToday.map(workoutTitle) })
    } else if (walkNeeded) {
      planned.set(n, 'walk')
      // Stack core onto the walk day when it's due.
      const stackCore = coreGap() >= CORE_EVERY_DAYS
      days.push({
        day, status: 'walk', isToday, focus: null, title: stackCore ? 'Walk + Core' : 'Walk',
        reason: stackCore ? 'Active recovery walk, plus core since it’s due.' : 'Active recovery — an easy outdoor walk.',
        detail: stackCore ? 'Core due' : 'Easy & outdoors',
        suggestions: stackCore ? [coreClass(history)] : [], completed: [],
      })
      if (stackCore) lastTargeted.set('core', n)
    } else {
      days.push({ day, status: 'rest', isToday, focus: null, title: 'Rest', reason: 'Recovery day.', detail: 'Recover', suggestions: [], completed: [] })
    }
  }

  let adapted: string | null = null
  if (detectSkip) {
    const yesterday = shiftDay(today, -1)
    const before = workouts.filter(w => dayNumber(workoutDay(w.date)) < dayNumber(yesterday))
    const wasPlanned = buildPlan(before, yesterday, prefs, false).days[0]
    const trainedYesterday = history.some(w => workoutDay(w.date) === yesterday && isStrength(w))
    if (wasPlanned.status === 'strength' && wasPlanned.focus && !trainedYesterday) {
      const moved = days.find(d => d.focus === wasPlanned.focus)
      adapted = moved
        ? `Yesterday's ${FOCUSES[wasPlanned.focus].label} didn't happen, so it moved to ${moved.isToday ? 'today' : weekdayName(moved.day)}.`
        : `Yesterday's ${FOCUSES[wasPlanned.focus].label} didn't happen; the week has been rebalanced.`
    }
  }

  const finished: PlanDay[] = days.map(d => ({ ...d, summary: daySummary(d) }))
  return { today, prefs, days: finished, adapted, nextWorkout: findNextWorkout(finished) }
}

/** The first upcoming day with something to do (not rest, not already done unless a stack is suggested). */
export function findNextWorkout(days: PlanDay[]): PlanDay | null {
  return days.find(d => d.status === 'strength' || d.status === 'walk' || (d.status === 'done' && d.suggestions.length > 0)) ?? null
}

export function daySummary(d: Omit<PlanDay, 'summary'>): string {
  const label = `${d.isToday ? 'Today' : weekdayName(d.day).slice(0, 3)} ${new Date(`${d.day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`
  const aired = (s: ClassSuggestion) => s.airedAt
    ? `, aired ${new Date(s.airedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })}`
    : ''
  const classes = d.suggestions.map((s, i) =>
    `${i + 1}) ${s.title}${s.instructor ? ` with ${s.instructor}` : ''} (${s.minutes} min${s.role === 'core' ? ', core' : ''}${aired(s)})`)
  const minutes = d.suggestions.reduce((sum, s) => sum + s.minutes, 0)
  if (d.status === 'rest') return `${label} — Rest.`
  if (d.status === 'done') {
    return `${label} — Done: ${d.completed.join(', ')}.${classes.length ? ` Optional stack: ${classes.join(' ')}` : ''}`
  }
  if (d.status === 'walk') return `${label} — ${d.title}: easy outdoor walk${classes.length ? `, then ${classes.join(' ')}` : ''}.`
  return `${label} — ${d.title} (~${minutes} min): ${classes.join(' ')}. ${d.reason}`
}
