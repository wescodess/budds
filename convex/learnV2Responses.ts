import { mutation, query, type MutationCtx } from './_generated/server'
import { requireAuth } from './lib/auth'
import {
  acceptResponseArgs, parsePublicLearnRequest,
  responseReceiptValidator, responseStateArgs, responseStateSchema, responseStateValidator,
  terminalizeResponseArgs, terminalizeResponseSchema, terminalizeResponseValidator,
  type LearnV2AcceptResponseCommand, type LearnV2ResponseState, type LearnV2Terminalization,
} from './lib/learnV2PublicContract'
import type { LearnResponseReceipt } from '../shared/learn-v2-responses'
import { acceptLearnResponseForOwner, getLearnResponseStateForOwner, terminalizeLearnResponseForOwner } from './lib/learnV2Responses'

export async function acceptResponseForOwner(
  ctx: MutationCtx, tokenIdentifier: string, input: LearnV2AcceptResponseCommand,
): Promise<LearnResponseReceipt> {
  return await acceptLearnResponseForOwner(ctx, tokenIdentifier, input)
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
    return await getLearnResponseStateForOwner(ctx, userId, request.target)
  },
})

export const terminalizeResponse = mutation({
  args: terminalizeResponseArgs, returns: terminalizeResponseValidator,
  handler: async (ctx, args): Promise<LearnV2Terminalization> => {
    const userId = await requireAuth(ctx)
    const request = parsePublicLearnRequest(terminalizeResponseSchema, args)
    return await terminalizeLearnResponseForOwner(ctx, userId, request)
  },
})
