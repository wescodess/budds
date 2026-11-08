import { deleteMeasurementVoidBatch, invalidateMeasurementSourceBatch, invalidateMeasurementReportRowsBatch, readMeasurementSourceDescendants, type measurementSourceValidator } from './lib/learnV2MeasurementRetention'
import { v } from 'convex/values'
import { internalMutation, type MutationCtx } from './_generated/server'
import { internal } from './_generated/api'
import type { Doc, Id, TableNames } from './_generated/dataModel'
import {
  incrementRecordRevision,
  sanitizePublicSourceLocator,
  tombstonedSourceExternalKey,
} from './lib/learnV2SourceSanitization'
import { releaseSearchReservationClaims } from './learnV2Search'
import { writeLearnActivityEvent } from './lib/learnAdaptiveEvents'
import { initiateAdaptiveThreadDeletion } from './learnAdaptiveCommands'
import { retainsSafeAdaptiveRejection } from './lib/learnAdaptiveReceiptPrivacy'
import { activityResponseTargets, digestLegacyFingerprint, legacySourceIds, privacyDigest } from './lib/learnV2ResponsePrivacy'
import { appendLearnMeasurementFact, nextLearnMeasurementSourceSequence } from './lib/learnV2MeasurementFacts'
import { LEARN_MEASUREMENT_STORAGE_VERSION } from '../shared/learn-v2-measurement-storage-manifest'

// This deliberately stays below the account-deletion batch. Folder deletion
// only has live lifecycle producers today; later producers must add their
// child-before-parent rows here in the ticket that introduces them.
const BATCH_SIZE = 8

async function redactLegacyAttempt(ctx: MutationCtx, attempt: Doc<'masteryAttempts'>) {
  await ctx.db.patch(attempt._id, { response: undefined, rubricSnapshot: undefined, criterionResultsJson: undefined,
    misconceptionTagsJson: undefined, feedbackProjectionJson: undefined, contentRevisionPinsJson: undefined,
    verifierVersionsJson: undefined, sourceSnapshotIdsJson: '[]',
    ...(attempt.requestFingerprint ? { requestFingerprint: await digestLegacyFingerprint(attempt.requestFingerprint) } : {}) })
}

export const purgeResponseCopies = internalMutation({
  args: { userId: v.string(), submissionId: v.id('learnResponses'), phase: v.optional(v.union(v.literal('executions'), v.literal('attempts'), v.literal('activities'))), cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const response = await ctx.db.get(args.submissionId)
    if (!response || response.userId !== args.userId) return
    const now = Date.now()
    if (!args.phase) {
      const bodies = await ctx.db.query('learnResponseBodies').withIndex('by_userId_and_submissionId', q => q.eq('userId', args.userId).eq('submissionId', response._id)).take(BATCH_SIZE)
      await removeRows(ctx, bodies)
      if (response.bodyAvailability !== 'purged') {
        const previous = await ctx.db.query('learnResponseIntegrityEvents').withIndex('by_userId_and_submissionId_and_sequence', q => q.eq('userId', args.userId).eq('submissionId', response._id)).order('desc').first()
        const epoch = 'measurementContext' in response && response.measurementContext.status === 'admitted' ? response.measurementContext.baselineEpoch : null
        const sourceFactSequence = epoch ? (await nextLearnMeasurementSourceSequence(ctx, args.userId)).sequence : 0
        const sequence = (previous?.sequence ?? 0) + 1
        if (!Number.isSafeInteger(sequence)) throw new Error('Learn integrity sequence exhausted')
        const integrityEventId = await ctx.db.insert('learnResponseIntegrityEvents', { userId: args.userId, storageVersion: LEARN_MEASUREMENT_STORAGE_VERSION,
          createdAt: now, submissionId: response._id, ...(response.scopeKind === 'v2' ? { learningVoidId: response.learningVoidId } : { threadId: response.threadId }),
          sequence, kind: 'body_purged', reasonCode: 'evidence_unavailable', effectiveAt: now, policyVersion: 'learn-v2.response-purge.v1', sourceFactSequence })
        if (epoch) await appendLearnMeasurementFact(ctx, args.userId, { epoch, learningVoidId: response.scopeKind === 'v2' ? response.learningVoidId : undefined,
          occurredAt: now, expectedSequence: sourceFactSequence, fact: { kind: 'integrity', submissionId: response._id, integrityEventId,
            currentEligibility: 'excluded', evidenceAvailable: false, bodyAvailability: 'purged' } })
      }
      await ctx.db.patch(response._id, { evidenceStatus: 'evidence_unavailable', invalidatedAt: response.invalidatedAt ?? now,
        bodyAvailability: 'purged', bodyUnavailableReason: 'evidence_unavailable', bodyPurgedAt: response.bodyPurgedAt ?? now, currentEligibility: 'excluded' })
      await ctx.scheduler.runAfter(0, internal.learnV2Retention.purgeResponseCopies, { ...args, ...(bodies.length < BATCH_SIZE ? { phase: 'executions' as const } : {}) })
      return
    }
    if (args.phase === 'activities') {
      const activityId = response.scopeKind === 'standalone' ? response.activityId
        : response.contextPins.kind === 'session' ? response.contextPins.canvas?.activityId : undefined
      const activity = activityId && await ctx.db.get(activityId)
      if (activity?.userId === args.userId) await redactActivityCopies(ctx, activity)
      return
    }
    if (args.phase === 'executions') {
      const page = await ctx.db.query('learnScoringExecutions').withIndex('by_userId_and_submissionId', q => q.eq('userId', args.userId).eq('submissionId', response._id)).paginate({ cursor: args.cursor ?? null, numItems: BATCH_SIZE })
      for (const execution of page.page) await ctx.db.patch(execution._id, { evidenceStatus: 'evidence_unavailable', invalidatedAt: now,
        frozenConfiguration: { digest: execution.frozenConfiguration.digest, snapshot: '[purged]' }, verdict: undefined, integrityResult: 'evidence_unavailable' })
      await ctx.scheduler.runAfter(0, internal.learnV2Retention.purgeResponseCopies, { ...args,
        phase: page.isDone ? 'attempts' : 'executions', cursor: page.isDone ? undefined : page.continueCursor })
      return
    }
    const page = await ctx.db.query('masteryAttempts').withIndex('by_userId_and_submissionId', q => q.eq('userId', args.userId).eq('submissionId', response._id)).paginate({ cursor: args.cursor ?? null, numItems: BATCH_SIZE })
    for (const attempt of page.page) await redactLegacyAttempt(ctx, attempt)
    await ctx.scheduler.runAfter(0, internal.learnV2Retention.purgeResponseCopies, { ...args, phase: page.isDone ? 'activities' : 'attempts', cursor: page.isDone ? undefined : page.continueCursor })
  },
})

