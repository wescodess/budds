import { v } from 'convex/values'
import { mutation, query, internalMutation } from './_generated/server'
import type { Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'
import {
  AUDIO_OVERVIEW_DAILY_CAP,
  AUDIO_OVERVIEW_MAX_EXPLICIT_SOURCES,
  todayUtcYmd,
} from './lib/audioOverviewPolicy'

async function requireIdentity(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) throw new Error('Unauthenticated')
  return identity.tokenIdentifier
}

const audioOverviewScopeValidator = v.union(
  v.object({ mode: v.literal('folder') }),
  v.object({
    mode: v.literal('explicit'),
    documentIds: v.array(v.id('documents')),
  }),
)

const audioOverviewPreferencesValidator = v.object({
  lengthMinutes: v.union(v.literal(5), v.literal(10), v.literal(20)),
  complexity: v.union(v.literal('beginner'), v.literal('expert')),
})

const audioOverviewVoiceValidator = v.union(
  v.literal('asteria'),
  v.literal('luna'),
  v.literal('stella'),
  v.literal('athena'),
  v.literal('hera'),
  v.literal('orion'),
  v.literal('arcas'),
  v.literal('perseus'),
  v.literal('angus'),
  v.literal('orpheus'),
  v.literal('helios'),
  v.literal('zeus'),
)

const audioOverviewVoiceProfileValidator = v.object({
  hostA: audioOverviewVoiceValidator,
  hostB: audioOverviewVoiceValidator,
})

export async function cancelActiveAudioOverviewTasksForFolders(
  ctx: MutationCtx,
  userId: string,
  folderIds: Set<string>,
): Promise<number> {
  const now = Date.now()
  let cancelled = 0
  for (const status of ['pending', 'running'] as const) {
    const tasks = await ctx.db
      .query('tasks')
      .withIndex('by_userId_and_type_and_status', q => q
        .eq('userId', userId)
        .eq('type', 'audio-overview-generation')
        .eq('status', status))
      .take(100)
    for (const task of tasks) {
      const primaryFolderDeleted = task.folderId && folderIds.has(String(task.folderId))
      const referencedFolderDeleted = task.audioOverviewRequest?.documents.some(document =>
        folderIds.has(String(document.folderId)),
      ) ?? false
      if (!primaryFolderDeleted && !referencedFolderDeleted) continue
      await ctx.db.patch(task._id, {
        status: 'cancelled',
        updatedAt: now,
        completedAt: now,
      })
      cancelled += 1
    }
  }
  return cancelled
}

export const requestAudioOverview = mutation({
  args: {
    folderId: v.id('folders'),
    scope: audioOverviewScopeValidator,
    preferences: audioOverviewPreferencesValidator,
    voiceProfile: audioOverviewVoiceProfileValidator,
  },
  handler: async (ctx, args) => {
    const userId = await requireIdentity(ctx)
    const folder = await ctx.db.get(args.folderId)
    if (!folder || folder.userId !== userId) throw new Error('Folder not found')

    const documents: Array<{
      documentId: Id<'documents'>
      folderId: Id<'folders'>
      filename: string
      r2Key?: string
    }> = []
    if (args.scope.mode === 'explicit') {
      if (args.scope.documentIds.length === 0) {
        throw new Error('Explicit scope requires at least one source')
      }
      if (args.scope.documentIds.length > AUDIO_OVERVIEW_MAX_EXPLICIT_SOURCES) {
        throw new Error('Explicit scope exceeds the source limit')
      }

      const seen = new Set<string>()
      for (const documentId of args.scope.documentIds) {
        if (seen.has(documentId)) continue
        seen.add(documentId)
        const document = await ctx.db.get(documentId)
        if (!document || document.userId !== userId || document.status !== 'success') {
          throw new Error('Source not found or not ready')
        }
        documents.push({
          documentId: document._id,
          folderId: document.folderId,
          filename: document.filename,
          r2Key: document.r2Key,
        })
      }
    }
    else {
      const folderDocuments = await ctx.db
        .query('documents')
        .withIndex('by_userId_and_folderId_and_status', q => q
          .eq('userId', userId)
          .eq('folderId', args.folderId)
          .eq('status', 'success'))
        .take(AUDIO_OVERVIEW_MAX_EXPLICIT_SOURCES + 1)
      if (folderDocuments.length === 0) throw new Error('Folder has no ready sources')
      if (folderDocuments.length > AUDIO_OVERVIEW_MAX_EXPLICIT_SOURCES) {
        throw new Error('Folder scope exceeds the source limit')
      }
      documents.push(...folderDocuments.map(document => ({
        documentId: document._id,
        folderId: document.folderId,
        filename: document.filename,
        r2Key: document.r2Key,
      })))
    }

    const pendingTask = await ctx.db
      .query('tasks')
      .withIndex('by_userId_and_type_and_status', q => q
        .eq('userId', userId)
        .eq('type', 'audio-overview-generation')
        .eq('status', 'pending'))
      .first()
    const runningTask = await ctx.db
      .query('tasks')
      .withIndex('by_userId_and_type_and_status', q => q
        .eq('userId', userId)
        .eq('type', 'audio-overview-generation')
        .eq('status', 'running'))
      .first()
    if (pendingTask || runningTask) {
      throw new Error('An audio overview generation is already active')
    }

    const user = await ctx.db
      .query('users')
      .withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', userId))
      .unique()
    if (!user) throw new Error('User not found')

    const quotaDate = todayUtcYmd()
    const used = user.audioOverviewQuota?.date === quotaDate
      ? user.audioOverviewQuota.count
      : 0
    if (used >= AUDIO_OVERVIEW_DAILY_CAP) {
      throw new Error('Daily audio overview quota reached')
    }

    const now = Date.now()
    const taskId = await ctx.db.insert('tasks', {
      userId,
      folderId: args.folderId,
      type: 'audio-overview-generation',
      status: 'pending',
      title: 'Generating audio overview…',
      progress: 'Preparing…',
      createdAt: now,
      updatedAt: now,
      audioOverviewRequest: {
        scope: args.scope,
        documents,
        preferences: args.preferences,
        voiceProfile: args.voiceProfile,
        quotaDate,
      },
    })
    const nextUsed = used + 1
    await ctx.db.patch(user._id, {
      audioOverviewQuota: { date: quotaDate, count: nextUsed },
    })

    return {
      taskId,
      quota: { used: nextUsed, cap: AUDIO_OVERVIEW_DAILY_CAP, date: quotaDate },
    }
  },
})

