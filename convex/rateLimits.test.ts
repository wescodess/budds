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


test('public caller-owned keys cannot touch protected grading counters', async () => {
  const t = convexTest(schema, modules)
  const key = 'internal:quiz-grading:dispatch-user:"a::b"'
  const id = await t.run(ctx => ctx.db.insert('rateLimitBuckets', {
    key, userId: 'a::b', route: 'quiz-grading/dispatch-user', count: 25, windowStartedAt: 0, expiresAt: 1,
  }))
  const before = await t.run(ctx => ctx.db.get(id))
  const forgedIdentity = t.withIdentity({ tokenIdentifier: 'internal:quiz-grading:dispatch-user:"a' })
  await expect(forgedIdentity.mutation(api.rateLimits.consume, { route: 'b"', maxPerMinute: 3 })).rejects.toThrow('Reserved rate-limit key')
  expect(await t.run(ctx => ctx.db.get(id))).toEqual(before)
  await t.withIdentity({ tokenIdentifier: 'a::b' }).mutation(api.rateLimits.consume, { route: key, maxPerMinute: 3 })
  expect(await t.run(ctx => ctx.db.get(id))).toEqual(before)
})
