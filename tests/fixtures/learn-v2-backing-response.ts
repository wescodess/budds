import type { TestConvex } from 'convex-test'
import type schema from '../../convex/schema'
import { api, internal } from '../../convex/_generated/api'
import { seedMeasurementStorage, STORAGE_CANARIES } from './learn-v2-measurement-storage'
import { standaloneResponseFixture } from './learn-v2-standalone-response'

export const BACKING_SOURCE_CASES = [
  ['unchanged', true, true, true],
  ['normalized', true, true, true],
  ['hash_replaced', false, false, false],
  ['revision_only', false, false, false],
  ['revision_replaced', false, false, true],
  ['object_replaced', false, true, true],
  ['hash_absent', false, false, false],
  ['revision_absent', false, false, false],
  ['both_absent', false, false, true],
] as const
export const BACKING_SOURCE_KINDS = ['snapshot', 'direct', 'legacy'] as const
type Kind = typeof BACKING_SOURCE_KINDS[number]
type Change = typeof BACKING_SOURCE_CASES[number][0]

export async function backingResponseFixture(t: TestConvex<typeof schema>, userId: string, kind: Kind) {
  if (kind !== 'snapshot') {
    const f = await standaloneResponseFixture(t, userId, 'document', kind === 'direct')
    return { ...f, kind, sourceSnapshotId: undefined,
      target: f.responseSlotId ? { responseSlotId: f.responseSlotId } : undefined }
  }
  const owner = t.withIdentity({ tokenIdentifier: userId })
  await owner.mutation(api.users.upsertUser, {})
  await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: userId, enabled: true })
  await owner.mutation(internal.learnAdaptiveAccess.setCohortEntitlement, { enabled: true })
  const f = await t.run(ctx => seedMeasurementStorage(ctx, userId))
  await t.run(async ctx => {
    await ctx.db.patch(f.documentId, { contentHash: 'a'.repeat(64), sourceRevision: `sha256:${'a'.repeat(64)}`, r2Key: 'snapshot/original.txt' })
    await ctx.db.patch(f.sourceSnapshotId, { contentHash: 'a'.repeat(64), sourceRevision: `sha256:${'a'.repeat(64)}`, objectKey: 'snapshot/original.txt' })
    const activity = (await ctx.db.get(f.activityId))!
    const canvas = { threadId: f.threadId, threadRevision: 1, activityId: f.activityId, activityRevision: activity.planRevision,
      planVersion: activity.planVersion, replayVersion: activity.replayVersion, rendererVersion: activity.rendererVersion,
      evaluationVersion: activity.evaluationContract.version, pilotConfigurationVersion: 'fixture.v1' }
    const contextPins = { ...f.scope.contextPins, canvas }
    await ctx.db.patch(f.threadId, { authorityKind: 'v2_mission', learningVoidId: f.learningVoidId, currentActivityId: f.activityId })
    await ctx.db.patch(f.scope.contextPins.sessionContentId, { blueprintRevisionId: f.scope.blueprintRevisionId })
    await ctx.db.patch(f.activityId, { sessionContentId: f.scope.contextPins.sessionContentId, status: 'submitted', submittedResponse: STORAGE_CANARIES.answer,
      decisionInputs: { ...activity.decisionInputs, sourceInputs: [{ sourceSnapshotId: String(f.sourceSnapshotId), effectiveStatus: 'user_accepted', recordRevision: 1 }] } })
    await ctx.db.patch(f.rows.learnResponses, { contextPins })
    await ctx.db.patch(f.rows.learnAssessmentOpportunities, { contextPins })
    await ctx.db.patch(f.rows.learnResponseEvidenceLinks, { dependency: { kind: 'snapshot', sourceSnapshotId: f.sourceSnapshotId,
      sourceSnapshotRevision: 1, sourceRecordRevision: 1, supportManifestDigest: `sha256:${'a'.repeat(64)}` } })
    await ctx.db.insert('learnActivityEvidenceLinks', { userId, threadId: f.threadId, activityId: f.activityId,
      sourceSnapshotId: f.sourceSnapshotId, boundaryOrdinal: 1, createdAt: f.base.createdAt })
  })
  return { t, owner, userId, kind, folderId: f.folderId, documentId: f.documentId, threadId: f.threadId,
    activityId: f.activityId, answer: STORAGE_CANARIES.answer, sourceSnapshotId: f.sourceSnapshotId,
    submissionId: f.rows.learnResponses, responseSlotId: undefined, target: { assessmentOpportunityId: f.rows.learnAssessmentOpportunities } }
}

export type BackingResponseFixture = Awaited<ReturnType<typeof backingResponseFixture>>

export async function replaceBackingDocument(f: BackingResponseFixture, change: Change) {
  const { t, documentId } = f
  if (change === 'unchanged') return
  if (change === 'hash_absent' || change === 'revision_absent' || change === 'both_absent') {
    await t.run(async ctx => {
      if (change !== 'revision_absent') await ctx.db.patch(documentId, { contentHash: undefined })
      if (change !== 'hash_absent') await ctx.db.patch(documentId, { sourceRevision: undefined })
      // Also exercise the lineage predicate's both-absent guard when all
      // remaining snapshot comparisons would otherwise match.
      if (change === 'both_absent' && f.sourceSnapshotId) await ctx.db.patch(f.sourceSnapshotId, { contentHash: undefined, sourceRevision: undefined })
    })
    return
  }
  const patch = change === 'normalized'
    ? { sourceRevision: `  sha256:${'a'.repeat(64)}  `, contentHash: `  ${'A'.repeat(64)}  `,
        r2Key: f.kind === 'snapshot' ? '  snapshot/original.txt  ' : '  standalone/original.txt  ' }
    : change === 'hash_replaced' ? { contentHash: 'b'.repeat(64) }
      : change === 'revision_only' ? { sourceRevision: `sha256:${'b'.repeat(64)}` }
        : change === 'revision_replaced' ? { contentHash: 'b'.repeat(64), sourceRevision: `sha256:${'b'.repeat(64)}` }
          : { r2Key: 'backing/relocated.txt' }
  await t.mutation(internal.documents.updateDocumentStatus, { id: documentId, status: 'success', ...patch })
}

export async function purgeBackingResponse(f: BackingResponseFixture) {
  await f.t.mutation(internal.learnV2Retention.purgeFolderDocumentSources, { userId: f.userId, documentId: f.documentId })
}
