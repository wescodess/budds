/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const OWNER = { tokenIdentifier: 'https://auth.example.com|lifecycle-owner' }
const OTHER = { tokenIdentifier: 'https://auth.example.com|lifecycle-other' }
const originalFlag = process.env.LEARN_V2_ENABLED
beforeEach(() => { process.env.LEARN_V2_ENABLED = 'true' })
afterAll(() => { if (originalFlag === undefined) delete process.env.LEARN_V2_ENABLED; else process.env.LEARN_V2_ENABLED = originalFlag })

async function fixture() {
  const t = convexTest(schema, modules)
  for (const identity of [OWNER, OTHER]) {
    const actor = t.withIdentity(identity)
    await actor.mutation(api.users.upsertUser, {})
    await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: identity.tokenIdentifier, enabled: true })
    await actor.mutation(internal.learnAdaptiveAccess.setCohortEntitlement, { enabled: true })
  }
  const owner = t.withIdentity(OWNER)
  const created = await owner.mutation(api.learnAdaptiveDrafts.createThreadDraft, {
    need: 'Understand this topic.', outcome: 'Explain it clearly.', intent: 'understand',
    availableTime: '15', sourceScope: { kind: 'none' }, idempotencyKey: 'lifecycle-create-draft-001',
  })
  if (created.kind !== 'created') throw new Error('Expected thread')
  return { t, owner, other: t.withIdentity(OTHER), threadId: created.thread.id }
}

