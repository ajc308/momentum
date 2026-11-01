const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const React = require('react')
const { create, act } = require('react-test-renderer')
const { webcrypto } = require('node:crypto')

function loadTs(path, mocks = {}, globals = {}) {
  const { outputText } = ts.transpileModule(readFileSync(resolve(__dirname, '..', path), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  })
  const exports = {}
  vm.runInNewContext(outputText, {
    exports, require: name => mocks[name] ?? (['@/lib/calendar', '@/lib/goal-input', '@/utils/goalPeriods', '@/utils/workoutTotals'].includes(name) ? loadTs('src/' + name.slice(2) + '.ts') : require(name)),
    Date, Error, Request, Response, Headers, URL, console, crypto: webcrypto,
    setInterval, clearInterval, ...globals,
  })
  return exports
}

const dates = loadTs('src/lib/workout-date.ts')
test('date parser accepts explicit timestamps and rejects impossible or ambiguous dates', () => {
  assert.equal(dates.parseWorkoutDate('2026-10-12').toISOString(), '2026-10-12T12:00:00.000Z')
  assert.equal(dates.parseWorkoutDate('2026-10-12T07:00:00.000Z').toISOString(), '2026-10-12T07:00:00.000Z')
  assert.equal(dates.parseWorkoutDate('2026-10-12T06:30:00-07:00').toISOString(), '2026-10-12T13:30:00.000Z')
  assert.ok(dates.parseWorkoutDate('2024-02-29'))
  for (const value of ['2026-02-29', '2026-02-30T12:00:00Z', '2026-13-01', '2026-10-12T24:00:00Z', '2026-10-12T12:00:00', 'nonsense', null, 12]) {
    assert.equal(dates.parseWorkoutDate(value), null, String(value))
  }
})

function apiFixture() {
  const rows = new Map()
  let creates = 0
  const audits = []
  const db = {
    findUnique: async ({ where }) => rows.get(where.id) ?? null,
    findMany: async ({ where } = {}) => [...rows.values()].filter(row =>
      (where?.deletedAt === null ? !row.deletedAt : true) &&
      (where?.pelotonWorkoutId ? where.pelotonWorkoutId.in.includes(row.pelotonWorkoutId) : true)),
    create: async ({ data }) => {
      const id = data.id ?? `generated-${++creates}`
      if (rows.has(id)) throw Object.assign(new Error('Unique constraint'), { code: 'P2002' })
      const row = { ...data, id, deletedAt: null, pelotonWorkoutId: 'external-id' }
      rows.set(id, row)
      return row
    },
    updateMany: async ({ where, data }) => {
      const row = rows.get(where.id)
      if (!row || row.deletedAt) return { count: 0 }
      Object.assign(row, data)
      return { count: 1 }
    },
    update: async ({ where, data }) => {
      const row = rows.get(where.id)
      if (!row || row.deletedAt) throw Object.assign(new Error('Not found'), { code: 'P2025' })
      Object.assign(row, data)
      return row
    },
  }
  const routes = loadTs('src/app/api/workouts/route.ts', {
    '@/lib/prisma': { default: { workoutSession: db } },
    '@/lib/auth': { requireAuth: async () => null },
    '@/lib/workout-date': dates,
    '@/lib/audit-log': { logAudit: async (_req, _auth, action) => audits.push(action) },
  })
  const call = (method, body, key, id) => routes[method](new Request(`http://localhost/api/workouts${id ? `?id=${id}` : ''}`, {
    method, headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }))
  return { call, rows, audits, db }
}

const payload = { date: '2026-10-12T07:00:00.000Z', source: 'Gym', activity: 'Cycling', minutes: 30, miles: 0 }
const key = '4c37755b-88d0-4d36-a1e1-b6b0a66bdd5b'
test('workout dates round trip through create/edit; invalid edits leave data intact', async () => {
  const { call, rows } = apiFixture()
  const response = await call('POST', payload)
  const row = (await response.json()).workout
  assert.equal(row.miles, 0)
  assert.equal((await call('PUT', { id: row.id, date: payload.date, minutes: 45 })).status, 200)
  assert.equal(rows.get(row.id).date.toISOString(), payload.date)
  assert.equal((await call('PUT', { id: row.id, date: '2026-02-30' })).status, 400)
  assert.equal(rows.get(row.id).minutes, 45)
})

