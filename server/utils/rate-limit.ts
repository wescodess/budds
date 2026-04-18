const buckets = new Map<string, { tokens: number, lastRefill: number }>()

const WINDOW_MS = 60_000
const CLEANUP_INTERVAL_MS = 5 * 60_000
let lastCleanup = Date.now()

function cleanup() {
  const now = Date.now()
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return
  lastCleanup = now
  for (const [key, bucket] of buckets) {
    if (now - bucket.lastRefill > WINDOW_MS * 2) buckets.delete(key)
  }
}

export function checkRateLimit(opts: {
  key: string
  maxPerMinute: number
}): { allowed: boolean; retryAfterMs: number } {
  cleanup()
  const now = Date.now()
  const bucket = buckets.get(opts.key)

  if (!bucket) {
    buckets.set(opts.key, { tokens: opts.maxPerMinute - 1, lastRefill: now })
    return { allowed: true, retryAfterMs: 0 }
  }

  const elapsed = now - bucket.lastRefill
  if (elapsed >= WINDOW_MS) {
    bucket.tokens = opts.maxPerMinute - 1
    bucket.lastRefill = now
    return { allowed: true, retryAfterMs: 0 }
  }

  if (bucket.tokens > 0) {
    bucket.tokens--
    return { allowed: true, retryAfterMs: 0 }
  }

  return { allowed: false, retryAfterMs: WINDOW_MS - elapsed }
}

export function requireRateLimit(event: any, maxPerMinute: number) {
  if (process.env.VITEST) return
  const userId = (event.context as any)?.convexTokenIdentifier
    ?? event.headers?.get?.('x-forwarded-for')
    ?? 'anonymous'
  const path = event.path ?? event.node?.req?.url ?? 'unknown'
  const key = `${userId}::${path}`

  const result = checkRateLimit({ key, maxPerMinute })
  if (!result.allowed) {
    const err = new Error(`Rate limit exceeded. Try again in ${Math.ceil(result.retryAfterMs / 1000)} seconds.`) as Error & { statusCode: number }
    err.statusCode = 429
    throw err
  }
}
