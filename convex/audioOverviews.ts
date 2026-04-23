import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'
import { requireAuth } from './lib/auth'

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
    scopeDocIds: v.optional(v.array(v.string())),
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

    const resolvedScopeIds: Id<'documents'>[] = []
    if (args.scopeDocIds) {
      for (const raw of args.scopeDocIds) {
        const normalized = ctx.db.normalizeId('documents', raw)
        if (!normalized) continue
        const doc = await ctx.db.get(normalized)
        if (doc && doc.userId === userId) resolvedScopeIds.push(normalized)
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
      scopeDocIds: resolvedScopeIds.length > 0 ? resolvedScopeIds : undefined,
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

    const allRows = await ctx.db
      .query('audioOverviews')
      .withIndex('by_userId_and_folderId', (q) =>
        q.eq('userId', userId).eq('folderId', args.folderId),
      )
      .order('desc')
      .collect()

    const rows = allRows.filter((r) => r.courseScoped !== true)

    return rows.map((row) => ({
      _id: row._id,
      _creationTime: row._creationTime,
      title: row.title,
      status: row.status,
      turnCount: row.turns.length,
      totalDurationMs: row.totalDurationMs,
      taskId: row.taskId,
      shareToken: row.shareToken,
      publishedAt: row.publishedAt,
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

const SHARE_TOKEN_PATTERN = /^[0-9a-f]{32}$/

function generateShareToken(): string {
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

export const publishOverview = mutation({
  args: { id: v.id('audioOverviews') },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const overview = await ctx.db.get(args.id)
    if (!overview || overview.userId !== userId) throw new Error('Audio overview not found')
    if (overview.status !== 'ready') throw new Error('Audio overview is not ready to share')

    if (overview.shareToken) {
      return { token: overview.shareToken, publishedAt: overview.publishedAt ?? Date.now() }
    }

    let token = ''
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = generateShareToken()
      const collision = await ctx.db
        .query('audioOverviews')
        .withIndex('by_shareToken', (q) => q.eq('shareToken', candidate))
        .unique()
      if (!collision) { token = candidate; break }
    }
    if (!token) throw new Error('Failed to mint unique share token')

    const publishedAt = Date.now()
    await ctx.db.patch(args.id, { shareToken: token, publishedAt })
    return { token, publishedAt }
  },
})

export const unpublishOverview = mutation({
  args: { id: v.id('audioOverviews') },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const overview = await ctx.db.get(args.id)
    if (!overview || overview.userId !== userId) throw new Error('Audio overview not found')
    await ctx.db.patch(args.id, { shareToken: undefined, publishedAt: undefined })
    return null
  },
})

export const getByShareToken = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    if (!SHARE_TOKEN_PATTERN.test(args.token)) return null
    const overview = await ctx.db
      .query('audioOverviews')
      .withIndex('by_shareToken', (q) => q.eq('shareToken', args.token))
      .unique()
    if (!overview || overview.status !== 'ready') return null

    const ids = overview.sourceDocumentIds ?? []
    const sourceFilenames: string[] = []
    for (const id of ids) {
      const doc = await ctx.db.get(id)
      sourceFilenames.push(doc?.filename ?? 'Source')
    }

    return {
      title: overview.title,
      turns: overview.turns.map(t => ({
        speaker: t.speaker,
        text: t.text,
        audioFileId: t.audioFileId,
        durationMs: t.durationMs,
        sourceIndex: t.sourceIndex,
      })),
      voiceProfile: overview.voiceProfile,
      totalDurationMs: overview.totalDurationMs,
      sourceDocumentIds: overview.sourceDocumentIds ?? [],
      sourceFilenames,
      publishedAt: overview.publishedAt ?? null,
    }
  },
})

export const getTurnUrlsByShareToken = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    if (!SHARE_TOKEN_PATTERN.test(args.token)) return null
    const overview = await ctx.db
      .query('audioOverviews')
      .withIndex('by_shareToken', (q) => q.eq('shareToken', args.token))
      .unique()
    if (!overview || overview.status !== 'ready') return null

    const urls: (string | null)[] = []
    for (const turn of overview.turns) {
      urls.push(await ctx.storage.getUrl(turn.audioFileId))
    }
    return urls
  },
})
