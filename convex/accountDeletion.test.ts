/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'
import { backoffMs } from './accountDeletion'
import { tokenIdentifierForAuthUser } from './auth'

const modules = import.meta.glob('./**/*.ts')

const TEST_IDENTITY = {
  tokenIdentifier: 'https://auth.example.com|user_123',
  name: 'Test User',
  email: 'test@example.com',
}

const OTHER_IDENTITY = {
  tokenIdentifier: 'https://auth.example.com|user_456',
  name: 'Other User',
  email: 'other@example.com',
}

const CF_ENV = {
  CF_ACCOUNT_ID: 'test-account-id',
  CLOUDFLARE_AI_SEARCH_INSTANCE: 'test-instance',
  CLOUDFLARE_AI_SEARCH_TOKEN: 'test-token',
  R2_BUCKET_NAME: 'test-bucket',
  R2_ENDPOINT: 'https://test.r2.cloudflarestorage.com',
  R2_ACCESS_KEY_ID: 'test-key',
  R2_SECRET_ACCESS_KEY: 'test-secret',
}

async function advanceDeletionToExternalCleanup(
  t: ReturnType<typeof convexTest>,
  userId: string,
) {
  for (let batch = 0; batch < 250; batch++) {
    await t.mutation(internal.accountDeletion.runDeletionBatch, { userId })
    const state = (await t.query(internal.accountDeletion.getDeletionTombstone, { userId }))?.phase
    if (state === 'waitingExternal' || state === 'complete') return state
  }
  throw new Error('Account deletion did not reach external cleanup within the test batch bound')
}

async function finishDatabaseDeletion(t: ReturnType<typeof convexTest>, userId: string) {
  await advanceDeletionToExternalCleanup(t, userId)
  await t.action(internal.accountDeletion.drainPendingCleanup, { userId })
  await t.mutation(internal.accountDeletion.runDeletionBatch, { userId })
}

async function seedUserData(
  t: ReturnType<typeof convexTest>,
  asUser: ReturnType<ReturnType<typeof convexTest>['withIdentity']>,
  identity: typeof TEST_IDENTITY,
) {
  const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Notes' })

  const storageId1 = await t.run(async (ctx) => {
    return await ctx.storage.store(new Blob(['pdf-bytes'], { type: 'application/pdf' }))
  })
  const storageId2 = await t.run(async (ctx) => {
    return await ctx.storage.store(new Blob(['pdf-bytes'], { type: 'application/pdf' }))
  })

  const docSuccessId = await t.run(async (ctx) => {
    return await ctx.db.insert('documents', {
      userId: identity.tokenIdentifier,
      folderId,
      filename: 'indexed.pdf',
      fileId: storageId1,
      status: 'success',
      fileSize: 1024,
      r2Key: `${identity.tokenIdentifier}/key-1.txt`,
    })
  })

  const docProcessingId = await t.run(async (ctx) => {
    return await ctx.db.insert('documents', {
      userId: identity.tokenIdentifier,
      folderId,
      filename: 'pending.pdf',
      fileId: storageId2,
      status: 'processing',
      fileSize: 512,
    })
  })

  const convoId = await asUser.mutation(api.conversations.createConversation, {
    folderId,
    title: 'Test convo',
  })

  await asUser.mutation(api.messages.appendMessage, {
    conversationId: convoId,
    role: 'user',
    content: 'Hi',
  })
  await asUser.mutation(api.messages.appendMessage, {
    conversationId: convoId,
    role: 'assistant',
    content: 'Hello',
    model: 'claude-3',
  })

  return { folderId, docSuccessId, docProcessingId, convoId }
}

