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
  vm.runInNewContext(outputText, {
    exports, Date, Error, Request, Response, URL, console, Set, Map,
    require: name => mocks[name] ?? (name.startsWith('@/lib/') ? loadTs(`src/lib/${name.slice(6)}.ts`, mocks) : require(name)),
  })
  return exports
}

const muscles = loadTs('src/lib/muscle-groups.ts')
const training = loadTs('src/lib/training.ts')
const disciplines = loadTs('src/lib/disciplines.ts')
const plain = value => JSON.parse(JSON.stringify(value))

test('class titles map to the muscle groups they name', () => {
  const cases = {
    '20 min Chest & Back Strength': ['chest', 'back'],
    '10 min Arms & Shoulders Strength': ['shoulders', 'arms'],
    '5 min Core Strength': ['core'],
    '15 min Abs & Obliques': ['core'],
    '20 min Glutes & Legs Strength': ['legs'],
    '10 min Biceps & Triceps': ['arms'],
    '30 min Lower Body Strength': ['legs'],
    '20 min Upper Body Strength': ['chest', 'back', 'shoulders', 'arms'],
    '10 min Arms & Light Weights': ['arms'],
    '20 min Push Strength': ['chest', 'shoulders', 'arms'],
    '30 min Pull Strength': ['back', 'arms'],
  }
  for (const [title, groups] of Object.entries(cases)) assert.deepEqual(plain(muscles.muscleGroupsForTitle(title)), groups, title)
})

test('full body and plain bodyweight classes count for every group; unknown titles count for none', () => {
  const all = plain(muscles.MUSCLE_GROUPS)
  assert.deepEqual(plain(muscles.muscleGroupsForTitle('30 min Full Body Strength')), all)
  assert.deepEqual(plain(muscles.muscleGroupsForTitle('45 min Total-Body Strength')), all)
  assert.deepEqual(plain(muscles.muscleGroupsForTitle('20 min Bodyweight Strength')), all)
  assert.deepEqual(plain(muscles.muscleGroupsForTitle('10 min Bodyweight Core')), ['core'])
  assert.deepEqual(plain(muscles.directMuscleGroups('30 min Full Body Strength')), [])
  assert.deepEqual(plain(muscles.muscleGroupsForTitle('20 min Strength Basics')), [])
  assert.deepEqual(plain(muscles.muscleGroupsForTitle('Throwback Warm Up')), [])
  assert.deepEqual(plain(muscles.muscleGroupsForTitle(null)), [])
})

const workout = (iso, classTitle, extra = {}) => ({ date: new Date(iso), activity: 'Weight Lifting', discipline: 'strength', classTitle, ...extra })

test('muscle group stats track days since, windows, weekly rhythm and a direct example title', () => {
  // Today is Friday 2026-10-30 in Los Angeles.
  const rows = [
    workout('2026-10-29T15:00:00Z', '30 min Full Body Strength'),
    workout('2026-10-27T15:00:00Z', '20 min Chest & Back Strength'),
    workout('2026-10-20T15:00:00Z', '10 min Arms & Shoulders Strength'),
    workout('2026-08-15T15:00:00Z', '5 min Core Strength'),
    workout('2026-10-28T15:00:00Z', '45 min Power Zone Ride', { activity: 'Cycling', discipline: 'cycling' }),
    workout('2026-10-26T15:00:00Z', null, { activity: 'Weight Lifting', discipline: null }),
  ]
  const stats = Object.fromEntries(muscles.muscleGroupStats(rows, '2026-10-30', 8).map(s => [s.group, s]))
  // Days since counts only classes that name the group; full body is tracked separately.
  assert.equal(stats.chest.lastDay, '2026-10-27')
  assert.equal(stats.chest.daysSince, 3)
  assert.equal(stats.chest.daysSinceAny, 1)
  assert.equal(stats.legs.daysSince, null)
  assert.equal(stats.legs.daysSinceAny, 1)
  assert.equal(stats.chest.count30, 2)
  assert.equal(stats.chest.example, '20 min Chest & Back Strength')
  assert.equal(stats.arms.example, '10 min Arms & Shoulders Strength')
  assert.equal(stats.legs.example, '30 min Full Body Strength')
  assert.equal(stats.core.count30, 1)
  assert.equal(stats.core.count90, 2)
  assert.equal(stats.arms.weekly.length, 9)
  assert.equal(stats.arms.weekly[8], 1) // this week (Mon Oct 26 - Sun Nov 1): full body
  assert.equal(stats.arms.weekly[7], 1) // last week: arms & shoulders
  assert.equal(stats.arms.perWeek, 1 / 8)
  // Cycling never counts toward muscle groups.
  assert.equal(stats.legs.count30, 1)
})

test('up next puts never-trained groups first, then the longest since, then the fewest recent sessions', () => {
  const rows = [
    workout('2026-10-29T15:00:00Z', '20 min Chest & Back Strength'),
    workout('2026-10-25T15:00:00Z', '10 min Arms Strength'),
    workout('2026-10-20T15:00:00Z', '20 min Legs Strength'),
    workout('2026-10-20T16:00:00Z', '10 min Shoulders Strength'),
    workout('2026-10-10T16:00:00Z', '10 min Shoulders Strength'),
  ]
  const next = plain(muscles.upNext(muscles.muscleGroupStats(rows, '2026-10-30'), 3).map(s => s.group))
  assert.deepEqual(next, ['core', 'legs', 'shoulders'])
})

