/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const identity = { tokenIdentifier: 'https://auth.example.com|rubrics' }
const criteria = [
  { key: 'light_input', description: 'Identifies light as the energy input.', weightPercent: 40 },
  { key: 'chemical_output', description: 'Identifies chemical energy as the output.', weightPercent: 60 },
]
const question = {
  order: 0,
  question: 'What energy conversion occurs in photosynthesis?',
  type: 'free-response' as const,
  correctAnswer: 'Light energy becomes chemical energy.',
  sourceChunkContent: 'Photosynthesis converts light energy into chemical energy.',
  gradingCriteria: criteria,
}
const settings = { shuffleQuestions: false, showAllQuestions: false, immediateFeedback: false }

async function setup() {
  const t = convexTest(schema, modules)
  const user = t.withIdentity(identity)
  const folderId = await user.mutation(api.folders.createFolder, { name: 'Biology' })
  return { t, user, folderId }
}

async function seed() {
  const context = await setup()
  const { quizId } = await context.user.mutation(api.quizzes.createWithQuestions, {
    folderId: context.folderId, title: 'Photosynthesis', questions: [question],
  })
  const row = await context.t.run(ctx => ctx.db.query('quizQuestions').withIndex('by_quizId', q => q.eq('quizId', quizId)).unique())
  return { ...context, quizId, questionId: row!._id }
}

describe('question rubric persistence', () => {
  test('stores valid free-response criteria', async () => {
    const { t, user, folderId } = await setup()
    const { quizId } = await user.mutation(api.quizzes.createWithQuestions, {
      folderId, title: 'Quiz', questions: [question],
    })
    const row = await t.run(ctx => ctx.db.query('quizQuestions').withIndex('by_quizId', q => q.eq('quizId', quizId)).unique())
    expect(row?.gradingCriteria).toEqual(criteria)
  })

  test.each(['multiple-choice', 'true_false', 'fill_in_the_blank'] as const)('stores no criteria for %s, including direct clients', async (type) => {
    const { t, user, folderId } = await setup()
    const { quizId } = await user.mutation(api.quizzes.createWithQuestions, {
      folderId, title: 'Quiz', questions: [{ ...question, type }],
    })
    const row = await t.run(ctx => ctx.db.query('quizQuestions').withIndex('by_quizId', q => q.eq('quizId', quizId)).unique())
    expect(row).not.toHaveProperty('gradingCriteria')
  })

  test.each([
    ['bad weights', [{ ...criteria[0]!, weightPercent: 99 }]],
    ['duplicate keys', [{ ...criteria[0]!, weightPercent: 50 }, { ...criteria[0]!, weightPercent: 50 }]],
    ['too many', Array.from({ length: 5 }, (_, i) => ({ ...criteria[0]!, key: `key_${i}`, weightPercent: 20 }))],
    ['overlong description', [{ ...criteria[0]!, description: 'x'.repeat(301), weightPercent: 100 }]],
  ])('direct mutation cannot persist %s', async (_label, gradingCriteria) => {
    const { t, user, folderId } = await setup()
    const { quizId } = await user.mutation(api.quizzes.createWithQuestions, {
      folderId, title: 'Quiz', questions: [{ ...question, gradingCriteria }],
    })
    const rows = await t.run(ctx => ctx.db.query('quizQuestions').withIndex('by_quizId', q => q.eq('quizId', quizId)).collect())
    expect(rows).toHaveLength(1)
    expect(rows[0]?.question).toBe(question.question)
    expect(rows[0]).not.toHaveProperty('gradingCriteria')
  })

  test('course-scoped generation also revalidates and stores criteria', async () => {
    const { t, user, folderId } = await setup()
    const { courseId } = await user.mutation(api.courses.create, { title: 'Biology course', sourceType: 'web-only', folderId })
    const { quizId } = await user.mutation(internal.quizzes.createCourseScopedQuiz, {
      courseId, userId: identity.tokenIdentifier, folderId, title: 'Course quiz',
      questions: [question, { ...question, order: 1, gradingCriteria: [{ ...criteria[0]!, weightPercent: 1 }] }],
    })
    const rows = await t.run(ctx => ctx.db.query('quizQuestions').withIndex('by_quizId', q => q.eq('quizId', quizId)).collect())
    expect(rows[0]?.gradingCriteria).toEqual(criteria)
    expect(rows[1]).not.toHaveProperty('gradingCriteria')
  })

  test('manual questions use the default criterion', async () => {
    const { t, user, quizId } = await seed()
    const { questionId } = await user.mutation(api.quizzes.addQuestion, {
      quizId, type: 'free-response', questionText: 'New question', correctAnswer: 'New answer',
    })
    expect(await t.run(ctx => ctx.db.get(questionId))).not.toHaveProperty('gradingCriteria')
  })
})

