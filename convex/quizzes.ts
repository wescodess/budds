import { v } from 'convex/values'
import { mutation, query, internalMutation } from './_generated/server'
import type { Id, Doc } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'
import { requireAuth } from './lib/auth'

const questionTypeValidator = v.union(
  v.literal('multiple-choice'),
  v.literal('free-response'),
  v.literal('true_false'),
  v.literal('fill_in_the_blank'),
)

const questionInput = v.object({
  order: v.number(),
  question: v.string(),
  type: questionTypeValidator,
  options: v.optional(v.array(v.string())),
  correctAnswer: v.string(),
  explanation: v.optional(v.string()),
  sourceDocumentId: v.optional(v.string()),
  sourceChunkContent: v.optional(v.string()),
  sourceFilename: v.optional(v.string()),
})

const settingsValidator = v.object({
  shuffleQuestions: v.boolean(),
  showAllQuestions: v.boolean(),
  immediateFeedback: v.boolean(),
})

async function requireQuiz(ctx: QueryCtx | MutationCtx, quizId: Id<'quizzes'>, userId: string) {
  const quiz = await ctx.db.get(quizId)
  if (!quiz || quiz.userId !== userId) throw new Error('Quiz not found')
  return quiz
}

function normalizeForCompare(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function scoreAnswer(
  type: string,
  response: string,
  correctAnswer: string,
): boolean {
  if (type === 'multiple-choice' || type === 'true_false') {
    return response === correctAnswer
  }
  return normalizeForCompare(response) === normalizeForCompare(correctAnswer)
}

function shuffleArray<T>(arr: T[]): T[] {
  const shuffled = [...arr]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i]!, shuffled[j]!] = [shuffled[j]!, shuffled[i]!]
  }
  return shuffled
}

export const createWithQuestions = mutation({
  args: {
    folderId: v.id('folders'),
    title: v.string(),
    model: v.optional(v.string()),
    description: v.optional(v.string()),
    difficulty: v.optional(v.string()),
    language: v.optional(v.string()),
    creationMethod: v.optional(v.union(v.literal('manual'), v.literal('auto_generated'))),
    questions: v.array(questionInput),
    courseScoped: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)

    const folder = await ctx.db.get(args.folderId)
    if (!folder || folder.userId !== userId) throw new Error('Folder not found')

    const trimmedTitle = args.title.trim().slice(0, 120) || 'Quiz'

    const quizId = await ctx.db.insert('quizzes', {
      userId,
      folderId: args.folderId,
      title: trimmedTitle,
      status: 'ready',
      model: args.model,
      description: args.description,
      difficulty: args.difficulty,
      language: args.language,
      creationMethod: args.creationMethod ?? 'auto_generated',
      questionCount: args.questions.length,
      courseScoped: args.courseScoped,
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
        explanation: q.explanation,
        sourceDocumentId: resolvedDocId,
        sourceChunkContent: q.sourceChunkContent,
        sourceFilename: q.sourceFilename,
      })
    }

    return { quizId }
  },
})

