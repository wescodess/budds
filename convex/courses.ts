import { v } from 'convex/values'
import { action, internalQuery, mutation, query } from './_generated/server'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { getOptionalAuthUserId, requireAuth } from './lib/auth'
import { getOrCreateProfile } from './learnProfile'
import { runCourseDeletionSteps } from './courseDeletion'

export const MAX_SOURCE_DOCS = 100

export const create = mutation({
  args: {
    title: v.string(),
    sourceType: v.union(v.literal('folder'), v.literal('web-only')),
    folderId: v.id('folders'),
    documentIds: v.optional(v.array(v.id('documents'))),
    webSearchEnabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const now = Date.now()

    const folder = await ctx.db.get(args.folderId)
    if (!folder || folder.userId !== userId) throw new Error('Folder not found')

    let resolvedDocs: Array<{ documentId: Id<'documents'>; folderId: Id<'folders'> }> = []

    if (args.sourceType === 'folder') {
      if (args.documentIds && args.documentIds.length > 0) {
        for (const docId of args.documentIds) {
          const doc = await ctx.db.get(docId)
          if (!doc || doc.userId !== userId) throw new Error('Document not found')
          resolvedDocs.push({ documentId: docId, folderId: args.folderId })
        }
      } else {
        const docs = await ctx.db
          .query('documents')
          .withIndex('by_userId_and_folderId', (q) =>
            q.eq('userId', userId).eq('folderId', args.folderId),
          )
          .take(MAX_SOURCE_DOCS)
        resolvedDocs = docs.map((d) => ({ documentId: d._id, folderId: args.folderId }))
      }
    }

    const isWebOnly = args.sourceType === 'web-only'

    const courseId = await ctx.db.insert('courses', {
      userId,
      folderId: args.folderId,
      title: args.title.trim().slice(0, 200) || 'Untitled Course',
      status: 'generating',
      sourceType: args.sourceType,
      sourceConfidence: isWebOnly
        ? { docCount: 0, webPercent: 100 }
        : { docCount: resolvedDocs.length, webPercent: 0 },
      pace: 'steady',
      outlineSections: [],
      completedSectionCount: 0,
      totalSectionCount: 0,
      webSearchEnabled: isWebOnly ? true : (args.webSearchEnabled ?? false),
      createdAt: now,
      updatedAt: now,
    })

    for (const rd of resolvedDocs) {
      await ctx.db.insert('courseSourceDocs', {
        courseId,
        documentId: rd.documentId,
        folderId: rd.folderId,
        userId,
      })
    }

    const taskId: Id<'tasks'> = await ctx.runMutation(
      internal.tasks.createInternal,
      {
        userId,
        folderId: args.folderId,
        type: 'course-outline',
        title: 'Generating outline...',
        metadata: { courseId },
      },
    )

    await ctx.db.patch(courseId, { taskId })

    await getOrCreateProfile(ctx, userId)

    return { courseId, taskId }
  },
})

export const listByUser = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getOptionalAuthUserId(ctx)
    if (!userId) return []

    return await ctx.db
      .query('courses')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .order('desc')
      .take(100)
  },
})

