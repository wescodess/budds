/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { writeLearnActivityEvent } from './lib/learnAdaptiveEvents'

const modules = import.meta.glob('./**/*.ts')
const OWNER = 'https://auth.example.com|event-owner'

async function fixture() {
  const t = convexTest(schema, modules)
  const threadId = await t.run(ctx => ctx.db.insert('learningThreads', { userId: OWNER, originalNeed: 'Learn safely', intent: 'understand', availableTime: '15', authorityKind: 'standalone', sourceScope: { kind: 'none' }, evidenceState: 'none', lifecycle: 'ready', revision: 1, createdAt: 1, updatedAt: 1 }))
  return { t, threadId }
}

describe('Adaptive Learn event writer', () => {
  test('writes one owner-scoped event for a deterministic semantic key', async () => {
    const { t, threadId } = await fixture()
    const input = {
      userId: OWNER,
      threadId,
      eventType: 'activity_eligible' as const,
      eventVersion: 'activity_eligible.v1' as const,
      sourceVersion: 'learn-adaptive.activity-plan.v1',
      contractVersion: 'learn-adaptive.activity-contract.v1',
      semanticKey: 'activity:one:eligible',
      occurredAt: 10,
      reasonCode: 'activity_plan_committed',
      outcomeCode: 'eligible',
      metadata: { activityClass: 'non_factual' as const, boundaryOrdinal: 1, planRevision: 1 },
    }
    const first = await t.run(ctx => writeLearnActivityEvent(ctx, input))
    expect(await t.run(ctx => writeLearnActivityEvent(ctx, input))).toEqual({ eventId: first.eventId, replayed: true })
    const rows = await t.run(ctx => ctx.db.query('learnActivityEvents').withIndex('by_userId_and_threadId_and_occurredAt', q => q.eq('userId', OWNER).eq('threadId', threadId)).take(2))
    expect(rows).toEqual([expect.objectContaining({ eventType: 'activity_eligible', eventVersion: 'activity_eligible.v1', taxonomyVersion: 'learn-adaptive.activity-events.v1', metadata: input.metadata })])
    expect(rows[0]).not.toHaveProperty('semanticKey')
  })

  test('replays semantically identical metadata regardless of key insertion order', async () => {
    const { t, threadId } = await fixture()
    const base = {
      userId: OWNER,
      threadId,
      eventType: 'activity_eligible' as const,
      eventVersion: 'activity_eligible.v1' as const,
      sourceVersion: 'learn-adaptive.activity-plan.v1',
      contractVersion: 'learn-adaptive.activity-contract.v1',
      semanticKey: 'activity:ordered:eligible',
      occurredAt: 10,
    }
    const first = await t.run(ctx => writeLearnActivityEvent(ctx, {
      ...base,
      metadata: { activityClass: 'factual', boundaryOrdinal: 1, planRevision: 1 },
    }))
    await expect(t.run(ctx => writeLearnActivityEvent(ctx, {
      ...base,
      metadata: { planRevision: 1, boundaryOrdinal: 1, activityClass: 'factual' },
    }))).resolves.toEqual({ eventId: first.eventId, replayed: true })
  })

  test('rejects private payloads and owner mismatches before any write', async () => {
    const { t, threadId } = await fixture()
    const base = { userId: OWNER, threadId, eventType: 'provider_failure' as const, eventVersion: 'provider_failure.v1' as const, sourceVersion: 'provider.v1', contractVersion: 'learn-adaptive.activity-contract.v1', semanticKey: 'provider:one:failure', occurredAt: 10, metadata: { providerStage: 'outcome' as const } }
    await expect(t.run(ctx => writeLearnActivityEvent(ctx, { ...base, rawQuery: 'private query' } as never))).rejects.toThrow(/event payload/i)
    await expect(t.run(ctx => writeLearnActivityEvent(ctx, { ...base, userId: 'other-owner' }))).rejects.toThrow(/authority/i)
    expect(await t.run(ctx => ctx.db.query('learnActivityEvents').withIndex('by_userId', q => q.eq('userId', OWNER)).take(1))).toEqual([])
  })

  test('rolls an event back with the authoritative transaction', async () => {
    const { t, threadId } = await fixture()
    await expect(t.run(async (ctx) => {
      await writeLearnActivityEvent(ctx, { userId: OWNER, threadId, eventType: 'thread_drafted', eventVersion: 'thread_drafted.v1', sourceVersion: 'thread.v1', contractVersion: 'learn-adaptive.thread.v1', semanticKey: 'thread:draft', occurredAt: 1 })
      throw new Error('authoritative transition failed')
    })).rejects.toThrow('authoritative transition failed')
    expect(await t.run(ctx => ctx.db.query('learnActivityEvents').withIndex('by_userId', q => q.eq('userId', OWNER)).take(1))).toEqual([])
  })
})
