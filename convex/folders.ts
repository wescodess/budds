import { v } from 'convex/values'
import type { Id, Doc } from './_generated/dataModel'
import type { QueryCtx, MutationCtx } from './_generated/server'
import { mutation, query } from './_generated/server'
import { internal } from './_generated/api'
import { enqueueDocumentCleanup } from './accountDeletion'

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
    if (!name || name.length > 100) {
      throw new Error('Folder name must be between 1 and 100 characters')
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
    if (!name || name.length > 100) {
      throw new Error('Folder name must be between 1 and 100 characters')
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

async function collectDescendants(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  folderId: Id<'folders'>,
): Promise<Doc<'folders'>[]> {
  const children = await ctx.db
    .query('folders')
    .withIndex('by_userId_and_parentId', (q) =>
      q.eq('userId', userId).eq('parentId', folderId),
    )
    .collect()
  const all = [...children]
  for (const child of children) {
    all.push(...(await collectDescendants(ctx, userId, child._id)))
  }
  return all
}

export const renameFolder = mutation({
  args: { id: v.id('folders'), name: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Unauthenticated')

    const userId = identity.tokenIdentifier
    const folder = await ctx.db.get(args.id)
    if (!folder || folder.userId !== userId) throw new Error('Folder not found')

    const name = args.name.trim()
    if (!name || name.length > 100) {
      throw new Error('Folder name must be between 1 and 100 characters')
    }

    await ctx.db.patch(args.id, { name, updatedAt: Date.now() })
  },
})

export const deleteFolder = mutation({
  args: { id: v.id('folders') },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Unauthenticated')

    const userId = identity.tokenIdentifier
    const folder = await ctx.db.get(args.id)
    if (!folder || folder.userId !== userId) throw new Error('Folder not found')

    const descendants = await collectDescendants(ctx, userId, args.id)
    const folderIds: Id<'folders'>[] = [...descendants.map((d) => d._id), args.id]

    let deletedDocuments = 0
    let anyCleanupEnqueued = false

    for (const folderId of folderIds) {
      const docs = await ctx.db
        .query('documents')
        .withIndex('by_folderId', (q) => q.eq('folderId', folderId))
        .collect()

      for (const doc of docs) {
        if (doc.userId !== userId) continue

        const { r2Enqueued, aiSearchEnqueued } = await enqueueDocumentCleanup(ctx, {
          userId,
          documentId: String(doc._id),
          status: doc.status,
          r2Key: doc.r2Key,
        })
        if (r2Enqueued || aiSearchEnqueued) anyCleanupEnqueued = true

        try {
          await ctx.storage.delete(doc.fileId)
        } catch {
          // best-effort; blob may already be gone
        }
        await ctx.db.delete(doc._id)
        deletedDocuments++
      }
    }

    for (let i = descendants.length - 1; i >= 0; i--) {
      await ctx.db.delete(descendants[i]!._id)
    }
    await ctx.db.delete(args.id)

    if (anyCleanupEnqueued) {
      await ctx.scheduler.runAfter(0, internal.accountDeletion.drainPendingCleanup, { userId })
    }

    return { deletedFolders: descendants.length + 1, deletedDocuments }
  },
})

export const getFolderDescendantCounts = query({
  args: { id: v.id('folders') },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Unauthenticated')

    const userId = identity.tokenIdentifier
    const folder = await ctx.db.get(args.id)
    if (!folder || folder.userId !== userId) return null

    const descendants = await collectDescendants(ctx, userId, args.id)

    return { subfolderCount: descendants.length, documentCount: 0 }
  },
})

