const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
function load(path, mocks = {}, globals = {}) {
  const { outputText } = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } })
  const exports = {}
  vm.runInNewContext(outputText, { exports, require: name => mocks[name] ?? require(name), Date, Error, process, Request, Response, URL, console, ...globals })
  return exports
}
test('REST auth, sync and mutation quotas apply without limiting read-only status requests', () => {
  let now = 100000
  class Clock extends Date { static now() { return now } }
  const limiter = load('src/lib/rate-limit.ts', {}, { Date: Clock })
  const req = (path, method) => new Request('https://fitness.test' + path, { method })
  for (let i = 0; i < 100; i++) assert.equal(limiter.limitRestRequest(req('/api/peloton/sync','GET')), null)
  for (let i = 0; i < 5; i++) assert.equal(limiter.limitRestRequest(req('/api/peloton/auth','POST')), null)
  assert.equal(limiter.limitRestRequest(req('/api/peloton/auth','POST')).status, 429)
  for (let i = 0; i < 10; i++) assert.equal(limiter.limitRestRequest(req('/api/peloton/sync','POST')), null)
  assert.equal(limiter.limitRestRequest(req('/api/peloton/sync','POST')).headers.get('retry-after'), '6')
  for (let i = 0; i < 60; i++) assert.equal(limiter.limitRestRequest(req('/api/goals','PUT')), null)
  assert.equal(limiter.limitRestRequest(req('/api/body-measurements','POST')).status, 429)
  now += 6000
  assert.equal(limiter.limitRestRequest(req('/api/peloton/sync','POST')), null)
})
test('authenticated bearer calls skip session work but still enforce mutation quotas', async () => {
  let sessions = 0, limits = 0
  const { requireAuth } = load('src/lib/auth.ts', {
    '@/auth': { auth: async () => { sessions++; return null } },
    '@/lib/api-auth': { extractBearerToken: () => 'valid', isValidApiToken: () => true },
    '@/lib/rate-limit': { limitRestRequest: () => { limits++; return new Response('{}', { status: 429 }) } },
  })
  assert.equal((await requireAuth(new Request('https://fitness.test/api/goals', { method: 'POST' }))).status, 429)
  assert.equal(sessions, 0); assert.equal(limits, 1)
})

test('CSP allows only self and the Peloton API for connections, with no eval or external script/data hosts', async () => {
  const { default: config } = load('next.config.ts', { './src/lib/oauth-hosts': load('src/lib/oauth-hosts.ts') })
  const headers = await config.headers()
  const policy = headers[0].headers.find(h => h.key === 'Content-Security-Policy').value
  const directives = Object.fromEntries(policy.split('; ').map(d => [d.split(' ')[0], d.split(' ').slice(1).join(' ')]))
  assert.equal(directives['connect-src'], "'self' https://api.onepeloton.com")
  assert.equal(directives['worker-src'], "'self'")
  assert.equal(directives['img-src'].includes('blob:'), false)
  assert.equal(policy.includes('eval'), false)
  for (const host of ['tonal', 'auth0', 'jsdelivr']) assert.equal(policy.includes(host), false, host)
  // The OAuth consent form redirects to the MCP client, so form-action must allow exactly those hosts.
  assert.equal(directives['form-action'], "'self' https://accounts.google.com https://claude.ai https://claude.com https://chatgpt.com http://localhost:* https://localhost:* http://127.0.0.1:* https://127.0.0.1:*")
})

test('cron Peloton sync requires the exact CRON_SECRET bearer before syncing', async () => {
  const secret = 'cron-secret-for-regression-test'
  let syncs = 0
  const audits = []
  const route = (env) => load('src/app/api/cron/peloton-sync/route.ts', {
    '@/lib/peloton-sync': { runPelotonSync: async () => { syncs++; return { synced: 2, updated: 1, skipped: 0, total: 3 } } },
    '@/lib/audit-log': { logAudit: async (_req, _auth, action) => audits.push(action) },
  }, { Buffer, process: { env } })
  const call = (handler, authorization) => handler.GET(new Request('https://fitness.test/api/cron/peloton-sync',
    authorization ? { headers: { authorization } } : {}))
  const configured = route({ CRON_SECRET: secret })
  for (const auth of [null, 'Bearer wrong', `Bearer ${secret}x`, secret, `bearer ${secret}`]) {
    assert.equal((await call(configured, auth)).status, 401, String(auth))
  }
  // An unset or too-short secret never authorizes, even when the header matches it.
  for (const env of [{}, { CRON_SECRET: '' }, { CRON_SECRET: 'short' }]) {
    assert.equal((await call(route(env), `Bearer ${env.CRON_SECRET ?? ''}`)).status, 401)
    assert.equal((await call(route(env), 'Bearer undefined')).status, 401)
  }
  assert.equal(syncs, 0)
  const ok = await call(configured, `Bearer ${secret}`)
  assert.equal(ok.status, 200)
  assert.deepEqual(await ok.json(), { synced: 2, updated: 1, skipped: 0, total: 3 })
  assert.equal(syncs, 1)
  assert.deepEqual(audits, ['peloton.sync.cron'])
})
