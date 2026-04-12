import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { Id } from './_generated/dataModel'

const cardInput = v.object({
  order: v.number(),
  front: v.string(),
  back: v.string(),
  sourceDocumentId: v.optional(v.string()),
  sourceChunkContent: v.string(),
  sourceFilename: v.string(),
})

export const createSetWithCards = mutation({
  args: {
    folderId: v.id('folders'),
    title: v.string(),
    model: v.optional(v.string()),
    cards: v.array(cardInput),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Unauthenticated')

    const userId = identity.tokenIdentifier

    const folder = await ctx.db.get(args.folderId)
    if (!folder || folder.userId !== userId) {
      throw new Error('Folder not found')
    }

    const trimmedTitle = args.title.trim().slice(0, 120) || 'Flash Cards'

    const setId = await ctx.db.insert('flashcardSets', {
      userId,
      folderId: args.folderId,
      title: trimmedTitle,
      status: 'ready',
      model: args.model,
      cardCount: args.cards.length,
    })

    for (const c of args.cards) {
      let resolvedDocId: Id<'documents'> | undefined
      if (c.sourceDocumentId) {
        const normalized = ctx.db.normalizeId('documents', c.sourceDocumentId)
        if (normalized) {
          const doc = await ctx.db.get(normalized)
          if (doc && doc.userId === userId) resolvedDocId = normalized
        }
      }

      await ctx.db.insert('flashcards', {
        setId,
        userId,
        order: c.order,
        front: c.front,
        back: c.back,
        sourceDocumentId: resolvedDocId,
        sourceChunkContent: c.sourceChunkContent,
        sourceFilename: c.sourceFilename,
      })
    }

    return { setId }
  },
})

export const listByFolder = query({
  args: { folderId: v.id('folders') },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return []

    const userId = identity.tokenIdentifier

    const folder = await ctx.db.get(args.folderId)
    if (!folder || folder.userId !== userId) return []

    const rows = await ctx.db
      .query('flashcardSets')
      .withIndex('by_userId_and_folderId', (q) =>
        q.eq('userId', userId).eq('folderId', args.folderId),
      )
      .order('desc')
      .collect()

    return rows.map((row) => ({
      _id: row._id,
      _creationTime: row._creationTime,
      title: row.title,
      status: row.status,
      cardCount: row.cardCount,
    }))
  },
})

export const getSetWithCards = query({
  args: { id: v.id('flashcardSets') },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return null

    const userId = identity.tokenIdentifier

    const set = await ctx.db.get(args.id)
    if (!set || set.userId !== userId) return null

    const cards = await ctx.db
      .query('flashcards')
      .withIndex('by_setId', (q) => q.eq('setId', set._id))
      .collect()

    cards.sort((a, b) => a.order - b.order)

    return { set, cards }
  },
})
