import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'

const speakerValidator = v.union(v.literal('host_a'), v.literal('host_b'))

const turnInputValidator = v.object({
  speaker: speakerValidator,
  text: v.string(),
  audioFileId: v.id('_storage'),
  durationMs: v.number(),
  sourceIndex: v.optional(v.number()),
})

const voiceProfileValidator = v.object({
  hostA: v.string(),
  hostB: v.string(),
})

const preferencesValidator = v.object({
  lengthMinutes: v.number(),
  complexity: v.union(v.literal('beginner'), v.literal('expert')),
})

async function requireAuth(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) throw new Error('Unauthenticated')
  return identity.tokenIdentifier
}

async function requireFolder(
  ctx: QueryCtx | MutationCtx,
  folderId: Id<'folders'>,
  userId: string,
) {
  const folder = await ctx.db.get(folderId)
  if (!folder || folder.userId !== userId) throw new Error('Folder not found')
  return folder
}

export const generateTurnUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAuth(ctx)
    return await ctx.storage.generateUploadUrl()
  },
})

export const createWithTurns = mutation({
  args: {
    folderId: v.id('folders'),
    taskId: v.optional(v.id('tasks')),
    title: v.string(),
    model: v.optional(v.string()),
    turns: v.array(turnInputValidator),
    voiceProfile: voiceProfileValidator,
    preferences: v.optional(preferencesValidator),
    sourceDocumentIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    await requireFolder(ctx, args.folderId, userId)

    if (args.turns.length === 0) {
      throw new Error('Audio overview requires at least one turn')
    }

    const trimmedTitle = args.title.trim().slice(0, 120) || 'Audio Overview'
    const totalDurationMs = args.turns.reduce((sum, t) => sum + Math.max(0, t.durationMs), 0)

    const resolvedDocIds: Id<'documents'>[] = []
    if (args.sourceDocumentIds) {
      for (const raw of args.sourceDocumentIds) {
        const normalized = ctx.db.normalizeId('documents', raw)
        if (!normalized) continue
        const doc = await ctx.db.get(normalized)
        if (doc && doc.userId === userId) resolvedDocIds.push(normalized)
      }
    }

    const overviewId = await ctx.db.insert('audioOverviews', {
      userId,
      folderId: args.folderId,
      taskId: args.taskId,
      title: trimmedTitle,
      status: 'ready',
      model: args.model,
      turns: args.turns,
      voiceProfile: args.voiceProfile,
      preferences: args.preferences,
      totalDurationMs,
      sourceDocumentIds: resolvedDocIds.length > 0 ? resolvedDocIds : undefined,
    })

    return { overviewId }
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
      .query('audioOverviews')
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
      turnCount: row.turns.length,
      totalDurationMs: row.totalDurationMs,
      taskId: row.taskId,
    }))
  },
})

export const getWithTurns = query({
  args: { id: v.id('audioOverviews') },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return null

    const userId = identity.tokenIdentifier
    const overview = await ctx.db.get(args.id)
    if (!overview || overview.userId !== userId) return null

    return overview
  },
})

export const getTurnUrls = query({
  args: { id: v.id('audioOverviews') },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return null

    const userId = identity.tokenIdentifier
    const overview = await ctx.db.get(args.id)
    if (!overview || overview.userId !== userId) return null

    const urls: (string | null)[] = []
    for (const turn of overview.turns) {
      urls.push(await ctx.storage.getUrl(turn.audioFileId))
    }
    return urls
  },
})

export const deleteOverview = mutation({
  args: { id: v.id('audioOverviews') },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const overview = await ctx.db.get(args.id)
    if (!overview || overview.userId !== userId) throw new Error('Audio overview not found')

    for (const turn of overview.turns) {
      try {
        await ctx.storage.delete(turn.audioFileId)
      }
      catch {
        // tolerate orphan-already-deleted
      }
    }

    await ctx.db.delete(args.id)
    return { deletedTurns: overview.turns.length }
  },
})

export const deleteOrphanTurnBlob = mutation({
  args: { storageId: v.id('_storage') },
  handler: async (ctx, args) => {
    await requireAuth(ctx)
    try {
      await ctx.storage.delete(args.storageId)
    }
    catch {
      // tolerate already-deleted
    }
    return null
  },
})
