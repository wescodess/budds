import { v } from 'convex/values'
import { mutation } from './_generated/server'
import { requireAuth } from './lib/auth'
import { enrollLearnMeasurementForOwner } from './lib/learnV2Measurement'

export const enrollProspect = mutation({
  args: { studySessionId: v.id('studySessions'), familyId: v.optional(v.id('learnMeasurementFamilies')),
    entryPoint: v.union(v.literal('today'), v.literal('session_deep_link'), v.literal('canvas')),
    canvasActivityId: v.optional(v.id('learningThreadActivities')) },
  returns: v.object({ status: v.union(v.literal('admitted'), v.literal('considered'), v.literal('not_admitted'), v.literal('protocol_not_frozen'), v.literal('disabled')),
    assignmentId: v.union(v.id('learnMeasurementAssignments'), v.null()), reasonCodes: v.array(v.string()) }),
  handler: async (ctx, args) => await enrollLearnMeasurementForOwner(ctx, await requireAuth(ctx), args),
})
