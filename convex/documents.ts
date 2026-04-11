import { v } from 'convex/values'
import { mutation, query, internalMutation } from './_generated/server'
import { internal } from './_generated/api'

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

export const updateDocumentStatus = internalMutation({
  args: {
    id: v.id('documents'),
    status: v.union(v.literal('processing'), v.literal('success'), v.literal('failed')),
    failureReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: args.status,
      failureReason: args.failureReason,
    })
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

    if (doc.status === 'success') {
      await ctx.scheduler.runAfter(0, internal.documentActions.deleteDocumentFromAiSearch, {
        documentId: args.id,
      })
    }

    const folder = await ctx.db.get(doc.folderId)
    if (folder) {
      await ctx.db.patch(doc.folderId, {
        documentCount: Math.max(0, folder.documentCount - 1),
        updatedAt: Date.now(),
      })
    }

    await ctx.storage.delete(doc.fileId)
    await ctx.db.delete(args.id)
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