export const createCourseScopedQuiz = internalMutation({
  args: {
    userId: v.string(),
    folderId: v.id('folders'),
    title: v.string(),
    model: v.optional(v.string()),
    difficulty: v.optional(v.string()),
    questions: v.array(questionInput),
  },
  handler: async (ctx, args) => {
    const quizId = await ctx.db.insert('quizzes', {
      userId: args.userId,
      folderId: args.folderId,
      title: args.title.trim().slice(0, 120) || 'Section Quiz',
      status: 'ready',
      model: args.model,
      creationMethod: 'auto_generated',
      difficulty: args.difficulty,
      questionCount: args.questions.length,
      courseScoped: true,
    })

    for (const q of args.questions) {
      let resolvedDocId: Id<'documents'> | undefined
      if (q.sourceDocumentId) {
        const normalized = ctx.db.normalizeId('documents', q.sourceDocumentId)
        if (normalized) resolvedDocId = normalized
      }

      await ctx.db.insert('quizQuestions', {
        quizId,
        userId: args.userId,
        order: q.order,
        question: q.question,
        type: q.type,
        options: q.options,
        correctAnswer: q.correctAnswer,
        explanation: q.explanation,
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

    const allRows = await ctx.db
      .query('quizzes')
      .withIndex('by_userId_and_folderId', (q) =>
        q.eq('userId', userId).eq('folderId', args.folderId),
      )
      .order('desc')
      .collect()

    const rows = allRows.filter((r) => r.courseScoped !== true)

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
          latestAttemptStatus: row.latestAttemptStatus,
          difficulty: row.difficulty,
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

export const updateQuiz = mutation({
  args: {
    quizId: v.id('quizzes'),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    difficulty: v.optional(v.string()),
    language: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    await requireQuiz(ctx, args.quizId, userId)

    const patch: Record<string, unknown> = {}
    if (args.title !== undefined) {
      const t = args.title.trim().slice(0, 120)
      if (t.length > 0) patch.title = t
    }
    if (args.description !== undefined) patch.description = args.description
    if (args.difficulty !== undefined) patch.difficulty = args.difficulty
    if (args.language !== undefined) patch.language = args.language

    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(args.quizId, patch)
    }

    return await ctx.db.get(args.quizId)
  },
})

export const addQuestion = mutation({
  args: {
    quizId: v.id('quizzes'),
    type: questionTypeValidator,
    questionText: v.string(),
    options: v.optional(v.array(v.string())),
    correctAnswer: v.string(),
    explanation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    await requireQuiz(ctx, args.quizId, userId)

    const trimmed = args.questionText.trim()
    if (trimmed.length === 0) throw new Error('Question text required')

    const correctTrimmed = args.correctAnswer.trim()
    if (correctTrimmed.length === 0) throw new Error('Correct answer required')

    if (args.type === 'multiple-choice') {
      const opts = (args.options ?? []).map(o => o.trim()).filter(o => o.length > 0)
      if (opts.length < 2) throw new Error('At least 2 options required')
      if (!opts.includes(correctTrimmed)) throw new Error('Correct answer must match an option')
    }

    const existing = await ctx.db
      .query('quizQuestions')
      .withIndex('by_quizId', q => q.eq('quizId', args.quizId))
      .collect()

    const maxOrder = existing.reduce((max, q) => Math.max(max, q.order), -1)

    const questionId = await ctx.db.insert('quizQuestions', {
      quizId: args.quizId,
      userId,
      order: maxOrder + 1,
      question: trimmed,
      type: args.type,
      options: args.type === 'multiple-choice'
        ? (args.options ?? []).map(o => o.trim()).filter(o => o.length > 0)
        : args.type === 'true_false'
          ? ['True', 'False']
          : undefined,
      correctAnswer: correctTrimmed,
      explanation: args.explanation?.trim() || undefined,
    })

    await ctx.db.patch(args.quizId, { questionCount: existing.length + 1 })

    return { questionId }
  },
})

export const updateQuestion = mutation({
  args: {
    questionId: v.id('quizQuestions'),
    question: v.optional(v.string()),
    type: v.optional(questionTypeValidator),
    options: v.optional(v.array(v.string())),
    correctAnswer: v.optional(v.string()),
    explanation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)

    const existing = await ctx.db.get(args.questionId)
    if (!existing || existing.userId !== userId) throw new Error('Question not found')

    const patch: Record<string, unknown> = {}

    if (args.question !== undefined) {
      const t = args.question.trim()
      if (t.length === 0) throw new Error('Question text required')
      patch.question = t
    }

    if (args.type !== undefined) {
      patch.type = args.type
    }

    const effectiveType = (args.type ?? existing.type) as string

    if (args.correctAnswer !== undefined) {
      const t = args.correctAnswer.trim()
      if (t.length === 0) throw new Error('Correct answer required')
      patch.correctAnswer = t
    }

    const effectiveCorrect = ((patch.correctAnswer as string) ?? existing.correctAnswer).trim()

    if (effectiveType === 'multiple-choice') {
      const opts = (args.options ?? existing.options ?? []).map(o => o.trim()).filter(o => o.length > 0)
      if (opts.length < 2) throw new Error('At least 2 options required')
      if (!opts.includes(effectiveCorrect)) throw new Error('Correct answer must match an option')
      patch.options = opts
    } else if (effectiveType === 'true_false') {
      patch.options = ['True', 'False']
    } else {
      patch.options = undefined
    }

    if (args.explanation !== undefined) {
      patch.explanation = args.explanation.trim() || undefined
    }

    await ctx.db.patch(args.questionId, patch)
    return await ctx.db.get(args.questionId)
  },
})

export const deleteQuestion = mutation({
  args: { questionId: v.id('quizQuestions') },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)

    const question = await ctx.db.get(args.questionId)
    if (!question || question.userId !== userId) throw new Error('Question not found')

    const quizId = question.quizId
    await ctx.db.delete(args.questionId)

    const remaining = await ctx.db
      .query('quizQuestions')
      .withIndex('by_quizId', q => q.eq('quizId', quizId))
      .collect()

    remaining.sort((a, b) => a.order - b.order)
    for (let i = 0; i < remaining.length; i++) {
      if (remaining[i]!.order !== i) {
        await ctx.db.patch(remaining[i]!._id, { order: i })
      }
    }

    await ctx.db.patch(quizId, { questionCount: remaining.length })
  },
})

export const startAttempt = mutation({
  args: {
    quizId: v.id('quizzes'),
    settings: settingsValidator,
    restart: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const quiz = await requireQuiz(ctx, args.quizId, userId)

    const questions = await ctx.db
      .query('quizQuestions')
      .withIndex('by_quizId', q => q.eq('quizId', args.quizId))
      .collect()

    if (questions.length === 0) throw new Error('Quiz has no questions')

    const userAttempts = await ctx.db
      .query('quizAttempts')
      .withIndex('by_userId_and_quizId', q =>
        q.eq('userId', userId).eq('quizId', args.quizId),
      )
      .collect()
    const existingInProgress = userAttempts.find(a => a.status === 'in_progress')

    if (!args.restart && existingInProgress) {
      const answeredIds = new Set<string>()
      const answers = await ctx.db
        .query('attemptAnswers')
        .withIndex('by_attemptId', q => q.eq('attemptId', existingInProgress._id))
        .collect()
      for (const a of answers) answeredIds.add(a.questionId as string)

      const orderedQuestions = existingInProgress.questionOrder
        ? existingInProgress.questionOrder.map(id => questions.find(q => q._id === id)!).filter(Boolean)
        : [...questions].sort((a, b) => a.order - b.order)

      const safeQuestions = orderedQuestions.map(q => ({
        ...q,
        correctAnswer: answeredIds.has(q._id as string) ? q.correctAnswer : '',
        explanation: answeredIds.has(q._id as string) ? q.explanation : undefined,
      }))

      return {
        status: 'resumed' as const,
        attemptId: existingInProgress._id,
        settings: existingInProgress.settingsSnapshot ?? args.settings,
        currentQuestionIndex: existingInProgress.currentQuestionIndex ?? 0,
        questions: safeQuestions,
        answeredQuestionIds: Array.from(answeredIds),
        answers,
      }
    }

    if (existingInProgress) {
      await ctx.db.patch(existingInProgress._id, { status: 'abandoned' })
    }

    const sorted = [...questions].sort((a, b) => a.order - b.order)
    const ordered = args.settings.shuffleQuestions ? shuffleArray(sorted) : sorted
    const questionOrder = ordered.map(q => q._id)

    const attemptId = await ctx.db.insert('quizAttempts', {
      userId,
      quizId: args.quizId,
      score: 0,
      total: questions.length,
      status: 'in_progress',
      settingsSnapshot: args.settings,
      currentQuestionIndex: 0,
      startedAt: Date.now(),
      questionOrder,
    })

    await ctx.db.patch(args.quizId, { latestAttemptStatus: 'in_progress' })

    return {
      status: 'started' as const,
      attemptId,
      settings: args.settings,
      currentQuestionIndex: 0,
      questions: ordered,
      answeredQuestionIds: [],
      answers: [],
    }
  },
})

export const submitAnswer = mutation({
  args: {
    attemptId: v.id('quizAttempts'),
    questionId: v.id('quizQuestions'),
    userAnswer: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)

    const attempt = await ctx.db.get(args.attemptId)
    if (!attempt || attempt.userId !== userId) throw new Error('Attempt not found')
    if (attempt.status !== 'in_progress') throw new Error('Attempt is not in progress')

    const question = await ctx.db.get(args.questionId)
    if (!question) throw new Error('Question not found')
    if (question.quizId !== attempt.quizId) throw new Error('Question does not belong to this quiz')

    const existingAnswer = await ctx.db
      .query('attemptAnswers')
      .withIndex('by_attemptId_and_questionId', q =>
        q.eq('attemptId', args.attemptId).eq('questionId', args.questionId),
      )
      .take(1)

    if (existingAnswer.length > 0) {
      return {
        isCorrect: existingAnswer[0]!.isCorrect,
        correctAnswer: question.correctAnswer,
        explanation: question.explanation,
        alreadyAnswered: true,
      }
    }

    const isCorrect = scoreAnswer(question.type, args.userAnswer, question.correctAnswer)

    await ctx.db.insert('attemptAnswers', {
      attemptId: args.attemptId,
      questionId: args.questionId,
      userAnswer: args.userAnswer,
      isCorrect,
      answeredAt: Date.now(),
    })

    const allAnswers = await ctx.db
      .query('attemptAnswers')
      .withIndex('by_attemptId', q => q.eq('attemptId', args.attemptId))
      .collect()
    await ctx.db.patch(args.attemptId, {
      currentQuestionIndex: allAnswers.length,
    })

    return {
      isCorrect,
      correctAnswer: question.correctAnswer,
      explanation: question.explanation,
      alreadyAnswered: false,
    }
  },
})

export const submitAllAnswers = mutation({
  args: {
    attemptId: v.id('quizAttempts'),
    answers: v.array(v.object({
      questionId: v.id('quizQuestions'),
      userAnswer: v.string(),
    })),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)

    const attempt = await ctx.db.get(args.attemptId)
    if (!attempt || attempt.userId !== userId) throw new Error('Attempt not found')
    if (attempt.status !== 'in_progress') throw new Error('Attempt is not in progress')

    const questions = await ctx.db
      .query('quizQuestions')
      .withIndex('by_quizId', q => q.eq('quizId', attempt.quizId))
      .collect()

    const questionMap = new Map(questions.map(q => [q._id as string, q]))

    const existingAnswers = await ctx.db
      .query('attemptAnswers')
      .withIndex('by_attemptId', q => q.eq('attemptId', args.attemptId))
      .collect()
    const alreadyAnswered = new Set(existingAnswers.map(a => a.questionId as string))

    const results = []
    let correctCount = 0

    for (const a of args.answers) {
      const question = questionMap.get(a.questionId as string)
      if (!question) continue
      if (alreadyAnswered.has(a.questionId as string)) continue

      const isCorrect = scoreAnswer(question.type, a.userAnswer, question.correctAnswer)
      if (isCorrect) correctCount++

      await ctx.db.insert('attemptAnswers', {
        attemptId: args.attemptId,
        questionId: a.questionId,
        userAnswer: a.userAnswer,
        isCorrect,
        answeredAt: Date.now(),
      })
      alreadyAnswered.add(a.questionId as string)

      results.push({
        questionId: a.questionId,
        isCorrect,
        correctAnswer: question.correctAnswer,
        explanation: question.explanation,
        userAnswer: a.userAnswer,
      })
    }

    const total = questions.length
    const percentage = total > 0 ? Math.round((correctCount / total) * 100) : 0
    const now = Date.now()

    await ctx.db.patch(args.attemptId, {
      status: 'completed',
      score: correctCount,
      total,
      completedAt: now,
    })

    await ctx.db.patch(attempt.quizId, {
      score: percentage,
      completedAt: now,
      latestAttemptStatus: 'completed',
    })

    return { score: correctCount, total, percentage, results }
  },
})

