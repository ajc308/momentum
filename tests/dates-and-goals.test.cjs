const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
function load(path, mocks = {}, globals = {}) {
  const { outputText } = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX,
  } })
  const exports = {}
  vm.runInNewContext(outputText, { exports, require: name => mocks[name] ?? (name.startsWith('../utils/') ? load('src/utils/' + name.slice(9) + '.ts') :
    (name.startsWith('@/lib/workout-date') || name.startsWith('@/lib/calendar') || name.startsWith('@/lib/goal-input') || name.startsWith('@/lib/body-fat') || name.startsWith('@/utils/')
      ? load('src/' + name.slice(2) + '.ts') : require(name))),
    Date, Error, Request, Response, URL, console: { log() {}, warn() {}, error() {}, info() {} }, process, ...globals }, { filename: path })
  return exports
}
const calendar = load('src/lib/calendar.ts')
const periods = load('src/utils/goalPeriods.ts')
const totals = load('src/utils/workoutTotals.ts')
const calculations = load('src/utils/goalCalculations.ts')
const session = (date, extra = {}) => ({ id: date, date: new Date(date), source: 'Cannondale', activity: 'Cycling', minutes: 40, miles: 10, ...extra })

test('workout day and server year boundaries use New York, including winter/summer and DST', () => {
  assert.equal(calendar.workoutDay(new Date('2027-01-01T04:59:59Z')), '2026-12-31')
  assert.equal(calendar.workoutDay(new Date('2027-01-01T05:00:00Z')), '2027-01-01')
  assert.equal(calendar.yearRange(2026).gte.toISOString(), '2026-01-01T05:00:00.000Z')
  assert.equal(calendar.yearRange(2026).lt.toISOString(), '2027-01-01T05:00:00.000Z')
  assert.equal(calendar.trackerMidnight('2026-07-01').toISOString(), '2026-07-01T04:00:00.000Z')
  assert.equal(calendar.trackerMidnight('2026-03-08').toISOString(), '2026-03-08T05:00:00.000Z')
  assert.equal(calendar.trackerMidnight('2026-03-09').toISOString(), '2026-03-09T04:00:00.000Z')
})

test('calendar-only measurement labels do not shift to the previous day across browser timezones', () => {
  const previous = process.env.TZ
  try {
    for (const zone of ['UTC', 'America/New_York', 'Asia/Tokyo']) {
      process.env.TZ = zone
      const display = calendar.measurementCalendarDate(new Date('2026-09-21T00:00:00Z'))
      assert.equal(display.getFullYear(), 2026)
      assert.equal(display.getMonth(), 8)
      assert.equal(display.getDate(), 21)
      assert.equal(calendar.workoutCalendarDate(new Date('2027-01-01T04:59:59Z')).getFullYear(), 2026)
    }
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous }
})

test('quarter/year final day is included, next midnight excluded, and leap/DST day pacing stays finite', () => {
  const rows = [session('2026-04-01T03:59:59Z'), session('2026-04-01T04:00:00Z'), session('2025-12-31T23:00:00Z')]
  const q1 = periods.periodMetrics(rows, 2026, 1, new Date('2026-04-01T03:59:59Z'))
  assert.equal(q1.sessions, 1)
  assert.equal(q1.fraction, 1)
  assert.equal(q1.daysRemaining, 1)
  assert.equal(periods.periodMetrics([], 2024, 1, new Date('2024-03-01T05:00:00Z')).fraction, 61 / 91)
  assert.equal(periods.periodMetrics([], 2026, 1, new Date('2026-03-09T04:00:00Z')).fraction, 68 / 90)
  assert.equal(periods.selectedQuarter(2025, new Date('2026-10-13T16:00:00Z')), 4)
  assert.equal(periods.selectedQuarter(2027, new Date('2026-10-13T16:00:00Z')), 1)
  assert.equal(periods.periodMetrics([], 2027, 1, new Date('2026-10-13T16:00:00Z')).fraction, 0)
})

