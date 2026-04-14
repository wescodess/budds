/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import { api } from './_generated/api'
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

describe('dataExport.collectUserData', () => {
  test('returns only the authenticated user rows', async () => {
    const t = convexTest(schema, modules)

    const a = await seedUser(t, USER_A)
    await seedUser(t, USER_B)

    const result = await a.asUser.query(api.dataExport.collectUserData, {})

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
    await expect(t.query(api.dataExport.collectUserData, {})).rejects.toThrow(/Unauthenticated/)
  })

  test('returns empty arrays for a user with no data', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)

    const result = await asUser.query(api.dataExport.collectUserData, {})

    expect(result.folders).toEqual([])
    expect(result.documents).toEqual([])
    expect(result.conversations).toEqual([])
    expect(result.messages).toEqual([])
    expect(result.quizzes).toEqual([])
    expect(result.quizQuestions).toEqual([])
    expect(result.quizAttempts).toEqual([])
    expect(result.flashcardSets).toEqual([])
    expect(result.flashcards).toEqual([])
  })

  test('returns flashcardSets + flashcards scoped to the caller (Story 7.1)', async () => {
    const t = convexTest(schema, modules)
    const a = await seedUser(t, USER_A)
    const b = await seedUser(t, USER_B)

    const cards = [
      { order: 0, front: 'F1', back: 'B1', sourceChunkContent: 'c1', sourceFilename: 'f.pdf' },
      { order: 1, front: 'F2', back: 'B2', sourceChunkContent: 'c2', sourceFilename: 'f.pdf' },
    ]

    await a.asUser.mutation(api.flashcards.createSetWithCards, {
      folderId: a.folderId,
      title: 'Alice Set',
      cards,
    })
    await b.asUser.mutation(api.flashcards.createSetWithCards, {
      folderId: b.folderId,
      title: 'Bob Set',
      cards,
    })

    const result = await a.asUser.query(api.dataExport.collectUserData, {})

    expect(result.flashcardSets).toHaveLength(1)
    expect(result.flashcardSets[0]!.title).toBe('Alice Set')
    expect(result.flashcardSets.every((s: any) => s.userId === USER_A.tokenIdentifier)).toBe(true)
    expect(result.flashcards).toHaveLength(2)
    expect(result.flashcards.every((c: any) => c.userId === USER_A.tokenIdentifier)).toBe(true)
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

    const result = await a.asUser.query(api.dataExport.collectUserData, {})

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

    await a.asUser.mutation(api.quizzes.submitAttempt, {
      quizId: aQuiz.quizId,
      answers: [{ questionId: aQs[0]!._id, response: 'A1' }],
    })
    await b.asUser.mutation(api.quizzes.submitAttempt, {
      quizId: bQuiz.quizId,
      answers: [{ questionId: bQs[0]!._id, response: 'A1' }],
    })

    const result = await a.asUser.query(api.dataExport.collectUserData, {})

    expect(result.quizAttempts).toHaveLength(1)
    expect(result.quizAttempts.every((a: any) => a.userId === USER_A.tokenIdentifier)).toBe(true)
  })

  test('returned rows contain expected fields', async () => {
    const t = convexTest(schema, modules)
    const a = await seedUser(t, USER_A)

    const result = await a.asUser.query(api.dataExport.collectUserData, {})

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
