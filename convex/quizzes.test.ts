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
    expect(attempts[0]!.answers!.every((a) => a.isCorrect)).toBe(true)
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

describe('quizzes.updateQuestion', () => {
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
      t.mutation(api.quizzes.updateQuestion, {
        questionId: questions[0]!._id,
        question: 'New text',
        options: ['A', 'B', 'C', 'D'],
        correctAnswer: 'A',
      }),
    ).rejects.toThrow(/Unauthenticated/)
  })

  test('[P0] rejects when question is owned by another user', async () => {
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
      asB.mutation(api.quizzes.updateQuestion, {
        questionId: questions[0]!._id,
        question: 'Hack',
        options: ['A', 'B', 'C', 'D'],
        correctAnswer: 'A',
      }),
    ).rejects.toThrow(/Question not found/)
  })

  test('[P0] rejects empty question text', async () => {
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
      asUser.mutation(api.quizzes.updateQuestion, {
        questionId: questions[0]!._id,
        question: '   ',
        options: ['A', 'B', 'C', 'D'],
        correctAnswer: 'A',
      }),
    ).rejects.toThrow(/Question text required/)
  })

  test('[P0] rejects MC correct answer not in options', async () => {
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
    const mcQ = questions.find((q) => q.type === 'multiple-choice')!

    await expect(
      asUser.mutation(api.quizzes.updateQuestion, {
        questionId: mcQ._id,
        question: 'What is ATP?',
        options: ['A', 'B', 'C', 'D'],
        correctAnswer: 'Z',
      }),
    ).rejects.toThrow(/Correct answer must match an option/)
  })

  test('[P0] MC persists new options + correct answer; preserves immutable fields', async () => {
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
    const mcQ = questions.find((q) => q.type === 'multiple-choice')!
    const originalSourceFilename = mcQ.sourceFilename
    const originalSourceChunk = mcQ.sourceChunkContent
    const originalOrder = mcQ.order

    await asUser.mutation(api.quizzes.updateQuestion, {
      questionId: mcQ._id,
      question: 'Updated question?',
      options: ['Alpha', 'Beta', 'Gamma'],
      correctAnswer: 'Beta',
    })

    const updated = await t.run(async (ctx) => ctx.db.get(mcQ._id))
    expect(updated!.question).toBe('Updated question?')
    expect(updated!.options).toEqual(['Alpha', 'Beta', 'Gamma'])
    expect(updated!.correctAnswer).toBe('Beta')
    expect(updated!.sourceFilename).toBe(originalSourceFilename)
    expect(updated!.sourceChunkContent).toBe(originalSourceChunk)
    expect(updated!.order).toBe(originalOrder)
    expect(updated!.type).toBe('multiple-choice')
    expect(updated!.quizId).toBe(quizId)
    expect(updated!.userId).toBe(USER_A.tokenIdentifier)
  })

  test('[P0] free-response strips provided options (stored as undefined)', async () => {
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
    const frQ = questions.find((q) => q.type === 'free-response')!

    await asUser.mutation(api.quizzes.updateQuestion, {
      questionId: frQ._id,
      question: 'Describe cellular respiration.',
      options: ['ignored', 'also ignored'],
      correctAnswer: 'Process that converts glucose to ATP.',
    })

    const updated = await t.run(async (ctx) => ctx.db.get(frQ._id))
    expect(updated!.question).toBe('Describe cellular respiration.')
    expect(updated!.correctAnswer).toBe('Process that converts glucose to ATP.')
    expect(updated!.options).toBeUndefined()
  })
})

