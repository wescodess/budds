import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { Id, Doc } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'

const sourceInput = v.optional(
  v.object({
    documentId: v.optional(v.string()),
    filename: v.string(),
    chunkContent: v.string(),
  }),
)

const metadataInput = v.optional(
  v.object({
    source: sourceInput,
  }),
)

type RoomDoc = Doc<'flashcardRooms'>
type RoomCardDoc = Doc<'flashcardRoomCards'>

async function requireIdentity(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) throw new Error('Unauthenticated')
  return identity.tokenIdentifier
}

async function requireOwnedRoom(
  ctx: MutationCtx,
  roomId: Id<'flashcardRooms'>,
  userId: string,
): Promise<RoomDoc> {
  const room = await ctx.db.get(roomId)
  if (!room || room.userId !== userId) {
    throw new Error('Room not found')
  }
  return room
}

async function resolveDocumentId(
  ctx: MutationCtx,
  userId: string,
  raw: string | undefined,
): Promise<Id<'documents'> | undefined> {
  if (!raw) return undefined
  const normalized = ctx.db.normalizeId('documents', raw)
  if (!normalized) return undefined
  const doc = await ctx.db.get(normalized)
  if (!doc || doc.userId !== userId) return undefined
  return normalized
}

function normalizeTitle(raw: string | undefined, fallback = 'Flash Cards'): string {
  const trimmed = (raw ?? '').trim().slice(0, 120)
  return trimmed.length === 0 ? fallback : trimmed
}

async function normalizeMetadata(
  ctx: MutationCtx,
  userId: string,
  metadata: { source?: { documentId?: string; filename: string; chunkContent: string } } | undefined,
): Promise<RoomCardDoc['metadata']> {
  if (!metadata?.source) return undefined
  const docId = await resolveDocumentId(ctx, userId, metadata.source.documentId)
  return {
    source: {
      documentId: docId,
      filename: metadata.source.filename,
      chunkContent: metadata.source.chunkContent,
    },
  }
}

async function getMaxDisplayOrder(
  ctx: MutationCtx,
  roomId: Id<'flashcardRooms'>,
): Promise<number> {
  const top = await ctx.db
    .query('flashcardRoomCards')
    .withIndex('by_roomId_and_displayOrder', (q) => q.eq('roomId', roomId))
    .order('desc')
    .first()
  return top?.displayOrder ?? -1
}

async function deleteAllRoomCards(
  ctx: MutationCtx,
  roomId: Id<'flashcardRooms'>,
): Promise<number> {
  let deleted = 0
  while (true) {
    const batch = await ctx.db
      .query('flashcardRoomCards')
      .withIndex('by_roomId', (q) => q.eq('roomId', roomId))
      .take(500)
    if (batch.length === 0) break
    for (const row of batch) {
      await ctx.db.delete(row._id)
      deleted += 1
    }
    if (batch.length < 500) break
  }
  return deleted
}

async function resolveArchiveOpts(
  ctx: MutationCtx,
  room: RoomDoc,
): Promise<{ title: string; origin: 'ai' | 'manual'; prompt?: string; requestedCardCount?: number; model?: string }> {
  if (room.activeVersionId) {
    const version = await ctx.db.get(room.activeVersionId)
    if (version) {
      return {
        title: version.title,
        origin: version.origin,
        prompt: version.prompt,
        requestedCardCount: version.requestedCardCount,
        model: version.model,
      }
    }
  }
  return { title: room.title || 'Previous deck', origin: 'manual' }
}

async function archiveCurrentCards(
  ctx: MutationCtx,
  room: RoomDoc,
  opts: { title: string; origin: 'ai' | 'manual'; prompt?: string; requestedCardCount?: number; model?: string },
): Promise<Id<'flashcardRoomVersions'> | null> {
  const currentCards = await ctx.db
    .query('flashcardRoomCards')
    .withIndex('by_roomId', (q) => q.eq('roomId', room._id))
    .collect()

  if (currentCards.length === 0) return null

  const versionId = await ctx.db.insert('flashcardRoomVersions', {
    roomId: room._id,
    userId: room.userId,
    title: opts.title,
    origin: opts.origin,
    prompt: opts.prompt,
    requestedCardCount: opts.requestedCardCount,
    cardCount: currentCards.length,
    model: opts.model,
  })

  const sorted = [...currentCards].sort((a, b) => a.displayOrder - b.displayOrder)
  for (const card of sorted) {
    await ctx.db.insert('flashcardVersionCards', {
      versionId,
      roomId: room._id,
      userId: room.userId,
      displayOrder: card.displayOrder,
      term: card.term,
      definition: card.definition,
      metadata: card.metadata,
    })
  }

  return versionId
}

