import { mutation, query, type MutationCtx } from './_generated/server'
import { requireAuth } from './lib/auth'
import { requireOwnedResponseTarget } from './lib/learnV2PublicAccess'
import {
  acceptResponseArgs, acceptResponseCommandSchema, disabledLearnV2Result, disabledResponseReceipt, parsePublicLearnRequest,
  responseReceiptValidator, responseStateArgs, responseStateSchema, responseStateValidator,
  terminalizeResponseArgs, terminalizeResponseSchema, terminalizeResponseValidator,
  type LearnV2AcceptResponseCommand, type LearnV2ResponseState, type LearnV2Terminalization,
} from './lib/learnV2PublicContract'
import { learnSerializedBytes, LEARN_V2_RESPONSE_LIMITS, type LearnResponseReceipt } from '../shared/learn-v2-responses'

export async function acceptResponseForOwner(
  ctx: MutationCtx, tokenIdentifier: string, input: LearnV2AcceptResponseCommand,
): Promise<LearnResponseReceipt> {
  const request = parsePublicLearnRequest(acceptResponseCommandSchema, input)
  const responses = 'response' in request ? [request.response] : [request.teachBack, request.application]
  for (const response of responses) {
    const target = await requireOwnedResponseTarget(ctx, tokenIdentifier, response.target)
    if ('stage' in target && target.stage === 'diagnostic') {
      try { learnSerializedBytes(response.payload, LEARN_V2_RESPONSE_LIMITS.maxDiagnosticBytes) }
      catch { throw new Error('Invalid Learn request') }
    }
  }
  return disabledResponseReceipt()
}

export const acceptResponse = mutation({
  args: acceptResponseArgs, returns: responseReceiptValidator,
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    if (!('responseSlotId' in args.response.target)) throw new Error('Invalid Learn request')
    return await acceptResponseForOwner(ctx, userId, args)
  },
})

export const getResponseState = query({
  args: responseStateArgs, returns: responseStateValidator,
  handler: async (ctx, args): Promise<LearnV2ResponseState> => {
    const userId = await requireAuth(ctx)
    const request = parsePublicLearnRequest(responseStateSchema, args)
    await requireOwnedResponseTarget(ctx, userId, request.target)
    return disabledLearnV2Result()
  },
})

export const terminalizeResponse = mutation({
  args: terminalizeResponseArgs, returns: terminalizeResponseValidator,
  handler: async (ctx, args): Promise<LearnV2Terminalization> => {
    const userId = await requireAuth(ctx)
    const request = parsePublicLearnRequest(terminalizeResponseSchema, args)
    await requireOwnedResponseTarget(ctx, userId, request.target)
    return disabledLearnV2Result()
  },
})
