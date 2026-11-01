const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
function load(path, mocks = {}, globals = {}) {
  const { outputText } = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  })
  const exports = {}
  vm.runInNewContext(outputText, { exports, require: name => mocks[name] ?? require(name),
    Date, Error, console, AbortSignal, ...globals }, { filename: path })
  return exports
}
const matching = load('src/lib/workout-match.ts')
const workout = (id, source = 'Peloton', time = '08:05', extra = {}) => ({ id, source,
  activity: 'Weight Lifting', date: new Date(`2026-10-12T${time}:00Z`), minutes: 40,
  weightLifted: null, notes: 'Strength Training',
  pelotonWorkoutId: source === 'Peloton' ? id : null, deletedAt: null, ...extra })

test('matching rejects separate same-day sessions, date-only entries, different activities and ambiguous candidates', () => {
  const a = workout('a')
  assert.equal(matching.sameWorkout(a, workout('b', 'Peloton', '08:07')), true)
  for (const b of [workout('b', 'Peloton', '17:05'), workout('b', 'Peloton', '12:00'),
    workout('b', 'Peloton', '08:07', { activity: 'Cycling' }), workout('b', 'Peloton', '08:07', { minutes: 10 })]) {
    assert.equal(matching.sameWorkout(a, b), false)
  }
  assert.equal(matching.uniqueWorkoutMatch([a, workout('b')], workout('incoming')), undefined)
})

// A transactional fake enforces the same lock boundary and restores writes on
// failure. The tests run the real orchestrator and the real transaction helper.
function database(initial = []) {
  let rows = structuredClone(initial)
  let tail = Promise.resolve()
  const writes = []
  const matches = (row, where = {}) => Object.entries(where).every(([key, val]) => {
    if (key === 'date') return row.date >= val.gte && row.date <= val.lte
    if (val === null) return row[key] == null
    if (val && typeof val === 'object' && val.in) return val.in.includes(row[key])
    return row[key] === val
  })
  const session = {
    findMany: async ({ where } = {}) => rows.filter(row => matches(row, where)),
    findUnique: async ({ where }) => rows.find(row => matches(row, where)) ?? null,
    updateMany: async ({ where, data }) => {
      writes.push({ where, data })
      const found = rows.filter(row => matches(row, where))
      found.forEach(row => Object.assign(row, data))
      return { count: found.length }
    },
    create: async ({ data }) => {
      if (rows.some(row => data.pelotonWorkoutId && row.pelotonWorkoutId === data.pelotonWorkoutId)) {
        throw new Error('duplicate external ID')
      }
      const row = { id: `new-${rows.length}`, deletedAt: null, ...data }
      rows.push(row)
      return row
    },
  }
  const db = { workoutSession: session,
    pelotonCredential: { findFirst: async () => ({ sessionId: 'session', userId: 'user' }) },
    $transaction: async fn => {
      const before = tail
      let release
      tail = new Promise(resolve => { release = resolve })
      await before
      const snapshot = structuredClone(rows)
      try { return await fn({ workoutSession: session, $executeRaw: async () => 1 }) }
      catch (err) { rows = snapshot; throw err }
      finally { release() }
    },
  }
  const boundary = load('src/lib/sync-write.ts', { '@/lib/prisma': { default: db } })
  const mocks = { '@/lib/prisma': { default: db }, '@/lib/sync-write': boundary,
    '@/lib/workout-match': matching, '@/lib/crypto': { decryptSecret: x => x, encryptSecret: x => x } }
  return { mocks, db, rows: () => rows, writes }
}

// The real Peloton client, with only the network edge replaced.
function pelotonModule(fixture, fetchImpl = async () => { throw new Error('unexpected fetch') }) {
  return load('src/lib/peloton.ts', { ...fixture.mocks, '@/lib/integration-fetch': { integrationFetch: fetchImpl } })
}
function pelotonSync(fixture, api) {
  const real = pelotonModule(fixture)
  return load('src/lib/peloton-sync.ts', { ...fixture.mocks, '@/lib/peloton': {
    mapPelotonWorkout: real.mapPelotonWorkout, pelotonClassDetails: real.pelotonClassDetails,
    fetchPelotonWorkoutSummary: async () => { throw new Error('no summary') }, ...api,
  } })
}
// A raw Peloton API workout as returned by /api/user/:id/workouts.
const apiWorkout = (id, time = '08:05', extra = {}) => ({
  id, status: 'COMPLETE', fitness_discipline: 'strength', name: 'Strength',
  start_time: Date.parse(`2026-10-12T${time}:00Z`) / 1000, end_time: Date.parse(`2026-10-12T${time}:00Z`) / 1000 + 2400,
  ride: { title: '40 min Full Body Strength', duration: 2400, instructor: { name: 'Andy Speer' } },
  ...extra,
})

