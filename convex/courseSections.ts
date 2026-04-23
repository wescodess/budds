import { v } from 'convex/values'
import { mutation, query, internalMutation, internalQuery } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { internal } from './_generated/api'
import { requireAuth } from './lib/auth'
import { transitionMastery } from './lib/masteryStateMachine'
import type { MasteryLevel } from './lib/masteryStateMachine'
import { updateStreakForActivity } from './learnProfile'

export const get = query({
  args: { id: v.id('courseSections') },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const section = await ctx.db.get(args.id)
    if (!section || section.userId !== userId) return null
    return section
  },
})

export const listByCourse = query({
  args: { courseId: v.id('courses') },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const course = await ctx.db.get(args.courseId)
    if (!course || course.userId !== userId) return []

    return await ctx.db
      .query('courseSections')
      .withIndex('by_courseId_and_order', (q) => q.eq('courseId', args.courseId))
      .take(100)
  },
})

export const updateTitle = mutation({
  args: {
    sectionId: v.id('courseSections'),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const section = await ctx.db.get(args.sectionId)
    if (!section || section.userId !== userId) throw new Error('Section not found')

    const trimmed = args.title.trim().slice(0, 200) || 'Untitled Section'
    await ctx.db.patch(args.sectionId, { title: trimmed })

    const course = await ctx.db.get(section.courseId)
    if (course) {
      const updated = course.outlineSections.map((s) =>
        s.order === section.order ? { ...s, title: trimmed } : s,
      )
      await ctx.db.patch(section.courseId, {
        outlineSections: updated,
        updatedAt: Date.now(),
      })
    }
  },
})

export const updateKnowledgeType = mutation({
  args: {
    sectionId: v.id('courseSections'),
    knowledgeType: v.union(
      v.literal('factual'),
      v.literal('conceptual'),
      v.literal('procedural'),
      v.literal('mixed'),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const section = await ctx.db.get(args.sectionId)
    if (!section || section.userId !== userId) throw new Error('Section not found')

    await ctx.db.patch(args.sectionId, { knowledgeType: args.knowledgeType })

    const course = await ctx.db.get(section.courseId)
    if (course) {
      const updated = course.outlineSections.map((s) =>
        s.order === section.order ? { ...s, knowledgeType: args.knowledgeType } : s,
      )
      await ctx.db.patch(section.courseId, {
        outlineSections: updated,
        updatedAt: Date.now(),
      })
    }
  },
})

export const remove = mutation({
  args: { sectionId: v.id('courseSections') },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const section = await ctx.db.get(args.sectionId)
    if (!section || section.userId !== userId) throw new Error('Section not found')

    const removedOrder = section.order
    await ctx.db.delete(args.sectionId)

    const siblings = await ctx.db
      .query('courseSections')
      .withIndex('by_courseId_and_order', (q) => q.eq('courseId', section.courseId))
      .collect()

    for (const sibling of siblings) {
      if (sibling.order > removedOrder) {
        await ctx.db.patch(sibling._id, { order: sibling.order - 1 })
      }
    }

    const course = await ctx.db.get(section.courseId)
    if (course) {
      const filtered = course.outlineSections
        .filter((s) => s.order !== removedOrder)
        .map((s, i) => ({ ...s, order: i }))

      await ctx.db.patch(section.courseId, {
        outlineSections: filtered,
        totalSectionCount: filtered.length,
        updatedAt: Date.now(),
      })
    }
  },
})

