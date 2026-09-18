import { api } from '../../convex/_generated/api'
import { makeConvexClient } from './convex-client'
import type { H3Event } from 'h3'

export type RateLimitedRoute
  = | 'calendar.disconnect'
    | 'calendar.sync'
    | 'learn-v2.calendar.disconnect'
    | 'course.generate-outline'
    | 'course.generate-section'
    | 'export.me'
    | 'flashcards.generate'
    | 'quiz.generate'
    | 'rag.chat'

export async function requireRateLimit(
  event: H3Event,
  maxPerMinute: 3 | 5 | 20,
  route: RateLimitedRoute,
) {
  if (process.env.VITEST) return
  const client = makeConvexClient(event)
  if (!client) {
    const err = new Error('Rate limit service unavailable.') as Error & { statusCode: number }
    err.statusCode = event.context.convexToken ? 503 : 401
    throw err
  }
  const result = await client.mutation(api.rateLimits.consume, { route, maxPerMinute })
  if (!result.allowed) {
    const err = new Error(`Rate limit exceeded. Try again in ${Math.ceil(result.retryAfterMs / 1000)} seconds.`) as Error & { statusCode: number }
    err.statusCode = 429
    throw err
  }
}
