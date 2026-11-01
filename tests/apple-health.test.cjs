const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function loadTs(path, mocks = {}) {
  const { outputText } = ts.transpileModule(readFileSync(resolve(__dirname, '..', path), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  })
  const exports = {}
  vm.runInNewContext(outputText, { exports, require: name => mocks[name] ?? require(name), Buffer, Date, Math, console, process })
  return exports
}

// Minimal Prisma stand-in for workout_sessions, health_samples, health_metrics and body_measurements.
// Batched operations are thunks that $transaction runs in order.
function fakeDb(seed = {}) {
  const workouts = [...(seed.workouts ?? [])]
  const metrics = []
  let samples = []
  const weights = [...(seed.weights ?? [])]
  let id = 0
  const inRange = (value, cond) => (cond.gte == null || value >= cond.gte) && (cond.lte == null || value <= cond.lte)
  const prisma = {
    workoutSession: {
      findMany: async ({ where }) => workouts.filter(w =>
        (where.source == null || w.source === where.source) &&
        (where.pelotonWorkoutId == null || w.pelotonWorkoutId != null) &&
        (where.activity == null || w.activity === where.activity) && w.deletedAt == null && inRange(w.date, where.date)),
      deleteMany: async ({ where }) => {
        const before = workouts.length
        for (let i = workouts.length - 1; i >= 0; i--) {
          if (workouts[i].healthWorkoutId === where.healthWorkoutId && workouts[i].source === where.source) workouts.splice(i, 1)
        }
        return { count: before - workouts.length }
      },
      findUnique: async ({ where }) => workouts.find(w => w.healthWorkoutId === where.healthWorkoutId) ?? null,
      create: async ({ data }) => { const row = { id: `w${++id}`, deletedAt: null, ...data }; workouts.push(row); return row },
      update: async ({ where, data }) => Object.assign(workouts.find(w => w.id === where.id), data),
    },
    healthSample: {
      deleteMany: ({ where }) => () => { samples = samples.filter(x => !(x.name === where.name && inRange(x.at, where.at))) },
      createMany: ({ data }) => () => {
        for (const row of data) {
          if (samples.some(x => x.name === row.name && x.at.getTime() === row.at.getTime())) throw new Error('unique violation')
          samples.push({ ...row })
        }
      },
      findMany: async ({ where }) => samples.filter(x => x.name === where.name &&
        where.day.in.some(d => d.getTime() === x.day.getTime())),
    },
    healthMetric: {
      upsert: ({ where, update, create }) => () => {
        const key = where.name_date
        const row = metrics.find(m => m.name === key.name && m.date.getTime() === key.date.getTime())
        if (row) Object.assign(row, update)
        else metrics.push({ ...create })
      },
    },
    bodyMeasurement: {
      findUnique: async ({ where }) => weights.find(w => w.date.getTime() === where.date.getTime()) ?? null,
      upsert: async ({ where, update, create }) => {
        const row = weights.find(w => w.date.getTime() === where.date.getTime())
        if (row) return Object.assign(row, update)
        weights.push(create)
        return create
      },
    },
    $transaction: async ops => { for (const op of ops) typeof op === 'function' ? op() : await op },
  }
  return { prisma, workouts, metrics, weights, samples: () => samples }
}

function load(seed) {
  const db = fakeDb(seed)
  const health = loadTs('src/lib/apple-health.ts', {
    '@/lib/prisma': { default: db.prisma },
    '@/lib/workout-match': loadTs('src/lib/workout-match.ts'),
  })
  return { health, db }
}

test('Health Auto Export dates parse with their offset; bad dates are rejected', () => {
  const { health } = load()
  assert.equal(health.parseHealthDate('2026-10-30 07:15:00 -0700').toISOString(), '2026-10-30T14:15:00.000Z')
  assert.equal(health.parseHealthDate('2026-10-30T07:15:00-07:00').toISOString(), '2026-10-30T14:15:00.000Z')
  assert.equal(health.parseHealthDate('2026-10-30 07:15:00 +0530').toISOString(), '2026-10-30T01:45:00.000Z')
  for (const bad of [undefined, '', 'yesterday', '2026-13-01 00:00:00 -0700']) assert.equal(health.parseHealthDate(bad), null)
})

