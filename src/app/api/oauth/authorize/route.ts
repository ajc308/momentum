import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { logAudit } from '@/lib/audit-log'
import { createAuthorizationCode, issuer, OAuthRequestError, validateAuthorizeRequest } from '@/lib/oauth'

/**
 * Consent form target. Middleware lets /api/oauth/* through, so this
 * checks for a real signed-in session itself (the API bearer token is not
 * enough to approve a new client) and that the form came from our origin.
 */
export async function POST(request: Request) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult
  if (!authResult) return NextResponse.json({ error: 'A signed-in session is required' }, { status: 401 })

  const origin = request.headers.get('origin')
  if (origin && origin !== issuer(request) && origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: 'Cross-origin consent rejected' }, { status: 403 })
  }

  const form = await request.formData()
  const params = Object.fromEntries(
    [...form.entries()].filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )

  try {
    await validateAuthorizeRequest(params)
  } catch (error) {
    const message = error instanceof OAuthRequestError ? error.message : 'Invalid authorization request'
    return NextResponse.json({ error: message }, { status: 400 })
  }

  const redirect = new URL(params.redirect_uri)
  if (params.state != null) redirect.searchParams.set('state', params.state)

  if (params.decision !== 'approve') {
    redirect.searchParams.set('error', 'access_denied')
    return NextResponse.redirect(redirect, 303)
  }

  const code = await createAuthorizationCode({
    clientId: params.client_id,
    redirectUri: params.redirect_uri,
    codeChallenge: params.code_challenge,
    state: params.state ?? null,
  })
  await logAudit(request, authResult, 'oauth.authorize', { clientId: params.client_id, redirectHost: redirect.host })
  redirect.searchParams.set('code', code)
  redirect.searchParams.set('iss', issuer(request))
  return NextResponse.redirect(redirect, 303)
}
