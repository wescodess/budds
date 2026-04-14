import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { Id } from './_generated/dataModel'

const questionInput = v.object({
  order: v.number(),
  question: v.string(),
  type: v.union(v.literal('multiple-choice'), v.literal('free-response')),
  options: v.optional(v.array(v.string())),
  correctAnswer: v.string(),
  sourceDocumentId: v.optional(v.string()),
  sourceChunkContent: v.string(),
  sourceFilename: v.string(),
})

export const createWithQuestions = mutation({
  args: {
    folderId: v.id('folders'),
    title: v.string(),
    model: v.optional(v.string()),
    questions: v.array(questionInput),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Unauthenticated')

    const userId = identity.tokenIdentifier

    const folder = await ctx.db.get(args.folderId)
    if (!folder || folder.userId !== userId) {
      throw new Error('Folder not found')
    }

    const trimmedTitle = args.title.trim().slice(0, 120) || 'Quiz'

    const quizId = await ctx.db.insert('quizzes', {
      userId,
      folderId: args.folderId,
      title: trimmedTitle,
      status: 'ready',
      model: args.model,
    })

    for (const q of args.questions) {
      let resolvedDocId: Id<'documents'> | undefined
      if (q.sourceDocumentId) {
        const normalized = ctx.db.normalizeId('documents', q.sourceDocumentId)
        if (normalized) {
          const doc = await ctx.db.get(normalized)
          if (doc && doc.userId === userId) resolvedDocId = normalized
        }
      }

      await ctx.db.insert('quizQuestions', {
        quizId,
        userId,
        order: q.order,
        question: q.question,
        type: q.type,
        options: q.options,
        correctAnswer: q.correctAnswer,
        sourceDocumentId: resolvedDocId,
        sourceChunkContent: q.sourceChunkContent,
        sourceFilename: q.sourceFilename,
      })
    }

    return { quizId }
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
      .query('quizzes')
      .withIndex('by_userId_and_folderId', (q) =>
        q.eq('userId', userId).eq('folderId', args.folderId),
      )
      .order('desc')
      .collect()

    return await Promise.all(
      rows.map(async (row) => {
        const questions = await ctx.db
          .query('quizQuestions')
          .withIndex('by_quizId', (q) => q.eq('quizId', row._id))
          .collect()
        return {
          _id: row._id,
          _creationTime: row._creationTime,
          title: row.title,
          status: row.status,
          score: row.score,
          completedAt: row.completedAt,
          questionCount: questions.length,
        }
      }),
    )
  },
})

export const getWithQuestions = query({
  args: { id: v.id('quizzes') },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return null

    const userId = identity.tokenIdentifier

    const quiz = await ctx.db.get(args.id)
    if (!quiz || quiz.userId !== userId) return null

    const questions = await ctx.db
      .query('quizQuestions')
      .withIndex('by_quizId', (q) => q.eq('quizId', quiz._id))
      .collect()

    questions.sort((a, b) => a.order - b.order)

    return { quiz, questions }
  },
})

