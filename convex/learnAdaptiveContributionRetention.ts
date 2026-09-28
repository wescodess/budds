import { v } from 'convex/values'
import { internal } from './_generated/api'
import { internalMutation, type MutationCtx } from './_generated/server'
import type { Doc } from './_generated/dataModel'
import { loadContributionSource, type ContributionSource } from './learnAdaptive'

const BATCH_SIZE = 32

function contributionSource(ctx: MutationCtx, row: Doc<'learningThreadContributions'>): ContributionSource | null {
  if (row.sourceFeature === 'chat') {
    const id = ctx.db.normalizeId('messages', row.sourceIdentity)
    return id ? { feature: 'chat', id } : null
  }
  if (row.sourceFeature === 'quiz') {
    const id = ctx.db.normalizeId('quizzes', row.sourceIdentity)
    return id ? { feature: 'quiz', id } : null
  }
  if (row.sourceFeature === 'flashcards') {
    const id = ctx.db.normalizeId('flashcardRoomVersions', row.sourceIdentity)
    return id ? { feature: 'flashcards', id } : null
  }
  if (row.sourceFeature === 'podcast') {
    const id = ctx.db.normalizeId('audioOverviews', row.sourceIdentity)
    return id ? { feature: 'podcast', id } : null
  }
  const id = ctx.db.normalizeId('documents', row.sourceIdentity)
  return id ? { feature: 'documents', id } : null
}

export const purgeUnavailableContributions = internalMutation({
  args: { userId: v.string(), cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query('learningThreadContributions')
      .withIndex('by_userId', q => q.eq('userId', args.userId))
      .paginate({ numItems: BATCH_SIZE, cursor: args.cursor ?? null })
    for (const row of page.page) {
      if (row.sourceStatus === 'source_unavailable') continue
      const source = contributionSource(ctx, row)
      const current = source ? await loadContributionSource(ctx, args.userId, source) : null
      // A live source may have a newer revision; its historical contribution
      // still keeps the original origin. Only lost access/deletion purges it.
      if (current) continue
      await ctx.db.patch(row._id, {
        sourceIdentity: '[purged]', sourceRevision: '[purged]', evidenceSnapshotId: undefined,
        metadata: {}, sourceStatus: 'source_unavailable',
      })
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.learnAdaptiveContributionRetention.purgeUnavailableContributions, {
      userId: args.userId, cursor: page.continueCursor,
    })
    return { scanned: page.page.length, pending: !page.isDone }
  },
})
