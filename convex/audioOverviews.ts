import { v } from 'convex/values'
import { internal } from './_generated/api'
import { internalMutation, mutation, query } from './_generated/server'
import type { Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'
import { requireAuth } from './lib/auth'
import {
  consumeVerifiedUploadClaims,
  releaseUploadOwnership,
  requireVerifiedUploadClaims,
} from './audioOverviewUploads'

const speakerValidator = v.union(v.literal('host_a'), v.literal('host_b'))

const turnInputValidator = v.object({
  speaker: speakerValidator,
  text: v.string(),
  audioFileId: v.id('_storage'),
  uploadClaimId: v.id('audioOverviewUploadClaims'),
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

    if (!args.taskId) throw new Error('Reserved audio overview task required')
    const task = await ctx.db.get(args.taskId)
    if (
      !task
      || task.userId !== userId
      || task.folderId !== args.folderId
      || task.type !== 'audio-overview-generation'
      || task.status !== 'running'
      || !task.audioOverviewRequest
    ) {
      throw new Error('Reserved audio overview task not found')
    }

    if (args.turns.length === 0) {
      throw new Error('Audio overview requires at least one turn')
    }
    if (args.turns.length > 50) throw new Error('Audio overview exceeds the turn limit')

    const claims = await requireVerifiedUploadClaims(ctx, userId, task._id, args.turns)
    const persistedTurns = args.turns.map(({ uploadClaimId: _claimId, ...turn }) => turn)
    const trimmedTitle = args.title.trim().slice(0, 120) || 'Audio Overview'
    const totalDurationMs = persistedTurns.reduce((sum, t) => sum + Math.max(0, t.durationMs), 0)

    const resolvedDocIds: Id<'documents'>[] = []
    if (args.sourceDocumentIds) {
      for (const raw of args.sourceDocumentIds) {
        const normalized = ctx.db.normalizeId('documents', raw)
        if (!normalized) throw new Error('Source not found')
        const doc = await ctx.db.get(normalized)
        if (!doc || doc.userId !== userId) throw new Error('Source not found')
        if (!task.audioOverviewRequest.documents.some(source => source.documentId === normalized)) {
          throw new Error('Source is outside the reserved scope')
        }
        resolvedDocIds.push(normalized)
      }
    }

    const resolvedScopeIds = task.audioOverviewRequest.documents.map(source => source.documentId)

    const overviewId = await ctx.db.insert('audioOverviews', {
      userId,
      folderId: args.folderId,
      taskId: args.taskId,
      title: trimmedTitle,
      status: 'ready',
      model: args.model,
      turns: persistedTurns,
      voiceProfile: args.voiceProfile,
      preferences: args.preferences,
      totalDurationMs,
      sourceDocumentIds: resolvedDocIds.length > 0 ? resolvedDocIds : undefined,
      scopeDocIds: resolvedScopeIds,
    })

    await consumeVerifiedUploadClaims(ctx, claims)
    const now = Date.now()
    await ctx.db.patch(task._id, {
      status: 'completed',
      result: { overviewId, turnCount: persistedTurns.length },
      progress: 'Complete',
      updatedAt: now,
      completedAt: now,
    })

    return { overviewId }
  },
})

export const createCourseScopedOverview = mutation({
  args: {
    folderId: v.id('folders'),
    taskId: v.id('tasks'),
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
    const task = await ctx.db.get(args.taskId)
    if (
      !task
      || task.userId !== userId
      || task.folderId !== args.folderId
      || task.type !== 'audio-overview-generation'
      || task.status !== 'running'
      || !task.audioOverviewRequest
    ) {
      throw new Error('Reserved audio overview task not found')
    }

    if (args.turns.length === 0) {
      throw new Error('Audio overview requires at least one turn')
    }
    if (args.turns.length > 16) throw new Error('Audio primer exceeds the turn limit')

    const claims = await requireVerifiedUploadClaims(ctx, userId, task._id, args.turns)
    const persistedTurns = args.turns.map(({ uploadClaimId: _claimId, ...turn }) => turn)
    const trimmedTitle = args.title.trim().slice(0, 120) || 'Audio Primer'
    const totalDurationMs = persistedTurns.reduce((sum, t) => sum + Math.max(0, t.durationMs), 0)

    const resolvedDocIds: Id<'documents'>[] = []
    if (args.sourceDocumentIds) {
      for (const raw of args.sourceDocumentIds) {
        const normalized = ctx.db.normalizeId('documents', raw)
        if (!normalized) throw new Error('Source not found')
        const doc = await ctx.db.get(normalized)
        if (!doc || doc.userId !== userId) throw new Error('Source not found')
        if (!task.audioOverviewRequest.documents.some(source => source.documentId === normalized)) {
          throw new Error('Source is outside the reserved scope')
        }
        resolvedDocIds.push(normalized)
      }
    }

    const overviewId = await ctx.db.insert('audioOverviews', {
      userId,
      folderId: args.folderId,
      taskId: args.taskId,
      title: trimmedTitle,
      status: 'ready',
      model: args.model,
      turns: persistedTurns,
      voiceProfile: args.voiceProfile,
      preferences: args.preferences,
      totalDurationMs,
      sourceDocumentIds: resolvedDocIds.length > 0 ? resolvedDocIds : undefined,
      scopeDocIds: task.audioOverviewRequest.documents.map(source => source.documentId),
      courseScoped: true,
    })

    await consumeVerifiedUploadClaims(ctx, claims)
    const now = Date.now()
    await ctx.db.patch(task._id, {
      status: 'completed',
      result: { overviewId, turnCount: persistedTurns.length },
      progress: 'Complete',
      updatedAt: now,
      completedAt: now,
    })

    return { overviewId }
  },
})

