/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')

const USER_A = {
  tokenIdentifier: 'https://auth.example.com|user_flag_a',
  name: 'Alice',
  email: 'alice@flag.test',
}

const USER_B = {
  tokenIdentifier: 'https://auth.example.com|user_flag_b',
  name: 'Bob',
  email: 'bob@flag.test',
}

async function seedQuiz(t: any) {
  const folderId = await t.run(async (ctx: any) => {
    return await ctx.db.insert('folders', {
      userId: USER_A.tokenIdentifier,
      name: 'Test Folder',
      documentCount: 0,
    })
  })

  const asUser = t.withIdentity(USER_A)
  const { quizId } = await asUser.mutation(api.quizzes.createWithQuestions, {
    folderId,
    title: 'Flag Test Quiz',
    questions: [
      {
        order: 0,
        question: 'What color is the sky?',
        type: 'multiple-choice',
        options: ['Red', 'Blue', 'Green', 'Yellow'],
        correctAnswer: 'Blue',
        explanation: 'The sky appears blue due to Rayleigh scattering.',
      },
    ],
  })

  const quiz = await asUser.query(api.quizzes.getWithQuestions, { id: quizId })
  return { folderId, quizId, questionId: quiz!.questions[0]!._id }
}

async function seedFlashcard(t: any) {
  const folderId = await t.run(async (ctx: any) => {
    return await ctx.db.insert('folders', {
      userId: USER_A.tokenIdentifier,
      name: 'Test Folder',
      documentCount: 0,
    })
  })

  const roomId = await t.run(async (ctx: any) => {
    return await ctx.db.insert('flashcardRooms', {
      userId: USER_A.tokenIdentifier,
      folderId,
      title: 'Flag Test Room',
      updatedAt: Date.now(),
    })
  })

  const cardId = await t.run(async (ctx: any) => {
    return await ctx.db.insert('flashcardRoomCards', {
      roomId,
      userId: USER_A.tokenIdentifier,
      displayOrder: 0,
      term: 'Photosynthesis',
      definition: 'Wrong definition here',
    })
  })

  return { folderId, roomId, cardId }
}

describe('contentFlags - quiz question flagging', () => {
  test('flags a quiz question with corrected answer', async () => {
    const t = convexTest(schema, modules)
    const { questionId } = await seedQuiz(t)
    const asUser = t.withIdentity(USER_A)

    await asUser.mutation(api.contentFlags.flagQuizQuestion, {
      questionId,
      correctedAnswer: 'Actually Green',
      correctedExplanation: 'The sky is green in this universe.',
    })

    const doc = await t.run(async (ctx: any) => ctx.db.get(questionId))
    expect(doc.flagged).toBe(true)
    expect(doc.correctedAnswer).toBe('Actually Green')
    expect(doc.correctedExplanation).toBe('The sky is green in this universe.')
    expect(doc.flaggedAt).toBeTypeOf('number')
  })

  test('rejects empty corrected answer', async () => {
    const t = convexTest(schema, modules)
    const { questionId } = await seedQuiz(t)
    const asUser = t.withIdentity(USER_A)

    await expect(
      asUser.mutation(api.contentFlags.flagQuizQuestion, {
        questionId,
        correctedAnswer: '   ',
      }),
    ).rejects.toThrow('Corrected answer required')
  })

  test('rejects flagging another user\'s question', async () => {
    const t = convexTest(schema, modules)
    const { questionId } = await seedQuiz(t)
    const asOther = t.withIdentity(USER_B)

    await expect(
      asOther.mutation(api.contentFlags.flagQuizQuestion, {
        questionId,
        correctedAnswer: 'Hijacked',
      }),
    ).rejects.toThrow('Question not found')
  })

  test('unflags a quiz question', async () => {
    const t = convexTest(schema, modules)
    const { questionId } = await seedQuiz(t)
    const asUser = t.withIdentity(USER_A)

    await asUser.mutation(api.contentFlags.flagQuizQuestion, {
      questionId,
      correctedAnswer: 'Corrected',
    })

    await asUser.mutation(api.contentFlags.unflagQuizQuestion, { questionId })

    const doc = await t.run(async (ctx: any) => ctx.db.get(questionId))
    expect(doc.flagged).toBeUndefined()
    expect(doc.correctedAnswer).toBeUndefined()
  })
})

