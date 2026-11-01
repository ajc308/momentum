const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Load a TS module, resolving its @/ imports to the real sources.
const cache = {}
function load(rel) {
  if (cache[rel]) return cache[rel]
  const { outputText } = ts.transpileModule(readFileSync(resolve(__dirname, '..', rel), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  })
  const exports = {}
  cache[rel] = exports
  vm.runInNewContext(outputText, {
    exports, Date, Intl, Math, console,
    require: name => (name.startsWith('@/') ? load(`src/${name.slice(2)}.ts`) : require(name)),
  })
  return exports
}
const planner = load('src/lib/planner.ts')
const plain = value => JSON.parse(JSON.stringify(value))

// Workouts at 7am Eastern (11:00Z in EDT).
const strength = (day, title, minutes = 20, instructor = 'Jermaine Johnson') =>
  ({ date: new Date(`${day}T11:00:00Z`), activity: 'Weight Lifting', discipline: 'strength', classTitle: title, minutes, instructor })
const walk = day => ({ date: new Date(`${day}T11:00:00Z`), activity: 'Walking', discipline: 'walking', classTitle: '20 min Outdoor Walk', minutes: 20 })

const history = [
  strength('2026-10-13', '10 min Glutes & Legs Strength', 10, 'Rebecca Kennedy'),
  strength('2026-10-13', '20 min Glutes & Legs Strength'),
  strength('2026-10-16', '20 min Chest & Back Strength'),
  strength('2026-10-16', '10 min Core Strength', 10, 'Katie Wang'),
  strength('2026-10-20', '20 min Arms & Shoulders Strength'),
  strength('2026-10-22', '20 min Chest & Back Strength'),
]

test('focus rotates by what is most overdue, never repeating back to back, with real classes from history', () => {
  // Fri Oct 23: legs last targeted 10 days ago.
  const plan = planner.buildPlan(history, '2026-10-23')
  const strengthDays = plan.days.filter(d => d.status === 'strength')
  assert.equal(strengthDays[0].focus, 'legs')
  assert.equal(strengthDays[0].reason, 'Glutes & Legs last targeted 10 days ago.')
  for (let i = 1; i < strengthDays.length; i++) assert.notEqual(strengthDays[i].focus, strengthDays[i - 1].focus)
  // Main class closest to 20 min, plus a core finisher capped at 10 min.
  assert.deepEqual(plain(strengthDays[0].suggestions.map(s => s.title)), ['20 min Glutes & Legs Strength', '10 min Core Strength'])
  assert.ok(strengthDays[0].suggestions.every(s => s.minutes <= 20))
})

test('aims for 3 strength days per Monday-Sunday week and spaces them out', () => {
  const plan = planner.buildPlan(history.slice(0, 4), '2026-10-19') // a Monday, nothing yet this week
  assert.deepEqual(plain(plan.days.map(d => d.status)), ['strength', 'walk', 'strength', 'rest', 'strength', 'rest', 'rest'])
})

test('a skipped strength day rolls forward and the plan says so', () => {
  // Sat Oct 24 was planned as legs (Fri was a rest day after Thursday); nothing happened on the 24th.
  assert.equal(planner.buildPlan(history, '2026-10-24').days[0].focus, 'legs')
  const plan = planner.buildPlan(history, '2026-10-25')
  assert.equal(plan.days[0].focus, 'legs')
  assert.equal(plan.adapted, "Yesterday's Glutes & Legs didn't happen, so it moved to today.")
  // Doing it removes the note and moves on to the next focus.
  const done = planner.buildPlan([...history, strength('2026-10-24', '20 min Glutes & Legs Strength')], '2026-10-25')
  assert.equal(done.adapted, null)
  assert.notEqual(done.days.find(d => d.status === 'strength').focus, 'legs')
})

test('a week that is running out catches up with back-to-back days', () => {
  // Saturday with zero strength this week: Sat and Sun both needed... target 3 but only 2 days left.
  const plan = planner.buildPlan([strength('2026-10-16', '20 min Chest & Back Strength')], '2026-10-24')
  assert.deepEqual(plain(plan.days.slice(0, 2).map(d => d.status)), ['strength', 'strength'])
  assert.notEqual(plan.days[0].focus, plan.days[1].focus)
})

test('today shows completed classes, and one walk a week is planned only if none happened', () => {
  const today = planner.buildPlan([...history, strength('2026-10-23', '30 min Full Body Strength', 30)], '2026-10-23')
  assert.equal(today.days[0].status, 'done')
  assert.deepEqual(plain(today.days[0].completed), ['30 min Full Body Strength'])

  const walked = planner.buildPlan([...history.slice(0, 4), walk('2026-10-19')], '2026-10-20')
  assert.equal(walked.days.filter(d => d.status === 'walk' && d.day <= '2026-10-25').length, 0)
})

test('class focus comes from the title', () => {
  assert.equal(planner.classFocus('10 min Glutes & Legs Strength'), 'legs')
  assert.equal(planner.classFocus('20 min Chest & Back Strength'), 'chest_back')
  assert.equal(planner.classFocus('15 min Arms & Shoulders Strength'), 'arms_shoulders')
  assert.equal(planner.classFocus('30 min Full Body Strength'), null)
  assert.equal(planner.classFocus('10 min Core Strength'), null)
})

test('core is explicit: a labeled class on strength days, stacked onto walk or done days when due', () => {
  const plan = planner.buildPlan(history.slice(0, 4), '2026-10-19') // Monday; last core was Oct 16
  const first = plan.days[0]
  assert.equal(first.title, 'Arms & Shoulders + Core') // never done in this history, so most overdue
  assert.deepEqual(plain(first.suggestions.map(s => s.role)), ['main', 'core'])
  assert.match(first.summary, /^Today Oct 19 — Arms & Shoulders \+ Core \(~30 min\): 1\) 20 min Arms & Shoulders Strength \(20 min\) 2\) 10 min Core Strength with Katie Wang \(10 min, core\)/)
  assert.equal(plan.nextWorkout.day, '2026-10-19')

  // Core done Monday, so Tuesday's walk doesn't stack it.
  assert.equal(plan.days[1].title, 'Walk')
  assert.equal(plan.days[1].suggestions.length, 0)

  // A walk day two+ days after the last core gets core stacked on.
  // Monday after a Sunday strength day without core (last core Thursday): rest-ish day becomes Walk + Core.
  const walkFirst = planner.buildPlan([strength('2026-10-15', '10 min Core Strength', 10), strength('2026-10-18', '20 min Chest & Back Strength')], '2026-10-19')
  const walkDay = walkFirst.days[0]
  assert.equal(walkDay.title, 'Walk + Core')
  assert.equal(walkDay.suggestions[0].role, 'core')

  // Strength already done today without core: offer a core stack, and it counts as the next thing to do.
  const doneNoCore = planner.buildPlan([...history, strength('2026-10-23', '20 min Glutes & Legs Strength')], '2026-10-23')
  assert.equal(doneNoCore.days[0].status, 'done')
  assert.equal(doneNoCore.days[0].suggestions[0].role, 'core')
  assert.equal(doneNoCore.nextWorkout.day, '2026-10-23')
})
