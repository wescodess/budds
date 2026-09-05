/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')

describe('distributed rate limits', () => {
  test('atomically rejects requests after the route limit', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity({ tokenIdentifier: 'user-a' })

    for (let request = 0; request < 3; request++) {
      await expect(asUser.mutation(api.rateLimits.consume, {
        route: '/api/calendar/sync',
        maxPerMinute: 3,
      })).resolves.toEqual({ allowed: true, retryAfterMs: 0 })
    }

    const rejected = await asUser.mutation(api.rateLimits.consume, {
      route: '/api/calendar/sync',
      maxPerMinute: 3,
    })
    expect(rejected.allowed).toBe(false)
    expect(rejected.retryAfterMs).toBeGreaterThan(0)
  })

  test('isolates buckets by authenticated user and route', async () => {
    const t = convexTest(schema, modules)
    const asUserA = t.withIdentity({ tokenIdentifier: 'user-a' })
    const asUserB = t.withIdentity({ tokenIdentifier: 'user-b' })

    for (let request = 0; request < 3; request++) {
      await asUserA.mutation(api.rateLimits.consume, { route: '/api/calendar/sync', maxPerMinute: 3 })
    }

    await expect(asUserB.mutation(api.rateLimits.consume, {
      route: '/api/calendar/sync',
      maxPerMinute: 3,
    })).resolves.toEqual({ allowed: true, retryAfterMs: 0 })
    await expect(asUserA.mutation(api.rateLimits.consume, {
      route: '/api/calendar/disconnect',
      maxPerMinute: 3,
    })).resolves.toEqual({ allowed: true, retryAfterMs: 0 })
  })
})