describe('quizzes.deleteQuiz', () => {
  test('[P0] rejects unauthenticated callers', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Bio' })
    const { quizId } = await asUser.mutation(api.quizzes.createWithQuestions, {
      folderId,
      title: 'Q',
      questions: sampleQuestions(),
    })

    await expect(
      t.mutation(api.quizzes.deleteQuiz, { quizId }),
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

    await expect(
      asB.mutation(api.quizzes.deleteQuiz, { quizId }),
    ).rejects.toThrow(/Quiz not found/)
  })

  test('[P0] removes attempts, questions, and quiz for caller; foreign rows survive', async () => {
    const t = convexTest(schema, modules)
    const asA = t.withIdentity(USER_A)
    const asB = t.withIdentity(USER_B)

    const folderA = await asA.mutation(api.folders.createFolder, { name: 'Bio' })
    const folderB = await asB.mutation(api.folders.createFolder, { name: 'Bio' })

    const { quizId: quizA } = await asA.mutation(api.quizzes.createWithQuestions, {
      folderId: folderA,
      title: 'Alice',
      questions: sampleQuestions(),
    })
    const questionsA = await t.run(async (ctx) =>
      ctx.db.query('quizQuestions').withIndex('by_quizId', (q) => q.eq('quizId', quizA)).collect(),
    )
    const aAttempt = await asA.mutation(api.quizzes.submitAttempt, {
      quizId: quizA,
      answers: [
        { questionId: questionsA[0]!._id, response: 'Energy currency' },
        { questionId: questionsA[1]!._id, response: 'something' },
      ],
    })

    const { quizId: quizB } = await asB.mutation(api.quizzes.createWithQuestions, {
      folderId: folderB,
      title: 'Bob',
      questions: sampleQuestions(),
    })
    const questionsB = await t.run(async (ctx) =>
      ctx.db.query('quizQuestions').withIndex('by_quizId', (q) => q.eq('quizId', quizB)).collect(),
    )
    const bAttempt = await asB.mutation(api.quizzes.submitAttempt, {
      quizId: quizB,
      answers: [
        { questionId: questionsB[0]!._id, response: 'Energy currency' },
        { questionId: questionsB[1]!._id, response: 'bob answer' },
      ],
    })
    const { aAssessmentId, bAssessmentId } = await t.run(async (ctx) => {
      const aAnswerId = await ctx.db.insert('attemptAnswers', { attemptId: aAttempt.attemptId, questionId: questionsA[1]!._id, userAnswer: 'something', isCorrect: false, answeredAt: Date.now() })
      const bAnswerId = await ctx.db.insert('attemptAnswers', { attemptId: bAttempt.attemptId, questionId: questionsB[1]!._id, userAnswer: 'bob answer', isCorrect: false, answeredAt: Date.now() })
      const snapshot = { question: 'Describe mitosis.', questionType: 'free-response' as const, expectedAnswer: 'Cell division', evidenceExcerpt: 'Mitosis divides cells.' }
      const rubricSnapshot: Array<{ label: string, description: string }> = []
      return {
        aAssessmentId: await ctx.db.insert('quizAnswerAssessments', { userId: USER_A.tokenIdentifier, attemptId: aAttempt.attemptId, attemptAnswerId: aAnswerId, questionId: questionsA[1]!._id, kind: 'quiz.free_response_assessment.v1', status: 'pending', questionSnapshot: snapshot, learnerAnswerSnapshot: 'something', deterministicIsCorrect: false, rubricVersion: 'quiz.free_response_assessment.v1', rubricSnapshot, requestedAt: Date.now() }),
        bAssessmentId: await ctx.db.insert('quizAnswerAssessments', { userId: USER_B.tokenIdentifier, attemptId: bAttempt.attemptId, attemptAnswerId: bAnswerId, questionId: questionsB[1]!._id, kind: 'quiz.free_response_assessment.v1', status: 'pending', questionSnapshot: snapshot, learnerAnswerSnapshot: 'bob answer', deterministicIsCorrect: false, rubricVersion: 'quiz.free_response_assessment.v1', rubricSnapshot, requestedAt: Date.now() }),
      }
    })

    const result = await asA.mutation(api.quizzes.deleteQuiz, { quizId: quizA })
    expect(result.deletedAttempts).toBe(1)
    expect(result.deletedQuestions).toBe(2)

    const surviveQuizA = await t.run(async (ctx) => ctx.db.get(quizA))
    expect(surviveQuizA).toBeNull()

    const surviveQuestionsA = await t.run(async (ctx) =>
      ctx.db.query('quizQuestions').withIndex('by_quizId', (q) => q.eq('quizId', quizA)).collect(),
    )
    expect(surviveQuestionsA).toEqual([])

    const surviveAttemptsA = await t.run(async (ctx) =>
      ctx.db.query('quizAttempts').withIndex('by_quizId', (q) => q.eq('quizId', quizA)).collect(),
    )
    expect(surviveAttemptsA).toEqual([])
    expect(await t.run(ctx => ctx.db.get(aAssessmentId))).toBeNull()

    const surviveQuizB = await t.run(async (ctx) => ctx.db.get(quizB))
    expect(surviveQuizB).not.toBeNull()

    const surviveQuestionsB = await t.run(async (ctx) =>
      ctx.db.query('quizQuestions').withIndex('by_quizId', (q) => q.eq('quizId', quizB)).collect(),
    )
    expect(surviveQuestionsB).toHaveLength(2)

    const surviveAttemptsB = await t.run(async (ctx) =>
      ctx.db.query('quizAttempts').withIndex('by_quizId', (q) => q.eq('quizId', quizB)).collect(),
    )
    expect(surviveAttemptsB).toHaveLength(1)
    expect(await t.run(ctx => ctx.db.get(bAssessmentId))).not.toBeNull()
  })
})
