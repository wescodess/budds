import type { convexTest, TestConvex } from 'convex-test'
import { api } from '../../convex/_generated/api'
import type schema from '../../convex/schema'
import { seedMeasurementStorage } from './learn-v2-measurement-storage'

type Owner = ReturnType<ReturnType<typeof convexTest>['withIdentity']>
export async function authorizeExport(owner: Owner) {
  let result = await owner.mutation(api.dataExport.authorizePersonalExport, {})
  while (!result.done) result = await owner.mutation(api.dataExport.authorizePersonalExport, {
    authorizationId: result.authorizationId, cursor: result.cursor ?? undefined,
  })
  return result.authorizationId
}

export async function folderBackedExportFixture(t: TestConvex<typeof schema>, userId: string) {
  const owner = t.withIdentity({ tokenIdentifier: userId })
  await owner.mutation(api.users.upsertUser, {})
  const f = await t.run(ctx => seedMeasurementStorage(ctx, userId))
  const answer = 'Retained own folder-backed legacy answer'
  const attemptId = await t.run(async ctx => {
    await ctx.db.patch(f.documentId, { contentHash: 'a'.repeat(64), sourceRevision: `sha256:${'a'.repeat(64)}` })
    await ctx.db.patch(f.sourceSnapshotId, { rightsStatus: 'unknown', blueprintRevisionId: f.scope.blueprintRevisionId,
      contentHash: 'a'.repeat(64), sourceRevision: `sha256:${'a'.repeat(64)}` })
    await ctx.db.delete(f.sourceExcerptId)
    await ctx.db.patch(f.learningVoidId, { activeBlueprintRevisionId: f.scope.blueprintRevisionId })
    await ctx.db.patch(f.scope.blueprintRevisionId, { status: 'accepted' })
    await ctx.db.patch(f.scope.contextPins.sessionContentId, { blueprintRevisionId: f.scope.blueprintRevisionId })
    await ctx.db.patch(f.rows.learnResponseEvidenceLinks, { dependency: { kind: 'snapshot', sourceSnapshotId: f.sourceSnapshotId,
      sourceSnapshotRevision: 1, sourceRecordRevision: 1, supportManifestDigest: `sha256:${'a'.repeat(64)}` } })
    await ctx.db.insert('learnObjectiveSources', { userId, objectiveId: f.scope.objectiveId, sourceSnapshotId: f.sourceSnapshotId, coverage: 'strong' })
    return await ctx.db.insert('masteryAttempts', { userId, objectiveId: f.scope.objectiveId,
      blueprintRevisionId: f.scope.blueprintRevisionId, sourceSnapshotIdsJson: JSON.stringify([f.sourceSnapshotId]),
      kind: 'calibration', response: answer, confidence: 4, attemptedAt: f.base.createdAt, serverScorePercent: 80, idempotencyKey: 'folder-legacy-answer' })
  })
  return { ...f, t, owner, userId, answer, attemptId }
}
