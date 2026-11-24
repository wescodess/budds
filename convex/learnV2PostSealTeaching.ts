import { v } from 'convex/values'
import { internalMutation } from './_generated/server'
import { internal } from './_generated/api'
import { requireAuth } from './lib/auth'
import { preparePostSealPracticeForOwner, publishPostSealTeachingForOwner } from './lib/learnV2PostSealTeaching'
import { purgePostSealSourceLink } from './lib/learnV2PostSealRetention'

const accessPurgeTables = ['learnPostSealTeachingSources', 'learnPostSealPracticeBindings', 'learnPostSealHelpReceipts', 'learnPostSealSourceLinks'] as const

export const preparePractice = internalMutation({
  args: { assessmentOpportunityId: v.id('learnAssessmentOpportunities'), practiceBlockId: v.id('sessionContentBlocks') },
  handler: async (ctx, args) => await preparePostSealPracticeForOwner(ctx, await requireAuth(ctx), args.assessmentOpportunityId, args.practiceBlockId),
})

export const publishTeaching = internalMutation({
  args: { assessmentOpportunityId: v.id('learnAssessmentOpportunities') },
  handler: async (ctx, args) => await publishPostSealTeachingForOwner(ctx, await requireAuth(ctx), args.assessmentOpportunityId),
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
