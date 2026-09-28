/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const OWNER = { tokenIdentifier: 'https://auth.example.com|resume-owner' }
const OTHER = { tokenIdentifier: 'https://auth.example.com|resume-other' }
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
  async function create(need: string, key: string) {
    const result = await owner.mutation(api.learnAdaptiveDrafts.createThreadDraft, {
      need, intent: 'refresh', availableTime: '15', sourceScope: { kind: 'none' }, idempotencyKey: key,
    })
    if (result.kind !== 'created') throw new Error('Expected thread')
    return result.thread.id
  }
  return { t, owner, other: t.withIdentity(OTHER), create }
}

describe('meaningful resume projection', () => {
  test('pages only owner history, retains ended threads, and closes adaptive reads when access is off', async () => {
    const { t, owner, other, create } = await fixture()
    const ids: Id<'learningThreads'>[] = []
    for (let index = 0; index < 10; index++) ids.push(await create(`History thread ${index}`, `history-thread-${index}`))
    await t.run(async ctx => {
      for (let index = 0; index < ids.length; index++) await ctx.db.patch(ids[index]!, { updatedAt: 1_000 + index })
      await ctx.db.patch(ids[9]!, { lifecycle: 'ended' })
      await ctx.db.patch(ids[8]!, { deletionStartedAt: Date.now() })
    })
    const first = await owner.query(api.learnAdaptive.listThreadHistory, { cursor: null })
    expect(first.page).toHaveLength(7)
    expect(first.page.map(item => item.threadId)).toContain(ids[9])
    expect(first.page.map(item => item.threadId)).not.toContain(ids[8])
    expect(first.isDone).toBe(false)
    const second = await owner.query(api.learnAdaptive.listThreadHistory, { cursor: first.continueCursor })
    expect([...first.page, ...second.page].map(item => item.threadId)).toEqual([...ids].reverse().filter(id => id !== ids[8]))
    expect(second.isDone).toBe(true)
    expect(await other.query(api.learnAdaptive.listThreadHistory, { cursor: null })).toMatchObject({ page: [], isDone: true })
    await owner.mutation(internal.learnAdaptiveAccess.setCohortEntitlement, { enabled: false })
    await expect(owner.query(api.learnAdaptive.listThreadHistory, { cursor: null })).rejects.toThrow(/denied/)
    expect(await t.run(ctx => ctx.db.get(ids[9]!))).toMatchObject({ lifecycle: 'ended' })
  })

  test('prioritizes an actionable unfinished activity over a more recent draft and excludes another owner', async () => {
    const { t, owner, other, create } = await fixture()
    const unfinished = await create('Finish orbital motion', 'resume-unfinished-0001')
    await owner.mutation(api.learnAdaptiveClarifications.prepareInitialDecision, {
      threadId: unfinished, expectedRevision: 1, idempotencyKey: 'resume-decision-0001',
    })
    const started = await owner.mutation(api.learnAdaptiveRecovery.continueDraft, {
      threadId: unfinished, expectedRevision: 2, idempotencyKey: 'resume-continue-0001',
    })
    if (started.kind !== 'ok') throw new Error('Expected activity')
    const recent = await create('Recent new question', 'resume-recent-0001')
    await t.run(ctx => ctx.db.patch(recent, { updatedAt: Date.now() + 10_000 }))
    const ranked = await owner.query(api.learnAdaptive.listResumeCandidates, {})
    expect(ranked.map(item => item.threadId)).toEqual([unfinished, recent])
    expect(ranked[0]).toMatchObject({ reason: 'unfinished_activity', currentActivity: { id: started.value.activityId }, nextAction: { kind: 'submit_response' } })
    expect(await other.query(api.learnAdaptive.listResumeCandidates, {})).toEqual([])
  })

  test('finds older unfinished work outside the recent draft window', async () => {
    const { owner, create } = await fixture()
    const unfinished = await create('Older unfinished question', 'resume-older-thread-0001')
    await owner.mutation(api.learnAdaptiveClarifications.prepareInitialDecision, {
      threadId: unfinished, expectedRevision: 1, idempotencyKey: 'resume-older-decision-0001',
    })
    await owner.mutation(api.learnAdaptiveRecovery.continueDraft, {
      threadId: unfinished, expectedRevision: 2, idempotencyKey: 'resume-older-continue-0001',
    })
    for (let index = 0; index < 17; index++) await create(`Recent draft ${index}`, `resume-newer-draft-${String(index).padStart(4, '0')}`)
    const ranked = await owner.query(api.learnAdaptive.listResumeCandidates, {})
    expect(ranked[0]).toMatchObject({ threadId: unfinished, reason: 'unfinished_activity' })
  })

  test('uses persisted needs-review state ahead of recent drafts without changing mastery', async () => {
    const { t, owner, create } = await fixture()
    const review = await create('Review gravity', 'resume-vulnerable-0001')
    await owner.mutation(api.learnAdaptiveClarifications.prepareInitialDecision, {
      threadId: review, expectedRevision: 1, idempotencyKey: 'resume-vulnerable-decision-0001',
    })
    await owner.mutation(api.learnAdaptiveRecovery.continueDraft, {
      threadId: review, expectedRevision: 2, idempotencyKey: 'resume-vulnerable-continue-0001',
    })
    const masteryId = await t.run(async ctx => {
      const folderId = await ctx.db.insert('folders', { userId: OWNER.tokenIdentifier, name: 'Sources', documentCount: 0 })
      const learningVoidId = await ctx.db.insert('learningVoids', { userId: OWNER.tokenIdentifier, folderId, title: 'Gravity', status: 'active', revision: 1, createdAt: 1, updatedAt: 1 })
      const blueprintId = await ctx.db.insert('learnBlueprints', { userId: OWNER.tokenIdentifier, learningVoidId, revision: 1, createdAt: 1 })
      const blueprintRevisionId = await ctx.db.insert('learnBlueprintRevisions', { userId: OWNER.tokenIdentifier, blueprintId, learningVoidId, revision: 1, recordRevision: 1, status: 'active', createdAt: 1, updatedAt: 1 })
      const objectiveId = await ctx.db.insert('learnObjectives', { userId: OWNER.tokenIdentifier, blueprintRevisionId, order: 0, title: 'Explain gravity' })
      const thread = await ctx.db.get(review)
      if (!thread?.currentActivityId) throw new Error('Expected activity')
      await ctx.db.patch(thread.currentActivityId, { objectiveId, blueprintRevisionId, status: 'ended' })
      return await ctx.db.insert('masteryRecords', { userId: OWNER.tokenIdentifier, blueprintRevisionId, objectiveId, state: 'needs_review', updatedAt: 1 })
    })
    for (let index = 0; index < 17; index++) await create(`New draft ${index}`, `resume-review-draft-${String(index).padStart(4, '0')}`)
    const ranked = await owner.query(api.learnAdaptive.listResumeCandidates, {})
    expect(ranked[0]).toMatchObject({ threadId: review, reason: 'needs_review', reviewCapability: 'Explain gravity' })
    expect(await t.run(ctx => ctx.db.get(masteryId))).toMatchObject({ state: 'needs_review', updatedAt: 1 })
    await t.run(async ctx => {
      const record = await ctx.db.get(masteryId)
      if (!record) throw new Error('Expected mastery record')
      await ctx.db.patch(record.objectiveId, { userId: 'another-user' })
    })
    expect((await owner.query(api.learnAdaptive.listResumeCandidates, {})).find(candidate => candidate.threadId === review))
      .toMatchObject({ reason: 'recent_thread', reviewCapability: null })
  })

  test('places a stale factual boundary in recovery without offering its old submission', async () => {
    const { t, owner, create } = await fixture()
    const stale = await create('Check changed source', 'resume-stale-thread-0001')
    await owner.mutation(api.learnAdaptiveClarifications.prepareInitialDecision, {
      threadId: stale, expectedRevision: 1, idempotencyKey: 'resume-stale-decision-0001',
    })
    await owner.mutation(api.learnAdaptiveRecovery.continueDraft, {
      threadId: stale, expectedRevision: 2, idempotencyKey: 'resume-stale-continue-0001',
    })
    await t.run(async ctx => {
      const thread = await ctx.db.get(stale)
      if (!thread?.currentActivityId) throw new Error('Expected activity')
      await ctx.db.patch(thread.currentActivityId, { activityClass: 'factual' })
      await ctx.db.patch(stale, { evidenceState: 'stale', unresolvedPoint: 'The source changed; check the explanation.' })
    })
    const recent = await create('Newer draft', 'resume-stale-newer-0001')
    await t.run(ctx => ctx.db.patch(recent, { updatedAt: Date.now() + 10_000 }))
    const ranked = await owner.query(api.learnAdaptive.listResumeCandidates, {})
    expect(ranked[0]).toMatchObject({ threadId: stale, reason: 'source_recovery', evidenceState: 'stale',
      unresolvedPoint: 'The source changed; check the explanation.', nextAction: { kind: 'recover' } })
  })

  test('prioritizes invalidated factual evidence but does not mislabel a non-factual stale draft as a source change', async () => {
    const { t, owner, create } = await fixture()
    const invalidated = await create('Recheck an invalidated source', 'resume-invalidated-0001')
    await owner.mutation(api.learnAdaptiveClarifications.prepareInitialDecision, {
      threadId: invalidated, expectedRevision: 1, idempotencyKey: 'resume-invalidated-decision-0001',
    })
    await owner.mutation(api.learnAdaptiveRecovery.continueDraft, {
      threadId: invalidated, expectedRevision: 2, idempotencyKey: 'resume-invalidated-continue-0001',
    })
    await t.run(async ctx => {
      const thread = await ctx.db.get(invalidated)
      if (!thread?.currentActivityId) throw new Error('Expected activity')
      await ctx.db.patch(thread.currentActivityId, { activityClass: 'factual', status: 'blocked' })
      await ctx.db.patch(invalidated, { evidenceState: 'invalidated' })
    })
    const nonFactual = await create('Unrelated draft', 'resume-nonfactual-stale-0001')
    await t.run(ctx => ctx.db.patch(nonFactual, { evidenceState: 'stale', updatedAt: Date.now() + 10_000 }))
    const ranked = await owner.query(api.learnAdaptive.listResumeCandidates, {})
    expect(ranked[0]).toMatchObject({ threadId: invalidated, reason: 'source_recovery', nextAction: { kind: 'recover' } })
    expect(ranked.find(candidate => candidate.threadId === nonFactual)?.reason).toBe('recent_thread')
  })
})
