const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { createHash } = require('node:crypto')
const vm = require('node:vm')
const ts = require('typescript')

function loadTs(path, mocks = {}, env = {}) {
  const { outputText } = ts.transpileModule(readFileSync(resolve(__dirname, '..', path), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  })
  const exports = {}
  vm.runInNewContext(outputText, {
    exports, require: name => mocks[name] ?? require(name),
    Buffer, Date, Request, Response, URL, URLSearchParams, console,
    process: { env: { ...env } },
  })
  return exports
}

// In-memory stand-in for the three OAuth tables.
function fakePrisma() {
  const clients = [], codes = [], tokens = []
  let id = 0
  const matches = (row, where) => Object.entries(where).every(([key, cond]) => {
    if (cond && typeof cond === 'object' && !(cond instanceof Date) && 'gt' in cond) return row[key] > cond.gt
    return row[key] === cond
  })
  const table = rows => ({
    create: async ({ data }) => { const row = { id: `id${++id}`, createdAt: new Date(), usedAt: null, revokedAt: null, ...data }; rows.push(row); return row },
    createMany: async ({ data }) => { for (const d of data) rows.push({ id: `id${++id}`, revokedAt: null, ...d }); return { count: data.length } },
    findUnique: async ({ where }) => rows.find(row => matches(row, where)) ?? null,
    updateMany: async ({ where, data }) => {
      const hit = rows.filter(row => matches(row, where))
      for (const row of hit) Object.assign(row, data)
      return { count: hit.length }
    },
  })
  return { clients, codes, tokens, prisma: { oAuthClient: table(clients), oAuthCode: table(codes), oAuthToken: table(tokens) } }
}

function load(env = {}) {
  const db = fakePrisma()
  const oauth = loadTs('src/lib/oauth.ts', {
    '@/lib/prisma': { default: db.prisma },
    'mcp-handler': { getPublicOrigin: req => new URL(req.url).origin },
    '@/lib/oauth-hosts': loadTs('src/lib/oauth-hosts.ts', {}, env),
  }, env)
  return { oauth, db }
}

const verifier = 'a'.repeat(43) + '-verifier_value'
const challenge = createHash('sha256').update(verifier).digest('base64url')
const CLAUDE = 'https://claude.ai/api/mcp/auth_callback'

test('redirect URIs must be https on an allowed host (http only for localhost)', () => {
  const { oauth } = load()
  for (const uri of [CLAUDE, 'https://chatgpt.com/connector_platform_oauth_redirect', 'http://localhost:6274/cb', 'http://127.0.0.1:3000/x']) {
    assert.equal(oauth.isAllowedRedirectUri(uri), true, uri)
  }
  for (const uri of ['http://claude.ai/cb', 'https://evil.example/cb', 'https://claude.ai.evil.example/cb',
    'https://user:pw@claude.ai/cb', 'https://claude.ai/cb#frag', 'javascript:alert(1)', 'not a url']) {
    assert.equal(oauth.isAllowedRedirectUri(uri), false, uri)
  }
  const custom = load({ OAUTH_REDIRECT_HOSTS: 'example.org' }).oauth
  assert.equal(custom.isAllowedRedirectUri('https://example.org/cb'), true)
  assert.equal(custom.isAllowedRedirectUri(CLAUDE), false)
})

test('metadata advertises the MCP resource, PKCE S256 and public clients', () => {
  const { oauth } = load({ APP_BASE_URL: 'https://fit.example/' })
  const req = new Request('https://preview-123.vercel.app/.well-known/oauth-authorization-server')
  const as = oauth.authorizationServerMetadata(req)
  assert.equal(as.issuer, 'https://fit.example')
  assert.equal(as.token_endpoint, 'https://fit.example/api/oauth/token')
  assert.deepEqual([...as.code_challenge_methods_supported], ['S256'])
  assert.deepEqual([...as.token_endpoint_auth_methods_supported], ['none'])
  const pr = oauth.protectedResourceMetadata(req)
  assert.equal(pr.resource, 'https://fit.example/api/mcp/mcp')
  assert.deepEqual([...pr.authorization_servers], ['https://fit.example'])
})

test('registration rejects missing or disallowed redirect URIs', async () => {
  const { oauth, db } = load()
  for (const body of [null, {}, { redirect_uris: [] }, { redirect_uris: ['https://evil.example/cb'] },
    { redirect_uris: [CLAUDE, 'https://evil.example/cb'] }, { redirect_uris: [42] }]) {
    await assert.rejects(oauth.registerClient(body), err => err.code === 'invalid_redirect_uri')
  }
  assert.equal(db.clients.length, 0)
  const client = await oauth.registerClient({ client_name: 'Claude', redirect_uris: [CLAUDE] })
  assert.equal(client.token_endpoint_auth_method, 'none')
  assert.deepEqual([...client.redirect_uris], [CLAUDE])
})