describe('durable thread lifecycle', () => {
  test('leave and resume restore the prior lifecycle with durable timestamps and receipts', async () => {
    const { owner, threadId } = await fixture()
    const left = await owner.mutation(api.learnAdaptive.leaveThread, {
      threadId, expectedRevision: 1, idempotencyKey: 'lifecycle-leave-001',
    })
    expect(left).toMatchObject({ kind: 'ok', revision: 2, value: { lifecycle: 'paused', previousLifecycle: 'draft', changedAt: expect.any(Number) } })
    expect(left.kind).toBe('ok')
    if (left.kind !== 'ok') return
    expect(left.receiptId).toEqual(expect.any(String))
    expect(await owner.query(api.learnAdaptive.getThread, { threadId })).toMatchObject({
      thread: { lifecycle: 'paused', revision: 2, lifecycleChangedAt: left.value.changedAt },
    })
    await expect(owner.mutation(api.learnAdaptive.setIntent, {
      threadId, intent: 'refresh', expectedRevision: 2, idempotencyKey: 'lifecycle-paused-intent-001',
    })).rejects.toThrow(/lifecycle/i)
    expect(await owner.query(api.learnAdaptive.getThread, { threadId })).toMatchObject({
      thread: { lifecycle: 'paused', intent: 'understand', revision: 2 },
    })
    const resumed = await owner.mutation(api.learnAdaptive.resumeThread, {
      threadId, expectedRevision: 2, idempotencyKey: 'lifecycle-resume-001',
    })
    expect(resumed).toMatchObject({ kind: 'ok', revision: 3, value: { lifecycle: 'draft', changedAt: expect.any(Number) } })
    expect(await owner.query(api.learnAdaptive.getThread, { threadId })).toMatchObject({
      thread: { lifecycle: 'draft', revision: 3, lifecycleChangedAt: resumed.kind === 'ok' ? resumed.value.changedAt : null },
    })
  })

  test('a V2 anchored thread keeps its immutable mission and rejects a foreign anchor', async () => {
    const { t, owner, threadId } = await fixture()
    const { learningVoidId, foreignVoidId } = await t.run(async ctx => {
      const now = Date.now()
      const folderId = await ctx.db.insert('folders', { userId: OWNER.tokenIdentifier, name: 'Lifecycle source', documentCount: 0 })
      const foreignFolderId = await ctx.db.insert('folders', { userId: OTHER.tokenIdentifier, name: 'Other source', documentCount: 0 })
      const learningVoidId = await ctx.db.insert('learningVoids', { userId: OWNER.tokenIdentifier, folderId, title: 'Owned mission', status: 'active', revision: 7, createdAt: now, updatedAt: now })
      const foreignVoidId = await ctx.db.insert('learningVoids', { userId: OTHER.tokenIdentifier, folderId: foreignFolderId, title: 'Foreign mission', status: 'active', revision: 9, createdAt: now, updatedAt: now })
      await ctx.db.patch(threadId, { authorityKind: 'v2_mission', learningVoidId, lifecycle: 'active' })
      return { learningVoidId, foreignVoidId }
    })
    const left = await owner.mutation(api.learnAdaptive.leaveThread, { threadId, expectedRevision: 1, idempotencyKey: 'lifecycle-v2-leave-001' })
    expect(left).toMatchObject({ kind: 'ok', value: { lifecycle: 'paused', previousLifecycle: 'active' } })
    const resumed = await owner.mutation(api.learnAdaptive.resumeThread, { threadId, expectedRevision: 2, idempotencyKey: 'lifecycle-v2-resume-001' })
    expect(resumed).toMatchObject({ kind: 'ok', value: { lifecycle: 'active' } })
    expect(await owner.query(api.learnAdaptive.getThread, { threadId })).toMatchObject({ thread: { authorityKind: 'v2_mission', learningVoidId, lifecycle: 'active' } })
    expect(await t.run(ctx => ctx.db.get(learningVoidId))).toMatchObject({ revision: 7, status: 'active' })
    expect(await t.run(ctx => ctx.db.query('masteryAttempts').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).take(1))).toEqual([])
    expect(await t.run(ctx => ctx.db.query('learnJobs').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).take(1))).toEqual([])

    await t.run(ctx => ctx.db.patch(threadId, { learningVoidId: foreignVoidId }))
    await expect(owner.mutation(api.learnAdaptive.leaveThread, { threadId, expectedRevision: 3, idempotencyKey: 'lifecycle-v2-foreign-001' })).rejects.toThrow(/mission anchor/i)
    expect(await t.run(ctx => ctx.db.get(threadId))).toMatchObject({ lifecycle: 'active', revision: 3, learningVoidId: foreignVoidId })
  })

  test('an in-flight activity cannot revive a paused or explicitly ended thread', async () => {
    const { t, owner, threadId } = await fixture()
    const decision = await owner.mutation(api.learnAdaptiveClarifications.prepareInitialDecision, {
      threadId, expectedRevision: 1, idempotencyKey: 'lifecycle-decision-001',
    })
    expect(decision.kind).toBe('ok')
    const started = await owner.mutation(api.learnAdaptiveRecovery.continueDraft, {
      threadId, expectedRevision: 2, idempotencyKey: 'lifecycle-diagnostic-001',
    })
    if (started.kind !== 'ok') throw new Error('Expected diagnostic')
    const activityId = started.value.activityId
    expect(await owner.mutation(api.learnAdaptive.leaveThread, {
      threadId, expectedRevision: 3, idempotencyKey: 'lifecycle-active-leave-001',
    })).toMatchObject({ kind: 'ok', revision: 4 })
    expect(await owner.mutation(api.learnAdaptiveRecovery.submitDiagnosticResponse, {
      threadId, activityId, expectedRevision: 4, response: 'Paused answer', idempotencyKey: 'lifecycle-paused-answer-001',
    })).toMatchObject({ kind: 'blocked', code: 'thread_not_active' })
    expect(await owner.query(api.learnAdaptive.getThread, { threadId })).toMatchObject({ thread: { lifecycle: 'paused', revision: 4 } })

    const ended = await owner.mutation(api.learnAdaptive.endThread, {
      threadId, expectedRevision: 4, idempotencyKey: 'lifecycle-end-001',
    })
    expect(ended).toMatchObject({ kind: 'ok', revision: 5, value: { lifecycle: 'ended', changedAt: expect.any(Number) } })
    expect(await owner.mutation(api.learnAdaptive.endThread, {
      threadId, expectedRevision: 4, idempotencyKey: 'lifecycle-end-001',
    })).toEqual(ended)
    expect(await owner.mutation(api.learnAdaptiveRecovery.submitDiagnosticResponse, {
      threadId, activityId, expectedRevision: 5, response: 'Ended answer', idempotencyKey: 'lifecycle-ended-answer-001',
    })).toMatchObject({ kind: 'blocked', code: 'thread_not_active' })
    expect(await owner.mutation(api.learnAdaptive.resumeThread, {
      threadId, expectedRevision: 5, idempotencyKey: 'lifecycle-ended-resume-001',
    })).toMatchObject({ kind: 'blocked', code: 'lifecycle_unavailable' })
    expect(await owner.query(api.learnAdaptive.getThread, { threadId })).toMatchObject({ thread: { lifecycle: 'ended', revision: 5, lifecycleChangedAt: ended.kind === 'ok' ? ended.value.changedAt : null } })
    const events = await t.run(ctx => ctx.db.query('learnActivityEvents')
      .withIndex('by_userId_and_threadId_and_occurredAt', q => q.eq('userId', OWNER.tokenIdentifier).eq('threadId', threadId)).take(12))
    expect(events.filter(event => event.eventType === 'explicit_end')).toEqual([
      expect.objectContaining({ eventVersion: 'explicit_end.v1', occurredAt: ended.kind === 'ok' ? ended.value.changedAt : null }),
    ])
  })

  test('stale revisions, key reuse, and foreign owners cannot change lifecycle', async () => {
    const { owner, other, threadId } = await fixture()
    const args = { threadId, expectedRevision: 1, idempotencyKey: 'lifecycle-conflict-leave-001' }
    const left = await owner.mutation(api.learnAdaptive.leaveThread, args)
    expect(left).toMatchObject({ kind: 'ok', revision: 2 })
    expect(await owner.mutation(api.learnAdaptive.leaveThread, args)).toEqual(left)
    expect(await owner.mutation(api.learnAdaptive.resumeThread, { ...args, idempotencyKey: 'lifecycle-stale-resume-001' })).toMatchObject({
      kind: 'conflict', code: 'stale_revision', expectedRevision: 1, actualRevision: 2,
    })
    expect(await owner.mutation(api.learnAdaptive.resumeThread, { ...args, expectedRevision: 2 })).toMatchObject({
      kind: 'conflict', code: 'duplicate_key',
    })
    await expect(other.mutation(api.learnAdaptive.endThread, {
      threadId, expectedRevision: 2, idempotencyKey: 'lifecycle-foreign-end-001',
    })).rejects.toThrow(/not found/i)
    expect(await owner.query(api.learnAdaptive.getThread, { threadId })).toMatchObject({ thread: { lifecycle: 'paused', revision: 2 } })
  })

  test('thread deletion retains maintenance authority after an explicit end and gate shutdown', async () => {
    const { t, owner, threadId } = await fixture()
    expect(await owner.mutation(api.learnAdaptive.endThread, {
      threadId, expectedRevision: 1, idempotencyKey: 'lifecycle-delete-end-001',
    })).toMatchObject({ kind: 'ok', revision: 2 })
    await owner.mutation(internal.learnAdaptiveAccess.setCohortEntitlement, { enabled: false })
    const requested = await owner.mutation(api.learnAdaptive.requestThreadDeletion, { threadId })
    expect(requested).toMatchObject({ status: 'queued', jobId: expect.any(String) })
    for (let batch = 0; batch < 12 && await t.run(ctx => ctx.db.get(requested.jobId)); batch++) {
      await t.mutation(internal.learnAdaptiveCommands.runThreadDeletionJob, { jobId: requested.jobId })
    }
    expect(await t.run(ctx => ctx.db.get(threadId))).toBeNull()
    expect(await t.run(ctx => ctx.db.get(requested.jobId))).toBeNull()
    expect(await t.run(ctx => ctx.db.query('learnActivityCommandReceipts')
      .withIndex('by_userId_and_threadId', q => q.eq('userId', OWNER.tokenIdentifier).eq('threadId', threadId)).take(1))).toEqual([])
  })
})
