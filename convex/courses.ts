import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { requireAuth } from './lib/auth'

export const create = mutation({
  args: {
    title: v.string(),
    sourceType: v.union(v.literal('folder'), v.literal('cross-folder'), v.literal('web-only')),
    folderId: v.optional(v.id('folders')),
    documentIds: v.optional(v.array(v.id('documents'))),
    webSearchEnabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const now = Date.now()

    let resolvedDocs: Array<{ documentId: Id<'documents'>; folderId: Id<'folders'> }> = []
    let resolvedFolderId: Id<'folders'> | undefined

    if (args.sourceType === 'web-only') {
      if (args.folderId) {
        const folder = await ctx.db.get(args.folderId)
        if (!folder || folder.userId !== userId) throw new Error('Folder not found')
        resolvedFolderId = args.folderId
      }
    } else if (args.sourceType === 'folder') {
      if (!args.folderId) throw new Error('folderId required for folder source')
      const folder = await ctx.db.get(args.folderId)
      if (!folder || folder.userId !== userId) throw new Error('Folder not found')
      resolvedFolderId = args.folderId

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
            q.eq('userId', userId).eq('folderId', args.folderId!),
          )
          .collect()
        resolvedDocs = docs.map((d) => ({ documentId: d._id, folderId: args.folderId! }))
      }
    } else {
      if (!args.documentIds || args.documentIds.length === 0) {
        throw new Error('documentIds required for cross-folder source')
      }
      for (const docId of args.documentIds) {
        const doc = await ctx.db.get(docId)
        if (!doc || doc.userId !== userId) throw new Error('Document not found')
        resolvedDocs.push({ documentId: docId, folderId: doc.folderId })
      }
    }

    const isWebOnly = args.sourceType === 'web-only'

    const courseId = await ctx.db.insert('courses', {
      userId,
      folderId: resolvedFolderId,
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
        folderId: resolvedFolderId,
        type: 'course-outline',
        title: 'Generating outline...',
        metadata: { courseId },
      },
    )

    await ctx.db.patch(courseId, { taskId })

    const existing = await ctx.db
      .query('learnProfile')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .unique()

    if (!existing) {
      await ctx.db.insert('learnProfile', {
        userId,
        streakCurrent: 0,
        streakFreezeAvailable: false,
        dailyReviewCap: 50,
      })
    }

    return { courseId, taskId }
  },
})

export const listByUser = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return []
    const userId = identity.tokenIdentifier

    return await ctx.db
      .query('courses')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .order('desc')
      .take(100)
  },
})

export const listByFolder = query({
  args: { folderId: v.id('folders') },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return []
    const userId = identity.tokenIdentifier

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
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return null
    const userId = identity.tokenIdentifier

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

    return args.courseId
  },
})

export const deleteCourse = mutation({
  args: { id: v.id('courses') },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const course = await ctx.db.get(args.id)
    if (!course || course.userId !== userId) throw new Error('Course not found')

    const sections = await ctx.db
      .query('courseSections')
      .withIndex('by_courseId', (q) => q.eq('courseId', args.id))
      .collect()

    const entityIds: string[] = []
    for (const section of sections) {
      for (const block of section.contentBlocks) {
        if (block.entityId) entityIds.push(block.entityId)
      }
      await ctx.db.delete(section._id)
    }

    while (true) {
      const batch = await ctx.db
        .query('courseSourceDocs')
        .withIndex('by_courseId', (q) => q.eq('courseId', args.id))
        .take(500)
      if (batch.length === 0) break
      for (const row of batch) await ctx.db.delete(row._id)
      if (batch.length < 500) break
    }

    for (const eid of entityIds) {
      try {
        const quiz = await ctx.db.get(eid as Id<'quizzes'>)
        if (quiz && quiz.courseScoped === true) {
          const questions = await ctx.db
            .query('quizQuestions')
            .withIndex('by_quizId', (q) => q.eq('quizId', quiz._id))
            .collect()
          for (const q of questions) await ctx.db.delete(q._id)

          const attempts = await ctx.db
            .query('quizAttempts')
            .withIndex('by_quizId', (q) => q.eq('quizId', quiz._id))
            .collect()
          for (const a of attempts) {
            const answers = await ctx.db
              .query('attemptAnswers')
              .withIndex('by_attemptId', (q) => q.eq('attemptId', a._id))
              .collect()
            for (const ans of answers) await ctx.db.delete(ans._id)
            await ctx.db.delete(a._id)
          }

          await ctx.db.delete(quiz._id)
        }
      } catch {
        // entityId may not be a quiz
      }

      try {
        const room = await ctx.db.get(eid as Id<'flashcardRooms'>)
        if (room && room.courseScoped === true) {
          const roomCards = await ctx.db
            .query('flashcardRoomCards')
            .withIndex('by_roomId', (q) => q.eq('roomId', room._id))
            .collect()
          for (const c of roomCards) await ctx.db.delete(c._id)

          const versions = await ctx.db
            .query('flashcardRoomVersions')
            .withIndex('by_roomId', (q) => q.eq('roomId', room._id))
            .collect()
          for (const ver of versions) {
            const versionCards = await ctx.db
              .query('flashcardVersionCards')
              .withIndex('by_versionId', (q) => q.eq('versionId', ver._id))
              .collect()
            for (const c of versionCards) await ctx.db.delete(c._id)
            await ctx.db.delete(ver._id)
          }
          await ctx.db.delete(room._id)
        }
      } catch {
        // entityId may not be a flashcardRoom
      }

      try {
        const audio = await ctx.db.get(eid as Id<'audioOverviews'>)
        if (audio && audio.courseScoped === true) {
          const interjections = await ctx.db
            .query('audioOverviewInterjections')
            .withIndex('by_audioOverview', (q) => q.eq('audioOverviewId', audio._id))
            .collect()
          for (const ij of interjections) {
            for (const turn of ij.answerTurns) {
              try { await ctx.storage.delete(turn.audioFileId) } catch {}
            }
            await ctx.db.delete(ij._id)
          }

          for (const turn of audio.turns) {
            try { await ctx.storage.delete(turn.audioFileId) } catch {}
          }
          await ctx.db.delete(audio._id)
        }
      } catch {
        // entityId may not be an audioOverview
      }
    }

    await ctx.db.delete(args.id)
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

    await ctx.db.patch(args.courseId, {
      status: 'failed',
      updatedAt: Date.now(),
    })
  },
})
