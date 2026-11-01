/**
 * Minimal OAuth 2.1 authorization server so remote MCP clients that only
 * speak OAuth (claude.ai custom connectors, ChatGPT connectors) can reach
 * /api/mcp/mcp. Implements what the MCP authorization spec requires:
 *
 * - RFC 8414 metadata  /.well-known/oauth-authorization-server
 * - RFC 9728 metadata  /.well-known/oauth-protected-resource
 * - RFC 7591 dynamic client registration  POST /api/oauth/register
 * - Authorization code + PKCE (S256 only)  /oauth/authorize (consent page,
 *   requires the normal Google login, so only ALLOWED_EMAIL can approve)
 * - Token endpoint with rotating refresh tokens  POST /api/oauth/token
 *
 * Public clients only (no client secrets); PKCE is what binds the code to
 * the client. Redirect URIs must be on an allow-listed host
 * (OAUTH_REDIRECT_HOSTS) so a stranger can't register a client that sends
 * your authorization code to their own server.
 *
 * Codes and tokens are random 32-byte values stored as SHA-256 hashes.
 */
import { createHash, randomBytes } from 'crypto'
import { getPublicOrigin } from 'mcp-handler'
import prisma from '@/lib/prisma'
import { LOCAL_HOSTS, oauthRedirectHosts } from '@/lib/oauth-hosts'

export const ACCESS_TOKEN_TTL_S = 60 * 60 // 1 hour
const REFRESH_TOKEN_TTL_S = 90 * 24 * 60 * 60 // 90 days
const CODE_TTL_S = 5 * 60


// Metadata, registration and token endpoints carry no cookies, so any
// origin may call them (some MCP clients run in the browser).
export const PUBLIC_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, authorization, mcp-protocol-version',
  'Access-Control-Max-Age': '86400',
}

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')
const randomToken = () => randomBytes(32).toString('base64url')

/** Stable public origin: APP_BASE_URL when set, else from proxy headers. */
export function issuer(req: Request): string {
  return (process.env.APP_BASE_URL || getPublicOrigin(req)).replace(/\/$/, '')
}

export const mcpResourceUrl = (req: Request) => `${issuer(req)}/api/mcp/mcp`

export function authorizationServerMetadata(req: Request) {
  const base = issuer(req)
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['mcp'],
  }
}

export function protectedResourceMetadata(req: Request) {
  return {
    resource: mcpResourceUrl(req),
    authorization_servers: [issuer(req)],
    bearer_methods_supported: ['header'],
    scopes_supported: ['mcp'],
  }
}

/** https on an allow-listed host, or http only for localhost development. */
export function isAllowedRedirectUri(uri: string): boolean {
  let url: URL
  try {
    url = new URL(uri)
  } catch {
    return false
  }
  if (url.hash || url.username || url.password) return false
  const hosts = oauthRedirectHosts()
  const host = url.hostname.toLowerCase()
  const local = LOCAL_HOSTS.includes(host)
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return false
  return hosts.includes(host)
}

export class OAuthRequestError extends Error {
  constructor(public code: string, description: string, public status = 400) {
    super(description)
  }
}

export async function registerClient(body: unknown) {
  const input = (body ?? {}) as { client_name?: unknown; redirect_uris?: unknown }
  const redirectUris = Array.isArray(input.redirect_uris) ? input.redirect_uris : []
  if (redirectUris.length === 0 || redirectUris.length > 10 ||
      !redirectUris.every(uri => typeof uri === 'string' && isAllowedRedirectUri(uri))) {
    throw new OAuthRequestError('invalid_redirect_uri',
      'redirect_uris must be 1-10 https URLs on an allowed host (OAUTH_REDIRECT_HOSTS)')
  }
  const name = typeof input.client_name === 'string' && input.client_name.trim()
    ? input.client_name.trim().slice(0, 100)
    : 'MCP client'
  const client = await prisma.oAuthClient.create({ data: { name, redirectUris: redirectUris as string[] } })
  return {
    client_id: client.id,
    client_name: client.name,
    redirect_uris: client.redirectUris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
  }
}

export interface AuthorizeParams {
  clientId: string
  redirectUri: string
  codeChallenge: string
  state: string | null
}

