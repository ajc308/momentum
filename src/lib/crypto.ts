/**
 * Envelope-style symmetric encryption for sensitive credential columns
 * (F-05 fix). Uses AES-256-GCM with a key derived from `CREDENTIAL_ENC_KEY`
 * (hex-encoded 32-byte key — generate with `openssl rand -hex 32`).
 *
 * Format on disk: "enc:v1:<base64(iv|tag|ciphertext)>"
 * - "enc:v1:" prefix lets us detect plaintext rows for lazy migration.
 * - 12-byte IV per write (random) so identical plaintexts encrypt distinctly.
 * - 16-byte GCM auth tag.
 *
 * Production writes require a valid CREDENTIAL_ENC_KEY. Development can
 * omit the key; an explicitly configured invalid key always fails. Legacy
 * plaintext remains readable so existing credentials can be migrated.
 */
import { randomBytes, createCipheriv, createDecipheriv } from 'crypto'

const ALGO = 'aes-256-gcm'
const PREFIX = 'enc:v1:'
const IV_LEN = 12
const TAG_LEN = 16

function getKey(): Buffer | null {
  const hex = process.env.CREDENTIAL_ENC_KEY
  if (!hex) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('CREDENTIAL_ENC_KEY is required in production')
    }
    return null
  }
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('CREDENTIAL_ENC_KEY must be 64 hex chars (32 bytes)')
  }
  return Buffer.from(hex, 'hex')
}

/**
 * Encrypt a value for storage. Returns the prefixed/encoded ciphertext,
 * or the input unchanged when no key is configured (dev fallback).
 * Passing null/undefined returns the input as-is.
 */
export function encryptSecret<T extends string | null | undefined>(plaintext: T): T {
  if (plaintext == null) return plaintext
  if (typeof plaintext !== 'string') return plaintext
  const key = getKey()
  if (plaintext.startsWith(PREFIX)) return plaintext as T // already encrypted
  if (!key) return plaintext

  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv(ALGO, key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  const blob = Buffer.concat([iv, tag, ct]).toString('base64')
  return (PREFIX + blob) as T
}

/**
 * Decrypt a stored value. Pass-through for non-prefixed (legacy plaintext)
 * values to keep existing rows readable. Throws on tampered ciphertext.
 */
export function decryptSecret<T extends string | null | undefined>(stored: T): T {
  if (stored == null) return stored
  if (typeof stored !== 'string') return stored
  if (!stored.startsWith(PREFIX)) return stored // legacy plaintext
  const key = getKey()
  if (!key) {
    // Encrypted value with no key configured — can't read it.
    throw new Error('CREDENTIAL_ENC_KEY required to decrypt stored credential')
  }

  const blob = Buffer.from(stored.slice(PREFIX.length), 'base64')
  const iv = blob.subarray(0, IV_LEN)
  const tag = blob.subarray(IV_LEN, IV_LEN + TAG_LEN)
  const ct = blob.subarray(IV_LEN + TAG_LEN)
  const decipher = createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(tag)
  const pt = Buffer.concat([decipher.update(ct), decipher.final()])
  return pt.toString('utf8') as T
}
