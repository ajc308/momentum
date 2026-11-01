const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function loadTs(path, mocks = {}, globals = {}) {
  const { outputText } = ts.transpileModule(readFileSync(resolve(__dirname, '..', path), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  })
  const exports = {}
  vm.runInNewContext(outputText, {
    exports, require: name => mocks[name] ?? require(name),
    Buffer, Date, process, Request, Response, Headers, URL, console, ...globals,
  })
  return exports
}

function fixture(limits = {}) {
  const token = 'test-token-for-mcp-security'
  const audits = []
  const queries = []
  let mutationCount = 0
  const row = { id: 'workout', date: new Date('2026-10-12T12:00:00Z'), source: 'Gym', activity: 'Cycling', minutes: 30, deletedAt: null }
  const prisma = {
    workoutSession: {
      findMany: async args => { queries.push(args); return [row] }, findUnique: async () => row,
      create: async ({ data }) => { mutationCount++; return { id: 'created', ...data } },
      update: async ({ data }) => ({ ...row, ...data }),
    },
    goal: { findMany: async () => [] },
    bodyMeasurement: {
      findMany: async () => [{ id: 'weight', date: new Date('2026-10-12T00:00:00Z'), weightLbs: 180, bodyFatPct: null, source: 'Manual' }],
      upsert: async ({ where, create }) => { mutationCount++; queries.push({ upsert: where }); return { id: 'weight', ...create } },
    },
    healthMetric: { findMany: async args => { queries.push({ health: args.where }); return [] } },
    pelotonCredential: { findFirst: async () => null },
  }
  const prismaModule = { '@/lib/prisma': { default: prisma } }
  const result = { synced: 1, updated: 0, skipped: 0, total: 1 }
  const route = loadTs('src/app/api/mcp/[transport]/route.ts', {
    ...prismaModule,
    '@/lib/api-auth': { isValidApiToken: value => value === token },
    '@/lib/oauth': {
      verifyAccessToken: async value => value === 'oauth-access-token'
        ? { clientId: 'oauth-client', expiresAt: Math.floor(Date.now() / 1000) + 3600 }
        : value === 'expired-oauth-token' ? { clientId: 'oauth-client', expiresAt: 1 } : null,
    },
    '@/lib/peloton-sync': { runPelotonSync: async () => result },
    '@/lib/body-weight': loadTs('src/lib/body-weight.ts', { ...prismaModule, '@/lib/workout-date': loadTs('src/lib/workout-date.ts'), '@/lib/body-fat': loadTs('src/lib/body-fat.ts') }),
    '@/lib/workout-date': loadTs('src/lib/workout-date.ts'),
    '@/lib/calendar': loadTs('src/lib/calendar.ts'),
    // Planner logic has its own tests; here we only check the tool wiring.
    '@/lib/planner': { buildPlan: (rows, today) => ({ today, days: [], adapted: null, nextWorkout: null, historyRows: rows.length }) },
    // Peloton network modules have their own tests; here only the tool wiring.
    '@/lib/plan-classes': { withCatalogClasses: async plan => plan },
    '@/lib/peloton-catalog': { FAVORITE_INSTRUCTOR: 'Jermaine Johnson', findClasses: async (focus, minutes, count) => Array.from({ length: count }, (_, i) => ({ rideId: `r${i}`, title: `${minutes} min ${focus}`, minutes })) },
    '@/lib/peloton-stack': {
      PelotonStackError: class extends Error {},
      parseClassId: value => (/^[0-9a-f]{32}$/.test(value) ? value : null),
      viewStack: async () => ({ numClasses: 0, totalMinutes: 0, classes: [] }),
      stackClasses: async (ids, mode) => { mutationCount++; return { added: ids, alreadyStacked: [], skipped: [], mode } },
      stackPlanDay: async (day, mode) => { mutationCount++; return { day: { day: day ?? 'next' }, added: ['r0'], mode } },
    },
    '@/lib/rate-limit': { limitMcp: () => null, limitSync: () => null, limitMutation: () => null, ...limits },
    '@/lib/audit-log': { logAudit: async (req, _session, action) => audits.push({ action, path: new URL(req.url).pathname }) },
  })
  let id = 0
  async function rpc(method, params, { bearer = token, protocol = '2025-11-25' } = {}) {
    if (protocol === '2026-07-28') {
      params = { ...params, _meta: {
        'io.modelcontextprotocol/protocolVersion': protocol,
        'io.modelcontextprotocol/clientCapabilities': {},
        'io.modelcontextprotocol/clientInfo': { name: 'regression-test', version: '1' },
      } }
    }
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': protocol }
    if (protocol === '2026-07-28') {
      headers['MCP-Method'] = method
      if (params.name) headers['MCP-Name'] = params.name
    }
    if (bearer) headers.Authorization = `Bearer ${bearer}`
    const res = await route.POST(new Request('https://fitness.example/api/mcp/mcp', {
      method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
    }))
    const text = await res.text()
    let body
    if (res.headers.get('content-type')?.includes('text/event-stream')) {
      const line = text.split('\n').find(line => line.startsWith('data: '))
      body = line ? JSON.parse(line.slice(6)) : null
    } else {
      body = text ? JSON.parse(text) : null
    }
    return { res, body }
  }
  return { rpc, audits, queries, mutationCount: () => mutationCount }
}

test('real MCP handler rejects missing or invalid bearer tokens', async () => {
  const { rpc } = fixture()
  for (const bearer of [null, 'invalid']) {
    assert.equal((await rpc('tools/list', {}, { bearer })).res.status, 401)
  }
})

