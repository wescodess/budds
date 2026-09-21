/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import * as adaptiveCommandsModule from './learnAdaptiveCommands'
import { executeAdaptiveThreadCommand } from './learnAdaptiveCommands'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const originalFlag = process.env.LEARN_V2_ENABLED
const OWNER = { tokenIdentifier: 'https://auth.example.com|command-owner', subject: 'command-owner', issuer: 'https://auth.example.com' }
const OTHER = { tokenIdentifier: 'https://auth.example.com|command-other', subject: 'command-other', issuer: 'https://auth.example.com' }

beforeEach(() => { process.env.LEARN_V2_ENABLED = 'true'; vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })
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
    const base = { threadId, expectedRevision: 1, idempotencyKey: 'command-key-0000001', commandName: 'submitResponse', apply: async (ctx: Parameters<typeof executeAdaptiveThreadCommand>[0]) => { await ctx.db.patch(threadId, { revision: 2 }); return { value: { accepted: true }, revision: 2 } } }
    await expect(owner.mutation(ctx => executeAdaptiveThreadCommand(ctx, { ...base, payload: { serverScorePercent: 100 } }))).rejects.toThrow(/authoritative field/)
    await expect(other.mutation(ctx => executeAdaptiveThreadCommand(ctx, { ...base, payload: {} }))).rejects.toThrow(/not found/)
    await owner.mutation(ctx => executeAdaptiveThreadCommand(ctx, { ...base, payload: { responseRef: 'one' } }))
    await expect(owner.mutation(ctx => executeAdaptiveThreadCommand(ctx, { ...base, payload: { responseRef: 'two' } }))).resolves.toMatchObject({ kind: 'conflict', code: 'duplicate_key' })
    expect(await t.run(ctx => ctx.db.get(threadId))).toMatchObject({ revision: 2 })
  })

  test('redacts expired detail while preserving terminal receipt identity', async () => {
    const { t, threadId, owner } = await setup()
    const args = { threadId, expectedRevision: 1, idempotencyKey: 'expired-key-0000001', commandName: 'endThread', payload: {}, apply: async (ctx: Parameters<typeof executeAdaptiveThreadCommand>[0]) => { await ctx.db.patch(threadId, { revision: 2 }); return { value: { ended: true }, revision: 2 } } }
    await owner.mutation(ctx => executeAdaptiveThreadCommand(ctx, args))
    await t.mutation(internal.learnAdaptiveCommands.redactExpiredReceiptResults, { now: Date.now() + 31 * 24 * 60 * 60 * 1000 })
    await expect(owner.mutation(ctx => executeAdaptiveThreadCommand(ctx, args))).resolves.toMatchObject({ kind: 'invalid', code: 'result_expired' })
    expect(await t.run(ctx => ctx.db.query('learnActivityCommandReceipts').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).collect())).toHaveLength(1)
  })

  test('rejects a callback that reports a revision not committed to authority', async () => {
    const { t, threadId, owner } = await setup()
    await expect(owner.mutation(ctx => executeAdaptiveThreadCommand(ctx, {
      threadId, expectedRevision: 1, idempotencyKey: 'fabricated-rev-0001', commandName: 'endThread', payload: {},
      apply: async () => ({ value: { ended: true }, revision: 2 }),
    }))).rejects.toThrow(/non-authoritative revision/)
    expect(await t.run(ctx => ctx.db.query('learnActivityCommandReceipts').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).take(1))).toEqual([])
  })

  test('redacts more than one bounded batch without starving pending receipts', async () => {
    const { t, threadId } = await setup()
    await t.run(async (ctx) => {
      for (let index = 0; index < 33; index++) await ctx.db.insert('learnActivityCommandReceipts', {
        userId: OWNER.tokenIdentifier, threadId, idempotencyKeyHash: `sha256:${index.toString(16).padStart(64, '0')}`,
        requestFingerprint: `sha256:${(index + 100).toString(16).padStart(64, '0')}`, commandName: 'fixture', targetRevision: 1,
        resultKind: 'ok', resultReference: '{}', errorReference: null, createdAt: 1, resultExpiresAt: 2, redactionStatus: 'pending',
      })
    })
    await expect(t.mutation(internal.learnAdaptiveCommands.redactExpiredReceiptResults, { now: 3 })).resolves.toEqual({ scanned: 32, redacted: 32 })
    await expect(t.mutation(internal.learnAdaptiveCommands.redactExpiredReceiptResults, { now: 3 })).resolves.toEqual({ scanned: 1, redacted: 1 })
    const rows = await t.run(ctx => ctx.db.query('learnActivityCommandReceipts').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).collect())
    expect(rows.every(row => row.redactionStatus === 'redacted' && row.resultReference === null)).toBe(true)
  })

  test('one authenticated initiation schedules bounded child-before-parent deletion to completion', async () => {
    const { t, threadId, owner } = await setup()
    const command = {
      threadId, expectedRevision: 1, idempotencyKey: 'delete-safety-key-01', commandName: 'endThread', payload: {},
      apply: async (ctx: Parameters<typeof executeAdaptiveThreadCommand>[0]) => { await ctx.db.patch(threadId, { revision: 2 }); return { value: { ended: true }, revision: 2 } },
    }
    const committed = await owner.mutation(ctx => executeAdaptiveThreadCommand(ctx, command))
    await t.run(async (ctx) => {
      for (let index = 0; index < 9; index++) await ctx.db.insert('learnActivityEvents', {
        userId: OWNER.tokenIdentifier, threadId, eventType: 'thread_drafted', eventVersion: 'thread_drafted.v1', taxonomyVersion: 'learn-adaptive.activity-events.v1', occurredAt: index + 1,
        sourceVersion: 'thread.v1', contractVersion: 'learn-adaptive.thread.v1', metadata: {}, dedupeKeyHash: `sha256:${(index + 200).toString(16).padStart(64, '0')}`,
      })
      for (let index = 0; index < 8; index++) await ctx.db.insert('learnActivityCommandReceipts', {
        userId: OWNER.tokenIdentifier, threadId, idempotencyKeyHash: `sha256:${(index + 10).toString(16).padStart(64, '0')}`,
        requestFingerprint: `sha256:${(index + 100).toString(16).padStart(64, '0')}`, commandName: 'fixture', targetRevision: 2,
        resultKind: 'ok', resultReference: '{}', errorReference: null, createdAt: index + 2, resultExpiresAt: 100, redactionStatus: 'pending',
      })
      await ctx.db.insert('learningThreadActivities', {
        userId: OWNER.tokenIdentifier, threadId, activityId: 'delete-fixture', boundaryOrdinal: 1, planRevision: 1, activityClass: 'non_factual', status: 'eligible',
        planVersion: 'learn-adaptive.activity-plan.v1', replayVersion: 'learn-adaptive.activity-replay.v1', contractVersion: 'learn-adaptive.activity-contract.v1', rendererVersion: 'learn-adaptive.renderer.v1', validationVersion: 'learn-adaptive.primitive-validation.v1', sequenceValidationVersion: 'learn-adaptive.primitive-sequence-validation.v1', fallbackVersion: 'learn-adaptive.text-card-fallback.v1',
        intent: 'understand', objectiveId: null, purpose: 'fixture', reasonCode: 'fixture', primitivePlan: [], requiredAction: { kind: 'continue', label: 'Continue' }, evaluationContract: { version: 'v1', kind: 'acknowledgement', responseFormat: 'none', passingScorePercent: null }, fallback: { version: 'learn-adaptive.text-card-fallback.v1', kind: 'text_card', title: 'Fallback', body: 'Fallback', primaryAction: { type: 'continue_safe', label: 'Continue' }, testId: 'learn-activity-fallback' }, accessibilityMetadata: { heading: 'Fixture', instructions: 'Fixture', focusTargetTestId: 'fixture', liveRegionMode: 'off' }, learningVoidId: null, blueprintRevisionId: null, sessionContentId: null, evidenceReferences: [], generationInputs: { sessionContentRevision: null, sessionContentInputDigest: null, generatorVersion: null }, decisionInputs: { intentRevision: 1, routerVersion: 'v1', availableTime: '15', sourceState: 'none', sourceInputs: [], priorActivityId: null, priorAttemptId: null, priorOutcome: null, assistance: 'none', confidence: null }, replacesActivityId: null, canonicalInputSnapshot: '{}', inputDigest: `sha256:${'3'.repeat(64)}`, createdAt: 1, updatedAt: 1,
      })
    })
    expect('deleteThread' in adaptiveCommandsModule).toBe(false)
    expect('requestThreadDeletion' in adaptiveCommandsModule).toBe(false)
    await expect(t.withIdentity(OTHER).mutation(api.learnAdaptive.requestThreadDeletion, { threadId })).rejects.toThrow(/Thread not found/)
    await expect(owner.mutation(api.learnAdaptive.requestThreadDeletion, { threadId })).resolves.toMatchObject({ status: 'queued' })
    const deletionJob = await t.run(ctx => ctx.db.query('learnAdaptiveThreadDeletionJobs').withIndex('by_userId_and_threadId', q => q.eq('userId', OWNER.tokenIdentifier).eq('threadId', threadId)).unique())
    await expect(t.mutation(internal.learnAdaptiveCommands.runThreadDeletionJob, { jobId: deletionJob!._id })).resolves.toMatchObject({ phase: 'events', state: 'queued' })
    expect(await t.run(ctx => ctx.db.query('learnActivityEvents').withIndex('by_userId_and_threadId_and_occurredAt', q => q.eq('userId', OWNER.tokenIdentifier).eq('threadId', threadId)).take(2))).toHaveLength(1)
    await expect(owner.mutation(ctx => executeAdaptiveThreadCommand(ctx, command))).resolves.toEqual(committed)
    await expect(owner.mutation(ctx => executeAdaptiveThreadCommand(ctx, { ...command, payload: { changed: true } }))).resolves.toMatchObject({ kind: 'conflict', code: 'duplicate_key' })
    await expect(owner.mutation(ctx => executeAdaptiveThreadCommand(ctx, { ...command, idempotencyKey: 'delete-new-key-0001' }))).rejects.toThrow(/deletion is in progress/)
    expect(await t.run(ctx => ctx.db.query('learnActivityCommandReceipts').withIndex('by_userId_and_threadId', q => q.eq('userId', OWNER.tokenIdentifier).eq('threadId', threadId)).collect())).toHaveLength(9)
    await expect(owner.mutation(ctx => executeAdaptiveThreadCommand(ctx, command))).resolves.toEqual(committed)
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    expect(await t.run(ctx => ctx.db.get(threadId))).toBeNull()
    expect(await t.run(ctx => ctx.db.query('learnActivityEvents').withIndex('by_userId_and_threadId_and_occurredAt', q => q.eq('userId', OWNER.tokenIdentifier).eq('threadId', threadId)).take(1))).toEqual([])
    expect(await t.run(ctx => ctx.db.query('learnActivityCommandReceipts').withIndex('by_userId_and_threadId', q => q.eq('userId', OWNER.tokenIdentifier).eq('threadId', threadId)).collect())).toEqual([])
    expect(await t.run(ctx => ctx.db.query('learnAdaptiveThreadDeletionJobs').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).collect())).toEqual([])
  })

  test('continues authenticated thread maintenance while adaptive and V2 rollout are disabled', async () => {
    const { t, threadId, owner } = await setup()
    await owner.mutation(internal.learnAdaptiveAccess.setCohortEntitlement, { enabled: false })
    process.env.LEARN_V2_ENABLED = 'false'
    await expect(owner.mutation(api.learnAdaptive.requestThreadDeletion, { threadId })).resolves.toMatchObject({ status: 'queued' })
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    expect(await t.run(ctx => ctx.db.get(threadId))).toBeNull()
  })

  test('bounds worker retries and retains a terminal job when durable authority is inconsistent', async () => {
    const { t } = await setup()
    const foreignThreadId = await t.run(ctx => ctx.db.insert('learningThreads', {
      userId: OTHER.tokenIdentifier, originalNeed: 'Foreign authority', intent: 'understand', availableTime: '15', authorityKind: 'standalone',
      sourceScope: { kind: 'none' }, evidenceState: 'none', lifecycle: 'active', revision: 1, createdAt: 1, updatedAt: 1,
    }))
    const jobId = await t.run(ctx => ctx.db.insert('learnAdaptiveThreadDeletionJobs', {
      userId: OWNER.tokenIdentifier, threadId: foreignThreadId, phase: 'children', status: 'queued', attempts: 0, createdAt: 1, updatedAt: 1,
    }))

    await expect(t.mutation(internal.learnAdaptiveCommands.runThreadDeletionJob, { jobId }))
      .resolves.toMatchObject({ state: 'retrying', attempts: 1, retryAfterMs: 1_000 })
    expect(await t.run(ctx => ctx.db.get(jobId))).toMatchObject({ status: 'retrying', attempts: 1, terminalReason: 'authority_mismatch' })
    await t.finishAllScheduledFunctions(vi.runAllTimers)

    expect(await t.run(ctx => ctx.db.get(jobId))).toMatchObject({ status: 'failed', attempts: 3, terminalReason: 'authority_mismatch' })
    expect(await t.run(ctx => ctx.db.get(foreignThreadId))).not.toBeNull()
  })
})
