/**
 * DEPRECATED — Legacy flashcard set API (Phase 1 tombstone).
 *
 * The production UI has moved to `flashcardRooms.ts`. The only remaining
 * export, `createSetWithCards`, is kept solely to seed legacy rows for
 * migration and account-deletion tests until Phase 2 drops the legacy
 * `flashcardSets` / `flashcards` tables entirely.
 *
 * DO NOT wire new UI against this module.
 */
import { v } from 'convex/values'
import { mutation } from './_generated/server'
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
