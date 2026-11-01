// Run with npm run credentials:encrypt; add --apply after reviewing counts.
// Uses the app's encryption implementation and never prints credential values.
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const source = readFileSync(resolve(__dirname, '../src/lib/crypto.ts'), 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
})
const cryptoExports = {}
vm.runInNewContext(outputText, { exports: cryptoExports, require, Buffer, process })

const credentialModels = {
  pelotonCredential: ['sessionId', 'accessToken', 'refreshToken'],
}

async function migrateCredentials(prisma, { apply = false } = {}) {
  // Require a valid key even for dry runs outside NODE_ENV=production.
  if (!/^[0-9a-fA-F]{64}$/.test(process.env.CREDENTIAL_ENC_KEY ?? '')) {
    throw new Error('CREDENTIAL_ENC_KEY must be configured as 64 hex characters before migration')
  }
  const report = {}
  const pendingRows = []
  for (const [modelName, fields] of Object.entries(credentialModels)) {
    const model = prisma[modelName]
    const rows = await model.findMany({
      select: Object.fromEntries(['id', ...fields].map(field => [field, true])),
    })
    let pending = 0
    for (const row of rows) {
      const data = {}
      for (const field of fields) {
        const stored = row[field]
        if (stored == null) continue
        if (stored.startsWith('enc:v1:')) {
          // Validate the key against existing ciphertext before any writes.
          cryptoExports.decryptSecret(stored)
        } else {
          data[field] = cryptoExports.encryptSecret(stored)
        }
      }
      if (Object.keys(data).length === 0) continue
      pending++
      const where = Object.fromEntries(['id', ...fields].map(field => [field, row[field]]))
      pendingRows.push({ modelName, where, data })
    }
    report[modelName] = { pending, migrated: 0, changedDuringMigration: 0 }
  }
  // Finish validating all stored ciphertext before making any changes.
  if (apply) {
    for (const { modelName, where, data } of pendingRows) {
      // Don't overwrite a token refreshed after our read. Each row's
      // credential fields change together in a single database statement.
      const result = await prisma[modelName].updateMany({ where, data })
      report[modelName].migrated += result.count
      if (result.count === 0) report[modelName].changedDuringMigration++
    }
  }
  return report
}

module.exports = { migrateCredentials }

if (require.main === module) {
  if (process.argv.slice(2).some(arg => arg !== '--apply')) {
    console.error('Usage: npm run credentials:encrypt -- [--apply]')
    process.exit(1)
  }
  const { PrismaClient } = require('@prisma/client')
  const prisma = new PrismaClient()
  const apply = process.argv.includes('--apply')
  migrateCredentials(prisma, { apply })
    .then(report => console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', report }, null, 2)))
    .catch(() => {
      // Prisma errors may include query values: do not print raw exceptions.
      console.error('Credential migration failed. Check the encryption key and database connection; no credential values were logged. A partial apply can safely be retried.')
      process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
}
