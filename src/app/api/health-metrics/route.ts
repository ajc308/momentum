import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { parseWorkoutDate } from '@/lib/workout-date'

export const dynamic = 'force-dynamic'

const METRIC_NAME = /^[a-z0-9_]{1,64}$/
const MAX_NAMES = 20
const MAX_ROWS = 20000

// GET — daily Apple Health metrics (read-only), oldest first.
// Query params: since (YYYY-MM-DD, inclusive), names (comma-separated metric names).
export async function GET(request: Request) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult

  const url = new URL(request.url)
  const since = url.searchParams.get('since')
  const namesParam = url.searchParams.get('names')

  if (since && (!/^\d{4}-\d{2}-\d{2}$/.test(since) || !parseWorkoutDate(since))) {
    return NextResponse.json({ error: 'since must be a valid YYYY-MM-DD date' }, { status: 400 })
  }
  let names: string[] | null = null
  if (namesParam !== null) {
    names = [...new Set(namesParam.split(',').map(name => name.trim()).filter(Boolean))]
    if (names.length === 0 || names.length > MAX_NAMES || !names.every(name => METRIC_NAME.test(name))) {
      return NextResponse.json({ error: `names must be 1-${MAX_NAMES} comma-separated metric names` }, { status: 400 })
    }
  }

  try {
    const metrics = await prisma.healthMetric.findMany({
      where: {
        ...(names ? { name: { in: names } } : {}),
        ...(since ? { date: { gte: new Date(`${since}T00:00:00Z`) } } : {}),
      },
      orderBy: [{ date: 'asc' }, { name: 'asc' }],
      take: MAX_ROWS,
      select: { name: true, date: true, units: true, qty: true, min: true, avg: true, max: true },
    })
    return NextResponse.json({ metrics })
  } catch (error) {
    console.error('Health metrics fetch error:', error instanceof Error ? error.message : 'unknown')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