describe('accountDeletion.deleteAccountCascade', () => {
  let originalEnv: Record<string, string | undefined>

  beforeEach(() => {
    originalEnv = { ...process.env }
    Object.assign(process.env, CF_ENV)
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/ai-search/')) {
        return Response.json({
          success: true,
          result: [],
          result_info: { page: 1, per_page: 50, count: 0, total_count: 0 },
        })
      }
      return new Response('', { status: 404 })
    }))
  })

  afterEach(() => {
    process.env = originalEnv
    vi.unstubAllGlobals()
  })

  test('[P1] account deletion absorbs an active durable course-deletion job', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    await asUser.mutation(api.users.upsertUser, {})
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Deleting course' })
    const { courseId } = await asUser.mutation(api.courses.create, {
      title: 'Interrupted deletion',
      sourceType: 'web-only',
      folderId,
    })
    const courseDeletionJobId = await t.mutation(internal.courseDeletion.start, {
      courseId,
      userId: TEST_IDENTITY.tokenIdentifier,
    })

    await asUser.mutation(internal.accountDeletion.deleteCurrentUser, {})
    await finishDatabaseDeletion(t, TEST_IDENTITY.tokenIdentifier)

    expect(await t.run(ctx => ctx.db.get(courseDeletionJobId))).toBeNull()
    expect(await t.run(ctx => ctx.db.get(courseId))).toBeNull()
  })

  test('[P0] should remove all folders/documents/conversations/messages/users rows for the caller', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)

    await t.run(async (ctx) => {
      await ctx.db.insert('users', {
        tokenIdentifier: TEST_IDENTITY.tokenIdentifier,
        name: TEST_IDENTITY.name,
        email: TEST_IDENTITY.email,
      })
    })

    await seedUserData(t, asUser, TEST_IDENTITY)

    await asUser.mutation(internal.accountDeletion.deleteCurrentUser, {})
    await finishDatabaseDeletion(t, TEST_IDENTITY.tokenIdentifier)

    const counts = await t.run(async (ctx) => ({
      folders: (await ctx.db.query('folders').collect()).filter((r) => r.userId === TEST_IDENTITY.tokenIdentifier).length,
      documents: (await ctx.db.query('documents').collect()).filter((r) => r.userId === TEST_IDENTITY.tokenIdentifier).length,
      conversations: (await ctx.db.query('conversations').collect()).filter((r) => r.userId === TEST_IDENTITY.tokenIdentifier).length,
      messages: (await ctx.db.query('messages').collect()).filter((r) => r.userId === TEST_IDENTITY.tokenIdentifier).length,
      users: (await ctx.db.query('users').collect()).filter((r) => r.tokenIdentifier === TEST_IDENTITY.tokenIdentifier).length,
    }))

    expect(counts).toEqual({ folders: 0, documents: 0, conversations: 0, messages: 0, users: 0 })
  })

  test('[P0] should leave another user\'s data untouched', async () => {
    const t = convexTest(schema, modules)
    const asUserA = t.withIdentity(TEST_IDENTITY)
    const asUserB = t.withIdentity(OTHER_IDENTITY)

    await seedUserData(t, asUserA, TEST_IDENTITY)
    await seedUserData(t, asUserB, OTHER_IDENTITY)

    await asUserA.mutation(internal.accountDeletion.deleteCurrentUser, {})

    const bFolders = await asUserB.query(api.folders.listAllFolders, {})
    expect(bFolders.length).toBeGreaterThan(0)

    const bConvos = await asUserB.query(api.conversations.listRecentForUser, {})
    expect(bConvos.length).toBeGreaterThan(0)

    const bRemainingMessages = await t.run(async (ctx) => {
      return (await ctx.db.query('messages').collect()).filter((r) => r.userId === OTHER_IDENTITY.tokenIdentifier)
    })
    expect(bRemainingMessages.length).toBeGreaterThan(0)
  })

  test('[P0] should enqueue pendingCleanup rows for each document needing external cleanup + bulk sentinel', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)

    await seedUserData(t, asUser, TEST_IDENTITY)

    await asUser.mutation(internal.accountDeletion.deleteCurrentUser, {})
    await t.mutation(internal.accountDeletion.runDeletionBatch, { userId: TEST_IDENTITY.tokenIdentifier })

    const rows = await t.run(async (ctx) => {
      return await ctx.db
        .query('pendingCleanup')
        .withIndex('by_userId', (q) => q.eq('userId', TEST_IDENTITY.tokenIdentifier))
        .collect()
    })

    const r2Rows = rows.filter((r) => r.kind === 'r2')
    const aiPerDoc = rows.filter((r) => r.kind === 'ai-search' && r.documentId !== '__user_bulk__')
    const aiBulk = rows.filter((r) => r.kind === 'ai-search' && r.documentId === '__user_bulk__')

    expect(r2Rows.length).toBe(1) // only docSuccess has r2Key
    expect(aiPerDoc.length).toBe(1) // only docSuccess is status:'success'
    expect(aiPerDoc[0]?.r2Key).toBe(`${TEST_IDENTITY.tokenIdentifier}/key-1.txt`)
    expect(aiBulk.length).toBe(1)
    for (const r of rows) expect(r.attempts).toBe(0)
  })

  test('[P0] should reject unauthenticated caller', async () => {
    const t = convexTest(schema, modules)
    await expect(
      t.mutation(internal.accountDeletion.deleteCurrentUser, {}),
    ).rejects.toThrow()
  })

  test('[P0] should preserve Calendar credentials while provider-first disconnect runs', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    await asUser.mutation(api.calendarConnections.upsertConnection, {
      provider: 'google',
      accessToken: 'encrypted-access-token',
      refreshToken: 'encrypted-refresh-token',
      expiresAt: Date.now() + 3_600_000,
      timezone: 'America/Toronto',
    })

    await asUser.mutation(internal.accountDeletion.deleteCurrentUser, {})
    for (let batch = 0; batch < 50; batch++) {
      const state = await t.query(internal.accountDeletion.getDeletionTombstone, {
        userId: TEST_IDENTITY.tokenIdentifier,
      })
      if (state?.phase === 'calendarEvents') break
      await t.mutation(internal.accountDeletion.runDeletionBatch, {
        userId: TEST_IDENTITY.tokenIdentifier,
      })
    }
    await t.mutation(internal.accountDeletion.runDeletionBatch, {
      userId: TEST_IDENTITY.tokenIdentifier,
    })

    const state = await t.query(internal.accountDeletion.getDeletionTombstone, {
      userId: TEST_IDENTITY.tokenIdentifier,
    })
    const evidence = await t.run(async (ctx) => ({
      connection: await ctx.db.query('calendarConnections')
        .withIndex('by_userId', q => q.eq('userId', TEST_IDENTITY.tokenIdentifier))
        .first(),
      scheduled: (await ctx.db.system.query('_scheduled_functions').collect())
        .map(row => row.name.replace('.', ':')),
    }))
    expect(state).toMatchObject({ active: true, phase: 'calendarEvents' })
    expect(evidence.connection).not.toBeNull()
    expect(evidence.scheduled).toContain('calendarEvents:startDisconnectForUser')
  })

  test('[P0] should delete all Convex file-storage blobs', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)

    const { docSuccessId, docProcessingId } = await seedUserData(t, asUser, TEST_IDENTITY)

    const beforeFileIds = await t.run(async (ctx) => {
      const a = await ctx.db.get(docSuccessId)
      const b = await ctx.db.get(docProcessingId)
      return [a?.fileId, b?.fileId]
    })

    await asUser.mutation(internal.accountDeletion.deleteCurrentUser, {})
    await finishDatabaseDeletion(t, TEST_IDENTITY.tokenIdentifier)

    const afterExists = await t.run(async (ctx) => {
      return await Promise.all(
        beforeFileIds.map(async (fid) => (fid ? await ctx.db.system.get(fid) : null)),
      )
    })
    expect(afterExists[0]).toBeNull()
    expect(afterExists[1]).toBeNull()
  })

  test('[P0] should remove caller\'s quizzes + quizQuestions, leaving another user\'s untouched', async () => {
    const t = convexTest(schema, modules)
    const asUserA = t.withIdentity(TEST_IDENTITY)
    const asUserB = t.withIdentity(OTHER_IDENTITY)

    const folderA = await asUserA.mutation(api.folders.createFolder, { name: 'Alice Quiz Folder' })
    const folderB = await asUserB.mutation(api.folders.createFolder, { name: 'Bob Quiz Folder' })

    const sharedQuestions = [
      {
        order: 0,
        question: 'Q1',
        type: 'free-response' as const,
        correctAnswer: 'A1',
        sourceChunkContent: 'chunk',
        sourceFilename: 'doc.pdf',
      },
      {
        order: 1,
        question: 'Q2',
        type: 'free-response' as const,
        correctAnswer: 'A2',
        sourceChunkContent: 'chunk',
        sourceFilename: 'doc.pdf',
      },
    ]

    await asUserA.mutation(api.quizzes.createWithQuestions, {
      folderId: folderA,
      title: 'Alice Quiz',
      questions: sharedQuestions,
    })
    const bResult = await asUserB.mutation(api.quizzes.createWithQuestions, {
      folderId: folderB,
      title: 'Bob Quiz',
      questions: sharedQuestions,
    })

    await asUserA.mutation(internal.accountDeletion.deleteCurrentUser, {})
    await finishDatabaseDeletion(t, TEST_IDENTITY.tokenIdentifier)

    const aQuizzes = await t.run(async (ctx) => {
      return (await ctx.db.query('quizzes').collect()).filter(
        (r) => r.userId === TEST_IDENTITY.tokenIdentifier,
      )
    })
    const aQuestions = await t.run(async (ctx) => {
      return (await ctx.db.query('quizQuestions').collect()).filter(
        (r) => r.userId === TEST_IDENTITY.tokenIdentifier,
      )
    })
    expect(aQuizzes).toHaveLength(0)
    expect(aQuestions).toHaveLength(0)

    const bQuizzes = await t.run(async (ctx) => {
      return (await ctx.db.query('quizzes').collect()).filter(
        (r) => r.userId === OTHER_IDENTITY.tokenIdentifier,
      )
    })
    const bQuestions = await t.run(async (ctx) => {
      return (await ctx.db.query('quizQuestions').collect()).filter(
        (r) => r.userId === OTHER_IDENTITY.tokenIdentifier,
      )
    })
    expect(bQuizzes.map((r) => r._id)).toContain(bResult.quizId)
    expect(bQuestions).toHaveLength(2)
  })

  test('[P0] should remove caller\'s quizAttempts, leaving another user\'s untouched (Story 6.2)', async () => {
    const t = convexTest(schema, modules)
    const asUserA = t.withIdentity(TEST_IDENTITY)
    const asUserB = t.withIdentity(OTHER_IDENTITY)

    const folderA = await asUserA.mutation(api.folders.createFolder, { name: 'A folder' })
    const folderB = await asUserB.mutation(api.folders.createFolder, { name: 'B folder' })

    const questions = [
      {
        order: 0,
        question: 'Q?',
        type: 'free-response' as const,
        correctAnswer: 'A',
        sourceChunkContent: 'src',
        sourceFilename: 'f.pdf',
      },
    ]

    const aQuiz = await asUserA.mutation(api.quizzes.createWithQuestions, {
      folderId: folderA,
      title: 'A Quiz',
      questions,
    })
    const bQuiz = await asUserB.mutation(api.quizzes.createWithQuestions, {
      folderId: folderB,
      title: 'B Quiz',
      questions,
    })

    const aQuestions = await t.run(async (ctx) =>
      ctx.db.query('quizQuestions').withIndex('by_quizId', (q) => q.eq('quizId', aQuiz.quizId)).collect(),
    )
    const bQuestions = await t.run(async (ctx) =>
      ctx.db.query('quizQuestions').withIndex('by_quizId', (q) => q.eq('quizId', bQuiz.quizId)).collect(),
    )

    const aAttempt = await asUserA.mutation(api.quizzes.submitAttempt, {
      quizId: aQuiz.quizId,
      answers: [{ questionId: aQuestions[0]!._id, response: 'A' }],
    })
    const bAttempt = await asUserB.mutation(api.quizzes.submitAttempt, {
      quizId: bQuiz.quizId,
      answers: [{ questionId: bQuestions[0]!._id, response: 'A' }],
    })
    const { aAnswerId, bAnswerId } = await t.run(async (ctx) => ({
      aAnswerId: await ctx.db.insert('attemptAnswers', {
        attemptId: aAttempt.attemptId,
        questionId: aQuestions[0]!._id,
        userAnswer: 'A',
        isCorrect: true,
        answeredAt: Date.now(),
      }),
      bAnswerId: await ctx.db.insert('attemptAnswers', {
        attemptId: bAttempt.attemptId,
        questionId: bQuestions[0]!._id,
        userAnswer: 'A',
        isCorrect: true,
        answeredAt: Date.now(),
      }),
    }))

    await asUserA.mutation(internal.accountDeletion.deleteCurrentUser, {})
    await finishDatabaseDeletion(t, TEST_IDENTITY.tokenIdentifier)

    const aAttempts = await t.run(async (ctx) => {
      return (await ctx.db.query('quizAttempts').collect()).filter(
        (r) => r.userId === TEST_IDENTITY.tokenIdentifier,
      )
    })
    const bAttempts = await t.run(async (ctx) => {
      return (await ctx.db.query('quizAttempts').collect()).filter(
        (r) => r.userId === OTHER_IDENTITY.tokenIdentifier,
      )
    })

    expect(aAttempts).toHaveLength(0)
    expect(bAttempts).toHaveLength(1)
    expect(await t.run(ctx => ctx.db.get(aAnswerId))).toBeNull()
    expect(await t.run(ctx => ctx.db.get(bAnswerId))).not.toBeNull()
  })

  test('[P0] should remove caller rate-limit buckets while leaving another user\'s untouched', async () => {
    const t = convexTest(schema, modules)

    const { ownBucketId, otherBucketId } = await t.run(async (ctx) => ({
      ownBucketId: await ctx.db.insert('rateLimitBuckets', {
        key: `${TEST_IDENTITY.tokenIdentifier}::/api/rag/chat`,
        userId: TEST_IDENTITY.tokenIdentifier,
        route: '/api/rag/chat',
        count: 2,
        windowStartedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      }),
      otherBucketId: await ctx.db.insert('rateLimitBuckets', {
        key: `${OTHER_IDENTITY.tokenIdentifier}::/api/rag/chat`,
        userId: OTHER_IDENTITY.tokenIdentifier,
        route: '/api/rag/chat',
        count: 1,
        windowStartedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      }),
    }))

    await t.withIdentity(TEST_IDENTITY).mutation(internal.accountDeletion.deleteCurrentUser, {})
    await finishDatabaseDeletion(t, TEST_IDENTITY.tokenIdentifier)

    expect(await t.run(ctx => ctx.db.get(ownBucketId))).toBeNull()
    expect(await t.run(ctx => ctx.db.get(otherBucketId))).not.toBeNull()
  })

  test('[P0] should remove every audio job turn beyond one batch and preserve another user\'s job', async () => {
    const t = convexTest(schema, modules)
    const asUserA = t.withIdentity(TEST_IDENTITY)
    const asUserB = t.withIdentity(OTHER_IDENTITY)
    const folderA = await asUserA.mutation(api.folders.createFolder, { name: 'A audio' })
    const folderB = await asUserB.mutation(api.folders.createFolder, { name: 'B audio' })

    const { otherJobId, otherTurnId } = await t.run(async (ctx) => {
      const now = Date.now()
      const taskA = await ctx.db.insert('tasks', {
        userId: TEST_IDENTITY.tokenIdentifier,
        folderId: folderA,
        type: 'audio-overview-generation',
        status: 'running',
        title: 'A job',
        createdAt: now,
        updatedAt: now,
      })
      const taskB = await ctx.db.insert('tasks', {
        userId: OTHER_IDENTITY.tokenIdentifier,
        folderId: folderB,
        type: 'audio-overview-generation',
        status: 'running',
        title: 'B job',
        createdAt: now,
        updatedAt: now,
      })
      const jobA = await ctx.db.insert('audioOverviewJobs', {
        userId: TEST_IDENTITY.tokenIdentifier,
        taskId: taskA,
        folderId: folderA,
        idempotencyKey: 'account-delete-audio-a',
        capabilityHash: 'a'.repeat(64),
        status: 'running',
        stage: 'synthesizing',
        completedTurns: 0,
        createdAt: now,
        updatedAt: now,
      })
      const jobB = await ctx.db.insert('audioOverviewJobs', {
        userId: OTHER_IDENTITY.tokenIdentifier,
        taskId: taskB,
        folderId: folderB,
        idempotencyKey: 'account-delete-audio-b',
        capabilityHash: 'b'.repeat(64),
        status: 'running',
        stage: 'synthesizing',
        completedTurns: 0,
        createdAt: now,
        updatedAt: now,
      })

      for (let order = 0; order < 75; order++) {
        await ctx.db.insert('audioOverviewJobTurns', {
          jobId: jobA,
          taskId: taskA,
          userId: TEST_IDENTITY.tokenIdentifier,
          order,
          speaker: order % 2 === 0 ? 'host_a' : 'host_b',
          text: `Turn ${order}`,
          status: 'pending',
          updatedAt: now,
        })
      }
      const otherTurnId = await ctx.db.insert('audioOverviewJobTurns', {
        jobId: jobB,
        taskId: taskB,
        userId: OTHER_IDENTITY.tokenIdentifier,
        order: 0,
        speaker: 'host_a',
        text: 'Other user turn',
        status: 'pending',
        updatedAt: now,
      })
      return { otherJobId: jobB, otherTurnId }
    })

    await asUserA.mutation(internal.accountDeletion.deleteCurrentUser, {})
    await finishDatabaseDeletion(t, TEST_IDENTITY.tokenIdentifier)

    const ownRows = await t.run(async (ctx) => ({
      jobs: (await ctx.db.query('audioOverviewJobs').collect()).filter(
        row => row.userId === TEST_IDENTITY.tokenIdentifier,
      ),
      turns: (await ctx.db.query('audioOverviewJobTurns').collect()).filter(
        row => row.userId === TEST_IDENTITY.tokenIdentifier,
      ),
    }))
    expect(ownRows).toEqual({ jobs: [], turns: [] })
    expect(await t.run(ctx => ctx.db.get(otherJobId))).not.toBeNull()
    expect(await t.run(ctx => ctx.db.get(otherTurnId))).not.toBeNull()
  })

  test('[P0] should stage an in-progress v2 episode that has no compatibility overview', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Orphan v2 audio' })
    const episodeId = await t.run(async (ctx) => {
      const now = Date.now()
      const taskId = await ctx.db.insert('tasks', {
        userId: TEST_IDENTITY.tokenIdentifier,
        folderId,
        type: 'audio-overview-generation',
        status: 'running',
        title: 'In-progress v2 audio',
        createdAt: now,
        updatedAt: now,
      })
      const jobId = await ctx.db.insert('audioOverviewJobs', {
        userId: TEST_IDENTITY.tokenIdentifier,
        taskId,
        folderId,
        idempotencyKey: 'account-delete-orphan-v2',
        capabilityHash: 'c'.repeat(64),
        status: 'running',
        stage: 'preparing',
        completedTurns: 0,
        createdAt: now,
        updatedAt: now,
      })
      const sourceManifestId = await ctx.db.insert('audioOverviewSourceManifests', {
        jobId,
        taskId,
        userId: TEST_IDENTITY.tokenIdentifier,
        folderId,
        schemaVersion: 2,
        revision: 'manifest-v1',
        contentHash: 'a'.repeat(64),
        planFingerprint: 'b'.repeat(64),
        entryCount: 0,
        frozenAt: now,
      })
      const outlineId = await ctx.db.insert('audioOverviewOutlines', {
        jobId,
        taskId,
        userId: TEST_IDENTITY.tokenIdentifier,
        narrativeArc: 'Pending generation',
        learningObjectiveCount: 0,
        createdAt: now,
      })
      const claimLedgerId = await ctx.db.insert('audioOverviewClaimLedgers', {
        jobId,
        taskId,
        userId: TEST_IDENTITY.tokenIdentifier,
        claimCount: 0,
        supportedClaimCount: 0,
        createdAt: now,
      })
      return await ctx.db.insert('audioOverviewEpisodes', {
        jobId,
        taskId,
        userId: TEST_IDENTITY.tokenIdentifier,
        folderId,
        sourceManifestId,
        outlineId,
        claimLedgerId,
        schemaVersion: 2,
        title: 'In-progress episode',
        model: 'test-model',
        audioProfileId: 'test-profile',
        audioProfileVersion: '1',
        renderer: 'test-renderer',
        hostAVoice: 'host-a',
        hostBVoice: 'host-b',
        requestedLengthMinutes: 5,
        complexity: 'beginner',
        status: 'planning',
        sceneCount: 0,
        utteranceCount: 0,
        createdAt: now,
        updatedAt: now,
      })
    })

    await asUser.mutation(internal.accountDeletion.deleteCurrentUser, {})
    const scheduled = await t.run(async (ctx) => {
      const jobs = await ctx.db.system.query('_scheduled_functions').collect()
      return jobs.map(job => job.name.replace('.', ':'))
    })
    expect(scheduled).toContain('accountDeletion:stageUserEpisodesForDeletion')

    await t.mutation(internal.accountDeletion.stageUserEpisodesForDeletion, {
      userId: TEST_IDENTITY.tokenIdentifier,
      cursor: null,
    })
    const staged = await t.run(async (ctx) => {
      const episode = await ctx.db.get(episodeId)
      const overview = episode?.compatibilityOverviewId
        ? await ctx.db.get(episode.compatibilityOverviewId)
        : null
      return { episode, overview }
    })
    expect(staged.episode).toMatchObject({ status: 'deleting' })
    expect(staged.overview).toMatchObject({
      userId: TEST_IDENTITY.tokenIdentifier,
      episodeId,
      status: 'deleting',
      turns: [],
    })
  })

  test('[P0] stable episode pagination does not skip rows when staging mutates status', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Many episodes' })
    await t.run(async (ctx) => {
      const now = Date.now()
      const taskId = await ctx.db.insert('tasks', {
        userId: TEST_IDENTITY.tokenIdentifier,
        folderId,
        type: 'audio-overview-generation',
        status: 'running',
        title: 'Many episodes',
        createdAt: now,
        updatedAt: now,
      })
      const jobId = await ctx.db.insert('audioOverviewJobs', {
        userId: TEST_IDENTITY.tokenIdentifier,
        taskId,
        folderId,
        idempotencyKey: 'many-account-delete-episodes',
        capabilityHash: 'd'.repeat(64),
        status: 'running',
        stage: 'preparing',
        completedTurns: 0,
        createdAt: now,
        updatedAt: now,
      })
      const sourceManifestId = await ctx.db.insert('audioOverviewSourceManifests', {
        jobId,
        taskId,
        userId: TEST_IDENTITY.tokenIdentifier,
        folderId,
        schemaVersion: 2,
        revision: 'manifest-v1',
        contentHash: 'a'.repeat(64),
        planFingerprint: 'b'.repeat(64),
        entryCount: 0,
        frozenAt: now,
      })
      const outlineId = await ctx.db.insert('audioOverviewOutlines', {
        jobId,
        taskId,
        userId: TEST_IDENTITY.tokenIdentifier,
        narrativeArc: 'Pending generation',
        learningObjectiveCount: 0,
        createdAt: now,
      })
      const claimLedgerId = await ctx.db.insert('audioOverviewClaimLedgers', {
        jobId,
        taskId,
        userId: TEST_IDENTITY.tokenIdentifier,
        claimCount: 0,
        supportedClaimCount: 0,
        createdAt: now,
      })
      for (let index = 0; index < 31; index++) {
        await ctx.db.insert('audioOverviewEpisodes', {
          jobId,
          taskId,
          userId: TEST_IDENTITY.tokenIdentifier,
          folderId,
          sourceManifestId,
          outlineId,
          claimLedgerId,
          schemaVersion: 2,
          title: `Episode ${index}`,
          model: 'test-model',
          audioProfileId: 'test-profile',
          audioProfileVersion: '1',
          renderer: 'test-renderer',
          hostAVoice: 'host-a',
          hostBVoice: 'host-b',
          requestedLengthMinutes: 5,
          complexity: 'beginner',
          status: 'planning',
          sceneCount: 0,
          utteranceCount: 0,
          createdAt: now + index,
          updatedAt: now + index,
        })
      }
    })

    let cursor: string | null = null
    do {
      const result: { staged: number, done: boolean, continueCursor: string | null }
        = await t.mutation(internal.accountDeletion.stageUserEpisodesForDeletion, {
          userId: TEST_IDENTITY.tokenIdentifier,
          cursor,
        })
      cursor = result.continueCursor
    } while (cursor !== null)

    const staged = await t.run(async (ctx) => await ctx.db
      .query('audioOverviewEpisodes')
      .withIndex('by_userId', q => q.eq('userId', TEST_IDENTITY.tokenIdentifier))
      .collect())
    expect(staged).toHaveLength(31)
    expect(staged.every(row => row.status === 'deleting' && row.compatibilityOverviewId)).toBe(true)
  })

  test('[P0] should remove caller\'s flashcardRooms + cards, leaving another user\'s untouched', async () => {
    const t = convexTest(schema, modules)
    const asUserA = t.withIdentity(TEST_IDENTITY)
    const asUserB = t.withIdentity(OTHER_IDENTITY)

    const folderA = await asUserA.mutation(api.folders.createFolder, { name: 'A folder' })
    const folderB = await asUserB.mutation(api.folders.createFolder, { name: 'B folder' })

    const { roomId: aRoom } = await asUserA.mutation(api.flashcardRooms.createRoom, { folderId: folderA, title: 'A Room' })
    await asUserA.mutation(api.flashcardRooms.createCard, { roomId: aRoom, term: 'F1', definition: 'B1' })
    await asUserA.mutation(api.flashcardRooms.createCard, { roomId: aRoom, term: 'F2', definition: 'B2' })

    const { roomId: bRoom } = await asUserB.mutation(api.flashcardRooms.createRoom, { folderId: folderB, title: 'B Room' })
    await asUserB.mutation(api.flashcardRooms.createCard, { roomId: bRoom, term: 'F1', definition: 'B1' })
    await asUserB.mutation(api.flashcardRooms.createCard, { roomId: bRoom, term: 'F2', definition: 'B2' })

    await asUserA.mutation(internal.accountDeletion.deleteCurrentUser, {})
    await finishDatabaseDeletion(t, TEST_IDENTITY.tokenIdentifier)

    const aRooms = await t.run(async (ctx) => {
      return (await ctx.db.query('flashcardRooms').collect()).filter(
        (r) => r.userId === TEST_IDENTITY.tokenIdentifier,
      )
    })
    const aCards = await t.run(async (ctx) => {
      return (await ctx.db.query('flashcardRoomCards').collect()).filter(
        (r) => r.userId === TEST_IDENTITY.tokenIdentifier,
      )
    })
    expect(aRooms).toHaveLength(0)
    expect(aCards).toHaveLength(0)

    const bRooms = await t.run(async (ctx) => {
      return (await ctx.db.query('flashcardRooms').collect()).filter(
        (r) => r.userId === OTHER_IDENTITY.tokenIdentifier,
      )
    })
    const bCards = await t.run(async (ctx) => {
      return (await ctx.db.query('flashcardRoomCards').collect()).filter(
        (r) => r.userId === OTHER_IDENTITY.tokenIdentifier,
      )
    })
    expect(bRooms.map((r) => r._id)).toContain(bRoom)
    expect(bCards).toHaveLength(2)
  })

  test('[P0] cascade deletes rows from all four flashcardRoom* tables', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'FC' })
    const { roomId } = await asUser.mutation(api.flashcardRooms.createRoom, { folderId })
    await asUser.mutation(api.flashcardRooms.generateRoomCards, {
      roomId,
      origin: 'ai',
      title: 'Gen',
      cards: [
        { term: 'T', definition: 'D', metadata: { source: { filename: 'f.pdf', chunkContent: 'c' } } },
      ],
    })

    await asUser.mutation(internal.accountDeletion.deleteCurrentUser, {})
    await finishDatabaseDeletion(t, TEST_IDENTITY.tokenIdentifier)

    const counts = await t.run(async (ctx) => ({
      rooms: (await ctx.db.query('flashcardRooms').collect()).filter((r) => r.userId === TEST_IDENTITY.tokenIdentifier).length,
      roomCards: (await ctx.db.query('flashcardRoomCards').collect()).filter((r) => r.userId === TEST_IDENTITY.tokenIdentifier).length,
      versions: (await ctx.db.query('flashcardRoomVersions').collect()).filter((r) => r.userId === TEST_IDENTITY.tokenIdentifier).length,
      versionCards: (await ctx.db.query('flashcardVersionCards').collect()).filter((r) => r.userId === TEST_IDENTITY.tokenIdentifier).length,
    }))
    expect(counts).toEqual({ rooms: 0, roomCards: 0, versions: 0, versionCards: 0 })
  })

  test('[P0] internal deleteAccountCascade accepts userId arg directly', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'FC' })
    await asUser.mutation(api.flashcardRooms.createRoom, { folderId })

    await t.mutation(internal.accountDeletion.deleteAccountCascade, {
      userId: TEST_IDENTITY.tokenIdentifier,
    })
    await finishDatabaseDeletion(t, TEST_IDENTITY.tokenIdentifier)

    const rooms = await t.run(async (ctx) =>
      (await ctx.db.query('flashcardRooms').collect()).filter(
        (r) => r.userId === TEST_IDENTITY.tokenIdentifier,
      ),
    )
    expect(rooms).toHaveLength(0)
  })

  test('[P0] completed tombstones reject stale authenticated reads and exports', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)

    const { folderId, convoId } = await seedUserData(t, asUser, TEST_IDENTITY)

    await asUser.mutation(internal.accountDeletion.deleteCurrentUser, {})
    await finishDatabaseDeletion(t, TEST_IDENTITY.tokenIdentifier)

    await expect(asUser.query(api.folders.listAllFolders, {}))
      .rejects.toThrow('Account deletion is in progress')
    await expect(asUser.query(api.conversations.listRecentForUser, {}))
      .rejects.toThrow('Account deletion is in progress')
    await expect(asUser.query(api.documents.listDocumentsByFolder, { folderId }))
      .rejects.toThrow('Account deletion is in progress')
    await expect(asUser.query(api.conversations.getConversation, { id: convoId }))
      .rejects.toThrow('Account deletion is in progress')
    await expect(asUser.query(api.dataExport.getExportMetadata, {}))
      .rejects.toThrow('Account deletion is in progress')
  })
})

