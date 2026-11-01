import { SyncInputError } from '@/lib/sync-write'
import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { runPelotonSync } from '@/lib/peloton-sync'
import { logAudit } from '@/lib/audit-log'

// Each new class needs its own graph request for calories / heart rate.
export const maxDuration = 300

// GET: check connection status
export async function GET(request: Request) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult

  try {
    const credential = await prisma.pelotonCredential.findFirst()
    return NextResponse.json({
      connected: !!credential,
      userId: credential?.userId ?? null,
    })
  } catch {
    return NextResponse.json({ connected: false, userId: null })
  }
}

// POST: sync workouts from Peloton
export async function POST(req: Request) {
  const authResult = await requireAuth(req)
  if (authResult instanceof NextResponse) return authResult

  try {
    const url = new URL(req.url)
    const limit = Number(url.searchParams.get('limit') ?? '200')
    const result = await runPelotonSync(limit)
    await logAudit(req, authResult, 'peloton.sync', { limit, result })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof SyncInputError) return NextResponse.json({ error: error.message }, { status: 400 })
    const message = error instanceof Error ? error.message : 'Sync failed'
    console.error('Peloton sync error:', message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE: disconnect Peloton (clear stored credentials)
export async function DELETE(request: Request) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult

  try {
    await prisma.pelotonCredential.deleteMany()
    await logAudit(request, authResult, 'peloton.disconnect', {})
    return NextResponse.json({ disconnected: true })
  } catch (error) {
    console.error('Failed to disconnect Peloton:', error instanceof Error ? error.message : 'unknown')
    return NextResponse.json({ error: 'Failed to disconnect' }, { status: 500 })
  }
}