describe('question rubric staleness and privacy', () => {
  test.each([
    { question: 'Describe the energy conversion.' },
    { type: 'fill_in_the_blank' as const },
    { correctAnswer: 'Chemical energy is stored in glucose.' },
  ])('clears criteria after editing %j', async (patch) => {
    const { t, user, questionId } = await seed()
    const response = await user.mutation(api.quizzes.updateQuestion, { questionId, ...patch })
    expect(response).not.toHaveProperty('gradingCriteria')
    expect(await t.run(ctx => ctx.db.get(questionId))).not.toHaveProperty('gradingCriteria')
  })

  test('keeps criteria for explanation-only and unchanged content edits', async () => {
    const { t, user, questionId } = await seed()
    await user.mutation(api.quizzes.updateQuestion, { questionId, explanation: 'A clearer explanation.' })
    expect((await t.run(ctx => ctx.db.get(questionId)))?.gradingCriteria).toEqual(criteria)
    await user.mutation(api.quizzes.updateQuestion, {
      questionId, question: ` ${question.question} `, type: question.type, correctAnswer: question.correctAnswer,
    })
    expect((await t.run(ctx => ctx.db.get(questionId)))?.gradingCriteria).toEqual(criteria)
  })

  test('a corrected answer clears criteria', async () => {
    const { t, user, questionId } = await seed()
    await user.mutation(api.contentFlags.flagQuizQuestion, { questionId, correctedAnswer: 'A corrected answer.' })
    expect(await t.run(ctx => ctx.db.get(questionId))).not.toHaveProperty('gradingCriteria')
  })

  test('learner quiz, attempt, update, and results responses omit criteria', async () => {
    const { user, quizId, questionId } = await seed()
    const quiz = await user.query(api.quizzes.getWithQuestions, { id: quizId })
    const attempt = await user.mutation(api.quizzes.startAttempt, { quizId, settings })
    const resumed = await user.mutation(api.quizzes.startAttempt, { quizId, settings })
    const updated = await user.mutation(api.quizzes.updateQuestion, { questionId, explanation: 'Explanation.' })
    await user.mutation(api.quizzes.submitAllAnswers, { attemptId: attempt.attemptId, answers: [{ questionId, userAnswer: 'Light becomes stored energy.' }] })
    const results = await user.query(api.quizzes.getAttemptResults, { attemptId: attempt.attemptId })
    for (const response of [quiz, attempt, resumed, updated, results]) {
      expect(JSON.stringify(response)).not.toContain('gradingCriteria')
      expect(JSON.stringify(response)).not.toContain('light_input')
    }
  })

  test('editing an answered question leaves the assessment snapshot intact', async () => {
    vi.stubEnv('QUIZ_GRADING_MODE', 'graded')
    try {
      const { t, user, quizId, questionId } = await seed()
      const { attemptId } = await user.mutation(api.quizzes.startAttempt, { quizId, settings })
      await user.mutation(api.quizzes.submitAnswer, { attemptId, questionId, userAnswer: 'Light is stored as chemical energy.' })
      const before = await t.run(ctx => ctx.db.query('quizAnswerAssessments').withIndex('by_attemptId', q => q.eq('attemptId', attemptId)).unique())
      expect(before?.criteriaSnapshot).toEqual(criteria)
      await user.mutation(api.quizzes.updateQuestion, { questionId, correctAnswer: 'A revised reference answer.' })
      const after = await t.run(ctx => ctx.db.get(before!._id))
      expect(after?.criteriaSnapshot).toEqual(criteria)
      expect(after?.questionSnapshot).toEqual(before?.questionSnapshot)
    }
    finally {
      vi.unstubAllEnvs()
    }
  })
})
