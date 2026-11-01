import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { yearRange } from '@/lib/calendar'
import { parseWorkoutDate } from '@/lib/workout-date'
import { logAudit } from '@/lib/audit-log'
import type { WorkoutSession as StoredWorkout } from '@prisma/client'

export const dynamic = 'force-dynamic'

type WorkoutWrite = Pick<StoredWorkout, 'date' | 'source' | 'activity' | 'minutes' | 'miles' | 'weightLifted' | 'notes'>

function replayResponse(existing: StoredWorkout, data: WorkoutWrite) {
  if (existing.deletedAt) return NextResponse.json({ error: 'This workout was deleted' }, { status: 409 })
  const matches = existing.date.getTime() === data.date.getTime() &&
    (Object.keys(data) as Array<keyof WorkoutWrite>).filter(key => key !== 'date').every(key => existing[key] === data[key])
  if (!matches) return NextResponse.json({ error: 'This save request already logged a different workout' }, { status: 409 })
  return NextResponse.json({ workout: existing })
}

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult

  try {
    const { searchParams } = new URL(request.url)
    const yearParam = searchParams.get('year')

    // Build optional year filter + always exclude soft-deleted rows
    // (set by /api/admin/dedupe-workouts and MCP delete_workout).
    const where: { date?: { gte: Date; lt: Date }; deletedAt: null } = { deletedAt: null }
    if (yearParam) {
      const year = Number(yearParam)
      if (Number.isInteger(year) && year >= 2020 && year <= 2100) {
        where.date = yearRange(year)
      } else {
        return NextResponse.json({ error: 'year must be an integer between 2020 and 2100' }, { status: 400 })
      }
    }

    console.log('📊 Fetching workouts from database...', yearParam ? `(year=${yearParam})` : '(all)');
    
    // Fetch workout sessions from database
    const workouts = await prisma.workoutSession.findMany({
      where,
      orderBy: {
        date: 'desc'
      }
    })
    
    console.log(`✅ Found ${workouts.length} workouts`)
    
    // Transform to match frontend expectations
    const transformedWorkouts = workouts.map(workout => ({
      id: workout.id,
      date: workout.date,
      source: workout.source,
      activity: workout.activity,
      minutes: workout.minutes,
      miles: workout.miles,
      weightLifted: workout.weightLifted,
      notes: workout.notes,
      discipline: workout.discipline,
      classTitle: workout.classTitle,
      instructor: workout.instructor,
      calories: workout.calories,
      avgHeartRate: workout.avgHeartRate,
      maxHeartRate: workout.maxHeartRate,
      totalOutputKj: workout.totalOutputKj,
      createdAt: workout.createdAt,
      updatedAt: workout.updatedAt
    }))

    return NextResponse.json({ workouts: transformedWorkouts })
  } catch (error) {
    console.error('Error fetching workouts:', error instanceof Error ? error.message : 'unknown')
    return NextResponse.json(
      { error: 'Failed to fetch workouts' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult
  const key = request.headers.get('Idempotency-Key')
  let requestedData: WorkoutWrite | undefined

  try {
    const body = await request.json()
    console.log('💪 Creating new workout (source=%s, activity=%s)', body?.source, body?.activity)
    
    // Validate required fields
    const { date, source, activity, minutes, miles, weightLifted, notes } = body
    
    if (!date || !source || !activity || minutes === undefined) {
      return NextResponse.json(
        { error: 'Missing required fields: date, source, activity, minutes' },
        { status: 400 }
      )
    }

    const parsedMinutes = parseInt(minutes)
    if (isNaN(parsedMinutes) || parsedMinutes < 0 || parsedMinutes > 1440) {
      return NextResponse.json(
        { error: 'minutes must be between 0 and 1440' },
        { status: 400 }
      )
    }
    if (miles !== undefined && miles !== null) {
      const parsedMiles = parseFloat(miles)
      if (isNaN(parsedMiles) || parsedMiles < 0 || parsedMiles > 500) {
        return NextResponse.json(
          { error: 'miles must be between 0 and 500' },
          { status: 400 }
        )
      }
    }
    if (weightLifted !== undefined && weightLifted !== null) {
      const parsedWeight = parseFloat(weightLifted)
      if (isNaN(parsedWeight) || parsedWeight < 0 || parsedWeight > 200000) {
        return NextResponse.json(
          { error: 'weightLifted must be between 0 and 200000' },
          { status: 400 }
        )
      }
    }

    // Create workout in database
    // Parse date - handle both ISO timestamps and date-only strings
    const workoutDate = parseWorkoutDate(date)
    if (!workoutDate) return NextResponse.json({ error: 'Invalid workout date' }, { status: 400 })
    if (key && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) {
      return NextResponse.json({ error: 'Invalid Idempotency-Key' }, { status: 400 })
    }
    // A stable client-generated UUID maps retries to one existing primary key.
    // This needs no schema migration and works across server instances.
    const retryId = key ? `manual_${key.toLowerCase()}` : undefined
    requestedData = {
      date: workoutDate, source, activity, minutes: parsedMinutes,
      miles: miles == null ? null : parseFloat(miles),
      weightLifted: weightLifted == null ? null : parseFloat(weightLifted),
      notes: notes || null,
    }
    if (retryId) {
      const existing = await prisma.workoutSession.findUnique({ where: { id: retryId } })
      if (existing) return replayResponse(existing, requestedData)
    }
    const newWorkout = await prisma.workoutSession.create({
      data: {
        id: retryId,
        ...requestedData,
      }
    })
    
    console.log('✅ Workout created successfully:', newWorkout.id)
    await logAudit(request, authResult, 'workout.create', { id: newWorkout.id })
    
    return NextResponse.json({ workout: newWorkout }, { status: 201 })
  } catch (error) {
    // A concurrent retry may have committed between findUnique and create.
    if (key && requestedData && error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
      const existing = await prisma.workoutSession.findUnique({ where: { id: `manual_${key.toLowerCase()}` } })
      if (existing) return replayResponse(existing, requestedData)
    }
    console.error('Error creating workout:', error instanceof Error ? error.message : 'unknown')
    
    // Handle duplicate entry errors
    if (error instanceof Error && error.message.includes('Unique constraint')) {
      return NextResponse.json(
        { error: 'Workout already exists for this date and activity' },
        { status: 409 }
      )
    }
    
    return NextResponse.json(
      { error: 'Failed to create workout' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult

  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    
    if (!id) {
      return NextResponse.json(
        { error: 'Workout ID is required' },
        { status: 400 }
      )
    }
    
    console.log('🗑️ Deleting workout:', id)
    
    const deleted = await prisma.workoutSession.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    })
    if (!deleted.count && !await prisma.workoutSession.findUnique({ where: { id } })) {
      return NextResponse.json({ error: 'Workout not found' }, { status: 404 })
    }
    if (deleted.count) await logAudit(request, authResult, 'workout.delete', { id })
    
    console.log('✅ Workout deleted successfully')
    
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting workout:', error instanceof Error ? error.message : 'unknown')
    return NextResponse.json(
      { error: 'Failed to delete workout' },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult

  try {
    const body = await request.json()
    const { id, date, source, activity, minutes, miles, weightLifted, notes } = body

    if (!id) {
      return NextResponse.json(
        { error: 'Workout ID is required' },
        { status: 400 }
      )
    }

    if (minutes !== undefined) {
      const parsedMinutes = parseInt(minutes)
      if (isNaN(parsedMinutes) || parsedMinutes < 0 || parsedMinutes > 1440) {
        return NextResponse.json(
          { error: 'minutes must be between 0 and 1440' },
          { status: 400 }
        )
      }
    }
    if (miles !== undefined && miles !== null) {
      const parsedMiles = parseFloat(miles)
      if (isNaN(parsedMiles) || parsedMiles < 0 || parsedMiles > 500) {
        return NextResponse.json(
          { error: 'miles must be between 0 and 500' },
          { status: 400 }
        )
      }
    }
    if (weightLifted !== undefined && weightLifted !== null) {
      const parsedWeight = parseFloat(weightLifted)
      if (isNaN(parsedWeight) || parsedWeight < 0 || parsedWeight > 200000) {
        return NextResponse.json(
          { error: 'weightLifted must be between 0 and 200000' },
          { status: 400 }
        )
      }
    }

    const updateData: {
      date?: Date
      source?: string
      activity?: string
      minutes?: number
      miles?: number | null
      weightLifted?: number | null
      notes?: string | null
    } = {}
    if (date !== undefined) {
      const parsed = parseWorkoutDate(date)
      if (!parsed) return NextResponse.json({ error: 'Invalid workout date' }, { status: 400 })
      updateData.date = parsed
    }
    if (source !== undefined) updateData.source = String(source)
    if (activity !== undefined) updateData.activity = String(activity)
    if (minutes !== undefined) updateData.minutes = parseInt(minutes)
    if (miles !== undefined) updateData.miles = miles === null ? null : parseFloat(miles)
    if (weightLifted !== undefined) updateData.weightLifted = weightLifted === null ? null : parseFloat(weightLifted)
    if (notes !== undefined) updateData.notes = notes || null

    const updated = await prisma.workoutSession.update({
      where: { id, deletedAt: null },
      data: updateData
    })

    await logAudit(request, authResult, 'workout.update', { id, fields: Object.keys(updateData) })
    return NextResponse.json({ workout: updated })
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2025') {
      return NextResponse.json({ error: 'Workout not found' }, { status: 404 })
    }
    console.error('Error updating workout:', error instanceof Error ? error.message : 'unknown')
    return NextResponse.json(
      { error: 'Failed to update workout' },
      { status: 500 }
    )
  }
}
