import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { getOptionalAuthUserId, requireAuth } from './lib/auth'

export const listRecentForUser = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getOptionalAuthUserId(ctx)
    if (!userId) return []

    const conversations = await ctx.db
      .query('conversations')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .order('desc')
      .take(20)

    return await Promise.all(
      conversations.map(async (convo) => {
        const folder = await ctx.db.get(convo.folderId)
        return {
          ...convo,
          folderName: folder?.name ?? 'Unknown folder',
        }
      }),
    )
  },
})

export const getMostRecentForFolder = query({
  args: { folderId: v.id('folders') },
  handler: async (ctx, args) => {
    const userId = await getOptionalAuthUserId(ctx)
    if (!userId) return null

    return await ctx.db
      .query('conversations')
      .withIndex('by_userId_and_folderId', (q) =>
        q.eq('userId', userId).eq('folderId', args.folderId),
      )
      .order('desc')
      .first()
  },
})

export const getConversation = query({
  args: { id: v.id('conversations') },
  handler: async (ctx, args) => {
    const userId = await getOptionalAuthUserId(ctx)
    if (!userId) return null

    const convo = await ctx.db.get(args.id)
    if (!convo || convo.userId !== userId) return null

    return convo
  },
})

export const createConversation = mutation({
  args: {
    folderId: v.id('folders'),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)

    const folder = await ctx.db.get(args.folderId)
    if (!folder || folder.userId !== userId) {
      throw new Error('Folder not found')
    }

    const trimmed = args.title.trim().slice(0, 60)
    const title = trimmed || 'New conversation'

    return await ctx.db.insert('conversations', {
      userId,
      folderId: args.folderId,
      title,
    })
  },
})

export const deleteConversation = mutation({
  args: { id: v.id('conversations') },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)

    const convo = await ctx.db.get(args.id)
    if (!convo || convo.userId !== userId) {
      throw new Error('Conversation not found')
    }

    const messages = await ctx.db
      .query('messages')
      .withIndex('by_conversationId', (q) => q.eq('conversationId', args.id))
      .collect()

    for (const msg of messages) {
      await ctx.db.delete(msg._id)
    }

    await ctx.db.delete(args.id)
  },
})