export const claimAudioOverviewGeneration = mutation({
  args: { taskId: v.id('tasks') },
  handler: async (ctx, args) => {
    const userId = await requireIdentity(ctx)
    const task = await ctx.db.get(args.taskId)
    if (
      !task
      || task.userId !== userId
      || task.type !== 'audio-overview-generation'
      || task.status !== 'pending'
      || !task.folderId
      || !task.audioOverviewRequest
    ) {
      throw new Error('Audio overview generation is not available')
    }

    await ctx.db.patch(task._id, {
      status: 'running',
      progress: 'Retrieving sources…',
      updatedAt: Date.now(),
    })

    return {
      folderId: task.folderId,
      ...task.audioOverviewRequest,
    }
  },
})

export const create = mutation({
  args: {
    folderId: v.id('folders'),
    type: v.string(),
    title: v.string(),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const userId = await requireIdentity(ctx)

    const folder = await ctx.db.get(args.folderId)
    if (!folder || folder.userId !== userId) {
      throw new Error('Folder not found')
    }

    const now = Date.now()
    const taskId = await ctx.db.insert('tasks', {
      userId,
      folderId: args.folderId,
      type: args.type,
      status: 'pending',
      title: args.title,
      progress: 'Preparing…',
      metadata: args.metadata,
      createdAt: now,
      updatedAt: now,
    })

    return { taskId }
  },
})

export const createInternal = internalMutation({
  args: {
    userId: v.string(),
    folderId: v.optional(v.id('folders')),
    type: v.string(),
    title: v.string(),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const taskId = await ctx.db.insert('tasks', {
      userId: args.userId,
      folderId: args.folderId,
      type: args.type,
      status: 'pending',
      title: args.title,
      progress: 'Preparing...',
      metadata: args.metadata,
      createdAt: now,
      updatedAt: now,
    })
    return taskId
  },
})

export const updateProgress = internalMutation({
  args: {
    taskId: v.id('tasks'),
    progress: v.string(),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId)
    if (!task) return
    if (task.status !== 'pending' && task.status !== 'running') return
    await ctx.db.patch(args.taskId, {
      progress: args.progress,
      status: task.status === 'pending' ? 'running' : task.status,
      updatedAt: Date.now(),
    })
  },
})

export const setProgress = mutation({
  args: {
    taskId: v.id('tasks'),
    progress: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireIdentity(ctx)
    const task = await ctx.db.get(args.taskId)
    if (!task || task.userId !== userId) return
    if (task.status !== 'pending' && task.status !== 'running') return
    await ctx.db.patch(args.taskId, {
      progress: args.progress,
      status: task.status === 'pending' ? 'running' : task.status,
      updatedAt: Date.now(),
    })
  },
})

export const complete = internalMutation({
  args: {
    taskId: v.id('tasks'),
    result: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId)
    if (!task) return
    if (task.status !== 'pending' && task.status !== 'running') return
    const now = Date.now()
    await ctx.db.patch(args.taskId, {
      status: 'completed',
      result: args.result,
      progress: 'Complete',
      updatedAt: now,
      completedAt: now,
    })
  },
})

export const markComplete = mutation({
  args: {
    taskId: v.id('tasks'),
    result: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const userId = await requireIdentity(ctx)
    const task = await ctx.db.get(args.taskId)
    if (!task || task.userId !== userId) return
    if (task.type === 'audio-overview-generation') {
      throw new Error('Audio overview completion is generation-owned')
    }
    if (task.status !== 'pending' && task.status !== 'running') return
    const now = Date.now()
    await ctx.db.patch(args.taskId, {
      status: 'completed',
      result: args.result,
      progress: 'Complete',
      updatedAt: now,
      completedAt: now,
    })
  },
})

