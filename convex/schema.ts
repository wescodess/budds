import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  users: defineTable({
    tokenIdentifier: v.string(),
    name: v.string(),
    email: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    audioOverviewQuota: v.optional(v.object({
      date: v.string(),
      count: v.number(),
    })),
    audioOverviewInterjectionQuota: v.optional(v.object({
      date: v.string(),
      count: v.number(),
    })),
    learnV2Entitlement: v.optional(v.object({
      enabled: v.boolean(),
      updatedAt: v.number(),
    })),
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
    preferredMainPane: v.optional(v.union(v.literal('chat'), v.literal('podcast'))),
    referenceScope: v.optional(v.object({
      folderIds: v.optional(v.array(v.id('folders'))),
      fileIds: v.optional(v.array(v.id('documents'))),
    })),
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
    contentHash: v.optional(v.string()),
    sourceRevision: v.optional(v.string()),
    taskId: v.optional(v.id('tasks')),
  })
    .index('by_userId', ['userId'])
    .index('by_folderId', ['folderId'])
    .index('by_userId_and_folderId', ['userId', 'folderId'])
    .index('by_userId_and_folderId_and_status', ['userId', 'folderId', 'status'])
    .index('by_status', ['status']),

  conversations: defineTable({
    userId: v.string(),
    folderId: v.id('folders'),
    title: v.string(),
    archivedAt: v.optional(v.number()),
  })
    .index('by_userId', ['userId'])
    .index('by_userId_and_folderId', ['userId', 'folderId']),

  audioOverviewRooms: defineTable({
    userId: v.string(),
    folderId: v.id('folders'),
    conversationId: v.optional(v.id('conversations')),
    legacyImport: v.optional(v.boolean()),
    title: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_userId', ['userId'])
    .index('by_userId_and_folderId', ['userId', 'folderId'])
    .index('by_userId_and_conversationId', ['userId', 'conversationId']),

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
    interjectionContext: v.optional(v.object({
      overviewId: v.id('audioOverviews'),
      turnIndex: v.number(),
      timeMs: v.number(),
      quotedText: v.string(),
      sourceFilename: v.optional(v.string()),
      interjectionId: v.optional(v.id('audioOverviewInterjections')),
    })),
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
    courseScoped: v.optional(v.boolean()),
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
    flagged: v.optional(v.boolean()),
    correctedAnswer: v.optional(v.string()),
    correctedExplanation: v.optional(v.string()),
    flaggedAt: v.optional(v.number()),
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
    courseScoped: v.optional(v.boolean()),
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
    flagged: v.optional(v.boolean()),
    correctedDefinition: v.optional(v.string()),
    flaggedAt: v.optional(v.number()),
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
    folderId: v.optional(v.id('folders')),
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
    audioOverviewRequest: v.optional(v.object({
      roomId: v.optional(v.id('audioOverviewRooms')),
      scope: v.union(
        v.object({ mode: v.literal('folder') }),
        v.object({
          mode: v.literal('explicit'),
          documentIds: v.array(v.id('documents')),
        }),
      ),
      documents: v.array(v.object({
        documentId: v.id('documents'),
        folderId: v.id('folders'),
        filename: v.string(),
        r2Key: v.optional(v.string()),
        fileSize: v.optional(v.number()),
        mimeType: v.optional(v.string()),
        contentHash: v.optional(v.string()),
        sourceRevision: v.optional(v.string()),
      })),
      preferences: v.object({
        lengthMinutes: v.union(v.literal(5), v.literal(10), v.literal(20)),
        complexity: v.union(v.literal('beginner'), v.literal('expert')),
      }),
      voiceProfile: v.object({
        hostA: v.union(
          v.literal('asteria'), v.literal('luna'), v.literal('stella'),
          v.literal('athena'), v.literal('hera'), v.literal('orion'),
          v.literal('arcas'), v.literal('perseus'), v.literal('angus'),
          v.literal('orpheus'), v.literal('helios'), v.literal('zeus'),
        ),
        hostB: v.union(
          v.literal('asteria'), v.literal('luna'), v.literal('stella'),
          v.literal('athena'), v.literal('hera'), v.literal('orion'),
          v.literal('arcas'), v.literal('perseus'), v.literal('angus'),
          v.literal('orpheus'), v.literal('helios'), v.literal('zeus'),
        ),
      }),
      hostNames: v.optional(v.object({
        hostA: v.string(),
        hostB: v.string(),
      })),
      model: v.optional(v.string()),
      quotaDate: v.string(),
    })),
  })
    .index('by_userId_and_folderId', ['userId', 'folderId'])
    .index('by_userId', ['userId'])
    .index('by_userId_and_type_and_status', ['userId', 'type', 'status'])
    .index('by_status', ['status']),

  audioOverviewJobs: defineTable({
    userId: v.string(),
    taskId: v.id('tasks'),
    folderId: v.id('folders'),
    roomId: v.optional(v.id('audioOverviewRooms')),
    idempotencyKey: v.string(),
    capabilityHash: v.string(),
    status: v.union(
      v.literal('accepted'),
      v.literal('running'),
      v.literal('completed'),
      v.literal('failed'),
      v.literal('cancelled'),
    ),
    stage: v.union(
      v.literal('accepted'),
      v.literal('preparing'),
      v.literal('synthesizing'),
      v.literal('finalizing'),
      v.literal('complete'),
      v.literal('failed'),
      v.literal('cancelled'),
    ),
    title: v.optional(v.string()),
    model: v.optional(v.string()),
    ttsEngine: v.optional(v.union(v.literal('aura-1'), v.literal('dia'))),
    sourceDocumentIds: v.optional(v.array(v.id('documents'))),
    scriptAttemptId: v.optional(v.string()),
    scriptAttemptStartedAt: v.optional(v.number()),
    scriptAttemptsStarted: v.optional(v.number()),
    totalTurns: v.optional(v.number()),
    completedTurns: v.number(),
    budgetReservedMicrousd: v.optional(v.number()),
    budgetDebitedMicrousd: v.optional(v.number()),
    budgetDebitKeys: v.optional(v.array(v.string())),
    estimatedCostMicrousd: v.optional(v.number()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index('by_taskId', ['taskId'])
    .index('by_userId', ['userId'])
    .index('by_userId_and_idempotencyKey', ['userId', 'idempotencyKey'])
    .index('by_userId_and_status', ['userId', 'status'])
    .index('by_status_and_updatedAt', ['status', 'updatedAt']),

  audioOverviewSourceManifests: defineTable({
    jobId: v.id('audioOverviewJobs'),
    taskId: v.id('tasks'),
    userId: v.string(),
    folderId: v.id('folders'),
    schemaVersion: v.literal(2),
    revision: v.string(),
    contentHash: v.string(),
    planFingerprint: v.string(),
    entryCount: v.number(),
    frozenAt: v.number(),
  })
    .index('by_jobId', ['jobId'])
    .index('by_taskId', ['taskId'])
    .index('by_userId', ['userId']),

  audioOverviewSourceManifestEntries: defineTable({
    manifestId: v.id('audioOverviewSourceManifests'),
    jobId: v.id('audioOverviewJobs'),
    userId: v.string(),
    order: v.number(),
    sourceId: v.string(),
    documentId: v.id('documents'),
    revision: v.string(),
    contentHash: v.string(),
    displayReference: v.string(),
    objectKey: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('by_manifestId_and_order', ['manifestId', 'order'])
    .index('by_jobId', ['jobId'])
    .index('by_documentId', ['documentId'])
    .index('by_userId', ['userId']),

  audioOverviewOutlines: defineTable({
    jobId: v.id('audioOverviewJobs'),
    taskId: v.id('tasks'),
    userId: v.string(),
    narrativeArc: v.string(),
    learningObjectiveCount: v.number(),
    createdAt: v.number(),
  })
    .index('by_jobId', ['jobId'])
    .index('by_taskId', ['taskId'])
    .index('by_userId', ['userId']),

  audioOverviewLearningObjectives: defineTable({
    outlineId: v.id('audioOverviewOutlines'),
    jobId: v.id('audioOverviewJobs'),
    userId: v.string(),
    order: v.number(),
    text: v.string(),
    createdAt: v.number(),
  })
    .index('by_outlineId_and_order', ['outlineId', 'order'])
    .index('by_jobId', ['jobId'])
    .index('by_userId', ['userId']),

  audioOverviewOutlineSources: defineTable({
    outlineId: v.id('audioOverviewOutlines'),
    manifestEntryId: v.id('audioOverviewSourceManifestEntries'),
    jobId: v.id('audioOverviewJobs'),
    userId: v.string(),
    order: v.number(),
    createdAt: v.number(),
  })
    .index('by_outlineId_and_order', ['outlineId', 'order'])
    .index('by_jobId', ['jobId'])
    .index('by_userId', ['userId']),

  audioOverviewClaimLedgers: defineTable({
    jobId: v.id('audioOverviewJobs'),
    taskId: v.id('tasks'),
    userId: v.string(),
    claimCount: v.number(),
    supportedClaimCount: v.number(),
    createdAt: v.number(),
  })
    .index('by_jobId', ['jobId'])
    .index('by_taskId', ['taskId'])
    .index('by_userId', ['userId']),

  audioOverviewClaims: defineTable({
    ledgerId: v.id('audioOverviewClaimLedgers'),
    jobId: v.id('audioOverviewJobs'),
    userId: v.string(),
    order: v.number(),
    claimId: v.string(),
    text: v.string(),
    status: v.union(v.literal('supported'), v.literal('unsupported')),
    verificationVersion: v.optional(v.literal('claim-entailment.v1')),
    verificationModel: v.optional(v.string()),
    entailmentDecision: v.optional(v.literal('entailed')),
    entailmentReason: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('by_ledgerId_and_order', ['ledgerId', 'order'])
    .index('by_jobId', ['jobId'])
    .index('by_userId', ['userId']),

  audioOverviewClaimSources: defineTable({
    ledgerId: v.id('audioOverviewClaimLedgers'),
    claimRecordId: v.id('audioOverviewClaims'),
    manifestEntryId: v.id('audioOverviewSourceManifestEntries'),
    jobId: v.id('audioOverviewJobs'),
    userId: v.string(),
    createdAt: v.number(),
  })
    .index('by_claimRecordId_and_manifestEntryId', ['claimRecordId', 'manifestEntryId'])
    .index('by_ledgerId', ['ledgerId'])
    .index('by_jobId', ['jobId'])
    .index('by_userId', ['userId']),

  audioOverviewEpisodes: defineTable({
    jobId: v.id('audioOverviewJobs'),
    taskId: v.id('tasks'),
    userId: v.string(),
    folderId: v.id('folders'),
    roomId: v.optional(v.id('audioOverviewRooms')),
    sourceManifestId: v.id('audioOverviewSourceManifests'),
    outlineId: v.id('audioOverviewOutlines'),
    claimLedgerId: v.id('audioOverviewClaimLedgers'),
    schemaVersion: v.literal(2),
    title: v.string(),
    model: v.string(),
    audioProfileId: v.string(),
    audioProfileVersion: v.string(),
    renderer: v.string(),
    hostAVoice: v.string(),
    hostBVoice: v.string(),
    hostAName: v.optional(v.string()),
    hostBName: v.optional(v.string()),
    requestedLengthMinutes: v.union(v.literal(5), v.literal(10), v.literal(20)),
    complexity: v.union(v.literal('beginner'), v.literal('expert')),
    status: v.union(
      v.literal('planning'),
      v.literal('rendering'),
      v.literal('ready'),
      v.literal('failed'),
      v.literal('deleting'),
    ),
    sceneCount: v.number(),
    utteranceCount: v.number(),
    totalDurationMs: v.optional(v.number()),
    finalArtifactId: v.optional(v.id('audioOverviewAudioArtifacts')),
    alignmentId: v.optional(v.id('audioOverviewAlignments')),
    compatibilityOverviewId: v.optional(v.id('audioOverviews')),
    failureReason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    publishedAt: v.optional(v.number()),
  })
    .index('by_jobId', ['jobId'])
    .index('by_taskId', ['taskId'])
    .index('by_userId', ['userId'])
    .index('by_userId_and_status', ['userId', 'status'])
    .index('by_userId_and_folderId', ['userId', 'folderId'])
    .index('by_userId_and_roomId', ['userId', 'roomId']),

  audioOverviewScenes: defineTable({
    episodeId: v.id('audioOverviewEpisodes'),
    jobId: v.id('audioOverviewJobs'),
    userId: v.string(),
    order: v.number(),
    title: v.string(),
    narrativePurpose: v.string(),
    targetDurationMs: v.number(),
    status: v.union(
      v.literal('pending'),
      v.literal('rendering'),
      v.literal('ready'),
      v.literal('failed'),
    ),
    currentAttempt: v.number(),
    durationMs: v.optional(v.number()),
    audioArtifactId: v.optional(v.id('audioOverviewAudioArtifacts')),
    updatedAt: v.number(),
  })
    .index('by_episodeId_and_order', ['episodeId', 'order'])
    .index('by_jobId_and_order', ['jobId', 'order'])
    .index('by_userId', ['userId']),

  audioOverviewUtterances: defineTable({
    episodeId: v.id('audioOverviewEpisodes'),
    sceneId: v.id('audioOverviewScenes'),
    jobId: v.id('audioOverviewJobs'),
    userId: v.string(),
    order: v.number(),
    sceneOrder: v.number(),
    speaker: v.union(v.literal('host_a'), v.literal('host_b')),
    text: v.string(),
    emotionalIntent: v.string(),
    deliveryIntent: v.string(),
    pauseAfterMs: v.optional(v.number()),
    verificationUtteranceId: v.optional(v.string()),
    verificationVersion: v.optional(v.literal('claim-entailment.v1')),
    verificationModel: v.optional(v.string()),
    entailmentDecision: v.optional(v.literal('entailed')),
    entailmentReason: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('by_episodeId_and_order', ['episodeId', 'order'])
    .index('by_sceneId_and_sceneOrder', ['sceneId', 'sceneOrder'])
    .index('by_jobId', ['jobId'])
    .index('by_userId', ['userId']),

  audioOverviewUtteranceSources: defineTable({
    episodeId: v.id('audioOverviewEpisodes'),
    utteranceId: v.id('audioOverviewUtterances'),
    manifestEntryId: v.id('audioOverviewSourceManifestEntries'),
    jobId: v.id('audioOverviewJobs'),
    userId: v.string(),
    createdAt: v.number(),
  })
    .index('by_utteranceId_and_manifestEntryId', ['utteranceId', 'manifestEntryId'])
    .index('by_episodeId', ['episodeId'])
    .index('by_jobId', ['jobId'])
    .index('by_userId', ['userId']),

  audioOverviewUtteranceClaims: defineTable({
    episodeId: v.id('audioOverviewEpisodes'),
    utteranceId: v.id('audioOverviewUtterances'),
    claimRecordId: v.id('audioOverviewClaims'),
    jobId: v.id('audioOverviewJobs'),
    userId: v.string(),
    createdAt: v.number(),
  })
    .index('by_utteranceId_and_claimRecordId', ['utteranceId', 'claimRecordId'])
    .index('by_episodeId', ['episodeId'])
    .index('by_jobId', ['jobId'])
    .index('by_userId', ['userId']),

  audioOverviewAudioArtifacts: defineTable({
    episodeId: v.id('audioOverviewEpisodes'),
    sceneId: v.optional(v.id('audioOverviewScenes')),
    interjectionId: v.optional(v.id('audioOverviewInterjectionsV2')),
    jobId: v.id('audioOverviewJobs'),
    userId: v.string(),
    kind: v.union(v.literal('scene'), v.literal('final'), v.literal('interjection')),
    status: v.union(
      v.literal('staged'),
      v.literal('rejected'),
      v.literal('published'),
      v.literal('deleting'),
      v.literal('deleted'),
    ),
    storageProvider: v.literal('r2'),
    objectKey: v.string(),
    etag: v.optional(v.string()),
    checksumSha256: v.string(),
    byteLength: v.number(),
    contentType: v.string(),
    container: v.union(v.literal('pcm'), v.literal('wav')),
    sampleRateHz: v.literal(24000),
    channelCount: v.literal(1),
    bitsPerSample: v.literal(16),
    durationMs: v.number(),
    rendererRequestId: v.optional(v.string()),
    createdAt: v.number(),
    publishedAt: v.optional(v.number()),
  })
    .index('by_episodeId_and_kind', ['episodeId', 'kind'])
    .index('by_sceneId', ['sceneId'])
    .index('by_interjectionId', ['interjectionId'])
    .index('by_jobId_and_objectKey', ['jobId', 'objectKey'])
    .index('by_userId', ['userId']),

  audioOverviewSceneQualityGates: defineTable({
    episodeId: v.id('audioOverviewEpisodes'),
    sceneId: v.id('audioOverviewScenes'),
    artifactId: v.id('audioOverviewAudioArtifacts'),
    jobId: v.id('audioOverviewJobs'),
    userId: v.string(),
    attempt: v.number(),
    passed: v.boolean(),
    claimsSupported: v.boolean(),
    // These two booleans verify the immutable script/profile contract only.
    // Mono PCM + text-only ASR cannot truthfully prove acoustic voice count or
    // voice identity, so those release-level checks remain explicitly unmeasured.
    scriptedSpeakerPairValid: v.boolean(),
    audioProfileMatches: v.boolean(),
    speakerCountEvidence: v.literal('not_measured'),
    speakerConsistencyEvidence: v.literal('not_measured'),
    durationWithinTolerance: v.boolean(),
    silenceWithinTolerance: v.boolean(),
    clippingWithinTolerance: v.boolean(),
    truncationFree: v.boolean(),
    tempoWithinTolerance: v.boolean(),
    directionsNotSpoken: v.boolean(),
    transcriptDivergence: v.optional(v.number()),
    transcriptDivergenceThreshold: v.optional(v.number()),
    failureCode: v.optional(v.string()),
    failureMessage: v.optional(v.string()),
    evaluatedAt: v.number(),
  })
    .index('by_sceneId_and_attempt', ['sceneId', 'attempt'])
    .index('by_episodeId', ['episodeId'])
    .index('by_jobId', ['jobId'])
    .index('by_userId', ['userId']),

  audioOverviewAlignments: defineTable({
    episodeId: v.id('audioOverviewEpisodes'),
    artifactId: v.id('audioOverviewAudioArtifacts'),
    jobId: v.id('audioOverviewJobs'),
    userId: v.string(),
    status: v.union(v.literal('pending'), v.literal('ready'), v.literal('failed')),
    aligner: v.optional(v.string()),
    alignerVersion: v.optional(v.string()),
    segmentCount: v.number(),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index('by_episodeId', ['episodeId'])
    .index('by_artifactId', ['artifactId'])
    .index('by_jobId', ['jobId'])
    .index('by_userId_and_status', ['userId', 'status']),

  audioOverviewAlignmentSegments: defineTable({
    alignmentId: v.id('audioOverviewAlignments'),
    episodeId: v.id('audioOverviewEpisodes'),
    utteranceId: v.id('audioOverviewUtterances'),
    sceneId: v.id('audioOverviewScenes'),
    jobId: v.id('audioOverviewJobs'),
    userId: v.string(),
    wordIndex: v.number(),
    word: v.string(),
    startMs: v.number(),
    endMs: v.number(),
    confidence: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_alignmentId_and_utteranceId_and_wordIndex', ['alignmentId', 'utteranceId', 'wordIndex'])
    .index('by_episodeId', ['episodeId'])
    .index('by_jobId', ['jobId'])
    .index('by_userId', ['userId']),

  audioOverviewJobTurns: defineTable({
    jobId: v.id('audioOverviewJobs'),
    taskId: v.id('tasks'),
    userId: v.string(),
    order: v.number(),
    speaker: v.union(v.literal('host_a'), v.literal('host_b')),
    text: v.string(),
    synthesisText: v.optional(v.string()),
    synthesisAttemptId: v.optional(v.string()),
    synthesisAttemptStartedAt: v.optional(v.number()),
    status: v.union(v.literal('pending'), v.literal('ready')),
    sourceIndex: v.optional(v.number()),
    audioFileId: v.optional(v.id('_storage')),
    uploadClaimId: v.optional(v.id('audioOverviewUploadClaims')),
    durationMs: v.optional(v.number()),
    wordTimings: v.optional(v.array(
      v.object({
        word: v.string(),
        start: v.number(),
        end: v.number(),
      }),
    )),
    updatedAt: v.number(),
  })
    .index('by_jobId_and_order', ['jobId', 'order'])
    .index('by_taskId', ['taskId'])
    .index('by_userId', ['userId']),

  audioOverviews: defineTable({
    userId: v.string(),
    folderId: v.id('folders'),
    roomId: v.optional(v.id('audioOverviewRooms')),
    taskId: v.optional(v.id('tasks')),
    episodeId: v.optional(v.id('audioOverviewEpisodes')),
    finalArtifactId: v.optional(v.id('audioOverviewAudioArtifacts')),
    title: v.string(),
    status: v.union(
      v.literal('generating'),
      v.literal('ready'),
      v.literal('failed'),
      v.literal('deleting'),
    ),
    failureReason: v.optional(v.string()),
    model: v.optional(v.string()),
    turns: v.array(
      v.object({
        speaker: v.union(v.literal('host_a'), v.literal('host_b')),
        text: v.string(),
        audioFileId: v.id('_storage'),
        durationMs: v.number(),
        sourceIndex: v.optional(v.number()),
        wordTimings: v.optional(v.array(
          v.object({
            word: v.string(),
            start: v.number(),
            end: v.number(),
          }),
        )),
      }),
    ),
    voiceProfile: v.object({
      hostA: v.string(),
      hostB: v.string(),
    }),
    hostNames: v.optional(v.object({
      hostA: v.string(),
      hostB: v.string(),
    })),
    preferences: v.optional(
      v.object({
        lengthMinutes: v.number(),
        complexity: v.union(v.literal('beginner'), v.literal('expert')),
      }),
    ),
    totalDurationMs: v.number(),
    sourceDocumentIds: v.optional(v.array(v.id('documents'))),
    shareToken: v.optional(v.string()),
    publishedAt: v.optional(v.number()),
    scopeDocIds: v.optional(v.array(v.id('documents'))),
    courseScoped: v.optional(v.boolean()),
  })
    .index('by_userId', ['userId'])
    .index('by_folderId', ['folderId'])
    .index('by_userId_and_folderId', ['userId', 'folderId'])
    .index('by_userId_and_roomId', ['userId', 'roomId'])
    .index('by_taskId', ['taskId'])
    .index('by_episodeId', ['episodeId'])
    .index('by_shareToken', ['shareToken']),

  audioOverviewUploadClaims: defineTable({
    userId: v.string(),
    taskId: v.optional(v.id('tasks')),
    nonce: v.string(),
    expectedSha256: v.optional(v.string()),
    expectedSize: v.optional(v.number()),
    begunAt: v.optional(v.number()),
    uploadAttempts: v.optional(v.number()),
    storageId: v.optional(v.id('_storage')),
    abortingStorageId: v.optional(v.id('_storage')),
    consumedAt: v.optional(v.number()),
    jobTurnId: v.optional(v.id('audioOverviewJobTurns')),
    expiresAt: v.number(),
  })
    .index('by_userId', ['userId'])
    .index('by_taskId', ['taskId'])
    .index('by_jobTurnId', ['jobTurnId'])
    .index('by_storageId', ['storageId'])
    .index('by_expiresAt', ['expiresAt']),

  audioOverviewInterjections: defineTable({
    audioOverviewId: v.id('audioOverviews'),
    userId: v.string(),
    insertedAfterTurnIndex: v.number(),
    question: v.string(),
    model: v.optional(v.string()),
    chatMessageId: v.optional(v.id('messages')),
    answerTurns: v.array(
      v.object({
        speaker: v.union(v.literal('host_a'), v.literal('host_b')),
        text: v.string(),
        audioFileId: v.id('_storage'),
        durationMs: v.number(),
        sourceIndex: v.optional(v.number()),
        wordTimings: v.optional(v.array(
          v.object({
            word: v.string(),
            start: v.number(),
            end: v.number(),
          }),
        )),
      }),
    ),
  })
    .index('by_audioOverview', ['audioOverviewId'])
    .index('by_userId', ['userId']),

  audioOverviewInterjectionsV2: defineTable({
    audioOverviewId: v.id('audioOverviews'),
    episodeId: v.id('audioOverviewEpisodes'),
    sourceManifestId: v.id('audioOverviewSourceManifests'),
    jobId: v.id('audioOverviewJobs'),
    userId: v.string(),
    idempotencyKey: v.string(),
    insertedAfterTurnIndex: v.number(),
    question: v.string(),
    model: v.string(),
    audioProfileId: v.string(),
    audioProfileVersion: v.string(),
    renderer: v.string(),
    hostAVoice: v.string(),
    hostBVoice: v.string(),
    status: v.union(
      v.literal('reserved'),
      v.literal('scripting'),
      v.literal('rendering'),
      v.literal('ready'),
      v.literal('failed'),
      v.literal('cancelled'),
      v.literal('deleting'),
    ),
    utteranceCount: v.number(),
    quotaDate: v.optional(v.string()),
    budgetReservedMicrousd: v.optional(v.number()),
    estimatedCostMicrousd: v.optional(v.number()),
    scriptingClaimedAt: v.optional(v.number()),
    renderAttemptedAt: v.optional(v.number()),
    artifactId: v.optional(v.id('audioOverviewAudioArtifacts')),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index('by_audioOverviewId_and_createdAt', ['audioOverviewId', 'createdAt'])
    .index('by_episodeId', ['episodeId'])
    .index('by_userId_and_audioOverviewId_and_idempotencyKey', ['userId', 'audioOverviewId', 'idempotencyKey'])
    .index('by_userId_and_quotaDate', ['userId', 'quotaDate'])
    .index('by_userId', ['userId']),

  audioOverviewInterjectionUtterances: defineTable({
    interjectionId: v.id('audioOverviewInterjectionsV2'),
    episodeId: v.id('audioOverviewEpisodes'),
    userId: v.string(),
    order: v.number(),
    speaker: v.union(v.literal('host_a'), v.literal('host_b')),
    text: v.string(),
    claimId: v.optional(v.string()),
    claimText: v.optional(v.string()),
    evidenceQuotes: v.optional(v.array(v.object({ sourceId: v.string(), quote: v.string() }))),
    verificationUtteranceId: v.optional(v.string()),
    verificationVersion: v.optional(v.literal('claim-entailment.v1')),
    verificationModel: v.optional(v.string()),
    entailmentDecision: v.optional(v.literal('entailed')),
    entailmentReason: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('by_interjectionId_and_order', ['interjectionId', 'order'])
    .index('by_episodeId', ['episodeId'])
    .index('by_userId', ['userId']),

  audioOverviewInterjectionSources: defineTable({
    interjectionId: v.id('audioOverviewInterjectionsV2'),
    utteranceId: v.id('audioOverviewInterjectionUtterances'),
    manifestEntryId: v.id('audioOverviewSourceManifestEntries'),
    episodeId: v.id('audioOverviewEpisodes'),
    userId: v.string(),
    createdAt: v.number(),
  })
    .index('by_interjectionId', ['interjectionId'])
    .index('by_utteranceId_and_manifestEntryId', ['utteranceId', 'manifestEntryId'])
    .index('by_episodeId', ['episodeId'])
    .index('by_userId', ['userId']),

  courses: defineTable({
    userId: v.string(),
    folderId: v.id('folders'),
    title: v.string(),
    status: v.union(v.literal('generating'), v.literal('ready'), v.literal('failed'), v.literal('deleting')),
    sourceType: v.union(v.literal('folder'), v.literal('web-only')),
    sourceConfidence: v.object({
      docCount: v.number(),
      webPercent: v.number(),
    }),
    pace: v.union(v.literal('intensive'), v.literal('steady'), v.literal('relaxed')),
    outlineSections: v.array(v.object({
      title: v.string(),
      description: v.string(),
      knowledgeType: v.string(),
      order: v.number(),
    })),
    completedSectionCount: v.number(),
    totalSectionCount: v.number(),
    taskId: v.optional(v.id('tasks')),
    webSearchEnabled: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_userId', ['userId'])
    .index('by_userId_and_folderId', ['userId', 'folderId'])
    .index('by_folderId', ['folderId']),

  courseSections: defineTable({
    courseId: v.id('courses'),
    userId: v.string(),
    order: v.number(),
    title: v.string(),
    knowledgeType: v.union(
      v.literal('factual'),
      v.literal('conceptual'),
      v.literal('procedural'),
      v.literal('mixed'),
    ),
    status: v.union(
      v.literal('locked'),
      v.literal('generating'),
      v.literal('ready'),
      v.literal('completed'),
      v.literal('failed'),
    ),
    contentBlocks: v.array(v.object({
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
    })),
    failureNotice: v.optional(v.string()),
    practiceScore: v.optional(v.number()),
    masteryLevel: v.union(
      v.literal('new'),
      v.literal('learning'),
      v.literal('reviewing'),
      v.literal('mastered'),
    ),
    consecutiveReviewPasses: v.optional(v.number()),
    reviewHistory: v.optional(v.array(v.object({
      score: v.number(),
      quizCorrect: v.number(),
      quizTotal: v.number(),
      at: v.number(),
    }))),
    completedAt: v.optional(v.number()),
    offlineAvailable: v.optional(v.boolean()),
    taskId: v.optional(v.id('tasks')),
  })
    .index('by_courseId', ['courseId'])
    .index('by_courseId_and_order', ['courseId', 'order'])
    .index('by_userId', ['userId']),

  courseSourceDocs: defineTable({
    courseId: v.id('courses'),
    documentId: v.optional(v.id('documents')),
    folderId: v.optional(v.id('folders')),
    userId: v.string(),
  })
    .index('by_courseId', ['courseId'])
    .index('by_userId', ['userId']),

  reviewItems: defineTable({
    userId: v.string(),
    courseId: v.id('courses'),
    sectionId: v.id('courseSections'),
    flashcardRoomCardId: v.optional(v.id('flashcardRoomCards')),
    prompt: v.string(),
    answer: v.string(),
    easeFactor: v.number(),
    interval: v.number(),
    repetitions: v.number(),
    nextReviewDate: v.string(),
    lastReviewQuality: v.optional(v.number()),
    lastReviewedAt: v.optional(v.number()),
    lastReviewIdempotencyKey: v.optional(v.string()),
    flagged: v.boolean(),
    correctedAnswer: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('by_userId', ['userId'])
    .index('by_userId_and_nextReviewDate', ['userId', 'nextReviewDate'])
    .index('by_courseId', ['courseId'])
    .index('by_sectionId', ['sectionId'])
    .index('by_flashcardRoomCardId', ['flashcardRoomCardId']),

  learnProfile: defineTable({
    userId: v.string(),
    streakCurrent: v.number(),
    streakLastDate: v.optional(v.string()),
    streakFreezeAvailable: v.boolean(),
    streakFreezeUsedAt: v.optional(v.string()),
    dailyReviewCap: v.number(),
    timezone: v.optional(v.string()),
  })
    .index('by_userId', ['userId']),

  reviewSessions: defineTable({
    userId: v.string(),
    date: v.string(),
    itemsReviewed: v.number(),
    itemsCorrect: v.number(),
    durationMs: v.number(),
    mode: v.optional(v.union(v.literal('full'), v.literal('quick'))),
    idempotencyKey: v.optional(v.string()),
    completedAt: v.number(),
  })
    .index('by_userId', ['userId'])
    .index('by_userId_and_date', ['userId', 'date'])
    .index('by_userId_and_idempotencyKey', ['userId', 'idempotencyKey']),

  calendarConnections: defineTable({
    userId: v.string(),
    provider: v.literal('google'),
    accessToken: v.string(),
    refreshToken: v.string(),
    expiresAt: v.number(),
    timezone: v.string(),
    status: v.union(v.literal('connected'), v.literal('disconnecting'), v.literal('disconnected')),
    connectedAt: v.number(),
    disconnectLeaseToken: v.optional(v.string()),
    disconnectLeaseExpiresAt: v.optional(v.number()),
    disconnectAttempts: v.optional(v.number()),
    disconnectDeletedCount: v.optional(v.number()),
    disconnectLastError: v.optional(v.string()),
    disconnectUpdatedAt: v.optional(v.number()),
    calendarSlotWatermark: v.optional(v.number()),
    preferences: v.optional(v.object({
      morningStart: v.string(),
      eveningEnd: v.string(),
      sessionMinutes: v.number(),
      preferredDays: v.array(v.string()),
    })),
  })
    .index('by_userId', ['userId']),

  calendarEvents: defineTable({
    userId: v.string(),
    calendarConnectionId: v.id('calendarConnections'),
    calendarEventId: v.string(),
    courseId: v.id('courses'),
    scheduledAt: v.number(),
    sessionType: v.union(v.literal('new-content'), v.literal('review'), v.literal('audio-only')),
    status: v.union(v.literal('scheduled'), v.literal('completed'), v.literal('missed'), v.literal('rescheduled')),
    description: v.optional(v.string()),
  })
    .index('by_userId', ['userId'])
    .index('by_courseId', ['courseId'])
    .index('by_userId_and_status', ['userId', 'status'])
    .index('by_userId_and_status_and_scheduledAt', ['userId', 'status', 'scheduledAt'])
    .index('by_calendarConnectionId_and_calendarEventId', ['calendarConnectionId', 'calendarEventId']),

  calendarEventCleanupJobs: defineTable({
    userId: v.string(),
    calendarConnectionId: v.id('calendarConnections'),
    calendarEventId: v.string(),
    courseId: v.id('courses'),
    reason: v.union(v.literal('sync-create'), v.literal('missed-reschedule')),
    operationKey: v.optional(v.string()),
    status: v.union(
      v.literal('pending'),
      v.literal('deleting'),
      v.literal('managed'),
      v.literal('resolved'),
      v.literal('dead_letter'),
    ),
    attempts: v.number(),
    nextAttemptAt: v.number(),
    leaseExpiresAt: v.optional(v.number()),
    lastAttemptAt: v.optional(v.number()),
    lastHttpStatus: v.optional(v.number()),
    lastError: v.optional(v.string()),
    resolution: v.optional(v.union(v.literal('deleted'), v.literal('already_absent'))),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index('by_userId', ['userId'])
    .index('by_status_and_nextAttemptAt', ['status', 'nextAttemptAt'])
    .index('by_status_and_leaseExpiresAt', ['status', 'leaseExpiresAt'])
    .index('by_calendarConnectionId_and_status', ['calendarConnectionId', 'status'])
    .index('by_calendarConnectionId_and_calendarEventId', ['calendarConnectionId', 'calendarEventId'])
    .index('by_calendarConnectionId_and_operationKey', ['calendarConnectionId', 'operationKey'])
    .index('by_calendarConnectionId_and_courseId_and_reason', ['calendarConnectionId', 'courseId', 'reason'])
    .index('by_courseId_and_status', ['courseId', 'status'])
    .index('by_status_and_completedAt', ['status', 'completedAt']),

  courseDeletionJobs: defineTable({
    userId: v.string(),
    courseId: v.id('courses'),
    status: v.literal('active'),
    phase: v.union(
      v.literal('settleCalendarCleanup'),
      v.literal('providerEvents'),
      v.literal('calendarCleanupJobs'),
      v.literal('sections'),
      v.literal('courseSourceDocs'),
      v.literal('reviewItems'),
      v.literal('finalize'),
    ),
    attempts: v.number(),
    nextAttemptAt: v.number(),
    leaseToken: v.optional(v.string()),
    leaseExpiresAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_courseId', ['courseId'])
    .index('by_userId', ['userId'])
    .index('by_status_and_updatedAt', ['status', 'updatedAt']),

  rateLimitBuckets: defineTable({
    key: v.string(),
    userId: v.string(),
    route: v.string(),
    count: v.number(),
    windowStartedAt: v.number(),
    expiresAt: v.number(),
  })
    .index('by_key', ['key'])
    .index('by_userId', ['userId'])
    .index('by_expiresAt', ['expiresAt']),

  pendingCleanup: defineTable({
    userId: v.string(),
    documentId: v.string(),
    r2Key: v.optional(v.string()),
    audioArtifactId: v.optional(v.id('audioOverviewAudioArtifacts')),
    fileId: v.optional(v.id('_storage')),
    kind: v.union(v.literal('ai-search'), v.literal('r2'), v.literal('convex-storage')),
    attempts: v.number(),
    lastAttemptAt: v.optional(v.number()),
    nextAttemptAt: v.optional(v.number()),
    scanPage: v.optional(v.number()),
    lastError: v.optional(v.string()),
  })
    .index('by_userId', ['userId'])
    .index('by_userId_and_lastAttemptAt', ['userId', 'lastAttemptAt'])
    .index('by_userId_and_attempts_and_nextAttemptAt', ['userId', 'attempts', 'nextAttemptAt'])
    .index('by_audioArtifactId', ['audioArtifactId'])
    .index('by_fileId', ['fileId'])
    .index('by_r2Key', ['r2Key'])
    .index('by_lastAttemptAt', ['lastAttemptAt'])
    .index('by_kind_and_attempts', ['kind', 'attempts'])
    .index('by_kind_and_attempts_and_nextAttemptAt', ['kind', 'attempts', 'nextAttemptAt']),

  // Learn Anything V2 is deliberately additive. These records do not share
  // mutable V1 course/session shapes and are unreachable until the V2 gate.
  learningVoids: defineTable({ userId: v.string(), folderId: v.id('folders'), title: v.string(), status: v.union(v.literal('draft'), v.literal('sourcing'), v.literal('source_review'), v.literal('map_review'), v.literal('calibration'), v.literal('plan_review'), v.literal('scheduled'), v.literal('active'), v.literal('completed'), v.literal('paused'), v.literal('needs_attention'), v.literal('failed'), v.literal('archived')), revision: v.number(), activeBlueprintRevisionId: v.optional(v.id('learnBlueprintRevisions')), lastIdempotencyKey: v.optional(v.string()), createdAt: v.number(), updatedAt: v.number() }).index('by_userId', ['userId']).index('by_userId_and_folderId', ['userId', 'folderId']).index('by_userId_and_status', ['userId', 'status']),
  learnBlueprints: defineTable({ userId: v.string(), learningVoidId: v.id('learningVoids'), revision: v.number(), createdAt: v.number() }).index('by_userId', ['userId']).index('by_userId_and_learningVoidId', ['userId', 'learningVoidId']),
  learnBlueprintRevisions: defineTable({ userId: v.string(), blueprintId: v.id('learnBlueprints'), learningVoidId: v.id('learningVoids'), revision: v.number(), recordRevision: v.number(), status: v.union(v.literal('draft'), v.literal('source_review'), v.literal('map_review'), v.literal('accepted'), v.literal('active'), v.literal('superseded')), intentVersion: v.optional(v.literal('learn-v2.blueprint-intent.v1')), desiredOutcome: v.optional(v.string()), mode: v.optional(v.union(v.literal('understand'), v.literal('prepare'), v.literal('apply'))), desiredDepth: v.optional(v.union(v.literal('overview'), v.literal('working'), v.literal('deep'))), sourcePolicy: v.optional(v.union(v.literal('folder_only'), v.literal('folder_plus_web'), v.literal('web_only'))), generationInputDigest: v.optional(v.string()), generationSupportingSourceSnapshotIds: v.optional(v.array(v.id('learnSourceSnapshots'))), generatorVersion: v.optional(v.string()), generationProvider: v.optional(v.literal('openrouter_via_cloudflare_ai_gateway')), generationModel: v.optional(v.string()), generationRequestId: v.optional(v.string()), generatedAt: v.optional(v.number()), acceptedAt: v.optional(v.number()), createdAt: v.number(), updatedAt: v.number() }).index('by_userId', ['userId']).index('by_userId_and_blueprintId_and_revision', ['userId', 'blueprintId', 'revision']).index('by_userId_and_learningVoidId', ['userId', 'learningVoidId']).index('by_userId_and_learningVoidId_and_status', ['userId', 'learningVoidId', 'status']),
  learnMilestones: defineTable({ userId: v.string(), blueprintRevisionId: v.id('learnBlueprintRevisions'), order: v.number(), title: v.string(), description: v.optional(v.string()) }).index('by_userId', ['userId']).index('by_userId_and_blueprintRevisionId_and_order', ['userId', 'blueprintRevisionId', 'order']),
  learnObjectives: defineTable({ userId: v.string(), blueprintRevisionId: v.id('learnBlueprintRevisions'), milestoneId: v.optional(v.id('learnMilestones')), order: v.number(), title: v.string(), capability: v.optional(v.string()), estimatedMinutes: v.optional(v.number()), coverage: v.optional(v.union(v.literal('strong'), v.literal('partial'), v.literal('gap'))), gapReason: v.optional(v.string()), assessmentContract: v.optional(v.union(v.string(), v.object({ version: v.literal('learn-v2.assessment.v1'), kind: v.union(v.literal('machine_checkable'), v.literal('bounded_rubric')), responseFormat: v.union(v.literal('short_text'), v.literal('structured')), instructions: v.string(), passingScorePercent: v.literal(80), criteria: v.array(v.object({ key: v.string(), description: v.string(), weightPercent: v.number() })) }))) }).index('by_userId', ['userId']).index('by_userId_and_blueprintRevisionId_and_order', ['userId', 'blueprintRevisionId', 'order']).index('by_userId_and_milestoneId_and_order', ['userId', 'milestoneId', 'order']),
  learnObjectivePrerequisites: defineTable({ userId: v.string(), blueprintRevisionId: v.id('learnBlueprintRevisions'), objectiveId: v.id('learnObjectives'), prerequisiteObjectiveId: v.id('learnObjectives') }).index('by_userId', ['userId']).index('by_userId_and_blueprintRevisionId_and_objectiveId', ['userId', 'blueprintRevisionId', 'objectiveId']).index('by_userId_and_prerequisiteObjectiveId', ['userId', 'prerequisiteObjectiveId']),
  learnSourceIdentities: defineTable({ userId: v.string(), learningVoidId: v.id('learningVoids'), origin: v.union(v.literal('folder_document'), v.literal('user_url'), v.literal('open_database'), v.literal('general_web_search')), externalKey: v.string(), canonicalUrl: v.optional(v.string()), publicLocator: v.optional(v.string()), privateLocator: v.optional(v.string()), folderDocumentId: v.optional(v.id('documents')), title: v.optional(v.string()), tombstonedAt: v.optional(v.number()) }).index('by_userId', ['userId']).index('by_userId_and_learningVoidId', ['userId', 'learningVoidId']).index('by_userId_and_origin_and_externalKey', ['userId', 'origin', 'externalKey']).index('by_userId_and_learningVoidId_and_origin_and_externalKey', ['userId', 'learningVoidId', 'origin', 'externalKey']).index('by_userId_and_folderDocumentId', ['userId', 'folderDocumentId']).index('by_userId_and_learningVoidId_and_folderDocumentId', ['userId', 'learningVoidId', 'folderDocumentId']),
  learnSourceSnapshots: defineTable({ userId: v.string(), sourceIdentityId: v.id('learnSourceIdentities'), learningVoidId: v.id('learningVoids'), blueprintRevisionId: v.optional(v.id('learnBlueprintRevisions')), folderManifestId: v.optional(v.id('learnFolderSourceManifests')), revision: v.number(), recordRevision: v.optional(v.number()), status: v.union(v.literal('candidate'), v.literal('fetched'), v.literal('evaluated'), v.literal('user_accepted'), v.literal('rejected'), v.literal('unavailable')), effectiveStatus: v.optional(v.union(v.literal('candidate'), v.literal('fetched'), v.literal('evaluated'), v.literal('user_accepted'), v.literal('rejected'), v.literal('unavailable'))), contentHash: v.optional(v.string()), sourceRevision: v.optional(v.string()), objectKey: v.optional(v.string()), folderId: v.optional(v.id('folders')), folderRevision: v.optional(v.string()), filename: v.optional(v.string()), publicLocator: v.optional(v.string()), privateLocator: v.optional(v.string()), contentType: v.optional(v.union(v.literal('text/html'), v.literal('text/plain'), v.literal('application/pdf'))), wireBytes: v.optional(v.number()), decodedBytes: v.optional(v.number()), rightsStatus: v.optional(v.union(v.literal('permitted'), v.literal('unknown'), v.literal('prohibited'))), rightsProvenance: v.optional(v.union(v.literal('noarchive'), v.literal('link_license'), v.literal('html_license'), v.literal('none'))), rightsPolicyVersion: v.optional(v.string()), fetchPolicyVersion: v.optional(v.string()), conflictStatus: v.optional(v.union(v.literal('clear'), v.literal('unresolved'))), trustClassification: v.optional(v.literal('untrusted_source_data')), unavailableReason: v.optional(v.string()), fetchedAt: v.optional(v.number()), evaluatedAt: v.optional(v.number()), acceptedAt: v.optional(v.number()), rejectedAt: v.optional(v.number()), evidencePurgedAt: v.optional(v.number()), createdAt: v.number(), updatedAt: v.optional(v.number()) }).index('by_userId', ['userId']).index('by_userId_and_sourceIdentityId_and_revision', ['userId', 'sourceIdentityId', 'revision']).index('by_userId_and_sourceIdentityId_and_evidencePurgedAt', ['userId', 'sourceIdentityId', 'evidencePurgedAt']).index('by_userId_and_learningVoidId_and_status', ['userId', 'learningVoidId', 'status']).index('by_userId_and_learningVoidId_and_effectiveStatus', ['userId', 'learningVoidId', 'effectiveStatus']).index('by_userId_and_learningVoidId_and_effectiveStatus_and_evidencePurgedAt', ['userId', 'learningVoidId', 'effectiveStatus', 'evidencePurgedAt']).index('by_userId_and_learningVoidId_and_effectiveStatus_and_status_and_evidencePurgedAt', ['userId', 'learningVoidId', 'effectiveStatus', 'status', 'evidencePurgedAt']).index('by_userId_and_blueprintRevisionId', ['userId', 'blueprintRevisionId']).index('by_userId_and_blueprintRevisionId_and_status', ['userId', 'blueprintRevisionId', 'status']).index('by_userId_and_blueprintRevisionId_and_effectiveStatus', ['userId', 'blueprintRevisionId', 'effectiveStatus']).index('by_userId_and_blueprintRevisionId_and_effectiveStatus_and_status', ['userId', 'blueprintRevisionId', 'effectiveStatus', 'status']).index('by_userId_and_folderManifestId', ['userId', 'folderManifestId']),
  learnSourceExcerpts: defineTable({ userId: v.string(), sourceSnapshotId: v.id('learnSourceSnapshots'), locator: v.string(), privateLocator: v.optional(v.string()), excerpt: v.optional(v.string()), rightsStatus: v.union(v.literal('permitted'), v.literal('unknown'), v.literal('prohibited')), trustClassification: v.optional(v.literal('untrusted_source_data')), evidencePurgedAt: v.optional(v.number()) }).index('by_userId', ['userId']).index('by_userId_and_sourceSnapshotId', ['userId', 'sourceSnapshotId']).index('by_userId_and_sourceSnapshotId_and_evidencePurgedAt', ['userId', 'sourceSnapshotId', 'evidencePurgedAt']),
  learnSourceFetchLeases: defineTable({ userId: v.string(), learningVoidId: v.id('learningVoids'), sourceSnapshotId: v.id('learnSourceSnapshots'), idempotencyKeyHash: v.string(), requestFingerprint: v.string(), leaseToken: v.string(), expiresAt: v.number(), createdAt: v.number() }).index('by_userId', ['userId']).index('by_userId_and_learningVoidId', ['userId', 'learningVoidId']).index('by_userId_and_expiresAt', ['userId', 'expiresAt']).index('by_expiresAt', ['expiresAt']).index('by_userId_and_sourceSnapshotId_and_expiresAt', ['userId', 'sourceSnapshotId', 'expiresAt']).index('by_userId_and_idempotencyKeyHash', ['userId', 'idempotencyKeyHash']),
  learnSourceFetchRateEvents: defineTable({ userId: v.string(), learningVoidId: v.id('learningVoids'), sourceSnapshotId: v.id('learnSourceSnapshots'), createdAt: v.number(), expiresAt: v.number() }).index('by_userId', ['userId']).index('by_userId_and_learningVoidId', ['userId', 'learningVoidId']).index('by_userId_and_sourceSnapshotId', ['userId', 'sourceSnapshotId']).index('by_userId_and_createdAt', ['userId', 'createdAt']).index('by_userId_and_expiresAt', ['userId', 'expiresAt']).index('by_expiresAt', ['expiresAt']),
  learnSourceCommandReceipts: defineTable({ userId: v.string(), learningVoidId: v.id('learningVoids'), sourceSnapshotId: v.id('learnSourceSnapshots'), idempotencyKeyHash: v.string(), command: v.string(), requestFingerprint: v.string(), response: v.string(), createdAt: v.number() }).index('by_userId', ['userId']).index('by_userId_and_idempotencyKeyHash', ['userId', 'idempotencyKeyHash']).index('by_userId_and_sourceSnapshotId', ['userId', 'sourceSnapshotId']).index('by_userId_and_learningVoidId', ['userId', 'learningVoidId']),
  learnObjectiveSources: defineTable({ userId: v.string(), objectiveId: v.id('learnObjectives'), sourceSnapshotId: v.id('learnSourceSnapshots'), coverage: v.union(v.literal('strong'), v.literal('partial'), v.literal('gap')) }).index('by_userId', ['userId']).index('by_userId_and_objectiveId_and_sourceSnapshotId', ['userId', 'objectiveId', 'sourceSnapshotId']).index('by_userId_and_sourceSnapshotId', ['userId', 'sourceSnapshotId']),
  learnClaimSupports: defineTable({ userId: v.string(), sessionContentClaimId: v.id('sessionContentClaims'), sourceExcerptId: v.id('learnSourceExcerpts'), sourceSnapshotId: v.optional(v.id('learnSourceSnapshots')), entailment: v.union(v.literal('entailed'), v.literal('not_entailed'), v.literal('not_evaluated')), verifierVersion: v.optional(v.string()), confidence: v.optional(v.number()), conflictStatus: v.union(v.literal('clear'), v.literal('unresolved')), evidenceStatus: v.optional(v.union(v.literal('evidence_available'), v.literal('evidence_unavailable'))) }).index('by_userId', ['userId']).index('by_userId_and_sessionContentClaimId', ['userId', 'sessionContentClaimId']).index('by_userId_and_sourceExcerptId', ['userId', 'sourceExcerptId']).index('by_userId_and_sourceExcerptId_and_evidenceStatus', ['userId', 'sourceExcerptId', 'evidenceStatus']),
  masteryAttempts: defineTable({ userId: v.string(), blueprintRevisionId: v.optional(v.id('learnBlueprintRevisions')), objectiveId: v.id('learnObjectives'), studySessionId: v.optional(v.id('studySessions')), sessionContentId: v.optional(v.id('sessionContent')), studyPlanRevisionId: v.optional(v.id('studyPlanRevisions')), kind: v.optional(v.union(v.literal('calibration'), v.literal('independent_application'), v.literal('retained_transfer'))), attemptedAt: v.number(), attemptLocalDate: v.optional(v.string()), attemptTimezone: v.optional(v.string()), idempotencyKey: v.string(), requestFingerprint: v.optional(v.string()), serverScorePercent: v.optional(v.number()), response: v.optional(v.string()), criterionResultsJson: v.optional(v.string()), misconceptionTagsJson: v.optional(v.string()), usedHint: v.optional(v.boolean()), usedReveal: v.optional(v.boolean()), confidence: v.optional(v.number()), rubricVersion: v.optional(v.string()), rubricSnapshot: v.optional(v.string()), scorerVersion: v.optional(v.string()), verifierVersionsJson: v.optional(v.string()), sourceSnapshotIdsJson: v.optional(v.string()), sessionRevision: v.optional(v.number()), contentRevision: v.optional(v.number()), planRevision: v.optional(v.number()), planRecordRevision: v.optional(v.number()), blueprintRecordRevision: v.optional(v.number()), result: v.optional(v.string()) }).index('by_userId', ['userId']).index('by_userId_and_blueprintRevisionId', ['userId', 'blueprintRevisionId']).index('by_userId_and_blueprintRevisionId_and_kind', ['userId', 'blueprintRevisionId', 'kind']).index('by_userId_and_objectiveId_and_attemptedAt', ['userId', 'objectiveId', 'attemptedAt']).index('by_userId_and_idempotencyKey', ['userId', 'idempotencyKey']),
  masteryRecords: defineTable({ userId: v.string(), blueprintRevisionId: v.optional(v.id('learnBlueprintRevisions')), objectiveId: v.id('learnObjectives'), state: v.union(v.literal('unseen'), v.literal('learning'), v.literal('guided'), v.literal('independent'), v.literal('retained'), v.literal('needs_review'), v.literal('blocked'), v.literal('provisionally_known')), schedulingPriority: v.optional(v.union(v.literal('remediation'), v.literal('standard'), v.literal('deprioritized'))), recordRevision: v.optional(v.number()), firstIndependentPassAt: v.optional(v.number()), firstIndependentLocalDate: v.optional(v.string()), firstIndependentTimezone: v.optional(v.string()), lastAttemptAt: v.optional(v.number()), lastAttemptId: v.optional(v.id('masteryAttempts')), remediationAttemptId: v.optional(v.id('masteryAttempts')), nextReviewAt: v.optional(v.number()), updatedAt: v.optional(v.number()) }).index('by_userId', ['userId']).index('by_userId_and_blueprintRevisionId', ['userId', 'blueprintRevisionId']).index('by_userId_and_objectiveId', ['userId', 'objectiveId']).index('by_userId_and_nextReviewAt', ['userId', 'nextReviewAt']),
  studyPlans: defineTable({ userId: v.string(), learningVoidId: v.id('learningVoids'), revision: v.number(), activeRevisionId: v.optional(v.id('studyPlanRevisions')), createdAt: v.number(), updatedAt: v.optional(v.number()) }).index('by_userId', ['userId']).index('by_userId_and_learningVoidId', ['userId', 'learningVoidId']),
  studyPlanRevisions: defineTable({ userId: v.string(), studyPlanId: v.id('studyPlans'), learningVoidId: v.id('learningVoids'), revision: v.number(), recordRevision: v.optional(v.number()), status: v.union(v.literal('draft'), v.literal('accepted'), v.literal('active'), v.literal('superseded')), parentRevisionId: v.optional(v.id('studyPlanRevisions')), changeReason: v.optional(v.union(v.literal('availability_changed'), v.literal('deadline_changed'), v.literal('session_length_changed'), v.literal('future_incomplete_reflow'))), blueprintRevisionId: v.optional(v.id('learnBlueprintRevisions')), blueprintRecordRevision: v.optional(v.number()), schedulerVersion: v.optional(v.string()), timezone: v.optional(v.string()), inputSnapshot: v.optional(v.string()), resultSnapshot: v.optional(v.string()), feasibility: v.optional(v.union(v.literal('feasible'), v.literal('infeasible'))), createdAt: v.number(), acceptedAt: v.optional(v.number()), updatedAt: v.optional(v.number()) }).index('by_userId', ['userId']).index('by_userId_and_studyPlanId_and_revision', ['userId', 'studyPlanId', 'revision']).index('by_userId_and_studyPlanId_and_feasibility_and_revision', ['userId', 'studyPlanId', 'feasibility', 'revision']).index('by_userId_and_learningVoidId_and_status', ['userId', 'learningVoidId', 'status']),
  studySessions: defineTable({ userId: v.string(), studyPlanRevisionId: v.id('studyPlanRevisions'), primaryObjectiveId: v.id('learnObjectives'), placementId: v.optional(v.string()), status: v.union(v.literal('planned'), v.literal('ready'), v.literal('in_progress'), v.literal('completed'), v.literal('missed'), v.literal('cancelled'), v.literal('blocked'), v.literal('generation_failed'), v.literal('needs_reschedule')), revision: v.number(), scheduledStartAt: v.number(), scheduledEndAt: v.optional(v.number()), timezone: v.optional(v.string()), offsetMinutes: v.optional(v.number()), placementKind: v.optional(v.union(v.literal('learning'), v.literal('review'), v.literal('retained_review'))), schedulingPriority: v.optional(v.string()), schedulerVersion: v.optional(v.string()), startedSessionContentId: v.optional(v.id('sessionContent')), startedSessionContentRevision: v.optional(v.number()), substantiveHintUsedAt: v.optional(v.number()), answerRevealedAt: v.optional(v.number()), assistanceRevision: v.optional(v.number()), missedAt: v.optional(v.number()), auditReasonCode: v.optional(v.string()) }).index('by_userId', ['userId']).index('by_userId_and_studyPlanRevisionId_and_scheduledStartAt', ['userId', 'studyPlanRevisionId', 'scheduledStartAt']).index('by_userId_and_status_and_scheduledStartAt', ['userId', 'status', 'scheduledStartAt']),
  learnPlanCommandReceipts: defineTable({ userId: v.string(), learningVoidId: v.id('learningVoids'), idempotencyKey: v.string(), command: v.string(), requestFingerprint: v.string(), response: v.string(), createdAt: v.number() }).index('by_userId', ['userId']).index('by_userId_and_idempotencyKey', ['userId', 'idempotencyKey']).index('by_userId_and_learningVoidId', ['userId', 'learningVoidId']),
  learnPlanAuditEvents: defineTable({ userId: v.string(), learningVoidId: v.id('learningVoids'), studyPlanRevisionId: v.optional(v.id('studyPlanRevisions')), studySessionId: v.optional(v.id('studySessions')), reasonCode: v.string(), details: v.string(), createdAt: v.number() }).index('by_userId', ['userId']).index('by_userId_and_learningVoidId', ['userId', 'learningVoidId']).index('by_userId_and_studyPlanRevisionId', ['userId', 'studyPlanRevisionId']),
  studySessionRetrievalObjectives: defineTable({ userId: v.string(), studySessionId: v.id('studySessions'), objectiveId: v.id('learnObjectives'), order: v.number() }).index('by_userId', ['userId']).index('by_userId_and_studySessionId_and_order', ['userId', 'studySessionId', 'order']),
  sessionContent: defineTable({ userId: v.string(), studySessionId: v.id('studySessions'), studyPlanRevisionId: v.optional(v.id('studyPlanRevisions')), blueprintRevisionId: v.optional(v.id('learnBlueprintRevisions')), objectiveId: v.optional(v.id('learnObjectives')), revision: v.number(), status: v.union(v.literal('draft'), v.literal('ready'), v.literal('published'), v.literal('superseded')), inputDigest: v.optional(v.string()), candidateDigest: v.optional(v.string()), providerModel: v.optional(v.string()), providerRequestId: v.optional(v.string()), assessmentRubricSnapshot: v.optional(v.string()), generatorVersion: v.optional(v.string()), createdAt: v.number(), publishedAt: v.optional(v.number()) }).index('by_userId', ['userId']).index('by_userId_and_studySessionId_and_revision', ['userId', 'studySessionId', 'revision']).index('by_userId_and_status', ['userId', 'status']),
  sessionContentBlocks: defineTable({ userId: v.string(), sessionContentId: v.id('sessionContent'), order: v.number(), kind: v.string(), content: v.optional(v.string()), claimOrdersJson: v.optional(v.string()) }).index('by_userId', ['userId']).index('by_userId_and_sessionContentId_and_order', ['userId', 'sessionContentId', 'order']),
  sessionContentClaims: defineTable({ userId: v.string(), sessionContentId: v.id('sessionContent'), order: v.number(), claim: v.string(), verifierVersion: v.optional(v.string()), confidence: v.optional(v.number()) }).index('by_userId', ['userId']).index('by_userId_and_sessionContentId_and_order', ['userId', 'sessionContentId', 'order']),
  // Inert until LA2-15 adds its first provider writer and provider-first cleanup atomically.
  calendarProjections: defineTable({ userId: v.string(), studySessionId: v.id('studySessions'), status: v.literal('pending_projection'), provider: v.optional(v.string()), externalEventId: v.optional(v.string()) }).index('by_userId', ['userId']).index('by_userId_and_studySessionId', ['userId', 'studySessionId']).index('by_userId_and_provider_and_externalEventId', ['userId', 'provider', 'externalEventId']),
  reminderPolicies: defineTable({ userId: v.string(), learningVoidId: v.id('learningVoids'), timezone: v.string(), channel: v.string() }).index('by_userId', ['userId']).index('by_userId_and_learningVoidId', ['userId', 'learningVoidId']),
  searchQuotaBuckets: defineTable({
    userId: v.string(),
    learningVoidId: v.optional(v.id('learningVoids')),
    provider: v.literal('tavily_free'),
    scopeKind: v.union(v.literal('product_month'), v.literal('product_day'), v.literal('user_day'), v.literal('learning_void_broad')),
    scopeKey: v.string(),
    periodKey: v.string(),
    limit: v.number(),
    providerUsageBaseline: v.optional(v.number()),
    reservedCredits: v.number(),
    consumedCredits: v.number(),
    revision: v.number(),
    reconciliationStatus: v.union(v.literal('matched'), v.literal('review_required')),
    circuitReason: v.optional(v.union(v.literal('usage_policy'), v.literal('usage_drift'), v.literal('dispatch_uncertain'))),
    circuitReservationId: v.optional(v.id('searchReservations')),
    providerReportedUsage: v.optional(v.number()),
    providerReportedUsageObservedAt: v.optional(v.number()),
    lastReconciledAt: v.optional(v.number()),
    activeDispatchReservationId: v.optional(v.id('searchReservations')),
    activeDispatchLeaseExpiresAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_userId', ['userId'])
    .index('by_provider_and_scopeKind_and_scopeKey_and_periodKey', ['provider', 'scopeKind', 'scopeKey', 'periodKey'])
    .index('by_userId_and_provider_and_periodKey', ['userId', 'provider', 'periodKey'])
    .index('by_userId_and_learningVoidId_and_periodKey', ['userId', 'learningVoidId', 'periodKey'])
    .index('by_provider_and_reconciliationStatus_and_periodKey', ['provider', 'reconciliationStatus', 'periodKey']),
  searchReservations: defineTable({
    userId: v.string(),
    learningVoidId: v.optional(v.id('learningVoids')),
    blueprintRevisionId: v.optional(v.id('learnBlueprintRevisions')),
    expectedVoidRevision: v.number(),
    expectedBlueprintRecordRevision: v.number(),
    voidScopeKey: v.string(),
    provider: v.literal('tavily_free'),
    searchClass: v.literal('broad'),
    status: v.union(v.literal('reserved'), v.literal('consumed'), v.literal('released')),
    dispatchState: v.union(v.literal('not_started'), v.literal('started')),
    reconciliationRequired: v.boolean(),
    productMonthBucketId: v.id('searchQuotaBuckets'),
    productDayBucketId: v.id('searchQuotaBuckets'),
    userDayBucketId: v.id('searchQuotaBuckets'),
    learningVoidBucketId: v.id('searchQuotaBuckets'),
    productMonthPeriodKey: v.string(),
    productDayPeriodKey: v.string(),
    userDayPeriodKey: v.string(),
    learningVoidPeriodKey: v.literal('lifetime'),
    expectedCredits: v.literal(1),
    idempotencyKeyHash: v.optional(v.string()),
    requestFingerprint: v.optional(v.string()),
    queryDigest: v.optional(v.string()),
    executionTokenHash: v.string(),
    revision: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
    expiresAt: v.number(),
    dispatchedAt: v.optional(v.number()),
    settledAt: v.optional(v.number()),
    outcomeCode: v.optional(v.string()),
    providerRequestIdHash: v.optional(v.string()),
    reconciliationKeyHash: v.optional(v.string()),
    reconciliationRequestFingerprint: v.optional(v.string()),
    providerUsageBeforeDispatch: v.optional(v.number()),
    ownerDeletedAt: v.optional(v.number()),
  }).index('by_userId', ['userId'])
    .index('by_userId_and_idempotencyKeyHash', ['userId', 'idempotencyKeyHash'])
    .index('by_userId_and_learningVoidId', ['userId', 'learningVoidId'])
    .index('by_userId_and_status_and_dispatchState', ['userId', 'status', 'dispatchState'])
    .index('by_provider_and_status_and_dispatchState_and_expiresAt', ['provider', 'status', 'dispatchState', 'expiresAt'])
    .index('by_provider_and_reconciliationRequired_and_updatedAt', ['provider', 'reconciliationRequired', 'updatedAt']),
  learnJobs: defineTable({ userId: v.string(), learningVoidId: v.id('learningVoids'), blueprintRevisionId: v.optional(v.id('learnBlueprintRevisions')), studyPlanRevisionId: v.optional(v.id('studyPlanRevisions')), studySessionId: v.optional(v.id('studySessions')), type: v.string(), status: v.union(v.literal('queued'), v.literal('leased'), v.literal('running'), v.literal('awaiting_approval'), v.literal('blocked'), v.literal('succeeded'), v.literal('failed'), v.literal('cancelled')), revision: v.number(), idempotencyKey: v.string(), requestFingerprint: v.optional(v.string()), inputDigest: v.optional(v.string()), candidateDigest: v.optional(v.string()), expectedVoidRevision: v.optional(v.number()), expectedBlueprintRecordRevision: v.optional(v.number()), expectedSessionRevision: v.optional(v.number()), attempts: v.optional(v.number()), providerEnabled: v.optional(v.boolean()), providerModel: v.optional(v.string()), providerPolicyVersion: v.optional(v.string()), providerResponseId: v.optional(v.string()), providerResponseModel: v.optional(v.string()), dispatchSupportingSourceSnapshotIds: v.optional(v.array(v.id('learnSourceSnapshots'))), leaseToken: v.optional(v.string()), leaseExpiresAt: v.optional(v.number()), checkpoint: v.optional(v.string()), terminalReason: v.optional(v.string()), createdAt: v.optional(v.number()), updatedAt: v.optional(v.number()) }).index('by_userId', ['userId']).index('by_userId_and_idempotencyKey', ['userId', 'idempotencyKey']).index('by_userId_and_status_and_leaseExpiresAt', ['userId', 'status', 'leaseExpiresAt']).index('by_status_and_leaseExpiresAt', ['status', 'leaseExpiresAt']).index('by_type_and_status_and_leaseExpiresAt', ['type', 'status', 'leaseExpiresAt']).index('by_userId_and_learningVoidId_and_type', ['userId', 'learningVoidId', 'type']).index('by_userId_and_blueprintRevisionId_and_type_and_status', ['userId', 'blueprintRevisionId', 'type', 'status']).index('by_userId_and_blueprintRevisionId_and_type_and_status_and_terminalReason', ['userId', 'blueprintRevisionId', 'type', 'status', 'terminalReason']).index('by_userId_and_studySessionId_and_type_and_status', ['userId', 'studySessionId', 'type', 'status']),
  // Exact-once lifecycle responses survive later transitions; it is included
  // in redacted owner export and account deletion like every V2 table.
  learnLifecycleReceipts: defineTable({ userId: v.string(), learningVoidId: v.id('learningVoids'), idempotencyKey: v.string(), command: v.string(), requestFingerprint: v.string(), revision: v.number(), status: v.optional(v.union(v.literal('draft'), v.literal('sourcing'), v.literal('source_review'), v.literal('map_review'), v.literal('calibration'), v.literal('plan_review'), v.literal('scheduled'), v.literal('active'), v.literal('completed'), v.literal('paused'), v.literal('needs_attention'), v.literal('failed'), v.literal('archived'), v.literal('accepted'), v.literal('superseded'))), blueprintRevisionId: v.optional(v.id('learnBlueprintRevisions')), blueprintRevisionOrdinal: v.optional(v.number()), blueprintRecordRevision: v.optional(v.number()), createdAt: v.number() }).index('by_userId', ['userId']).index('by_userId_and_idempotencyKey', ['userId', 'idempotencyKey']).index('by_userId_and_learningVoidId', ['userId', 'learningVoidId']),
  // Folder manifests freeze owner-authorized V1 document revisions for one
  // editable Blueprint revision. Queue cursors keep traversal transactional.
  learnFolderSourceManifests: defineTable({ userId: v.string(), learningVoidId: v.id('learningVoids'), blueprintRevisionId: v.id('learnBlueprintRevisions'), rootFolderId: v.id('folders'), expectedVoidRevision: v.number(), expectedBlueprintRecordRevision: v.number(), recordRevision: v.number(), status: v.union(v.literal('capturing'), v.literal('frozen'), v.literal('failed')), coverage: v.union(v.literal('empty'), v.literal('gap'), v.literal('partial'), v.literal('complete')), failureReason: v.optional(v.string()), idempotencyKey: v.string(), requestFingerprint: v.string(), explicitDocumentIds: v.array(v.id('documents')), explicitDocumentCursor: v.number(), nextFolderOrder: v.number(), nextEntryOrder: v.number(), entryCount: v.number(), availableCount: v.number(), unavailableCount: v.number(), createdAt: v.number(), frozenAt: v.optional(v.number()) }).index('by_userId', ['userId']).index('by_userId_and_idempotencyKey', ['userId', 'idempotencyKey']).index('by_userId_and_learningVoidId', ['userId', 'learningVoidId']).index('by_userId_and_blueprintRevisionId', ['userId', 'blueprintRevisionId']),
  learnFolderSourceManifestFolders: defineTable({ userId: v.string(), manifestId: v.id('learnFolderSourceManifests'), folderId: v.optional(v.id('folders')), parentFolderId: v.optional(v.id('folders')), name: v.optional(v.string()), folderRevision: v.string(), depth: v.number(), order: v.number(), stage: v.union(v.literal('children'), v.literal('documents'), v.literal('complete')), childCursor: v.optional(v.string()), documentCursor: v.optional(v.string()), documentCount: v.number(), evidencePurgedAt: v.optional(v.number()) }).index('by_userId', ['userId']).index('by_userId_and_manifestId_and_folderId', ['userId', 'manifestId', 'folderId']).index('by_userId_and_manifestId_and_stage_and_order', ['userId', 'manifestId', 'stage', 'order']).index('by_userId_and_manifestId_and_order', ['userId', 'manifestId', 'order']).index('by_userId_and_folderId_and_evidencePurgedAt', ['userId', 'folderId', 'evidencePurgedAt']),
  learnFolderSourceManifestEntries: defineTable({ userId: v.string(), manifestId: v.id('learnFolderSourceManifests'), order: v.number(), documentId: v.optional(v.id('documents')), folderId: v.optional(v.id('folders')), folderRevision: v.string(), sourceIdentityId: v.id('learnSourceIdentities'), sourceSnapshotId: v.id('learnSourceSnapshots'), contentHash: v.optional(v.string()), documentRevision: v.optional(v.string()), availability: v.union(v.literal('available'), v.literal('unavailable')), unavailableReason: v.optional(v.union(v.literal('processing'), v.literal('failed'), v.literal('missing_object_key'), v.literal('invalid_content_hash'), v.literal('invalid_source_revision'), v.literal('source_deleted'), v.literal('access_lost'), v.literal('policy_denied'))), evidencePurgedAt: v.optional(v.number()) }).index('by_userId', ['userId']).index('by_userId_and_manifestId_and_order', ['userId', 'manifestId', 'order']).index('by_userId_and_manifestId_and_documentId', ['userId', 'manifestId', 'documentId']).index('by_userId_and_sourceIdentityId_and_evidencePurgedAt', ['userId', 'sourceIdentityId', 'evidencePurgedAt']),

  accountDeletionJobs: defineTable({
    userId: v.string(),
    status: v.union(v.literal('active'), v.literal('complete')),
    phase: v.union(
      v.literal('documents'),
      v.literal('messages'),
      v.literal('conversations'),
      v.literal('attemptAnswers'),
      v.literal('quizAttempts'),
      v.literal('quizQuestions'),
      v.literal('quizzes'),
      v.literal('flashcards'),
      v.literal('flashcardSets'),
      v.literal('flashcardRoomCards'),
      v.literal('flashcardVersionCards'),
      v.literal('flashcardRoomVersions'),
      v.literal('flashcardRooms'),
      v.literal('learnProfile'),
      v.literal('reviewItems'),
      v.literal('reviewSessions'),
      v.literal('calendarEvents'),
      v.literal('calendarCleanupJobs'),
      v.literal('calendarConnections'),
      v.literal('courseSourceDocs'),
      v.literal('courseSections'),
      v.literal('courseDeletionJobs'),
      v.literal('courses'),
      v.literal('learnV2'),
      v.literal('audioMetadata'),
      v.literal('audioJobTurns'),
      v.literal('audioJobs'),
      v.literal('audioRooms'),
      v.literal('rateLimitBuckets'),
      v.literal('tasks'),
      v.literal('folders'),
      v.literal('user'),
      v.literal('waitingExternal'),
      v.literal('complete'),
    ),
    activeParentId: v.optional(v.string()),
    startedAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
  })
    .index('by_userId', ['userId'])
    .index('by_updatedAt', ['updatedAt'])
    .index('by_status_and_updatedAt', ['status', 'updatedAt']),
})
