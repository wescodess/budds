import { v } from 'convex/values'
import { mutation, query, internalMutation } from './_generated/server'
import type { MutationCtx, QueryCtx } from './_generated/server'

async function requireIdentity(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) throw new Error('Unauthenticated')
  return identity.tokenIdentifier
}

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

export const updateProgress = internalMutation({
  args: {
    taskId: v.id('tasks'),
    progress: v.string(),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId)
    if (!task) return
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
    const now = Date.now()
    await ctx.db.patch(args.taskId, {
      status: 'failed',
      error: args.error,
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
