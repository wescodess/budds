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

function sampleQuestions() {
  return [
    {
      order: 0,
      question: 'What is ATP?',
      type: 'multiple-choice' as const,
      options: ['Energy currency', 'A protein', 'A sugar', 'A hormone'],
      correctAnswer: 'Energy currency',
      sourceChunkContent: 'ATP stores chemical energy.',
      sourceFilename: 'bio.pdf',
    },
    {
      order: 1,
      question: 'Describe mitosis.',
      type: 'free-response' as const,
      correctAnswer: 'Cell division into two identical daughter cells.',
      sourceChunkContent: 'Mitosis is the process of cell division.',
      sourceFilename: 'bio.pdf',
    },
  ]
}

describe('quizzes.createWithQuestions', () => {
  test('[P0] rejects calls with no identity', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Bio' })

    await expect(
      t.mutation(api.quizzes.createWithQuestions, {
        folderId,
        title: 'Quiz',
        questions: sampleQuestions(),
      }),
    ).rejects.toThrow(/Unauthenticated/)
  })

  test('[P0] rejects when folder is owned by another user', async () => {
    const t = convexTest(schema, modules)
    const asUserA = t.withIdentity(USER_A)
    const asUserB = t.withIdentity(USER_B)

    const folderId = await asUserA.mutation(api.folders.createFolder, { name: 'Alice Private' })

    await expect(
      asUserB.mutation(api.quizzes.createWithQuestions, {
        folderId,
        title: 'Sneaky',
        questions: sampleQuestions(),
      }),
    ).rejects.toThrow(/Folder not found/)
  })

  test('[P0] persists quiz + questions with correct userId mirror and quizId', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Bio' })

    const { quizId } = await asUser.mutation(api.quizzes.createWithQuestions, {
      folderId,
      title: 'Cell Bio',
      model: 'openai/gpt-4o-mini',
      questions: sampleQuestions(),
    })

    const quizRow = await t.run(async (ctx) => ctx.db.get(quizId))
    expect(quizRow?.userId).toBe(USER_A.tokenIdentifier)
    expect(quizRow?.title).toBe('Cell Bio')
    expect(quizRow?.status).toBe('ready')
    expect(quizRow?.model).toBe('openai/gpt-4o-mini')

    const questions = await t.run(async (ctx) =>
      ctx.db.query('quizQuestions').withIndex('by_quizId', (q) => q.eq('quizId', quizId)).collect(),
    )
    expect(questions).toHaveLength(2)
    for (const q of questions) {
      expect(q.userId).toBe(USER_A.tokenIdentifier)
      expect(q.quizId).toBe(quizId)
    }
  })

  test('[P1] drops sourceDocumentId when it does not belong to caller', async () => {
    const t = convexTest(schema, modules)
    const asUserA = t.withIdentity(USER_A)
    const asUserB = t.withIdentity(USER_B)

    const folderB = await asUserB.mutation(api.folders.createFolder, { name: 'Bob Folder' })
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(['pdf'], { type: 'application/pdf' })),
    )
    const bobDocId = await t.run(async (ctx) =>
      ctx.db.insert('documents', {
        userId: USER_B.tokenIdentifier,
        folderId: folderB,
        filename: 'bob.pdf',
        fileId: storageId,
        status: 'success',
        fileSize: 100,
      }),
    )

    const folderA = await asUserA.mutation(api.folders.createFolder, { name: 'Alice Folder' })
    const [q0] = sampleQuestions()
    const { quizId } = await asUserA.mutation(api.quizzes.createWithQuestions, {
      folderId: folderA,
      title: 'Q',
      questions: [
        { ...q0!, sourceDocumentId: String(bobDocId) },
      ],
    })

    const stored = await t.run(async (ctx) =>
      ctx.db.query('quizQuestions').withIndex('by_quizId', (q) => q.eq('quizId', quizId)).collect(),
    )
    expect(stored[0]!.sourceDocumentId).toBeUndefined()
  })
})

describe('quizzes.listByFolder', () => {
  test('[P0] returns only caller\'s quizzes for that folder', async () => {
    const t = convexTest(schema, modules)
    const asUserA = t.withIdentity(USER_A)
    const asUserB = t.withIdentity(USER_B)

    const folderA = await asUserA.mutation(api.folders.createFolder, { name: 'Bio' })
    const folderB = await asUserB.mutation(api.folders.createFolder, { name: 'Bio' })

    await asUserA.mutation(api.quizzes.createWithQuestions, {
      folderId: folderA,
      title: 'Alice quiz',
      questions: sampleQuestions(),
    })
    await asUserB.mutation(api.quizzes.createWithQuestions, {
      folderId: folderB,
      title: 'Bob quiz',
      questions: sampleQuestions(),
    })

    const aList = await asUserA.query(api.quizzes.listByFolder, { folderId: folderA })
    expect(aList).toHaveLength(1)
    expect(aList[0]!.title).toBe('Alice quiz')
    expect(aList[0]!.questionCount).toBe(2)

    const aTryingB = await asUserA.query(api.quizzes.listByFolder, { folderId: folderB })
    expect(aTryingB).toEqual([])
  })
})

describe('quizzes.getWithQuestions', () => {
  test('[P0] returns null when quiz is owned by another user', async () => {
    const t = convexTest(schema, modules)
    const asUserA = t.withIdentity(USER_A)
    const asUserB = t.withIdentity(USER_B)

    const folderA = await asUserA.mutation(api.folders.createFolder, { name: 'Bio' })
    const { quizId } = await asUserA.mutation(api.quizzes.createWithQuestions, {
      folderId: folderA,
      title: 'Secret',
      questions: sampleQuestions(),
    })

    const bView = await asUserB.query(api.quizzes.getWithQuestions, { id: quizId })
    expect(bView).toBeNull()
  })

  test('[P0] returns quiz + ordered questions for the owner', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)

    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Bio' })
    const { quizId } = await asUser.mutation(api.quizzes.createWithQuestions, {
      folderId,
      title: 'Ordered',
      questions: sampleQuestions(),
    })

    const result = await asUser.query(api.quizzes.getWithQuestions, { id: quizId })
    expect(result).not.toBeNull()
    expect(result!.quiz.title).toBe('Ordered')
    expect(result!.questions).toHaveLength(2)
    expect(result!.questions[0]!.order).toBe(0)
    expect(result!.questions[1]!.order).toBe(1)
  })
})
