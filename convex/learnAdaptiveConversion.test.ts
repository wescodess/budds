/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const ownerId = 'https://auth.example.com|conversion-owner'
const otherId = 'https://auth.example.com|conversion-other'
const previousFlag = process.env.LEARN_V2_ENABLED
beforeAll(() => { process.env.LEARN_V2_ENABLED = 'true' })
afterAll(() => { if (previousFlag === undefined) delete process.env.LEARN_V2_ENABLED; else process.env.LEARN_V2_ENABLED = previousFlag })

async function fixture() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async ctx => {
    for (const tokenIdentifier of [ownerId, otherId]) await ctx.db.insert('users', {
      tokenIdentifier, name: tokenIdentifier,
      learnV2Entitlement: { enabled: true, updatedAt: 1 },
      learnAdaptiveExperienceEntitlement: { enabled: true, updatedAt: 1 },
    })
    const folderId = await ctx.db.insert('folders', { userId: ownerId, name: 'Notes', documentCount: 0 })
    const conversationId = await ctx.db.insert('conversations', { userId: ownerId, folderId, title: 'Notes' })
    const messageId = await ctx.db.insert('messages', { userId: ownerId, conversationId, role: 'user', content: 'Private source text' })
    const threadId = await ctx.db.insert('learningThreads', {
      userId: ownerId, originalNeed: 'Explore a topic', intent: 'explore', availableTime: '15',
      authorityKind: 'standalone', sourceScope: { kind: 'none' }, evidenceState: 'none',
      lifecycle: 'active', revision: 1, createdAt: 1, updatedAt: 1,
    })
    return { messageId, threadId }
  })
  const owner = t.withIdentity({ tokenIdentifier: ownerId })
  const other = t.withIdentity({ tokenIdentifier: otherId })
  const inspected = await owner.query(api.learnAdaptive.inspectContributionSource, { source: { feature: 'chat', id: ids.messageId } })
  if (!inspected.revision) throw new Error('Source unavailable')
  const recorded = await owner.mutation(api.learnAdaptive.recordContribution, {
    threadId: ids.threadId, source: { feature: 'chat', id: ids.messageId, revision: inspected.revision },
    contributionKind: 'context', classification: 'non_factual', metadata: {},
    expectedRevision: 1, idempotencyKey: 'conversion-contribution-001',
  })
  if (recorded.kind !== 'recorded') throw new Error('Contribution unavailable')
  return { t, owner, other, ...ids, contributionId: recorded.contributionId }
}

test('owner converts a contribution into an attributed, replayable, non-scoring next activity', async () => {
  const { t, owner, threadId, contributionId } = await fixture()
  const args = { threadId, contributionId, expectedRevision: 1, idempotencyKey: 'conversion-activity-001' }
  const created = await owner.mutation(api.learnAdaptive.convertContributionToActivity, args)
  expect(created).toMatchObject({ kind: 'ok', value: { activityClass: 'non_factual', boundaryOrdinal: 1 } })
  expect(await owner.mutation(api.learnAdaptive.convertContributionToActivity, args)).toEqual(created)
  const projected = await owner.query(api.learnAdaptive.getThread, { threadId })
  expect(projected?.currentActivity).toMatchObject({
    id: created.kind === 'ok' ? created.value.activityId : '',
    attribution: { contributionId, sourceFeature: 'chat', classification: 'non_factual' },
  })
  expect(JSON.stringify(projected)).not.toContain('Private source text')
  if (created.kind !== 'ok') throw new Error('Expected conversion')
  expect(await owner.query(internal.learnAdaptiveActivities.replayActivityPlan, { activityId: created.value.activityId }))
    .toMatchObject({ ok: true, value: { attribution: { contributionId }, evidenceReferences: [] } })
  expect(await owner.query(api.learnAdaptive.getArtifactCanvas, { threadId }))
    .toMatchObject({ status: 'eligible', activity: { id: created.value.activityId, primitive: { type: 'artifact_workspace',
      props: { prompt: expect.stringContaining('contents are not shown') } } } })
  expect(await owner.mutation(api.learnAdaptive.saveArtifact, {
    threadId, activityId: created.value.activityId, artifactKind: 'plan', title: 'My next step',
    summary: 'Review and practice the concept.', status: 'saved', expectedRevision: created.revision,
    idempotencyKey: 'conversion-save-artifact-001',
  })).toMatchObject({ kind: 'ok', value: { status: 'saved' } })
  const counts = await t.run(async ctx => ({
    attempts: (await ctx.db.query('masteryAttempts').withIndex('by_userId', q => q.eq('userId', ownerId)).take(1)).length,
    activities: (await ctx.db.query('learningThreadActivities').withIndex('by_userId', q => q.eq('userId', ownerId)).take(5)).length,
  }))
  expect(counts).toEqual({ attempts: 0, activities: 1 })
})