async function purgeResponseSourceBatch(ctx: MutationCtx, userId: string, source: import('convex/values').Infer<typeof measurementSourceValidator>) {
  if (await invalidateMeasurementReportRowsBatch(ctx, userId)) return true
  const references = await readMeasurementSourceDescendants(ctx, userId, source)
  for (const reference of references) {
    if (reference.collection === 'learnMeasurementSupports') {
      const support = await ctx.db.get(reference.id as Id<'learnMeasurementSupports'>)
      if (support?.userId === userId) await ctx.db.patch(support._id, { locatorDigest: await privacyDigest(support.locatorDigest) })
    }
    if (reference.collection !== 'learnResponseEvidenceLinks') continue
    const link = await ctx.db.get(reference.id as Id<'learnResponseEvidenceLinks'>)
    if (!link || link.userId !== userId) continue
    // Start descendant cleanup before consuming its reverse link.
    await ctx.runMutation(internal.learnV2Retention.purgeResponseCopies, { userId, submissionId: link.submissionId })
    await ctx.db.patch(link._id, { evidenceStatus: 'evidence_unavailable', invalidatedAt: Date.now() })
  }
  if (references.some(reference => reference.collection === 'learnResponseEvidenceLinks')) return true
  return await invalidateMeasurementSourceBatch(ctx, userId, source)
}

export const purgeLegacyObjectiveCopies = internalMutation({
  args: { userId: v.string(), sourceSnapshotId: v.id('learnSourceSnapshots'), objectiveId: v.id('learnObjectives'), cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const support = await ctx.db.query('learnObjectiveSources').withIndex('by_userId_and_objectiveId_and_sourceSnapshotId', q => q.eq('userId', args.userId).eq('objectiveId', args.objectiveId).eq('sourceSnapshotId', args.sourceSnapshotId)).first()
    const objective = await ctx.db.get(args.objectiveId)
    const backsObjective = !!support && support.coverage !== 'gap'
    if (backsObjective && objective?.userId === args.userId) await ctx.db.patch(objective._id, { assessmentContract: undefined })
    const page = await ctx.db.query('masteryAttempts').withIndex('by_userId_and_objectiveId_and_attemptedAt', q => q.eq('userId', args.userId).eq('objectiveId', args.objectiveId)).paginate({ cursor: args.cursor ?? null, numItems: BATCH_SIZE })
    for (const attempt of page.page) {
      const ids = legacySourceIds(ctx, attempt.sourceSnapshotIdsJson)
      if (!ids || (backsObjective && ids.length === 0) || ids.includes(args.sourceSnapshotId)) await redactLegacyAttempt(ctx, attempt)
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.learnV2Retention.purgeLegacyObjectiveCopies, { ...args, cursor: page.continueCursor })
  },
})

async function jobDependsOnSource(ctx: MutationCtx, job: Doc<'learnJobs'>, sourceSnapshotId: Id<'learnSourceSnapshots'>) {
  if (job.dispatchSupportingSourceSnapshotIds !== undefined) return job.dispatchSupportingSourceSnapshotIds.includes(sourceSnapshotId)
  if (job.submissionId) {
    const links = await ctx.db.query('learnResponseEvidenceLinks').withIndex('by_userId_and_submissionId', q => q.eq('userId', job.userId).eq('submissionId', job.submissionId!)).take(65)
    return links.length > 64 || links.some(link => link.dependency.kind === 'snapshot' && link.dependency.sourceSnapshotId === sourceSnapshotId)
  }
  let objectiveId: Id<'learnObjectives'> | null = null
  if (job.studySessionId) {
    const session = await ctx.db.get(job.studySessionId)
    if (session?.userId === job.userId) objectiveId = session.primaryObjectiveId
  }
  for (const encoded of [job.checkpoint, job.requestFingerprint]) {
    if (objectiveId || !encoded) continue
    try {
      const value: unknown = JSON.parse(encoded)
      if (value && typeof value === 'object' && 'objectiveId' in value && typeof value.objectiveId === 'string') {
        objectiveId = ctx.db.normalizeId('learnObjectives', value.objectiveId)
      }
    }
    catch { /* Legacy jobs may not have a recoverable objective pin. */ }
  }
  if (!objectiveId) return true
  return !!await ctx.db.query('learnObjectiveSources')
    .withIndex('by_userId_and_objectiveId_and_sourceSnapshotId', q => q.eq('userId', job.userId).eq('objectiveId', objectiveId!).eq('sourceSnapshotId', sourceSnapshotId)).first()
}

export const purgeLegacySourceCopies = internalMutation({
  args: { userId: v.string(), sourceSnapshotId: v.id('learnSourceSnapshots'), phase: v.optional(v.union(v.literal('jobs'), v.literal('lifecycle'), v.literal('plans'), v.literal('plan_receipts'))), cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const snapshot = await ctx.db.get(args.sourceSnapshotId)
    if (!snapshot || snapshot.userId !== args.userId) return
    if (!args.phase) {
      const page = await ctx.db.query('learnObjectiveSources').withIndex('by_userId_and_sourceSnapshotId', q => q.eq('userId', args.userId).eq('sourceSnapshotId', snapshot._id)).paginate({ cursor: args.cursor ?? null, numItems: BATCH_SIZE })
      for (const link of page.page) await ctx.scheduler.runAfter(0, internal.learnV2Retention.purgeLegacyObjectiveCopies, { userId: args.userId, sourceSnapshotId: snapshot._id, objectiveId: link.objectiveId })
      await ctx.scheduler.runAfter(0, internal.learnV2Retention.purgeLegacySourceCopies, { ...args, phase: page.isDone ? 'jobs' : undefined, cursor: page.isDone ? undefined : page.continueCursor })
      return
    }
    if (args.phase === 'jobs') {
      const page = await ctx.db.query('learnJobs').withIndex('by_userId_and_learningVoidId_and_type', q => q.eq('userId', args.userId).eq('learningVoidId', snapshot.learningVoidId)).paginate({ cursor: args.cursor ?? null, numItems: BATCH_SIZE })
      for (const job of page.page) if (await jobDependsOnSource(ctx, job, snapshot._id)) await ctx.db.patch(job._id, {
        ...(job.requestFingerprint ? { requestFingerprint: await digestLegacyFingerprint(job.requestFingerprint) } : {}),
        checkpoint: undefined,
        ...(['succeeded', 'failed', 'cancelled'].includes(job.status) ? {} : { status: 'blocked' as const, leaseToken: undefined, leaseExpiresAt: undefined, terminalReason: 'evidence_unavailable' }),
      })
      await ctx.scheduler.runAfter(0, internal.learnV2Retention.purgeLegacySourceCopies, { ...args, phase: page.isDone ? 'lifecycle' : 'jobs', cursor: page.isDone ? undefined : page.continueCursor })
      return
    }
    if (args.phase === 'lifecycle') {
      const page = await ctx.db.query('learnLifecycleReceipts').withIndex('by_userId_and_learningVoidId', q => q.eq('userId', args.userId).eq('learningVoidId', snapshot.learningVoidId)).paginate({ cursor: args.cursor ?? null, numItems: BATCH_SIZE })
      for (const receipt of page.page) await ctx.db.patch(receipt._id, { requestFingerprint: await digestLegacyFingerprint(receipt.requestFingerprint) })
      await ctx.scheduler.runAfter(0, internal.learnV2Retention.purgeLegacySourceCopies, { ...args, phase: page.isDone ? 'plans' : 'lifecycle', cursor: page.isDone ? undefined : page.continueCursor })
      return
    }
    if (args.phase === 'plans') {
      await ctx.scheduler.runAfter(0, internal.learnV2Retention.purgeLegacySourceCopies, { ...args, phase: 'plan_receipts', cursor: undefined })
      return
    }
    const page = await ctx.db.query('learnPlanCommandReceipts').withIndex('by_userId_and_learningVoidId', q => q.eq('userId', args.userId).eq('learningVoidId', snapshot.learningVoidId)).paginate({ cursor: args.cursor ?? null, numItems: BATCH_SIZE })
    for (const receipt of page.page) await ctx.db.patch(receipt._id, { requestFingerprint: await digestLegacyFingerprint(receipt.requestFingerprint), response: JSON.stringify({ status: 'unavailable', reasonCode: 'evidence_unavailable' }) })
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.learnV2Retention.purgeLegacySourceCopies, { ...args, cursor: page.continueCursor })
  },
})

