import { mutation } from './_generated/server'
import { requireAuth } from './lib/auth'
import { requireOwnedResponseTarget } from './lib/learnV2PublicAccess'
import {
  authorizeAssistanceArgs, authorizeAssistanceSchema, assistanceAuthorizationValidator, LEARN_V2_PUBLIC_API_VERSION, parsePublicLearnRequest,
  type LearnV2AssistanceAuthorization,
  authorizePracticeAssistanceArgs, authorizePracticeAssistanceSchema, practiceAssistanceAuthorizationValidator,
  type LearnV2PracticeAssistanceAuthorization,
} from './lib/learnV2PublicContract'
import { LEARN_V2_POST_SEAL_TEACHING_VERSION } from '../shared/learn-v2-assessment-disclosure'

export const authorizeAssistance = mutation({
  args: authorizeAssistanceArgs, returns: assistanceAuthorizationValidator,
  handler: async (ctx, args): Promise<LearnV2AssistanceAuthorization> => {
    const userId = await requireAuth(ctx)
    const request = parsePublicLearnRequest(authorizeAssistanceSchema, args)
    if (request.assessmentOpportunityId) await requireOwnedResponseTarget(ctx, userId, { assessmentOpportunityId: request.assessmentOpportunityId })
    return { version: LEARN_V2_PUBLIC_API_VERSION, status: 'denied' as const, reasonCode: 'disabled' as const }
  },
})

export const authorizePracticeAssistance = mutation({
  args: authorizePracticeAssistanceArgs, returns: practiceAssistanceAuthorizationValidator,
  handler: async (ctx, args): Promise<LearnV2PracticeAssistanceAuthorization> => {
    const userId = await requireAuth(ctx)
    const request = parsePublicLearnRequest(authorizePracticeAssistanceSchema, args)
    await requireOwnedResponseTarget(ctx, userId, { assessmentOpportunityId: request.assessmentOpportunityId })
    await requireOwnedResponseTarget(ctx, userId, request.target)
    return { version: LEARN_V2_POST_SEAL_TEACHING_VERSION, status: 'denied', reasonCode: 'disabled' }
  },
})