test('goal calculation uses selected goal year and the same formula for every year', () => {
  for (const year of [2025, 2026, 2027]) {
    const goal = calculations.createGoal('Fitness', year, 1000000, 30, 4)
    assert.equal(goal.weeklyMinutesTarget, 120)
    assert.equal(goal.annualMinutesTarget, 6240)
    assert.equal(goal.quarterlyMinutesTarget, 1560)
  }
  const goal = calculations.createGoal('Fitness', 2025, 1000000, 30, 4)
  const enhanced = [session('2025-12-31T20:00:00Z', { adjustedMinutes: 60 })]
  const result = calculations.calculateGoalProgress(goal, enhanced, new Date('2026-10-13T16:00:00Z'))
  assert.equal(result.currentYear, 2025)
  assert.equal(result.currentQuarter, 4)
  assert.equal(result.actualMinutes.yearToDate, 60)
  assert.equal(result.expectedMinutes.yearToDate, 6240)
  assert.equal(result.daysRemainingInQuarter, 0)
})

function goalRoutes() {
  const rows = new Map()
  let tail = Promise.resolve()
  const goal = {
    create: async ({ data }) => { const row = { id: 'goal', ...data }; rows.set(row.id, row); return row },
    findUnique: async ({ where }) => rows.get(where.id) ?? null,
    update: async ({ where, data }) => { const row = { ...rows.get(where.id), ...data }; rows.set(where.id, row); return row },
  }
  const db = { goal, $transaction: async fn => {
    const wait = tail; let release; tail = new Promise(resolve => { release = resolve }); await wait
    try { return await fn({ goal, $executeRaw: async () => 1 }) } finally { release() }
  } }
  const route = load('src/app/api/goals/route.ts', { '@/lib/audit-log': { logAudit: async () => {} }, '@/lib/prisma': { default: db }, '@/lib/auth': { requireAuth: async () => null } })
  const call = (method, body) => route[method](new Request('http://localhost/api/goals', { method,
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
  return { call, rows }
}
test('goal API partial and concurrent edits preserve omitted fields and recalculate valid targets', async () => {
  const { call } = goalRoutes()
  const created = await call('POST', { name: 'Fitness', year: 2026, annualWeightTarget: 1000000, minutesPerSession: 30, weeklySessionsTarget: 4 })
  assert.equal(created.status, 201)
  const renamed = await call('PUT', { id: 'goal', name: 'Renamed' })
  assert.equal(renamed.status, 200)
  assert.equal((await renamed.json()).goal.annualMinutesTarget, 6240)
  await Promise.all([call('PUT', { id: 'goal', minutesPerSession: 45 }), call('PUT', { id: 'goal', weeklySessionsTarget: 5 })])
  const final = await (await call('PUT', { id: 'goal', name: 'Final' })).json()
  assert.equal(final.goal.minutesPerSession, 45)
  assert.equal(final.goal.weeklySessionsTarget, 5)
  assert.equal(final.goal.weeklyMinutesTarget, 225)
  assert.equal((await call('PUT', { id: 'missing', name: 'Changed' })).status, 404)
  for (const patch of [{ year: 2026.5 }, { minutesPerSession: null }, { name: ' ' }, { weeklySessionsTarget: -1 }]) {
    assert.equal((await call('PUT', { id: 'goal', ...patch })).status, 400)
  }
})

test('REST workout year filter uses the same inclusive/exclusive boundaries as the dashboard', async () => {
  let where
  const route = load('src/app/api/workouts/route.ts', {
    '@/lib/prisma': { default: { workoutSession: { findMany: async args => { where = args.where; return [] } } } },
    '@/lib/auth': { requireAuth: async () => null }, '@/lib/audit-log': { logAudit: async () => {} },
  })
  assert.equal((await route.GET(new Request('http://localhost/api/workouts?year=2026'))).status, 200)
  assert.equal(where.date.gte.toISOString(), '2026-01-01T05:00:00.000Z')
  assert.equal(where.date.lt.toISOString(), '2027-01-01T05:00:00.000Z')
  assert.equal((await route.GET(new Request('http://localhost/api/workouts?year=2026foo'))).status, 400)
})

function measurementRoute(bodyMeasurement, audits = []) {
  const prisma = { '@/lib/prisma': { default: { bodyMeasurement } } }
  return load('src/app/api/body-measurements/route.ts', { ...prisma,
    '@/lib/auth': { requireAuth: async () => null },
    '@/lib/audit-log': { logAudit: async (_req, _auth, action) => audits.push(action) },
    '@/lib/body-weight': load('src/lib/body-weight.ts', prisma),
  })
}

test('measurement range API validates calendar days and includes the requested final day', async () => {
  let where
  const route = measurementRoute({ findMany: async args => { where = args.where; return [] } })
  assert.equal((await route.GET(new Request('http://localhost/api/body-measurements?from=2026-09-01&to=2026-09-21'))).status, 200)
  assert.equal(where.date.lte.toISOString(), '2026-09-21T00:00:00.000Z')
  for (const query of ['from=2026-02-30','from=nope','from=2026-09-22&to=2026-09-21']) {
    assert.equal((await route.GET(new Request('http://localhost/api/body-measurements?' + query))).status, 400)
  }
})

test('weigh-in POST validates input and upserts one row per calendar day; DELETE removes by id', async () => {
  const rows = new Map()
  const audits = []
  const route = measurementRoute({
    upsert: async ({ where, update, create }) => {
      const key = where.date.toISOString()
      const row = rows.has(key) ? Object.assign(rows.get(key), update) : { id: `m${rows.size + 1}`, ...create }
      rows.set(key, row)
      return row
    },
    deleteMany: async ({ where }) => {
      const entry = [...rows].find(([, row]) => row.id === where.id)
      if (entry) rows.delete(entry[0])
      return { count: entry ? 1 : 0 }
    },
  }, audits)
  const post = body => route.POST(new Request('http://localhost/api/body-measurements', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body),
  }))
  for (const body of ['not json', {}, { date: '2026-10-12' }, { date: '2026-02-30', weightLbs: 180 },
    { date: '10/12/2026', weightLbs: 180 }, { date: '2026-10-12T08:00:00Z', weightLbs: 180 },
    { date: '2026-10-12', weightLbs: 20 }, { date: '2026-10-12', weightLbs: '180' }, { date: '2026-10-12', weightLbs: 180, bodyFatPct: 90 }]) {
    assert.equal((await post(body)).status, 400, JSON.stringify(body))
  }
  assert.equal(rows.size, 0)
  const first = await post({ date: '2026-10-12', weightLbs: 181.4, bodyFatPct: 22 })
  assert.equal(first.status, 201)
  const created = await first.json()
  assert.equal(created.date, '2026-10-12T00:00:00.000Z')
  assert.equal(created.source, 'Manual')
  const again = await (await post({ date: '2026-10-12', weightLbs: 180 })).json()
  assert.equal(rows.size, 1)
  assert.equal(again.id, created.id)
  assert.equal(again.weightLbs, 180)
  assert.equal(again.bodyFatPct, null)
  await post({ date: '2026-10-13', weightLbs: 179 })
  assert.equal(rows.size, 2)
  const del = id => route.DELETE(new Request('http://localhost/api/body-measurements' + (id ? `?id=${id}` : ''), { method: 'DELETE' }))
  assert.equal((await del()).status, 400)
  assert.equal((await del('missing')).status, 404)
  assert.equal((await del(created.id)).status, 200)
  assert.equal(rows.size, 1)
  assert.deepEqual(audits, ['weight.log', 'weight.log', 'weight.log', 'weight.delete'])
})
