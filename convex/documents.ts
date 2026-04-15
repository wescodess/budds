import { v } from 'convex/values'
import { mutation, query, internalMutation, internalQuery } from './_generated/server'
import { internal } from './_generated/api'
import { enqueueDocumentCleanup } from './accountDeletion'

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Unauthenticated')

    return await ctx.storage.generateUploadUrl()
  },
})

export const createDocument = mutation({
  args: {
    folderId: v.id('folders'),
    filename: v.string(),
    fileId: v.id('_storage'),
    fileSize: v.number(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Unauthenticated')

    const userId = identity.tokenIdentifier

    const folder = await ctx.db.get(args.folderId)
    if (!folder || folder.userId !== userId) {
      throw new Error('Folder not found')
    }

    const metadata = await ctx.db.system.get(args.fileId)
    if (!metadata) throw new Error('File not found in storage')
    if (metadata.contentType && metadata.contentType !== 'application/pdf') {
      throw new Error('Only PDF files are supported')
    }
    if (metadata.size > 52_428_800) {
      throw new Error('File exceeds 50MB limit')
    }

    const docId = await ctx.db.insert('documents', {
      userId,
      folderId: args.folderId,
      filename: args.filename,
      fileId: args.fileId,
      status: 'processing',
      fileSize: metadata.size,
    })

    await ctx.db.patch(args.folderId, {
      documentCount: folder.documentCount + 1,
      updatedAt: Date.now(),
    })

    await ctx.scheduler.runAfter(0, internal.documentActions.ingestDocument, {
      documentId: docId,
      fileId: args.fileId,
      userId,
      folderId: args.folderId,
      filename: args.filename,
    })

    return docId
  },
})

export const listDocumentsByFolder = query({
  args: { folderId: v.id('folders') },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Unauthenticated')

    const userId = identity.tokenIdentifier

    return await ctx.db
      .query('documents')
      .withIndex('by_userId_and_folderId', (q) =>
        q.eq('userId', userId).eq('folderId', args.folderId),
      )
      .order('desc')
      .take(200)
  },
})

export const countsByFolder = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return [] as Array<{ folderId: string; count: number }>

    const userId = identity.tokenIdentifier

    const docs = await ctx.db
      .query('documents')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .collect()

    const counts = new Map<string, number>()
    for (const d of docs) {
      const key = d.folderId as unknown as string
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }

    return Array.from(counts.entries()).map(([folderId, count]) => ({ folderId, count }))
  },
})

export const updateDocumentStatus = internalMutation({
  args: {
    id: v.id('documents'),
    status: v.union(v.literal('processing'), v.literal('indexing'), v.literal('success'), v.literal('failed')),
    failureReason: v.optional(v.string()),
    indexJobId: v.optional(v.string()),
    r2Key: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = {
      status: args.status,
      failureReason: args.failureReason,
    }
    if (args.indexJobId !== undefined) patch.indexJobId = args.indexJobId
    if (args.r2Key !== undefined) patch.r2Key = args.r2Key
    await ctx.db.patch(args.id, patch)
  },
})

export const getDocument = internalQuery({
  args: { id: v.id('documents') },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id)
  },
})

export const enqueueFailedDocumentCleanup = internalMutation({
  args: {
    userId: v.string(),
    documentId: v.string(),
    retryAiSearch: v.boolean(),
    retryR2: v.boolean(),
    r2Key: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let r2Enqueued = false
    let aiSearchEnqueued = false

    if (args.retryR2 && args.r2Key) {
      await ctx.db.insert('pendingCleanup', {
        userId: args.userId,
        documentId: args.documentId,
        r2Key: args.r2Key,
        kind: 'r2',
        attempts: 0,
      })
      r2Enqueued = true
    }

    if (args.retryAiSearch) {
      await ctx.db.insert('pendingCleanup', {
        userId: args.userId,
        documentId: args.documentId,
        kind: 'ai-search',
        attempts: 0,
      })
      aiSearchEnqueued = true
    }

    return { r2Enqueued, aiSearchEnqueued }
  },
})

export const removeFailedDocument = internalMutation({
  args: { id: v.id('documents') },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.id)
    if (!doc || doc.status !== 'failed') return

    const folder = await ctx.db.get(doc.folderId)
    if (folder) {
      await ctx.db.patch(doc.folderId, {
        documentCount: Math.max(0, folder.documentCount - 1),
        updatedAt: Date.now(),
      })
    }

    await ctx.db.delete(args.id)
  },
})

export const deleteDocument = mutation({
  args: { id: v.id('documents') },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Unauthenticated')

    const userId = identity.tokenIdentifier
    const doc = await ctx.db.get(args.id)
    if (!doc || doc.userId !== userId) {
      throw new Error('Document not found')
    }

    const { r2Enqueued, aiSearchEnqueued } = await enqueueDocumentCleanup(ctx, {
      userId,
      documentId: String(doc._id),
      status: doc.status,
      r2Key: doc.r2Key,
    })

    const folder = await ctx.db.get(doc.folderId)
    if (folder) {
      await ctx.db.patch(doc.folderId, {
        documentCount: Math.max(0, folder.documentCount - 1),
        updatedAt: Date.now(),
      })
    }

    try {
      await ctx.storage.delete(doc.fileId)
    } catch {
      // best-effort; blob may already be gone
    }
    await ctx.db.delete(args.id)

    if (r2Enqueued || aiSearchEnqueued) {
      await ctx.scheduler.runAfter(0, internal.accountDeletion.drainPendingCleanup, { userId })
    }
  },
})

export const moveDocument = mutation({
  args: {
    id: v.id('documents'),
    destinationFolderId: v.id('folders'),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Unauthenticated')

    const userId = identity.tokenIdentifier
    const doc = await ctx.db.get(args.id)
    if (!doc || doc.userId !== userId) {
      throw new Error('Document not found')
    }

    if (doc.folderId === args.destinationFolderId) {
      throw new Error('Document is already in this folder')
    }

    const destFolder = await ctx.db.get(args.destinationFolderId)
    if (!destFolder || destFolder.userId !== userId) {
      throw new Error('Folder not found')
    }

    const srcFolder = await ctx.db.get(doc.folderId)

    await ctx.db.patch(args.id, { folderId: args.destinationFolderId })

    if (doc.status === 'success') {
      await ctx.scheduler.runAfter(0, internal.documentActions.updateDocumentAiSearchMetadata, {
        documentId: String(args.id),
        userId,
        folderId: String(args.destinationFolderId),
        filename: doc.filename,
        r2Key: doc.r2Key,
      })
    }

    if (srcFolder) {
      await ctx.db.patch(doc.folderId, {
        documentCount: Math.max(0, srcFolder.documentCount - 1),
        updatedAt: Date.now(),
      })
    }

    await ctx.db.patch(args.destinationFolderId, {
      documentCount: destFolder.documentCount + 1,
      updatedAt: Date.now(),
    })
  },
})
