/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const OWNER_A = { tokenIdentifier: 'https://auth.example.com|retention-owner-a' }
const OWNER_B = { tokenIdentifier: 'https://auth.example.com|retention-owner-b' }
const DAY_MS = 24 * 60 * 60 * 1000

async function insertEvent(t: ReturnType<typeof convexTest>, userId: string, occurredAt: number, suffix: string) {
  return await t.run(async (ctx) => {
    const threadId = await ctx.db.insert('learningThreads', {
      userId, originalNeed: 'Review a concept', intent: 'understand', availableTime: '15',
      authorityKind: 'standalone', sourceScope: { kind: 'none' }, evidenceState: 'none',
      lifecycle: 'ready', revision: 1, createdAt: occurredAt, updatedAt: occurredAt,
    })
    return await ctx.db.insert('learnActivityEvents', {
      userId, threadId, eventType: 'activity_eligible', eventVersion: 'activity_eligible.v1',
      taxonomyVersion: 'learn-adaptive.activity-events.v5', occurredAt,
      reasonCode: 'activity_plan_committed', outcomeCode: 'eligible',
      sourceVersion: 'learn-adaptive.activity-plan.v1', contractVersion: 'learn-adaptive.activity-contract.v1',
      metadata: {}, dedupeKeyHash: `sha256:${suffix.padStart(64, '0')}`,
    })
  })
}

async function exportedEvents(t: ReturnType<typeof convexTest>, identity: typeof OWNER_A) {
  return await t.withIdentity(identity).query(api.dataExport.getUserDataPage, {
    collection: 'learnActivityEvents', paginationOpts: { cursor: null, numItems: 200 },
  })
}

describe('Adaptive Learn event retention', () => {
  test('purges at and beyond 90 days in owner batches of 128 and leaves newer and other-owner events intact', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-29T12:00:00.000Z'))
    try {
      const t = convexTest(schema, modules)
      const cutoff = Date.now() - 90 * DAY_MS

      for (let index = 0; index < 130; index++) {
        await insertEvent(t, OWNER_A.tokenIdentifier, cutoff - DAY_MS - index, `a${index}`)
      }
      await insertEvent(t, OWNER_A.tokenIdentifier, cutoff, 'at-cutoff')
      await insertEvent(t, OWNER_A.tokenIdentifier, cutoff + 1, 'newer')
      await insertEvent(t, OWNER_B.tokenIdentifier, cutoff - 2 * DAY_MS, 'other-owner-expired')
      await insertEvent(t, OWNER_B.tokenIdentifier, cutoff + 1, 'other-owner-retained')

      const firstBatch = await t.mutation(internal.learnActivityEventRetention.purgeExpiredLearnActivityEvents, {
        cutoff, userId: OWNER_A.tokenIdentifier,
      })
      expect(firstBatch.deleted).toBe(128)

      expect((await exportedEvents(t, OWNER_A)).page).toHaveLength(4)
      expect((await exportedEvents(t, OWNER_B)).page).toHaveLength(2)

      await t.finishAllScheduledFunctions(() => { vi.runAllTimers() })

      const ownerAEvents = await exportedEvents(t, OWNER_A)
      expect(ownerAEvents.page).toHaveLength(1)
      expect(ownerAEvents.page[0]).toMatchObject({ occurredAt: cutoff + 1, eventType: 'activity_eligible' })
      expect((await exportedEvents(t, OWNER_B)).page).toHaveLength(1)
    }
    finally {
      vi.useRealTimers()
    }
  })

  test('discovers expired events from the scheduled sweep using the 90-day cutoff', async () => {
    const t = convexTest(schema, modules)
    const now = Date.now()
    await insertEvent(t, OWNER_A.tokenIdentifier, now - 90 * DAY_MS - 1, 'expired')
    await insertEvent(t, OWNER_A.tokenIdentifier, now - 89 * DAY_MS, 'retained')

    await t.mutation(internal.learnActivityEventRetention.purgeExpiredLearnActivityEvents, {})
    await t.finishAllScheduledFunctions(() => {})

    const events = await exportedEvents(t, OWNER_A)
    expect(events.page).toHaveLength(1)
    expect(events.page[0]).toMatchObject({ eventType: 'activity_eligible', occurredAt: now - 89 * DAY_MS })
  })
})
