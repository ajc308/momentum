import { limitRestRequest } from '@/lib/rate-limit'
import { auth } from "@/auth"
import { NextResponse } from "next/server"
import type { Session } from "next-auth"
import { getToken } from "next-auth/jwt"
import { isValidApiToken, extractBearerToken } from "@/lib/api-auth"

/**
 * Get the current session on the server side.
 *
 * KNOWN BUG (NextAuth v5 beta): `auth()` returns `null` inside Route
 * Handlers on serverless runtimes (Vercel) even when the user has a
 * valid session cookie. The middleware sees the cookie fine; the
 * Route Handler does not. See:
 *   https://github.com/nextauthjs/next-auth/issues/9329
 *
 * The workaround in `requireAuth()` below is to fall back to
 * `getToken()` (from `next-auth/jwt`), which verifies the JWE
 * signature with `NEXTAUTH_SECRET` directly from the request cookies.
 * This is the v5 recommended escape hatch for Route Handlers.
 */
export async function getSession(): Promise<Session | null> {
  try {
    return await auth()
  } catch {
    return null
  }
}

/**
 * Cookie names that NextAuth v5 may use for the session token. Order
 * matters for `getToken()` — it tries each. Production uses the
 * `__Secure-` prefix; dev does not. Must match `auth.ts` cookies
 * config.
 */
const SESSION_COOKIE_NAMES = [
  "__Secure-authjs.session-token",
  "authjs.session-token",
]

/**
 * Verify the session JWT directly from the request. Returns the
 * decoded token (which carries sub/email/etc.) or null if missing,
 * expired, tampered, or signed with a different secret. This is a
 * cryptographic check — equivalent to what middleware does to gate
 * the request.
 */
async function verifySessionFromRequest(request: Request): Promise<{
  sub?: string
  email?: string
} | null> {
  const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET
  if (!secret) return null

  for (const cookieName of SESSION_COOKIE_NAMES) {
    try {
      const token = await getToken({
        req: request,
        secret,
        cookieName,
        secureCookie: cookieName.startsWith("__Secure-"),
        salt: cookieName,
      })
      if (token) return token as { sub?: string; email?: string }
    } catch {
      // Try the next name.
    }
  }
  return null
}

/**
 * Authoritative auth check for API route handlers (F-01 hardening).
 *
 * Accepts ANY of:
 *   1. A NextAuth session returned by `auth()` — the happy path.
 *   2. A signature-verified NextAuth JWT decoded from the request
 *      cookies via `getToken()` — fallback for the v5 beta Route
 *      Handler bug. This is NOT "cookie present"; the cookie's JWE
 *      signature is verified against NEXTAUTH_SECRET.
 *   3. A valid `Authorization: Bearer $MCP_API_TOKEN` header — MCP /
 *      scripts path.
 *
 * Returns a `NextResponse` (401) when none of those hold. Handlers
 * MUST early-return on a NextResponse result.
 */
export async function requireAuth(
  request?: Request,
): Promise<Session | NextResponse | null> {
  const finish = (session: Session | null) => request ? limitRestRequest(request) ?? session : session
  // Bearer calls need no session decoding or OAuth configuration work.
  if (request && isValidApiToken(extractBearerToken(request))) return finish(null)
  // 1. Real session, when v5 cooperates.
  const session = await getSession()
  if (session) return finish(session)

  if (request) {
    // 2. Cryptographically verify the session JWT directly.
    const token = await verifySessionFromRequest(request)
    if (token) {
      // Synthesize a minimal Session shape from the decoded JWT so
      // handlers that read `session.user.email` still work.
      return finish({
        user: {
          id: token.sub,
          email: token.email,
        },
        expires: "",
      } as Session)
    }

    // 3. Bearer-token (MCP / scripts).
    const bearer = extractBearerToken(request)
    if (isValidApiToken(bearer)) return finish(null)
  }

  return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
}

/**
 * Legacy non-blocking helper kept for back-compat. New code MUST use
 * `requireAuth(request)`.
 *
 * @deprecated Use `requireAuth(request)` and early-return on NextResponse.
 */
export async function checkAuth(): Promise<Session | null> {
  const session = await getSession()
  if (!session) {
    console.warn("checkAuth: session is null (use requireAuth for new code)")
  }
  return session
}

/**
 * Get the current user from the session.
 * Returns null if not authenticated.
 */
export async function getCurrentUser() {
  const session = await getSession()
  return session?.user ?? null
}
