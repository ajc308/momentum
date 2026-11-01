import { logAudit } from '@/lib/audit-log'
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { goalInput } from '@/lib/goal-input'
import { createGoal } from '@/utils/goalCalculations'

// GET /api/goals - Fetch all goals
export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult

  try {
    const goals = await prisma.goal.findMany({
      orderBy: { createdAt: 'desc' }
    })
    
    return NextResponse.json({ goals })
  } catch (error) {
    console.error('Error fetching goals:', error)
    return NextResponse.json(
      { error: 'Failed to fetch goals' },
      { status: 500 }
    )
  }
}

// Derived targets are calculated from the validated base fields in one place.
export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult
  try {
    const parsed = goalInput.safeParse(await request.json())
    if (!parsed.success) return NextResponse.json({ error: 'Invalid goal fields', details: parsed.error.issues }, { status: 400 })
    const data = parsed.data
    const goal = await prisma.goal.create({ data: createGoal(data.name, data.year, data.annualWeightTarget, data.minutesPerSession, data.weeklySessionsTarget) })
    await logAudit(request, authResult, 'goal.create', { id: goal.id, year: goal.year })
    return NextResponse.json({ goal }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create goal' }, { status: error instanceof SyntaxError ? 400 : 500 })
  }
}

export async function PUT(request: NextRequest) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult
  try {
    const body = await request.json()
    if (!body || typeof body.id !== 'string' || !body.id.trim()) return NextResponse.json({ error: 'Goal ID is required' }, { status: 400 })
    const parsed = goalInput.partial().safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: 'Invalid goal fields', details: parsed.error.issues }, { status: 400 })
    const goal = await prisma.$transaction(async tx => {
      // Serialize read/merge/update so concurrent partial edits preserve omitted fields.
      await tx.$executeRaw`SELECT id FROM goals WHERE id = ${body.id} FOR UPDATE`
      const existing = await tx.goal.findUnique({ where: { id: body.id } })
      if (!existing) return null
      const data = { ...existing, ...parsed.data }
      const validated = goalInput.parse(data)
      return tx.goal.update({ where: { id: body.id }, data: createGoal(validated.name, validated.year,
        validated.annualWeightTarget, validated.minutesPerSession, validated.weeklySessionsTarget) })
    })
    if (!goal) return NextResponse.json({ error: 'Goal not found' }, { status: 404 })
    await logAudit(request, authResult, 'goal.update', { id: goal.id, fields: Object.keys(parsed.data) })
    return NextResponse.json({ goal })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update goal' }, { status: error instanceof SyntaxError ? 400 : 500 })
  }
}
