import { internalMutation } from './_generated/server'

export const migrateLegacyFlashcards = internalMutation({
  args: {},
  handler: async (ctx) => {
    const legacySets = await ctx.db.query('flashcardSets').collect()

    let migratedRooms = 0
    let skippedOrphans = 0
    let skippedOrphanCards = 0
    let skippedAlreadyMigrated = 0

    for (const set of legacySets) {
      const existing = await ctx.db
        .query('flashcardRooms')
        .withIndex('by_migratedFromSetId', (q) => q.eq('migratedFromSetId', set._id))
        .first()
      if (existing) {
        skippedAlreadyMigrated += 1
        continue
      }

      const folder = await ctx.db.get(set.folderId)
      if (!folder || folder.userId !== set.userId) {
        skippedOrphans += 1
        continue
      }

      const legacyCards = await ctx.db
        .query('flashcards')
        .withIndex('by_setId', (q) => q.eq('setId', set._id))
        .collect()

      const now = Date.now()

      const roomId = await ctx.db.insert('flashcardRooms', {
        userId: set.userId,
        folderId: set.folderId,
        title: set.title,
        updatedAt: now,
        cardCount: 0,
        activeVersionId: undefined,
        migratedFromSetId: set._id,
        legacyCreatedAt: set._creationTime,
      })

      const versionId = await ctx.db.insert('flashcardRoomVersions', {
        roomId,
        userId: set.userId,
        title: set.title,
        origin: 'ai',
        prompt: undefined,
        requestedCardCount: undefined,
        cardCount: legacyCards.length,
        model: set.model,
      })

      const sorted = [...legacyCards].sort((a, b) => a.order - b.order)
      let insertedCount = 0
      for (const card of sorted) {
        if (card.userId !== set.userId) {
          skippedOrphanCards += 1
          continue
        }
        const metadata = card.sourceFilename
          ? {
              source: {
                documentId: card.sourceDocumentId,
                filename: card.sourceFilename,
                chunkContent: card.sourceChunkContent,
              },
            }
          : undefined

        await ctx.db.insert('flashcardRoomCards', {
          roomId,
          userId: set.userId,
          displayOrder: card.order,
          term: card.front,
          definition: card.back,
          metadata,
        })
        await ctx.db.insert('flashcardVersionCards', {
          versionId,
          roomId,
          userId: set.userId,
          displayOrder: card.order,
          term: card.front,
          definition: card.back,
          metadata,
        })
        insertedCount += 1
      }

      await ctx.db.patch(versionId, { cardCount: insertedCount })
      await ctx.db.patch(roomId, { activeVersionId: versionId, cardCount: insertedCount })
      migratedRooms += 1
    }

    return { migratedRooms, skippedOrphans, skippedOrphanCards, skippedAlreadyMigrated }
  },
})

