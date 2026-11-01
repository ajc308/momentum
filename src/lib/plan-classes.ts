// Swap the plan's history-based class suggestions for real classes from
// Peloton's library (newest first, favorite instructor first), so the plan
// names classes you can stack and take today. Server-only.

import { daySummary, findNextWorkout, type ClassSuggestion, type PlanDay, type TrainingPlan } from '@/lib/planner'
import { findClasses } from '@/lib/peloton-catalog'

export async function withCatalogClasses(plan: TrainingPlan): Promise<TrainingPlan> {
  const used = new Set<string>()
  const mainMinutes = Math.max(10, plan.prefs.sessionMinutes - 10)
  const days: PlanDay[] = []
  // Sequential so a focus that repeats in the week gets a different class.
  for (const day of plan.days) {
    const suggestions: ClassSuggestion[] = []
    for (const s of day.suggestions) {
      const target = s.role === 'main' ? day.focus : 'core'
      const minutes = s.role === 'main' ? mainMinutes : Math.min(10, s.minutes)
      const pick = target ? (await findClasses(target, minutes, 1, used).catch(() => []))[0] : undefined
      if (!pick) { suggestions.push(s); continue }
      used.add(pick.rideId)
      suggestions.push({
        role: s.role, title: pick.title, instructor: pick.instructor, minutes: pick.minutes,
        pelotonWorkoutId: null, rideId: pick.rideId, url: pick.url, airedAt: pick.airedAt,
      })
    }
    const updated = { ...day, suggestions }
    days.push({ ...updated, summary: daySummary(updated) })
  }
  return { ...plan, days, nextWorkout: findNextWorkout(days) }
}
