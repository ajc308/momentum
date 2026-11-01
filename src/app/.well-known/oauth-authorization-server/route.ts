import { authorizationServerMetadata, PUBLIC_CORS_HEADERS } from '@/lib/oauth'

// RFC 8414 authorization server metadata for remote MCP clients.
export function GET(req: Request) {
  return Response.json(authorizationServerMetadata(req), {
    headers: { ...PUBLIC_CORS_HEADERS, 'Cache-Control': 'max-age=3600' },
  })
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: PUBLIC_CORS_HEADERS })
}