export const completeAttempt = mutation({
  args: { attemptId: v.id('quizAttempts') },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)

    const attempt = await ctx.db.get(args.attemptId)
    if (!attempt || attempt.userId !== userId) throw new Error('Attempt not found')
    if (attempt.status !== 'in_progress') throw new Error('Attempt is not in progress')

    const answers = await ctx.db
      .query('attemptAnswers')
      .withIndex('by_attemptId', q => q.eq('attemptId', args.attemptId))
      .collect()

    const correctCount = answers.filter(a => a.isCorrect).length
    const questions = await ctx.db
      .query('quizQuestions')
      .withIndex('by_quizId', q => q.eq('quizId', attempt.quizId))
      .collect()

    const total = questions.length
    const percentage = total > 0 ? Math.round((correctCount / total) * 100) : 0
    const now = Date.now()

    await ctx.db.patch(args.attemptId, {
      status: 'completed',
      score: correctCount,
      total,
      completedAt: now,
    })

    await ctx.db.patch(attempt.quizId, {
      score: percentage,
      completedAt: now,
      latestAttemptStatus: 'completed',
    })

    return { score: correctCount, total, percentage }
  },
})

export const abandonAttempt = mutation({
  args: { attemptId: v.id('quizAttempts') },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)

    const attempt = await ctx.db.get(args.attemptId)
    if (!attempt || attempt.userId !== userId) throw new Error('Attempt not found')

    await ctx.db.patch(args.attemptId, { status: 'abandoned' })
    await ctx.db.patch(attempt.quizId, { latestAttemptStatus: 'abandoned' })
  },
})