test('a second conversion request for one contribution cannot create another authority boundary', async () => {
  const { owner, threadId, contributionId } = await fixture()
  const first = await owner.mutation(api.learnAdaptive.convertContributionToActivity, {
    threadId, contributionId, expectedRevision: 1, idempotencyKey: 'conversion-one-origin-first-001',
  })
  if (first.kind !== 'ok') throw new Error('Expected the first conversion')
  expect(await owner.mutation(api.learnAdaptive.convertContributionToActivity, {
    threadId, contributionId, expectedRevision: first.revision, idempotencyKey: 'conversion-one-origin-second-001',
  })).toMatchObject({ kind: 'blocked', code: 'contribution_already_converted' })
  const projected = await owner.query(api.learnAdaptive.getThread, { threadId })
  expect(projected?.currentActivity).toMatchObject({ id: first.value.activityId, boundaryOrdinal: 1,
    attribution: { contributionId } })
  expect(projected?.history).toEqual([])
  expect(projected?.thread.revision).toBe(first.revision)
})

test('foreign and changed sources cannot create an activity', async () => {
  const { t, owner, other, messageId, threadId, contributionId } = await fixture()
  const args = { threadId, contributionId, expectedRevision: 1, idempotencyKey: 'conversion-activity-002' }
  await expect(other.mutation(api.learnAdaptive.convertContributionToActivity, args)).rejects.toThrow()
  await t.run(ctx => ctx.db.patch(messageId, { content: 'Changed text' }))
  expect(await owner.mutation(api.learnAdaptive.convertContributionToActivity, args)).toMatchObject({ kind: 'blocked', code: 'source_revision_changed' })
  expect((await owner.query(api.learnAdaptive.getThread, { threadId }))?.currentActivity).toBeNull()
  const events = await t.run(ctx => ctx.db.query('learnActivityEvents')
    .withIndex('by_userId_and_eventType_and_occurredAt', q => q.eq('userId', ownerId).eq('eventType', 'cross_feature_activity_blocked')).take(5))
  expect(events).toMatchObject([{ reasonCode: 'source_revision_changed', outcomeCode: 'blocked' }])
  expect(await t.run(ctx => ctx.db.query('learnActivityEvents')
    .withIndex('by_userId_and_eventType_and_occurredAt', q => q.eq('userId', ownerId).eq('eventType', 'cross_feature_activity_invalidated')).take(5)))
    .toMatchObject([{ reasonCode: 'source_revision_changed', outcomeCode: 'invalidated' }])
})

test('a changed source remains visible as changed on an existing attributed activity', async () => {
  const { t, owner, threadId, messageId, contributionId } = await fixture()
  const created = await owner.mutation(api.learnAdaptive.convertContributionToActivity, {
    threadId, contributionId, expectedRevision: 1, idempotencyKey: 'conversion-before-source-change-001',
  })
  expect(created.kind).toBe('ok')
  await t.run(ctx => ctx.db.patch(messageId, { content: 'Revised source material' }))
  expect((await owner.query(api.learnAdaptive.getThread, { threadId }))?.currentActivity?.attribution)
    .toMatchObject({ contributionId, sourceStatus: 'source_revision_changed' })
})

