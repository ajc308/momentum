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
  vm.runInNewContext(outputText, { exports, require: name => mocks[name] ?? require(name), Date, Math, console })
  return exports
}

const bodyFat = loadTs('src/lib/body-fat.ts')

test('Navy formula matches the published male equation and rejects impossible inputs', () => {
  // 86.010·log10(34 − 15.5) − 70.041·log10(70) + 36.76 = 16.52…
  assert.equal(bodyFat.navyBodyFatPct(15.5, 34, 70), 16.5)
  assert.ok(bodyFat.navyBodyFatPct(16, 40, 70) > bodyFat.navyBodyFatPct(16, 34, 70)) // bigger waist, more fat
  assert.equal(bodyFat.navyBodyFatPct(16, 15, 70), null) // waist must exceed neck
  assert.equal(bodyFat.navyBodyFatPct(16, 16.2, 70), null) // implausibly low result
})

function weightModule(rows = []) {
  const writes = []
  const prisma = {
    bodyMeasurement: {
      findFirst: async ({ where }) => [...rows].filter(r => where.heightIn ? r.heightIn != null : true)
        .sort((a, b) => b.date - a.date)[0] ?? null,
      upsert: async ({ where, create, update }) => { writes.push({ where, create, update }); return { id: 'w', ...create } },
    },
  }
  const mod = loadTs('src/lib/body-weight.ts', {
    '@/lib/prisma': { default: prisma },
    '@/lib/workout-date': loadTs('src/lib/workout-date.ts'),
    '@/lib/body-fat': bodyFat,
  })
  return { mod, writes }
}

test('tape measurements calculate body fat, remembering the last height', async () => {
  const { mod, writes } = weightModule([{ date: new Date('2026-09-01T00:00:00Z'), heightIn: 70 }])
  const row = await mod.logWeight({ date: '2026-10-31', weightLbs: 182, neckIn: 15.5, waistIn: 34 })
  assert.equal(row.bodyFatPct, 16.5)
  assert.equal(row.heightIn, 70)
  assert.equal(writes[0].update.waistIn, 34)

  // Calculated value wins over a typed one; weight alone stores no tape data.
  assert.equal((await mod.logWeight({ date: '2026-10-31', weightLbs: 182, neckIn: 15.5, waistIn: 34, bodyFatPct: 25 })).bodyFatPct, 16.5)
  const plain = await mod.logWeight({ date: '2026-11-01', weightLbs: 181 })
  assert.equal(plain.bodyFatPct, null)
  assert.equal(plain.neckIn, null)
})

test('without any known height, tape measurements are stored but no body fat is guessed', async () => {
  const { mod } = weightModule([])
  const row = await mod.logWeight({ date: '2026-10-31', weightLbs: 182, neckIn: 15.5, waistIn: 34 })
  assert.equal(row.bodyFatPct, null)
  assert.equal(row.waistIn, 34)
  assert.equal(mod.weightEntrySchema.safeParse({ date: '2026-10-31', weightLbs: 182, neckIn: 3 }).success, false)
})
