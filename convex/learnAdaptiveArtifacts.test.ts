/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'
import { privateAdaptiveArtifactR2Key } from './lib/learnAdaptiveArtifacts'
import { composeAdaptiveActivityPlan } from '../shared/learn-adaptive-activity-plan'
import { storedPlan } from './learnAdaptiveRecovery'

const modules = import.meta.glob('./**/*.ts')
const OWNER = { tokenIdentifier: 'https://auth.example.com|artifact-owner' }
const OTHER = { tokenIdentifier: 'https://auth.example.com|artifact-other' }
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
  const other = t.withIdentity(OTHER)
  const created = await owner.mutation(api.learnAdaptiveDrafts.createThreadDraft, {
    need: 'Build a concise study plan.', outcome: 'Write a plan I can use tomorrow.', intent: 'build', availableTime: '25', sourceScope: { kind: 'none' }, idempotencyKey: 'artifact-draft-0001',
  })
  if (created.kind !== 'created') throw new Error('Expected draft')
  const threadId = created.thread.id
  await owner.mutation(api.learnAdaptiveClarifications.prepareInitialDecision, { threadId, expectedRevision: 1, idempotencyKey: 'artifact-decision-0001' })
  const continued = await owner.mutation(api.learnAdaptiveRecovery.continueDraft, { threadId, expectedRevision: 2, idempotencyKey: 'artifact-activity-0001' })
  if (continued.kind !== 'ok') throw new Error('Expected activity')
  return { t, owner, other, threadId, activityId: continued.value.activityId }
}

