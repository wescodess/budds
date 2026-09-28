/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterAll, afterEach, beforeEach, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const OWNER = { tokenIdentifier: 'https://auth.example.com|promotion-owner' }
const OTHER = { tokenIdentifier: 'https://auth.example.com|promotion-other' }
const originalFlag = process.env.LEARN_V2_ENABLED
beforeEach(() => { process.env.LEARN_V2_ENABLED = 'true'; vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })
afterAll(() => { if (originalFlag === undefined) delete process.env.LEARN_V2_ENABLED; else process.env.LEARN_V2_ENABLED = originalFlag })

async function fixture(intent: 'understand' | 'master' = 'understand') {
  const t = convexTest(schema, modules)
  for (const identity of [OWNER, OTHER]) {
    const actor = t.withIdentity(identity)
    await actor.mutation(api.users.upsertUser, {})
    await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: identity.tokenIdentifier, enabled: true })
    await actor.mutation(internal.learnAdaptiveAccess.setCohortEntitlement, { enabled: true })
  }
  const owner = t.withIdentity(OWNER)
  const other = t.withIdentity(OTHER)
  const created = await owner.mutation(api.learnAdaptiveDrafts.createThreadDraft, {
    need: 'Explain the motion', outcome: 'Describe the orbital motion', intent,
    availableTime: '15', sourceScope: { kind: 'none' }, idempotencyKey: 'promotion-thread-0001',
  })
  if (created.kind !== 'created') throw new Error('Expected draft')
  const threadId = created.thread.id
  await owner.mutation(api.learnAdaptiveClarifications.prepareInitialDecision, {
    threadId, expectedRevision: 1, idempotencyKey: 'promotion-decision-0001',
  })
  const continued = await owner.mutation(api.learnAdaptiveRecovery.continueDraft, {
    threadId, expectedRevision: 2, idempotencyKey: 'promotion-continue-0001',
  })
  if (continued.kind !== 'ok') throw new Error('Expected activity')
  const activity = await t.run(async ctx => {
    const thread = await ctx.db.get(threadId)
    return thread?.currentActivityId ? await ctx.db.get(thread.currentActivityId) : null
  })
  if (!activity) throw new Error('Expected current activity')
  const artifactId = await t.run(ctx => ctx.db.insert('learningThreadArtifacts', {
    userId: OWNER.tokenIdentifier, threadId, activityId: activity._id, artifactKind: 'answer',
    revision: 1, title: 'My explanation', summary: 'A useful explanation of the motion.',
    status: 'saved', createdAt: 10, updatedAt: 10,
  }))
  return { t, owner, other, threadId, activity, artifactId }
}

test('a learner can pin a review proposal to a useful artifact without mastery side effects', async () => {
  const { t, owner, other, threadId, activity, artifactId } = await fixture()
  expect(await owner.query(api.learnAdaptive.listPromotionProposals, { threadId })).toEqual([])
  const input = { threadId, kind: 'review' as const, artifactId, expectedRevision: 3, idempotencyKey: 'promotion-review-0001' }
  await expect(other.mutation(api.learnAdaptive.requestPromotion, input)).rejects.toThrow(/not found/i)
  const result = await owner.mutation(api.learnAdaptive.requestPromotion, input)
  expect(result).toMatchObject({ kind: 'ok', revision: 4, value: { kind: 'review', basis: 'useful_artifact' } })
  expect(await owner.mutation(api.learnAdaptive.requestPromotion, input)).toEqual(result)
  expect(await owner.query(api.learnAdaptive.listPromotionProposals, { threadId })).toMatchObject([{
    kind: 'review', basis: 'useful_artifact', threadRevision: 3, activityId: activity._id,
    artifactId, artifactRevision: 1, proposalVersion: 'learn-adaptive.promotion-proposal.v1',
  }])
  expect(await owner.query(api.learnAdaptive.getMemory, { threadId })).toMatchObject({
    promotionCandidates: [{ basis: 'useful_artifact', sourceId: artifactId, allowedKinds: ['review', 'mastery'] }],
    promotionProposals: [{ kind: 'review', sourceLabel: 'My explanation' }],
  })
  expect(await other.query(api.learnAdaptive.listPromotionProposals, { threadId })).toEqual([])
  const attempts = await t.run(ctx => ctx.db.query('masteryAttempts').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).take(1))
  const records = await t.run(ctx => ctx.db.query('masteryRecords').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).take(1))
  const sessions = await t.run(ctx => ctx.db.query('studySessions').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).take(1))
  expect([attempts, records, sessions]).toEqual([[], [], []])
})

test('explicit mastery proposal is distinct from intent and remains only a proposal', async () => {
  const { t, owner, threadId, artifactId } = await fixture('understand')
  const input = { threadId, kind: 'mastery' as const, artifactId, expectedRevision: 3, idempotencyKey: 'promotion-mastery-0001' }
  const proposed = await owner.mutation(api.learnAdaptive.requestPromotion, input)
  expect(proposed).toMatchObject({ kind: 'ok', value: { kind: 'mastery', basis: 'useful_artifact' }, revision: 4 })
  expect(await owner.query(api.learnAdaptive.listPromotionProposals, { threadId })).toMatchObject([{ kind: 'mastery' }])
  expect((await owner.query(api.learnAdaptive.listPromotionProposals, { threadId }))[0]).not.toHaveProperty('attemptId')
  expect(await t.run(ctx => ctx.db.query('masteryAttempts').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).take(1))).toEqual([])
  expect(await t.run(ctx => ctx.db.query('studySessions').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).take(1))).toEqual([])
})

