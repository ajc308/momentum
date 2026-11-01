import { OAuthRequestError, PUBLIC_CORS_HEADERS, registerClient } from '@/lib/oauth'
import { limitMutation } from '@/lib/rate-limit'

// RFC 7591 dynamic client registration (public clients, PKCE only).
export async function POST(req: Request) {
  const limited = limitMutation(req)
  if (limited) return limited
  try {
    const client = await registerClient(await req.json().catch(() => null))
    return Response.json(client, { status: 201, headers: { ...PUBLIC_CORS_HEADERS, 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof OAuthRequestError) {
      return Response.json({ error: error.code, error_description: error.message },
        { status: error.status, headers: PUBLIC_CORS_HEADERS })
    }
    console.error('OAuth register error:', error instanceof Error ? error.message : 'unknown')
    return Response.json({ error: 'server_error' }, { status: 500, headers: PUBLIC_CORS_HEADERS })
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: PUBLIC_CORS_HEADERS })
}
