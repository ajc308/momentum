import { NextResponse } from 'next/server'
import { extractBearerToken, hasBearerSecret } from '@/lib/api-auth'
import { ingestHealthPayload, type HealthPayload } from '@/lib/apple-health'
import { logAudit } from '@/lib/audit-log'
import { limitHealthIngest } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Apple Health push target for the Health Auto Export iOS app. Uses its own
 * HEALTH_INGEST_TOKEN (not MCP_API_TOKEN) so the phone app can only write
 * health data. Middleware lets this path through; it polices itself.
 */
export async function POST(request: Request) {
  if (!hasBearerSecret(extractBearerToken(request), process.env.HEALTH_INGEST_TOKEN)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const limited = limitHealthIngest(request)
  if (limited) return limited

  const payload = (await request.json().catch(() => null)) as HealthPayload | null
  if (!payload || typeof payload !== 'object' || typeof payload.data !== 'object') {
    return NextResponse.json({ error: 'Expected Health Auto Export JSON: { data: { workouts, metrics } }' }, { status: 400 })
  }

  try {
    const result = await ingestHealthPayload(payload)
    await logAudit(request, null, 'health.ingest', { result })
    return NextResponse.json(result)
  } catch (error) {
    console.error('Health ingest error:', error instanceof Error ? error.message : 'unknown')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
