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