test('SDK v2 preserves discovery and every existing tool for Streamable HTTP clients', async () => {
  const { rpc, audits, queries } = fixture()
  const init = await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'regression-test', version: '1' } })
  assert.equal(init.res.status, 200)
  assert.equal(init.body.result.serverInfo.name, 'fitness-tracker')
  const calls = {
    list_workouts: { discipline: 'strength' }, get_workout: { id: 'workout' },
    create_workout: { date: '2026-10-12', source: 'Gym', activity: 'Cycling', minutes: 30 },
    update_workout: { id: 'workout', minutes: 45 }, delete_workout: { id: 'workout' },
    list_weight: {}, list_health_metrics: { name: 'resting_heart_rate' }, log_weight: { date: '2026-10-12', weightLbs: 180.5 },
    list_goals: {}, get_training_plan: {}, peloton_status: {}, sync_peloton: {},
    find_peloton_classes: { focus: 'legs', minutes: 20, count: 2 }, get_peloton_stack: {},
    stack_peloton_classes: { classes: ['0123456789abcdef0123456789abcdef'] },
  }
  const listed = await rpc('tools/list', {})
  assert.equal(listed.res.status, 200)
  assert.deepEqual(listed.body.result.tools.map(tool => tool.name).sort(), Object.keys(calls).sort())
  for (const [name, args] of Object.entries(calls)) {
    const called = await rpc('tools/call', { name, arguments: args })
    assert.equal(called.res.status, 200, name)
    assert.equal(called.body.error, undefined, name)
    assert.notEqual(called.body.result.isError, true, name)
    assert.ok(called.body.result.content.length, name)
  }
  assert.deepEqual(audits.map(row => row.action), ['mcp.create_workout', 'mcp.update_workout', 'mcp.delete_workout', 'mcp.log_weight', 'mcp.sync_peloton', 'mcp.stack_peloton_classes'])
  assert.ok(audits.every(row => row.path === '/api/mcp/mcp'))
  assert.deepEqual({ ...queries[0].where }, { deletedAt: null, discipline: 'strength' })
  assert.deepEqual({ ...queries.find(q => q.health).health }, { name: 'resting_heart_rate' })
  assert.equal(queries.find(q => q.upsert).upsert.date.toISOString(), '2026-10-12T00:00:00.000Z')
  const invalid = await rpc('tools/call', { name: 'create_workout', arguments: { date: '2026-10-12', source: 'Gym', activity: 'Cycling', minutes: -1 } })
  assert.ok(invalid.body.error || invalid.body.result?.isError)
  for (const args of [{ date: '2026-02-30', weightLbs: 180 }, { date: '2026-10-12', weightLbs: 5 }]) {
    const badWeight = await rpc('tools/call', { name: 'log_weight', arguments: args })
    assert.ok(badWeight.body.error || badWeight.body.result?.isError, JSON.stringify(args))
  }
  assert.equal(queries.filter(q => q.upsert).length, 1)
})

test('current MCP protocol supports authenticated discovery', async () => {
  const { rpc, audits } = fixture()
  const { res, body } = await rpc('server/discover', {}, { protocol: '2026-07-28' })
  assert.equal(res.status, 200, JSON.stringify(body))
  assert.equal(body.error, undefined)
  assert.ok(body.result)
  const called = await rpc('tools/call', {
    name: 'create_workout', arguments: { date: '2026-10-12', source: 'Gym', activity: 'Cycling', minutes: 30 },
  }, { protocol: '2026-07-28' })
  assert.equal(called.res.status, 200, JSON.stringify(called.body))
  assert.equal(called.body.error, undefined)
  assert.notEqual(called.body.result.isError, true)
  assert.equal(audits.length, 1)
})

test('read-only MCP discovery does not consume sync quota, and exhausted mutation quota blocks writes', async () => {
  const limits = loadTs('src/lib/rate-limit.ts')
  const { rpc } = fixture(limits)
  for (let i = 0; i < 12; i++) assert.equal((await rpc('tools/list', {})).res.status, 200)
  const synced = await rpc('tools/call', { name: 'sync_peloton', arguments: { limit: 50 } })
  assert.equal(synced.body.result.isError, undefined)
  const denied = fixture({ limitMutation: () => new Response('{}', { status: 429 }) })
  const result = await denied.rpc('tools/call', { name: 'create_workout', arguments: { date: '2026-10-12', source: 'Gym', activity: 'Cycling', minutes: 30 } })
  assert.equal(result.body.result.isError, true)
  assert.equal(denied.audits.length, 0)
  assert.equal(denied.mutationCount(), 0)
})

test('OAuth access tokens reach the MCP tools; 401s point clients at protected resource metadata', async () => {
  const { rpc } = fixture()
  const ok = await rpc('tools/list', {}, { bearer: 'oauth-access-token' })
  assert.equal(ok.res.status, 200)
  assert.ok(ok.body.result.tools.some(tool => tool.name === 'list_workouts'))

  for (const bearer of [null, 'expired-oauth-token', 'not-a-token']) {
    const denied = await rpc('tools/list', {}, { bearer })
    assert.equal(denied.res.status, 401)
    assert.match(denied.res.headers.get('www-authenticate') ?? '',
      /resource_metadata="https:\/\/fitness\.example\/\.well-known\/oauth-protected-resource\/api\/mcp\/mcp"/)
  }
})
