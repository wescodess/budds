/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { api, internal } from './_generated/api'
import { executeAdaptiveThreadCommand } from './learnAdaptiveCommands'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const originalFlag = process.env.LEARN_V2_ENABLED
const OWNER = { tokenIdentifier: 'https://auth.example.com|command-owner', subject: 'command-owner', issuer: 'https://auth.example.com' }
const OTHER = { tokenIdentifier: 'https://auth.example.com|command-other', subject: 'command-other', issuer: 'https://auth.example.com' }

beforeEach(() => { process.env.LEARN_V2_ENABLED = 'true' })
afterAll(() => { if (originalFlag === undefined) delete process.env.LEARN_V2_ENABLED; else process.env.LEARN_V2_ENABLED = originalFlag })

async function setup() {
  const t = convexTest(schema, modules)
  for (const identity of [OWNER, OTHER]) {
    const actor = t.withIdentity(identity)
    await actor.mutation(api.users.upsertUser, {})
    await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: identity.tokenIdentifier, enabled: true })
    await actor.mutation(internal.learnAdaptiveAccess.setCohortEntitlement, { enabled: true })
  }
  const threadId = await t.run(ctx => ctx.db.insert('learningThreads', { userId: OWNER.tokenIdentifier, originalNeed: 'Finish safely', intent: 'understand', availableTime: '15', authorityKind: 'standalone', sourceScope: { kind: 'none' }, evidenceState: 'none', lifecycle: 'active', revision: 1, createdAt: 1, updatedAt: 1 }))
  return { t, threadId, owner: t.withIdentity(OWNER), other: t.withIdentity(OTHER) }
}

describe('Adaptive Learn command receipts', () => {
  test('commits an owner-checked server-derived transition once and replays before stale revision checks', async () => {
    const { t, threadId, owner } = await setup()
    const run = () => owner.mutation(ctx => executeAdaptiveThreadCommand(ctx, {
      threadId, expectedRevision: 1, idempotencyKey: 'end-thread-key-0001', commandName: 'endThread', payload: { reasonCode: 'learner_done' },
      apply: async (commandCtx, thread) => { await commandCtx.db.patch(thread._id, { lifecycle: 'ended', revision: 2, updatedAt: 2 }); return { value: { lifecycle: 'ended' as const }, revision: 2 } },
    }))
    const first = await run()
    expect(await run()).toEqual(first)
    const durable = await t.run(async ctx => ({ thread: await ctx.db.get(threadId), receipts: await ctx.db.query('learnActivityCommandReceipts').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).collect() }))
    expect(durable.thread).toMatchObject({ lifecycle: 'ended', revision: 2 })
    expect(durable.receipts).toHaveLength(1)
    expect(durable.receipts[0]).not.toHaveProperty('idempotencyKey')
  })

  test('conflicts changed requests, rejects foreign owners, and rejects client authority before writes', async () => {
    const { t, threadId, owner, other } = await setup()
    const base = { threadId, expectedRevision: 1, idempotencyKey: 'command-key-0000001', commandName: 'submitResponse', apply: async () => ({ value: { accepted: true }, revision: 2 }) }
    await expect(owner.mutation(ctx => executeAdaptiveThreadCommand(ctx, { ...base, payload: { serverScorePercent: 100 } }))).rejects.toThrow(/authoritative field/)
    await expect(other.mutation(ctx => executeAdaptiveThreadCommand(ctx, { ...base, payload: {} }))).rejects.toThrow(/not found/)
    await owner.mutation(ctx => executeAdaptiveThreadCommand(ctx, { ...base, payload: { responseRef: 'one' } }))
    await expect(owner.mutation(ctx => executeAdaptiveThreadCommand(ctx, { ...base, payload: { responseRef: 'two' } }))).resolves.toMatchObject({ kind: 'conflict', code: 'duplicate_key' })
    expect(await t.run(ctx => ctx.db.get(threadId))).toMatchObject({ revision: 1 })
  })

  test('redacts expired detail while preserving terminal receipt identity', async () => {
    const { t, threadId, owner } = await setup()
    const args = { threadId, expectedRevision: 1, idempotencyKey: 'expired-key-0000001', commandName: 'endThread', payload: {}, apply: async () => ({ value: { ended: true }, revision: 1 }) }
    await owner.mutation(ctx => executeAdaptiveThreadCommand(ctx, args))
    await t.mutation(internal.learnAdaptiveCommands.redactExpiredReceiptResults, { now: Date.now() + 31 * 24 * 60 * 60 * 1000 })
    await expect(owner.mutation(ctx => executeAdaptiveThreadCommand(ctx, args))).resolves.toMatchObject({ kind: 'invalid', code: 'result_expired' })
    expect(await t.run(ctx => ctx.db.query('learnActivityCommandReceipts').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).collect())).toHaveLength(1)
  })
})
