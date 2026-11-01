import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import { logAudit } from '@/lib/audit-log'
import { PelotonStackError, stackPlanDay, viewStack } from '@/lib/peloton-stack'

export const maxDuration = 60

// GET: the current Peloton Stack.
export async function GET(request: Request) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult
  try {
    return NextResponse.json(await viewStack())
  } catch (error) {
    const message = error instanceof PelotonStackError ? error.message : 'Could not read your Peloton Stack'
    console.error('Peloton stack read error:', error instanceof Error ? error.message : 'unknown')
    return NextResponse.json({ error: message }, { status: 502 })
  }
}

const body = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  mode: z.enum(['append', 'replace']).default('append'),
})

// POST: stack a plan day's suggested classes. Body: { day?: "YYYY-MM-DD", mode?: "append" | "replace" }.
export async function POST(request: Request) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult
  const parsed = body.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Expected { day?: YYYY-MM-DD, mode?: append | replace }' }, { status: 400 })
  try {
    const result = await stackPlanDay(parsed.data.day, parsed.data.mode)
    await logAudit(request, authResult, 'peloton.stack', { day: result.day.day, added: result.added.length })
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof PelotonStackError ? error.message : 'Could not update your Peloton Stack'
    console.error('Peloton stack write error:', error instanceof Error ? error.message : 'unknown')
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