test('pelotonClassDetails and mapPelotonWorkout map disciplines, class info and rounded metrics', () => {
  const peloton = pelotonModule(database())
  const strength = apiWorkout('w1', '08:05', { overall_summary: {
    calories: 312.6, avg_heart_rate: 128.4, max_heart_rate: 161.5, total_output: undefined, distance: 0,
  } })
  assert.deepEqual({ ...peloton.pelotonClassDetails(strength) }, {
    discipline: 'strength', classTitle: '40 min Full Body Strength', instructor: 'Andy Speer',
    calories: 313, avgHeartRate: 128, maxHeartRate: 162, totalOutputKj: null,
  })
  const mapped = peloton.mapPelotonWorkout(strength)
  assert.equal(mapped.source, 'Peloton')
  assert.equal(mapped.activity, 'Weight Lifting')
  assert.equal(mapped.minutes, 40)
  assert.equal(mapped.date.toISOString(), '2026-10-12T08:05:00.000Z')
  assert.equal(mapped.notes, '40 min Full Body Strength — w/ Andy Speer')
  assert.equal(mapped.pelotonWorkoutId, 'w1')
  assert.equal(mapped.avgHeartRate, 128)
  assert.equal(mapped.discipline, 'strength')
  for (const [discipline, activity] of [['outdoor', 'Cycling'], ['cycling', 'Cycling'], ['bike_bootcamp', 'Bike bootcamp'], ['', 'Other']]) {
    const row = peloton.mapPelotonWorkout(apiWorkout('w', '08:05', { fitness_discipline: discipline, ride: undefined, name: '' }))
    assert.equal(row.activity, activity, discipline)
    assert.equal(row.source, 'Peloton', discipline)
  }
  // Instructor-less classes report the title as the instructor name.
  const scenic = apiWorkout('w2', '08:05', { fitness_discipline: 'cycling',
    ride: { title: '30 min Snow Canyon Ride', duration: 1800, instructor: { name: '30 min Snow Canyon Ride' } } })
  assert.equal(peloton.pelotonClassDetails(scenic).instructor, null)
  assert.equal(peloton.mapPelotonWorkout(scenic).notes, '30 min Snow Canyon Ride')
  assert.equal(peloton.mapPelotonWorkout(scenic).source, 'Peloton')
  const bare = peloton.pelotonClassDetails({ fitness_discipline: '', name: '' })
  assert.deepEqual({ ...bare }, { discipline: null, classTitle: null, instructor: null,
    calories: null, avgHeartRate: null, maxHeartRate: null, totalOutputKj: null })
})

test('Apple Watch workouts the Peloton app imported are labeled Apple Watch with a clean title', () => {
  const peloton = pelotonModule(database())
  const t = peloton.appleWatchImportTitle
  assert.equal(t('10 min 47 sec Outdoor Running', null), 'Outdoor Running')
  assert.equal(t('25 min Cardio: Surfing Sports', null), 'Surfing Sports')
  assert.equal(t('5 min 5 sec Cardio: Other', null), 'Workout')
  assert.equal(t('16 min 55 sec Outdoor Running', 'JUST RUN'), null) // Peloton's own Just Run
  assert.equal(t('30 min Snow Canyon Ride', null), null) // Peloton scenic ride
  assert.equal(t('20 min Chest & Back Strength', 'Jermaine Johnson'), null)

  const run = apiWorkout('w9', '15:20', { fitness_discipline: 'running', ride: { title: '10 min 47 sec Outdoor Running', duration: 647,
    instructor: { name: '10 MIN 47 SEC OUTDOOR RUNNING' } } })
  const mapped = peloton.mapPelotonWorkout(run)
  assert.equal(mapped.source, 'Apple Watch')
  assert.equal(mapped.classTitle, 'Outdoor Running')
  assert.equal(mapped.notes, undefined)
  assert.equal(mapped.pelotonWorkoutId, 'w9') // still deduped by its Peloton id
})

