import type { Infer } from 'convex/values'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { AdaptiveCommandRejection } from '../learnAdaptiveCommands'
import { acceptedAttemptProjectionValidator } from '../../shared/adaptive-learn-storage-manifest'

export type AcceptedAttemptProjection = Infer<typeof acceptedAttemptProjectionValidator>
export function sameAttemptProjection(left: AcceptedAttemptProjection, right: AcceptedAttemptProjection) {
  return Object.entries(left).every(([key, value]) => right[key as keyof AcceptedAttemptProjection] === value)
}
export async function projectionDigest(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
  return `sha256:${[...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')}`
}

// A committed scoring job, its attempt, and its adaptive activity must all name
// the same boundary. Source text, session reuse, and caller aliases never join it.
export async function acceptedAttemptAuthority(ctx: QueryCtx | MutationCtx, userId: string, threadId: Id<'learningThreads'>, attemptId: Id<'masteryAttempts'>) {
  const thread = await ctx.db.get(threadId)
  const attempt = await ctx.db.get(attemptId)
  if (!thread || thread.userId !== userId || thread.deletionStartedAt !== undefined || thread.lifecycle === 'rollback'
    || !attempt || attempt.userId !== userId || attempt.activityContractVersion !== 'learn-v2.mastery-attempt.v1'
    || !attempt.studySessionId || !attempt.sessionContentId || !attempt.studyPlanRevisionId || !attempt.blueprintRevisionId
    || attempt.serverScorePercent === undefined || !Number.isFinite(attempt.serverScorePercent) || attempt.serverScorePercent < 0 || attempt.serverScorePercent > 100
    || attempt.contentRevision === undefined || attempt.sessionRevision === undefined || attempt.planRevision === undefined
    || attempt.planRecordRevision === undefined || attempt.blueprintRecordRevision === undefined || !attempt.result
    || attempt.masteryRecordRevision === undefined) return null
  const activity = await ctx.db.query('learningThreadActivities')
    .withIndex('by_userId_and_threadId_and_masteryAttemptId', q => q.eq('userId', userId).eq('threadId', threadId).eq('masteryAttemptId', attemptId)).unique()
  if (!activity || !activity.scoringJobId || activity.activityClass !== 'factual'
    || !['feedback', 'ended', 'replaced'].includes(activity.status) || activity.reconciliationReason
    || activity.sessionContentId !== attempt.sessionContentId || activity.blueprintRevisionId !== attempt.blueprintRevisionId
    || activity.objectiveId !== attempt.objectiveId || activity.learningVoidId !== thread.learningVoidId
    || activity.generationInputs.sessionContentRevision !== attempt.contentRevision) return null
  const [job, session, content, plan, blueprint, objective, learningVoid] = await Promise.all([
    ctx.db.get(activity.scoringJobId), ctx.db.get(attempt.studySessionId), ctx.db.get(attempt.sessionContentId),
    ctx.db.get(attempt.studyPlanRevisionId), ctx.db.get(attempt.blueprintRevisionId), ctx.db.get(attempt.objectiveId),
    thread.learningVoidId ? ctx.db.get(thread.learningVoidId) : null,
  ])
  if (!job || job.userId !== userId || job.type !== 'mastery_scoring' || job.status !== 'succeeded'
    || job.checkpoint !== `attempt:${attemptId}` || job.idempotencyKey !== attempt.idempotencyKey
    || job.adaptiveThreadId !== threadId || job.adaptiveActivityId !== activity._id
    || job.studySessionId !== session?._id || job.studyPlanRevisionId !== plan?._id
    || job.blueprintRevisionId !== blueprint?._id || job.learningVoidId !== learningVoid?._id
    || !session || session.userId !== userId || session.status !== 'completed' || session.revision !== attempt.sessionRevision + 1
    || session.studyPlanRevisionId !== plan?._id || session.primaryObjectiveId !== attempt.objectiveId
    || session.startedSessionContentId !== content?._id || session.startedSessionContentRevision !== attempt.contentRevision
    || !content || content.userId !== userId || content.status !== 'published' || content.publishedAt === undefined
    || content.studySessionId !== session._id || content.revision !== attempt.contentRevision
    || content.studyPlanRevisionId !== plan?._id || content.blueprintRevisionId !== blueprint?._id || content.objectiveId !== attempt.objectiveId
    || !plan || plan.userId !== userId || !['accepted', 'active'].includes(plan.status)
    || plan.revision !== attempt.planRevision || plan.recordRevision !== attempt.planRecordRevision
    || plan.blueprintRevisionId !== blueprint?._id || plan.blueprintRecordRevision !== attempt.blueprintRecordRevision
    || plan.learningVoidId !== learningVoid?._id || !blueprint || blueprint.userId !== userId
    || !['accepted', 'active'].includes(blueprint.status) || blueprint.recordRevision !== attempt.blueprintRecordRevision
    || blueprint.learningVoidId !== learningVoid?._id || !objective || objective.userId !== userId || objective.blueprintRevisionId !== blueprint._id
    || !learningVoid || learningVoid.userId !== userId) return null
  const folder = await ctx.db.get(learningVoid.folderId)
  if (!folder || folder.userId !== userId) return null
  const projection: AcceptedAttemptProjection = {
    version: 'learn-adaptive.accepted-attempt-projection.v1', threadId, activityId: activity._id, attemptId,
    scoringJobId: job._id, studySessionId: session._id, sessionContentId: content._id, contentRevision: content.revision,
    studyPlanRevisionId: plan._id, planRevision: plan.revision, planRecordRevision: attempt.planRecordRevision,
    blueprintRevisionId: blueprint._id, blueprintRecordRevision: attempt.blueprintRecordRevision, activityInputDigest: activity.inputDigest,
  }
  return { thread, attempt, activity, folder, projection }
}