export const fail = internalMutation({
  args: {
    taskId: v.id('tasks'),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId)
    if (!task) return
    if (task.status !== 'pending' && task.status !== 'running') return
    const now = Date.now()
    await ctx.db.patch(args.taskId, {
      status: 'failed',
      error: args.error,
      updatedAt: now,
      completedAt: now,
    })
  },
})

export const markFailed = mutation({
  args: {
    taskId: v.id('tasks'),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireIdentity(ctx)
    const task = await ctx.db.get(args.taskId)
    if (!task || task.userId !== userId) return
    if (task.type === 'audio-overview-generation') {
      throw new Error('Audio overview failure is generation-owned')
    }
    if (task.status !== 'pending' && task.status !== 'running') return
    const now = Date.now()
    await ctx.db.patch(args.taskId, {
      status: 'failed',
      error: args.error,
      updatedAt: now,
      completedAt: now,
    })
  },
})

export const failAudioOverviewGeneration = mutation({
  args: {
    taskId: v.id('tasks'),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireIdentity(ctx)
    const task = await ctx.db.get(args.taskId)
    if (
      !task
      || task.userId !== userId
      || task.type !== 'audio-overview-generation'
      || task.status !== 'running'
    ) {
      throw new Error('Running audio overview task not found')
    }
    const now = Date.now()
    await ctx.db.patch(task._id, {
      status: 'failed',
      error: args.error.slice(0, 500),
      updatedAt: now,
      completedAt: now,
    })
  },
})

export const cancel = mutation({
  args: { taskId: v.id('tasks') },
  handler: async (ctx, args) => {
    const userId = await requireIdentity(ctx)
    const task = await ctx.db.get(args.taskId)
    if (!task || task.userId !== userId) {
      throw new Error('Task not found')
    }
    if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
      return
    }
    await ctx.db.patch(args.taskId, {
      status: 'cancelled',
      updatedAt: Date.now(),
      completedAt: Date.now(),
    })
  },
})

export const dismiss = mutation({
  args: { taskId: v.id('tasks') },
  handler: async (ctx, args) => {
    const userId = await requireIdentity(ctx)
    const task = await ctx.db.get(args.taskId)
    if (!task || task.userId !== userId) {
      throw new Error('Task not found')
    }
    if (task.status === 'pending' || task.status === 'running') {
      throw new Error('Active tasks cannot be dismissed')
    }
    await ctx.db.delete(args.taskId)
  },
})

export const retry = mutation({
  args: { taskId: v.id('tasks') },
  handler: async (ctx, args) => {
    const userId = await requireIdentity(ctx)
    const task = await ctx.db.get(args.taskId)
    if (!task || task.userId !== userId) {
      throw new Error('Task not found')
    }
    if (task.status !== 'failed') {
      throw new Error('Only failed tasks can be retried')
    }
    if (task.type === 'audio-overview-generation') {
      throw new Error('Audio overview tasks require a new quota reservation')
    }

    const now = Date.now()
    const newTaskId = await ctx.db.insert('tasks', {
      userId,
      folderId: task.folderId,
      type: task.type,
      status: 'pending',
      title: task.title,
      progress: 'Preparing…',
      metadata: task.metadata,
      createdAt: now,
      updatedAt: now,
    })

    await ctx.db.delete(args.taskId)
    return { taskId: newTaskId }
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

    const thirtyMinutesAgo = Date.now() - 30 * 60 * 1000

    const tasks = await ctx.db
      .query('tasks')
      .withIndex('by_userId_and_folderId', (q) =>
        q.eq('userId', userId).eq('folderId', args.folderId),
      )
      .order('desc')
      .take(50)

    return tasks.filter((t) => {
      if (t.status === 'pending' || t.status === 'running') return true
      if (t.completedAt && t.completedAt > thirtyMinutesAgo) return true
      return false
    })
  },
})

export const get = query({
  args: { taskId: v.id('tasks') },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return null

    const task = await ctx.db.get(args.taskId)
    if (!task || task.userId !== identity.tokenIdentifier) return null
    return task
  },
})

export const cleanupTerminalTasks = internalMutation({
  args: {},
  handler: async (ctx) => {
    const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000

    const terminalStatuses = ['completed', 'failed', 'cancelled']
    let totalDeleted = 0

    for (const status of terminalStatuses) {
      while (true) {
        const batch = await ctx.db
          .query('tasks')
          .withIndex('by_status', (q) => q.eq('status', status))
          .take(100)

        const old = batch.filter(
          (t) => t.completedAt && t.completedAt < twentyFourHoursAgo,
        )
        if (old.length === 0) break

        for (const task of old) {
          await ctx.db.delete(task._id)
          totalDeleted += 1
        }

        if (batch.length < 100) break
      }
    }

    return { deleted: totalDeleted }
  },
})