test('workout names map onto the app activity names', () => {
  const { health } = load()
  assert.equal(health.healthActivity('Outdoor Walk'), 'Walking')
  assert.equal(health.healthActivity('Indoor Run'), 'Running')
  assert.equal(health.healthActivity('Outdoor Cycle'), 'Cycling')
  assert.equal(health.healthActivity('Hiking'), 'Hiking')
  assert.equal(health.healthActivity('Traditional Strength Training'), 'Weight Lifting')
  assert.equal(health.healthActivity('Pickleball'), 'Pickleball')
  assert.equal(health.healthActivity(undefined), 'Other')
})

test('watch workouts are created once and updated on re-send, with unit conversion', async () => {
  const { health, db } = load()
  const payload = { data: { workouts: [{
    id: 'HK-1', name: 'Outdoor Run', start: '2026-10-30 07:00:00 -0700', end: '2026-10-30 07:31:00 -0700',
    duration: 1860, distance: { qty: 5, units: 'km' }, activeEnergyBurned: { qty: 1255, units: 'kJ' },
    heartRate: { avg: { qty: 151.4 }, max: { qty: 171.6 } },
  }] } }
  const first = await health.ingestHealthPayload(payload)
  assert.equal(first.workoutsCreated, 1)
  const row = db.workouts[0]
  assert.equal(row.source, 'Apple Watch')
  assert.equal(row.activity, 'Running')
  assert.equal(row.minutes, 31)
  assert.equal(row.miles, 3.11)
  assert.equal(row.calories, 300)
  assert.equal(row.avgHeartRate, 151)
  assert.equal(row.maxHeartRate, 172)
  assert.equal(row.healthWorkoutId, 'HK-1')

  const again = await health.ingestHealthPayload(payload)
  assert.equal(again.workoutsUpdated, 1)
  assert.equal(db.workouts.length, 1)

  row.deletedAt = new Date()
  const afterDelete = await health.ingestHealthPayload(payload)
  assert.equal(afterDelete.workoutsSkipped, 1) // a workout deleted in the app is not resurrected
  assert.equal(row.deletedAt instanceof Date, true)
})

test('a Peloton class echoed into Health only lends its heart rate to the Peloton row', async () => {
  const peloton = { id: 'p1', pelotonWorkoutId: 'pw1', source: 'Peloton', activity: 'Weight Lifting', date: new Date('2026-10-30T13:00:30Z'),
    minutes: 20, deletedAt: null, avgHeartRate: null, maxHeartRate: null }
  const { health, db } = load({ workouts: [peloton] })
  const result = await health.ingestHealthPayload({ data: { workouts: [{
    id: 'HK-2', name: 'Traditional Strength Training', start: '2026-10-30 06:00:00 -0700', duration: 1230,
    avgHeartRate: { qty: 118 }, maxHeartRate: { qty: 149 },
  }] } })
  assert.equal(result.workoutsMergedIntoPeloton, 1)
  assert.equal(db.workouts.length, 1)
  assert.equal(peloton.avgHeartRate, 118)
  assert.equal(peloton.maxHeartRate, 149)

  // Peloton's own heart rate wins when it has one.
  peloton.avgHeartRate = 120
  await health.ingestHealthPayload({ data: { workouts: [{ name: 'Traditional Strength Training',
    start: '2026-10-30 06:00:00 -0700', duration: 1230, avgHeartRate: { qty: 99 } }] } })
  assert.equal(peloton.avgHeartRate, 120)
})

test('workouts without a usable start or duration are skipped', async () => {
  const { health, db } = load()
  const result = await health.ingestHealthPayload({ data: { workouts: [
    { name: 'Walk' }, { name: 'Walk', start: 'bad' }, { name: 'Walk', start: '2026-10-30 07:00:00 -0700', duration: 20 },
  ] } })
  assert.equal(result.workoutsSkipped, 3)
  assert.equal(db.workouts.length, 0)
})