describe('contentFlags - flashcard flagging', () => {
  test('flags a flashcard with corrected definition', async () => {
    const t = convexTest(schema, modules)
    const { cardId } = await seedFlashcard(t)
    const asUser = t.withIdentity(USER_A)

    await asUser.mutation(api.contentFlags.flagFlashcard, {
      cardId,
      correctedDefinition: 'The process by which plants convert light to energy.',
    })

    const doc = await t.run(async (ctx: any) => ctx.db.get(cardId))
    expect(doc.flagged).toBe(true)
    expect(doc.correctedDefinition).toBe('The process by which plants convert light to energy.')
    expect(doc.flaggedAt).toBeTypeOf('number')
  })

  test('rejects empty corrected definition', async () => {
    const t = convexTest(schema, modules)
    const { cardId } = await seedFlashcard(t)
    const asUser = t.withIdentity(USER_A)

    await expect(
      asUser.mutation(api.contentFlags.flagFlashcard, {
        cardId,
        correctedDefinition: '',
      }),
    ).rejects.toThrow('Corrected definition required')
  })

  test('rejects flagging another user\'s card', async () => {
    const t = convexTest(schema, modules)
    const { cardId } = await seedFlashcard(t)
    const asOther = t.withIdentity(USER_B)

    await expect(
      asOther.mutation(api.contentFlags.flagFlashcard, {
        cardId,
        correctedDefinition: 'Hijacked',
      }),
    ).rejects.toThrow('Card not found')
  })

  test('unflags a flashcard', async () => {
    const t = convexTest(schema, modules)
    const { cardId } = await seedFlashcard(t)
    const asUser = t.withIdentity(USER_A)

    await asUser.mutation(api.contentFlags.flagFlashcard, {
      cardId,
      correctedDefinition: 'Corrected def',
    })

    await asUser.mutation(api.contentFlags.unflagFlashcard, { cardId })

    const doc = await t.run(async (ctx: any) => ctx.db.get(cardId))
    expect(doc.flagged).toBeUndefined()
    expect(doc.correctedDefinition).toBeUndefined()
  })
})

describe('contentFlags - flag rate query', () => {
  test('returns null for unauthenticated user', async () => {
    const t = convexTest(schema, modules)
    const courseId = await t.run(async (ctx: any) => {
      const folderId = await ctx.db.insert('folders', {
        userId: USER_A.tokenIdentifier,
        name: 'Auth Test Folder',
        documentCount: 0,
      })
      return await ctx.db.insert('courses', {
        userId: USER_A.tokenIdentifier,
        folderId,
        title: 'Test',
        status: 'ready',
        sourceType: 'web-only',
        sourceConfidence: { docCount: 0, webPercent: 100 },
        pace: 'steady',
        outlineSections: [],
        completedSectionCount: 0,
        totalSectionCount: 0,
        webSearchEnabled: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    })

    const result = await t.query(api.contentFlags.getFlagRateForCourse, { courseId })
    expect(result).toBeNull()
  })

  test('returns zero flag rate for course with no flagged items', async () => {
    const t = convexTest(schema, modules)

    const folderId = await t.run(async (ctx: any) => {
      return await ctx.db.insert('folders', {
        userId: USER_A.tokenIdentifier,
        name: 'Folder',
        documentCount: 0,
      })
    })

    const courseId = await t.run(async (ctx: any) => {
      return await ctx.db.insert('courses', {
        userId: USER_A.tokenIdentifier,
        folderId,
        title: 'Rate Test',
        status: 'ready',
        sourceType: 'folder',
        sourceConfidence: { docCount: 3, webPercent: 0 },
        pace: 'steady',
        outlineSections: [],
        completedSectionCount: 0,
        totalSectionCount: 1,
        webSearchEnabled: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    })

    const asUser = t.withIdentity(USER_A)

    const { quizId } = await asUser.mutation(api.quizzes.createWithQuestions, {
      folderId,
      title: 'Course Quiz',
      courseScoped: true,
      questions: [
        { order: 0, question: 'Q1', type: 'true_false', correctAnswer: 'True' },
        { order: 1, question: 'Q2', type: 'true_false', correctAnswer: 'False' },
      ],
    })

    await t.run(async (ctx: any) => {
      await ctx.db.insert('courseSections', {
        courseId,
        userId: USER_A.tokenIdentifier,
        order: 0,
        title: 'Section 1',
        knowledgeType: 'factual',
        status: 'ready',
        contentBlocks: [
          { type: 'quiz', entityId: quizId, order: 0 },
        ],
        masteryLevel: 'new',
      })
    })

    const result = await asUser.query(api.contentFlags.getFlagRateForCourse, { courseId })
    expect(result).toEqual({ totalItems: 2, flaggedItems: 0, flagRate: 0 })
  })
})