export const purgeContentCopies = internalMutation({
  args: { userId: v.string(), sessionContentId: v.id('sessionContent'), phase: v.optional(v.literal('activities')), cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const content = await ctx.db.get(args.sessionContentId)
    if (!content || content.userId !== args.userId) return
    await ctx.db.patch(content._id, { assessmentRubricSnapshot: undefined })
    if (args.phase === 'activities') {
      const page = await ctx.db.query('learningThreadActivities').withIndex('by_userId_and_sessionContentId_and_updatedAt', q => q.eq('userId', args.userId).eq('sessionContentId', content._id)).paginate({ cursor: args.cursor ?? null, numItems: BATCH_SIZE })
      for (const activity of page.page) await redactActivityCopies(ctx, activity)
      if (!page.isDone) await ctx.scheduler.runAfter(0, internal.learnV2Retention.purgeContentCopies, { ...args, cursor: page.continueCursor })
      return
    }
    const page = await ctx.db.query('sessionContentBlocks').withIndex('by_userId_and_sessionContentId_and_order', q => q.eq('userId', args.userId).eq('sessionContentId', content._id)).paginate({ cursor: args.cursor ?? null, numItems: BATCH_SIZE })
    for (const block of page.page) await ctx.db.patch(block._id, { content: undefined, claimOrdersJson: undefined })
    await ctx.scheduler.runAfter(0, internal.learnV2Retention.purgeContentCopies, { ...args, phase: page.isDone ? 'activities' : undefined, cursor: page.isDone ? undefined : page.continueCursor })
  },
})

async function redactActivityCopies(ctx: MutationCtx, activity: Doc<'learningThreadActivities'>) {
  await ctx.db.patch(activity._id, { submittedResponse: undefined, canonicalInputSnapshot: '[purged]', primitivePlan: [],
    purpose: 'Evidence unavailable', reasonText: undefined, feedbackProjection: undefined, recoveryFeedback: undefined,
    fallback: { ...activity.fallback, title: 'Evidence unavailable', body: '' },
    accessibilityMetadata: { ...activity.accessibilityMetadata, heading: 'Evidence unavailable', instructions: '' },
    decisionInputs: { ...activity.decisionInputs, sourceInputs: [] } })
  await ctx.scheduler.runAfter(0, internal.learnV2Retention.purgeAdaptiveCopies, { userId: activity.userId, threadId: activity.threadId, activityId: activity.activityId })
}

// Legacy diagnostics predate canonical reverse dependencies. Traverse exact
// owner pages, then exact thread pages, to erase their direct-scope copies.
export const purgeScopedActivityCopies = internalMutation({
  args: { userId: v.string(), source: v.union(v.object({ kind: v.literal('document'), id: v.id('documents') }), v.object({ kind: v.literal('folder'), id: v.id('folders') })),
    threadId: v.optional(v.id('learningThreads')), cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (args.threadId) {
      const thread = await ctx.db.get(args.threadId)
      if (!thread || thread.userId !== args.userId) return
      const page = await ctx.db.query('learningThreadActivities').withIndex('by_userId_and_threadId_and_boundaryOrdinal', q => q.eq('userId', args.userId).eq('threadId', thread._id)).paginate({ cursor: args.cursor ?? null, numItems: BATCH_SIZE })
      for (const activity of page.page) {
        if (activity.masteryAttemptId) {
          const attempt = await ctx.db.get(activity.masteryAttemptId)
          if (attempt?.userId === args.userId) await redactLegacyAttempt(ctx, attempt)
        }
        for (const target of await activityResponseTargets(ctx, args.userId, activity) ?? []) {
          const response = target.submissionId && await ctx.db.get(target.submissionId)
          if (response?.userId === args.userId && response.bodyAvailability !== 'purged') {
            await ctx.scheduler.runAfter(0, internal.learnV2Retention.purgeResponseCopies, { userId: args.userId, submissionId: response._id })
          }
        }
        await redactActivityCopies(ctx, activity)
      }
      if (!page.isDone) await ctx.scheduler.runAfter(0, internal.learnV2Retention.purgeScopedActivityCopies, { ...args, cursor: page.continueCursor })
      return
    }
    const page = await ctx.db.query('learningThreads').withIndex('by_userId', q => q.eq('userId', args.userId)).paginate({ cursor: args.cursor ?? null, numItems: BATCH_SIZE })
    for (const thread of page.page) if (thread.sourceScope.kind === args.source.kind && thread.sourceScope.sourceId === args.source.id) {
      await ctx.scheduler.runAfter(0, internal.learnV2Retention.purgeScopedActivityCopies, { ...args, threadId: thread._id, cursor: undefined })
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.learnV2Retention.purgeScopedActivityCopies, { ...args, cursor: page.continueCursor })
  },
})