test('an accepted classification without a linked snapshot cannot create a factual activity', async () => {
  const { t, owner, threadId, contributionId } = await fixture()
  await t.run(ctx => ctx.db.patch(contributionId, { classification: 'accepted_evidence' }))
  expect(await owner.mutation(api.learnAdaptive.convertContributionToActivity, {
    threadId, contributionId, expectedRevision: 1, idempotencyKey: 'conversion-factual-001',
  })).toMatchObject({ kind: 'blocked', code: 'evidence_unavailable' })
  expect((await owner.query(api.learnAdaptive.getThread, { threadId }))?.currentActivity).toBeNull()
})

test.each([
  { name: 'conflicting', patch: { conflictStatus: 'unresolved' as const }, integrity: 'conflict' },
  { name: 'stale', patch: { effectiveStatus: 'unavailable' as const }, integrity: 'unavailable' },
  { name: 'rights-revoked', patch: { rightsStatus: 'prohibited' as const }, integrity: 'unavailable' },
])('a $name linked snapshot blocks conversion and remains visible in the thread contribution projection', async ({ patch, integrity }) => {
  const { t, owner, threadId, messageId } = await fixture()
  const documentId = await t.run(async ctx => {
    const message = await ctx.db.get(messageId)
    const conversation = await ctx.db.get(message!.conversationId)
    return await ctx.db.insert('documents', { userId: ownerId, folderId: conversation!.folderId,
      filename: 'evidence.pdf', status: 'success', fileSize: 100, sourceRevision: 'document-v1', contentHash: 'hash-v1' })
  })
  const source = await owner.query(api.learnAdaptive.inspectContributionSource, { source: { feature: 'documents', id: documentId } })
  const snapshotId = await t.run(async ctx => {
    const document = await ctx.db.get(documentId)
    const learningVoidId = await ctx.db.insert('learningVoids', {
      userId: ownerId, folderId: document!.folderId, title: 'Evidence', status: 'draft', revision: 1, createdAt: 1, updatedAt: 1,
    })
    const sourceIdentityId = await ctx.db.insert('learnSourceIdentities', {
      userId: ownerId, learningVoidId, origin: 'folder_document', externalKey: `document:${documentId}`, folderDocumentId: documentId,
    })
    const id = await ctx.db.insert('learnSourceSnapshots', {
      userId: ownerId, learningVoidId, sourceIdentityId, revision: 1, status: 'user_accepted',
      effectiveStatus: 'user_accepted', rightsStatus: 'permitted', conflictStatus: 'clear',
      sourceRevision: 'document-v1', contentHash: 'hash-v1', createdAt: 1,
    })
    await ctx.db.insert('learnSourceExcerpts', {
      userId: ownerId, sourceSnapshotId: id, locator: 'section-1', excerpt: 'Accepted material', rightsStatus: 'permitted',
    })
    return id
  })
  const recorded = await owner.mutation(api.learnAdaptive.recordContribution, {
    threadId, source: { feature: 'documents', id: documentId, revision: source.revision! },
    contributionKind: 'context', classification: 'accepted_evidence', evidenceSnapshotId: snapshotId,
    metadata: {}, expectedRevision: 1, idempotencyKey: `conversion-${integrity}-${documentId}`,
  })
  if (recorded.kind !== 'recorded') throw new Error('Expected accepted evidence contribution')
  expect((await owner.query(api.learnAdaptive.listThreadContributions, {
    threadId, paginationOpts: { numItems: 10, cursor: null },
  })).page).toContainEqual(expect.objectContaining({ _id: recorded.contributionId, evidenceIntegrity: 'accepted' }))
  expect(await owner.mutation(api.learnAdaptive.convertContributionToActivity, {
    threadId, contributionId: recorded.contributionId, expectedRevision: 1,
    idempotencyKey: `conversion-valid-evidence-${documentId}`,
  })).toMatchObject({ kind: 'blocked', code: 'factual_authority_unavailable' })
  await t.run(ctx => ctx.db.patch(snapshotId, patch))
  expect(await owner.mutation(api.learnAdaptive.convertContributionToActivity, {
    threadId, contributionId: recorded.contributionId, expectedRevision: 1,
    idempotencyKey: `conversion-${integrity}-activity-${documentId}`,
  })).toMatchObject({ kind: 'blocked', code: integrity === 'conflict' ? 'evidence_conflict' : 'evidence_unavailable' })
  expect((await owner.query(api.learnAdaptive.getThread, { threadId }))?.currentActivity).toBeNull()
  const listed = await owner.query(api.learnAdaptive.listThreadContributions, {
    threadId, paginationOpts: { numItems: 10, cursor: null },
  })
  expect(listed.page).toContainEqual(expect.objectContaining({ _id: recorded.contributionId,
    classification: 'accepted_evidence', evidenceIntegrity: integrity }))
  expect(JSON.stringify(listed)).not.toContain('Accepted material')
  const events = await t.run(ctx => ctx.db.query('learnActivityEvents')
    .withIndex('by_userId_and_eventType_and_occurredAt', q => q.eq('userId', ownerId).eq('eventType', 'cross_feature_activity_invalidated')).take(10))
  expect(events).toContainEqual(expect.objectContaining({ reasonCode: integrity === 'conflict' ? 'evidence_conflict' : 'evidence_unavailable' }))
})