describe('adaptive thread artifacts', () => {
  test('projects only the current owner artifact plan after replay validation', async () => {
    const { t, owner, other, threadId } = await fixture()
    expect(await owner.query(api.learnAdaptive.getArtifactCanvas, { threadId })).toBeNull()
    const activity = await t.run(async ctx => {
      const thread = await ctx.db.get(threadId)
      return thread?.currentActivityId ? ctx.db.get(thread.currentActivityId) : null
    })
    if (!activity) throw new Error('Expected current activity')
    const composed = await composeAdaptiveActivityPlan({ ...storedPlan(activity), replacesActivityId: activity.replacesActivityId ?? undefined,
      primitiveSequence: [{ type: 'artifact_workspace', action: 'save_artifact', props: { prompt: 'Build a usable study plan.', artifactKind: 'plan', starterText: 'Goal:' } }],
      requiredAction: { kind: 'save_artifact', label: 'Save artifact' },
      evaluationContract: { version: 'learn-adaptive.evaluation.v1', kind: 'learner_response', responseFormat: 'long_text', passingScorePercent: null },
      accessibilityMetadata: { heading: 'Study plan', instructions: 'Write a plan and save it.', focusTargetTestId: 'learn-primitive-artifact-workspace', liveRegionMode: 'polite' },
    })
    await t.run(ctx => ctx.db.patch(activity._id, { primitivePlan: composed.primitivePlan, requiredAction: composed.requiredAction,
      evaluationContract: composed.evaluationContract, accessibilityMetadata: composed.accessibilityMetadata,
      canonicalInputSnapshot: composed.canonicalInputSnapshot, inputDigest: composed.inputDigest }))
    const projected = await owner.query(api.learnAdaptive.getArtifactCanvas, { threadId })
    expect(projected).toMatchObject({ status: 'eligible', activity: { primitive: { type: 'artifact_workspace', action: 'save_artifact' } } })
    expect(await other.query(api.learnAdaptive.getArtifactCanvas, { threadId })).toBeNull()
    await t.run(ctx => ctx.db.patch(activity._id, { inputDigest: 'tampered' }))
    expect(await owner.query(api.learnAdaptive.getArtifactCanvas, { threadId })).toMatchObject({ status: 'blocked', activity: { primitive: null } })
  })

  test('saves one bounded owner-scoped artifact with a receipt and no attempt authority', async () => {
    const { t, owner, other, threadId, activityId } = await fixture()
    const input = { threadId, activityId, artifactKind: 'plan' as const, title: 'My study plan', summary: 'Practice the core idea and explain it back.', status: 'saved' as const, expectedRevision: 3, idempotencyKey: 'artifact-save-0001' }
    const saved = await owner.mutation(api.learnAdaptive.saveArtifact, input)
    expect(saved).toMatchObject({ kind: 'ok', value: { status: 'saved', revision: 1 }, revision: 4, receiptId: expect.any(String) })
    expect(await owner.mutation(api.learnAdaptive.saveArtifact, input)).toEqual(saved)
    expect(await owner.query(api.learnAdaptive.listThreadArtifacts, { threadId })).toMatchObject([{ title: 'My study plan', summary: 'Practice the core idea and explain it back.', status: 'saved' }])
    expect(await owner.query(api.learnAdaptive.getThread, { threadId })).toMatchObject({
      unresolvedPoint: 'Build a concise study plan.',
      nextAction: { kind: 'review_artifact', reasonCode: 'artifact_saved', activityId },
    })
    await t.run(ctx => ctx.db.patch(threadId, { nextAction: { kind: 'review_artifact', label: 'Open another resource', reasonCode: 'artifact_saved', activityId } }))
    expect(await owner.query(api.learnAdaptive.getThread, { threadId })).toMatchObject({ nextAction: { kind: 'submit_response' } })
    await expect(other.query(api.learnAdaptive.listThreadArtifacts, { threadId })).rejects.toThrow(/not found/i)
    expect(await t.run(ctx => ctx.db.query('masteryAttempts').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).take(1))).toEqual([])
  })

  test('edits and deletes through thread revisions without reviving or leaking the artifact', async () => {
    const { t, owner, other, threadId, activityId } = await fixture()
    const saved = await owner.mutation(api.learnAdaptive.saveArtifact, { threadId, activityId, artifactKind: 'plan', title: 'Plan', summary: 'First draft.', status: 'draft', expectedRevision: 3, idempotencyKey: 'artifact-edit-save-0001' })
    if (saved.kind !== 'ok') throw new Error('Expected save')
    const artifactId = saved.value.artifactId
    const update = { threadId, activityId, artifactId, artifactKind: 'plan' as const, title: 'Revised plan', summary: 'Practice tomorrow.', status: 'saved' as const, expectedRevision: 4, idempotencyKey: 'artifact-edit-save-0002' }
    expect(await owner.mutation(api.learnAdaptive.saveArtifact, update)).toMatchObject({ kind: 'ok', value: { artifactId, revision: 2 }, revision: 5 })
    expect(await owner.mutation(api.learnAdaptive.saveArtifact, { ...update, idempotencyKey: 'artifact-edit-stale-0001' })).toMatchObject({ kind: 'conflict', code: 'stale_revision' })
    expect(await owner.mutation(api.learnAdaptive.saveArtifact, { ...update, summary: 'Different', idempotencyKey: update.idempotencyKey })).toMatchObject({ kind: 'conflict', code: 'duplicate_key' })
    await expect(other.mutation(api.learnAdaptive.deleteArtifact, { threadId, artifactId, expectedRevision: 5, idempotencyKey: 'artifact-foreign-delete-0001' })).rejects.toThrow(/not found/i)
    const removed = await owner.mutation(api.learnAdaptive.deleteArtifact, { threadId, artifactId, expectedRevision: 5, idempotencyKey: 'artifact-delete-0001' })
    expect(removed).toMatchObject({ kind: 'ok', value: { artifactId, status: 'deleted' }, revision: 6 })
    expect(await owner.mutation(api.learnAdaptive.deleteArtifact, { threadId, artifactId, expectedRevision: 5, idempotencyKey: 'artifact-delete-0001' })).toEqual(removed)
    expect(await owner.query(api.learnAdaptive.listThreadArtifacts, { threadId })).toEqual([])
    expect(await owner.query(api.learnAdaptive.getThread, { threadId })).toMatchObject({
      unresolvedPoint: 'Build a concise study plan.',
      nextAction: { kind: 'submit_response', activityId },
    })
    expect(await t.run(ctx => ctx.db.get(artifactId))).toBeNull()
    expect(await t.run(ctx => ctx.db.query('masteryAttempts').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).take(1))).toEqual([])
  })

  test('retains an R2-backed row through transient cleanup failure and removes it only after confirmation', async () => {
    const { t, owner, threadId, activityId } = await fixture()
    const saved = await owner.mutation(api.learnAdaptive.saveArtifact, { threadId, activityId, artifactKind: 'answer', title: 'Answer', summary: 'My explanation.', status: 'saved', expectedRevision: 3, idempotencyKey: 'artifact-r2-save-0001' })
    if (saved.kind !== 'ok') throw new Error('Expected save')
    const artifactId = saved.value.artifactId
    const privateKey = await privateAdaptiveArtifactR2Key(OWNER.tokenIdentifier, artifactId)
    await t.run(ctx => ctx.db.patch(artifactId, { r2ObjectKey: privateKey }))
    expect(await owner.mutation(api.learnAdaptive.deleteArtifact, { threadId, artifactId, expectedRevision: 4, idempotencyKey: 'artifact-r2-delete-0001' }))
      .toMatchObject({ kind: 'ok', value: { cleanupPending: true } })
    const cleanup = await t.run(ctx => ctx.db.query('pendingCleanup').withIndex('by_learningThreadArtifactId', q => q.eq('learningThreadArtifactId', artifactId)).unique())
    expect(cleanup).toMatchObject({ userId: OWNER.tokenIdentifier, r2Key: privateKey, kind: 'r2', attempts: 0 })
    expect(await owner.query(api.learnAdaptive.listThreadArtifacts, { threadId })).toEqual([])
    expect(await t.run(ctx => ctx.db.get(artifactId))).toMatchObject({ status: 'deleted', r2ObjectKey: privateKey })
    const priorBucket = process.env.R2_BUCKET_NAME
    delete process.env.R2_BUCKET_NAME
    try { expect(await t.action(internal.accountDeletion.retryPendingCleanupRow, { id: cleanup!._id })).toMatchObject({ ok: false }) }
    finally { if (priorBucket === undefined) delete process.env.R2_BUCKET_NAME; else process.env.R2_BUCKET_NAME = priorBucket }
    expect(await t.run(ctx => ctx.db.get(artifactId))).toMatchObject({ status: 'deleted' })
    expect((await t.run(ctx => ctx.db.get(cleanup!._id)))!.attempts).toBeGreaterThan(0)
    await t.mutation(internal.accountDeletion.removePendingCleanup, { id: cleanup!._id })
    expect(await t.run(ctx => ctx.db.get(artifactId))).toBeNull()
    expect(await t.run(ctx => ctx.db.get(cleanup!._id))).toBeNull()
  })

  test('does not delete an artifact from a rolled-back read-only thread', async () => {
    const { t, owner, threadId, activityId } = await fixture()
    const saved = await owner.mutation(api.learnAdaptive.saveArtifact, { threadId, activityId, artifactKind: 'plan',
      title: 'Past plan', summary: 'Keep this history.', status: 'saved', expectedRevision: 3, idempotencyKey: 'artifact-rollback-save-0001' })
    if (saved.kind !== 'ok') throw new Error('Expected saved artifact')
    await t.run(ctx => ctx.db.patch(threadId, { lifecycle: 'rollback' }))
    expect(await owner.mutation(api.learnAdaptive.deleteArtifact, { threadId, artifactId: saved.value.artifactId,
      expectedRevision: 4, idempotencyKey: 'artifact-rollback-delete-0001' }))
      .toMatchObject({ kind: 'blocked', code: 'thread_not_editable' })
    expect(await t.run(ctx => ctx.db.get(saved.value.artifactId))).toMatchObject({ status: 'saved', summary: 'Keep this history.' })
  })

  test('thread deletion waits for artifact R2 confirmation before deleting activity and parent', async () => {
    const { t, owner, threadId, activityId } = await fixture()
    const saved = await owner.mutation(api.learnAdaptive.saveArtifact, { threadId, activityId, artifactKind: 'note', title: 'Keep', summary: 'Private note.', status: 'saved', expectedRevision: 3, idempotencyKey: 'artifact-thread-save-0001' })
    if (saved.kind !== 'ok') throw new Error('Expected save')
    const artifactId = saved.value.artifactId
    const privateKey = await privateAdaptiveArtifactR2Key(OWNER.tokenIdentifier, artifactId)
    await t.run(ctx => ctx.db.patch(artifactId, { r2ObjectKey: privateKey }))
    const requested = await owner.mutation(api.learnAdaptive.requestThreadDeletion, { threadId })
    const batch = await t.mutation(internal.learnAdaptiveCommands.runThreadDeletionJob, { jobId: requested.jobId })
    expect(batch).toMatchObject({ state: 'queued', phase: 'artifacts' })
    expect(await t.run(ctx => ctx.db.get(threadId))).not.toBeNull()
    expect(await t.run(ctx => ctx.db.get(artifactId))).toMatchObject({ status: 'deleted' })
    const cleanup = await t.run(ctx => ctx.db.query('pendingCleanup').withIndex('by_learningThreadArtifactId', q => q.eq('learningThreadArtifactId', artifactId)).unique())
    expect(cleanup).not.toBeNull()
    const duringDeletion = { threadId, activityId, artifactKind: 'note' as const, title: 'New', summary: 'Blocked.', status: 'saved' as const, expectedRevision: 4, idempotencyKey: 'artifact-during-delete-0001' }
    const blocked = await owner.mutation(api.learnAdaptive.saveArtifact, duringDeletion)
    expect(blocked).toMatchObject({ kind: 'blocked', code: 'thread_deleting' })
    expect(await owner.mutation(api.learnAdaptive.saveArtifact, duringDeletion)).toEqual(blocked)
    expect(await owner.mutation(api.learnAdaptive.saveArtifact, { ...duringDeletion, title: 'Different' })).toMatchObject({ kind: 'conflict', code: 'duplicate_key' })
    expect(await t.run(ctx => ctx.db.query('learnActivityCommandReceipts').withIndex('by_userId_and_threadId', q => q.eq('userId', OWNER.tokenIdentifier).eq('threadId', threadId)).collect()))
      .toEqual(expect.arrayContaining([expect.objectContaining({ commandName: 'saveArtifact', resultKind: 'blocked' })]))
    await t.mutation(internal.accountDeletion.removePendingCleanup, { id: cleanup!._id })
    for (let index = 0; index < 12 && await t.run(ctx => ctx.db.get(requested.jobId)); index++) {
      await t.mutation(internal.learnAdaptiveCommands.runThreadDeletionJob, { jobId: requested.jobId })
    }
    expect(await t.run(ctx => ctx.db.get(artifactId))).toBeNull()
    expect(await t.run(ctx => ctx.db.get(threadId))).toBeNull()
  })

  test('account deletion pauses at artifact children until private R2 cleanup is confirmed', async () => {
    const { t, owner, threadId, activityId } = await fixture()
    const saved = await owner.mutation(api.learnAdaptive.saveArtifact, { threadId, activityId, artifactKind: 'plan', title: 'Plan', summary: 'My notes.', status: 'saved', expectedRevision: 3, idempotencyKey: 'artifact-account-save-0001' })
    if (saved.kind !== 'ok') throw new Error('Expected save')
    const artifactId = saved.value.artifactId
    await t.run(async ctx => {
      await ctx.db.patch(artifactId, { r2ObjectKey: await privateAdaptiveArtifactR2Key(OWNER.tokenIdentifier, artifactId) })
      await ctx.db.insert('accountDeletionJobs', { userId: OWNER.tokenIdentifier, status: 'active', phase: 'learnV2', startedAt: 1, updatedAt: 1 })
    })
    await t.mutation(internal.accountDeletion.runDeletionBatch, { userId: OWNER.tokenIdentifier })
    expect(await t.run(ctx => ctx.db.get(artifactId))).toMatchObject({ status: 'deleted' })
    expect(await t.run(ctx => ctx.db.get(threadId))).not.toBeNull()
    const cleanup = await t.run(ctx => ctx.db.query('pendingCleanup').withIndex('by_learningThreadArtifactId', q => q.eq('learningThreadArtifactId', artifactId)).unique())
    expect(cleanup).not.toBeNull()
    await t.mutation(internal.accountDeletion.removePendingCleanup, { id: cleanup!._id })
    expect(await t.run(ctx => ctx.db.get(artifactId))).toBeNull()
    for (let index = 0; index < 20 && await t.run(ctx => ctx.db.get(threadId)); index++) {
      await t.mutation(internal.accountDeletion.runDeletionBatch, { userId: OWNER.tokenIdentifier })
    }
    expect(await t.run(ctx => ctx.db.get(threadId))).toBeNull()
  })

  test('rejects oversized artifact text and client-supplied object authority before writes', async () => {
    const { t, owner, threadId, activityId } = await fixture()
    const input = { threadId, activityId, artifactKind: 'note' as const, title: 'Title', summary: 'Text', status: 'saved' as const, expectedRevision: 3, idempotencyKey: 'artifact-invalid-save-0001' }
    const invalidTitle = await owner.mutation(api.learnAdaptive.saveArtifact, { ...input, title: 'x'.repeat(161) })
    expect(invalidTitle).toMatchObject({ kind: 'invalid', code: 'artifact_text_invalid' })
    expect(await owner.mutation(api.learnAdaptive.saveArtifact, { ...input, title: 'x'.repeat(161) })).toEqual(invalidTitle)
    expect(await owner.mutation(api.learnAdaptive.saveArtifact, { ...input, idempotencyKey: 'artifact-invalid-summary-0001', summary: 'x'.repeat(4097) })).toMatchObject({ kind: 'invalid', code: 'artifact_text_invalid' })
    await expect(owner.mutation(api.learnAdaptive.saveArtifact, { ...input, r2ObjectKey: 'foreign/key' } as never)).rejects.toThrow()
    expect(await t.run(ctx => ctx.db.query('learningThreadArtifacts').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).take(1))).toEqual([])
    expect((await t.run(ctx => ctx.db.get(threadId)))!.revision).toBe(3)
  })

  test('refuses cleanup of a foreign object key without deleting the artifact or creating a receipt', async () => {
    const { t, owner, threadId, activityId } = await fixture()
    const saved = await owner.mutation(api.learnAdaptive.saveArtifact, { threadId, activityId, artifactKind: 'note', title: 'Protected', summary: 'Keep intact.', status: 'saved', expectedRevision: 3, idempotencyKey: 'artifact-bad-key-save-0001' })
    if (saved.kind !== 'ok') throw new Error('Expected save')
    await t.run(ctx => ctx.db.patch(saved.value.artifactId, { r2ObjectKey: 'another-owner/private-object' }))
    await expect(owner.mutation(api.learnAdaptive.deleteArtifact, { threadId, artifactId: saved.value.artifactId, expectedRevision: 4, idempotencyKey: 'artifact-bad-key-delete-0001' })).rejects.toThrow(/ownership mismatch/)
    expect(await t.run(ctx => ctx.db.get(saved.value.artifactId))).toMatchObject({ status: 'saved' })
    expect(await t.run(ctx => ctx.db.query('pendingCleanup').withIndex('by_learningThreadArtifactId', q => q.eq('learningThreadArtifactId', saved.value.artifactId)).unique())).toBeNull()
    expect((await t.run(ctx => ctx.db.get(threadId)))!.revision).toBe(4)
  })

  test('owner export includes bounded artifact metadata without private R2 keys or foreign rows', async () => {
    const { t, owner, other, threadId, activityId } = await fixture()
    const saved = await owner.mutation(api.learnAdaptive.saveArtifact, { threadId, activityId, artifactKind: 'note', title: 'Export note', summary: 'I understand this part.', status: 'saved', expectedRevision: 3, idempotencyKey: 'artifact-export-save-0001' })
    if (saved.kind !== 'ok') throw new Error('Expected save')
    const privateKey = await privateAdaptiveArtifactR2Key(OWNER.tokenIdentifier, saved.value.artifactId)
    await t.run(ctx => ctx.db.patch(saved.value.artifactId, { r2ObjectKey: privateKey }))
    const input = { collection: 'learningThreadArtifacts' as const, paginationOpts: { cursor: null, numItems: 100 } }
    const exported = await owner.query(api.dataExport.getUserDataPage, input)
    expect(exported.page).toHaveLength(1)
    expect(exported.page[0]).toMatchObject({ title: 'Export note', summary: 'I understand this part.' })
    expect(exported.page[0]).not.toHaveProperty('r2ObjectKey')
    expect(JSON.stringify(exported)).not.toContain(privateKey)
    expect((await other.query(api.dataExport.getUserDataPage, input)).page).toEqual([])
  })

  test('pending deleted artifacts cannot hide an older saved artifact from the bounded read', async () => {
    const { t, owner, threadId, activityId } = await fixture()
    const saved = await owner.mutation(api.learnAdaptive.saveArtifact, { threadId, activityId, artifactKind: 'note', title: 'Still here', summary: 'Keep this.', status: 'saved', expectedRevision: 3, idempotencyKey: 'artifact-visible-save-0001' })
    if (saved.kind !== 'ok') throw new Error('Expected save')
    const activity = await t.run(async ctx => ctx.db.get((await ctx.db.get(threadId))!.currentActivityId!))
    await t.run(async ctx => {
      for (let index = 0; index < 17; index++) await ctx.db.insert('learningThreadArtifacts', {
        userId: OWNER.tokenIdentifier, threadId, activityId: activity!._id, artifactKind: 'note', title: 'Deleted', summary: '',
        revision: 2, status: 'deleted', createdAt: Date.now() + index, updatedAt: Date.now() + index,
      })
    })
    expect(await owner.query(api.learnAdaptive.listThreadArtifacts, { threadId })).toMatchObject([{ id: saved.value.artifactId, title: 'Still here' }])
  })

  test('source deletion invalidates evidence without purging a learner-authored artifact', async () => {
    const { t, owner, threadId, activityId } = await fixture()
    const saved = await owner.mutation(api.learnAdaptive.saveArtifact, { threadId, activityId, artifactKind: 'answer', title: 'My answer', summary: 'A useful explanation in my words.', status: 'saved', expectedRevision: 3, idempotencyKey: 'artifact-source-save-0001' })
    if (saved.kind !== 'ok') throw new Error('Expected save')
    const sourceIdentityId = await t.run(async ctx => {
      const userId = OWNER.tokenIdentifier
      const folderId = await ctx.db.insert('folders', { userId, name: 'Source folder', documentCount: 0 })
      const learningVoidId = await ctx.db.insert('learningVoids', { userId, folderId, title: 'Source mission', status: 'active', revision: 1, createdAt: 1, updatedAt: 1 })
      const identityId = await ctx.db.insert('learnSourceIdentities', { userId, learningVoidId, origin: 'user_url', externalKey: 'artifact-source' })
      const snapshotId = await ctx.db.insert('learnSourceSnapshots', { userId, sourceIdentityId: identityId, learningVoidId, revision: 1, status: 'user_accepted', createdAt: 1 })
      const activity = await ctx.db.get((await ctx.db.get(threadId))!.currentActivityId!)
      await ctx.db.insert('learnActivityEvidenceLinks', { userId, threadId, activityId: activity!._id, sourceSnapshotId: snapshotId, boundaryOrdinal: 1, createdAt: 1 })
      await ctx.db.patch(threadId, { sourceScope: { kind: 'folder', sourceId: String(folderId) } })
      return identityId
    })
    for (let index = 0; index < 4; index++) {
      const result = await t.mutation(internal.learnV2Retention.purgeSourceEvidence, { userId: OWNER.tokenIdentifier, sourceIdentityId, reason: 'source_deleted' })
      if (!result.pending) break
    }
    expect(await t.run(ctx => ctx.db.get(saved.value.artifactId))).toMatchObject({ status: 'saved', title: 'My answer' })
    expect(await owner.query(api.learnAdaptive.listThreadArtifacts, { threadId })).toMatchObject([{ title: 'My answer' }])
  })

  test('invalidated factual evidence leaves a historical read-only artifact and rejects edits', async () => {
    const { t, owner, threadId, activityId } = await fixture()
    const saved = await owner.mutation(api.learnAdaptive.saveArtifact, { threadId, activityId, artifactKind: 'answer', title: 'Evidence note', summary: 'My retained explanation.', status: 'saved', expectedRevision: 3, idempotencyKey: 'artifact-invalidated-save-0001' })
    if (saved.kind !== 'ok') throw new Error('Expected save')
    const sourceIdentityId = await t.run(async ctx => {
      const userId = OWNER.tokenIdentifier
      const folderId = await ctx.db.insert('folders', { userId, name: 'Factual source', documentCount: 0 })
      const learningVoidId = await ctx.db.insert('learningVoids', { userId, folderId, title: 'Factual mission', status: 'active', revision: 1, createdAt: 1, updatedAt: 1 })
      const identityId = await ctx.db.insert('learnSourceIdentities', { userId, learningVoidId, origin: 'user_url', externalKey: 'artifact-factual' })
      const snapshotId = await ctx.db.insert('learnSourceSnapshots', { userId, sourceIdentityId: identityId, learningVoidId, revision: 1, status: 'user_accepted', createdAt: 1 })
      const activity = await ctx.db.get((await ctx.db.get(threadId))!.currentActivityId!)
      await ctx.db.patch(activity!._id, { activityClass: 'factual' })
      await ctx.db.insert('learnActivityEvidenceLinks', { userId, threadId, activityId: activity!._id, sourceSnapshotId: snapshotId, boundaryOrdinal: 1, createdAt: 1 })
      await ctx.db.patch(threadId, { sourceScope: { kind: 'folder', sourceId: String(folderId) }, evidenceState: 'ready' })
      return identityId
    })
    for (let index = 0; index < 4; index++) {
      const result = await t.mutation(internal.learnV2Retention.purgeSourceEvidence, { userId: OWNER.tokenIdentifier, sourceIdentityId, reason: 'source_deleted' })
      if (!result.pending) break
    }
    expect(await owner.query(api.learnAdaptive.listThreadArtifacts, { threadId })).toMatchObject([{ id: saved.value.artifactId, title: 'Evidence note', historical: true, readOnly: true, evidenceLabel: 'evidence_unavailable' }])
    expect(await owner.query(api.learnAdaptive.getMemory, { threadId })).toMatchObject({
      artifacts: [{ id: saved.value.artifactId, title: 'Evidence note', historical: true, readOnly: true, evidenceLabel: 'evidence_unavailable' }],
    })
    const revisionAfterInvalidation = (await t.run(ctx => ctx.db.get(threadId)))!.revision
    const edit = { threadId, activityId, artifactId: saved.value.artifactId, artifactKind: 'answer' as const, title: 'Revised', summary: 'Should not write.', status: 'saved' as const, expectedRevision: revisionAfterInvalidation, idempotencyKey: 'artifact-invalidated-edit-0001' }
    const rejected = await owner.mutation(api.learnAdaptive.saveArtifact, edit)
    expect(rejected).toMatchObject({ kind: 'blocked', code: 'artifact_evidence_unavailable' })
    expect(await owner.mutation(api.learnAdaptive.saveArtifact, edit)).toEqual(rejected)
    expect((await t.run(ctx => ctx.db.get(threadId)))?.revision).toBe(revisionAfterInvalidation)
    expect(await t.run(ctx => ctx.db.get(saved.value.artifactId))).toMatchObject({ title: 'Evidence note', revision: 1 })
  })

  test('folder Void deletion waits for its V2 thread and R2 artifact without touching another owner', async () => {
    const { t, owner, threadId, activityId } = await fixture()
    const ids = await t.run(async ctx => {
      const folderId = await ctx.db.insert('folders', { userId: OWNER.tokenIdentifier, name: 'Deleting folder', documentCount: 0 })
      const learningVoidId = await ctx.db.insert('learningVoids', { userId: OWNER.tokenIdentifier, folderId, title: 'Deleting mission', status: 'active', revision: 1, createdAt: 1, updatedAt: 1 })
      await ctx.db.patch(threadId, { authorityKind: 'v2_mission', learningVoidId, sourceScope: { kind: 'folder', sourceId: String(folderId) } })
      const activity = await ctx.db.get((await ctx.db.get(threadId))!.currentActivityId!)
      await ctx.db.patch(activity!._id, { learningVoidId })
      const foreignThreadId = await ctx.db.insert('learningThreads', { userId: OTHER.tokenIdentifier, originalNeed: 'Foreign', intent: 'build', availableTime: '25', authorityKind: 'v2_mission', learningVoidId, sourceScope: { kind: 'none' }, evidenceState: 'none', lifecycle: 'active', revision: 1, createdAt: 1, updatedAt: 1 })
      return { folderId, learningVoidId, foreignThreadId }
    })
    const saved = await owner.mutation(api.learnAdaptive.saveArtifact, { threadId, activityId, artifactKind: 'plan', title: 'Mission plan', summary: 'Keep until deletion succeeds.', status: 'saved', expectedRevision: 3, idempotencyKey: 'artifact-void-save-0001' })
    if (saved.kind !== 'ok') throw new Error('Expected save')
    const privateKey = await privateAdaptiveArtifactR2Key(OWNER.tokenIdentifier, saved.value.artifactId)
    await t.run(async ctx => { await ctx.db.patch(saved.value.artifactId, { r2ObjectKey: privateKey }); await ctx.db.delete(ids.folderId) })
    await t.mutation(internal.learnV2Retention.deleteFolderFoundation, { userId: OWNER.tokenIdentifier, folderId: ids.folderId })
    expect(await t.run(ctx => ctx.db.get(ids.learningVoidId))).not.toBeNull()
    expect(await t.run(ctx => ctx.db.get(threadId))).not.toBeNull()
    const job = await t.run(ctx => ctx.db.query('learnAdaptiveThreadDeletionJobs').withIndex('by_userId_and_threadId', q => q.eq('userId', OWNER.tokenIdentifier).eq('threadId', threadId)).unique())
    expect(job).not.toBeNull()
    expect(await owner.mutation(api.learnAdaptive.saveArtifact, { threadId, activityId, artifactKind: 'plan', title: 'Too late', summary: 'Blocked.', status: 'saved', expectedRevision: 4, idempotencyKey: 'artifact-void-after-delete-0001' })).toMatchObject({ kind: 'blocked', code: 'thread_deleting' })
    await t.mutation(internal.learnAdaptiveCommands.runThreadDeletionJob, { jobId: job!._id })
    const cleanup = await t.run(ctx => ctx.db.query('pendingCleanup').withIndex('by_learningThreadArtifactId', q => q.eq('learningThreadArtifactId', saved.value.artifactId)).unique())
    expect(cleanup).toMatchObject({ r2Key: privateKey })
    expect(await t.run(ctx => ctx.db.get(ids.learningVoidId))).not.toBeNull()
    await t.mutation(internal.accountDeletion.removePendingCleanup, { id: cleanup!._id })
    for (let index = 0; index < 15 && await t.run(ctx => ctx.db.get(job!._id)); index++) await t.mutation(internal.learnAdaptiveCommands.runThreadDeletionJob, { jobId: job!._id })
    for (let index = 0; index < 15 && await t.run(ctx => ctx.db.get(ids.learningVoidId)); index++) await t.mutation(internal.learnV2Retention.deleteFolderFoundation, { userId: OWNER.tokenIdentifier, folderId: ids.folderId })
    expect(await t.run(ctx => ctx.db.get(saved.value.artifactId))).toBeNull()
    expect(await t.run(ctx => ctx.db.get(threadId))).toBeNull()
    expect(await t.run(ctx => ctx.db.get(ids.learningVoidId))).toBeNull()
    expect(await t.run(ctx => ctx.db.get(ids.foreignThreadId))).not.toBeNull()
  })
})
