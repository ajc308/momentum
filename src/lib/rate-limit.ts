/**
 * In-memory rate limiter (F-06 fix). Token-bucket per IP+route. Process-
 * local, so on Vercel each lambda instance has its own bucket — good
 * enough as a guard against runaway agents on a single instance, but
 * not a distributed limiter. For production-grade limiting, swap the
 * `hit()` implementation to Upstash / Vercel KV.
 *
 * Limits are conservative defaults:
 *   - 60 requests / minute / IP for mutation routes
 *   - 10 requests / minute / IP for sync routes (each one fans out to
 *     the external Peloton API, so they are more expensive)
 *
 * Returns a `NextResponse` (429) when the bucket is empty, otherwise
 * `null` to signal the caller may continue.
 */
import { NextResponse } from 'next/server'

interface Bucket {
  // remaining tokens
  tokens: number
  // last refill timestamp (ms)
  ts: number
}

const buckets = new Map<string, Bucket>()

// Periodic cleanup so the map doesn't grow unbounded.
const CLEANUP_INTERVAL_MS = 5 * 60_000
let lastCleanup = Date.now()
function maybeCleanup(now: number) {
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return
  lastCleanup = now
  for (const [k, v] of buckets) {
    if (now - v.ts > CLEANUP_INTERVAL_MS) buckets.delete(k)
  }
}

function clientKey(request: Request, scope: string): string {
  const xff = request.headers.get('x-forwarded-for')
  const ip = xff ? xff.split(',')[0]!.trim() : request.headers.get('x-real-ip') ?? 'unknown'
  return `${scope}:${ip}`
}

/**
 * Consume one token from the bucket. Returns a 429 NextResponse if
 * empty; null otherwise.
 *
 * @param request    Incoming request.
 * @param scope      Logical bucket name (e.g. "mcp", "mutation", "sync").
 * @param capacity   Bucket capacity (tokens).
 * @param refillPerSec  Tokens added per second.
 */
export function rateLimit(
  request: Request,
  scope: string,
  capacity: number,
  refillPerSec: number,
): NextResponse | null {
  const key = clientKey(request, scope)
  const now = Date.now()
  maybeCleanup(now)

  let b = buckets.get(key)
  if (!b) {
    b = { tokens: capacity - 1, ts: now }
    if (buckets.size >= 10_000) buckets.delete(buckets.keys().next().value!)
    buckets.set(key, b)
    return null
  }

  // Refill based on elapsed time
  const elapsedSec = (now - b.ts) / 1000
  b.tokens = Math.min(capacity, b.tokens + elapsedSec * refillPerSec)
  b.ts = now

  if (b.tokens < 1) {
    const retryAfter = Math.ceil((1 - b.tokens) / refillPerSec)
    return NextResponse.json(
      { error: 'Too many requests' },
      {
        status: 429,
        headers: {
          'retry-after': String(retryAfter),
          'x-ratelimit-scope': scope,
        },
      },
    )
  }

  b.tokens -= 1
  return null
}

// Convenience presets
export const limitMutation = (req: Request) => rateLimit(req, 'mutation', 60, 1)
export const limitSync = (req: Request) => rateLimit(req, 'sync', 10, 10 / 60) // 10/min
export const limitMcp = (req: Request) => rateLimit(req, 'mcp', 120, 2) // 120/min, 2/s burst
// Health Auto Export backfills send one request per day in quick succession.
export const limitHealthIngest = (req: Request) => rateLimit(req, 'health-ingest', 300, 10) // 300 burst, 10/s

export function limitRestRequest(req: Request): NextResponse | null {
  const path = new URL(req.url).pathname
  if (/^\/api\/peloton\/auth$/.test(path)) return rateLimit(req, 'integration-auth', 5, 5 / 60)
  if (req.method === 'POST' && path.endsWith('/sync')) return limitSync(req)
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return limitMutation(req)
  return null
}