test('authorize requests need a known client, its registered redirect and S256 PKCE', async () => {
  const { oauth } = load()
  const { client_id } = await oauth.registerClient({ client_name: 'Claude', redirect_uris: [CLAUDE] })
  const good = { response_type: 'code', client_id, redirect_uri: CLAUDE, code_challenge: challenge, code_challenge_method: 'S256' }
  assert.equal((await oauth.validateAuthorizeRequest(good)).name, 'Claude')
  for (const [patch, code] of [
    [{ client_id: 'nope' }, 'invalid_client'],
    [{ redirect_uri: 'https://claude.ai/other' }, 'invalid_request'],
    [{ response_type: 'token' }, 'unsupported_response_type'],
    [{ code_challenge_method: 'plain' }, 'invalid_request'],
    [{ code_challenge: undefined }, 'invalid_request'],
  ]) {
    await assert.rejects(oauth.validateAuthorizeRequest({ ...good, ...patch }), err => err.code === code)
  }
})

test('authorization code exchange checks PKCE, client and redirect, and is single use', async () => {
  const { oauth, db } = load()
  const { client_id } = await oauth.registerClient({ redirect_uris: [CLAUDE] })
  const issue = () => oauth.createAuthorizationCode({ clientId: client_id, redirectUri: CLAUDE, codeChallenge: challenge, state: 's' })
  const grant = code => ({ grant_type: 'authorization_code', client_id, code, code_verifier: verifier, redirect_uri: CLAUDE })

  const stored = await issue()
  assert.ok(db.codes.every(row => !Object.values(row).includes(stored))) // only the hash is stored

  for (const patch of [{ code_verifier: 'b'.repeat(50) }, { client_id: 'other' }, { redirect_uri: 'https://claude.ai/other' }]) {
    const code = await issue()
    await assert.rejects(oauth.exchangeToken({ ...grant(code), ...patch }), err => err.code === 'invalid_grant' || err.code === 'invalid_client')
  }

  const code = await issue()
  const tokens = await oauth.exchangeToken(grant(code))
  assert.equal(tokens.token_type, 'Bearer')
  assert.equal(tokens.expires_in, 3600)
  await assert.rejects(oauth.exchangeToken(grant(code)), err => err.code === 'invalid_grant')

  const expired = await issue()
  db.codes.at(-1).expiresAt = new Date(Date.now() - 1000)
  await assert.rejects(oauth.exchangeToken(grant(expired)), err => err.code === 'invalid_grant')
  await assert.rejects(oauth.exchangeToken({ grant_type: 'password', client_id }), err => err.code === 'unsupported_grant_type')
})

test('access tokens verify until expiry; refresh tokens rotate and cannot be replayed', async () => {
  const { oauth, db } = load()
  const { client_id } = await oauth.registerClient({ redirect_uris: [CLAUDE] })
  const code = await oauth.createAuthorizationCode({ clientId: client_id, redirectUri: CLAUDE, codeChallenge: challenge, state: null })
  const first = await oauth.exchangeToken({ grant_type: 'authorization_code', client_id, code, code_verifier: verifier, redirect_uri: CLAUDE })

  assert.ok(db.tokens.every(row => row.tokenHash !== first.access_token && row.tokenHash !== first.refresh_token))
  assert.equal((await oauth.verifyAccessToken(first.access_token)).clientId, client_id)
  assert.equal(await oauth.verifyAccessToken(first.refresh_token), null) // refresh token is not an access token
  assert.equal(await oauth.verifyAccessToken('garbage'), null)

  const second = await oauth.exchangeToken({ grant_type: 'refresh_token', client_id, refresh_token: first.refresh_token })
  assert.notEqual(second.access_token, first.access_token)
  await assert.rejects(oauth.exchangeToken({ grant_type: 'refresh_token', client_id, refresh_token: first.refresh_token }),
    err => err.code === 'invalid_grant')
  await assert.rejects(oauth.exchangeToken({ grant_type: 'refresh_token', client_id: 'other', refresh_token: second.refresh_token }),
    err => err.code === 'invalid_grant')

  const access = db.tokens.find(row => row.tokenHash === oauth.sha256(second.access_token))
  access.expiresAt = new Date(Date.now() - 1000)
  assert.equal(await oauth.verifyAccessToken(second.access_token), null)
})
