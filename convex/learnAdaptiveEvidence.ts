import { v } from 'convex/values'
import { internalQuery, query, type QueryCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { requireAdaptiveQueryAccess } from './lib/adaptiveLearnAccess'
import { loadAdaptiveClaimProjection } from './lib/adaptiveClaimProjection'
import { liveEvidenceState } from './learnAdaptiveRecovery'
import type { AdaptiveEvidenceIntegrityState } from '../shared/adaptive-claim-adapter'
import { canReadActivityTeaching, disclosureLiterals } from './lib/learnV2AssessmentDisclosure'
import { sanitizePublicSourceLocator } from './lib/learnV2SourceSanitization'

const integrity = disclosureLiterals(['accepted', 'insufficient', 'conflicting', 'stale', 'deleted', 'unavailable'])
const evidenceFields = {
  kind: disclosureLiterals(['factual', 'non_factual']), activityId: v.string(),
  eligibility: disclosureLiterals(['historical', 'not_applicable', 'blocked', 'eligible']), readOnly: v.boolean(),
  integrityState: v.union(integrity, v.null()), claims: v.array(v.object({
    claimId: v.string(), claimText: v.union(v.string(), v.null()),
    claimStatus: disclosureLiterals(['fact', 'synthesis', 'inference', 'unknown']), integrityState: integrity,
    source: v.object({ origin: v.union(disclosureLiterals(['folder_document', 'user_url', 'open_database', 'general_web_search']), v.null()),
      locator: v.union(v.string(), v.null()), sourceSnapshotId: v.string(), sourceSnapshotRevision: v.number(), sourceRecordRevision: v.number() }),
  })),
}

// Both internal consumers and the drawer use this single owner-scoped
// projection; the public wrapper additionally binds the selected thread.
async function readActivityEvidence(ctx: QueryCtx, userId: string, activityId: string, expectedThreadId?: Id<'learningThreads'>) {
  const activity = await ctx.db.query('learningThreadActivities')
    .withIndex('by_userId_and_activityId', q => q.eq('userId', userId).eq('activityId', activityId))
    .unique()
  if (!activity || (expectedThreadId && activity.threadId !== expectedThreadId)) return null

  const thread = await ctx.db.get(activity.threadId)
  if (!thread || thread.userId !== userId || thread.deletionStartedAt !== undefined) return null
  const historical = thread.currentActivityId !== activity._id
    || activity.status === 'replaced'
    || activity.status === 'ended'
  const sourceState = expectedThreadId && activity.activityClass === 'factual'
    ? await liveEvidenceState(ctx, thread) : 'ready'

  if (activity.activityClass === 'non_factual') {
    return {
      kind: 'non_factual' as const,
      activityId: activity.activityId,
      eligibility: historical ? 'historical' as const : 'not_applicable' as const,
      readOnly: historical,
      integrityState: null,
      claims: [],
    }
  }

  if (!await canReadActivityTeaching(ctx, thread, activity)) return {
    kind: 'factual' as const, activityId: activity.activityId, eligibility: historical ? 'historical' as const : 'blocked' as const,
    readOnly: historical, integrityState: 'unavailable' as const, claims: [],
  }

  if (!activity.sessionContentId
    || activity.generationInputs.sessionContentRevision === null
    || activity.evidenceReferences.length < 1
    || activity.evidenceReferences.length > 16) {
    return {
      kind: 'factual' as const,
      activityId: activity.activityId,
      eligibility: historical ? 'historical' as const : 'blocked' as const,
      readOnly: historical,
      integrityState: 'insufficient' as const,
      claims: [],
    }
  }

  const { claims, integrityState } = await loadAdaptiveClaimProjection(ctx, {
    userId,
    historical,
    sessionContentId: activity.sessionContentId,
    sessionContentRevision: activity.generationInputs.sessionContentRevision,
    evidenceReferences: activity.evidenceReferences,
  })
  const statusAllowsEligibility = !['blocked', 'ended', 'replaced'].includes(activity.status)
  if (sourceState !== 'ready') {
    const sourceIntegrity: AdaptiveEvidenceIntegrityState = sourceState === 'invalidated' ? 'deleted'
      : sourceState === 'stale' || sourceState === 'unavailable' ? sourceState
        : sourceState === 'blocked' && integrityState !== 'accepted' ? integrityState : 'insufficient'
    const locatorUnavailable = sourceIntegrity === 'deleted' || sourceIntegrity === 'unavailable' || sourceIntegrity === 'insufficient'
    return {
      kind: 'factual' as const, activityId: activity.activityId, eligibility: historical ? 'historical' as const : 'blocked' as const,
      readOnly: historical, integrityState: sourceIntegrity,
      claims: claims.map(claim => ({ claimId: claim.claimId, claimText: null,
        integrityState: sourceIntegrity, claimStatus: 'unknown' as const,
        source: { origin: claim.source.origin, sourceSnapshotId: claim.source.sourceSnapshotId,
          sourceSnapshotRevision: claim.source.sourceSnapshotRevision, sourceRecordRevision: claim.source.sourceRecordRevision,
          locator: locatorUnavailable ? null : sanitizePublicSourceLocator(claim.source.locator ?? undefined) ?? null } })),
    }
  }

  return {
    kind: 'factual' as const,
    activityId: activity.activityId,
    eligibility: historical
      ? 'historical' as const
      : integrityState === 'accepted' && statusAllowsEligibility
        ? 'eligible' as const
        : 'blocked' as const,
    readOnly: historical,
    integrityState,
    claims: claims.map(claim => ({ claimId: claim.claimId,
      claimText: claim.integrityState === 'accepted' ? claim.claimText : null, claimStatus: claim.claimStatus, integrityState: claim.integrityState,
      source: { origin: claim.source.origin, sourceSnapshotId: claim.source.sourceSnapshotId,
        sourceSnapshotRevision: claim.source.sourceSnapshotRevision, sourceRecordRevision: claim.source.sourceRecordRevision,
        locator: claim.integrityState === 'accepted' ? sanitizePublicSourceLocator(claim.source.locator ?? undefined) ?? null : null } })),
  }
}

// The drawer reads this same owner-scoped projection with an explicit thread
// boundary. No raw evidence records or private locators cross the client seam.
export const getThreadActivityEvidence = query({
  args: { threadId: v.id('learningThreads'), activityId: v.string() },
  returns: v.union(v.object({ ...evidenceFields, ownerId: v.id('users'), threadId: v.id('learningThreads') }), v.null()),
  handler: async (ctx, args) => {
    const userId = await requireAdaptiveQueryAccess(ctx)
    const owner = await ctx.db.query('users')
      .withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', userId)).unique()
    if (!owner) return null
    const projection = await readActivityEvidence(ctx, userId, args.activityId, args.threadId)
    return projection ? { ...projection, ownerId: owner._id, threadId: args.threadId } : null
  },
})

export const getActivityEvidence = internalQuery({
  args: { activityId: v.string() },
  returns: v.union(v.object(evidenceFields), v.null()),
  handler: async (ctx, args) => {
    const userId = await requireAdaptiveQueryAccess(ctx)
    return await readActivityEvidence(ctx, userId, args.activityId)
  },
})
