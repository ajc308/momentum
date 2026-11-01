const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function cryptoFor(env) {
  const { outputText } = ts.transpileModule(readFileSync(resolve(__dirname, '../src/lib/crypto.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  })
  const exports = {}
  vm.runInNewContext(outputText, { exports, require, Buffer, process: { env } })
  return exports
}

test('production refuses missing and malformed encryption keys', () => {
  for (const key of [undefined, '', 'invalid', 'a'.repeat(63)]) {
    const crypto = cryptoFor({ NODE_ENV: 'production', CREDENTIAL_ENC_KEY: key })
    assert.throws(() => crypto.encryptSecret('session-secret'), /CREDENTIAL_ENC_KEY/)
    assert.throws(() => crypto.encryptSecret('enc:v1:existing'), /CREDENTIAL_ENC_KEY/)
    assert.equal(crypto.decryptSecret('legacy-plaintext'), 'legacy-plaintext')
  }
})

test('development can omit a key but cannot silently ignore an invalid one', () => {
  assert.equal(cryptoFor({ NODE_ENV: 'development' }).encryptSecret('dev-secret'), 'dev-secret')
  assert.throws(() => cryptoFor({ NODE_ENV: 'development', CREDENTIAL_ENC_KEY: 'invalid' }).encryptSecret('secret'), /64 hex/)
})

test('encryption round trips, uses fresh IVs, and rejects tampered or wrong-key ciphertext', () => {
  const crypto = cryptoFor({ NODE_ENV: 'production', CREDENTIAL_ENC_KEY: 'ab'.repeat(32) })
  const first = crypto.encryptSecret('session-secret')
  const second = crypto.encryptSecret('session-secret')
  assert.match(first, /^enc:v1:/)
  assert.notEqual(first, second)
  assert.equal(crypto.decryptSecret(first), 'session-secret')
  assert.equal(crypto.encryptSecret(first), first)
  const bytes = Buffer.from(first.slice(7), 'base64')
  bytes[bytes.length - 1] ^= 1
  assert.throws(() => crypto.decryptSecret('enc:v1:' + bytes.toString('base64')))
  assert.throws(() => cryptoFor({ CREDENTIAL_ENC_KEY: 'cd'.repeat(32) }).decryptSecret(first))
  assert.equal(crypto.encryptSecret(null), null)
  assert.equal(crypto.encryptSecret(undefined), undefined)
})

test('credential migration is dry-run-first, idempotent, and protects concurrent refreshes', async () => {
  const previousKey = process.env.CREDENTIAL_ENC_KEY
  process.env.CREDENTIAL_ENC_KEY = 'ab'.repeat(32)
  try {
    const { migrateCredentials } = require('../scripts/encrypt-credentials.cjs')
    const rows = { pelotonCredential: [{ id: 'p', sessionId: 'secret', accessToken: null, refreshToken: null }] }
    let writes = 0
    const prisma = Object.fromEntries(Object.entries(rows).map(([name, values]) => [name, {
      findMany: async () => values.map(row => ({ ...row })),
      updateMany: async ({ where, data }) => {
        writes++
        const row = values.find(row => Object.entries(where).every(([key, value]) => row[key] === value))
        if (!row) return { count: 0 }
        Object.assign(row, data)
        return { count: 1 }
      },
    }]))
    assert.equal((await migrateCredentials(prisma)).pelotonCredential.pending, 1)
    assert.equal(writes, 0)
    assert.equal((await migrateCredentials(prisma, { apply: true })).pelotonCredential.migrated, 1)
    assert.match(rows.pelotonCredential[0].sessionId, /^enc:v1:/)
    assert.equal(rows.pelotonCredential[0].accessToken, null)
    assert.equal((await migrateCredentials(prisma, { apply: true })).pelotonCredential.pending, 0)
    assert.equal(writes, 1)
    rows.pelotonCredential[0].sessionId = 'refreshed-secret'
    prisma.pelotonCredential.updateMany = async () => ({ count: 0 })
    assert.equal((await migrateCredentials(prisma, { apply: true })).pelotonCredential.changedDuringMigration, 1)
  } finally {
    if (previousKey === undefined) delete process.env.CREDENTIAL_ENC_KEY
    else process.env.CREDENTIAL_ENC_KEY = previousKey
  }
})

test('migration rejects a wrong key before changing any plaintext rows', async () => {
  const previousKey = process.env.CREDENTIAL_ENC_KEY
  process.env.CREDENTIAL_ENC_KEY = 'ab'.repeat(32)
  try {
    const { migrateCredentials } = require('../scripts/encrypt-credentials.cjs')
    const wrongKeyCiphertext = cryptoFor({ CREDENTIAL_ENC_KEY: 'cd'.repeat(32) }).encryptSecret('other-token')
    let writes = 0
    const prisma = {
      pelotonCredential: { findMany: async () => [
        { id: 'p', sessionId: 'plaintext', accessToken: null, refreshToken: null },
        { id: 'q', sessionId: 'other-plaintext', accessToken: wrongKeyCiphertext, refreshToken: null },
      ], updateMany: async () => { writes++; return { count: 1 } } },
    }
    await assert.rejects(migrateCredentials(prisma, { apply: true }))
    assert.equal(writes, 0)
  } finally {
    if (previousKey === undefined) delete process.env.CREDENTIAL_ENC_KEY
    else process.env.CREDENTIAL_ENC_KEY = previousKey
  }
})
