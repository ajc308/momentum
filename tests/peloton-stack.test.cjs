const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Load a TS module; @/ imports resolve to real sources unless mocked.
function loader(mocks) {
  const cache = {}
  const load = rel => {
    if (cache[rel]) return cache[rel]
    const { outputText } = ts.transpileModule(readFileSync(resolve(__dirname, '..', rel), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    })
    const exports = {}
    cache[rel] = exports
    vm.runInNewContext(outputText, {
      exports, Buffer, Date, Intl, Math, URL, URLSearchParams, JSON, console,
      require: name => mocks[name] ?? (name.startsWith('@/') ? load(`src/${name.slice(2)}.ts`) : require(name)),
    })
    return exports
  }
  return load
}

const JJ = 'jj-instructor-id'
function fakePeloton({ stack = [], rides = {}, gqlAuthErrorFirst = false } = {}) {
  const calls = []
  let refreshed = 0
  let token = 'old.token'
  const state = { stack: [...stack] }
  const view = () => ({
    __typename: 'StackResponseSuccess', numClasses: state.stack.length, totalTime: state.stack.length * 600,
    userStack: { stackedClassList: state.stack.map((classId, i) => ({ playOrder: i, pelotonClass: { classId, title: `Class ${classId}`, duration: 600 } })) },
  })
  const json = (status, body) => ({ ok: status < 400, status, json: async () => body })
  const integrationFetch = async (url, init = {}) => {
    calls.push({ url, auth: init.headers?.Authorization, body: init.body })
    if (url.includes('/graphql')) {
      const { operationName, variables } = JSON.parse(init.body)
      if (gqlAuthErrorFirst && token === 'old.token') return json(200, { errors: [{ message: 'Unauthorized: insufficient scope' }] })
      if (operationName === 'ViewUserStack') return json(200, { data: { viewUserStack: view() } })
      if (operationName === 'AddClassToStack') {
        state.stack.push(JSON.parse(Buffer.from(variables.input.pelotonClassId, 'base64').toString()).ride_id)
        return json(200, { data: { addClassToStack: view() } })
      }
      if (operationName === 'ModifyStack') {
        state.stack = variables.input.pelotonClassIdList.map(t => JSON.parse(Buffer.from(t, 'base64').toString()).ride_id)
        return json(200, { data: { modifyStack: view() } })
      }
    }
    const u = new URL(url)
    if (u.pathname === '/api/instructor') return json(200, { data: [{ id: JJ, name: 'Jermaine Johnson' }, { id: 'other', name: 'Andy Speer' }] })
    if (u.pathname === '/api/v2/ride/archived') {
      const key = `${u.searchParams.get('duration') / 60}:${u.searchParams.get('instructor_id') ?? 'any'}`
      return json(200, { data: rides[key] ?? [], instructors: [{ id: JJ, name: 'Jermaine Johnson' }, { id: 'other', name: 'Andy Speer' }] })
    }
    return json(404, {})
  }
  const mocks = {
    '@/lib/integration-fetch': { integrationFetch },
    '@/lib/peloton': {
      PELOTON_API_BASE: 'https://api.onepeloton.com',
      pelotonHeaders: t => ({ Authorization: `Bearer ${t}` }),
      refreshPelotonCredential: async () => { refreshed++; token = 'new.token'; return { sessionId: token, userId: 'u' } },
    },
    '@/lib/peloton-sync': { getValidCredential: async () => ({ sessionId: token, userId: 'u' }) },
    '@/lib/prisma': { default: {} },
  }
  const load = loader(mocks)
  return { stack: load('src/lib/peloton-stack.ts'), catalog: load('src/lib/peloton-catalog.ts'), calls, state, refreshed: () => refreshed }
}

const id = n => n.toString(16).padStart(32, '0')
const ride = (n, title, minutes, instructor, aired) => ({ id: id(n), title, duration: minutes * 60, instructor_id: instructor, original_air_time: aired })

test('class ids come from bare ids or Peloton links; join tokens wrap the ride id', () => {
  const { stack } = fakePeloton()
  const rideId = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
  assert.equal(stack.parseClassId(rideId.toUpperCase()), rideId)
  assert.equal(stack.parseClassId(`https://members.onepeloton.com/classes/strength?modal=classDetailsModal&classId=${rideId}`), rideId)
  assert.equal(stack.parseClassId(`https://members.onepeloton.com/classes/player/${rideId}`), rideId)
  assert.equal(stack.parseClassId('not a class'), null)
  assert.deepEqual(JSON.parse(Buffer.from(stack.joinToken(rideId), 'base64').toString()),
    { home_peloton_id: null, ride_id: rideId, studio_peloton_id: null, type: 'on_demand' })
})

test('catalog picks: favorite instructor first, newest first, matching focus, skipping excluded and warm-ups', async () => {
  const { catalog } = fakePeloton({ rides: {
    [`20:${JJ}`]: [ride(1, '20 min Chest & Back Strength', 20, JJ, 1790000000), ride(2, '20 min Glutes & Legs Strength', 20, JJ, 1780000000),
      ride(3, '20 min Lower Body Strength', 20, JJ, 1770000000)],
    '20:any': [ride(4, '20 min Glutes & Legs Strength', 20, 'other', 1795000000), ride(2, '20 min Glutes & Legs Strength', 20, JJ, 1780000000)],
    [`10:${JJ}`]: [ride(5, '10 min Core Warm Up', 10, JJ, 1790000000), ride(6, '10 min Core Strength', 10, JJ, 1785000000)],
  } })
  const legs = await catalog.findClasses('legs', 20, 3)
  assert.deepEqual([...legs.map(c => c.title)], ['20 min Glutes & Legs Strength', '20 min Lower Body Strength', '20 min Glutes & Legs Strength'])
  assert.deepEqual([...legs.map(c => c.instructor)], ['Jermaine Johnson', 'Jermaine Johnson', 'Andy Speer'])
  assert.match(legs[0].url, /classId=0+2$/)

  const skipFirst = await catalog.findClasses('legs', 20, 1, new Set([id(2)]))
  assert.equal(skipFirst[0].rideId, id(3))

  const core = await catalog.findClasses('core', 10, 1)
  assert.equal(core[0].title, '10 min Core Strength') // warm-ups never count
})

test('append skips classes already stacked and stops at the 10-class limit; replace sets the order', async () => {
  const fake = fakePeloton({ stack: Array.from({ length: 8 }, (_, i) => id(100 + i)) })
  const result = await fake.stack.stackClasses([id(100), id(1), id(2), id(3)])
  assert.deepEqual([...result.alreadyStacked], [id(100)])
  assert.deepEqual([...result.added], [id(1), id(2)])
  assert.deepEqual([...result.skipped], [id(3)])
  assert.equal(fake.state.stack.length, 10)

  const replaced = await fake.stack.stackClasses([id(7), id(8)], 'replace')
  assert.deepEqual([...fake.state.stack], [id(7), id(8)])
  assert.equal(replaced.stack.numClasses, 2)
})

test('a token without the stack scope triggers one fresh login, then succeeds', async () => {
  const fake = fakePeloton({ gqlAuthErrorFirst: true })
  const view = await fake.stack.viewStack()
  assert.equal(view.numClasses, 0)
  assert.equal(fake.refreshed(), 1)
  assert.equal(fake.calls.at(-1).auth, 'Bearer new.token')
})