export const createRoom = mutation({
  args: {
    folderId: v.id('folders'),
    title: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireIdentity(ctx)

    const folder = await ctx.db.get(args.folderId)
    if (!folder || folder.userId !== userId) {
      throw new Error('Folder not found')
    }

    const title = normalizeTitle(args.title)
    const now = Date.now()

    const roomId = await ctx.db.insert('flashcardRooms', {
      userId,
      folderId: args.folderId,
      title,
      updatedAt: now,
      cardCount: 0,
      activeVersionId: undefined,
    })

    return { roomId }
  },
})

export const renameRoom = mutation({
  args: {
    roomId: v.id('flashcardRooms'),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireIdentity(ctx)
    const room = await requireOwnedRoom(ctx, args.roomId, userId)

    const nextTitle = normalizeTitle(args.title)
    await ctx.db.patch(room._id, { title: nextTitle, updatedAt: Date.now() })
    return { roomId: room._id, title: nextTitle }
  },
})

export const listRoomsByFolder = query({
  args: { folderId: v.id('folders') },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return []

    const userId = identity.tokenIdentifier
    const folder = await ctx.db.get(args.folderId)
    if (!folder || folder.userId !== userId) return []

    const rooms = await ctx.db
      .query('flashcardRooms')
      .withIndex('by_userId_and_folderId', (q) =>
        q.eq('userId', userId).eq('folderId', args.folderId),
      )
      .take(200)

    const summaries = rooms.map((room) => ({
      _id: room._id,
      _creationTime: room._creationTime,
      title: room.title,
      cardCount: room.cardCount ?? 0,
      updatedAt: room.updatedAt,
      legacyCreatedAt: room.legacyCreatedAt,
    }))

    summaries.sort((a, b) => b.updatedAt - a.updatedAt)
    return summaries
  },
})

export const getRoom = query({
  args: { roomId: v.id('flashcardRooms') },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return null

    const userId = identity.tokenIdentifier
    const room = await ctx.db.get(args.roomId)
    if (!room || room.userId !== userId) return null

    const cards = await ctx.db
      .query('flashcardRoomCards')
      .withIndex('by_roomId', (q) => q.eq('roomId', room._id))
      .collect()

    cards.sort((a, b) => a.displayOrder - b.displayOrder)
    return { room, cards }
  },
})

export const createCard = mutation({
  args: {
    roomId: v.id('flashcardRooms'),
    term: v.string(),
    definition: v.string(),
    metadata: metadataInput,
  },
  handler: async (ctx, args) => {
    const userId = await requireIdentity(ctx)
    const room = await requireOwnedRoom(ctx, args.roomId, userId)

    const term = args.term.trim()
    if (term.length === 0) throw new Error('Term required')
    const definition = args.definition.trim()
    if (definition.length === 0) throw new Error('Definition required')

    const max = await getMaxDisplayOrder(ctx, room._id)
    const metadata = await normalizeMetadata(ctx, userId, args.metadata)

    const cardId = await ctx.db.insert('flashcardRoomCards', {
      roomId: room._id,
      userId,
      displayOrder: max + 1,
      term,
      definition,
      metadata,
    })

    await ctx.db.patch(room._id, {
      activeVersionId: undefined,
      updatedAt: Date.now(),
      cardCount: (room.cardCount ?? 0) + 1,
    })

    return { cardId }
  },
})

export const updateCard = mutation({
  args: {
    cardId: v.id('flashcardRoomCards'),
    term: v.string(),
    definition: v.string(),
    metadata: metadataInput,
  },
  handler: async (ctx, args) => {
    const userId = await requireIdentity(ctx)
    const existing = await ctx.db.get(args.cardId)
    if (!existing || existing.userId !== userId) {
      throw new Error('Card not found')
    }

    const term = args.term.trim()
    if (term.length === 0) throw new Error('Term required')
    const definition = args.definition.trim()
    if (definition.length === 0) throw new Error('Definition required')

    const patch: Partial<RoomCardDoc> = { term, definition }
    if (args.metadata !== undefined) {
      patch.metadata = await normalizeMetadata(ctx, userId, args.metadata)
    }

    await ctx.db.patch(args.cardId, patch)
    await ctx.db.patch(existing.roomId, {
      activeVersionId: undefined,
      updatedAt: Date.now(),
    })

    return { cardId: args.cardId }
  },
})

