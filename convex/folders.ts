import { v } from 'convex/values'
import type { Id } from './_generated/dataModel'
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
      .take(500)
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

export const createSubfolder = mutation({
  args: {
    name: v.string(),
    parentId: v.id('folders'),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Unauthenticated')

    const userId = identity.tokenIdentifier
    const name = args.name.trim()
    if (!name || name.length > 200) {
      throw new Error('Folder name must be between 1 and 200 characters')
    }

    const parent = await ctx.db.get(args.parentId)
    if (!parent || parent.userId !== userId) {
      throw new Error('Parent folder not found')
    }

    let depth = 1
    let current: Id<'folders'> | undefined = parent.parentId
    const seen = new Set<string>()
    while (current) {
      if (seen.has(current)) break
      seen.add(current)
      depth++
      const ancestor = await ctx.db.get(current)
      if (!ancestor) break
      current = ancestor.parentId
    }

    if (depth >= 3) {
      throw new Error('Maximum folder depth (3 levels) reached')
    }

    return await ctx.db.insert('folders', {
      userId,
      name,
      parentId: args.parentId,
      documentCount: 0,
      updatedAt: Date.now(),
    })
  },
})

export const listChildFolders = query({
  args: { parentId: v.id('folders') },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return []

    const userId = identity.tokenIdentifier

    return await ctx.db
      .query('folders')
      .withIndex('by_userId_and_parentId', (q) =>
        q.eq('userId', userId).eq('parentId', args.parentId),
      )
      .take(100)
  },
})

export const getFolder = query({
  args: { id: v.id('folders') },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return null

    const folder = await ctx.db.get(args.id)
    if (!folder || folder.userId !== identity.tokenIdentifier) return null

    return folder
  },
})