async function invalidateLinkedAdaptiveActivities(
  ctx: MutationCtx,
  userId: string,
  sourceSnapshotId: Id<'learnSourceSnapshots'>,
  reason: 'access_lost' | 'policy_denied' | 'source_deleted',
) {
  const links = await ctx.db.query('learnActivityEvidenceLinks')
    .withIndex('by_userId_and_sourceSnapshotId_and_invalidatedAt', q => q.eq('userId', userId).eq('sourceSnapshotId', sourceSnapshotId).eq('invalidatedAt', undefined))
    .take(BATCH_SIZE)
  const now = Date.now()
  for (const link of links) {
    const [activity, thread] = await Promise.all([ctx.db.get(link.activityId), ctx.db.get(link.threadId)])
    if (activity && thread && activity.userId === userId && activity.threadId === thread._id && thread.userId === userId) {
      await redactActivityCopies(ctx, activity)
      const current = thread.currentActivityId === activity._id && activity.status !== 'ended' && activity.status !== 'replaced'
      const common = {
        userId,
        threadId: thread._id,
        activityId: activity._id,
        sourceVersion: 'learn-v2.evidence-purge.v1',
        contractVersion: activity.contractVersion,
        occurredAt: now,
        metadata: { activityClass: activity.activityClass, boundaryOrdinal: activity.boundaryOrdinal, planRevision: activity.planRevision },
      }
      // The link id participates only in the writer's hash. It is never
      // persisted in event metadata or exposed through export.
      await writeLearnActivityEvent(ctx, { ...common, eventType: 'evidence_invalidation', eventVersion: 'evidence_invalidation.v1', semanticKey: `activity:${activity.activityId}:evidence:${String(link._id)}:invalidation`, reasonCode: reason, outcomeCode: current ? 'blocked' : 'historical' })
      await writeLearnActivityEvent(ctx, { ...common, eventType: 'evidence_gap', eventVersion: 'evidence_gap.v1', semanticKey: `activity:${activity.activityId}:evidence:${String(link._id)}:gap`, reasonCode: 'required_support_unavailable', outcomeCode: current ? 'blocked' : 'historical' })
      if (current && (activity.status !== 'blocked' || thread.evidenceState !== 'invalidated')) {
        await ctx.db.patch(activity._id, { status: 'blocked', updatedAt: now })
        await ctx.db.patch(thread._id, { evidenceState: 'invalidated',
          unresolvedPoint: (thread.unresolvedPoint ?? thread.originalNeed).slice(0, 240),
          nextAction: { kind: 'recover', label: 'Review your Void', reasonCode: 'source_invalidated', activityId: activity.activityId },
          revision: thread.revision + 1, updatedAt: now })
      }
    }
    await ctx.db.patch(link._id, { invalidatedAt: now })
  }
  return links.length > 0
}

export const purgeAdaptiveCopies = internalMutation({
  args: { userId: v.string(), threadId: v.id('learningThreads'), activityId: v.string(), phase: v.optional(v.literal('receipts')), cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (!args.phase) {
      const page = await ctx.db.query('learnActivityDecisions').withIndex('by_userId_and_activityId_and_createdAt', q => q.eq('userId', args.userId).eq('activityId', args.activityId)).paginate({ cursor: args.cursor ?? null, numItems: BATCH_SIZE })
      for (const decision of page.page) await ctx.db.patch(decision._id, { inputSnapshot: '[purged]' })
      await ctx.scheduler.runAfter(0, internal.learnV2Retention.purgeAdaptiveCopies, { ...args, phase: page.isDone ? 'receipts' : undefined, cursor: page.isDone ? undefined : page.continueCursor })
      return
    }
    const page = await ctx.db.query('learnActivityCommandReceipts').withIndex('by_userId_and_threadId', q => q.eq('userId', args.userId).eq('threadId', args.threadId)).paginate({ cursor: args.cursor ?? null, numItems: BATCH_SIZE })
    for (const receipt of page.page) {
      // A body-free denial remains the command's result until its original
      // deadline. Clear arbitrary cached results and every error alias.
      const now = Date.now()
      await ctx.db.patch(receipt._id, retainsSafeAdaptiveRejection(receipt, now)
        ? { errorReference: null }
        : { resultReference: null, errorReference: null, resultRedactedAt: now, redactionStatus: 'redacted' })
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.learnV2Retention.purgeAdaptiveCopies, { ...args, cursor: page.continueCursor })
  },
})

async function removeRows<TableName extends TableNames>(ctx: MutationCtx, rows: Doc<TableName>[]) {
  for (const row of rows) await ctx.db.delete(row._id)
  return rows.length
}