test('metrics roll up per local day, ignore unknown metrics, and replace on re-send', async () => {
  const { health, db } = load()
  const payload = { data: { metrics: [
    { name: 'step_count', units: 'count', data: [
      { date: '2026-10-30 08:00:00 -0700', qty: 4000 }, { date: '2026-10-30 21:00:00 -0700', qty: 6000 },
      { date: '2026-10-31 00:30:00 -0700', qty: 100 },
    ] },
    { name: 'heart_rate', units: 'count/min', data: [
      { date: '2026-10-30 08:00:00 -0700', Min: 52, Avg: 70, Max: 140 }, { date: '2026-10-30 18:00:00 -0700', Min: 58, Avg: 80, Max: 165 },
    ] },
    { name: 'resting_heart_rate', units: 'count/min', data: [{ date: '2026-10-30 00:00:00 -0700', qty: 54 }] },
    { name: 'dietary_sugar', units: 'g', data: [{ date: '2026-10-30 00:00:00 -0700', qty: 10 }] },
  ] } }
  const result = await health.ingestHealthPayload(payload)
  assert.equal(result.metricDays, 4)
  const find = (name, day) => db.metrics.find(m => m.name === name && m.date.toISOString().startsWith(day))
  assert.equal(find('step_count', '2026-10-30').qty, 10000)
  assert.equal(find('step_count', '2026-10-31').qty, 100) // local day, not UTC day
  const hr = find('heart_rate', '2026-10-30')
  assert.deepEqual([hr.min, hr.avg, hr.max], [52, 75, 165])
  assert.equal(find('resting_heart_rate', '2026-10-30').qty, 54)
  assert.equal(db.metrics.some(m => m.name === 'dietary_sugar'), false) // no daily summary...
  assert.equal(db.samples().filter(x => x.name === 'dietary_sugar').length, 1) // ...but kept raw

  await health.ingestHealthPayload(payload)
  assert.equal(db.metrics.length, 4)
  assert.equal(find('step_count', '2026-10-30').qty, 10000)
})

test('Health weigh-ins convert kg and never overwrite a manual entry', async () => {
  const manualDay = new Date('2026-10-29T00:00:00Z')
  const { health, db } = load({ weights: [{ date: manualDay, weightLbs: 181, source: 'Manual' }] })
  const result = await health.ingestHealthPayload({ data: { metrics: [{ name: 'weight_body_mass', units: 'kg', data: [
    { date: '2026-10-29 07:00:00 -0700', qty: 80 }, { date: '2026-10-30 07:00:00 -0700', qty: 81 },
  ] }] } })
  assert.equal(result.weightDays, 1)
  assert.equal(db.weights.find(w => w.date.getTime() === manualDay.getTime()).weightLbs, 181)
  const synced = db.weights.find(w => w.date.toISOString().startsWith('2026-10-30'))
  assert.equal(synced.weightLbs, 178.6)
  assert.equal(synced.source, 'Apple Health')
})

test('ingest route requires HEALTH_INGEST_TOKEN (not the MCP token) and a Health Auto Export body', async () => {
  const calls = []
  const env = { HEALTH_INGEST_TOKEN: 'health-token-0123456789', MCP_API_TOKEN: 'mcp-token-0123456789abc' }
  const saved = { ...process.env }
  Object.assign(process.env, env)
  try {
    const route = loadTs('src/app/api/health/ingest/route.ts', {
      '@/lib/api-auth': loadTs('src/lib/api-auth.ts'),
      '@/lib/apple-health': { ingestHealthPayload: async payload => { calls.push(payload); return { workoutsCreated: 0 } } },
      '@/lib/audit-log': { logAudit: async () => {} },
      '@/lib/rate-limit': { limitHealthIngest: () => null },
    })
    const post = (auth, body = { data: { workouts: [] } }) => route.POST(new Request('https://fit.example/api/health/ingest', {
      method: 'POST', headers: auth ? { Authorization: auth, 'Content-Type': 'application/json' } : {}, body: JSON.stringify(body),
    }))
    for (const auth of [null, 'Bearer wrong-token-0123456789', `Bearer ${env.MCP_API_TOKEN}`]) {
      assert.equal((await post(auth)).status, 401)
    }
    assert.equal((await post(`Bearer ${env.HEALTH_INGEST_TOKEN}`, { nope: true })).status, 400)
    assert.equal(calls.length, 0)
    assert.equal((await post(`Bearer ${env.HEALTH_INGEST_TOKEN}`)).status, 200)
    assert.equal(calls.length, 1)

    delete process.env.HEALTH_INGEST_TOKEN
    assert.equal((await post('Bearer ')).status, 401) // unset secret never authorizes
  } finally {
    for (const key of Object.keys(env)) delete process.env[key]
    Object.assign(process.env, saved)
  }
})

