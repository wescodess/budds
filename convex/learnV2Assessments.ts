import { query, mutation } from './_generated/server'
import { requireAuth } from './lib/auth'
import { requireOwnedResponseTarget } from './lib/learnV2PublicAccess'
import {
  assessmentReferenceArgs, assessmentReferenceSchema, assessmentDeliveryValidator, assessmentStateValidator,
  grantAssessmentDeliveryArgs, grantAssessmentDeliverySchema, grantAssessmentDeliveryValidator,
  disabledLearnV2Result, featureReadinessValidator, LEARN_V2_PUBLIC_API_VERSION, parsePublicLearnRequest,
  type LearnV2FeatureReadiness, type LearnV2DeliveryGrant, type LearnV2AssessmentDelivery, type LearnV2AssessmentState,
} from './lib/learnV2PublicContract'

export const getFeatureReadiness = query({
  args: {}, returns: featureReadinessValidator,
  handler: async (ctx): Promise<LearnV2FeatureReadiness> => {
    await requireAuth(ctx)
    const off = () => ({ status: 'disabled' as const, reasonCodes: ['disabled'] })
    return {
      version: LEARN_V2_PUBLIC_API_VERSION, status: 'disabled', protocolStatus: 'protocol_not_frozen',
      serverUsable: false, uiRequired: false, realBaselineCaptured: false, day7Observed: false, day30Observed: false,
      capabilities: { responseAcceptance: off(), assessmentDelivery: off(), assessmentAcceptance: off(), scoringBySubmission: off(),
        assistanceAuthorization: off(), reportRequest: off(), reportRead: off(), aggregateExport: off() },
    }
  },
})

export const grantAssessmentDelivery = mutation({
  args: grantAssessmentDeliveryArgs, returns: grantAssessmentDeliveryValidator,
  handler: async (ctx, args): Promise<LearnV2DeliveryGrant> => {
    const userId = await requireAuth(ctx)
    const request = parsePublicLearnRequest(grantAssessmentDeliverySchema, args)
    await requireOwnedResponseTarget(ctx, userId, { assessmentOpportunityId: request.assessmentOpportunityId })
    return disabledLearnV2Result()
  },
})

export const getAssessment = query({
  args: assessmentReferenceArgs, returns: assessmentDeliveryValidator,
  handler: async (ctx, args): Promise<LearnV2AssessmentDelivery> => {
    const userId = await requireAuth(ctx)
    const request = parsePublicLearnRequest(assessmentReferenceSchema, args)
    await requireOwnedResponseTarget(ctx, userId, { assessmentOpportunityId: request.assessmentOpportunityId })
    return disabledLearnV2Result()
  },
})

export const getAssessmentState = query({
  args: assessmentReferenceArgs, returns: assessmentStateValidator,
  handler: async (ctx, args): Promise<LearnV2AssessmentState> => {
    const userId = await requireAuth(ctx)
    const request = parsePublicLearnRequest(assessmentReferenceSchema, args)
    await requireOwnedResponseTarget(ctx, userId, { assessmentOpportunityId: request.assessmentOpportunityId })
    return disabledLearnV2Result()
  },
})