test('a second contribution makes a new boundary and retains the prior attribution', async () => {
  const { t, owner, threadId, messageId, contributionId } = await fixture()
  const first = await owner.mutation(api.learnAdaptive.convertContributionToActivity, {
    threadId, contributionId, expectedRevision: 1, idempotencyKey: 'conversion-first-001',
  })
  if (first.kind !== 'ok') throw new Error('Expected first conversion')
  const secondMessageId = await t.run(async ctx => {
    const firstMessage = await ctx.db.get(messageId)
    return await ctx.db.insert('messages', { userId: ownerId, conversationId: firstMessage!.conversationId,
      role: 'user', content: 'A second private note' })
  })
  const inspected = await owner.query(api.learnAdaptive.inspectContributionSource, { source: { feature: 'chat', id: secondMessageId } })
  const recorded = await owner.mutation(api.learnAdaptive.recordContribution, {
    threadId, source: { feature: 'chat', id: secondMessageId, revision: inspected.revision! },
    contributionKind: 'context', classification: 'inference', metadata: {}, expectedRevision: first.revision,
    idempotencyKey: 'conversion-second-contribution-001',
  })
  if (recorded.kind !== 'recorded') throw new Error('Expected second contribution')
  const second = await owner.mutation(api.learnAdaptive.convertContributionToActivity, {
    threadId, contributionId: recorded.contributionId, expectedRevision: first.revision,
    idempotencyKey: 'conversion-second-activity-001',
  })
  expect(second).toMatchObject({ kind: 'ok', value: { boundaryOrdinal: 2, planRevision: 2,
    replacesActivityId: first.value.activityId } })
  const projected = await owner.query(api.learnAdaptive.getThread, { threadId })
  expect(projected?.history).toMatchObject([{ id: first.value.activityId, status: 'eligible',
    attribution: { contributionId, classification: 'non_factual' } }])
  expect(projected?.currentActivity).toMatchObject({ attribution: { contributionId: recorded.contributionId,
    classification: 'inference' } })
  await t.run(ctx => ctx.db.patch(messageId, { content: 'The original source changed' }))
  expect((await owner.query(api.learnAdaptive.getThread, { threadId }))?.history)
    .toMatchObject([{ attribution: { contributionId, sourceStatus: 'source_revision_changed' } }])
})

test.each(['paused', 'ended'] as const)('%s threads cannot be reactivated by conversion', async lifecycle => {
  const { t, owner, threadId, contributionId } = await fixture()
  await t.run(ctx => ctx.db.patch(threadId, { lifecycle }))
  expect(await owner.mutation(api.learnAdaptive.convertContributionToActivity, {
    threadId, contributionId, expectedRevision: 1, idempotencyKey: `conversion-${lifecycle}-001`,
  })).toMatchObject({ kind: 'blocked', code: 'thread_not_active' })
  expect((await owner.query(api.learnAdaptive.getThread, { threadId }))?.thread.lifecycle).toBe(lifecycle)
})