describe('accountDeletion.backoffMs', () => {
  test('[P1] grows exponentially and caps at 1h', () => {
    expect(backoffMs(0)).toBe(30_000)
    expect(backoffMs(1)).toBe(60_000)
    expect(backoffMs(2)).toBe(120_000)
    expect(backoffMs(3)).toBe(240_000)
    expect(backoffMs(10)).toBe(3_600_000)
    expect(backoffMs(20)).toBe(3_600_000)
  })
})

describe('account deletion identity and tombstone authority', () => {
  test('[P0] Better Auth user id maps to the Convex JWT token identifier', () => {
    expect(tokenIdentifierForAuthUser('better-auth-user', 'https://example.convex.site'))
      .toBe('https://example.convex.site|better-auth-user')
    expect(() => tokenIdentifierForAuthUser('bad|subject', 'https://example.convex.site'))
      .toThrow('Unable to derive')
  })

  test('[P0] stale authenticated writes are rejected by active and completed tombstones', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Before deletion' })
    const conversationId = await asUser.mutation(api.conversations.createConversation, {
      folderId,
      title: 'Before deletion',
    })

    await asUser.mutation(internal.accountDeletion.deleteCurrentUser, {})

    await expect(asUser.mutation(api.folders.createFolder, { name: 'After deletion' }))
      .rejects.toThrow('Account deletion is in progress')
    await expect(asUser.mutation(api.messages.appendMessage, {
      conversationId,
      role: 'user',
      content: 'After deletion',
    })).rejects.toThrow('Account deletion is in progress')
    await expect(asUser.mutation(api.users.upsertUser, {}))
      .rejects.toThrow('Account deletion is in progress')

    await t.run(async (ctx) => {
      const job = await ctx.db.query('accountDeletionJobs')
        .withIndex('by_userId', q => q.eq('userId', TEST_IDENTITY.tokenIdentifier))
        .unique()
      if (!job) throw new Error('Expected account deletion tombstone')
      await ctx.db.patch(job._id, {
        status: 'complete',
        phase: 'complete',
        updatedAt: Date.now(),
        completedAt: Date.now(),
      })
    })
    expect(await t.query(internal.accountDeletion.getDeletionTombstone, {
      userId: TEST_IDENTITY.tokenIdentifier,
    })).toMatchObject({ active: false, phase: 'complete' })
    await expect(asUser.mutation(api.folders.createFolder, { name: 'After completion' }))
      .rejects.toThrow('Account deletion is in progress')
  })

  test('[P0] active audio cancellation is bounded and resumable', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Cancellation' })
    await t.run(async (ctx) => {
      const now = Date.now()
      await ctx.db.insert('accountDeletionJobs', {
        userId: TEST_IDENTITY.tokenIdentifier,
        status: 'active',
        phase: 'documents',
        startedAt: now,
        updatedAt: now,
      })
      for (let index = 0; index < 21; index++) {
        const taskId = await ctx.db.insert('tasks', {
          userId: TEST_IDENTITY.tokenIdentifier,
          folderId,
          type: 'audio-overview-generation',
          status: 'running',
          title: `Job ${index}`,
          createdAt: now,
          updatedAt: now,
        })
        await ctx.db.insert('audioOverviewJobs', {
          userId: TEST_IDENTITY.tokenIdentifier,
          taskId,
          folderId,
          idempotencyKey: `bounded-cancel-${index}`,
          capabilityHash: String(index).padStart(64, '0'),
          status: 'running',
          stage: 'synthesizing',
          completedTurns: 0,
          createdAt: now,
          updatedAt: now,
        })
      }
    })

    expect(await t.mutation(internal.accountDeletion.cancelActiveAudioJobs, {
      userId: TEST_IDENTITY.tokenIdentifier,
    })).toEqual({ cancelled: 8, hasMore: true })
    expect(await t.mutation(internal.accountDeletion.cancelActiveAudioJobs, {
      userId: TEST_IDENTITY.tokenIdentifier,
    })).toEqual({ cancelled: 8, hasMore: true })
    expect(await t.mutation(internal.accountDeletion.cancelActiveAudioJobs, {
      userId: TEST_IDENTITY.tokenIdentifier,
    })).toEqual({ cancelled: 5, hasMore: false })

    const active = await t.run(async (ctx) => await ctx.db
      .query('audioOverviewJobs')
      .withIndex('by_userId_and_status', q => q
        .eq('userId', TEST_IDENTITY.tokenIdentifier)
        .eq('status', 'running'))
      .collect())
    expect(active).toEqual([])
  })
})

