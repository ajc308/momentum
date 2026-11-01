import { NextResponse } from 'next/server'
import { parseWorkoutDate } from '@/lib/workout-date'
import prisma from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { logAudit } from '@/lib/audit-log'
import { logWeight, weightEntrySchema } from '@/lib/body-weight'

// POST — log a manual weigh-in. Body: { date: "YYYY-MM-DD", weightLbs, bodyFatPct? }.
// Logging again for the same date replaces that day's entry.
export async function POST(request: Request) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult

  const parsed = weightEntrySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Expected { date: YYYY-MM-DD, weightLbs: 50-1000, bodyFatPct?: 1-75, neckIn?: 8-30, waistIn?: 20-80, heightIn?: 48-96 }' }, { status: 400 })
  }
  try {
    const row = await logWeight(parsed.data)
    await logAudit(request, authResult, 'weight.log', { date: parsed.data.date })
    return NextResponse.json(row, { status: 201 })
  } catch (error) {
    console.error('Weight log error:', error instanceof Error ? error.message : 'unknown')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE — remove one weigh-in. Query param: id.
export async function DELETE(request: Request) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult

  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  const result = await prisma.bodyMeasurement.deleteMany({ where: { id } })
  if (!result.count) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await logAudit(request, authResult, 'weight.delete', { id })
  return NextResponse.json({ deleted: true })
}

// GET — body measurement history, optionally filtered by date range.
// Query params: from, to (ISO date strings, inclusive).
export async function GET(request: Request) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult

  try {
    const url = new URL(request.url)
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')

    const where: { date?: { gte?: Date; lte?: Date } } = {}
    if (from || to) {
      where.date = {}
      for (const value of [from, to]) {
        if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !parseWorkoutDate(value))) {
          return NextResponse.json({ error: 'from and to must be valid YYYY-MM-DD dates' }, { status: 400 })
        }
      }
      if (from && to && from > to) return NextResponse.json({ error: 'from must be on or before to' }, { status: 400 })
      if (from) where.date.gte = new Date(`${from}T00:00:00Z`)
      if (to) where.date.lte = new Date(`${to}T00:00:00Z`)
    }

    const measurements = await prisma.bodyMeasurement.findMany({
      where,
      orderBy: { date: 'asc' },
    })

    return NextResponse.json(measurements)
  } catch (error) {
    console.error('Body measurements fetch error:', error instanceof Error ? error.message : 'unknown')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