test('streaks count consecutive New York days and survive until today ends', () => {
  const days = new Set(['2026-10-27', '2026-10-28', '2026-10-29', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23'])
  assert.deepEqual(plain(training.currentStreak(days, '2026-10-30')), { days: 3, activeToday: false })
  assert.deepEqual(plain(training.currentStreak(new Set([...days, '2026-10-30']), '2026-10-30')), { days: 4, activeToday: true })
  assert.equal(training.currentStreak(days, '2026-10-31').days, 0)
  assert.equal(training.longestStreak(days), 4)
  assert.equal(training.weekStart('2026-11-01'), '2026-10-26')
  assert.equal(training.weekStart('2026-10-26'), '2026-10-26')
  assert.deepEqual(plain(training.weekDays('2026-10-30', -1)), ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'])
  // 2026-10-31T03:00Z is still Oct 30 in New York.
  assert.deepEqual([...training.groupByDay([{ date: new Date('2026-10-31T03:00:00Z') }]).keys()], ['2026-10-30'])
})

test('class title is the primary label and disciplines classify Peloton and Apple Watch rows', () => {
  assert.equal(disciplines.workoutTitle({ activity: 'Weight Lifting', classTitle: '20 min Chest & Back Strength' }), '20 min Chest & Back Strength')
  assert.equal(disciplines.workoutTitle({ activity: 'Weight Lifting', classTitle: null }), 'Weight Lifting')
  assert.equal(disciplines.disciplineOf({ activity: 'Cycling', discipline: 'strength' }), 'strength')
  assert.equal(disciplines.disciplineOf({ activity: 'Outdoor Walk' }), 'walk')
  assert.equal(disciplines.disciplineOf({ activity: 'Running', discipline: 'running' }), 'run')
  assert.equal(disciplines.disciplineOf({ activity: 'Cardio', discipline: 'cardio' }), 'cardio')
  assert.equal(disciplines.disciplineOf({ activity: 'Stretching', discipline: 'stretching' }), 'stretch')
  assert.equal(disciplines.disciplineOf({ activity: 'Something' }), 'other')
})

test('health metrics API validates filters, applies them and returns rows oldest first', async () => {
  const { NextResponse } = require('next/server')
  let args
  let authed = true
  const route = loadTs('src/app/api/health-metrics/route.ts', {
    '@/lib/prisma': { default: { healthMetric: { findMany: async a => { args = a; return [{ name: 'step_count', date: new Date('2026-10-01T00:00:00Z'), qty: 9000 }] } } } },
    '@/lib/auth': { requireAuth: async () => authed ? null : NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) },
  })
  const get = query => route.GET(new Request('http://localhost/api/health-metrics' + query))
  const ok = await get('?since=2026-09-01&names=step_count, resting_heart_rate,step_count')
  assert.equal(ok.status, 200)
  assert.equal((await ok.json()).metrics.length, 1)
  assert.equal(args.where.date.gte.toISOString(), '2026-09-01T00:00:00.000Z')
  assert.deepEqual(plain(args.where.name.in), ['step_count', 'resting_heart_rate'])
  assert.deepEqual(plain(args.orderBy), [{ date: 'asc' }, { name: 'asc' }])
  assert.equal((await get('')).status, 200)
  assert.equal(args.where.name, undefined)
  assert.equal(args.where.date, undefined)
  for (const query of ['?since=2026-02-30', '?since=yesterday', '?since=2026-10-01T00:00:00Z', '?names=', '?names=DROP TABLE', '?names=' + Array(21).fill('a').map((a, i) => a + i).join(',')]) {
    assert.equal((await get(query)).status, 400, query)
  }
  authed = false
  assert.equal((await get('')).status, 401)
})

test('a full-body class today does not make every group look freshly trained for Up next', () => {
  // Same shape as a real morning: core, arms & shoulders, then full body, all today.
  const rows = [
    workout('2026-10-31T13:15:00Z', '5 min Core Strength'),
    workout('2026-10-31T13:04:00Z', '10 min Arms & Shoulders Strength'),
    workout('2026-10-31T12:10:00Z', '30 min Full Body Strength'),
    workout('2026-10-27T15:00:00Z', '20 min Chest & Back Strength'),
    workout('2026-10-21T15:00:00Z', '10 min Glutes & Legs Strength'),
  ]
  const stats = muscles.muscleGroupStats(rows, '2026-10-31')
  const byGroup = Object.fromEntries(stats.map(s => [s.group, s]))
  assert.equal(byGroup.legs.daysSince, 10)
  assert.equal(byGroup.legs.daysSinceAny, 0)
  assert.equal(byGroup.shoulders.daysSince, 0)
  assert.deepEqual(plain(muscles.upNext(stats, 2).map(s => s.group)), ['legs', 'chest'])
})
