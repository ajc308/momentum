// Runs against an isolated PostgreSQL instance, with the real Prisma driver.
// No application tables or production credentials are needed.
const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const { PrismaClient } = require('@prisma/client')

if (!process.env.TEST_POSTGRES_URL) throw new Error('Set TEST_POSTGRES_URL to an isolated PostgreSQL test database')
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_POSTGRES_URL } } })
after(() => prisma.$disconnect())

const { outputText } = ts.transpileModule(readFileSync('src/lib/sync-write.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
})
const exportsForTest = {}
vm.runInNewContext(outputText, {
  exports: exportsForTest,
  require: name => name === '@/lib/prisma' ? { default: prisma } : require(name),
  Error, Number,
})
const { withSyncWrite } = exportsForTest

test('Prisma reproduces the original integer/bigint PostgreSQL overload failure', async () => {
  const rows = await prisma.$queryRaw`SELECT pg_typeof(${1})::text AS type`
  assert.equal(rows[0].type, 'bigint')
  await assert.rejects(prisma.$executeRaw`SELECT pg_advisory_xact_lock(782341, ${1})`,
    error => error.code === 'P2010' && error.meta.code === '42883')
})

async function assertScopeLock(scope, key) {
  let entered = false
  const result = await withSyncWrite(async tx => {
    entered = true
    // A second connection must see the held lock and the other scope free.
    await prisma.$transaction(async observer => {
      const [same] = await observer.$queryRaw`SELECT pg_try_advisory_xact_lock(782341, ${key}::integer) AS acquired`
      assert.equal(same.acquired, false)
      const [other] = await observer.$queryRaw`SELECT pg_try_advisory_xact_lock(782341, ${key === 1 ? 2 : 1}::integer) AS acquired`
      assert.equal(other.acquired, true)
    })
    const [row] = await tx.$queryRaw`SELECT 42 AS value`
    return row.value
  }, scope)
  assert.equal(entered, true)
  assert.equal(result, 42)
  await assertReleased(key)
}

async function assertReleased(key) {
  await prisma.$transaction(async tx => {
    const [row] = await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(782341, ${key}::integer) AS acquired`
    assert.equal(row.acquired, true)
  })
}

test('Peloton default workout scope acquires key 1 and releases on commit', () => assertScopeLock(undefined, 1))
test('measurement scope acquires key 2 independently and releases on commit', () => assertScopeLock('measurements', 2))
test('failed sync callbacks propagate their error and release transaction locks', async () => {
  for (const [scope, key] of [['workouts', 1], ['measurements', 2]]) {
    const failure = new Error('sync write failed')
    await assert.rejects(withSyncWrite(async () => { throw failure }, scope), error => error === failure)
    await assertReleased(key)
  }
})
