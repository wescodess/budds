import { v } from 'convex/values'
import { query } from './_generated/server'
import { requireAuth } from './lib/auth'
import {
  projectAdaptiveClaimIntegrity,
  type AdaptiveEvidenceIntegrityState,
} from '../shared/adaptive-claim-adapter'

const INTEGRITY_PRIORITY: readonly AdaptiveEvidenceIntegrityState[] = [
  'deleted',
  'unavailable',
  'conflicting',
  'stale',
  'insufficient',
  'accepted',
]

function aggregateIntegrity(states: AdaptiveEvidenceIntegrityState[]): AdaptiveEvidenceIntegrityState {
  return INTEGRITY_PRIORITY.find(state => states.includes(state)) ?? 'insufficient'
}

export const getActivityEvidence = query({
  args: { activityId: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const activity = await ctx.db.query('learningThreadActivities')
      .withIndex('by_userId_and_activityId', q => q.eq('userId', userId).eq('activityId', args.activityId))
      .unique()
    if (!activity) return null

    const thread = await ctx.db.get(activity.threadId)
    if (!thread || thread.userId !== userId) return null
    const historical = thread.currentActivityId !== activity._id
      || activity.status === 'replaced'
      || activity.status === 'ended'

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

    const sessionContentId = activity.sessionContentId
    const sessionContentRevision = activity.generationInputs.sessionContentRevision
    const sessionContent = await ctx.db.get(sessionContentId)
    const claims = await Promise.all(activity.evidenceReferences.map(async (pinned) => {
      const [claim, support, snapshot] = await Promise.all([
        ctx.db.get(pinned.claimId),
        ctx.db.get(pinned.supportId),
        ctx.db.get(pinned.sourceSnapshotId),
      ])
      const excerpt = support ? await ctx.db.get(support.sourceExcerptId) : null
      const identity = snapshot ? await ctx.db.get(snapshot.sourceIdentityId) : null

      return projectAdaptiveClaimIntegrity({
        ownerId: userId,
        historical,
        sessionContentId: String(sessionContentId),
        sessionContentRevision,
        pinned: {
          claimId: String(pinned.claimId),
          supportId: String(pinned.supportId),
          sourceSnapshotId: String(pinned.sourceSnapshotId),
          sourceSnapshotRevision: pinned.sourceSnapshotRevision,
          sourceRecordRevision: pinned.sourceRecordRevision,
          sourceEffectiveStatus: pinned.sourceEffectiveStatus,
          verifierVersion: pinned.verifierVersion,
          integrityState: pinned.integrityState,
        },
        records: {
          sessionContent: sessionContent
            ? { id: String(sessionContent._id), userId: sessionContent.userId, revision: sessionContent.revision, status: sessionContent.status }
            : null,
          claim: claim
            ? { id: String(claim._id), userId: claim.userId, sessionContentId: String(claim.sessionContentId), claim: claim.claim, verifierVersion: claim.verifierVersion }
            : null,
          support: support
            ? { id: String(support._id), userId: support.userId, sessionContentClaimId: String(support.sessionContentClaimId), sourceExcerptId: String(support.sourceExcerptId), sourceSnapshotId: support.sourceSnapshotId ? String(support.sourceSnapshotId) : undefined, entailment: support.entailment, verifierVersion: support.verifierVersion, conflictStatus: support.conflictStatus, evidenceStatus: support.evidenceStatus }
            : null,
          sourceSnapshot: snapshot
            ? { id: String(snapshot._id), userId: snapshot.userId, sourceIdentityId: String(snapshot.sourceIdentityId), revision: snapshot.revision, recordRevision: snapshot.recordRevision, status: snapshot.status, effectiveStatus: snapshot.effectiveStatus, rightsStatus: snapshot.rightsStatus, conflictStatus: snapshot.conflictStatus, evidencePurgedAt: snapshot.evidencePurgedAt }
            : null,
          sourceExcerpt: excerpt
            ? { id: String(excerpt._id), userId: excerpt.userId, sourceSnapshotId: String(excerpt.sourceSnapshotId), locator: excerpt.locator, rightsStatus: excerpt.rightsStatus, evidencePurgedAt: excerpt.evidencePurgedAt }
            : null,
          sourceIdentity: identity
            ? { id: String(identity._id), userId: identity.userId, origin: identity.origin, tombstonedAt: identity.tombstonedAt }
            : null,
        },
      })
    }))
    const integrityState = aggregateIntegrity(claims.map(claim => claim.integrityState))
    const statusAllowsEligibility = !['blocked', 'ended', 'replaced'].includes(activity.status)

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
      claims,
    }
  },
})