export async function verifyAttemptProjection(ctx: QueryCtx | MutationCtx, userId: string, projection: AcceptedAttemptProjection) {
  const authority = await acceptedAttemptAuthority(ctx, userId, projection.threadId, projection.attemptId)
  return authority && sameAttemptProjection(authority.projection, projection) ? authority : null
}

export async function safeAttemptProjection(ctx: QueryCtx | MutationCtx, userId: string, projection: AcceptedAttemptProjection) {
  const authority = await verifyAttemptProjection(ctx, userId, projection)
  return { version: projection.version, attemptId: projection.attemptId, threadId: projection.threadId,
    status: authority ? 'accepted' as const : 'unavailable' as const,
    scorePercent: authority?.attempt.serverScorePercent ?? null,
    feedback: authority?.activity.feedbackProjection ?? null, handoffAllowed: Boolean(authority) }
}

export function unavailableProjection(): never {
  throw new AdaptiveCommandRejection('blocked', 'accepted_attempt_unavailable', 'This accepted learning attempt is unavailable for handoff.')
}

export async function recordAttemptProjectionOrigin(ctx: MutationCtx, userId: string, projection: AcceptedAttemptProjection, source: { feature: 'quiz', row: Doc<'quizzes'> } | { feature: 'chat', row: Doc<'messages'> }) {
  const sourceIdentity = String(source.row._id)
  const sourceRevision = await projectionDigest(source.feature === 'quiz' ? JSON.stringify([source.row, []]) : JSON.stringify(source.row))
  const provenanceKey = await projectionDigest(JSON.stringify(['learn-thread-contribution.v1', userId, String(projection.threadId), source.feature, sourceIdentity, sourceRevision, 'result']))
  const prior = await ctx.db.query('learningThreadContributions').withIndex('by_userId_and_provenanceKey', q => q.eq('userId', userId).eq('provenanceKey', provenanceKey)).unique()
  if (prior) return prior._id
  return await ctx.db.insert('learningThreadContributions', {
    userId, threadId: projection.threadId, sourceFeature: source.feature, sourceIdentity, sourceRevision,
    contributionKind: 'result', provenanceVersion: 'learn-adaptive.contribution.v1', provenanceKey,
    classification: 'non_factual', metadata: { role: 'review' }, sourceStatus: 'available', attemptProjection: projection,
    idempotencyKeyHash: await projectionDigest(`accepted-attempt-origin:${userId}:${source.feature}:${sourceIdentity}`),
    requestFingerprint: await projectionDigest(JSON.stringify([projection, source.feature, sourceIdentity, sourceRevision])), createdAt: Date.now(),
  })
}
