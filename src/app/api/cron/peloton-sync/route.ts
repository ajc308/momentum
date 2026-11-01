import { timingSafeEqual } from 'crypto'
import { NextResponse } from 'next/server'
import { runPelotonSync } from '@/lib/peloton-sync'
import { logAudit } from '@/lib/audit-log'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Daily Peloton sync, scheduled in `vercel.json`. Vercel Cron sends
 * `Authorization: Bearer $CRON_SECRET`; middleware lets `/api/cron/*`
 * through, so this route must police itself. Same 16-char floor as
 * MCP_API_TOKEN so an empty / unset env never passes.
 */
function isCronRequest(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret || secret.length < 16) return false
  const expected = Buffer.from(`Bearer ${secret}`)
  const actual = Buffer.from(request.headers.get('authorization') ?? '')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export async function GET(request: Request) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await runPelotonSync()
    await logAudit(request, null, 'peloton.sync.cron', { result })
    return NextResponse.json(result)
  } catch (error) {
    console.error('Peloton cron sync error:', error instanceof Error ? error.message : 'Sync failed')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