async function deleteVoidFoundation(ctx: MutationCtx, userId: string, learningVoidId: Id<'learningVoids'>) {
  if (await deleteMeasurementVoidBatch(ctx, userId, learningVoidId)) return true

  const reservations = await ctx.db.query('searchReservations')
    .withIndex('by_userId_and_learningVoidId', q => q
      .eq('userId', userId)
      .eq('learningVoidId', learningVoidId))
    .take(BATCH_SIZE)
  for (const reservation of reservations) {
    const now = Date.now()
    if (reservation.status === 'reserved' && reservation.dispatchState === 'not_started') {
      await releaseSearchReservationClaims(ctx, reservation, now)
      await ctx.db.patch(reservation._id, {
        learningVoidId: undefined,
        status: 'released',
        outcomeCode: 'void_deleted_before_dispatch',
        settledAt: now,
        updatedAt: now,
        revision: reservation.revision + 1,
      })
    }
    else {
      await ctx.db.patch(reservation._id, {
        learningVoidId: undefined,
        updatedAt: now,
      })
    }
  }
  if (reservations.length > 0) return true

  const voidBuckets = await ctx.db.query('searchQuotaBuckets')
    .withIndex('by_userId_and_learningVoidId_and_periodKey', q => q
      .eq('userId', userId)
      .eq('learningVoidId', learningVoidId))
    .take(BATCH_SIZE)
  for (const bucket of voidBuckets) {
    await ctx.db.patch(bucket._id, {
      learningVoidId: undefined,
      revision: bucket.revision + 1,
      updatedAt: Date.now(),
    })
  }
  if (voidBuckets.length > 0) return true

  const manifests = await ctx.db.query('learnFolderSourceManifests')
    .withIndex('by_userId_and_learningVoidId', q => q.eq('userId', userId).eq('learningVoidId', learningVoidId)).take(BATCH_SIZE)
  for (const manifest of manifests) {
    const entries = await ctx.db.query('learnFolderSourceManifestEntries')
      .withIndex('by_userId_and_manifestId_and_order', q => q.eq('userId', userId).eq('manifestId', manifest._id)).take(BATCH_SIZE)
    if (await removeRows(ctx, entries)) return true
    const folders = await ctx.db.query('learnFolderSourceManifestFolders')
      .withIndex('by_userId_and_manifestId_and_order', q => q.eq('userId', userId).eq('manifestId', manifest._id)).take(BATCH_SIZE)
    if (await removeRows(ctx, folders)) return true
    await ctx.db.delete(manifest._id)
    return true
  }
  const sourceReceipts = await ctx.db.query('learnSourceCommandReceipts')
    .withIndex('by_userId_and_learningVoidId', q => q.eq('userId', userId).eq('learningVoidId', learningVoidId)).take(BATCH_SIZE)
  if (await removeRows(ctx, sourceReceipts)) return true
  const leases = await ctx.db.query('learnSourceFetchLeases')
    .withIndex('by_userId_and_learningVoidId', q => q.eq('userId', userId).eq('learningVoidId', learningVoidId)).take(BATCH_SIZE)
  if (await removeRows(ctx, leases)) return true
  // Rolling admission history is owner-scoped, not resource-owned. Preserve
  // unexpired events when a source, document, folder, or Void is deleted so
  // resource recreation cannot reset the owner's rate limit. Admission cleanup
  // removes expired rows; account deletion remains the only eager owner purge.
  const snapshots = await ctx.db.query('learnSourceSnapshots')
    .withIndex('by_userId_and_learningVoidId_and_status', q => q.eq('userId', userId).eq('learningVoidId', learningVoidId)).take(BATCH_SIZE)
  for (const snapshot of snapshots) {
    if (await invalidateLinkedAdaptiveActivities(ctx, userId, snapshot._id, 'source_deleted')) return true
    const objectiveSources = await ctx.db.query('learnObjectiveSources')
      .withIndex('by_userId_and_sourceSnapshotId', q => q.eq('userId', userId).eq('sourceSnapshotId', snapshot._id)).take(BATCH_SIZE)
    if (await removeRows(ctx, objectiveSources)) return true
    const excerpts = await ctx.db.query('learnSourceExcerpts')
      .withIndex('by_userId_and_sourceSnapshotId', q => q.eq('userId', userId).eq('sourceSnapshotId', snapshot._id)).take(BATCH_SIZE)
    for (const excerpt of excerpts) {
      const supports = await ctx.db.query('learnClaimSupports')
        .withIndex('by_userId_and_sourceExcerptId', q => q.eq('userId', userId).eq('sourceExcerptId', excerpt._id)).take(BATCH_SIZE)
      if (await removeRows(ctx, supports)) return true
      await ctx.db.delete(excerpt._id)
      return true
    }
    await ctx.db.delete(snapshot._id)
    return true
  }
  const identities = await ctx.db.query('learnSourceIdentities')
    .withIndex('by_userId_and_learningVoidId', q => q.eq('userId', userId).eq('learningVoidId', learningVoidId)).take(BATCH_SIZE)
  if (await removeRows(ctx, identities)) return true

  // Generation jobs are Void-owned operational children. Remove them before
  // Blueprint/Void parents so a deleted folder cannot leave a queued worker or
  // retain its revision and candidate digests indefinitely.
  const jobs = await ctx.db.query('learnJobs')
    .withIndex('by_userId_and_learningVoidId_and_type', q => q
      .eq('userId', userId).eq('learningVoidId', learningVoidId))
    .take(BATCH_SIZE)
  if (await removeRows(ctx, jobs)) return true

  const planAudits = await ctx.db.query('learnPlanAuditEvents')
    .withIndex('by_userId_and_learningVoidId', q => q.eq('userId', userId).eq('learningVoidId', learningVoidId)).take(BATCH_SIZE)
  if (await removeRows(ctx, planAudits)) return true
  const planReceipts = await ctx.db.query('learnPlanCommandReceipts')
    .withIndex('by_userId_and_learningVoidId', q => q.eq('userId', userId).eq('learningVoidId', learningVoidId)).take(BATCH_SIZE)
  if (await removeRows(ctx, planReceipts)) return true

  const plans = await ctx.db.query('studyPlans')
    .withIndex('by_userId_and_learningVoidId', q => q.eq('userId', userId).eq('learningVoidId', learningVoidId)).take(BATCH_SIZE)
  for (const plan of plans) {
    const planRevisions = await ctx.db.query('studyPlanRevisions')
      .withIndex('by_userId_and_studyPlanId_and_revision', q => q.eq('userId', userId).eq('studyPlanId', plan._id)).take(BATCH_SIZE)
    for (const planRevision of planRevisions) {
      const sessions = await ctx.db.query('studySessions')
        .withIndex('by_userId_and_studyPlanRevisionId_and_scheduledStartAt', q => q.eq('userId', userId).eq('studyPlanRevisionId', planRevision._id)).take(BATCH_SIZE)
      for (const session of sessions) {
        const retrievalObjectives = await ctx.db.query('studySessionRetrievalObjectives')
          .withIndex('by_userId_and_studySessionId_and_order', q => q.eq('userId', userId).eq('studySessionId', session._id)).take(BATCH_SIZE)
        if (await removeRows(ctx, retrievalObjectives)) return true
        const projections = await ctx.db.query('calendarProjections')
          .withIndex('by_userId_and_studySessionId', q => q.eq('userId', userId).eq('studySessionId', session._id)).take(BATCH_SIZE)
        for (const projection of projections) {
          const proposals = await ctx.db.query('calendarReconciliationProposals')
            .withIndex('by_projectionId_and_status', q => q.eq('projectionId', projection._id).eq('status', 'open')).take(BATCH_SIZE)
          if (await removeRows(ctx, proposals)) return true
          const rejected = await ctx.db.query('calendarReconciliationProposals')
            .withIndex('by_projectionId_and_status', q => q.eq('projectionId', projection._id).eq('status', 'rejected')).take(BATCH_SIZE)
          if (await removeRows(ctx, rejected)) return true
          const expired = await ctx.db.query('calendarReconciliationProposals')
            .withIndex('by_projectionId_and_status', q => q.eq('projectionId', projection._id).eq('status', 'expired')).take(BATCH_SIZE)
          if (await removeRows(ctx, expired)) return true
        }
        if (await removeRows(ctx, projections)) return true
        const contents = await ctx.db.query('sessionContent')
          .withIndex('by_userId_and_studySessionId_and_revision', q => q.eq('userId', userId).eq('studySessionId', session._id)).take(BATCH_SIZE)
        for (const content of contents) {
          const blocks = await ctx.db.query('sessionContentBlocks')
            .withIndex('by_userId_and_sessionContentId_and_order', q => q.eq('userId', userId).eq('sessionContentId', content._id)).take(BATCH_SIZE)
          if (await removeRows(ctx, blocks)) return true
          const claims = await ctx.db.query('sessionContentClaims')
            .withIndex('by_userId_and_sessionContentId_and_order', q => q.eq('userId', userId).eq('sessionContentId', content._id)).take(BATCH_SIZE)
          for (const claim of claims) {
            const supports = await ctx.db.query('learnClaimSupports')
              .withIndex('by_userId_and_sessionContentClaimId', q => q.eq('userId', userId).eq('sessionContentClaimId', claim._id)).take(BATCH_SIZE)
            if (await removeRows(ctx, supports)) return true
            await ctx.db.delete(claim._id)
            return true
          }
          await ctx.db.delete(content._id)
          return true
        }
        await ctx.db.delete(session._id)
        return true
      }
      await ctx.db.delete(planRevision._id)
      return true
    }
    await ctx.db.delete(plan._id)
    return true
  }

  const blueprintRevisions = await ctx.db.query('learnBlueprintRevisions')
    .withIndex('by_userId_and_learningVoidId', q => q.eq('userId', userId).eq('learningVoidId', learningVoidId)).take(BATCH_SIZE)
  for (const revision of blueprintRevisions) {
    const prerequisites = await ctx.db.query('learnObjectivePrerequisites')
      .withIndex('by_userId_and_blueprintRevisionId_and_objectiveId', q => q.eq('userId', userId).eq('blueprintRevisionId', revision._id)).take(BATCH_SIZE)
    if (await removeRows(ctx, prerequisites)) return true
    const milestones = await ctx.db.query('learnMilestones')
      .withIndex('by_userId_and_blueprintRevisionId_and_order', q => q.eq('userId', userId).eq('blueprintRevisionId', revision._id)).take(BATCH_SIZE)
    if (await removeRows(ctx, milestones)) return true
    const objectives = await ctx.db.query('learnObjectives')
      .withIndex('by_userId_and_blueprintRevisionId_and_order', q => q.eq('userId', userId).eq('blueprintRevisionId', revision._id)).take(BATCH_SIZE)
    for (const objective of objectives) {
      const objectiveSources = await ctx.db.query('learnObjectiveSources')
        .withIndex('by_userId_and_objectiveId_and_sourceSnapshotId', q => q.eq('userId', userId).eq('objectiveId', objective._id)).take(BATCH_SIZE)
      if (await removeRows(ctx, objectiveSources)) return true
      const attempts = await ctx.db.query('masteryAttempts')
        .withIndex('by_userId_blueprintRevisionId_objectiveId_attemptedAt', q => q.eq('userId', userId).eq('blueprintRevisionId', revision._id).eq('objectiveId', objective._id)).take(BATCH_SIZE)
      if (await removeRows(ctx, attempts)) return true
      const legacyAttempts = await ctx.db.query('masteryAttempts')
        .withIndex('by_userId_blueprintRevisionId_objectiveId_attemptedAt', q => q.eq('userId', userId).eq('blueprintRevisionId', undefined).eq('objectiveId', objective._id)).take(BATCH_SIZE)
      if (await removeRows(ctx, legacyAttempts)) return true
      const records = await ctx.db.query('masteryRecords')
        .withIndex('by_userId_and_blueprintRevisionId_and_objectiveId', q => q.eq('userId', userId).eq('blueprintRevisionId', revision._id).eq('objectiveId', objective._id)).take(BATCH_SIZE)
      if (await removeRows(ctx, records)) return true
      const legacyRecords = await ctx.db.query('masteryRecords')
        .withIndex('by_userId_and_blueprintRevisionId_and_objectiveId', q => q.eq('userId', userId).eq('blueprintRevisionId', undefined).eq('objectiveId', objective._id)).take(BATCH_SIZE)
      if (await removeRows(ctx, legacyRecords)) return true
      await ctx.db.delete(objective._id)
      return true
    }
    await ctx.db.delete(revision._id)
    return true
  }
  const receipts = await ctx.db.query('learnLifecycleReceipts')
    .withIndex('by_userId_and_learningVoidId', q => q.eq('userId', userId).eq('learningVoidId', learningVoidId)).take(BATCH_SIZE)
  if (await removeRows(ctx, receipts)) return true
  const blueprints = await ctx.db.query('learnBlueprints')
    .withIndex('by_userId_and_learningVoidId', q => q.eq('userId', userId).eq('learningVoidId', learningVoidId)).take(BATCH_SIZE)
  if (await removeRows(ctx, blueprints)) return true
  await ctx.db.delete(learningVoidId)
  return true
}

