/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import { api } from './_generated/api'
import type { Id } from './_generated/dataModel'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')

const USER_A = {
  tokenIdentifier: 'https://auth.example.com|user_aaa',
  name: 'Alice',
  email: 'alice@example.com',
}

const USER_B = {
  tokenIdentifier: 'https://auth.example.com|user_bbb',
  name: 'Bob',
  email: 'bob@example.com',
}

async function seedUser(
  t: ReturnType<typeof convexTest>,
  identity: typeof USER_A,
) {
  const asUser = t.withIdentity(identity)
  const folderId = await asUser.mutation(api.folders.createFolder, { name: `Folder for ${identity.name}` })

  const storageId = await t.run(async (ctx) => {
    return await ctx.storage.store(new Blob(['pdf-bytes'], { type: 'application/pdf' }))
  })

  const docId = await t.run(async (ctx) => {
    return await ctx.db.insert('documents', {
      userId: identity.tokenIdentifier,
      folderId,
      filename: `${identity.name}-file.pdf`,
      fileId: storageId,
      status: 'success',
      fileSize: 1024,
    })
  })

  const convoId = await asUser.mutation(api.conversations.createConversation, {
    folderId,
    title: `${identity.name} convo`,
  })

  await asUser.mutation(api.messages.appendMessage, {
    conversationId: convoId,
    role: 'user',
    content: `Hi from ${identity.name}`,
  })

  return { folderId, docId, convoId, asUser }
}

const TEST_EXPORT_COLLECTIONS = [
  'folders',
  'documents',
  'conversations',
  'messages',
  'quizzes',
  'quizQuestions',
  'quizAttempts',
  'flashcardSets',
  'flashcards',
  'flashcardRooms',
  'flashcardRoomCards',
  'flashcardRoomVersions',
  'flashcardVersionCards',
  'tasks',
  'reviewItems',
  'reviewSessions',
  'calendarConnections',
  'calendarEvents',
  'audioOverviews',
  'audioOverviewJobs',
] as const

type TestClient = ReturnType<ReturnType<typeof convexTest>['withIdentity']>
type TestExportCollection = typeof TEST_EXPORT_COLLECTIONS[number]
type ExportRow = Record<string, unknown>
type ExportPage = {
  page: ExportRow[]
  isDone: boolean
  continueCursor: string
}
type TestUserDataExport = {
  userId: string
  user: { name: string, email?: string } | null
  attemptAnswers: ExportRow[]
} & Record<TestExportCollection, ExportRow[]>

async function readAllPages(
  asUser: TestClient,
  collection: TestExportCollection,
): Promise<ExportRow[]> {
  const rows: ExportRow[] = []
  let cursor: string | null = null

  while (true) {
    // An explicit structural type prevents TypeScript from recursively expanding
    // every collection-specific branch of this polymorphic FunctionReference.
    const result: ExportPage = await asUser.query(api.dataExport.getUserDataPage, {
      collection,
      paginationOpts: { cursor, numItems: 1 },
    })
    rows.push(...result.page)
    if (result.isDone) return rows
    cursor = result.continueCursor
  }
}

async function collectUserDataForTest(asUser: TestClient): Promise<TestUserDataExport> {
  const metadata = await asUser.query(api.dataExport.getExportMetadata, {})
  const collections = {} as Record<TestExportCollection, ExportRow[]>

  for (const collection of TEST_EXPORT_COLLECTIONS) {
    collections[collection] = await readAllPages(asUser, collection)
  }

  const attemptAnswers: ExportRow[] = []
  for (const attempt of collections.quizAttempts ?? []) {
    let cursor: string | null = null
    while (true) {
      const result: ExportPage | null = await asUser.query(api.dataExport.getAttemptAnswersPage, {
        attemptId: attempt._id as Id<'quizAttempts'>,
        paginationOpts: { cursor, numItems: 1 },
      })
      if (!result) break
      attemptAnswers.push(...result.page)
      if (result.isDone) break
      cursor = result.continueCursor
    }
  }

  return { ...metadata, ...collections, attemptAnswers }
}

