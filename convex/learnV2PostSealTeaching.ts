import { v } from 'convex/values'
import { internalMutation, mutation } from './_generated/server'
import { internal } from './_generated/api'
import { requireAuth } from './lib/auth'
import { preparePostSealPracticeForOwner, publishPostSealTeachingForOwner, readPostSealTeachingForOwner } from './lib/learnV2PostSealTeaching'
import { purgePostSealSourceLink } from './lib/learnV2PostSealRetention'
import { postSealTeachingArgs, postSealTeachingReferenceSchema, postSealTeachingValidator, parsePublicLearnRequest, type LearnV2PostSealTeaching } from './lib/learnV2PublicContract'
import { requireOwnedSubmission, requireOwnedResponseTarget } from './lib/learnV2PublicAccess'

const accessPurgeTables = ['learnPostSealTeachingSources', 'learnPostSealPracticeBindings', 'learnPostSealHelpReceipts', 'learnPostSealSourceLinks'] as const

export const openPractice = mutation({
  args: postSealTeachingArgs, returns: postSealTeachingValidator,
  handler: async (ctx, args): Promise<LearnV2PostSealTeaching> => {
    const userId = await requireAuth(ctx)
    const request = parsePublicLearnRequest(postSealTeachingReferenceSchema, args)
    await requireOwnedResponseTarget(ctx, userId, { assessmentOpportunityId: request.assessmentOpportunityId })
    const prepared = await preparePostSealPracticeForOwner(ctx, userId, request.assessmentOpportunityId)
    if (prepared.status !== 'prepared') return prepared
    await publishPostSealTeachingForOwner(ctx, userId, request.assessmentOpportunityId)
    return await readPostSealTeachingForOwner(ctx, userId, request.assessmentOpportunityId)
  },
})

export const publishTeaching = internalMutation({
  args: { submissionId: v.id('learnResponses') },
  handler: async (ctx, args) => {
    await requireOwnedSubmission(ctx, args.submissionId)
    const submission = (await ctx.db.get(args.submissionId))!
    if (!('assessmentOpportunityId' in submission)) throw new Error('Assessment submission required')
    return await publishPostSealTeachingForOwner(ctx, await requireAuth(ctx), submission.assessmentOpportunityId)
  },
})

export const purgeAccess = internalMutation({
  args: { userId: v.string(), table: v.number(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    if (!Number.isSafeInteger(args.table) || args.table < 0 || args.table >= accessPurgeTables.length) throw new Error('Invalid access purge page')
    const table = accessPurgeTables[args.table]!
    const page = await ctx.db.query(table).withIndex('by_userId', q => q.eq('userId', args.userId)).paginate({ cursor: args.cursor, numItems: 8 })
    for (const row of page.page) {
      if ('target' in row) {
        await purgePostSealSourceLink(ctx, args.userId, row._id)
        continue
      }
      if (row.content.status !== 'purged') await ctx.db.patch(row._id, { evidenceStatus: 'evidence_unavailable', invalidatedAt: Date.now(),
        content: { status: 'purged', reasonCode: 'evidence_unavailable', purgedAt: Date.now() } })
      if ('practiceCaseId' in row) {
        const slot = await ctx.db.get(row.responseSlotId)
        if (slot?.userId === args.userId) await ctx.db.patch(slot._id, { evidenceStatus: 'evidence_unavailable', invalidatedAt: Date.now() })
      }
    }
    const next = page.isDone ? { table: args.table + 1, cursor: null } : { table: args.table, cursor: page.continueCursor }
    if (next.table < accessPurgeTables.length) await ctx.scheduler.runAfter(0, internal.learnV2PostSealTeaching.purgeAccess, { userId: args.userId, ...next })
  },
})
