import { v } from 'convex/values'
import { makeFunctionReference } from 'convex/server'
import { internalMutation } from './_generated/server'
import { materializeLearnMeasurementDueBatch } from './lib/learnV2MeasurementDueWork'

const args = { userId: v.string(), cursor: v.optional(v.union(v.string(), v.null())), through: v.optional(v.number()), expectedSequence: v.optional(v.number()), coverageComplete: v.optional(v.boolean()) }
const continuation = makeFunctionReference<'mutation', { userId: string, cursor: string, through: number, expectedSequence: number, coverageComplete: boolean }>('learnV2MeasurementDueWork:materializeDelayedCheckEligibility')

export const materializeDelayedCheckEligibility = internalMutation({
  args,
  handler: async (ctx, input) => {
    const through = input.through ?? Date.now()
    const result = await materializeLearnMeasurementDueBatch(ctx, input.userId, { cursor: input.cursor ?? null, through, expectedSequence: input.expectedSequence, coverageComplete: input.coverageComplete })
    if (result.cursor) await ctx.scheduler.runAfter(0, continuation, { userId: input.userId, cursor: result.cursor, through, expectedSequence: result.sequence, coverageComplete: result.coverageComplete })
    return result
  },
})