export const deleteFolderFoundation = internalMutation({
  args: { userId: v.string(), folderId: v.id('folders') },
  handler: async (ctx, args) => {
    const voids = await ctx.db.query('learningVoids')
      .withIndex('by_userId_and_folderId', q => q.eq('userId', args.userId).eq('folderId', args.folderId)).take(BATCH_SIZE)
    for (const learningVoid of voids) {
      if (learningVoid.userId !== args.userId) throw new Error('Learning Void cleanup ownership mismatch')
      const threads = await ctx.db.query('learningThreads')
        .withIndex('by_userId_and_learningVoidId_and_authorityKind', q => q.eq('userId', args.userId)
          .eq('learningVoidId', learningVoid._id).eq('authorityKind', 'v2_mission'))
        .take(BATCH_SIZE)
      if (threads.length > 0) {
        // Preserve the existing AD-17 invalidation transition before draining
        // the adaptive graph. The exact thread/link indexes keep this bounded.
        for (const thread of threads) {
          const links = await ctx.db.query('learnActivityEvidenceLinks')
            .withIndex('by_userId_and_threadId_and_invalidatedAt', q => q.eq('userId', args.userId)
              .eq('threadId', thread._id).eq('invalidatedAt', undefined)).take(BATCH_SIZE)
          for (const link of links) {
            const snapshot = await ctx.db.get(link.sourceSnapshotId)
            if (snapshot?.userId === args.userId && snapshot.learningVoidId === learningVoid._id
              && await invalidateLinkedAdaptiveActivities(ctx, args.userId, snapshot._id, 'source_deleted')) {
              await ctx.scheduler.runAfter(0, internal.learnV2Retention.deleteFolderFoundation, args)
              return { deleted: 0, hasMore: true }
            }
          }
        }
        for (const thread of threads) await initiateAdaptiveThreadDeletion(ctx, args.userId, thread._id)
        // The thread worker owns child-first R2 cleanup; the Void remains
        // authoritative until every exact owner-and-Void thread is gone.
        await ctx.scheduler.runAfter(60_000, internal.learnV2Retention.deleteFolderFoundation, args)
        return { deleted: 0, hasMore: true }
      }
      await deleteVoidFoundation(ctx, args.userId, learningVoid._id)
      await ctx.scheduler.runAfter(0, internal.learnV2Retention.deleteFolderFoundation, args)
      return { deleted: 1, hasMore: true }
    }
    await ctx.scheduler.runAfter(0, internal.learnV2Retention.purgeScopedActivityCopies, { userId: args.userId, source: { kind: 'folder', id: args.folderId } })
    return { deleted: 0, hasMore: false }
  },
})

