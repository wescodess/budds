import { mutation } from './_generated/server'
import { requireAuth } from './lib/auth'
import { requireOwnedResponseTarget } from './lib/learnV2PublicAccess'
import {
  authorizeAssistanceArgs, authorizeAssistanceSchema, assistanceAuthorizationValidator, LEARN_V2_PUBLIC_API_VERSION, parsePublicLearnRequest,
  type LearnV2AssistanceAuthorization,
} from './lib/learnV2PublicContract'

export const authorizeAssistance = mutation({
  args: authorizeAssistanceArgs, returns: assistanceAuthorizationValidator,
  handler: async (ctx, args): Promise<LearnV2AssistanceAuthorization> => {
    const userId = await requireAuth(ctx)
    const request = parsePublicLearnRequest(authorizeAssistanceSchema, args)
    if (request.assessmentOpportunityId) await requireOwnedResponseTarget(ctx, userId, { assessmentOpportunityId: request.assessmentOpportunityId })
    return { version: LEARN_V2_PUBLIC_API_VERSION, status: 'denied' as const, reasonCode: 'disabled' as const }
  },
})