export const create = mutation({
  args: {
    courseId: v.id('courses'),
    title: v.optional(v.string()),
    knowledgeType: v.optional(
      v.union(
        v.literal('factual'),
        v.literal('conceptual'),
        v.literal('procedural'),
        v.literal('mixed'),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const course = await ctx.db.get(args.courseId)
    if (!course || course.userId !== userId) throw new Error('Course not found')

    const title = (args.title ?? 'New Section').trim().slice(0, 200) || 'New Section'
    const knowledgeType = args.knowledgeType ?? 'mixed'
    const order = course.totalSectionCount

    const sectionId = await ctx.db.insert('courseSections', {
      courseId: args.courseId,
      userId,
      order,
      title,
      knowledgeType,
      status: 'locked',
      contentBlocks: [],
      masteryLevel: 'new',
    })

    const newOutline = [
      ...course.outlineSections,
      { title, description: '', knowledgeType, order },
    ]

    await ctx.db.patch(args.courseId, {
      outlineSections: newOutline,
      totalSectionCount: order + 1,
      updatedAt: Date.now(),
    })

    return sectionId
  },
})

export const updateOrder = mutation({
  args: {
    courseId: v.id('courses'),
    sectionIds: v.array(v.id('courseSections')),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const course = await ctx.db.get(args.courseId)
    if (!course || course.userId !== userId) throw new Error('Course not found')

    const oldSections = await ctx.db
      .query('courseSections')
      .withIndex('by_courseId_and_order', (q) => q.eq('courseId', args.courseId))
      .take(100)

    const descByOrder = new Map<number, string>()
    for (const o of course.outlineSections) {
      descByOrder.set(o.order, o.description)
    }

    const orderBySectionId = new Map<string, number>()
    for (const s of oldSections) {
      orderBySectionId.set(s._id as string, s.order)
    }

    const reorderedOutline: typeof course.outlineSections = []

    for (let i = 0; i < args.sectionIds.length; i++) {
      const sectionId = args.sectionIds[i]!
      const section = await ctx.db.get(sectionId) as Doc<'courseSections'> | null
      if (!section || section.userId !== userId || section.courseId !== args.courseId) {
        throw new Error('Section not found')
      }
      await ctx.db.patch(sectionId, { order: i })

      const oldOrder = orderBySectionId.get(sectionId as string)
      reorderedOutline.push({
        title: section.title,
        description: oldOrder !== undefined ? (descByOrder.get(oldOrder) ?? '') : '',
        knowledgeType: section.knowledgeType,
        order: i,
      })
    }

    await ctx.db.patch(args.courseId, {
      outlineSections: reorderedOutline,
      updatedAt: Date.now(),
    })
  },
})

const contentBlockValidator = v.object({
  type: v.union(
    v.literal('text'),
    v.literal('quiz'),
    v.literal('flashcard'),
    v.literal('audio'),
  ),
  entityId: v.optional(v.string()),
  entityType: v.optional(v.union(
    v.literal('quiz'),
    v.literal('flashcard'),
    v.literal('audio'),
  )),
  content: v.optional(v.string()),
  order: v.number(),
})

export const getForGeneration = internalQuery({
  args: { sectionId: v.id('courseSections') },
  handler: async (ctx, args) => {
    const section = await ctx.db.get(args.sectionId)
    if (!section) return null

    const course = await ctx.db.get(section.courseId)
    if (!course) return null

    const sourceDocs = await ctx.db
      .query('courseSourceDocs')
      .withIndex('by_courseId', (q) => q.eq('courseId', section.courseId))
      .collect()

    return { section, course, sourceDocs }
  },
})

export const markReady = internalMutation({
  args: {
    sectionId: v.id('courseSections'),
    contentBlocks: v.array(contentBlockValidator),
    failureNotice: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const section = await ctx.db.get(args.sectionId)
    if (!section) return

    await ctx.db.patch(args.sectionId, {
      status: 'ready',
      contentBlocks: args.contentBlocks,
      failureNotice: args.failureNotice,
    })
  },
})

export const markSectionFailed = internalMutation({
  args: {
    sectionId: v.id('courseSections'),
    failureNotice: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const section = await ctx.db.get(args.sectionId)
    if (!section) return

    await ctx.db.patch(args.sectionId, {
      status: 'failed',
      failureNotice: args.failureNotice || 'Section generation failed',
    })
  },
})

export const finalizeSectionGeneration = mutation({
  args: {
    sectionId: v.id('courseSections'),
    textContent: v.optional(v.string()),
    quizData: v.optional(v.object({
      title: v.string(),
      model: v.optional(v.string()),
      difficulty: v.optional(v.string()),
      questions: v.array(v.object({
        order: v.number(),
        question: v.string(),
        type: v.union(
          v.literal('multiple-choice'),
          v.literal('free-response'),
          v.literal('true_false'),
          v.literal('fill_in_the_blank'),
        ),
        options: v.optional(v.array(v.string())),
        correctAnswer: v.string(),
        explanation: v.optional(v.string()),
        sourceDocumentId: v.optional(v.string()),
        sourceChunkContent: v.optional(v.string()),
        sourceFilename: v.optional(v.string()),
      })),
    })),
    flashcardData: v.optional(v.object({
      title: v.string(),
      cards: v.array(v.object({
        term: v.string(),
        definition: v.string(),
        sourceFilename: v.optional(v.string()),
        sourceChunkContent: v.optional(v.string()),
      })),
    })),
    audioEntityId: v.optional(v.string()),
    failedEngines: v.optional(v.array(v.string())),
    taskId: v.optional(v.id('tasks')),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const section = await ctx.db.get(args.sectionId)
    if (!section || section.userId !== userId) throw new Error('Section not found')

    const course = await ctx.db.get(section.courseId)
    if (!course) throw new Error('Course not found')

    const contentBlocks: Array<{
      type: 'text' | 'quiz' | 'flashcard' | 'audio'
      entityId?: string
      entityType?: 'quiz' | 'flashcard' | 'audio'
      content?: string
      order: number
    }> = []

    let blockOrder = 0

    if (args.audioEntityId) {
      contentBlocks.push({
        type: 'audio',
        entityId: args.audioEntityId,
        entityType: 'audio',
        order: blockOrder++,
      })
    }

    if (args.textContent) {
      contentBlocks.push({
        type: 'text',
        content: args.textContent,
        order: blockOrder++,
      })
    }

    if (args.quizData && args.quizData.questions.length > 0 && course.folderId) {
      const quizId = await ctx.db.insert('quizzes', {
        userId,
        folderId: course.folderId,
        title: args.quizData.title,
        status: 'ready',
        model: args.quizData.model,
        difficulty: args.quizData.difficulty,
        creationMethod: 'auto_generated',
        questionCount: args.quizData.questions.length,
        courseScoped: true,
      })

      for (const q of args.quizData.questions) {
        let resolvedDocId: string | undefined
        if (q.sourceDocumentId) {
          const normalized = ctx.db.normalizeId('documents', q.sourceDocumentId)
          if (normalized) resolvedDocId = normalized
        }

        await ctx.db.insert('quizQuestions', {
          quizId,
          userId,
          order: q.order,
          question: q.question,
          type: q.type,
          options: q.options,
          correctAnswer: q.correctAnswer,
          explanation: q.explanation,
          sourceDocumentId: resolvedDocId as any,
          sourceChunkContent: q.sourceChunkContent,
          sourceFilename: q.sourceFilename,
        })
      }

      contentBlocks.push({
        type: 'quiz',
        entityId: quizId,
        entityType: 'quiz',
        order: blockOrder++,
      })
    }

    if (args.flashcardData && args.flashcardData.cards.length > 0 && course.folderId) {
      const roomId = await ctx.db.insert('flashcardRooms', {
        userId,
        folderId: course.folderId,
        title: args.flashcardData.title,
        updatedAt: Date.now(),
        cardCount: args.flashcardData.cards.length,
        courseScoped: true,
      })

      const versionId = await ctx.db.insert('flashcardRoomVersions', {
        roomId,
        userId,
        title: args.flashcardData.title,
        origin: 'ai',
        cardCount: args.flashcardData.cards.length,
      })

      for (let i = 0; i < args.flashcardData.cards.length; i++) {
        const c = args.flashcardData.cards[i]!
        const term = c.term.trim()
        const definition = c.definition.trim()
        if (!term || !definition) continue

        const metadata = c.sourceFilename
          ? { source: { filename: c.sourceFilename, chunkContent: c.sourceChunkContent || '' } }
          : undefined

        await ctx.db.insert('flashcardRoomCards', {
          roomId,
          userId,
          displayOrder: i,
          term,
          definition,
          metadata: metadata as any,
        })

        await ctx.db.insert('flashcardVersionCards', {
          versionId,
          roomId,
          userId,
          displayOrder: i,
          term,
          definition,
          metadata: metadata as any,
        })
      }

      await ctx.db.patch(roomId, { activeVersionId: versionId, currentCardCount: args.flashcardData.cards.length })

      contentBlocks.push({
        type: 'flashcard',
        entityId: roomId,
        entityType: 'flashcard',
        order: blockOrder++,
      })
    }

    const failedEngines = args.failedEngines || []
    const failureNotice = failedEngines.length > 0
      ? `Some content could not be generated: ${failedEngines.join(', ')}`
      : undefined

    if (contentBlocks.length === 0) {
      await ctx.db.patch(args.sectionId, {
        status: 'failed',
        failureNotice: 'All content engines failed',
      })
      return { status: 'failed' as const }
    }

    await ctx.db.patch(args.sectionId, {
      status: 'ready',
      contentBlocks,
      failureNotice,
    })

    return { status: 'ready' as const, blockCount: contentBlocks.length }
  },
})

export const getNextSection = query({
  args: {
    courseId: v.id('courses'),
    currentOrder: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const course = await ctx.db.get(args.courseId)
    if (!course || course.userId !== userId) return null

    const nextSection = await ctx.db
      .query('courseSections')
      .withIndex('by_courseId_and_order', (q) =>
        q.eq('courseId', args.courseId).eq('order', args.currentOrder + 1),
      )
      .unique()

    return nextSection
  },
})

export const checkPreFetchStatus = query({
  args: {
    courseId: v.id('courses'),
    currentOrder: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const course = await ctx.db.get(args.courseId)
    if (!course || course.userId !== userId) return null

    const nextSection = await ctx.db
      .query('courseSections')
      .withIndex('by_courseId_and_order', (q) =>
        q.eq('courseId', args.courseId).eq('order', args.currentOrder + 1),
      )
      .unique()

    if (!nextSection) return null

    const projected = { _id: nextSection._id, status: nextSection.status }

    if (nextSection.status === 'ready' || nextSection.status === 'completed' || nextSection.status === 'generating') {
      return { nextSection: projected, needsPreFetch: false, taskStatus: null }
    }

    let taskStatus: string | null = null
    if (nextSection.taskId) {
      const task = await ctx.db.get(nextSection.taskId)
      taskStatus = task?.status ?? null
    }

    return {
      nextSection: projected,
      needsPreFetch: nextSection.status === 'locked' || nextSection.status === 'failed',
      taskStatus,
    }
  },
})

export const triggerPreFetch = mutation({
  args: {
    courseId: v.id('courses'),
    currentOrder: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const course = await ctx.db.get(args.courseId)
    if (!course || course.userId !== userId) throw new Error('Course not found')

    const nextSection = await ctx.db
      .query('courseSections')
      .withIndex('by_courseId_and_order', (q) =>
        q.eq('courseId', args.courseId).eq('order', args.currentOrder + 1),
      )
      .unique()

    if (!nextSection || nextSection.userId !== userId) return null
    if (nextSection.status === 'ready' || nextSection.status === 'completed' || nextSection.status === 'generating') {
      return null
    }

    if (nextSection.status === 'failed') {
      if (nextSection.taskId) {
        const previousTask = await ctx.db.get(nextSection.taskId)
        if (previousTask && previousTask.status === 'failed') {
          const metadata = previousTask.metadata as { retryOf?: string } | undefined
          if (metadata?.retryOf) return null
        }
      }

      const taskId: Id<'tasks'> = await ctx.runMutation(
        internal.tasks.createInternal,
        {
          userId,
          folderId: course.folderId,
          type: 'section-generate',
          title: `Pre-fetching: ${nextSection.title}`,
          metadata: {
            courseId: args.courseId,
            sectionId: nextSection._id,
            retryOf: nextSection.taskId ?? 'initial-failure',
          },
        },
      )

      await ctx.db.patch(nextSection._id, {
        status: 'generating',
        taskId,
        failureNotice: undefined,
      })

      return { sectionId: nextSection._id, taskId }
    }

    const taskId: Id<'tasks'> = await ctx.runMutation(
      internal.tasks.createInternal,
      {
        userId,
        folderId: course.folderId,
        type: 'section-generate',
        title: `Pre-fetching: ${nextSection.title}`,
        metadata: { courseId: args.courseId, sectionId: nextSection._id },
      },
    )

    await ctx.db.patch(nextSection._id, {
      status: 'generating',
      taskId,
    })

    return { sectionId: nextSection._id, taskId }
  },
})

function getAdaptiveFeedback(practiceScore: number): {
  feedbackText: string
  adaptiveHint: 'increase-practice' | 'reduce-practice' | 'standard'
} {
  if (practiceScore < 60) {
    return {
      feedbackText: 'This section had some challenging concepts. The next section will include more foundational practice to help reinforce your understanding.',
      adaptiveHint: 'increase-practice',
    }
  }
  if (practiceScore >= 90) {
    return {
      feedbackText: 'Excellent work! You\'ve demonstrated strong understanding. The next section will focus more on new concepts with streamlined practice.',
      adaptiveHint: 'reduce-practice',
    }
  }
  return {
    feedbackText: '',
    adaptiveHint: 'standard',
  }
}

export const completeSection = mutation({
  args: {
    sectionId: v.id('courseSections'),
    practiceScore: v.number(),
    quizCorrect: v.number(),
    quizTotal: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const section = await ctx.db.get(args.sectionId)
    if (!section || section.userId !== userId) throw new Error('Section not found')
    if (section.status === 'completed') {
      return {
        practiceScore: section.practiceScore ?? args.practiceScore,
        masteryLevel: section.masteryLevel,
        feedbackText: '',
        adaptiveHint: 'standard' as const,
        conceptsForReview: 0,
      }
    }
    if (section.status !== 'ready') {
      throw new Error('Section is not ready for completion')
    }

    const score = Math.max(0, Math.min(100, Math.round(args.practiceScore)))

    const currentState = {
      level: section.masteryLevel as MasteryLevel,
      consecutiveReviewPasses: section.consecutiveReviewPasses ?? 0,
    }
    const newState = transitionMastery(currentState, { type: 'section_completed', score })
    const { feedbackText, adaptiveHint } = getAdaptiveFeedback(score)

    await ctx.db.patch(args.sectionId, {
      status: 'completed',
      practiceScore: score,
      masteryLevel: newState.level,
      consecutiveReviewPasses: newState.consecutiveReviewPasses,
      completedAt: Date.now(),
    })

    const course = await ctx.db.get(section.courseId)
    if (course && course.userId === userId) {
      await ctx.db.patch(section.courseId, {
        completedSectionCount: course.completedSectionCount + 1,
        updatedAt: Date.now(),
      })
    }

    await updateStreakForActivity(ctx, userId)

    const conceptsForReview: number = await ctx.runMutation(
      internal.reviewItems.extractFromSection,
      {
        userId,
        courseId: section.courseId,
        sectionId: args.sectionId,
      },
    )

    return {
      practiceScore: score,
      masteryLevel: newState.level,
      feedbackText,
      adaptiveHint,
      conceptsForReview,
    }
  },
})

export const reviewSection = mutation({
  args: {
    sectionId: v.id('courseSections'),
    practiceScore: v.number(),
    quizCorrect: v.number(),
    quizTotal: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const section = await ctx.db.get(args.sectionId)
    if (!section || section.userId !== userId) throw new Error('Section not found')
    if (section.status !== 'completed') {
      throw new Error('Section must be completed before reviewing')
    }

    const score = Math.max(0, Math.min(100, Math.round(args.practiceScore)))

    const currentState = {
      level: section.masteryLevel as MasteryLevel,
      consecutiveReviewPasses: section.consecutiveReviewPasses ?? 0,
    }
    const newState = transitionMastery(currentState, { type: 'section_reviewed', score })
    const { feedbackText, adaptiveHint } = getAdaptiveFeedback(score)

    const history = section.reviewHistory ?? []
    const quizCorrect = Math.max(0, Math.round(args.quizCorrect))
    const quizTotal = Math.max(0, Math.round(args.quizTotal))
    const updatedHistory = [...history, { score, quizCorrect, quizTotal, at: Date.now() }].slice(-10)

    await ctx.db.patch(args.sectionId, {
      practiceScore: score,
      masteryLevel: newState.level,
      consecutiveReviewPasses: newState.consecutiveReviewPasses,
      reviewHistory: updatedHistory,
    })

    await updateStreakForActivity(ctx, userId)

    return {
      practiceScore: score,
      masteryLevel: newState.level,
      previousMasteryLevel: currentState.level,
      feedbackText,
      adaptiveHint,
      conceptsForReview: 0,
    }
  },
})
