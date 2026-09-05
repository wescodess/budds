import { v } from 'convex/values'
import { internal } from './_generated/api'
import { internalMutation, mutation, query } from './_generated/server'
import type { Id } from './_generated/dataModel'
import type { MutationCtx } from './_generated/server'
import { getOptionalAuthUserId, requireAuth } from './lib/auth'
import { releaseUploadOwnership } from './audioOverviewUploads'
import { stageV2OverviewDeletion } from './audioOverviewV2'
import { rejectLegacyAudioOverviewWrite } from './lib/audioOverviewLegacyBoundary'
import { hasAccountDeletionTombstone } from './lib/accountDeletionTombstone'

const speakerValidator = v.union(v.literal('host_a'), v.literal('host_b'))

const turnInputValidator = v.object({
  speaker: speakerValidator,
  text: v.string(),
  audioFileId: v.id('_storage'),
  uploadClaimId: v.id('audioOverviewUploadClaims'),
  durationMs: v.number(),
  sourceIndex: v.optional(v.number()),
  wordTimings: v.optional(v.array(
    v.object({
      word: v.string(),
      start: v.number(),
      end: v.number(),
    }),
  )),
})

const voiceProfileValidator = v.object({
  hostA: v.string(),
  hostB: v.string(),
})

const preferencesValidator = v.object({
  lengthMinutes: v.number(),
  complexity: v.union(v.literal('beginner'), v.literal('expert')),
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
  handler: async (ctx) => {
    await requireAuth(ctx)
    rejectLegacyAudioOverviewWrite()
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
  handler: async (ctx) => {
    await requireAuth(ctx)
    rejectLegacyAudioOverviewWrite()
  },
})

export const getCourseScopedOverview = query({
  args: { id: v.id('audioOverviews') },
  handler: async (ctx, args) => {
    const userId = await getOptionalAuthUserId(ctx)
    if (!userId) return null
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
    const userId = await getOptionalAuthUserId(ctx)
    if (!userId) return []

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
    const userId = await getOptionalAuthUserId(ctx)
    if (!userId) return null
    const overview = await ctx.db.get(args.id)
    if (!overview || overview.userId !== userId) return null

    return overview
  },
})

export const getTurnUrls = query({
  args: { id: v.id('audioOverviews') },
  handler: async (ctx, args) => {
    const userId = await getOptionalAuthUserId(ctx)
    if (!userId) return null
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
  if (await stageV2OverviewDeletion(ctx, overview, userId)) return
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
    if (await hasAccountDeletionTombstone(ctx, overview.userId)) return null
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
    if (await hasAccountDeletionTombstone(ctx, overview.userId)) return null
    const folder = await ctx.db.get(overview.folderId)
    if (!folder || folder.userId !== overview.userId) return null

    const urls: (string | null)[] = []
    for (const turn of overview.turns) {
      urls.push(await ctx.storage.getUrl(turn.audioFileId))
    }
    return urls
  },
})
