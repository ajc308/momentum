import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { getToken } from "next-auth/jwt"

/**
 * Constant-time string compare for the personal access token to avoid
 * timing side-channels.
 *
 * F-11: Intentional duplicate of `src/lib/api-auth.ts#timingSafeEqual`.
 * Middleware runs on the Edge runtime and cannot import the Node-only
 * `crypto.timingSafeEqual`, and edge bundles complain about pulling in
 * server modules. If you change either copy, change BOTH.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}

// F-12 (intentional): only the Authorization header is honoured.
// Do NOT widen this to query-string / cookie / alternate header without
// re-doing the threat model — token-in-URL leaks to logs and Referer.
function hasValidApiToken(req: NextRequest): boolean {
  const header =
    req.headers.get('authorization') ?? req.headers.get('Authorization')
  if (!header) return false
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  if (!match) return false
  const token = match[1].trim()
  const expected = process.env.MCP_API_TOKEN
  if (!expected || expected.length < 16) return false
  return timingSafeEqual(token, expected)
}

/**
 * Verify the NextAuth session JWT from the request cookies. Same
 * cryptographic check NextAuth itself uses — decodes the JWE with
 * NEXTAUTH_SECRET (or AUTH_SECRET) and validates expiry / signature.
 *
 * IMPORTANT: middleware does NOT import `auth` from `../auth` because
 * that would pull the entire NextAuth config (including the Google
 * provider) into the Edge bundle. The Google provider reads
 * GOOGLE_CLIENT_ID at module load; if the Edge runtime instantiates
 * it without env access, NextAuth permanently caches client_id=undefined
 * and Google sign-in breaks with "Error 401: invalid_client". Keep
 * middleware lean — it only needs the session check.
 */
async function hasValidSession(req: NextRequest): Promise<boolean> {
  const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET
  if (!secret) return false

  // Cookie names match the pinning in auth.ts.
  const cookieNames = [
    '__Secure-authjs.session-token',
    'authjs.session-token',
  ]
  for (const cookieName of cookieNames) {
    try {
      const token = await getToken({
        req,
        secret,
        cookieName,
        secureCookie: cookieName.startsWith('__Secure-'),
        salt: cookieName,
      })
      if (token) return true
    } catch {
      // Try the next name.
    }
  }
  return false
}

export async function middleware(req: NextRequest) {
  const { nextUrl } = req

  // Public paths that don't require authentication.
  // `/api/mcp` is the MCP server endpoint; it does its own bearer-token
  // check against MCP_API_TOKEN so agents (Claude Desktop, Codex, etc.)
  // can connect without a NextAuth session cookie. `/api/cron` is called
  // by Vercel Cron and checks CRON_SECRET itself; `/api/health/ingest`
  // checks HEALTH_INGEST_TOKEN itself. OAuth metadata, client
  // registration and token exchange are public by definition; the consent
  // page (/oauth/authorize) still requires a session.
  const isPublicPath =
    nextUrl.pathname.startsWith('/api/auth') ||
    nextUrl.pathname.startsWith('/api/mcp') ||
    nextUrl.pathname.startsWith('/api/cron/') ||
    nextUrl.pathname === '/api/health/ingest' ||
    nextUrl.pathname.startsWith('/api/oauth/') ||
    nextUrl.pathname.startsWith('/.well-known/') ||
    nextUrl.pathname === '/login'

  if (isPublicPath) {
    return NextResponse.next()
  }

  // API requests may authenticate with a personal access token
  // (`Authorization: Bearer $MCP_API_TOKEN`) instead of a session cookie.
  if (nextUrl.pathname.startsWith('/api/') && hasValidApiToken(req)) {
    return NextResponse.next()
  }

  const loggedIn = await hasValidSession(req)
  if (!loggedIn) {
    // Don't redirect API callers to an HTML login page; return 401.
    if (nextUrl.pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const loginUrl = new URL('/login', nextUrl.origin)
    // Keep the query string: the OAuth consent page needs its parameters.
    loginUrl.searchParams.set('callbackUrl', nextUrl.pathname + nextUrl.search)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * F-03 hardening: anchored exclusions instead of a trailing-extension
     * catch-all. We only skip _next internals and the favicon. Static
     * assets under /public are served by Next.js's own asset handler
     * before middleware runs, so they don't need their own exclusion.
     */
    '/((?!_next/static|_next/image|favicon\\.ico).*)',
  ],
}
