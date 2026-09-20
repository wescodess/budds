/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
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

describe('quizzes.addQuestion', () => {
  test('[P0] rejects insertion when the quiz already has the bounded maximum of 200 questions', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Large quiz' })
    const { quizId } = await asUser.mutation(api.quizzes.createWithQuestions, {
      folderId,
      title: 'At capacity',
      questions: Array.from({ length: 200 }, (_, order) => ({
        order,
        question: `Question ${order}`,
        type: 'free-response' as const,
        correctAnswer: `Answer ${order}`,
      })),
    })

    await expect(asUser.mutation(api.quizzes.addQuestion, {
      quizId,
      type: 'free-response',
      questionText: 'Question 201',
      correctAnswer: 'Answer 201',
    })).rejects.toThrow(/maximum of 200 questions/i)

    const rows = await t.run(ctx => ctx.db.query('quizQuestions').withIndex('by_quizId', q => q.eq('quizId', quizId)).collect())
    expect(rows).toHaveLength(200)
  })
})

describe('quiz creation bounds', () => {
  const oversizedQuestions = () => Array.from({ length: 201 }, (_, order) => ({
    order, question: `Question ${order}`, type: 'free-response' as const, correctAnswer: `Answer ${order}`,
  }))

  test('[P0] rejects oversized user and course-scoped creation before inserting a quiz', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Bounded' })

    await expect(asUser.mutation(api.quizzes.createWithQuestions, {
      folderId, title: 'Too large', questions: oversizedQuestions(),
    })).rejects.toThrow(/cannot exceed 200 questions/i)
    await expect(t.mutation(internal.quizzes.createCourseScopedQuiz, {
      userId: USER_A.tokenIdentifier, folderId, title: 'Too large course quiz', questions: oversizedQuestions(),
    })).rejects.toThrow(/cannot exceed 200 questions/i)

    expect(await t.run(ctx => ctx.db.query('quizzes').withIndex('by_folderId', q => q.eq('folderId', folderId)).collect())).toEqual([])
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

  test('[P0] returns visible quizzes even when newer hidden rows exceed the result window', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Crowded' })
    await t.run(async ctx => {
      for (let index = 0; index < 2; index++) {
        await ctx.db.insert('quizzes', { userId: USER_A.tokenIdentifier, folderId, title: `Visible ${index}`, status: 'ready', courseScoped: false })
      }
      for (let index = 0; index < 110; index++) {
        await ctx.db.insert('quizzes', { userId: USER_A.tokenIdentifier, folderId, title: `Hidden ${index}`, status: 'ready', courseScoped: true })
      }
    })

    const rows = await asUser.query(api.quizzes.listByFolder, { folderId })
    expect(rows.map(row => row.title).sort()).toEqual(['Visible 0', 'Visible 1'])
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

describe('quizzes.startAttempt', () => {
  test('[P0] resumes the newest in-progress attempt after more than 100 historical attempts', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'History' })
    const { quizId } = await asUser.mutation(api.quizzes.createWithQuestions, { folderId, title: 'Long history', questions: sampleQuestions() })
    await t.run(async ctx => {
      for (let index = 0; index < 100; index++) {
        await ctx.db.insert('quizAttempts', { userId: USER_A.tokenIdentifier, quizId, score: 0, total: 2, status: 'completed', completedAt: index })
      }
    })
    const settings = { shuffleQuestions: false, showAllQuestions: false, immediateFeedback: true }
    const started = await asUser.mutation(api.quizzes.startAttempt, { quizId, settings })
    const resumed = await asUser.mutation(api.quizzes.startAttempt, { quizId, settings })

    expect(resumed.status).toBe('resumed')
    expect(resumed.attemptId).toBe(started.attemptId)
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
    expect(attempts[0]!.answers).toBeUndefined()
    const answerRows = await t.run(async ctx => ctx.db
      .query('attemptAnswers').withIndex('by_attemptId', q => q.eq('attemptId', result.attemptId)).collect())
    expect(answerRows).toHaveLength(2)
    expect(answerRows.every(answer => answer.isCorrect)).toBe(true)
    const assessments = await t.run(async ctx => ctx.db
      .query('quizAnswerAssessments').withIndex('by_attemptId', q => q.eq('attemptId', result.attemptId)).collect())
    expect(assessments).toHaveLength(1)
  })

  test('[P0] accepts concise list factors without accepting a different factor', async () => {
    const t = convexTest(schema, modules)
    const asA = t.withIdentity(USER_A)
    const folderId = await asA.mutation(api.folders.createFolder, { name: 'Careers' })
    const { quizId } = await asA.mutation(api.quizzes.createWithQuestions, {
      folderId,
      title: 'Company preferences',
      questions: [
        ...Array.from({ length: 9 }, (_, order) => ({
          order,
          question: 'List two factors you should consider when ranking your preferred companies.',
          type: 'free-response' as const,
          correctAnswer: 'Company culture, job opportunities',
        })),
        {
          order: 9,
          question: 'State whether company culture and salary are equally important.',
          type: 'free-response' as const,
          correctAnswer: 'Company culture, salary',
        },
        {
          order: 10,
          question: 'State two factors you should consider when ranking your preferred companies.',
          type: 'free-response' as const,
          correctAnswer: 'Company culture, job opportunities',
        },
        {
          order: 11,
          question: 'List two factors you should consider.',
          type: 'free-response' as const,
          correctAnswer: 'Company culture, annual pay',
        },
      ],
    })
    const questions = await t.run(ctx => ctx.db
      .query('quizQuestions').withIndex('by_quizId', q => q.eq('quizId', quizId)).collect())

    const result = await asA.mutation(api.quizzes.submitAttempt, {
      quizId,
      answers: [
        { questionId: questions[0]!._id, response: 'culture and opportunities' },
        { questionId: questions[1]!._id, response: 'opportunities & culture' },
        { questionId: questions[2]!._id, response: 'culture and salary' },
        { questionId: questions[3]!._id, response: 'culture and culture' },
        { questionId: questions[4]!._id, response: 'culture, opportunities, salary' },
        { questionId: questions[5]!._id, response: 'no culture and no opportunities' },
        { questionId: questions[6]!._id, response: 'company and opportunities' },
        { questionId: questions[7]!._id, response: 'culture, opportunities, pay' },
        { questionId: questions[8]!._id, response: "isn't culture and isn't opportunities" },
        { questionId: questions[9]!._id, response: 'culture and salary' },
        { questionId: questions[10]!._id, response: 'culture and opportunities' },
        { questionId: questions[11]!._id, response: 'culture and annual' },
      ],
    })

    expect(result.correctCount).toBe(3)
    expect(result.results.map(answer => answer.isCorrect)).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
    ])
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
    expect(aAttempts[0]!.answers).toEqual([
      { questionId: questions[0]!._id, response: 'Energy currency', isCorrect: true },
      { questionId: questions[1]!._id, response: 'x', isCorrect: false },
    ])

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

describe('quizzes incremental and bulk submission convergence', () => {
  test('[P0] includes previously stored correct answers and creates semantic rows for every free-form path', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Bio' })
    const { quizId } = await asUser.mutation(api.quizzes.createWithQuestions, {
      folderId,
      title: 'Mixed submission',
      language: 'en',
      questions: sampleQuestions(),
    })
    const started = await asUser.mutation(api.quizzes.startAttempt, {
      quizId,
      settings: { shuffleQuestions: false, showAllQuestions: false, immediateFeedback: true },
    })
    const mc = started.questions.find(question => question.type === 'multiple-choice')!
    const freeResponse = started.questions.find(question => question.type === 'free-response')!
    await asUser.mutation(api.quizzes.submitAnswer, {
      attemptId: started.attemptId,
      questionId: mc._id,
      userAnswer: mc.correctAnswer,
    })
    const result = await asUser.mutation(api.quizzes.submitAllAnswers, {
      attemptId: started.attemptId,
      answers: [{ questionId: freeResponse._id, userAnswer: freeResponse.correctAnswer }],
    })
    expect(result).toMatchObject({ score: 2, total: 2, percentage: 100 })
    const answers = await t.run(async ctx => ctx.db.query('attemptAnswers')
      .withIndex('by_attemptId', q => q.eq('attemptId', started.attemptId)).collect())
    expect(answers).toHaveLength(2)
    const assessments = await t.run(async ctx => ctx.db.query('quizAnswerAssessments')
      .withIndex('by_attemptId', q => q.eq('attemptId', started.attemptId)).collect())
    expect(assessments).toHaveLength(1)
  })

  test('[P0] excludes previously correct answers whose questions were deleted before bulk completion', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Changing quiz' })
    const { quizId } = await asUser.mutation(api.quizzes.createWithQuestions, { folderId, title: 'Changing', questions: sampleQuestions() })
    const started = await asUser.mutation(api.quizzes.startAttempt, {
      quizId, settings: { shuffleQuestions: false, showAllQuestions: false, immediateFeedback: true },
    })
    const first = started.questions[0]!
    const remaining = started.questions[1]!
    await asUser.mutation(api.quizzes.submitAnswer, { attemptId: started.attemptId, questionId: first._id, userAnswer: first.correctAnswer })
    await asUser.mutation(api.quizzes.deleteQuestion, { questionId: first._id })

    const result = await asUser.mutation(api.quizzes.submitAllAnswers, {
      attemptId: started.attemptId, answers: [{ questionId: remaining._id, userAnswer: 'wrong' }],
    })

    expect(result).toMatchObject({ score: 0, total: 1, percentage: 0 })
  })

  test('[P0] rejects question and attempt mutations after the parent quiz is tombstoned', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Deleting' })
    const { quizId } = await asUser.mutation(api.quizzes.createWithQuestions, { folderId, title: 'Deleting', questions: sampleQuestions() })
    const started = await asUser.mutation(api.quizzes.startAttempt, {
      quizId, settings: { shuffleQuestions: false, showAllQuestions: false, immediateFeedback: true },
    })
    const questionId = started.questions[0]!._id
    await t.run(ctx => ctx.db.patch(quizId, { deletedAt: Date.now() }))

    await expect(asUser.mutation(api.quizzes.updateQuestion, { questionId, question: 'Changed' })).rejects.toThrow(/Quiz not found/)
    await expect(asUser.mutation(api.quizzes.deleteQuestion, { questionId })).rejects.toThrow(/Quiz not found/)
    await expect(asUser.mutation(api.quizzes.submitAnswer, { attemptId: started.attemptId, questionId, userAnswer: 'x' })).rejects.toThrow(/Quiz not found/)
    await expect(asUser.mutation(api.quizzes.submitAllAnswers, { attemptId: started.attemptId, answers: [] })).rejects.toThrow(/Quiz not found/)
    await expect(asUser.mutation(api.quizzes.completeAttempt, { attemptId: started.attemptId })).rejects.toThrow(/Quiz not found/)
    await expect(asUser.mutation(api.quizzes.abandonAttempt, { attemptId: started.attemptId })).rejects.toThrow(/Quiz not found/)
  })
})

