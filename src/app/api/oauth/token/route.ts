import { exchangeToken, OAuthRequestError, PUBLIC_CORS_HEADERS } from '@/lib/oauth'
import { limitMutation } from '@/lib/rate-limit'

const NO_STORE = { ...PUBLIC_CORS_HEADERS, 'Cache-Control': 'no-store' }

// Token endpoint: authorization_code (+PKCE) and rotating refresh_token grants.
export async function POST(req: Request) {
  const limited = limitMutation(req)
  if (limited) return limited
  try {
    const type = req.headers.get('content-type') ?? ''
    const params: Record<string, string | undefined> = type.includes('application/json')
      ? await req.json().catch(() => ({}))
      : Object.fromEntries(new URLSearchParams(await req.text()))
    return Response.json(await exchangeToken(params), { headers: NO_STORE })
  } catch (error) {
    if (error instanceof OAuthRequestError) {
      return Response.json({ error: error.code, error_description: error.message }, { status: error.status, headers: NO_STORE })
    }
    console.error('OAuth token error:', error instanceof Error ? error.message : 'unknown')
    return Response.json({ error: 'server_error' }, { status: 500, headers: NO_STORE })
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: PUBLIC_CORS_HEADERS })
}