describe('accountDeletion.drainPendingCleanup', () => {
  let originalEnv: Record<string, string | undefined>

  beforeEach(() => {
    originalEnv = { ...process.env }
    Object.assign(process.env, CF_ENV)
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    process.env = originalEnv
    vi.unstubAllGlobals()
  })

  test('[P0] should retain pendingCleanup when the AI Search Items list returns 404', { timeout: 30_000 }, async () => {
    const t = convexTest(schema, modules)
    const userId = TEST_IDENTITY.tokenIdentifier

    await t.run(async (ctx) => {
      await ctx.db.insert('pendingCleanup', {
        userId,
        documentId: 'doc-1',
        kind: 'ai-search',
        attempts: 0,
      })
    })

    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () =>
      new Response('', { status: 404 }),
    )

    await t.action(internal.accountDeletion.drainPendingCleanup, { userId })

    const rows = await t.run(async (ctx) => {
      return await ctx.db
        .query('pendingCleanup')
        .withIndex('by_userId', (q) => q.eq('userId', userId))
        .collect()
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ attempts: 1 })
    expect(rows[0]?.lastError).toContain('item list failed (404)')
  })

  test('[P0] paginates Items, deletes only exact owner/source matches, and verifies absence', async () => {
    const t = convexTest(schema, modules)
    const userId = TEST_IDENTITY.tokenIdentifier
    const rowId = await t.run(async (ctx) => await ctx.db.insert('pendingCleanup', {
      userId,
      documentId: 'owned-doc',
      r2Key: 'owned/key.md',
      kind: 'ai-search',
      attempts: 0,
    }))
    const sourceId = `r2:${CF_ENV.R2_BUCKET_NAME}`
    const fetchFn = fetch as unknown as ReturnType<typeof vi.fn>
    fetchFn
      .mockResolvedValueOnce(Response.json({
        success: true,
        result: [{
          id: 'other-item',
          key: 'other/key.md',
          source_id: sourceId,
          status: 'completed',
          metadata: { userId, documentId: 'owned-doc' },
        }],
        result_info: { page: 1, per_page: 50, count: 50, total_count: 51 },
      }))
      .mockResolvedValueOnce(Response.json({
        success: true,
        result: [{
          id: 'owned-item',
          key: 'owned/key.md',
          source_id: sourceId,
          status: 'completed',
          metadata: { userId, documentId: 'owned-doc' },
        }],
        result_info: { page: 2, per_page: 50, count: 1, total_count: 51 },
      }))
      .mockResolvedValueOnce(Response.json({ success: true, result: { key: 'owned/key.md' } }))
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(Response.json({
        success: true,
        result: [],
        result_info: { page: 1, per_page: 50, count: 0, total_count: 0 },
      }))

    expect(await t.action(internal.accountDeletion.drainPendingCleanup, { userId }))
      .toEqual({ processed: 1, hasMore: true })
    expect(await t.run(ctx => ctx.db.get(rowId))).toMatchObject({ attempts: 0, scanPage: 1 })

    const urls = fetchFn.mock.calls.map(call => String(call[0]))
    expect(new URL(urls[0]!).searchParams.get('page')).toBe('1')
    expect(new URL(urls[1]!).searchParams.get('page')).toBe('2')
    expect(new URL(urls[1]!).searchParams.get('source')).toBe(sourceId)
    expect(new URL(urls[1]!).searchParams.get('key')).toBe('owned/key.md')
    expect(fetchFn.mock.calls[2]?.[1]).toMatchObject({ method: 'DELETE' })
    expect(urls[2]).toContain('/items/owned-item')
    expect(fetchFn.mock.calls[3]?.[1]?.method).toBeUndefined()
    expect(urls.some(url => url.includes('/items/other-item'))).toBe(false)

    expect(await t.action(internal.accountDeletion.drainPendingCleanup, { userId }))
      .toEqual({ processed: 1, hasMore: false })
    expect(await t.run(ctx => ctx.db.get(rowId))).toBeNull()
  })

  test('[P1] should increment attempts on 500', async () => {
    const t = convexTest(schema, modules)
    const userId = TEST_IDENTITY.tokenIdentifier

    const rowId = await t.run(async (ctx) => {
      return await ctx.db.insert('pendingCleanup', {
        userId,
        documentId: 'doc-err',
        kind: 'ai-search',
        attempts: 0,
      })
    })

    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () =>
      new Response('boom', { status: 500 }),
    )

    await t.action(internal.accountDeletion.drainPendingCleanup, { userId })

    const row = await t.run(async (ctx) => ctx.db.get(rowId))
    expect(row?.attempts).toBe(1)
    expect(row?.lastError).toBeDefined()
  })

  test('[P0] skips cleanup rows until their persisted backoff is due', async () => {
    const t = convexTest(schema, modules)
    const userId = TEST_IDENTITY.tokenIdentifier
    const futureId = await t.run(async (ctx) => await ctx.db.insert('pendingCleanup', {
      userId,
      documentId: 'future',
      kind: 'ai-search',
      attempts: 1,
      nextAttemptAt: Date.now() + 60_000,
    }))
    const dueId = await t.run(async (ctx) => await ctx.db.insert('pendingCleanup', {
      userId,
      documentId: 'due',
      kind: 'ai-search',
      attempts: 0,
    }))
    const fetchFn = fetch as unknown as ReturnType<typeof vi.fn>
    fetchFn.mockImplementation(async () => Response.json({
      success: true,
      result: [],
      result_info: { page: 1, per_page: 50, count: 0, total_count: 0 },
    }))

    await t.action(internal.accountDeletion.drainPendingCleanup, { userId })

    expect(await t.run(ctx => ctx.db.get(dueId))).toBeNull()
    expect(await t.run(ctx => ctx.db.get(futureId))).not.toBeNull()
    expect(fetchFn).toHaveBeenCalledOnce()
  })

  test('[P1] should retry and clear a dead-letter row when the rescue sweep invokes the drain', async () => {
    const t = convexTest(schema, modules)
    const userId = TEST_IDENTITY.tokenIdentifier

    const rowId = await t.run(async (ctx) => {
      return await ctx.db.insert('pendingCleanup', {
        userId,
        documentId: 'doc-dead',
        kind: 'ai-search',
        attempts: 10,
      })
    })

    const fetchFn = fetch as unknown as ReturnType<typeof vi.fn>
    fetchFn.mockImplementation(async () => Response.json({
      success: true,
      result: [],
      result_info: { page: 1, per_page: 50, count: 0, total_count: 0 },
    }))

    await t.action(internal.accountDeletion.sweepPendingCleanup, {})

    const row = await t.run(async (ctx) => ctx.db.get(rowId))
    expect(row).toBeNull()
    expect(fetchFn).toHaveBeenCalledOnce()
  })

  test('[P0] terminal cleanup sweep reserves fair capacity for every provider', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      for (const kind of ['ai-search', 'r2', 'convex-storage'] as const) {
        for (let index = 0; index < 12; index++) {
          await ctx.db.insert('pendingCleanup', {
            userId: `${TEST_IDENTITY.tokenIdentifier}-${kind}`,
            documentId: `${kind}-${index}`,
            kind,
            attempts: 10,
          })
        }
      }
    })

    const rows = await t.query(internal.accountDeletion.listPendingCleanupSweep, {
      now: Date.now(),
    })
    expect(rows).toHaveLength(25)
    expect(rows.filter(row => row.kind === 'ai-search')).toHaveLength(9)
    expect(rows.filter(row => row.kind === 'r2')).toHaveLength(8)
    expect(rows.filter(row => row.kind === 'convex-storage')).toHaveLength(8)
  })
})
