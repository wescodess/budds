import { mutation } from './_generated/server'
import { requireAuth } from './lib/auth'
import {
  authorizeAssistanceArgs, authorizeAssistanceSchema, assistanceAuthorizationValidator, parsePublicLearnRequest,
  type LearnV2AssistanceAuthorization,
  authorizePracticeAssistanceArgs, authorizePracticeAssistanceSchema, practiceAssistanceAuthorizationValidator,
  type LearnV2PracticeAssistanceAuthorization,
} from './lib/learnV2PublicContract'
import { authorizePostSealPracticeForOwner } from './lib/learnV2PostSealTeaching'
import { admitHelpArgs, helpAdmissionValidator, type LearnHelpAdmission } from './lib/learnV2HelpContract'
import { admitLearnHelpForOwner } from './lib/learnV2HelpAdmission'
import { authorizeLearnResponseAssistanceForOwner } from './lib/learnV2Responses'

export const admitHelp = mutation({
  args: admitHelpArgs, returns: helpAdmissionValidator,
  handler: async (ctx, args): Promise<LearnHelpAdmission> => await admitLearnHelpForOwner(ctx, await requireAuth(ctx), args),
})

export const deliverHelp = mutation({
  args: admitHelpArgs, returns: helpAdmissionValidator,
  handler: async (ctx, args): Promise<LearnHelpAdmission> => await admitLearnHelpForOwner(ctx, await requireAuth(ctx), args, true),
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
    return await authorizePostSealPracticeForOwner(ctx, userId, request)
  },
})