test('workout summary reads heart rate from the performance graph metrics, falling back to summaries', async () => {
  const graphs = [
    { summaries: [{ slug: 'calories', value: 400 }, { slug: 'total_output', value: 300 }, { slug: 'avg_heart_rate', value: 99 }],
      metrics: [{ slug: 'output', average_value: 120 }, { slug: 'heart_rate', average_value: 141.2, max_value: 172 }] },
    { summaries: [{ slug: 'avg_heart_rate', value: 110 }, { slug: 'max_heart_rate', value: 150 }] },
  ]
  const urls = []
  const peloton = pelotonModule(database(), async url => { urls.push(url); return new Response(JSON.stringify(graphs.shift())) })
  const summary = await peloton.fetchPelotonWorkoutSummary('session', 'w1')
  assert.match(urls[0], /\/api\/workout\/w1\/performance_graph/)
  assert.equal(summary.calories, 400)
  assert.equal(summary.total_output, 300)
  assert.equal(summary.avg_heart_rate, 141.2)
  assert.equal(summary.max_heart_rate, 172)
  const details = peloton.pelotonClassDetails({ ...apiWorkout('w1'), overall_summary: summary })
  assert.equal(details.avgHeartRate, 141)
  assert.equal(details.maxHeartRate, 172)
  const fallback = await peloton.fetchPelotonWorkoutSummary('session', 'w2')
  assert.equal(fallback.avg_heart_rate, 110)
  assert.equal(fallback.max_heart_rate, 150)
})

test('every new workout fetches its graph summary and stores class details', async () => {
  const fixture = database()
  const summaries = []
  const client = pelotonSync(fixture, {
    fetchPelotonWorkouts: async () => ({ data: [
      apiWorkout('strength'),
      apiWorkout('ride', '17:05', { fitness_discipline: 'cycling' }),
    ], page_count: 1 }),
    fetchPelotonWorkoutSummary: async (_session, id) => { summaries.push(id); return { calories: 250.4, avg_heart_rate: 130, max_heart_rate: 160 } },
  })
  const result = await client.runPelotonSync()
  assert.equal(result.synced, 2)
  assert.deepEqual(summaries, ['strength', 'ride'])
  const strength = fixture.rows().find(row => row.pelotonWorkoutId === 'strength')
  assert.equal(strength.activity, 'Weight Lifting')
  assert.equal(strength.calories, 250)
  assert.equal(strength.avgHeartRate, 130)
  assert.equal(strength.instructor, 'Andy Speer')
})

test('already-synced rows without class details are backfilled once, then skipped', async () => {
  const fixture = database([
    workout('old', 'Peloton', '08:05', { discipline: null }),
    workout('done', 'Peloton', '17:05', { discipline: 'cycling', calories: 500 }),
  ])
  let summaries = 0
  const client = pelotonSync(fixture, {
    fetchPelotonWorkouts: async () => ({ data: [apiWorkout('old'), apiWorkout('done', '17:05', { fitness_discipline: 'cycling' })], page_count: 1 }),
    fetchPelotonWorkoutSummary: async () => { summaries++; return { calories: 199.6, avg_heart_rate: 120.5, max_heart_rate: 150 } },
  })
  const first = await client.runPelotonSync()
  assert.deepEqual({ ...first }, { synced: 0, updated: 1, skipped: 1, total: 2 })
  assert.equal(summaries, 1)
  assert.equal(fixture.rows().length, 2)
  const old = fixture.rows()[0]
  assert.equal(old.discipline, 'strength')
  assert.equal(old.classTitle, '40 min Full Body Strength')
  assert.equal(old.calories, 200)
  assert.equal(old.avgHeartRate, 121)
  assert.equal(old.minutes, 40)
  assert.deepEqual({ ...fixture.writes[0].where }, { pelotonWorkoutId: 'old', discipline: null, deletedAt: null })
  assert.equal(fixture.rows()[1].calories, 500)
  const second = await client.runPelotonSync()
  assert.deepEqual({ ...second }, { synced: 0, updated: 0, skipped: 2, total: 2 })
  assert.equal(summaries, 1)
  assert.equal(fixture.writes.length, 1)
})