test('incremental and overlapping pushes keep daily totals right at any granularity', async () => {
  const { health, db } = load()
  const push = data => health.ingestHealthPayload({ data: { metrics: [{ name: 'step_count', units: 'count', data }] } })
  const day = () => db.metrics.find(m => m.name === 'step_count' && m.date.toISOString().startsWith('2026-10-30'))

  // Minute-level points, then a "since last sync" push with only later points.
  await push([{ date: '2026-10-30 08:00:00 -0700', qty: 100 }, { date: '2026-10-30 08:01:00 -0700', qty: 50 }])
  await push([{ date: '2026-10-30 12:00:00 -0700', qty: 300 }])
  assert.equal(day().qty, 450)

  // Re-sending an overlapping span replaces those points instead of adding them,
  // including a point whose value grew since the last push.
  await push([{ date: '2026-10-30 08:01:00 -0700', qty: 60 }, { date: '2026-10-30 12:00:00 -0700', qty: 300 }])
  assert.equal(day().qty, 460)
  assert.equal(db.samples().length, 3)

  // A batch for a later span leaves earlier stored points alone.
  await push([{ date: '2026-10-30 20:00:00 -0700', qty: 40 }])
  assert.equal(day().qty, 500)
  assert.equal(db.metrics.length, 1)
})

test('day summaries: sums for totals, means for rates, range for heart rate', () => {
  const { health } = load()
  const pts = [{ qty: 2, min: null, avg: null, max: null }, { qty: 4, min: null, avg: null, max: null }]
  assert.equal(health.summarizeDay('step_count', pts).qty, 6)
  assert.equal(health.summarizeDay('apple_stand_hour', pts).qty, 6)
  assert.equal(health.summarizeDay('resting_heart_rate', pts).qty, 3)
  const hr = health.summarizeDay('heart_rate', [{ qty: null, min: 50, avg: 70, max: 120 }, { qty: null, min: 60, avg: 90, max: 150 }])
  assert.deepEqual([hr.min, hr.avg, hr.max, hr.qty], [50, 80, 150, null])
  assert.equal(health.parseSamples({ name: 'dietary_sugar', data: [{ date: '2026-10-30 08:00:00 -0700', qty: 1 }] }).length, 1)
  assert.equal(health.parseSamples({ name: '', data: [{ date: '2026-10-30 08:00:00 -0700', qty: 1 }] }).length, 0)
  assert.equal(health.parseSamples({ name: 'step_count', data: [{ date: 'bad', qty: 1 }, { date: '2026-10-30 08:00:00 -0700' }] }).length, 0)
})