describe('dataExport paginated queries', () => {
  test('caps each page at 8 rows and advances across multiple cursors', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)

    await t.run(async (ctx) => {
      for (let index = 0; index < 17; index++) {
        await ctx.db.insert('tasks', {
          userId: USER_A.tokenIdentifier,
          type: 'export-pagination-test',
          status: 'complete',
          title: `Task ${index}`,
          createdAt: index,
          updatedAt: index,
        })
      }
      await ctx.db.insert('tasks', {
        userId: USER_B.tokenIdentifier,
        type: 'export-pagination-test',
        status: 'complete',
        title: 'Other user task',
        createdAt: 0,
        updatedAt: 0,
      })
    })

    const first = await asUser.query(api.dataExport.getUserDataPage, {
      collection: 'tasks',
      paginationOpts: { cursor: null, numItems: 1_000 },
    })
    expect(first.page).toHaveLength(8)
    expect(first.isDone).toBe(false)
    expect(first.page.every(row => row.userId === USER_A.tokenIdentifier)).toBe(true)

    const second = await asUser.query(api.dataExport.getUserDataPage, {
      collection: 'tasks',
      paginationOpts: { cursor: first.continueCursor, numItems: 1_000 },
    })
    expect(second.page).toHaveLength(8)
    expect(second.isDone).toBe(false)
    expect(second.page.every(row => row.userId === USER_A.tokenIdentifier)).toBe(true)

    const third = await asUser.query(api.dataExport.getUserDataPage, {
      collection: 'tasks',
      paginationOpts: { cursor: second.continueCursor, numItems: 1_000 },
    })
    expect(third.page).toHaveLength(1)
    expect(third.isDone).toBe(true)
    expect(third.page.every(row => row.userId === USER_A.tokenIdentifier)).toBe(true)
  })

  test('returns only the authenticated user rows', async () => {
    const t = convexTest(schema, modules)

    const a = await seedUser(t, USER_A)
    await seedUser(t, USER_B)

    const result = await collectUserDataForTest(a.asUser)

    expect(result.userId).toBe(USER_A.tokenIdentifier)
    expect(result.folders.every((f: any) => f.userId === USER_A.tokenIdentifier)).toBe(true)
    expect(result.documents.every((d: any) => d.userId === USER_A.tokenIdentifier)).toBe(true)
    expect(result.conversations.every((c: any) => c.userId === USER_A.tokenIdentifier)).toBe(true)
    expect(result.messages.every((m: any) => m.userId === USER_A.tokenIdentifier)).toBe(true)

    expect(result.folders.length).toBe(1)
    expect(result.documents.length).toBe(1)
    expect(result.conversations.length).toBe(1)
    expect(result.messages.length).toBe(1)
  })

  test('throws Unauthenticated when no identity is attached', async () => {
    const t = convexTest(schema, modules)
    await expect(t.query(api.dataExport.getExportMetadata, {})).rejects.toThrow(/Unauthenticated/)
    await expect(t.query(api.dataExport.getUserDataPage, {
      collection: 'documents',
      paginationOpts: { cursor: null, numItems: 10 },
    })).rejects.toThrow(/Unauthenticated/)
  })

  test('does not expose child pages through another user parent id', async () => {
    const t = convexTest(schema, modules)
    const a = await seedUser(t, USER_A)
    const b = await seedUser(t, USER_B)

    const questions = [{
      order: 0,
      question: 'Q1',
      type: 'free-response' as const,
      correctAnswer: 'A1',
      sourceChunkContent: 'c1',
      sourceFilename: 'f.pdf',
    }]
    const quiz = await a.asUser.mutation(api.quizzes.createWithQuestions, {
      folderId: a.folderId,
      title: 'Private quiz',
      questions,
    })
    const question = await t.run(async ctx => await ctx.db
      .query('quizQuestions')
      .withIndex('by_quizId', q => q.eq('quizId', quiz.quizId))
      .unique())
    const attempt = await a.asUser.mutation(api.quizzes.submitAttempt, {
      quizId: quiz.quizId,
      answers: [{ questionId: question!._id, response: 'A1' }],
    })

    expect(await b.asUser.query(api.dataExport.getAttemptAnswersPage, {
      attemptId: attempt.attemptId,
      paginationOpts: { cursor: null, numItems: 10 },
    })).toBeNull()

    const course = await a.asUser.mutation(api.courses.create, {
      folderId: a.folderId,
      title: 'Private course',
      sourceType: 'folder',
      documentIds: [],
    })
    expect(await b.asUser.query(api.dataExport.getCourseSourceDocsPage, {
      courseId: course.courseId,
      paginationOpts: { cursor: null, numItems: 10 },
    })).toBeNull()
  })

  test('returns empty arrays for a user with no data', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)

    const result = await collectUserDataForTest(asUser)

    expect(result.folders).toEqual([])
    expect(result.documents).toEqual([])
    expect(result.conversations).toEqual([])
    expect(result.messages).toEqual([])
    expect(result.quizzes).toEqual([])
    expect(result.quizQuestions).toEqual([])
    expect(result.quizAttempts).toEqual([])
    expect(result.attemptAnswers).toEqual([])
    expect(result.flashcardSets).toEqual([])
    expect(result.flashcards).toEqual([])
    expect(result.flashcardRooms).toEqual([])
    expect(result.flashcardRoomCards).toEqual([])
    expect(result.flashcardRoomVersions).toEqual([])
    expect(result.flashcardVersionCards).toEqual([])
    expect(result.tasks).toEqual([])
    expect(result.reviewItems).toEqual([])
    expect(result.reviewSessions).toEqual([])
    expect(result.calendarConnections).toEqual([])
    expect(result.calendarEvents).toEqual([])
    expect(result.audioOverviews).toEqual([])
    expect(result.audioOverviewJobs).toEqual([])
  })

  test('returns flashcardRooms + roomCards scoped to the caller', async () => {
    const t = convexTest(schema, modules)
    const a = await seedUser(t, USER_A)
    const b = await seedUser(t, USER_B)

    const { roomId: aRoom } = await a.asUser.mutation(api.flashcardRooms.createRoom, {
      folderId: a.folderId,
      title: 'Alice Room',
    })
    await a.asUser.mutation(api.flashcardRooms.createCard, { roomId: aRoom, term: 'F1', definition: 'B1' })
    await a.asUser.mutation(api.flashcardRooms.createCard, { roomId: aRoom, term: 'F2', definition: 'B2' })

    const { roomId: bRoom } = await b.asUser.mutation(api.flashcardRooms.createRoom, {
      folderId: b.folderId,
      title: 'Bob Room',
    })
    await b.asUser.mutation(api.flashcardRooms.createCard, { roomId: bRoom, term: 'F1', definition: 'B1' })

    const result = await collectUserDataForTest(a.asUser)

    expect(result.flashcardRooms).toHaveLength(1)
    expect(result.flashcardRooms[0]!.title).toBe('Alice Room')
    expect(result.flashcardRoomCards).toHaveLength(2)
    expect(result.flashcardRoomCards.every((c: any) => c.userId === USER_A.tokenIdentifier)).toBe(true)
  })

  test('returns quizzes + quizQuestions scoped to the caller', async () => {
    const t = convexTest(schema, modules)
    const a = await seedUser(t, USER_A)
    const b = await seedUser(t, USER_B)

    const questions = [
      {
        order: 0,
        question: 'Q1',
        type: 'free-response' as const,
        correctAnswer: 'A1',
        sourceChunkContent: 'c1',
        sourceFilename: 'f.pdf',
      },
      {
        order: 1,
        question: 'Q2',
        type: 'free-response' as const,
        correctAnswer: 'A2',
        sourceChunkContent: 'c2',
        sourceFilename: 'f.pdf',
      },
    ]

    await a.asUser.mutation(api.quizzes.createWithQuestions, {
      folderId: a.folderId,
      title: 'Alice Quiz',
      questions,
    })
    await b.asUser.mutation(api.quizzes.createWithQuestions, {
      folderId: b.folderId,
      title: 'Bob Quiz',
      questions,
    })

    const result = await collectUserDataForTest(a.asUser)

    expect(result.quizzes).toHaveLength(1)
    expect(result.quizzes[0]!.title).toBe('Alice Quiz')
    expect(result.quizzes.every((q: any) => q.userId === USER_A.tokenIdentifier)).toBe(true)
    expect(result.quizQuestions).toHaveLength(2)
    expect(result.quizQuestions.every((q: any) => q.userId === USER_A.tokenIdentifier)).toBe(true)
  })

  test('returns quizAttempts scoped to the caller (Story 6.2)', async () => {
    const t = convexTest(schema, modules)
    const a = await seedUser(t, USER_A)
    const b = await seedUser(t, USER_B)

    const questions = [
      {
        order: 0,
        question: 'Q1',
        type: 'free-response' as const,
        correctAnswer: 'A1',
        sourceChunkContent: 'c1',
        sourceFilename: 'f.pdf',
      },
    ]

    const aQuiz = await a.asUser.mutation(api.quizzes.createWithQuestions, {
      folderId: a.folderId,
      title: 'A',
      questions,
    })
    const bQuiz = await b.asUser.mutation(api.quizzes.createWithQuestions, {
      folderId: b.folderId,
      title: 'B',
      questions,
    })

    const aQs = await t.run(async (ctx) =>
      ctx.db.query('quizQuestions').withIndex('by_quizId', (q) => q.eq('quizId', aQuiz.quizId)).collect(),
    )
    const bQs = await t.run(async (ctx) =>
      ctx.db.query('quizQuestions').withIndex('by_quizId', (q) => q.eq('quizId', bQuiz.quizId)).collect(),
    )

    const aAttempt = await a.asUser.mutation(api.quizzes.submitAttempt, {
      quizId: aQuiz.quizId,
      answers: [{ questionId: aQs[0]!._id, response: 'A1' }],
    })
    const bAttempt = await b.asUser.mutation(api.quizzes.submitAttempt, {
      quizId: bQuiz.quizId,
      answers: [{ questionId: bQs[0]!._id, response: 'A1' }],
    })
    await t.run(async (ctx) => {
      await ctx.db.insert('attemptAnswers', {
        attemptId: aAttempt.attemptId,
        questionId: aQs[0]!._id,
        userAnswer: 'A1',
        isCorrect: true,
        answeredAt: Date.now(),
      })
      await ctx.db.insert('attemptAnswers', {
        attemptId: bAttempt.attemptId,
        questionId: bQs[0]!._id,
        userAnswer: 'A1',
        isCorrect: true,
        answeredAt: Date.now(),
      })
    })

    const result = await collectUserDataForTest(a.asUser)

    expect(result.quizAttempts).toHaveLength(1)
    expect(result.quizAttempts.every((a: any) => a.userId === USER_A.tokenIdentifier)).toBe(true)
    expect(result.attemptAnswers).toHaveLength(1)
    expect(result.attemptAnswers[0]!.attemptId).toBe(aAttempt.attemptId)
  })

  test('exports calendar metadata for the caller without OAuth credentials', async () => {
    const t = convexTest(schema, modules)
    const a = await seedUser(t, USER_A)
    const b = await seedUser(t, USER_B)

    await a.asUser.mutation(api.calendarConnections.upsertConnection, {
      provider: 'google',
      accessToken: 'alice-access-token',
      refreshToken: 'alice-refresh-token',
      expiresAt: Date.now() + 3_600_000,
      timezone: 'America/Toronto',
    })
    await b.asUser.mutation(api.calendarConnections.upsertConnection, {
      provider: 'google',
      accessToken: 'bob-access-token',
      refreshToken: 'bob-refresh-token',
      expiresAt: Date.now() + 3_600_000,
      timezone: 'Europe/London',
    })

    const result = await collectUserDataForTest(a.asUser)
    expect(result.calendarConnections).toHaveLength(1)
    expect(result.calendarConnections[0]).toMatchObject({
      userId: USER_A.tokenIdentifier,
      provider: 'google',
      timezone: 'America/Toronto',
    })
    expect(result.calendarConnections[0]).not.toHaveProperty('accessToken')
    expect(result.calendarConnections[0]).not.toHaveProperty('refreshToken')
  })

  test('returns flashcardRooms + roomCards + versions + versionCards scoped to the caller', async () => {
    const t = convexTest(schema, modules)
    const a = await seedUser(t, USER_A)
    const b = await seedUser(t, USER_B)

    const { roomId } = await a.asUser.mutation(api.flashcardRooms.createRoom, {
      folderId: a.folderId,
      title: 'Alice Room',
    })
    await a.asUser.mutation(api.flashcardRooms.generateRoomCards, {
      roomId,
      origin: 'ai',
      title: 'Gen',
      cards: [
        { term: 'T1', definition: 'D1', metadata: { source: { filename: 'f.pdf', chunkContent: 'c' } } },
      ],
    })

    const { roomId: bRoom } = await b.asUser.mutation(api.flashcardRooms.createRoom, {
      folderId: b.folderId,
      title: 'Bob Room',
    })
    await b.asUser.mutation(api.flashcardRooms.createCard, {
      roomId: bRoom, term: 'BT', definition: 'BD',
    })

    const result = await collectUserDataForTest(a.asUser)
    expect(result.flashcardRooms).toHaveLength(1)
    expect(result.flashcardRoomCards).toHaveLength(1)
    expect(result.flashcardRoomVersions).toHaveLength(1)
    expect(result.flashcardVersionCards).toHaveLength(1)
    expect(result.flashcardRooms[0]!.title).toBe('Alice Room')
  })

  test('returned rows contain expected fields', async () => {
    const t = convexTest(schema, modules)
    const a = await seedUser(t, USER_A)

    const result = await collectUserDataForTest(a.asUser)

    const doc = result.documents[0]!
    expect(doc).toHaveProperty('filename')
    expect(doc).toHaveProperty('fileId')
    expect(doc).toHaveProperty('status')

    const folder = result.folders[0]!
    expect(folder).toHaveProperty('name')

    const convo = result.conversations[0]!
    expect(convo).toHaveProperty('title')

    const msg = result.messages[0]!
    expect(msg).toHaveProperty('role')
    expect(msg).toHaveProperty('content')
  })
})

describe('dataExport.getDocumentDownloadUrl', () => {
  test('returns a URL for the owner of the document', async () => {
    const t = convexTest(schema, modules)
    const a = await seedUser(t, USER_A)

    const result = await a.asUser.query(api.dataExport.getDocumentDownloadUrl, {
      documentId: a.docId,
    })

    expect(result).not.toBeNull()
    expect(result!.filename).toBe('Alice-file.pdf')
    expect(typeof result!.url === 'string' || result!.url === null).toBe(true)
  })

  test('returns null for a document owned by another user', async () => {
    const t = convexTest(schema, modules)
    const a = await seedUser(t, USER_A)
    const bAsUser = t.withIdentity(USER_B)

    const result = await bAsUser.query(api.dataExport.getDocumentDownloadUrl, {
      documentId: a.docId,
    })

    expect(result).toBeNull()
  })

  test('throws Unauthenticated without an identity', async () => {
    const t = convexTest(schema, modules)
    const a = await seedUser(t, USER_A)

    await expect(
      t.query(api.dataExport.getDocumentDownloadUrl, { documentId: a.docId }),
    ).rejects.toThrow(/Unauthenticated/)
  })
})