function normalizeForCompare(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function scoreAnswer(
  type: 'multiple-choice' | 'free-response',
  response: string,
  correctAnswer: string,
): boolean {
  if (type === 'multiple-choice') {
    return response === correctAnswer
  }
  return normalizeForCompare(response) === normalizeForCompare(correctAnswer)
}

export const submitAttempt = mutation({
  args: {
    quizId: v.id('quizzes'),
    answers: v.array(
      v.object({
        questionId: v.id('quizQuestions'),
        response: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Unauthenticated')

    const userId = identity.tokenIdentifier

    const quiz = await ctx.db.get(args.quizId)
    if (!quiz || quiz.userId !== userId) {
      throw new Error('Quiz not found')
    }

    const questions = await ctx.db
      .query('quizQuestions')
      .withIndex('by_quizId', (q) => q.eq('quizId', args.quizId))
      .collect()

    const questionMap = new Map<string, (typeof questions)[number]>(
      questions.map((q) => [q._id as unknown as string, q]),
    )

    for (const a of args.answers) {
      const q = questionMap.get(a.questionId as unknown as string)
      if (!q || q.userId !== userId) {
        throw new Error('Invalid question')
      }
    }

    const scoredAnswers = args.answers.map((a) => {
      const q = questionMap.get(a.questionId as unknown as string)!
      return {
        questionId: a.questionId,
        response: a.response,
        isCorrect: scoreAnswer(q.type, a.response, q.correctAnswer),
      }
    })

    const correctCount = scoredAnswers.filter((a) => a.isCorrect).length
    const total = questions.length
    const completedAt = Date.now()
    const percentage = total > 0 ? Math.round((correctCount / total) * 100) : 0

    const attemptId = await ctx.db.insert('quizAttempts', {
      userId,
      quizId: args.quizId,
      answers: scoredAnswers,
      score: correctCount,
      total,
      completedAt,
    })

    await ctx.db.patch(args.quizId, {
      score: percentage,
      completedAt,
    })

    const results = scoredAnswers.map((a) => {
      const q = questionMap.get(a.questionId as unknown as string)!
      return {
        questionId: a.questionId,
        isCorrect: a.isCorrect,
        correctAnswer: q.correctAnswer,
        userResponse: a.response,
      }
    })

    return {
      attemptId,
      score: correctCount,
      total,
      correctCount,
      results,
    }
  },
})

export const listAttempts = query({
  args: { quizId: v.id('quizzes') },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return []

    const userId = identity.tokenIdentifier

    const quiz = await ctx.db.get(args.quizId)
    if (!quiz || quiz.userId !== userId) return []

    return await ctx.db
      .query('quizAttempts')
      .withIndex('by_userId_and_quizId', (q) =>
        q.eq('userId', userId).eq('quizId', args.quizId),
      )
      .order('desc')
      .collect()
  },
})

export const updateQuestion = mutation({
  args: {
    questionId: v.id('quizQuestions'),
    question: v.string(),
    options: v.optional(v.array(v.string())),
    correctAnswer: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Unauthenticated')

    const userId = identity.tokenIdentifier

    const existing = await ctx.db.get(args.questionId)
    if (!existing || existing.userId !== userId) {
      throw new Error('Question not found')
    }

    const trimmedQuestion = args.question.trim()
    if (trimmedQuestion.length === 0) {
      throw new Error('Question text required')
    }

    const trimmedCorrect = args.correctAnswer.trim()
    if (trimmedCorrect.length === 0) {
      throw new Error('Correct answer required')
    }

    let nextOptions: string[] | undefined

    if (existing.type === 'multiple-choice') {
      const opts = args.options ?? []
      const cleaned = opts.map((o) => o.trim()).filter((o) => o.length > 0)
      if (cleaned.length < 2) {
        throw new Error('Options required')
      }
      if (!cleaned.includes(trimmedCorrect)) {
        throw new Error('Correct answer must match an option')
      }
      nextOptions = cleaned
    } else {
      nextOptions = undefined
    }

    await ctx.db.patch(args.questionId, {
      question: trimmedQuestion,
      correctAnswer: trimmedCorrect,
      options: nextOptions,
    })

    return await ctx.db.get(args.questionId)
  },
})

export const deleteQuiz = mutation({
  args: { quizId: v.id('quizzes') },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Unauthenticated')

    const userId = identity.tokenIdentifier

    const quiz = await ctx.db.get(args.quizId)
    if (!quiz || quiz.userId !== userId) {
      throw new Error('Quiz not found')
    }

    const attempts = await ctx.db
      .query('quizAttempts')
      .withIndex('by_quizId', (q) => q.eq('quizId', args.quizId))
      .collect()
    for (const a of attempts) {
      await ctx.db.delete(a._id)
    }

    const questions = await ctx.db
      .query('quizQuestions')
      .withIndex('by_quizId', (q) => q.eq('quizId', args.quizId))
      .collect()
    for (const q of questions) {
      await ctx.db.delete(q._id)
    }

    await ctx.db.delete(args.quizId)

    return {
      deletedAttempts: attempts.length,
      deletedQuestions: questions.length,
    }
  },
})
