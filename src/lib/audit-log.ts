/**
 * Audit log (F-06 fix) — every mutation invoked through the API records
 * a row in the `audit_log` table so a leaked MCP_API_TOKEN leaves a
 * trail and post-incident recovery has data to work with.
 *
 * Best-effort: failures here MUST NOT block the underlying request, so
 * everything is wrapped in try/catch.
 */
import type { Session } from 'next-auth'
import prisma from '@/lib/prisma'
import { isValidApiToken, extractBearerToken } from '@/lib/api-auth'

function authMode(request: Request, session: Session | null): {
  authMode: 'session' | 'bearer' | 'anonymous'
  actor: string
} {
  if (session?.user?.email) {
    return { authMode: 'session', actor: session.user.email }
  }
  if (isValidApiToken(extractBearerToken(request))) {
    return { authMode: 'bearer', actor: 'mcp-pat' }
  }
  return { authMode: 'anonymous', actor: 'unknown' }
}

function clientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0]!.trim()
  return request.headers.get('x-real-ip') ?? 'unknown'
}

/**
 * Write an audit row. `session` may be a Session, null (bearer auth), or
 * NextResponse-shaped (shouldn't happen — handler should have returned
 * before calling us).
 */
export async function logAudit(
  request: Request,
  session: Session | null | unknown,
  action: string,
  details: Record<string, unknown>,
): Promise<void> {
  try {
    const path = new URL(request.url).pathname
    const sess = (session && typeof session === 'object' && 'user' in session
      ? (session as Session)
      : null)
    const { authMode: mode, actor } = authMode(request, sess)

    await prisma.auditLog.create({
      data: {
        authMode: mode,
        actor,
        action,
        path,
        ip: clientIp(request),
        details: JSON.stringify(details).slice(0, 4096),
      },
    })
  } catch (err) {
    // Never break the request because the audit row failed.
    console.warn('audit: failed to write row:', err instanceof Error ? err.message : 'unknown')
  }
}