async function purgeExcerpt(ctx: MutationCtx, excerpt: Doc<'learnSourceExcerpts'>) {
  if (await purgeResponseSourceBatch(ctx, excerpt.userId, { kind: 'excerpt', id: excerpt._id })) return true

  const supportsWithoutStatus = await ctx.db.query('learnClaimSupports')
    .withIndex('by_userId_and_sourceExcerptId_and_evidenceStatus', q => q
      .eq('userId', excerpt.userId).eq('sourceExcerptId', excerpt._id).eq('evidenceStatus', undefined))
    .take(BATCH_SIZE)
  const availableSupports = supportsWithoutStatus.length === BATCH_SIZE
    ? []
    : await ctx.db.query('learnClaimSupports')
      .withIndex('by_userId_and_sourceExcerptId_and_evidenceStatus', q => q
        .eq('userId', excerpt.userId).eq('sourceExcerptId', excerpt._id).eq('evidenceStatus', 'evidence_available'))
      .take(BATCH_SIZE - supportsWithoutStatus.length)
  const supports = [...supportsWithoutStatus, ...availableSupports]
  for (const support of supports) {
    const claim = await ctx.db.get(support.sessionContentClaimId)
    if (claim?.userId === excerpt.userId) {
      await ctx.scheduler.runAfter(0, internal.learnV2Retention.purgeContentCopies, { userId: excerpt.userId, sessionContentId: claim.sessionContentId })
      await ctx.db.patch(claim._id, { claim: '[purged]' })
    }
    await ctx.db.patch(support._id, { evidenceStatus: 'evidence_unavailable' })
  }
  if (supports.length === BATCH_SIZE) return true
  const locator = sanitizePublicSourceLocator(excerpt.locator) ?? 'source-unavailable'
  await ctx.db.patch(excerpt._id, { locator, excerpt: undefined, privateLocator: undefined, evidencePurgedAt: Date.now() })
  return false
}

// Source writers must invoke this internal continuation atomically with their
// source/access deletion command. It makes evidence unavailable without
// deleting mastery attempts or their historical outcome.
export const purgeSourceEvidence = internalMutation({
  args: {
    userId: v.string(),
    sourceIdentityId: v.id('learnSourceIdentities'),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.db.get(args.sourceIdentityId)
    // Snapshot ownership is the cleanup authority. A denormalized identity can
    // already be absent (or even point at a foreign row after damaged legacy
    // state); neither condition may strand this owner's protected descendants.
    if (identity?.userId === args.userId) {
      await ctx.db.patch(identity._id, {
        ...(identity.origin === 'user_url'
          ? { externalKey: await tombstonedSourceExternalKey(String(identity._id)) }
          : {}),
        canonicalUrl: undefined,
        title: undefined,
        publicLocator: undefined,
        privateLocator: undefined,
        tombstonedAt: Date.now(),
      })
    }
    const reason = args.reason === 'access_lost' || args.reason === 'policy_denied'
      ? args.reason
      : 'source_deleted'
    const entries = await ctx.db.query('learnFolderSourceManifestEntries')
      .withIndex('by_userId_and_sourceIdentityId_and_evidencePurgedAt', q => q
        .eq('userId', args.userId).eq('sourceIdentityId', args.sourceIdentityId).eq('evidencePurgedAt', undefined))
      .take(BATCH_SIZE)
    for (const entry of entries) {
      if (entry.availability === 'available') {
        const manifest = await ctx.db.get(entry.manifestId)
        if (manifest) {
          const availableCount = Math.max(0, manifest.availableCount - 1)
          const unavailableCount = manifest.unavailableCount + 1
          await ctx.db.patch(manifest._id, {
            availableCount,
            unavailableCount,
            coverage: availableCount === 0 ? 'gap' : 'partial',
            recordRevision: incrementRecordRevision(manifest.recordRevision),
          })
        }
      }
      await ctx.db.patch(entry._id, {
        documentId: undefined,
        folderId: undefined,
        availability: 'unavailable',
        unavailableReason: reason,
        evidencePurgedAt: Date.now(),
      })
    }
    if (entries.length > 0) {
      await ctx.scheduler.runAfter(0, internal.learnV2Retention.purgeSourceEvidence, args)
      return { pending: true }
    }
    const snapshots = await ctx.db.query('learnSourceSnapshots')
      .withIndex('by_userId_and_sourceIdentityId_and_evidencePurgedAt', q => q
        .eq('userId', args.userId).eq('sourceIdentityId', args.sourceIdentityId).eq('evidencePurgedAt', undefined))
      .take(BATCH_SIZE)
    for (const snapshot of snapshots) {
      if (await purgeResponseSourceBatch(ctx, args.userId, { kind: 'snapshot', id: snapshot._id })) {
        await ctx.scheduler.runAfter(0, internal.learnV2Retention.purgeSourceEvidence, args)
        return { pending: true }
      }
      const contributions = await ctx.db.query('learningThreadContributions')
        .withIndex('by_userId_and_evidenceSnapshotId', q => q.eq('userId', args.userId).eq('evidenceSnapshotId', snapshot._id))
        .take(BATCH_SIZE)
      for (const contribution of contributions) await ctx.db.patch(contribution._id, {
        sourceIdentity: '[purged]', sourceRevision: '[purged]', evidenceSnapshotId: undefined,
        metadata: {}, sourceStatus: 'source_unavailable',
      })
      if (contributions.length > 0) {
        await ctx.scheduler.runAfter(0, internal.learnV2Retention.purgeSourceEvidence, args)
        return { pending: true }
      }
      if (await invalidateLinkedAdaptiveActivities(ctx, args.userId, snapshot._id, reason)) {
        await ctx.scheduler.runAfter(0, internal.learnV2Retention.purgeSourceEvidence, args)
        return { pending: true }
      }
      const leases = await ctx.db.query('learnSourceFetchLeases')
        .withIndex('by_userId_and_sourceSnapshotId_and_expiresAt', q => q
          .eq('userId', args.userId).eq('sourceSnapshotId', snapshot._id))
        .take(BATCH_SIZE)
      if (await removeRows(ctx, leases)) {
        await ctx.scheduler.runAfter(0, internal.learnV2Retention.purgeSourceEvidence, args)
        return { pending: true }
      }
      await ctx.scheduler.runAfter(0, internal.learnV2Retention.purgeLegacySourceCopies, { userId: args.userId, sourceSnapshotId: snapshot._id })
      // Owner rate history deliberately survives source tombstoning. Otherwise
      // deleting and re-registering the same URL would reset admission limits.
      const excerpts = await ctx.db.query('learnSourceExcerpts')
        .withIndex('by_userId_and_sourceSnapshotId_and_evidencePurgedAt', q => q
          .eq('userId', args.userId).eq('sourceSnapshotId', snapshot._id).eq('evidencePurgedAt', undefined))
        .take(BATCH_SIZE)
      for (const excerpt of excerpts) {
        if (await purgeExcerpt(ctx, excerpt)) {
          await ctx.scheduler.runAfter(0, internal.learnV2Retention.purgeSourceEvidence, args)
          return { pending: true }
        }
      }
      if (excerpts.length === BATCH_SIZE) {
        await ctx.scheduler.runAfter(0, internal.learnV2Retention.purgeSourceEvidence, args)
        return { pending: true }
      }
      const alreadyAuthoritativelyUnavailable = snapshot.effectiveStatus === 'unavailable'
        && snapshot.unavailableReason !== undefined
      const publicLocator = sanitizePublicSourceLocator(snapshot.publicLocator)
      await ctx.db.patch(snapshot._id, {
        status: ['user_accepted', 'rejected'].includes(snapshot.status) ? snapshot.status : 'unavailable',
        effectiveStatus: 'unavailable',
        unavailableReason: snapshot.unavailableReason ?? reason,
        publicLocator,
        // markUnavailable already advanced and sealed the authoritative
        // revision. Its scheduled byte purge must not make that receipt stale.
        ...(alreadyAuthoritativelyUnavailable
          ? {}
          : { recordRevision: incrementRecordRevision(snapshot.recordRevision), updatedAt: Date.now() }),
        objectKey: undefined,
        folderId: undefined,
        filename: undefined,
        privateLocator: undefined,
        evidencePurgedAt: Date.now(),
      })
      await ctx.scheduler.runAfter(0, internal.learnV2Retention.purgeSourceEvidence, args)
      return { pending: true }
    }
    return { pending: false }
  },
})