describe('quizzes.deleteQuiz', () => {
  test('[P0] drains more questions than one deletion batch', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Large quiz' })
    const { quizId } = await asUser.mutation(api.quizzes.createWithQuestions, {
      folderId,
      title: 'Large quiz',
      questions: Array.from({ length: 120 }, (_, order) => ({
        order,
        question: `Question ${order}`,
        type: 'free-response' as const,
        correctAnswer: `Answer ${order}`,
      })),
    })
    await asUser.mutation(api.quizzes.deleteQuiz, { quizId })
    vi.useFakeTimers()
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    vi.useRealTimers()
    expect(await t.run(ctx => ctx.db.get(quizId))).toBeNull()
    expect(await t.run(ctx => ctx.db.query('quizQuestions').withIndex('by_quizId', q => q.eq('quizId', quizId)).collect())).toEqual([])
  })

  test('[P0] drains answers and assessments across deletion batch boundaries', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Large attempt' })
    const { quizId } = await asUser.mutation(api.quizzes.createWithQuestions, {
      folderId,
      title: 'Large attempt',
      questions: sampleQuestions().slice(0, 1),
    })
    const question = await t.run(ctx => ctx.db
      .query('quizQuestions').withIndex('by_quizId', q => q.eq('quizId', quizId)).first())
    const attemptId = await t.run(ctx => ctx.db.insert('quizAttempts', {
      userId: USER_A.tokenIdentifier,
      quizId,
      score: 0,
      total: 1,
      status: 'completed',
      completedAt: Date.now(),
      startedAt: Date.now(),
    }))
    const assessmentIds = await t.run(async (ctx) => {
      const ids = []
      for (let index = 0; index < 60; index++) {
        const attemptAnswerId = await ctx.db.insert('attemptAnswers', {
          attemptId,
          questionId: question!._id,
          userAnswer: `Answer ${index}`,
          isCorrect: false,
          answeredAt: Date.now(),
        })
        ids.push(await ctx.db.insert('quizAnswerAssessments', {
          userId: USER_A.tokenIdentifier,
          attemptId,
          attemptAnswerId,
          questionId: question!._id,
          kind: 'quiz.free_response_assessment.v1',
          status: 'pending',
          questionSnapshot: {
            question: question!.question,
            questionType: 'free-response',
            expectedAnswer: question!.correctAnswer,
            evidenceExcerpt: 'Evidence',
          },
          learnerAnswerSnapshot: `Answer ${index}`,
          deterministicIsCorrect: false,
          rubricVersion: 'quiz.free_response_assessment.v1',
          rubricSnapshot: [],
          requestedAt: Date.now(),
        }))
      }
      return ids
    })

    expect(await t.run(ctx => ctx.db.query('attemptAnswers').withIndex('by_attemptId', q => q.eq('attemptId', attemptId)).collect())).toHaveLength(60)
    expect(await t.run(ctx => ctx.db.query('quizAnswerAssessments').withIndex('by_attemptId', q => q.eq('attemptId', attemptId)).collect())).toHaveLength(60)

    await asUser.mutation(api.quizzes.deleteQuiz, { quizId })
    vi.useFakeTimers()
    try {
      await t.finishAllScheduledFunctions(vi.runAllTimers)
    }
    finally {
      vi.useRealTimers()
    }

    expect(await t.run(ctx => ctx.db.get(quizId))).toBeNull()
    expect(await t.run(ctx => ctx.db.get(attemptId))).toBeNull()
    expect(await t.run(ctx => ctx.db.query('attemptAnswers').withIndex('by_attemptId', q => q.eq('attemptId', attemptId)).collect())).toEqual([])
    expect(await Promise.all(assessmentIds.map(id => t.run(ctx => ctx.db.get(id))))).toEqual(Array(60).fill(null))
  })

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

  test('[P0] tombstones immediately then drains attempts, questions, and assessments in bounded batches', async () => {
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
    expect(result).toEqual({ tombstoned: true })
    expect(await asA.query(api.quizzes.getWithQuestions, { id: quizA })).toBeNull()

    const tombstonedQuizA = await t.run(async (ctx) => ctx.db.get(quizA))
    expect(tombstonedQuizA?.deletedAt).toEqual(expect.any(Number))

    vi.useFakeTimers()
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    vi.useRealTimers()

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