export const getAttemptResults = query({
  args: { attemptId: v.id('quizAttempts') },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return null

    const userId = identity.tokenIdentifier

    const attempt = await ctx.db.get(args.attemptId)
    if (!attempt || attempt.userId !== userId) return null

    const quiz = await ctx.db.get(attempt.quizId)

    const questions = await ctx.db
      .query('quizQuestions')
      .withIndex('by_quizId', q => q.eq('quizId', attempt.quizId))
      .collect()

    const questionMap = new Map(questions.map(q => [q._id as string, q]))

    const attemptAnswers = await ctx.db
      .query('attemptAnswers')
      .withIndex('by_attemptId', q => q.eq('attemptId', args.attemptId))
      .collect()

    if (attemptAnswers.length > 0) {
      const results = attemptAnswers.map(a => {
        const q = questionMap.get(a.questionId as string)
        return {
          questionId: a.questionId,
          questionText: q?.question ?? '',
          questionType: q?.type ?? 'multiple-choice',
          options: q?.options,
          userAnswer: a.userAnswer,
          isCorrect: a.isCorrect,
          correctAnswer: q?.correctAnswer ?? '',
          explanation: q?.explanation,
          feedback: a.feedback,
        }
      })

      return {
        attemptId: attempt._id,
        quizId: attempt.quizId,
        quizTitle: quiz?.title ?? '',
        score: attempt.score,
        total: attempt.total,
        percentage: attempt.total > 0 ? Math.round((attempt.score / attempt.total) * 100) : 0,
        startedAt: attempt.startedAt ?? attempt._creationTime,
        completedAt: attempt.completedAt,
        status: attempt.status ?? 'completed',
        results,
      }
    }

    if (attempt.answers) {
      const results = attempt.answers.map(a => {
        const q = questionMap.get(a.questionId as string)
        return {
          questionId: a.questionId,
          questionText: q?.question ?? '',
          questionType: q?.type ?? 'multiple-choice',
          options: q?.options,
          userAnswer: a.response,
          isCorrect: a.isCorrect,
          correctAnswer: q?.correctAnswer ?? '',
          explanation: q?.explanation,
          feedback: undefined,
        }
      })

      return {
        attemptId: attempt._id,
        quizId: attempt.quizId,
        quizTitle: quiz?.title ?? '',
        score: attempt.score,
        total: attempt.total,
        percentage: attempt.total > 0 ? Math.round((attempt.score / attempt.total) * 100) : 0,
        startedAt: attempt._creationTime,
        completedAt: attempt.completedAt,
        status: attempt.status ?? 'completed',
        results,
      }
    }

    return {
      attemptId: attempt._id,
      quizId: attempt.quizId,
      quizTitle: quiz?.title ?? '',
      score: attempt.score,
      total: attempt.total,
      percentage: attempt.total > 0 ? Math.round((attempt.score / attempt.total) * 100) : 0,
      startedAt: attempt.startedAt ?? attempt._creationTime,
      completedAt: attempt.completedAt,
      status: attempt.status ?? 'completed',
      results: [],
    }
  },
})