export const purgeFolderDocumentSources = internalMutation({
  args: { userId: v.string(), documentId: v.id('documents') },
  handler: async (ctx, args) => {
    if (await purgeResponseSourceBatch(ctx, args.userId, { kind: 'document', id: args.documentId })) {
      await ctx.scheduler.runAfter(0, internal.learnV2Retention.purgeFolderDocumentSources, args)
      return { pending: true }
    }
    const contributions = await ctx.db.query('learningThreadContributions')
      .withIndex('by_userId_and_sourceFeature_and_sourceIdentity_and_sourceStatus', q => q
        .eq('userId', args.userId).eq('sourceFeature', 'documents').eq('sourceIdentity', String(args.documentId)).eq('sourceStatus', 'available'))
      .take(BATCH_SIZE)
    for (const contribution of contributions) await ctx.db.patch(contribution._id, {
      sourceIdentity: '[purged]', sourceRevision: '[purged]', evidenceSnapshotId: undefined,
      metadata: {}, sourceStatus: 'source_unavailable',
    })
    if (contributions.length > 0) {
      await ctx.scheduler.runAfter(0, internal.learnV2Retention.purgeFolderDocumentSources, args)
      return { pending: true }
    }
    const identities = await ctx.db.query('learnSourceIdentities')
      .withIndex('by_userId_and_folderDocumentId', q => q
        .eq('userId', args.userId).eq('folderDocumentId', args.documentId))
      .take(BATCH_SIZE)
    for (const identity of identities) {
      await ctx.db.patch(identity._id, {
        externalKey: `deleted:${identity._id}`,
        canonicalUrl: undefined,
        publicLocator: undefined,
        privateLocator: undefined,
        folderDocumentId: undefined,
        title: undefined,
        tombstonedAt: Date.now(),
      })
      await ctx.scheduler.runAfter(0, internal.learnV2Retention.purgeSourceEvidence, {
        userId: args.userId,
        sourceIdentityId: identity._id,
      })
    }
    if (identities.length === BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.learnV2Retention.purgeFolderDocumentSources, args)
      return { pending: true }
    }
    await ctx.scheduler.runAfter(0, internal.learnV2Retention.purgeScopedActivityCopies, { userId: args.userId, source: { kind: 'document', id: args.documentId } })
    return { pending: identities.length > 0 }
  },
})

export const purgeFolderDocumentManifestHeaders = internalMutation({
  args: {
    userId: v.string(),
    documentId: v.id('documents'),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const page = await ctx.db.query('learnFolderSourceManifests')
      .withIndex('by_userId', q => q.eq('userId', args.userId))
      .paginate({ cursor: args.cursor ?? null, numItems: BATCH_SIZE })
    for (const manifest of page.page) {
      const explicitDocumentIds = manifest.explicitDocumentIds.filter(id => id !== args.documentId)
      if (explicitDocumentIds.length !== manifest.explicitDocumentIds.length) {
        await ctx.db.patch(manifest._id, manifest.status === 'capturing'
          ? {
              status: 'failed',
              coverage: manifest.coverage === 'empty' ? 'gap' : manifest.coverage,
              failureReason: 'Selected document was deleted during source capture',
              explicitDocumentIds: [],
              explicitDocumentCursor: 0,
              recordRevision: incrementRecordRevision(manifest.recordRevision),
            }
          : { explicitDocumentIds })
      }
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.learnV2Retention.purgeFolderDocumentManifestHeaders, {
        ...args,
        cursor: page.continueCursor,
      })
      return { pending: true }
    }
    return { pending: false }
  },
})

export const purgeFolderManifestFolder = internalMutation({
  args: { userId: v.string(), folderId: v.id('folders') },
  handler: async (ctx, args) => {
    if (await purgeResponseSourceBatch(ctx, args.userId, { kind: 'folder', id: args.folderId })) {
      await ctx.scheduler.runAfter(0, internal.learnV2Retention.purgeFolderManifestFolder, args)
      return { pending: true }
    }
    const folders = await ctx.db.query('learnFolderSourceManifestFolders')
      .withIndex('by_userId_and_folderId_and_evidencePurgedAt', q => q
        .eq('userId', args.userId).eq('folderId', args.folderId).eq('evidencePurgedAt', undefined))
      .take(BATCH_SIZE)
    for (const folder of folders) {
      await ctx.db.patch(folder._id, {
        folderId: undefined,
        parentFolderId: undefined,
        name: undefined,
        evidencePurgedAt: Date.now(),
      })
    }
    if (folders.length === BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.learnV2Retention.purgeFolderManifestFolder, args)
      return { pending: true }
    }
    return { pending: folders.length > 0 }
  },
})