test('lost-response and concurrent save retries create one workout; key reuse rejects a changed payload', async () => {
  const { call, rows } = apiFixture()
  const concurrent = await Promise.all([call('POST', payload, key), call('POST', payload, key)])
  assert.ok(concurrent.every(response => response.ok))
  assert.equal(rows.size, 1)
  assert.equal((await call('POST', payload, key)).status, 200)
  assert.equal((await call('POST', { ...payload, minutes: 60 }, key)).status, 409)
})

test('soft deletion keeps external IDs, hides history, and cannot be resurrected by edit or save retry', async () => {
  const { call, rows, audits, db } = apiFixture()
  const created = (await (await call('POST', payload, key)).json()).workout
  assert.equal((await call('DELETE', null, null, created.id)).status, 200)
  assert.equal(rows.get(created.id).pelotonWorkoutId, 'external-id')
  assert.ok(rows.get(created.id).deletedAt)
  assert.equal((await (await call('GET')).json()).workouts.length, 0)
  assert.equal((await call('PUT', { id: created.id, minutes: 60 })).status, 404)
  assert.equal((await call('POST', payload, key)).status, 409)
  assert.equal((await call('DELETE', null, null, created.id)).status, 200)
  assert.equal(audits.filter(action => action === 'workout.delete').length, 1)
  const sync = loadTs('src/lib/peloton-sync.ts', {
    '@/lib/sync-write': { validateSyncLimit: () => {}, withSyncWrite: fn => fn({ workoutSession: db }) },
    '@/lib/workout-match': loadTs('src/lib/workout-match.ts'),
    '@/lib/prisma': { default: { workoutSession: db, pelotonCredential: { findFirst: async () => ({ sessionId: 'test', userId: 'user', expiresAt: Math.floor(Date.now() / 1000) + 3600 }) } } },
    '@/lib/crypto': { decryptSecret: value => value },
    '@/lib/peloton': {
      fetchPelotonWorkouts: async () => ({ data: [{ id: 'external-id', status: 'COMPLETE', overall_summary: {} }], page_count: 1 }),
      pelotonClassDetails: () => ({ discipline: 'cycling' }),
    },
  })
  const synced = await sync.runPelotonSync()
  assert.equal(synced.synced, 0)
  assert.equal(synced.skipped, 1)
  assert.ok(rows.get(created.id).deletedAt)
})

test('workout form waits for save and retains inputs and error on failure', async () => {
  let resets = 0
  let rejectSave
  const requestIds = []
  const values = { date: '2026-10-12', source: 'Gym', activity: 'Cycling', minutes: 30 }
  const form = { register: () => ({}), watch: key => values[key], reset: () => resets++, setValue: () => {}, formState: { errors: {}, isSubmitting: false }, handleSubmit: callback => () => callback(values) }
  const { WorkoutForm } = loadTs('src/components/WorkoutForm.tsx', {
    'react-hook-form': { useForm: () => form },
  })
  let renderer
  await act(async () => { renderer = create(React.createElement(WorkoutForm, { onSubmit: (_session, key) => {
    requestIds.push(key)
    return new Promise((_resolve, reject) => { rejectSave = reject })
  } })) })
  const initialResets = resets
  let pending
  act(() => { pending = renderer.root.findByType('form').props.onSubmit() })
  assert.equal(resets, initialResets)
  await act(async () => { rejectSave(new Error('Connection lost')); await pending })
  assert.equal(resets, initialResets)
  assert.equal(renderer.root.findByProps({ role: 'alert' }).children.join(''), 'Connection lost')
  await act(async () => { renderer.update(React.createElement(WorkoutForm, { onSubmit: async (_session, key) => { requestIds.push(key) } })); })
  await act(async () => { await renderer.root.findByType('form').props.onSubmit() })
  assert.equal(resets, initialResets + 1)
  assert.equal(requestIds[0], requestIds[1])
  await act(async () => { await renderer.root.findByType('form').props.onSubmit() })
  assert.notEqual(requestIds[1], requestIds[2])
  renderer.unmount()
})