export const deleteCard = mutation({
  args: { cardId: v.id('flashcardRoomCards') },
  handler: async (ctx, args) => {
    const userId = await requireIdentity(ctx)
    const existing = await ctx.db.get(args.cardId)
    if (!existing || existing.userId !== userId) {
      throw new Error('Card not found')
    }

    const roomId = existing.roomId
    await ctx.db.delete(args.cardId)
    const room = await ctx.db.get(roomId)
    const nextCount = Math.max(0, (room?.cardCount ?? 0) - 1)
    await ctx.db.patch(roomId, {
      activeVersionId: undefined,
      updatedAt: Date.now(),
      cardCount: nextCount,
    })

    return { cardId: args.cardId, roomId }
  },
})

export const reorderCards = mutation({
  args: {
    roomId: v.id('flashcardRooms'),
    order: v.array(
      v.object({
        cardId: v.id('flashcardRoomCards'),
        displayOrder: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await requireIdentity(ctx)
    const room = await requireOwnedRoom(ctx, args.roomId, userId)

    const currentCards = await ctx.db
      .query('flashcardRoomCards')
      .withIndex('by_roomId', (q) => q.eq('roomId', room._id))
      .collect()

    const currentIds = new Set(currentCards.map((c) => String(c._id)))

    for (const entry of args.order) {
      if (!currentIds.has(String(entry.cardId))) {
        throw new Error('Invalid card')
      }
    }

    if (args.order.length !== currentCards.length) {
      throw new Error('Invalid reorder permutation')
    }

    const seenIds = new Set<string>()
    const seenOrders = new Set<number>()
    const n = currentCards.length

    for (const entry of args.order) {
      const key = String(entry.cardId)
      if (seenIds.has(key)) throw new Error('Invalid reorder permutation')
      seenIds.add(key)

      if (
        !Number.isInteger(entry.displayOrder) ||
        entry.displayOrder < 0 ||
        entry.displayOrder >= n ||
        seenOrders.has(entry.displayOrder)
      ) {
        throw new Error('Invalid reorder permutation')
      }
      seenOrders.add(entry.displayOrder)
    }

    for (const entry of args.order) {
      await ctx.db.patch(entry.cardId, { displayOrder: entry.displayOrder })
    }

    await ctx.db.patch(room._id, {
      activeVersionId: undefined,
      updatedAt: Date.now(),
    })

    return { roomId: room._id, updated: args.order.length }
  },
})

export const generateRoomCards = mutation({
  args: {
    roomId: v.id('flashcardRooms'),
    origin: v.union(v.literal('ai'), v.literal('manual')),
    prompt: v.optional(v.string()),
    requestedCardCount: v.optional(v.number()),
    model: v.optional(v.string()),
    title: v.optional(v.string()),
    cards: v.array(
      v.object({
        term: v.string(),
        definition: v.string(),
        metadata: metadataInput,
      }),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await requireIdentity(ctx)
    const room = await requireOwnedRoom(ctx, args.roomId, userId)

    const archiveOpts = await resolveArchiveOpts(ctx, room)
    await archiveCurrentCards(ctx, room, archiveOpts)

    // Delete current cards
    await deleteAllRoomCards(ctx, room._id)

    // Insert new cards
    const title = normalizeTitle(args.title, room.title || 'Flash Cards')
    const versionId = await ctx.db.insert('flashcardRoomVersions', {
      roomId: room._id,
      userId,
      title,
      origin: args.origin,
      prompt: args.prompt,
      requestedCardCount: args.requestedCardCount,
      cardCount: args.cards.length,
      model: args.model,
    })

    let inserted = 0
    for (let i = 0; i < args.cards.length; i++) {
      const c = args.cards[i]!
      const term = c.term.trim()
      const definition = c.definition.trim()
      if (!term || !definition) continue
      const metadata = await normalizeMetadata(ctx, userId, c.metadata)

      await ctx.db.insert('flashcardRoomCards', {
        roomId: room._id,
        userId,
        displayOrder: i,
        term,
        definition,
        metadata,
      })
      await ctx.db.insert('flashcardVersionCards', {
        versionId,
        roomId: room._id,
        userId,
        displayOrder: i,
        term,
        definition,
        metadata,
      })
      inserted += 1
    }

    if (inserted === 0) {
      await ctx.db.delete(versionId)
      throw new Error('Generation produced no valid cards')
    }

    await ctx.db.patch(versionId, { cardCount: inserted })
    await ctx.db.patch(room._id, {
      activeVersionId: versionId,
      updatedAt: Date.now(),
      cardCount: inserted,
    })

    return { roomId: room._id, versionId, cardCount: inserted }
  },
})

export const listRoomVersions = query({
  args: { roomId: v.id('flashcardRooms') },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return []

    const userId = identity.tokenIdentifier
    const room = await ctx.db.get(args.roomId)
    if (!room || room.userId !== userId) return []

    const versions = await ctx.db
      .query('flashcardRoomVersions')
      .withIndex('by_roomId', (q) => q.eq('roomId', args.roomId))
      .order('desc')
      .take(100)

    return versions.map((v) => ({
      _id: v._id,
      _creationTime: v._creationTime,
      title: v.title,
      origin: v.origin,
      prompt: v.prompt,
      requestedCardCount: v.requestedCardCount,
      cardCount: v.cardCount,
      model: v.model,
    }))
  },
})

export const getRoomVersion = query({
  args: { versionId: v.id('flashcardRoomVersions') },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return null

    const userId = identity.tokenIdentifier
    const version = await ctx.db.get(args.versionId)
    if (!version || version.userId !== userId) return null

    const cards = await ctx.db
      .query('flashcardVersionCards')
      .withIndex('by_versionId', (q) => q.eq('versionId', args.versionId))
      .collect()

    cards.sort((a, b) => a.displayOrder - b.displayOrder)
    return { version, cards }
  },
})

export const restoreRoomVersion = mutation({
  args: {
    roomId: v.id('flashcardRooms'),
    versionId: v.id('flashcardRoomVersions'),
  },
  handler: async (ctx, args) => {
    const userId = await requireIdentity(ctx)
    const room = await requireOwnedRoom(ctx, args.roomId, userId)

    const version = await ctx.db.get(args.versionId)
    if (!version || version.userId !== userId) throw new Error('Version not found')
    if (version.roomId !== room._id) throw new Error('Version not found')

    const restoreArchiveOpts = await resolveArchiveOpts(ctx, room)
    await archiveCurrentCards(ctx, room, restoreArchiveOpts)

    await deleteAllRoomCards(ctx, room._id)

    const versionCards = await ctx.db
      .query('flashcardVersionCards')
      .withIndex('by_versionId', (q) => q.eq('versionId', args.versionId))
      .collect()

    const sorted = [...versionCards].sort((a, b) => a.displayOrder - b.displayOrder)

    for (const card of sorted) {
      await ctx.db.insert('flashcardRoomCards', {
        roomId: room._id,
        userId,
        displayOrder: card.displayOrder,
        term: card.term,
        definition: card.definition,
        metadata: card.metadata,
      })
    }

    await ctx.db.patch(room._id, {
      activeVersionId: args.versionId,
      updatedAt: Date.now(),
      cardCount: sorted.length,
    })

    return { roomId: room._id, versionId: args.versionId, cardCount: sorted.length }
  },
})

export const deleteRoom = mutation({
  args: { roomId: v.id('flashcardRooms') },
  handler: async (ctx, args) => {
    const userId = await requireIdentity(ctx)
    const room = await requireOwnedRoom(ctx, args.roomId, userId)

    await deleteAllRoomCards(ctx, room._id)

    while (true) {
      const batch = await ctx.db
        .query('flashcardVersionCards')
        .withIndex('by_roomId', (q) => q.eq('roomId', room._id))
        .take(500)
      if (batch.length === 0) break
      for (const row of batch) await ctx.db.delete(row._id)
      if (batch.length < 500) break
    }

    while (true) {
      const batch = await ctx.db
        .query('flashcardRoomVersions')
        .withIndex('by_roomId', (q) => q.eq('roomId', room._id))
        .take(500)
      if (batch.length === 0) break
      for (const row of batch) await ctx.db.delete(row._id)
      if (batch.length < 500) break
    }

    await ctx.db.delete(room._id)
    return { roomId: args.roomId }
  },
})
