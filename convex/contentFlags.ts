import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { requireAuth } from './lib/auth'

export const flagQuizQuestion = mutation({
  args: {
    questionId: v.id('quizQuestions'),
    correctedAnswer: v.string(),
    correctedExplanation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)

    const question = await ctx.db.get(args.questionId)
    if (!question || question.userId !== userId) throw new Error('Question not found')

    const trimmedAnswer = args.correctedAnswer.trim()
    if (trimmedAnswer.length === 0) throw new Error('Corrected answer required')

    await ctx.db.patch(args.questionId, {
      flagged: true,
      correctedAnswer: trimmedAnswer,
      correctedExplanation: args.correctedExplanation?.trim() || undefined,
      flaggedAt: Date.now(),
    })

    return { success: true }
  },
})

export const unflagQuizQuestion = mutation({
  args: {
    questionId: v.id('quizQuestions'),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)

    const question = await ctx.db.get(args.questionId)
    if (!question || question.userId !== userId) throw new Error('Question not found')

    await ctx.db.patch(args.questionId, {
      flagged: undefined,
      correctedAnswer: undefined,
      correctedExplanation: undefined,
      flaggedAt: undefined,
    })

    return { success: true }
  },
})

export const flagFlashcard = mutation({
  args: {
    cardId: v.id('flashcardRoomCards'),
    correctedDefinition: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)

    const card = await ctx.db.get(args.cardId)
    if (!card || card.userId !== userId) throw new Error('Card not found')

    const trimmedDef = args.correctedDefinition.trim()
    if (trimmedDef.length === 0) throw new Error('Corrected definition required')

    await ctx.db.patch(args.cardId, {
      flagged: true,
      correctedDefinition: trimmedDef,
      flaggedAt: Date.now(),
    })

    const reviewItems = await ctx.db
      .query('reviewItems')
      .withIndex('by_flashcardRoomCardId', (q) => q.eq('flashcardRoomCardId', args.cardId))
      .take(1)
    if (reviewItems.length > 0) {
      await ctx.db.patch(reviewItems[0]!._id, {
        flagged: true,
        correctedAnswer: trimmedDef,
      })
    }

    return { success: true }
  },
})

export const unflagFlashcard = mutation({
  args: {
    cardId: v.id('flashcardRoomCards'),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)

    const card = await ctx.db.get(args.cardId)
    if (!card || card.userId !== userId) throw new Error('Card not found')

    await ctx.db.patch(args.cardId, {
      flagged: undefined,
      correctedDefinition: undefined,
      flaggedAt: undefined,
    })

    const reviewItems = await ctx.db
      .query('reviewItems')
      .withIndex('by_flashcardRoomCardId', (q) => q.eq('flashcardRoomCardId', args.cardId))
      .take(1)
    if (reviewItems.length > 0) {
      await ctx.db.patch(reviewItems[0]!._id, {
        flagged: false,
        correctedAnswer: undefined,
      })
    }

    return { success: true }
  },
})

export const getFlagRateForCourse = query({
  args: { courseId: v.id('courses') },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return null

    const userId = identity.tokenIdentifier
    const course = await ctx.db.get(args.courseId)
    if (!course || course.userId !== userId) return null

    const sections = await ctx.db
      .query('courseSections')
      .withIndex('by_courseId', (q) => q.eq('courseId', args.courseId))
      .take(100)

    let totalItems = 0
    let flaggedItems = 0

    for (const section of sections) {
      for (const block of section.contentBlocks) {
        if (block.type === 'quiz' && block.entityId) {
          const quizId = ctx.db.normalizeId('quizzes', block.entityId)
          if (!quizId) continue
          const questions = await ctx.db
            .query('quizQuestions')
            .withIndex('by_quizId', (q) => q.eq('quizId', quizId))
            .collect()
          totalItems += questions.length
          flaggedItems += questions.filter((q) => q.flagged === true).length
        }

        if (block.type === 'flashcard' && block.entityId) {
          const roomId = ctx.db.normalizeId('flashcardRooms', block.entityId)
          if (!roomId) continue
          const cards = await ctx.db
            .query('flashcardRoomCards')
            .withIndex('by_roomId', (q) => q.eq('roomId', roomId))
            .collect()
          totalItems += cards.length
          flaggedItems += cards.filter((c) => c.flagged === true).length
        }
      }
    }

    return {
      totalItems,
      flaggedItems,
      flagRate: totalItems > 0 ? Math.round((flaggedItems / totalItems) * 100) : 0,
    }
  },
})