/** Owner-scoped bounded reader for durable calendar sync continuations. */
export const getCalendarSyncPage = internalQuery({
  args: {
    userId: v.string(),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => await ctx.db
    .query('courses')
    .withIndex('by_userId', q => q.eq('userId', args.userId))
    .order('desc')
    .paginate({ cursor: args.cursor, numItems: 25 }),
})

export const listByFolder = query({
  args: { folderId: v.id('folders') },
  handler: async (ctx, args) => {
    const userId = await getOptionalAuthUserId(ctx)
    if (!userId) return []

    return await ctx.db
      .query('courses')
      .withIndex('by_userId_and_folderId', (q) =>
        q.eq('userId', userId).eq('folderId', args.folderId),
      )
      .order('desc')
      .take(50)
  },
})

export const get = query({
  args: { id: v.id('courses') },
  handler: async (ctx, args) => {
    const userId = await getOptionalAuthUserId(ctx)
    if (!userId) return null

    const course = await ctx.db.get(args.id)
    if (!course || course.userId !== userId) return null
    return course
  },
})

export const finalizeOutline = mutation({
  args: {
    courseId: v.id('courses'),
    outlineSections: v.array(v.object({
      title: v.string(),
      description: v.string(),
      knowledgeType: v.string(),
      order: v.number(),
    })),
    sourceConfidence: v.object({
      docCount: v.number(),
      webPercent: v.number(),
    }),
    totalSectionCount: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const course = await ctx.db.get(args.courseId)
    if (!course || course.userId !== userId) throw new Error('Course not found')
    if (course.status !== 'generating') throw new Error('Course is not in generating state')

    await ctx.db.patch(args.courseId, {
      outlineSections: args.outlineSections,
      totalSectionCount: args.totalSectionCount,
      sourceConfidence: args.sourceConfidence,
      status: 'ready',
      updatedAt: Date.now(),
    })

    for (const section of args.outlineSections) {
      await ctx.db.insert('courseSections', {
        courseId: args.courseId,
        userId: course.userId,
        order: section.order,
        title: section.title,
        knowledgeType: section.knowledgeType as 'factual' | 'conceptual' | 'procedural' | 'mixed',
        status: 'locked',
        contentBlocks: [],
        masteryLevel: 'new',
      })
    }
  },
})

export const updateOutline = mutation({
  args: {
    courseId: v.id('courses'),
    outlineSections: v.array(v.object({
      title: v.string(),
      description: v.string(),
      knowledgeType: v.string(),
      order: v.number(),
    })),
    totalSectionCount: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const course = await ctx.db.get(args.courseId)
    if (!course || course.userId !== userId) throw new Error('Course not found')

    await ctx.db.patch(args.courseId, {
      outlineSections: args.outlineSections,
      totalSectionCount: args.totalSectionCount,
      updatedAt: Date.now(),
    })
  },
})

export const updatePace = mutation({
  args: {
    courseId: v.id('courses'),
    pace: v.union(v.literal('intensive'), v.literal('steady'), v.literal('relaxed')),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const course = await ctx.db.get(args.courseId)
    if (!course || course.userId !== userId) throw new Error('Course not found')

    await ctx.db.patch(args.courseId, {
      pace: args.pace,
      updatedAt: Date.now(),
    })
  },
})

export const startCourse = mutation({
  args: {
    courseId: v.id('courses'),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const course = await ctx.db.get(args.courseId)
    if (!course || course.userId !== userId) throw new Error('Course not found')
    if (course.status !== 'ready') throw new Error('Course is not ready to start')

    const firstSection = await ctx.db
      .query('courseSections')
      .withIndex('by_courseId_and_order', (q) =>
        q.eq('courseId', args.courseId).eq('order', 0),
      )
      .unique()

    if (!firstSection) throw new Error('Course has no sections')
    if (firstSection.status !== 'locked') throw new Error('Course has already been started')

    const taskId: Id<'tasks'> = await ctx.runMutation(
      internal.tasks.createInternal,
      {
        userId,
        folderId: course.folderId,
        type: 'section-generate',
        title: `Generating: ${firstSection.title}`,
        metadata: { courseId: args.courseId, sectionId: firstSection._id },
      },
    )

    await ctx.db.patch(firstSection._id, {
      status: 'generating',
      taskId,
    })

    return { courseId: args.courseId, sectionId: firstSection._id, taskId }
  },
})

export const deleteCourse = action({
  args: { id: v.id('courses') },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const jobId = await ctx.runMutation(internal.courseDeletion.start, { courseId: args.id, userId })
    const result = await runCourseDeletionSteps(ctx, jobId, 64)
    if (result.error) throw new Error(result.error)
    return result
  },
})

export const markFailed = mutation({
  args: {
    courseId: v.id('courses'),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const course = await ctx.db.get(args.courseId)
    if (!course || course.userId !== userId) return
    if (course.status === 'deleting') return

    await ctx.db.patch(args.courseId, {
      status: 'failed',
      updatedAt: Date.now(),
    })
  },
})

export const getById = internalQuery({
  args: { courseId: v.id('courses') },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.courseId)
  },
})