/** Validate /oauth/authorize query params; returns the client on success. */
export async function validateAuthorizeRequest(params: Record<string, string | undefined>) {
  const { response_type, client_id, redirect_uri, code_challenge, code_challenge_method } = params
  if (!client_id || !redirect_uri) throw new OAuthRequestError('invalid_request', 'client_id and redirect_uri are required')
  const client = await prisma.oAuthClient.findUnique({ where: { id: client_id } })
  if (!client) throw new OAuthRequestError('invalid_client', 'Unknown client_id')
  if (!client.redirectUris.includes(redirect_uri)) {
    throw new OAuthRequestError('invalid_request', 'redirect_uri is not registered for this client')
  }
  if (response_type !== 'code') throw new OAuthRequestError('unsupported_response_type', 'response_type must be code')
  if (!code_challenge || code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(code_challenge)) {
    throw new OAuthRequestError('invalid_request', 'PKCE with code_challenge_method=S256 is required')
  }
  return client
}

export async function createAuthorizationCode({ clientId, redirectUri, codeChallenge }: AuthorizeParams) {
  const code = randomToken()
  await prisma.oAuthCode.create({
    data: {
      codeHash: sha256(code),
      clientId,
      redirectUri,
      codeChallenge,
      expiresAt: new Date(Date.now() + CODE_TTL_S * 1000),
    },
  })
  return code
}

async function issueTokens(clientId: string) {
  const accessToken = randomToken()
  const refreshToken = randomToken()
  const now = Date.now()
  await prisma.oAuthToken.createMany({
    data: [
      { tokenHash: sha256(accessToken), kind: 'access', clientId, expiresAt: new Date(now + ACCESS_TOKEN_TTL_S * 1000) },
      { tokenHash: sha256(refreshToken), kind: 'refresh', clientId, expiresAt: new Date(now + REFRESH_TOKEN_TTL_S * 1000) },
    ],
  })
  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_S,
    refresh_token: refreshToken,
    scope: 'mcp',
  }
}

const pkceChallenge = (verifier: string) => createHash('sha256').update(verifier).digest('base64url')

export async function exchangeToken(params: Record<string, string | undefined>) {
  const { grant_type, client_id } = params
  if (!client_id) throw new OAuthRequestError('invalid_client', 'client_id is required', 401)

  if (grant_type === 'authorization_code') {
    const { code, code_verifier, redirect_uri } = params
    if (!code || !code_verifier || !redirect_uri) {
      throw new OAuthRequestError('invalid_request', 'code, code_verifier and redirect_uri are required')
    }
    // Single use: mark consumed atomically before issuing anything.
    const consumed = await prisma.oAuthCode.updateMany({
      where: { codeHash: sha256(code), usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    })
    const row = await prisma.oAuthCode.findUnique({ where: { codeHash: sha256(code) } })
    if (!consumed.count || !row || row.clientId !== client_id || row.redirectUri !== redirect_uri ||
        row.codeChallenge !== pkceChallenge(code_verifier)) {
      throw new OAuthRequestError('invalid_grant', 'Invalid, expired or already used authorization code')
    }
    return issueTokens(client_id)
  }

  if (grant_type === 'refresh_token') {
    const { refresh_token } = params
    if (!refresh_token) throw new OAuthRequestError('invalid_request', 'refresh_token is required')
    // Rotation: the presented refresh token is revoked as it is used.
    const revoked = await prisma.oAuthToken.updateMany({
      where: { tokenHash: sha256(refresh_token), kind: 'refresh', clientId: client_id, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { revokedAt: new Date() },
    })
    if (!revoked.count) throw new OAuthRequestError('invalid_grant', 'Invalid or expired refresh token')
    return issueTokens(client_id)
  }

  throw new OAuthRequestError('unsupported_grant_type', 'grant_type must be authorization_code or refresh_token')
}

/** Look up an OAuth access token presented to the MCP endpoint. */
export async function verifyAccessToken(token: string) {
  const row = await prisma.oAuthToken.findUnique({ where: { tokenHash: sha256(token) } })
  if (!row || row.kind !== 'access' || row.revokedAt || row.expiresAt <= new Date()) return null
  return { clientId: row.clientId, expiresAt: Math.floor(row.expiresAt.getTime() / 1000) }
}
