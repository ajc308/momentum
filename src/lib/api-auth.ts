import type { NextRequest } from 'next/server'

/**
 * Helpers for the personal access token path used by `/api/mcp` and by
 * agent / script callers of the REST API.
 *
 * The middleware (`middleware.ts`) is the authoritative gate: it accepts
 * either a NextAuth session OR `Authorization: Bearer $MCP_API_TOKEN`.
 * These helpers exist so that the MCP route handler can independently
 * verify the token (the MCP path is allow-listed in middleware and must
 * police itself).
 */

/**
 * Constant-time string comparison to avoid timing side-channels on the
 * personal access token.
 *
 * F-11: Intentional duplicate of `middleware.ts#timingSafeEqual` (edge
 * runtime cannot import Node's crypto.timingSafeEqual). If you change
 * either copy, change BOTH.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}

/**
 * Extract a bearer token from an `Authorization: Bearer <token>` header.
 * Returns null when the header is absent or malformed.
 *
 * F-12 (intentional): we ONLY read the Authorization header. Do NOT
 * add query-string, cookie, or alternate-header fallbacks "for
 * convenience" — query-string tokens get logged in CDN/access logs and
 * leak via Referer headers; cookies become a CSRF problem.
 */
export function extractBearerToken(request: Request | NextRequest): string | null {
  const header = request.headers.get('authorization') ?? request.headers.get('Authorization')
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match ? match[1].trim() : null
}

/**
 * Validate the bearer token against `MCP_API_TOKEN`. Reads from env at call
 * time so token rotation on Vercel does not require redeploying cached
 * modules. Requires the token to be at least 16 chars to refuse obviously
 * weak values even if someone sets them in env.
 */
export function isValidApiToken(token: string | null): boolean {
  return hasBearerSecret(token, process.env.MCP_API_TOKEN)
}

/**
 * Compare a bearer token against a single-purpose secret (e.g.
 * HEALTH_INGEST_TOKEN) for routes that middleware lets through and that
 * police themselves. Same 16-char floor as MCP_API_TOKEN.
 */
export function hasBearerSecret(token: string | null, expected: string | undefined): boolean {
  if (!token || !expected || expected.length < 16) return false
  return timingSafeEqual(token, expected)
}
