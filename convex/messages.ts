import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { requireAuth } from './lib/auth'

const sourcesValidator = v.array(
  v.object({
    content: v.string(),
    score: v.number(),
    filename: v.string(),
  }),
)

export const listByConversation = query({
  args: { conversationId: v.id('conversations') },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)

    const convo = await ctx.db.get(args.conversationId)
    if (!convo || convo.userId !== userId) {
      throw new Error('Conversation not found')
    }

    return await ctx.db
      .query('messages')
      .withIndex('by_conversationId', (q) => q.eq('conversationId', args.conversationId))
      .order('asc')
      .take(500)
  },
})

export const appendMessage = mutation({
  args: {
    conversationId: v.id('conversations'),
    role: v.union(v.literal('user'), v.literal('assistant')),
    content: v.string(),
    sources: v.optional(sourcesValidator),
    model: v.optional(v.string()),
    interjectionContext: v.optional(v.object({
      overviewId: v.id('audioOverviews'),
      turnIndex: v.number(),
      timeMs: v.number(),
      quotedText: v.string(),
      sourceFilename: v.optional(v.string()),
      interjectionId: v.optional(v.id('audioOverviewInterjections')),
    })),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)

    const convo = await ctx.db.get(args.conversationId)
    if (!convo || convo.userId !== userId) {
      throw new Error('Conversation not found')
    }

    return await ctx.db.insert('messages', {
      conversationId: args.conversationId,
      userId,
      role: args.role,
      content: args.content,
      sources: args.sources,
      model: args.model,
      interjectionContext: args.interjectionContext,
    })
  },
})