test('Peloton echoes merge by timing even when Health calls them "Other", and earlier duplicates are removed', async () => {
  const cardio = { id: 'p1', pelotonWorkoutId: 'pw1', source: 'Peloton', activity: 'Cardio', date: new Date('2026-10-30T21:55:10Z'),
    minutes: 5, deletedAt: null, avgHeartRate: null, maxHeartRate: null }
  const strength = { id: 'p2', pelotonWorkoutId: 'pw2', source: 'Peloton', activity: 'Weight Lifting', date: new Date('2026-10-23T15:40:00Z'),
    minutes: 10, deletedAt: null, avgHeartRate: 120, maxHeartRate: 140 }
  // A duplicate left behind by a push made before the matching fix.
  const stale = { id: 'w-old', source: 'Apple Watch', activity: 'Other', healthWorkoutId: 'HK-echo',
    date: new Date('2026-10-30T21:55:00Z'), minutes: 5, deletedAt: null }
  const { health, db } = load({ workouts: [cardio, strength, stale] })
  const result = await health.ingestHealthPayload({ data: { workouts: [
    { id: 'HK-echo', name: 'Other', start: '2026-10-30 14:55:00 -0700', duration: 305, avgHeartRate: { qty: 108 } },
    { id: 'HK-bw', name: 'Other', start: '2026-10-23 08:41:00 -0700', duration: 780, avgHeartRate: { qty: 136 } },
  ] } })
  assert.equal(result.workoutsMergedIntoPeloton, 2)
  assert.equal(result.workoutsCreated, 0)
  assert.equal(db.workouts.some(w => w.id === 'w-old'), false)
  assert.equal(db.workouts.length, 2)
  assert.equal(cardio.avgHeartRate, 108)
  assert.equal(strength.avgHeartRate, 120) // Peloton's own reading wins
})

test('echo timing: close start and real overlap only', () => {
  const { health } = load()
  const p = { date: new Date('2026-10-30T12:00:00Z'), minutes: 20 }
  assert.equal(health.isPelotonEcho(p, new Date('2026-10-30T12:02:00Z'), 20), true)
  assert.equal(health.isPelotonEcho(p, new Date('2026-10-30T12:04:00Z'), 20), true) // watch started late
  assert.equal(health.isPelotonEcho(p, new Date('2026-10-30T12:06:00Z'), 20), false) // started 6 min apart
  assert.equal(health.isPelotonEcho(p, new Date('2026-10-30T12:00:00Z'), 60), true) // watch kept running after
  assert.equal(health.isPelotonEcho({ ...p, minutes: 2 }, new Date('2026-10-30T12:03:00Z'), 30), false) // no overlap
})

test('an Apple Watch run the Peloton app imported is the same session as its Health copy', async () => {
  const imported = { id: 'p3', pelotonWorkoutId: 'pw3', source: 'Apple Watch', activity: 'Running', classTitle: 'Outdoor Running',
    date: new Date('2026-10-30T15:20:00Z'), minutes: 11, deletedAt: null, avgHeartRate: 174, maxHeartRate: null }
  const { health, db } = load({ workouts: [imported] })
  const result = await health.ingestHealthPayload({ data: { workouts: [{
    id: 'HK-run', name: 'Outdoor Run', start: '2026-10-30 11:20:00 -0400', duration: 647, maxHeartRate: { qty: 181 },
  }] } })
  assert.equal(result.workoutsMergedIntoPeloton, 1)
  assert.equal(db.workouts.length, 1)
  assert.equal(imported.maxHeartRate, 181)
})

test('when two synced sessions start together, the echo merges into the one of matching length', async () => {
  const core = { id: 'p1', pelotonWorkoutId: 'pw1', source: 'Peloton', activity: 'Weight Lifting', classTitle: '20 min Core Strength',
    date: new Date('2026-03-14T15:45:00Z'), minutes: 20, deletedAt: null, avgHeartRate: null, maxHeartRate: null }
  const imported = { id: 'p2', pelotonWorkoutId: 'pw2', source: 'Apple Watch', activity: 'Cardio', classTitle: 'Workout',
    date: new Date('2026-03-14T15:45:20Z'), minutes: 7, deletedAt: null, avgHeartRate: null, maxHeartRate: null }
  const { health, db } = load({ workouts: [core, imported] })
  const result = await health.ingestHealthPayload({ data: { workouts: [
    { id: 'HK-a', name: 'Functional Strength Training', start: '2026-03-14 10:45:00 -0500', duration: 1320, avgHeartRate: { qty: 120 } },
    { id: 'HK-b', name: 'Other', start: '2026-03-14 10:45:20 -0500', duration: 420, avgHeartRate: { qty: 99 } },
  ] } })
  assert.equal(result.workoutsMergedIntoPeloton, 2)
  assert.equal(db.workouts.length, 2)
  assert.equal(core.avgHeartRate, 120)
  assert.equal(imported.avgHeartRate, 99)
})
