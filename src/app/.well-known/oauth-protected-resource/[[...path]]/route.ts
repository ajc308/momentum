import { protectedResourceMetadata, PUBLIC_CORS_HEADERS } from '@/lib/oauth'

// RFC 9728 protected resource metadata, served at both the bare path and
// the path-suffixed form (/.well-known/oauth-protected-resource/api/mcp/mcp)
// that clients derive from the MCP URL.
export function GET(req: Request) {
  return Response.json(protectedResourceMetadata(req), {
    headers: { ...PUBLIC_CORS_HEADERS, 'Cache-Control': 'max-age=3600' },
  })
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: PUBLIC_CORS_HEADERS })
}
