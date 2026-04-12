import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  users: defineTable({
    tokenIdentifier: v.string(),
    name: v.string(),
    email: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
  }).index('by_tokenIdentifier', ['tokenIdentifier']),

  folders: defineTable({
    userId: v.string(),
    name: v.string(),
    parentId: v.optional(v.id('folders')),
    documentCount: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index('by_userId', ['userId'])
    .index('by_userId_and_parentId', ['userId', 'parentId']),

  documents: defineTable({
    userId: v.string(),
    folderId: v.id('folders'),
    filename: v.string(),
    fileId: v.id('_storage'),
    status: v.union(v.literal('processing'), v.literal('indexing'), v.literal('success'), v.literal('failed')),
    fileSize: v.number(),
    failureReason: v.optional(v.string()),
    indexJobId: v.optional(v.string()),
    r2Key: v.optional(v.string()),
  })
    .index('by_userId', ['userId'])
    .index('by_folderId', ['folderId'])
    .index('by_userId_and_folderId', ['userId', 'folderId'])
    .index('by_status', ['status']),

  conversations: defineTable({
    userId: v.string(),
    folderId: v.id('folders'),
    title: v.string(),
  })
    .index('by_userId', ['userId'])
    .index('by_userId_and_folderId', ['userId', 'folderId']),

  messages: defineTable({
    conversationId: v.id('conversations'),
    userId: v.string(),
    role: v.union(v.literal('user'), v.literal('assistant')),
    content: v.string(),
    sources: v.optional(
      v.array(
        v.object({
          content: v.string(),
          score: v.number(),
          filename: v.string(),
        }),
      ),
    ),
    model: v.optional(v.string()),
  })
    .index('by_conversationId', ['conversationId'])
    .index('by_userId', ['userId']),

  quizzes: defineTable({
    userId: v.string(),
    folderId: v.id('folders'),
    title: v.string(),
    status: v.union(v.literal('generating'), v.literal('ready'), v.literal('failed')),
    failureReason: v.optional(v.string()),
    model: v.optional(v.string()),
    score: v.optional(v.number()),
    completedAt: v.optional(v.number()),
  })
    .index('by_userId', ['userId'])
    .index('by_folderId', ['folderId'])
    .index('by_userId_and_folderId', ['userId', 'folderId']),

  quizQuestions: defineTable({
    quizId: v.id('quizzes'),
    userId: v.string(),
    order: v.number(),
    question: v.string(),
    type: v.union(v.literal('multiple-choice'), v.literal('free-response')),
    options: v.optional(v.array(v.string())),
    correctAnswer: v.string(),
    sourceDocumentId: v.optional(v.id('documents')),
    sourceChunkContent: v.string(),
    sourceFilename: v.string(),
  })
    .index('by_quizId', ['quizId'])
    .index('by_userId', ['userId']),

  flashcardSets: defineTable({
    userId: v.string(),
    folderId: v.id('folders'),
    title: v.string(),
    status: v.union(v.literal('generating'), v.literal('ready'), v.literal('failed')),
    failureReason: v.optional(v.string()),
    model: v.optional(v.string()),
    cardCount: v.number(),
  })
    .index('by_userId', ['userId'])
    .index('by_folderId', ['folderId'])
    .index('by_userId_and_folderId', ['userId', 'folderId']),

  flashcards: defineTable({
    setId: v.id('flashcardSets'),
    userId: v.string(),
    order: v.number(),
    front: v.string(),
    back: v.string(),
    sourceDocumentId: v.optional(v.id('documents')),
    sourceChunkContent: v.string(),
    sourceFilename: v.string(),
  })
    .index('by_setId', ['setId'])
    .index('by_userId', ['userId']),

  quizAttempts: defineTable({
    userId: v.string(),
    quizId: v.id('quizzes'),
    answers: v.array(
      v.object({
        questionId: v.id('quizQuestions'),
        response: v.string(),
        isCorrect: v.boolean(),
      }),
    ),
    score: v.number(),
    total: v.number(),
    completedAt: v.number(),
  })
    .index('by_userId', ['userId'])
    .index('by_quizId', ['quizId'])
    .index('by_userId_and_quizId', ['userId', 'quizId']),

  pendingCleanup: defineTable({
    userId: v.string(),
    documentId: v.string(),
    r2Key: v.optional(v.string()),
    kind: v.union(v.literal('ai-search'), v.literal('r2')),
    attempts: v.number(),
    lastAttemptAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
  })
    .index('by_userId', ['userId'])
    .index('by_kind_and_attempts', ['kind', 'attempts']),
})
