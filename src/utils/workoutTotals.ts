import type { WorkoutSession } from '@/types/workout'
export const creditedMiles = (session: WorkoutSession): number => session.adjustedMiles ?? session.miles ?? 0
export const creditedMinutes = (session: WorkoutSession): number => session.adjustedMinutes ?? session.minutes ?? 0
