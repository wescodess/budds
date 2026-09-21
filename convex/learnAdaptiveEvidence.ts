import { v } from 'convex/values'
import { internalQuery } from './_generated/server'
import { requireAuth } from './lib/auth'
import { loadAdaptiveClaimProjection } from './lib/adaptiveClaimProjection'

// Integration note: compose this private projection behind the canonical
// adaptive access gate in learnAdaptive.getThread after ALA 1.3 is integrated.
export const getActivityEvidence = internalQuery({
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

    const { claims, integrityState } = await loadAdaptiveClaimProjection(ctx, {
      userId,
      historical,
      sessionContentId: activity.sessionContentId,
      sessionContentRevision: activity.generationInputs.sessionContentRevision,
      evidenceReferences: activity.evidenceReferences,
    })
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
