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
    description: v.optional(v.string()),
    color: v.optional(v.string()),
    icon: v.optional(v.string()),
  })
    .index('by_userId', ['userId'])
    .index('by_userId_and_parentId', ['userId', 'parentId']),

  documents: defineTable({
    userId: v.string(),
    folderId: v.id('folders'),
    filename: v.string(),
    fileId: v.optional(v.id('_storage')),
    status: v.union(v.literal('processing'), v.literal('indexing'), v.literal('success'), v.literal('failed')),
    fileSize: v.number(),
    failureReason: v.optional(v.string()),
    indexJobId: v.optional(v.string()),
    r2Key: v.optional(v.string()),
    sourceType: v.optional(v.union(v.literal('file'), v.literal('website'), v.literal('youtube'))),
    sourceUrl: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    taskId: v.optional(v.id('tasks')),
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
    description: v.optional(v.string()),
    creationMethod: v.optional(v.union(v.literal('manual'), v.literal('auto_generated'))),
    difficulty: v.optional(v.string()),
    language: v.optional(v.string()),
    questionCount: v.optional(v.number()),
    latestAttemptStatus: v.optional(v.union(v.literal('in_progress'), v.literal('completed'), v.literal('abandoned'))),
  })
    .index('by_userId', ['userId'])
    .index('by_folderId', ['folderId'])
    .index('by_userId_and_folderId', ['userId', 'folderId']),

  quizQuestions: defineTable({
    quizId: v.id('quizzes'),
    userId: v.string(),
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
    sourceDocumentId: v.optional(v.id('documents')),
    sourceChunkContent: v.optional(v.string()),
    sourceFilename: v.optional(v.string()),
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

  flashcardRooms: defineTable({
    userId: v.string(),
    folderId: v.id('folders'),
    title: v.string(),
    updatedAt: v.number(),
    cardCount: v.optional(v.number()),
    currentCardCount: v.optional(v.number()),
    activeVersionId: v.optional(v.id('flashcardRoomVersions')),
    migratedFromSetId: v.optional(v.id('flashcardSets')),
    legacySetId: v.optional(v.id('flashcardSets')),
    legacyCreatedAt: v.optional(v.number()),
  })
    .index('by_userId', ['userId'])
    .index('by_userId_and_folderId', ['userId', 'folderId'])
    .index('by_migratedFromSetId', ['migratedFromSetId']),

  flashcardRoomCards: defineTable({
    roomId: v.id('flashcardRooms'),
    userId: v.string(),
    displayOrder: v.number(),
    term: v.string(),
    definition: v.string(),
    metadata: v.optional(
      v.object({
        source: v.optional(
          v.object({
            documentId: v.optional(v.id('documents')),
            filename: v.string(),
            chunkContent: v.string(),
          }),
        ),
        model: v.optional(v.string()),
        origin: v.optional(v.string()),
      }),
    ),
    sourceDocumentId: v.optional(v.id('documents')),
    sourceChunkContent: v.optional(v.string()),
    sourceFilename: v.optional(v.string()),
    updatedAt: v.optional(v.number()),
  })
    .index('by_roomId', ['roomId'])
    .index('by_roomId_and_displayOrder', ['roomId', 'displayOrder'])
    .index('by_userId', ['userId']),

  flashcardRoomVersions: defineTable({
    roomId: v.id('flashcardRooms'),
    userId: v.string(),
    title: v.string(),
    origin: v.string(),
    prompt: v.optional(v.string()),
    requestedCardCount: v.optional(v.number()),
    cardCount: v.optional(v.number()),
    model: v.optional(v.string()),
    createdAt: v.optional(v.number()),
  })
    .index('by_roomId', ['roomId'])
    .index('by_userId', ['userId']),

  flashcardVersionCards: defineTable({
    versionId: v.id('flashcardRoomVersions'),
    roomId: v.id('flashcardRooms'),
    userId: v.string(),
    displayOrder: v.number(),
    term: v.string(),
    definition: v.string(),
    metadata: v.optional(
      v.object({
        source: v.optional(
          v.object({
            documentId: v.optional(v.id('documents')),
            filename: v.string(),
            chunkContent: v.string(),
          }),
        ),
        model: v.optional(v.string()),
        origin: v.optional(v.string()),
      }),
    ),
    sourceDocumentId: v.optional(v.id('documents')),
    sourceChunkContent: v.optional(v.string()),
    sourceFilename: v.optional(v.string()),
    updatedAt: v.optional(v.number()),
  })
    .index('by_versionId', ['versionId'])
    .index('by_roomId', ['roomId'])
    .index('by_userId', ['userId']),

  quizAttempts: defineTable({
    userId: v.string(),
    quizId: v.id('quizzes'),
    answers: v.optional(v.array(
      v.object({
        questionId: v.id('quizQuestions'),
        response: v.string(),
        isCorrect: v.boolean(),
      }),
    )),
    score: v.number(),
    total: v.number(),
    completedAt: v.optional(v.number()),
    status: v.optional(v.union(v.literal('in_progress'), v.literal('completed'), v.literal('abandoned'))),
    settingsSnapshot: v.optional(v.object({
      shuffleQuestions: v.boolean(),
      showAllQuestions: v.boolean(),
      immediateFeedback: v.boolean(),
    })),
    currentQuestionIndex: v.optional(v.number()),
    startedAt: v.optional(v.number()),
    questionOrder: v.optional(v.array(v.id('quizQuestions'))),
  })
    .index('by_userId', ['userId'])
    .index('by_quizId', ['quizId'])
    .index('by_userId_and_quizId', ['userId', 'quizId'])
    .index('by_quizId_and_status', ['quizId', 'status']),

  attemptAnswers: defineTable({
    attemptId: v.id('quizAttempts'),
    questionId: v.id('quizQuestions'),
    userAnswer: v.string(),
    isCorrect: v.boolean(),
    feedback: v.optional(v.string()),
    answeredAt: v.number(),
  })
    .index('by_attemptId', ['attemptId'])
    .index('by_attemptId_and_questionId', ['attemptId', 'questionId']),

  tasks: defineTable({
    userId: v.string(),
    folderId: v.id('folders'),
    type: v.string(),
    status: v.string(),
    title: v.string(),
    progress: v.optional(v.string()),
    metadata: v.optional(v.any()),
    result: v.optional(v.any()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index('by_userId_and_folderId', ['userId', 'folderId'])
    .index('by_status', ['status']),

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
