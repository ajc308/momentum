import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { workoutDay } from '@/lib/calendar'
import { buildPlan } from '@/lib/planner'
import { withCatalogClasses } from '@/lib/plan-classes'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET: the 7-day plan with classes picked from Peloton's library (the dashboard's plan card).
export async function GET(request: Request) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult
  const rows = await prisma.workoutSession.findMany({
    where: { deletedAt: null },
    select: { date: true, activity: true, discipline: true, classTitle: true, instructor: true, minutes: true, pelotonWorkoutId: true },
  })
  return NextResponse.json(await withCatalogClasses(buildPlan(rows, workoutDay(new Date()))))
}
