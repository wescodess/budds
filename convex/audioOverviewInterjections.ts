import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'
import { requireAuth } from './lib/auth'

const speakerValidator = v.union(v.literal('host_a'), v.literal('host_b'))

const answerTurnValidator = v.object({
  speaker: speakerValidator,
  text: v.string(),
  audioFileId: v.id('_storage'),
  durationMs: v.number(),
  sourceIndex: v.optional(v.number()),
})

async function requireOwnedOverview(
  ctx: QueryCtx | MutationCtx,
  overviewId: Id<'audioOverviews'>,
  userId: string,
) {
  const overview = await ctx.db.get(overviewId)
  if (!overview || overview.userId !== userId) throw new Error('Audio overview not found')
  return overview
}

export const create = mutation({
  args: {
    audioOverviewId: v.id('audioOverviews'),
    insertedAfterTurnIndex: v.number(),
    question: v.string(),
    model: v.optional(v.string()),
    answerTurns: v.array(answerTurnValidator),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const overview = await requireOwnedOverview(ctx, args.audioOverviewId, userId)
    if (overview.status !== 'ready') throw new Error('Audio overview is not ready')

    if (args.answerTurns.length === 0) {
      throw new Error('Interjection requires at least one answer turn')
    }

    const trimmedQuestion = args.question.trim().slice(0, 500)
    if (!trimmedQuestion) throw new Error('Question is required')

    const clampedAfterIndex = Math.max(
      0,
      Math.min(args.insertedAfterTurnIndex, overview.turns.length),
    )

    const interjectionId = await ctx.db.insert('audioOverviewInterjections', {
      audioOverviewId: args.audioOverviewId,
      userId,
      insertedAfterTurnIndex: clampedAfterIndex,
      question: trimmedQuestion,
      model: args.model,
      answerTurns: args.answerTurns,
    })

    return { interjectionId }
  },
})

export const listByOverview = query({
  args: { audioOverviewId: v.id('audioOverviews') },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return []
    const userId = identity.tokenIdentifier
    const overview = await ctx.db.get(args.audioOverviewId)
    if (!overview || overview.userId !== userId) return []

    const rows = await ctx.db
      .query('audioOverviewInterjections')
      .withIndex('by_audioOverview', (q) => q.eq('audioOverviewId', args.audioOverviewId))
      .order('asc')
      .collect()

    return rows
  },
})

export const getTurnUrls = query({
  args: { id: v.id('audioOverviewInterjections') },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return null
    const userId = identity.tokenIdentifier
    const row = await ctx.db.get(args.id)
    if (!row || row.userId !== userId) return null
    const urls: (string | null)[] = []
    for (const turn of row.answerTurns) {
      urls.push(await ctx.storage.getUrl(turn.audioFileId))
    }
    return urls
  },
})

export const deleteInterjection = mutation({
  args: { id: v.id('audioOverviewInterjections') },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const row = await ctx.db.get(args.id)
    if (!row || row.userId !== userId) throw new Error('Interjection not found')

    for (const turn of row.answerTurns) {
      try {
        await ctx.storage.delete(turn.audioFileId)
      }
      catch {
        // tolerate orphan-already-deleted
      }
    }

    await ctx.db.delete(args.id)
    return { deletedTurns: row.answerTurns.length }
  },
})
