import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import { LEARN_MEASUREMENT_STORAGE_VERSION, LEARN_V2_POST_SEAL_STORAGE_VERSION } from '../../shared/learn-v2-measurement-storage-manifest'
import { learnPostSealTeachingSourceStorageSchema } from '../../shared/learn-v2-post-seal-storage'

export function postSealApplicationFields<T extends { _id: string, _creationTime: number }>(row: T) {
  const { _id: _id, _creationTime: _creationTime, ...fields } = row
  return fields
}

export async function stampPostSealTeachingAttempt(
  ctx: MutationCtx, opportunity: Doc<'learnAssessmentOpportunities'>, attemptId: Id<'masteryAttempts'>,
) {
  if (!opportunity.submissionId) return
  const rows = await ctx.db.query('learnPostSealTeachingSources').withIndex('by_userId_and_submissionId', q =>
    q.eq('userId', opportunity.userId).eq('submissionId', opportunity.submissionId!)).take(2)
  if (rows.length > 1) return
  const row = rows[0]
  if (!row) {
    const fields = { userId: opportunity.userId, storageVersion: LEARN_MEASUREMENT_STORAGE_VERSION,
      postSealStorageVersion: LEARN_V2_POST_SEAL_STORAGE_VERSION, createdAt: Date.now(), learningVoidId: opportunity.learningVoidId,
      assessmentOpportunityId: opportunity._id, submissionId: opportunity.submissionId, attemptId,
      sourceDependencyCount: 0 as const, evidenceStatus: 'available' as const, content: { status: 'pending' as const } }
    if (learnPostSealTeachingSourceStorageSchema.safeParse(fields).success) await ctx.db.insert('learnPostSealTeachingSources', fields)
    return
  }
  if (row.learningVoidId !== opportunity.learningVoidId || row.assessmentOpportunityId !== opportunity._id
    || !learnPostSealTeachingSourceStorageSchema.safeParse(postSealApplicationFields(row)).success || row.attemptId !== null) return
  await ctx.db.patch(row._id, { attemptId })
}
