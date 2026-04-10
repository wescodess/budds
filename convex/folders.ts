import { v } from 'convex/values'
import { mutation, query } from './_generated/server'

export const listAllFolders = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return []

    const userId = identity.tokenIdentifier

    return await ctx.db
      .query('folders')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .collect()
  },
})

export const listTopLevelFolders = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return []

    const userId = identity.tokenIdentifier

    return await ctx.db
      .query('folders')
      .withIndex('by_userId_and_parentId', (q) =>
        q.eq('userId', userId).eq('parentId', undefined),
      )
      .order('desc')
      .take(50)
  },
})

export const createFolder = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Unauthenticated')

    const userId = identity.tokenIdentifier
    const name = args.name.trim()
    if (!name || name.length > 200) {
      throw new Error('Folder name must be between 1 and 200 characters')
    }

    return await ctx.db.insert('folders', {
      userId,
      name,
      parentId: undefined,
      documentCount: 0,
      updatedAt: Date.now(),
    })
  },
})
