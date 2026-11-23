import { makeFunctionReference } from 'convex/server'
import { v } from 'convex/values'
import { mutation } from '../../convex/_generated/server'
import { requireAuth } from '../../convex/lib/auth'
import { replaceLearnMeasurementOpportunityForOwner } from '../../convex/lib/learnV2MeasurementDueWork'

export const replaceMeasurementOpportunity = makeFunctionReference<'mutation', Parameters<typeof replaceLearnMeasurementOpportunityForOwner>[2],
  Awaited<ReturnType<typeof replaceLearnMeasurementOpportunityForOwner>>>('measurementReplacementFixture:replace')

export const measurementReplacementModules = {
  '../../convex/measurementReplacementFixture.ts': async () => ({
    replace: mutation({ args: { assessmentOpportunityId: v.id('learnAssessmentOpportunities'),
      reason: v.union(v.literal('novel_item_unavailable'), v.literal('evidence_unavailable'), v.literal('contaminated'), v.literal('abandoned')) },
    handler: async (ctx, args) => await replaceLearnMeasurementOpportunityForOwner(ctx, await requireAuth(ctx), args) }),
  }),
}
