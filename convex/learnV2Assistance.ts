import { mutation } from './_generated/server'
import { requireAuth } from './lib/auth'
import { requireOwnedResponseTarget } from './lib/learnV2PublicAccess'
import {
  authorizeAssistanceArgs, authorizeAssistanceSchema, assistanceAuthorizationValidator, parsePublicLearnRequest,
  type LearnV2AssistanceAuthorization,
  authorizePracticeAssistanceArgs, authorizePracticeAssistanceSchema, practiceAssistanceAuthorizationValidator,
  type LearnV2PracticeAssistanceAuthorization,
} from './lib/learnV2PublicContract'
import { LEARN_V2_POST_SEAL_TEACHING_VERSION } from '../shared/learn-v2-assessment-disclosure'
import { admitHelpArgs, helpAdmissionValidator, type LearnHelpAdmission } from './lib/learnV2HelpContract'
import { admitLearnHelpForOwner } from './lib/learnV2HelpAdmission'
import { authorizeLearnResponseAssistanceForOwner } from './lib/learnV2Responses'

export const admitHelp = mutation({
  args: admitHelpArgs, returns: helpAdmissionValidator,
  handler: async (ctx, args): Promise<LearnHelpAdmission> => await admitLearnHelpForOwner(ctx, await requireAuth(ctx), args),
})

export const authorizeAssistance = mutation({
  args: authorizeAssistanceArgs, returns: assistanceAuthorizationValidator,
  handler: async (ctx, args): Promise<LearnV2AssistanceAuthorization> => {
    const userId = await requireAuth(ctx)
    const request = parsePublicLearnRequest(authorizeAssistanceSchema, args)
    return await authorizeLearnResponseAssistanceForOwner(ctx, userId, request)
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
