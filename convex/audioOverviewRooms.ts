import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { getOptionalAuthUserId, requireAuth } from './lib/auth'
import { scheduleAudioOverviewDeletion } from './audioOverviews'

function normalizedTitle(value: string | undefined): string {
  return value?.trim().slice(0, 60) || 'Audio Overview'
}

export const create = mutation({
  args: {
    folderId: v.id('folders'),
    title: v.optional(v.string()),
    conversationId: v.optional(v.id('conversations')),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const folder = await ctx.db.get(args.folderId)
    if (!folder || folder.userId !== userId) throw new Error('Folder not found')

    if (args.conversationId) {
      const conversation = await ctx.db.get(args.conversationId)
      if (!conversation || conversation.userId !== userId || conversation.folderId !== args.folderId) {
        throw new Error('Conversation not found')
      }
      const existing = await ctx.db
        .query('audioOverviewRooms')
        .withIndex('by_userId_and_conversationId', q => q
          .eq('userId', userId)
          .eq('conversationId', args.conversationId))
        .unique()
      if (existing) return { roomId: existing._id, created: false as const }
    }

    const now = Date.now()
    const roomId = await ctx.db.insert('audioOverviewRooms', {
      userId,
      folderId: args.folderId,
      ...(args.conversationId ? { conversationId: args.conversationId } : {}),
      title: normalizedTitle(args.title),
      createdAt: now,
      updatedAt: now,
    })
    return { roomId, created: true as const }
  },
})

export const listByFolder = query({
  args: { folderId: v.id('folders') },
  handler: async (ctx, args) => {
    const userId = await getOptionalAuthUserId(ctx)
    if (!userId) return []
    const folder = await ctx.db.get(args.folderId)
    if (!folder || folder.userId !== userId) return []
    return await ctx.db
      .query('audioOverviewRooms')
      .withIndex('by_userId_and_folderId', q => q.eq('userId', userId).eq('folderId', args.folderId))
      .order('desc')
      .take(100)
  },
})

export const ensureLegacyImport = mutation({
  args: { folderId: v.id('folders') },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const folder = await ctx.db.get(args.folderId)
    if (!folder || folder.userId !== userId) throw new Error('Folder not found')
    const folderOverviews = await ctx.db
      .query('audioOverviews')
      .withIndex('by_userId_and_folderId', q => q.eq('userId', userId).eq('folderId', args.folderId))
      .order('desc')
      .take(101)
    const legacy = folderOverviews.filter(row => !row.roomId && row.courseScoped !== true)
    if (legacy.length === 0) return { roomId: null, imported: 0 }
    if (legacy.length > 100) throw new Error('Legacy Audio Overview history requires a batched migration')

    const rooms = await ctx.db
      .query('audioOverviewRooms')
      .withIndex('by_userId_and_folderId', q => q.eq('userId', userId).eq('folderId', args.folderId))
      .take(100)
    let room = rooms.find(candidate => candidate.legacyImport === true)
    if (!room) {
      const now = Date.now()
      const roomId = await ctx.db.insert('audioOverviewRooms', {
        userId,
        folderId: args.folderId,
        title: 'Imported audio overviews',
        legacyImport: true,
        createdAt: now,
        updatedAt: now,
      })
      room = (await ctx.db.get(roomId))!
    }
    for (const overview of legacy) await ctx.db.patch(overview._id, { roomId: room._id })
    return { roomId: room._id, imported: legacy.length }
  },
})

export const getForConversation = query({
  args: { conversationId: v.id('conversations') },
  handler: async (ctx, args) => {
    const userId = await getOptionalAuthUserId(ctx)
    if (!userId) return null
    const conversation = await ctx.db.get(args.conversationId)
    if (!conversation || conversation.userId !== userId) return null
    return await ctx.db
      .query('audioOverviewRooms')
      .withIndex('by_userId_and_conversationId', q => q
        .eq('userId', userId)
        .eq('conversationId', args.conversationId))
      .unique()
  },
})

export const remove = mutation({
  args: { roomId: v.id('audioOverviewRooms') },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const room = await ctx.db.get(args.roomId)
    if (!room || room.userId !== userId) throw new Error('Audio Overview room not found')
    for (const status of ['pending', 'running'] as const) {
      const tasks = await ctx.db
        .query('tasks')
        .withIndex('by_userId_and_type_and_status', q => q
          .eq('userId', userId)
          .eq('type', 'audio-overview-generation')
          .eq('status', status))
        .take(100)
      if (tasks.some(task => task.audioOverviewRequest?.roomId === room._id)) {
        throw new Error('Cancel the active Audio Overview generation before deleting this room')
      }
    }
    const overviews = await ctx.db
      .query('audioOverviews')
      .withIndex('by_userId_and_roomId', q => q.eq('userId', userId).eq('roomId', room._id))
      .take(101)
    if (overviews.length > 100) throw new Error('Audio Overview room is too large to delete')
    for (const overview of overviews) await scheduleAudioOverviewDeletion(ctx, overview._id, userId)
    await ctx.db.delete(room._id)
    return { deleted: true }
  },
})