test.each(['draft', 'rollback'] as const)('%s threads cannot start conversion at an ineligible boundary', async lifecycle => {
  const { t, owner, threadId, contributionId } = await fixture()
  await t.run(ctx => ctx.db.patch(threadId, { lifecycle }))
  expect(await owner.mutation(api.learnAdaptive.convertContributionToActivity, {
    threadId, contributionId, expectedRevision: 1, idempotencyKey: `conversion-${lifecycle}-001`,
  })).toMatchObject({ kind: 'blocked', code: 'thread_not_ready' })
  expect((await owner.query(api.learnAdaptive.getThread, { threadId }))?.currentActivity).toBeNull()
})

test.each(['started', 'submitted', 'scoring', 'feedback', 'reconciling'] as const)('%s activity cannot be replaced before its outcome is settled', async status => {
  const { t, owner, threadId, contributionId } = await fixture()
  const first = await owner.mutation(api.learnAdaptive.convertContributionToActivity, {
    threadId, contributionId, expectedRevision: 1, idempotencyKey: `conversion-active-${status}-001`,
  })
  if (first.kind !== 'ok') throw new Error('Expected first conversion')
  await t.run(ctx => ctx.db.patch(first.value.activityDocumentId, { status }))
  expect(await owner.mutation(api.learnAdaptive.convertContributionToActivity, {
    threadId, contributionId, expectedRevision: first.revision, idempotencyKey: `conversion-replace-${status}-001`,
  })).toMatchObject({ kind: 'blocked', code: 'activity_boundary_unavailable' })
  expect((await owner.query(api.learnAdaptive.getThread, { threadId }))?.currentActivity?.id).toBe(first.value.activityId)
})

test('deleting threads cannot receive a converted activity', async () => {
  const { t, owner, threadId, contributionId } = await fixture()
  await t.run(ctx => ctx.db.patch(threadId, { deletionStartedAt: 2 }))
  expect(await owner.mutation(api.learnAdaptive.convertContributionToActivity, {
    threadId, contributionId, expectedRevision: 1, idempotencyKey: 'conversion-deleting-001',
  })).toMatchObject({ kind: 'blocked', code: 'thread_deleting' })
})

test('source purge keeps safe origin while removing the protected document pointer from activity and export', async () => {
  const { t, owner, threadId, messageId } = await fixture()
  const documentId = await t.run(async ctx => {
    const message = await ctx.db.get(messageId)
    const conversation = await ctx.db.get(message!.conversationId)
    return await ctx.db.insert('documents', { userId: ownerId, folderId: conversation!.folderId,
      filename: 'private-notes.pdf', status: 'success', fileSize: 100,
      sourceRevision: 'private-document-revision', contentHash: 'private-content-hash' })
  })
  const inspected = await owner.query(api.learnAdaptive.inspectContributionSource, { source: { feature: 'documents', id: documentId } })
  const recorded = await owner.mutation(api.learnAdaptive.recordContribution, {
    threadId, source: { feature: 'documents', id: documentId, revision: inspected.revision! },
    contributionKind: 'source', classification: 'non_factual', metadata: {}, expectedRevision: 1,
    idempotencyKey: 'conversion-document-contribution-001',
  })
  if (recorded.kind !== 'recorded') throw new Error('Expected document contribution')
  const created = await owner.mutation(api.learnAdaptive.convertContributionToActivity, {
    threadId, contributionId: recorded.contributionId, expectedRevision: 1,
    idempotencyKey: 'conversion-document-activity-001',
  })
  if (created.kind !== 'ok') throw new Error('Expected activity')
  await t.mutation(internal.learnV2Retention.purgeFolderDocumentSources, { userId: ownerId, documentId })
  const activity = await t.run(ctx => ctx.db.get(created.value.activityDocumentId))
  const exportPage = await owner.query(api.dataExport.getUserDataPage, {
    collection: 'learningThreadActivities', paginationOpts: { numItems: 20, cursor: null },
  })
  const protectedText = JSON.stringify([activity, exportPage])
  expect(protectedText).not.toContain(String(documentId))
  expect(protectedText).not.toContain(inspected.revision!)
  expect((await owner.query(api.learnAdaptive.getThread, { threadId }))?.currentActivity?.attribution)
    .toMatchObject({ sourceFeature: 'documents', sourceStatus: 'source_unavailable' })
})
