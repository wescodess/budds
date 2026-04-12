/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'
import { backoffMs } from './accountDeletion'

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
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    process.env = originalEnv
    vi.unstubAllGlobals()
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

    await asUser.mutation(internal.accountDeletion.deleteAccountCascade, {})

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

    await asUserA.mutation(internal.accountDeletion.deleteAccountCascade, {})

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

    await asUser.mutation(internal.accountDeletion.deleteAccountCascade, {})

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
    expect(aiBulk.length).toBe(1)
    for (const r of rows) expect(r.attempts).toBe(0)
  })

  test('[P0] should reject unauthenticated caller', async () => {
    const t = convexTest(schema, modules)
    await expect(
      t.mutation(internal.accountDeletion.deleteAccountCascade, {}),
    ).rejects.toThrow()
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

    await asUser.mutation(internal.accountDeletion.deleteAccountCascade, {})

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

    await asUserA.mutation(internal.accountDeletion.deleteAccountCascade, {})

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

  test('[P1] post-cascade queries return empty for the caller', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(TEST_IDENTITY)

    const { folderId, convoId } = await seedUserData(t, asUser, TEST_IDENTITY)

    await asUser.mutation(internal.accountDeletion.deleteAccountCascade, {})

    expect(await asUser.query(api.folders.listAllFolders, {})).toEqual([])
    expect(await asUser.query(api.conversations.listRecentForUser, {})).toEqual([])
    expect(await asUser.query(api.documents.listDocumentsByFolder, { folderId })).toEqual([])
    // getConversation returns null for deleted row
    const g = await asUser.query(api.conversations.getConversation, { id: convoId })
    expect(g).toBeNull()
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

  test('[P0] should remove pendingCleanup row when external call returns 404', { timeout: 30_000 }, async () => {
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
    expect(rows.length).toBe(0)
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

  test('[P1] should skip rows already at MAX_ATTEMPTS', async () => {
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
    fetchFn.mockImplementation(async () => new Response('', { status: 200 }))

    await t.action(internal.accountDeletion.drainPendingCleanup, { userId })

    const row = await t.run(async (ctx) => ctx.db.get(rowId))
    expect(row?.attempts).toBe(10)
    expect(fetchFn).not.toHaveBeenCalled()
  })
})
