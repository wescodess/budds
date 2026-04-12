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

describe('quizzes.submitAttempt', () => {
  test('[P0] rejects unauthenticated callers', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)

    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Bio' })
    const { quizId } = await asUser.mutation(api.quizzes.createWithQuestions, {
      folderId,
      title: 'Q',
      questions: sampleQuestions(),
    })
    const questions = await t.run(async (ctx) =>
      ctx.db.query('quizQuestions').withIndex('by_quizId', (q) => q.eq('quizId', quizId)).collect(),
    )

    await expect(
      t.mutation(api.quizzes.submitAttempt, {
        quizId,
        answers: [{ questionId: questions[0]!._id, response: 'Energy currency' }],
      }),
    ).rejects.toThrow(/Unauthenticated/)
  })

  test('[P0] rejects when quiz is owned by another user', async () => {
    const t = convexTest(schema, modules)
    const asA = t.withIdentity(USER_A)
    const asB = t.withIdentity(USER_B)

    const folderA = await asA.mutation(api.folders.createFolder, { name: 'Bio' })
    const { quizId } = await asA.mutation(api.quizzes.createWithQuestions, {
      folderId: folderA,
      title: 'A',
      questions: sampleQuestions(),
    })
    const questions = await t.run(async (ctx) =>
      ctx.db.query('quizQuestions').withIndex('by_quizId', (q) => q.eq('quizId', quizId)).collect(),
    )

    await expect(
      asB.mutation(api.quizzes.submitAttempt, {
        quizId,
        answers: [{ questionId: questions[0]!._id, response: 'Energy currency' }],
      }),
    ).rejects.toThrow(/Quiz not found/)
  })

  test('[P0] rejects when a questionId belongs to a different quiz owned by the caller', async () => {
    const t = convexTest(schema, modules)
    const asA = t.withIdentity(USER_A)

    const folderA = await asA.mutation(api.folders.createFolder, { name: 'Bio' })
    const { quizId: q1 } = await asA.mutation(api.quizzes.createWithQuestions, {
      folderId: folderA,
      title: 'One',
      questions: sampleQuestions(),
    })
    const { quizId: q2 } = await asA.mutation(api.quizzes.createWithQuestions, {
      folderId: folderA,
      title: 'Two',
      questions: sampleQuestions(),
    })
    const q2Questions = await t.run(async (ctx) =>
      ctx.db.query('quizQuestions').withIndex('by_quizId', (q) => q.eq('quizId', q2)).collect(),
    )

    await expect(
      asA.mutation(api.quizzes.submitAttempt, {
        quizId: q1,
        answers: [{ questionId: q2Questions[0]!._id, response: 'anything' }],
      }),
    ).rejects.toThrow(/Invalid question/)
  })

  test('[P0] persists attempt with correct isCorrect flags (MC + free-response case-insensitive)', async () => {
    const t = convexTest(schema, modules)
    const asA = t.withIdentity(USER_A)

    const folderA = await asA.mutation(api.folders.createFolder, { name: 'Bio' })
    const { quizId } = await asA.mutation(api.quizzes.createWithQuestions, {
      folderId: folderA,
      title: 'Test',
      questions: sampleQuestions(),
    })
    const questions = await t.run(async (ctx) =>
      ctx.db.query('quizQuestions').withIndex('by_quizId', (q) => q.eq('quizId', quizId)).collect(),
    )
    const mcQ = questions.find((q) => q.type === 'multiple-choice')!
    const frQ = questions.find((q) => q.type === 'free-response')!

    const result = await asA.mutation(api.quizzes.submitAttempt, {
      quizId,
      answers: [
        { questionId: mcQ._id, response: 'Energy currency' },
        { questionId: frQ._id, response: '  CELL  Division into two identical daughter cells.  ' },
      ],
    })

    expect(result.correctCount).toBe(2)
    expect(result.total).toBe(2)

    const attempts = await t.run(async (ctx) =>
      ctx.db.query('quizAttempts').withIndex('by_quizId', (q) => q.eq('quizId', quizId)).collect(),
    )
    expect(attempts).toHaveLength(1)
    expect(attempts[0]!.answers.every((a) => a.isCorrect)).toBe(true)
  })

  test('[P0] updates parent quizzes.score as rounded percentage + completedAt', async () => {
    const t = convexTest(schema, modules)
    const asA = t.withIdentity(USER_A)

    const folderA = await asA.mutation(api.folders.createFolder, { name: 'Bio' })
    const { quizId } = await asA.mutation(api.quizzes.createWithQuestions, {
      folderId: folderA,
      title: 'Half',
      questions: sampleQuestions(),
    })
    const questions = await t.run(async (ctx) =>
      ctx.db.query('quizQuestions').withIndex('by_quizId', (q) => q.eq('quizId', quizId)).collect(),
    )
    const mcQ = questions.find((q) => q.type === 'multiple-choice')!
    const frQ = questions.find((q) => q.type === 'free-response')!

    await asA.mutation(api.quizzes.submitAttempt, {
      quizId,
      answers: [
        { questionId: mcQ._id, response: 'Energy currency' },
        { questionId: frQ._id, response: 'wrong' },
      ],
    })

    const list = await asA.query(api.quizzes.listByFolder, { folderId: folderA })
    expect(list[0]!.score).toBe(50)
    expect(list[0]!.completedAt).toBeGreaterThan(0)
  })

  test('[P1] most-recent attempt wins for the parent quizzes.score (multiple attempts)', async () => {
    const t = convexTest(schema, modules)
    const asA = t.withIdentity(USER_A)

    const folderA = await asA.mutation(api.folders.createFolder, { name: 'Bio' })
    const { quizId } = await asA.mutation(api.quizzes.createWithQuestions, {
      folderId: folderA,
      title: 'Retake',
      questions: sampleQuestions(),
    })
    const questions = await t.run(async (ctx) =>
      ctx.db.query('quizQuestions').withIndex('by_quizId', (q) => q.eq('quizId', quizId)).collect(),
    )
    const mcQ = questions.find((q) => q.type === 'multiple-choice')!
    const frQ = questions.find((q) => q.type === 'free-response')!

    await asA.mutation(api.quizzes.submitAttempt, {
      quizId,
      answers: [
        { questionId: mcQ._id, response: 'A protein' },
        { questionId: frQ._id, response: 'wrong' },
      ],
    })
    await asA.mutation(api.quizzes.submitAttempt, {
      quizId,
      answers: [
        { questionId: mcQ._id, response: 'Energy currency' },
        { questionId: frQ._id, response: 'Cell division into two identical daughter cells.' },
      ],
    })

    const list = await asA.query(api.quizzes.listByFolder, { folderId: folderA })
    expect(list[0]!.score).toBe(100)

    const attempts = await asA.query(api.quizzes.listAttempts, { quizId })
    expect(attempts).toHaveLength(2)
  })
})

describe('quizzes.listAttempts', () => {
  test('[P0] returns caller attempts ordered desc by completedAt; foreign-user attempts are invisible', async () => {
    const t = convexTest(schema, modules)
    const asA = t.withIdentity(USER_A)
    const asB = t.withIdentity(USER_B)

    const folderA = await asA.mutation(api.folders.createFolder, { name: 'Bio' })
    const { quizId } = await asA.mutation(api.quizzes.createWithQuestions, {
      folderId: folderA,
      title: 'Shared',
      questions: sampleQuestions(),
    })
    const questions = await t.run(async (ctx) =>
      ctx.db.query('quizQuestions').withIndex('by_quizId', (q) => q.eq('quizId', quizId)).collect(),
    )

    await asA.mutation(api.quizzes.submitAttempt, {
      quizId,
      answers: [
        { questionId: questions[0]!._id, response: 'Energy currency' },
        { questionId: questions[1]!._id, response: 'x' },
      ],
    })

    const aAttempts = await asA.query(api.quizzes.listAttempts, { quizId })
    expect(aAttempts).toHaveLength(1)

    const bView = await asB.query(api.quizzes.listAttempts, { quizId })
    expect(bView).toEqual([])
  })
})