test('backfill corrects source and activity left by the old outdoor mapping', async () => {
  const fixture = database([workout('run', 'Cannondale', '08:05', { activity: 'Cycling', discipline: null, pelotonWorkoutId: 'run' })])
  const client = pelotonSync(fixture, {
    fetchPelotonWorkouts: async () => ({ data: [apiWorkout('run', '08:05', { fitness_discipline: 'running', is_outdoor: true,
      ride: { title: '10 min 47 sec Outdoor Running', duration: 647, instructor: { name: '10 MIN 47 SEC OUTDOOR RUNNING' } } })], page_count: 1 }),
    fetchPelotonWorkoutSummary: async () => ({ calories: 136 }),
  })
  assert.equal((await client.runPelotonSync()).updated, 1)
  const row = fixture.rows()[0]
  assert.equal(row.source, 'Apple Watch') // an Apple Watch run the Peloton app imported
  assert.equal(row.activity, 'Running')
  assert.equal(row.discipline, 'running')
  assert.equal(row.instructor, null)
})

test('a matching manual Peloton entry is adopted with class details instead of duplicated', async () => {
  const fixture = database([workout('manual', 'Peloton', '08:05', { pelotonWorkoutId: null, notes: 'my note' })])
  const client = pelotonSync(fixture, {
    fetchPelotonWorkouts: async () => ({ data: [apiWorkout('incoming', '08:07')], page_count: 1 }),
    fetchPelotonWorkoutSummary: async () => ({ calories: 300 }),
  })
  const result = await client.runPelotonSync()
  assert.equal(result.updated, 1)
  assert.equal(result.synced, 0)
  assert.equal(fixture.rows().length, 1)
  const row = fixture.rows()[0]
  assert.equal(row.id, 'manual')
  assert.equal(row.pelotonWorkoutId, 'incoming')
  assert.equal(row.discipline, 'strength')
  assert.equal(row.calories, 300)
  assert.equal(row.notes, '40 min Full Body Strength — w/ Andy Speer')
})

test('concurrent imports of the same workout write once; a second same-day strength workout stays separate', async () => {
  const fixture = database([workout('gym', 'Gym')])
  const client = pelotonSync(fixture, {
    fetchPelotonWorkouts: async () => ({ data: [apiWorkout('peloton', '17:05', { overall_summary: {} })], page_count: 1 }),
  })
  const results = await Promise.all([client.runPelotonSync(), client.runPelotonSync()])
  assert.equal(results.reduce((sum, r) => sum + r.synced, 0), 1)
  assert.equal(fixture.rows().length, 2)
  assert.equal(fixture.rows()[0].pelotonWorkoutId, null)
})

test('a second Peloton strength session cannot disappear into an already-linked row', async () => {
  const fixture = database([workout('first', 'Peloton', '08:05', { discipline: 'strength' })])
  const client = pelotonSync(fixture, {
    fetchPelotonWorkouts: async () => ({ data: [apiWorkout('second', '08:07', { overall_summary: {} })], page_count: 1 }),
  })
  assert.equal((await client.runPelotonSync()).synced, 1)
  assert.equal(fixture.rows().length, 2)
  assert.equal(fixture.rows()[0].pelotonWorkoutId, 'first')
})

test('sync limits reject invalid/unbounded inputs before fetching', async () => {
  let fetches = 0
  const client = pelotonSync(database(), { fetchPelotonWorkouts: async () => { fetches++; return { data: [], page_count: 1 } } })
  for (const limit of [0, -1, NaN, Infinity, 1.5, 2001]) await assert.rejects(client.runPelotonSync(limit), /Sync limit/)
  assert.equal(fetches, 0)
})

test('upstream requests carry a 15-second abort signal', async () => {
  let options
  const signal = {}
  const client = load('src/lib/integration-fetch.ts', {}, {
    AbortSignal: { timeout: ms => { assert.equal(ms, 15000); return signal } },
    fetch: async (_url, init) => { options = init; return new Response('{}') },
  })
  await client.integrationFetch('https://example.test', { method: 'POST' })
  assert.equal(options.signal, signal)
  assert.equal(options.method, 'POST')
})

test('known first pages do not hide missing workouts on later pages, and the requested limit is exact', async () => {
  const fixture = database([workout('known', 'Peloton', '08:05', { discipline: 'strength' })])
  const pages = []
  const client = pelotonSync(fixture, {
    fetchPelotonWorkouts: async (_token, _user, page) => {
      pages.push(page)
      const base = page === 0 ? apiWorkout('known') : apiWorkout('new', '17:05')
      return { data: Array.from({ length: 50 }, () => ({ ...base, overall_summary: {} })), page_count: 9 }
    },
  })
  const result = await client.runPelotonSync(51)
  assert.deepEqual(pages, [0, 1])
  assert.equal(result.total, 51)
  assert.equal(result.synced, 1)
})