export const getCourseScopedOverview = query({
  args: { id: v.id('audioOverviews') },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return null

    const userId = identity.tokenIdentifier
    const overview = await ctx.db.get(args.id)
    if (!overview || overview.userId !== userId) return null

    const turnUrls: (string | null)[] = []
    for (const turn of overview.turns) {
      turnUrls.push(await ctx.storage.getUrl(turn.audioFileId))
    }

    const sourceFilenames: string[] = []
    for (const docId of overview.sourceDocumentIds ?? []) {
      const doc = await ctx.db.get(docId)
      sourceFilenames.push(doc?.filename ?? 'Source')
    }

    return {
      _id: overview._id,
      title: overview.title,
      status: overview.status,
      turns: overview.turns,
      turnUrls,
      voiceProfile: overview.voiceProfile,
      totalDurationMs: overview.totalDurationMs,
      sourceDocumentIds: overview.sourceDocumentIds ?? [],
      sourceFilenames,
    }
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

    await scheduleAudioOverviewDeletion(ctx, overview._id, userId)
    return { scheduled: true }
  },
})

export async function scheduleAudioOverviewDeletion(
  ctx: MutationCtx,
  overviewId: Id<'audioOverviews'>,
  userId: string,
): Promise<void> {
  const overview = await ctx.db.get(overviewId)
  if (!overview || overview.userId !== userId) return
  if (overview.status !== 'deleting' || overview.shareToken || overview.publishedAt) {
    await ctx.db.patch(overview._id, {
      status: 'deleting',
      shareToken: undefined,
      publishedAt: undefined,
    })
  }
  await ctx.scheduler.runAfter(0, internal.audioOverviews.deleteOverviewBatch, {
    overviewId: overview._id,
    userId,
  })
}

export const deleteFolderOverviews = internalMutation({
  args: {
    folderId: v.id('folders'),
    userId: v.string(),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const batch = await ctx.db
      .query('audioOverviews')
      .withIndex('by_folderId', q => q.eq('folderId', args.folderId))
      .paginate({ cursor: args.cursor, numItems: 25 })
    for (const overview of batch.page) {
      if (overview.userId === args.userId) {
        await scheduleAudioOverviewDeletion(ctx, overview._id, args.userId)
      }
    }
    if (!batch.isDone) {
      await ctx.scheduler.runAfter(0, internal.audioOverviews.deleteFolderOverviews, {
        ...args,
        cursor: batch.continueCursor,
      })
    }
  },
})

export const deleteUserOverviews = internalMutation({
  args: {
    userId: v.string(),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const batch = await ctx.db
      .query('audioOverviews')
      .withIndex('by_userId', q => q.eq('userId', args.userId))
      .paginate({ cursor: args.cursor, numItems: 25 })
    for (const overview of batch.page) {
      await scheduleAudioOverviewDeletion(ctx, overview._id, args.userId)
    }
    if (!batch.isDone) {
      await ctx.scheduler.runAfter(0, internal.audioOverviews.deleteUserOverviews, {
        ...args,
        cursor: batch.continueCursor,
      })
    }
  },
})

async function deleteTurnStorage(ctx: MutationCtx, storageId: Id<'_storage'>): Promise<boolean> {
  let deletionSucceeded = false
  try {
    await ctx.storage.delete(storageId)
    deletionSucceeded = true
  }
  catch {
    try {
      deletionSucceeded = (await ctx.storage.getUrl(storageId)) === null
    }
    catch { /* retry in a later batch */ }
  }
  await releaseUploadOwnership(ctx, storageId, deletionSucceeded)
  return deletionSucceeded
}

export const deleteOverviewBatch = internalMutation({
  args: {
    overviewId: v.id('audioOverviews'),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const overview = await ctx.db.get(args.overviewId)
    if (!overview || overview.userId !== args.userId || overview.status !== 'deleting') return

    const interjection = await ctx.db
      .query('audioOverviewInterjections')
      .withIndex('by_audioOverview', q => q.eq('audioOverviewId', overview._id))
      .first()
    if (interjection) {
      const batch = interjection.answerTurns.slice(0, 4)
      const failed: typeof batch = []
      for (const turn of batch) {
        if (!(await deleteTurnStorage(ctx, turn.audioFileId))) failed.push(turn)
      }
      const remaining = [...failed, ...interjection.answerTurns.slice(batch.length)]
      if (remaining.length > 0) await ctx.db.patch(interjection._id, { answerTurns: remaining })
      else await ctx.db.delete(interjection._id)
      await ctx.scheduler.runAfter(failed.length > 0 ? 60_000 : 0, internal.audioOverviews.deleteOverviewBatch, args)
      return
    }

    const batch = overview.turns.slice(0, 10)
    const failed: typeof batch = []
    for (const turn of batch) {
      if (!(await deleteTurnStorage(ctx, turn.audioFileId))) failed.push(turn)
    }
    const remaining = [...failed, ...overview.turns.slice(batch.length)]
    if (remaining.length > 0) {
      await ctx.db.patch(overview._id, { turns: remaining })
      await ctx.scheduler.runAfter(failed.length > 0 ? 60_000 : 0, internal.audioOverviews.deleteOverviewBatch, args)
      return
    }
    await ctx.db.delete(overview._id)
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
    const folder = await ctx.db.get(overview.folderId)
    if (!folder || folder.userId !== overview.userId) return null

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
    const folder = await ctx.db.get(overview.folderId)
    if (!folder || folder.userId !== overview.userId) return null

    const urls: (string | null)[] = []
    for (const turn of overview.turns) {
      urls.push(await ctx.storage.getUrl(turn.audioFileId))
    }
    return urls
  },
})