export const getQuizHistory = query({
  args: {
    quizId: v.id('quizzes'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return []

    const userId = identity.tokenIdentifier

    const quiz = await ctx.db.get(args.quizId)
    if (!quiz || quiz.userId !== userId) return []

    const attempts = await ctx.db
      .query('quizAttempts')
      .withIndex('by_userId_and_quizId', q =>
        q.eq('userId', userId).eq('quizId', args.quizId),
      )
      .order('desc')
      .take(args.limit ?? 20)

    return attempts.map(a => ({
      _id: a._id,
      _creationTime: a._creationTime,
      score: a.score,
      total: a.total,
      percentage: a.total > 0 ? Math.round((a.score / a.total) * 100) : 0,
      status: a.status ?? 'completed',
      startedAt: a.startedAt ?? a._creationTime,
      currentQuestionIndex: a.currentQuestionIndex ?? 0,
      completedAt: a.completedAt,
    }))
  },
})

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
    const userId = await requireAuth(ctx)
    const quiz = await requireQuiz(ctx, args.quizId, userId)

    const questions = await ctx.db
      .query('quizQuestions')
      .withIndex('by_quizId', (q) => q.eq('quizId', args.quizId))
      .collect()

    const questionMap = new Map<string, (typeof questions)[number]>(
      questions.map((q) => [q._id as unknown as string, q]),
    )

    for (const a of args.answers) {
      const q = questionMap.get(a.questionId as unknown as string)
      if (!q || q.userId !== userId) throw new Error('Invalid question')
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
      status: 'completed',
    })

    await ctx.db.patch(args.quizId, {
      score: percentage,
      completedAt,
      latestAttemptStatus: 'completed',
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

    return { attemptId, score: correctCount, total, correctCount, results }
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

export const deleteQuiz = mutation({
  args: { quizId: v.id('quizzes') },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    await requireQuiz(ctx, args.quizId, userId)

    const attempts = await ctx.db
      .query('quizAttempts')
      .withIndex('by_quizId', (q) => q.eq('quizId', args.quizId))
      .collect()

    for (const a of attempts) {
      const answers = await ctx.db
        .query('attemptAnswers')
        .withIndex('by_attemptId', q => q.eq('attemptId', a._id))
        .collect()
      for (const ans of answers) await ctx.db.delete(ans._id)
      await ctx.db.delete(a._id)
    }

    const questions = await ctx.db
      .query('quizQuestions')
      .withIndex('by_quizId', (q) => q.eq('quizId', args.quizId))
      .collect()
    for (const q of questions) await ctx.db.delete(q._id)

    await ctx.db.delete(args.quizId)

    return {
      deletedAttempts: attempts.length,
      deletedQuestions: questions.length,
    }
  },
})
