import { v } from 'convex/values'
import { mutation, query, internalMutation } from './_generated/server'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'
import { getOptionalAuthUserId, requireAuth } from './lib/auth'
import { createPendingAnswerAssessment } from './lib/quizAnswerAssessment'

const MAX_QUIZ_QUESTIONS = 200
const MAX_QUIZZES_PER_FOLDER = 100
const MAX_ATTEMPTS_PER_QUIZ = 100
const DELETE_BATCH_SIZE = 50

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
  if (!quiz || quiz.userId !== userId || quiz.deletedAt !== undefined) throw new Error('Quiz not found')
  return quiz
}

function normalizeForCompare(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function listFactorTokens(value: string): string[] {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
}

function splitListFactors(value: string): string[][] {
  return value
    .split(/\s*(?:,|;|&|\band\b)\s*/i)
    .map(listFactorTokens)
    .filter(tokens => tokens.length > 0)
}

function isExplicitListMatch(question: string, response: string, correctAnswer: string): boolean {
  const directive = question.match(/^\s*(?:list|name|identify|give|provide|state)\s+(?:(?:the|any)\s+)?(two|three|four|five|[2-5])\b/i)
  if (!directive) return false
  const countByWord: Record<string, number> = { two: 2, three: 3, four: 4, five: 5 }
  const requestedCount = countByWord[directive[1]!.toLowerCase()] ?? Number(directive[1])
  if (!Number.isInteger(requestedCount) || requestedCount < 2 || requestedCount > 5) return false

  const expectedFactors = splitListFactors(correctAnswer)
  const responseFactors = splitListFactors(response)
  if (expectedFactors.length !== requestedCount || responseFactors.length !== requestedCount) return false
  if (responseFactors.some(tokens => tokens.some(token => ['no', 'not', 'never', 'without'].includes(token)))) return false

  const expectedConcepts = expectedFactors
  const responseConcepts = responseFactors

  const expectedHeads = expectedFactors.map(tokens => tokens.at(-1)!)
  if (expectedHeads.some(head => head.length < 4)) return false
  if (new Set(expectedHeads).size !== expectedHeads.length) return false
  const responseSignatures = responseConcepts.map(tokens => tokens.join(' '))
  if (new Set(responseSignatures).size !== responseSignatures.length) return false
  const expectedTokenSets = expectedConcepts.map(tokens => new Set(tokens))

  const usedExpected = new Set<number>()
  for (const actual of responseConcepts) {
    const matchIndex = expectedConcepts.findIndex((expected, index) =>
      !usedExpected.has(index)
      && actual.includes(expected.at(-1)!)
      && actual.every(token => expectedTokenSets[index]!.has(token)),
    )
    if (matchIndex < 0) return false
    usedExpected.add(matchIndex)
  }
  return usedExpected.size === requestedCount
}

function scoreAnswer(
  type: string,
  response: string,
  correctAnswer: string,
  question: string,
): boolean {
  if (type === 'multiple-choice' || type === 'true_false') {
    return response === correctAnswer
  }
  return normalizeForCompare(response) === normalizeForCompare(correctAnswer)
    || isExplicitListMatch(question, response, correctAnswer)
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
    if (args.questions.length > MAX_QUIZ_QUESTIONS) throw new Error(`Quiz cannot exceed ${MAX_QUIZ_QUESTIONS} questions`)

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
    if (args.questions.length > MAX_QUIZ_QUESTIONS) throw new Error(`Quiz cannot exceed ${MAX_QUIZ_QUESTIONS} questions`)
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
    const userId = await getOptionalAuthUserId(ctx)
    if (!userId) return []

    const folder = await ctx.db.get(args.folderId)
    if (!folder || folder.userId !== userId) return []

    const [legacyRows, explicitRows] = await Promise.all([
      ctx.db.query('quizzes')
        .withIndex('by_userId_and_folderId_and_courseScoped_and_deletedAt', q => q
          .eq('userId', userId).eq('folderId', args.folderId).eq('courseScoped', undefined).eq('deletedAt', undefined))
        .order('desc').take(MAX_QUIZZES_PER_FOLDER),
      ctx.db.query('quizzes')
        .withIndex('by_userId_and_folderId_and_courseScoped_and_deletedAt', q => q
          .eq('userId', userId).eq('folderId', args.folderId).eq('courseScoped', false).eq('deletedAt', undefined))
        .order('desc').take(MAX_QUIZZES_PER_FOLDER),
    ])
    const rows = [...legacyRows, ...explicitRows]
      .sort((a, b) => b._creationTime - a._creationTime)
      .slice(0, MAX_QUIZZES_PER_FOLDER)

    return await Promise.all(
      rows.map(async (row) => {
        const questions = await ctx.db
          .query('quizQuestions')
          .withIndex('by_quizId', (q) => q.eq('quizId', row._id))
          .take(MAX_QUIZ_QUESTIONS)
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
    const userId = await getOptionalAuthUserId(ctx)
    if (!userId) return null

    const quiz = await ctx.db.get(args.id)
    if (!quiz || quiz.userId !== userId || quiz.deletedAt !== undefined) return null

    const questions = await ctx.db
      .query('quizQuestions')
      .withIndex('by_quizId', (q) => q.eq('quizId', quiz._id))
      .take(MAX_QUIZ_QUESTIONS)

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
      .take(MAX_QUIZ_QUESTIONS)
    if (existing.length >= MAX_QUIZ_QUESTIONS) throw new Error(`Quiz has reached the maximum of ${MAX_QUIZ_QUESTIONS} questions`)

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
    await requireQuiz(ctx, existing.quizId, userId)

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
    await requireQuiz(ctx, question.quizId, userId)

    const quizId = question.quizId
    await ctx.db.delete(args.questionId)

    const remaining = await ctx.db
      .query('quizQuestions')
      .withIndex('by_quizId', q => q.eq('quizId', quizId))
      .take(MAX_QUIZ_QUESTIONS)

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
    await requireQuiz(ctx, args.quizId, userId)

    const questions = await ctx.db
      .query('quizQuestions')
      .withIndex('by_quizId', q => q.eq('quizId', args.quizId))
      .take(MAX_QUIZ_QUESTIONS)

    if (questions.length === 0) throw new Error('Quiz has no questions')

    const userAttempts = await ctx.db
      .query('quizAttempts')
      .withIndex('by_userId_and_quizId', q =>
        q.eq('userId', userId).eq('quizId', args.quizId),
      )
      .order('desc')
      .take(MAX_ATTEMPTS_PER_QUIZ)
    const existingInProgress = userAttempts.find(a => a.status === 'in_progress')

    if (!args.restart && existingInProgress) {
      const answeredIds = new Set<string>()
      const answers = await ctx.db
        .query('attemptAnswers')
        .withIndex('by_attemptId', q => q.eq('attemptId', existingInProgress._id))
        .take(MAX_QUIZ_QUESTIONS)
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
    await requireQuiz(ctx, attempt.quizId, userId)

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

    const isCorrect = scoreAnswer(question.type, args.userAnswer, question.correctAnswer, question.question)

    const attemptAnswerId = await ctx.db.insert('attemptAnswers', {
      attemptId: args.attemptId,
      questionId: args.questionId,
      userAnswer: args.userAnswer,
      isCorrect,
      answeredAt: Date.now(),
    })
    await createPendingAnswerAssessment(ctx, {
      userId,
      attemptId: args.attemptId,
      attemptAnswerId,
      question,
      learnerAnswer: args.userAnswer,
      deterministicIsCorrect: isCorrect,
    })

    const allAnswers = await ctx.db
      .query('attemptAnswers')
      .withIndex('by_attemptId', q => q.eq('attemptId', args.attemptId))
      .take(MAX_QUIZ_QUESTIONS)
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
    await requireQuiz(ctx, attempt.quizId, userId)

    const questions = await ctx.db
      .query('quizQuestions')
      .withIndex('by_quizId', q => q.eq('quizId', attempt.quizId))
      .take(MAX_QUIZ_QUESTIONS)

    const questionMap = new Map(questions.map(q => [q._id as string, q]))

    const existingAnswers = await ctx.db
      .query('attemptAnswers')
      .withIndex('by_attemptId', q => q.eq('attemptId', args.attemptId))
      .take(MAX_QUIZ_QUESTIONS)
    const alreadyAnswered = new Set(existingAnswers.map(a => a.questionId as string))

    const results = []
    let correctCount = existingAnswers.filter(answer => answer.isCorrect && questionMap.has(String(answer.questionId))).length

    for (const a of args.answers) {
      const question = questionMap.get(a.questionId as string)
      if (!question) continue
      if (alreadyAnswered.has(a.questionId as string)) continue

      const isCorrect = scoreAnswer(question.type, a.userAnswer, question.correctAnswer, question.question)
      if (isCorrect) correctCount++

      const attemptAnswerId = await ctx.db.insert('attemptAnswers', {
        attemptId: args.attemptId,
        questionId: a.questionId,
        userAnswer: a.userAnswer,
        isCorrect,
        answeredAt: Date.now(),
      })
      await createPendingAnswerAssessment(ctx, {
        userId,
        attemptId: args.attemptId,
        attemptAnswerId,
        question,
        learnerAnswer: a.userAnswer,
        deterministicIsCorrect: isCorrect,
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
    await requireQuiz(ctx, attempt.quizId, userId)

    const answers = await ctx.db
      .query('attemptAnswers')
      .withIndex('by_attemptId', q => q.eq('attemptId', args.attemptId))
      .take(MAX_QUIZ_QUESTIONS)

    const questions = await ctx.db
      .query('quizQuestions')
      .withIndex('by_quizId', q => q.eq('quizId', attempt.quizId))
      .take(MAX_QUIZ_QUESTIONS)
    const questionIds = new Set(questions.map(question => String(question._id)))
    const correctCount = answers.filter(answer => answer.isCorrect && questionIds.has(String(answer.questionId))).length

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
    await requireQuiz(ctx, attempt.quizId, userId)

    await ctx.db.patch(args.attemptId, { status: 'abandoned' })
    await ctx.db.patch(attempt.quizId, { latestAttemptStatus: 'abandoned' })
  },
})

export const getAttemptResults = query({
  args: { attemptId: v.id('quizAttempts') },
  handler: async (ctx, args) => {
    const userId = await getOptionalAuthUserId(ctx)
    if (!userId) return null

    const attempt = await ctx.db.get(args.attemptId)
    if (!attempt || attempt.userId !== userId) return null

    const quiz = await ctx.db.get(attempt.quizId)
    if (!quiz || quiz.deletedAt !== undefined) return null

    const questions = await ctx.db
      .query('quizQuestions')
      .withIndex('by_quizId', q => q.eq('quizId', attempt.quizId))
      .take(MAX_QUIZ_QUESTIONS)

    const questionMap = new Map(questions.map(q => [q._id as string, q]))

    const attemptAnswers = await ctx.db
      .query('attemptAnswers')
      .withIndex('by_attemptId', q => q.eq('attemptId', args.attemptId))
      .take(MAX_QUIZ_QUESTIONS)

    const assessments = await ctx.db
      .query('quizAnswerAssessments')
      .withIndex('by_userId_and_attemptId', q => q.eq('userId', userId).eq('attemptId', args.attemptId))
      .take(MAX_QUIZ_QUESTIONS)
    const assessmentMap = new Map(assessments.map(row => [row.attemptAnswerId as string, row]))

    if (attemptAnswers.length > 0) {
      const results = attemptAnswers.map(a => {
        const q = questionMap.get(a.questionId as string)
        const assessment = assessmentMap.get(a._id as string)
        return {
          questionId: a.questionId,
          questionText: assessment?.questionSnapshot.question ?? q?.question ?? '',
          questionType: assessment?.questionSnapshot.questionType ?? q?.type ?? 'multiple-choice',
          options: q?.options,
          userAnswer: a.userAnswer,
          isCorrect: a.isCorrect,
          correctAnswer: assessment?.questionSnapshot.expectedAnswer ?? q?.correctAnswer ?? '',
          explanation: assessment?.questionSnapshot.explanation ?? q?.explanation,
          feedback: a.feedback,
          semanticAssessment: assessment ? {
            status: assessment.status,
            label: assessment.label,
            confidence: assessment.confidence,
            probabilities: assessment.probabilities,
            unavailableReason: assessment.unavailableReason,
            retryable: assessment.retryable,
            retryDueAt: assessment.nextAttemptAt,
            attemptCount: assessment.attemptCount ?? 0,
            rubricVersion: assessment.rubricVersion,
            deterministicScoreUnchanged: true,
          } : undefined,
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
          semanticAssessment: undefined,
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
    const userId = await getOptionalAuthUserId(ctx)
    if (!userId) return []

    const quiz = await ctx.db.get(args.quizId)
    if (!quiz || quiz.userId !== userId || quiz.deletedAt !== undefined) return []

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
    await requireQuiz(ctx, args.quizId, userId)

    const questions = await ctx.db
      .query('quizQuestions')
      .withIndex('by_quizId', (q) => q.eq('quizId', args.quizId))
      .take(MAX_QUIZ_QUESTIONS)

    const questionMap = new Map<string, (typeof questions)[number]>(
      questions.map((q) => [q._id as unknown as string, q]),
    )

    for (const a of args.answers) {
      const q = questionMap.get(a.questionId as unknown as string)
      if (!q || q.userId !== userId) throw new Error('Invalid question')
    }

    if (new Set(args.answers.map(answer => String(answer.questionId))).size !== args.answers.length) throw new Error('Duplicate answer')

    const scoredAnswers = args.answers.map((a) => {
      const q = questionMap.get(a.questionId as unknown as string)!
      return {
        questionId: a.questionId,
        response: a.response,
        isCorrect: scoreAnswer(q.type, a.response, q.correctAnswer, q.question),
      }
    })

    const correctCount = scoredAnswers.filter((a) => a.isCorrect).length
    const total = questions.length
    const completedAt = Date.now()
    const percentage = total > 0 ? Math.round((correctCount / total) * 100) : 0

    const attemptId = await ctx.db.insert('quizAttempts', {
      userId,
      quizId: args.quizId,
      score: correctCount,
      total,
      completedAt,
      status: 'completed',
    })

    for (const answer of scoredAnswers) {
      const question = questionMap.get(String(answer.questionId))!
      const attemptAnswerId = await ctx.db.insert('attemptAnswers', {
        attemptId,
        questionId: answer.questionId,
        userAnswer: answer.response,
        isCorrect: answer.isCorrect,
        answeredAt: completedAt,
      })
      await createPendingAnswerAssessment(ctx, {
        userId,
        attemptId,
        attemptAnswerId,
        question,
        learnerAnswer: answer.response,
        deterministicIsCorrect: answer.isCorrect,
      })
    }

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
    const userId = await getOptionalAuthUserId(ctx)
    if (!userId) return []

    const quiz = await ctx.db.get(args.quizId)
    if (!quiz || quiz.userId !== userId || quiz.deletedAt !== undefined) return []

    const attempts = await ctx.db
      .query('quizAttempts')
      .withIndex('by_userId_and_quizId', (q) =>
        q.eq('userId', userId).eq('quizId', args.quizId),
      )
      .order('desc')
      .take(20)
    return await Promise.all(attempts.map(async (attempt) => {
      if (attempt.answers) return attempt
      const rows = await ctx.db
        .query('attemptAnswers')
        .withIndex('by_attemptId', q => q.eq('attemptId', attempt._id))
        .take(MAX_QUIZ_QUESTIONS)
      return {
        ...attempt,
        answers: rows.map(row => ({ questionId: row.questionId, response: row.userAnswer, isCorrect: row.isCorrect })),
      }
    }))
  },
})

export const deleteQuiz = mutation({
  args: { quizId: v.id('quizzes') },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const quiz = await ctx.db.get(args.quizId)
    if (!quiz || quiz.userId !== userId) throw new Error('Quiz not found')
    if (quiz.deletedAt === undefined) await ctx.db.patch(args.quizId, { deletedAt: Date.now() })
    await ctx.scheduler.runAfter(0, internal.quizzes.drainQuizDeletion, { quizId: args.quizId })
    return { tombstoned: true }
  },
})

export const drainQuizDeletion = internalMutation({
  args: { quizId: v.id('quizzes') },
  handler: async (ctx, args) => {
    const quiz = await ctx.db.get(args.quizId)
    if (!quiz || quiz.deletedAt === undefined) return null
    const [attempt] = await ctx.db
      .query('quizAttempts')
      .withIndex('by_quizId', q => q.eq('quizId', args.quizId))
      .take(1)
    if (attempt) {
      const assessments = await ctx.db
        .query('quizAnswerAssessments')
        .withIndex('by_attemptId', q => q.eq('attemptId', attempt._id))
        .take(DELETE_BATCH_SIZE)
      for (const assessment of assessments) await ctx.db.delete(assessment._id)
      if (assessments.length === DELETE_BATCH_SIZE) {
        await ctx.scheduler.runAfter(0, internal.quizzes.drainQuizDeletion, args)
        return null
      }
      const answers = await ctx.db
        .query('attemptAnswers')
        .withIndex('by_attemptId', q => q.eq('attemptId', attempt._id))
        .take(DELETE_BATCH_SIZE)
      for (const answer of answers) await ctx.db.delete(answer._id)
      if (answers.length === DELETE_BATCH_SIZE) {
        await ctx.scheduler.runAfter(0, internal.quizzes.drainQuizDeletion, args)
        return null
      }
      await ctx.db.delete(attempt._id)
      await ctx.scheduler.runAfter(0, internal.quizzes.drainQuizDeletion, args)
      return null
    }
    const questions = await ctx.db
      .query('quizQuestions')
      .withIndex('by_quizId', q => q.eq('quizId', args.quizId))
      .take(DELETE_BATCH_SIZE)
    for (const question of questions) await ctx.db.delete(question._id)
    if (questions.length > 0) {
      await ctx.scheduler.runAfter(0, internal.quizzes.drainQuizDeletion, args)
      return null
    }
    await ctx.db.delete(args.quizId)
    return null
  },
})