test('stale, duplicate-key, deleted artifact, and unsupported performance requests cannot create a proposal', async () => {
  const { t, owner, threadId, artifactId, activity } = await fixture()
  const input = { threadId, kind: 'review' as const, artifactId, expectedRevision: 3, idempotencyKey: 'promotion-guard-0001' }
  expect(await owner.mutation(api.learnAdaptive.requestPromotion, { ...input, artifactId: undefined, activityId: activity._id }))
    .toMatchObject({ kind: 'blocked', code: 'representative_unavailable' })
  expect(await owner.mutation(api.learnAdaptive.requestPromotion, { ...input, idempotencyKey: 'promotion-guard-0002', expectedRevision: 2 }))
    .toMatchObject({ kind: 'conflict', code: 'stale_revision' })
  await t.run(ctx => ctx.db.patch(artifactId, { status: 'deleted' }))
  expect(await owner.mutation(api.learnAdaptive.requestPromotion, { ...input, idempotencyKey: 'promotion-guard-0003' }))
    .toMatchObject({ kind: 'blocked', code: 'artifact_unavailable' })
  await t.run(ctx => ctx.db.patch(artifactId, { status: 'saved' }))
  const saved = await owner.mutation(api.learnAdaptive.requestPromotion, { ...input, idempotencyKey: 'promotion-guard-0004' })
  expect(saved.kind).toBe('ok')
  expect(await owner.mutation(api.learnAdaptive.requestPromotion, { ...input, kind: 'mastery' }))
    .toMatchObject({ kind: 'conflict', code: 'duplicate_key' })
  expect(await owner.mutation(api.learnAdaptive.requestPromotion, { ...input, idempotencyKey: 'promotion-guard-0005' }))
    .toMatchObject({ kind: 'conflict', code: 'stale_revision' })
  expect((await owner.query(api.learnAdaptive.listPromotionProposals, { threadId })).length).toBe(1)
})

test('invalidated factual evidence blocks a saved artifact even while thread evidence says ready', async () => {
  const { t, owner, threadId, artifactId, activity } = await fixture()
  await t.run(async ctx => {
    const folderId = await ctx.db.insert('folders', { userId: OWNER.tokenIdentifier, name: 'Sources', documentCount: 0 })
    const learningVoidId = await ctx.db.insert('learningVoids', {
      userId: OWNER.tokenIdentifier, folderId, title: 'Source context', status: 'active', revision: 1, createdAt: 1, updatedAt: 1,
    })
    const sourceIdentityId = await ctx.db.insert('learnSourceIdentities', {
      userId: OWNER.tokenIdentifier, learningVoidId, origin: 'user_url', externalKey: 'source-1',
    })
    const sourceSnapshotId = await ctx.db.insert('learnSourceSnapshots', {
      userId: OWNER.tokenIdentifier, sourceIdentityId, learningVoidId, revision: 1,
      status: 'user_accepted', effectiveStatus: 'user_accepted', createdAt: 1,
    })
    await ctx.db.patch(threadId, { evidenceState: 'ready' })
    await ctx.db.patch(activity._id, { activityClass: 'factual' })
    await ctx.db.insert('learnActivityEvidenceLinks', {
      userId: OWNER.tokenIdentifier, threadId, activityId: activity._id, sourceSnapshotId,
      boundaryOrdinal: activity.boundaryOrdinal, invalidatedAt: Date.now(), createdAt: 1,
    })
  })
  expect(await owner.mutation(api.learnAdaptive.requestPromotion, {
    threadId, kind: 'review', artifactId, expectedRevision: 3, idempotencyKey: 'promotion-invalidated-0001',
  })).toMatchObject({ kind: 'blocked', code: 'evidence_unavailable' })
  expect(await owner.query(api.learnAdaptive.listPromotionProposals, { threadId })).toEqual([])
  expect((await owner.query(api.learnAdaptive.getMemory, { threadId }))?.promotionCandidates).toEqual([])
})

test('promotion proposal export is owner scoped and thread deletion drains it', async () => {
  const { t, owner, other, threadId, artifactId } = await fixture()
  await owner.mutation(api.learnAdaptive.requestPromotion, {
    threadId, kind: 'review', artifactId, expectedRevision: 3, idempotencyKey: 'promotion-export-0001',
  })
  const page = await owner.query(api.dataExport.getUserDataPage, {
    collection: 'learningThreadPromotionProposals', paginationOpts: { cursor: null, numItems: 8 },
  })
  expect(page.page).toMatchObject([{ threadId, kind: 'review', artifactId }])
  expect((await other.query(api.dataExport.getUserDataPage, {
    collection: 'learningThreadPromotionProposals', paginationOpts: { cursor: null, numItems: 8 },
  })).page).toEqual([])
  await owner.mutation(api.learnAdaptive.requestThreadDeletion, { threadId })
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  expect(await owner.query(api.learnAdaptive.listPromotionProposals, { threadId })).toEqual([])
  expect((await owner.query(api.dataExport.getUserDataPage, {
    collection: 'learningThreadPromotionProposals', paginationOpts: { cursor: null, numItems: 8 },
  })).page).toEqual([])
})
