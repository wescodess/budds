/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import type { FunctionArgs, FunctionReturnType } from 'convex/server'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api } from './_generated/api'
import { createPendingAnswerAssessment } from './lib/quizAnswerAssessment'
import schema from './schema'
import manifest from '../workers/laya-evaluator/learningDecisionManifest.json'
import { QUIZ_RUBRIC_GRADE_VERSION, defaultQuizGradingCriteria } from '../shared/quiz-grading'

const modules = import.meta.glob('./**/*.ts')
const USER = { tokenIdentifier: 'https://auth.example.com|quiz_grading', name: 'Alice' }
const settings = { shuffleQuestions: false, showAllQuestions: false, immediateFeedback: true }
const paths = ['completeAttempt', 'submitAllAnswers', 'submitAttempt'] as const
const NOW = 1_000_000
const rubric = [
  { key: 'daughter_cells', description: 'Two daughter cells', weightPercent: 40 },
  { key: 'identical', description: 'Genetically identical', weightPercent: 60 },
]

beforeEach(() => {
  vi.stubEnv('QUIZ_GRADING_MODE', undefined)
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

function expectNoRubricData(value: unknown) {
  if (Array.isArray(value)) {
    for (const item of value) expectNoRubricData(item)
  }
  else if (value && typeof value === 'object') {
    for (const field of ['criteria', 'gradingCriteria', 'criteriaSnapshot', 'criterionResults', 'key', 'description', 'weightPercent', 'verdict']) {
      expect(value).not.toHaveProperty(field)
    }
    for (const item of Object.values(value)) expectNoRubricData(item)
  }
}

async function createQuiz() {
  const t = convexTest(schema, modules)
  const user = t.withIdentity(USER)
  const folderId = await user.mutation(api.folders.createFolder, { name: 'Biology' })
  const { quizId } = await user.mutation(api.quizzes.createWithQuestions, {
    folderId, title: 'Grading contract', language: 'en',
    questions: ([
      { order: 0, question: 'What does mitosis produce?', type: 'free-response', correctAnswer: 'Two identical daughter cells' },
      { order: 1, question: 'Cell division is called ___.', type: 'fill_in_the_blank', correctAnswer: 'mitosis' },
      { order: 2, question: 'What happens before mitosis?', type: 'free-response', correctAnswer: 'DNA is copied' },
      { order: 3, question: 'Pick A', type: 'multiple-choice', options: ['A', 'B'], correctAnswer: 'A' },
      { order: 4, question: 'Cells divide.', type: 'true_false', options: ['True', 'False'], correctAnswer: 'True' },
    ] satisfies FunctionArgs<typeof api.quizzes.createWithQuestions>['questions']).map(question => ({ ...question, explanation: 'Original explanation', sourceChunkContent: 'Original evidence', sourceFilename: 'biology.pdf' })),
  })
  const { questions } = (await user.query(api.quizzes.getWithQuestions, { id: quizId }))!
  await t.run(ctx => ctx.db.patch(questions[0]!._id, { gradingCriteria: rubric }))
  return { t, user, quizId, questions }
}

async function finish(fixture: Awaited<ReturnType<typeof createQuiz>>, path: typeof paths[number], settled = false) {
  const { user, quizId, questions } = fixture
  const responses = ['  TWO identical\n daughter cells ', ' \n\t', settled ? 'DNA is copied' : 'The genetic material is duplicated', 'A', 'True']
  const answers = questions.map((question, index) => ({ questionId: question._id, userAnswer: responses[index]! }))
  const submissions = new Map<string, FunctionReturnType<typeof api.quizzes.submitAnswer>>()
  let bulk: FunctionReturnType<typeof api.quizzes.submitAllAnswers> | undefined
  if (path === 'submitAttempt') {
    const { attemptId } = await user.mutation(api.quizzes.submitAttempt, {
      quizId, answers: answers.map(answer => ({ questionId: answer.questionId, response: answer.userAnswer })),
    })
    return { attemptId, submissions, bulk }
  }
  const { attemptId } = await user.mutation(api.quizzes.startAttempt, { quizId, settings })
  if (path === 'completeAttempt') {
    for (const answer of answers) submissions.set(answer.questionId, await user.mutation(api.quizzes.submitAnswer, { attemptId, ...answer }))
    await user.mutation(api.quizzes.completeAttempt, { attemptId })
  }
  else {
    const existing = answers[2]!
    submissions.set(existing.questionId, await user.mutation(api.quizzes.submitAnswer, { attemptId, ...existing }))
    bulk = await user.mutation(api.quizzes.submitAllAnswers, { attemptId, answers })
  }
  return { attemptId, submissions, bulk }
}

describe('flag-off compatibility', () => {
  test.each(paths)('%s preserves the existing rows, scores and result shape', async (path) => {
    const fixture = await createQuiz()
    const { t, user, quizId, questions } = fixture
    const { attemptId, submissions, bulk } = await finish(fixture, path)
    const answers = await t.run(ctx => ctx.db.query('attemptAnswers').withIndex('by_attemptId', q => q.eq('attemptId', attemptId)).collect())
    const rows = await t.run(ctx => ctx.db.query('quizAnswerAssessments').withIndex('by_attemptId', q => q.eq('attemptId', attemptId)).collect())
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      const question = questions.find(question => question._id === row.questionId)!
      const answer = answers.find(answer => answer._id === row.attemptAnswerId)!
      expect(row).toStrictEqual({
        _id: row._id, _creationTime: row._creationTime,
        userId: USER.tokenIdentifier, attemptId, attemptAnswerId: answer._id, questionId: question._id,
        kind: 'quiz.free_response_assessment.v1', contractVersion: manifest.contractVersion, snapshotVersion: manifest.snapshotVersion,
        languageSnapshot: 'en', status: 'pending',
        questionSnapshot: {
          question: question.question, questionType: question.type, expectedAnswer: question.correctAnswer,
          evidenceExcerpt: 'Original evidence', sourceFilename: 'biology.pdf', explanation: 'Original explanation',
        },
        learnerAnswerSnapshot: answer.userAnswer, deterministicIsCorrect: answer.isCorrect,
        rubricVersion: 'quiz.free_response_assessment.v1', rubricSnapshot: manifest.decisionKinds.freeResponse.rubric,
        attemptCount: 0, nextAttemptAt: NOW, requestedAt: NOW,
      })
    }
    const attempt = await t.run(ctx => ctx.db.get(attemptId))
    expect(attempt).not.toHaveProperty('gradingStatus')
    expect(attempt).not.toHaveProperty('gradingNeedsAttention')
    const history = await user.query(api.quizzes.getQuizHistory, { quizId })
    expect(history.find(entry => entry._id === attemptId)).not.toHaveProperty('gradingNeedsAttention')
    if (bulk) expect(bulk).not.toHaveProperty('gradingPending')
    for (const submission of submissions.values()) expect(submission).not.toHaveProperty('gradingPending')
    const results = await user.query(api.quizzes.getAttemptResults, { attemptId })
    const expected = {
      attemptId, quizId, quizTitle: 'Grading contract', score: 3, total: 5, percentage: 60,
      startedAt: attempt!.startedAt ?? attempt!._creationTime, completedAt: NOW, status: 'completed',
      results: answers.map(answer => {
        const question = questions.find(question => question._id === answer.questionId)!
        const row = rows.find(row => row.attemptAnswerId === answer._id)
        return {
          questionId: question._id, questionText: question.question, questionType: question.type, options: question.options,
          userAnswer: answer.userAnswer, isCorrect: answer.isCorrect, correctAnswer: question.correctAnswer,
          explanation: question.explanation, feedback: undefined,
          semanticAssessment: row ? {
            status: 'pending', label: undefined, confidence: undefined, probabilities: undefined, unavailableReason: undefined,
            retryable: undefined, retryDueAt: NOW, attemptCount: 0, rubricVersion: 'quiz.free_response_assessment.v1', deterministicScoreUnchanged: true,
          } : undefined,
        }
      }),
    }
    expect(results).toStrictEqual(JSON.parse(JSON.stringify(expected)))
  })

  test.each([undefined, '', 'off', 'shadow', 'true', 'Graded', 'graded '])('only the exact graded flag enables grading: %s', async (mode) => {
    vi.stubEnv('QUIZ_GRADING_MODE', mode)
    const { t, user, quizId, questions } = await createQuiz()
    const { attemptId } = await user.mutation(api.quizzes.startAttempt, { quizId, settings })
    const result = await user.mutation(api.quizzes.submitAnswer, { attemptId, questionId: questions[0]!._id, userAnswer: questions[0]!.correctAnswer })
    const row = await t.run(ctx => ctx.db.query('quizAnswerAssessments').withIndex('by_attemptId', q => q.eq('attemptId', attemptId)).unique())
    expect(row).toMatchObject({ rubricVersion: 'quiz.free_response_assessment.v1', status: 'pending' })
    expect(result).not.toHaveProperty('gradingPending')
  })
})

describe('rubric assessment creation and completion', () => {
  test.each(paths)('%s commits exact and empty answers and leaves other answers pending', async (path) => {
    vi.stubEnv('QUIZ_GRADING_MODE', 'graded')
    const fixture = await createQuiz()
    const { t, user, quizId, questions } = fixture
    const { attemptId, submissions, bulk } = await finish(fixture, path)
    const rows = await t.run(ctx => ctx.db.query('quizAnswerAssessments').withIndex('by_attemptId', q => q.eq('attemptId', attemptId)).collect())
    expect(rows).toHaveLength(3)
    const exact = rows.find(row => row.questionId === questions[0]!._id)!
    const empty = rows.find(row => row.questionId === questions[1]!._id)!
    const pending = rows.find(row => row.questionId === questions[2]!._id)!
    expect(rows.every(row => row.rubricVersion === QUIZ_RUBRIC_GRADE_VERSION)).toBe(true)
    expect(exact).toMatchObject({ status: 'available', criteriaSnapshot: rubric, credit: 1, label: 'fully_correct', gradeSource: 'deterministic', completedAt: NOW,
      criterionResults: rubric.map(criterion => ({ key: criterion.key, verdict: 'met' })) })
    expect(empty).toMatchObject({ status: 'available', criteriaSnapshot: defaultQuizGradingCriteria('mitosis'), credit: 0, label: 'incorrect', gradeSource: 'deterministic', completedAt: NOW,
      criterionResults: [{ key: 'reference_answer', verdict: 'not_met' }] })
    expect(pending).toMatchObject({ status: 'pending', criteriaSnapshot: defaultQuizGradingCriteria('DNA is copied'), attemptCount: 0, nextAttemptAt: NOW })
    expect(pending).not.toHaveProperty('credit')
    expect(pending).not.toHaveProperty('gradeSource')
    expect(exact).not.toHaveProperty('nextAttemptAt')
    expect(empty).not.toHaveProperty('nextAttemptAt')
    expect(await t.run(ctx => ctx.db.get(attemptId))).toMatchObject({ status: 'completed', gradingStatus: 'grading', gradingNeedsAttention: false, score: 3, total: 5 })
    expect(await t.run(ctx => ctx.db.get(quizId))).toMatchObject({ score: 60 })
    if (bulk) expect(bulk.gradingPending).toBe(true)
    for (const [questionId, submission] of submissions) {
      expect(submission.gradingPending).toBe(questionId === questions[2]!._id)
    }
    const results = await user.query(api.quizzes.getAttemptResults, { attemptId })
    expect(results?.grading).toEqual({ pending: 1, needsReview: 0, unavailable: 0 })
    expect(results?.results.find(result => result.questionId === exact.questionId)?.grade).toStrictEqual({ status: 'graded', credit: 1, label: 'fully_correct', source: 'deterministic' })
    expect(results?.results.find(result => result.questionId === empty.questionId)?.grade).toMatchObject({ status: 'graded', credit: 0, label: 'incorrect', source: 'deterministic' })
    expect(results?.results.find(result => result.questionId === pending.questionId)?.grade).toMatchObject({ status: 'pending' })
    expect(results?.results.every(result => result.semanticAssessment === undefined)).toBe(true)
    expectNoRubricData(results)
    for (const submission of submissions.values()) expectNoRubricData(submission)
    if (bulk) expectNoRubricData(bulk)
    expect(await t.run(ctx => ctx.db.system.query('_scheduled_functions').collect())).toMatchObject([
      { name: 'quizGrading:gradeAttempt', args: [{ attemptId }] },
    ])
  })

  test.each(paths)('%s settles when every rubric row has a deterministic result', async (path) => {
    vi.stubEnv('QUIZ_GRADING_MODE', 'graded')
    const fixture = await createQuiz()
    const { attemptId, bulk } = await finish(fixture, path, true)
    expect(await fixture.t.run(ctx => ctx.db.get(attemptId))).toMatchObject({ gradingStatus: 'settled', gradingNeedsAttention: false, score: 4 })
    expect((await fixture.user.query(api.quizzes.getAttemptResults, { attemptId }))?.grading).toEqual({ pending: 0, needsReview: 0, unavailable: 0 })
    if (bulk) expect(bulk.gradingPending).toBe(false)
  })

  test('retains snapshots and returns the existing assessment for duplicate submissions, including a flag change', async () => {
    vi.stubEnv('QUIZ_GRADING_MODE', 'graded')
    const { t, user, quizId, questions } = await createQuiz()
    const question = (await t.run(ctx => ctx.db.get(questions[0]!._id)))!
    const { attemptId } = await user.mutation(api.quizzes.startAttempt, { quizId, settings })
    const input = { attemptId, questionId: question._id, userAnswer: 'A pair of matching cells' }
    expect((await user.mutation(api.quizzes.submitAnswer, input)).gradingPending).toBe(true)
    const original = (await t.run(ctx => ctx.db.query('quizAnswerAssessments').withIndex('by_attemptId', q => q.eq('attemptId', attemptId)).unique()))!
    vi.stubEnv('QUIZ_GRADING_MODE', 'off')
    await t.run(ctx => ctx.db.patch(question._id, { gradingCriteria: [{ key: 'replacement', description: 'Changed rubric', weightPercent: 100 }], correctAnswer: 'Changed answer' }))
    const duplicate = await user.mutation(api.quizzes.submitAnswer, { ...input, userAnswer: 'Changed answer' })
    expect(duplicate).toMatchObject({ alreadyAnswered: true, gradingPending: true, isCorrect: false })
    expect(await t.run(ctx => createPendingAnswerAssessment(ctx, {
      userId: USER.tokenIdentifier, attemptId, attemptAnswerId: original.attemptAnswerId, question,
      learnerAnswer: 'Changed answer', deterministicIsCorrect: true,
    }))).toBe(original._id)
    expect(await t.run(ctx => ctx.db.query('quizAnswerAssessments').withIndex('by_attemptId', q => q.eq('attemptId', attemptId)).collect())).toEqual([original])
    await user.mutation(api.quizzes.completeAttempt, { attemptId })
    const results = await user.query(api.quizzes.getAttemptResults, { attemptId })
    expect(results?.grading).toEqual({ pending: 1, needsReview: 0, unavailable: 0 })
    expect(results?.results[0]).toMatchObject({ correctAnswer: question.correctAnswer, userAnswer: input.userAnswer, grade: { status: 'pending' } })
    expectNoRubricData(results)
    expect(await t.run(ctx => ctx.db.get(attemptId))).toMatchObject({ gradingStatus: 'grading' })
  })

  test('keeps explicit-list answers deterministic in both modes', async () => {
    const { t, user, quizId, questions } = await createQuiz()
    const questionId = questions[0]!._id
    await t.run(ctx => ctx.db.patch(questionId, { question: 'Name two influences.', correctAnswer: 'cultures and opportunities' }))
    for (const mode of ['off', 'graded']) {
      vi.stubEnv('QUIZ_GRADING_MODE', mode)
      const { attemptId } = await user.mutation(api.quizzes.startAttempt, { quizId, settings, restart: true })
      const result = await user.mutation(api.quizzes.submitAnswer, { attemptId, questionId, userAnswer: 'opportunities & cultures' })
      expect(result.isCorrect).toBe(true)
      if (mode === 'graded') {
        expect(result.gradingPending).toBe(false)
        const rows = await t.run(ctx => ctx.db.query('quizAnswerAssessments').withIndex('by_attemptId', q => q.eq('attemptId', attemptId)).collect())
        expect(rows).toHaveLength(1)
        expect(rows[0]).toMatchObject({ status: 'available', gradeSource: 'deterministic', credit: 1, label: 'fully_correct' })
        expect(rows.filter(row => row.status === 'pending')).toEqual([])
        await user.mutation(api.quizzes.completeAttempt, { attemptId })
        expect(await t.run(ctx => ctx.db.get(attemptId))).toMatchObject({ gradingStatus: 'settled', score: 1 })
      }
    }
  })

  test.each(paths)('%s falls back to the default rubric without rejecting answers', async (path) => {
    vi.stubEnv('QUIZ_GRADING_MODE', 'graded')
    const fixture = await createQuiz()
    const { t, questions } = fixture
    await t.run(async (ctx) => {
      for (const question of questions.slice(0, 3)) await ctx.db.patch(question._id, { gradingCriteria: [{ ...rubric[0]!, weightPercent: 99 }] })
    })
    const { attemptId } = await finish(fixture, path)
    const rows = await t.run(ctx => ctx.db.query('quizAnswerAssessments').withIndex('by_attemptId', q => q.eq('attemptId', attemptId)).collect())
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      const question = questions.find(question => question._id === row.questionId)!
      expect(row.criteriaSnapshot).toEqual(defaultQuizGradingCriteria(question.correctAnswer))
      expect(row.status).toBe(question.order === 2 ? 'pending' : 'available')
    }
    expect(await t.run(ctx => ctx.db.query('attemptAnswers').withIndex('by_attemptId', q => q.eq('attemptId', attemptId)).collect())).toHaveLength(5)
  })
})

test('projects seeded partial, review and unavailable grades after the flag is disabled', async () => {
  vi.stubEnv('QUIZ_GRADING_MODE', 'graded')
  const fixture = await createQuiz()
  const { t, user, questions } = fixture
  const { attemptId } = await finish(fixture, 'completeAttempt')
  const rows = await t.run(ctx => ctx.db.query('quizAnswerAssessments').withIndex('by_attemptId', q => q.eq('attemptId', attemptId)).collect())
  await t.run(async (ctx) => {
    const partial = rows.find(row => row.questionId === questions[0]!._id)!
    const review = rows.find(row => row.questionId === questions[1]!._id)!
    const unavailable = rows.find(row => row.questionId === questions[2]!._id)!
    await ctx.db.patch(partial._id, { credit: 0.5, label: 'partially_correct', gradeSource: 'self', selfAssessedAt: NOW,
      criterionResults: [{ key: 'identical', verdict: 'not_met' }, { key: 'daughter_cells', verdict: 'met' }], feedback: 'One of two criteria met.' })
    await ctx.db.patch(review._id, { label: 'uncertain', credit: 0.4, gradeSource: 'model', criteriaSnapshot: rubric,
      criterionResults: [{ key: 'daughter_cells', verdict: 'met' }, { key: 'identical', verdict: 'uncertain' }], feedback: 'More details needed.' })
    await ctx.db.patch(unavailable._id, { status: 'unavailable', unavailableReason: 'over_budget', retryable: false })
  })
  vi.stubEnv('QUIZ_GRADING_MODE', 'off')
  const results = await user.query(api.quizzes.getAttemptResults, { attemptId })
  expect(results?.grading).toEqual({ pending: 0, needsReview: 1, unavailable: 1 })
  const partial = results?.results.find(result => result.questionId === questions[0]!._id)?.grade
  expect(partial).toStrictEqual({ status: 'graded', credit: 0.5, label: 'partially_correct', source: 'self', feedback: 'One of two criteria met.' })
  const review = results?.results.find(result => result.questionId === questions[1]!._id)?.grade
  expect(review).toStrictEqual({ status: 'needs_review', credit: 0.4, label: 'uncertain', source: 'model', feedback: 'More details needed.' })
  const unavailable = results?.results.find(result => result.questionId === questions[2]!._id)?.grade
  expect(unavailable).toMatchObject({ status: 'unavailable' })
  expect(unavailable?.credit).toBeUndefined()
  expect(unavailable?.label).toBeUndefined()
  expectNoRubricData(results)
})

test.each(['off', 'graded'])('keeps criteria internal in question and study responses when %s', async (mode) => {
  vi.stubEnv('QUIZ_GRADING_MODE', mode)
  const { t, user, quizId, questions } = await createQuiz()
  const questionId = questions[0]!._id
  expectNoRubricData(await user.query(api.quizzes.getWithQuestions, { id: quizId }))
  const started = await user.mutation(api.quizzes.startAttempt, { quizId, settings })
  expectNoRubricData(started)
  expectNoRubricData(await user.mutation(api.quizzes.updateQuestion, { questionId, explanation: 'Updated explanation' }))
  const submission = await user.mutation(api.quizzes.submitAnswer, { attemptId: started.attemptId, questionId, userAnswer: 'A paraphrase' })
  expectNoRubricData(submission)
  expectNoRubricData(await user.mutation(api.quizzes.startAttempt, { quizId, settings }))
  expectNoRubricData(await user.mutation(api.quizzes.submitAllAnswers, { attemptId: started.attemptId, answers: [] }))
  const result = await user.query(api.quizzes.getAttemptResults, { attemptId: started.attemptId })
  expectNoRubricData(result)
  expect((await t.run(ctx => ctx.db.get(questionId)))?.gradingCriteria).toEqual(rubric)
})

test('exports complete question criteria, assessment snapshots and criterion verdicts', async () => {
  vi.stubEnv('QUIZ_GRADING_MODE', 'graded')
  const { t, user, quizId, questions } = await createQuiz()
  const questionId = questions[0]!._id
  const { attemptId } = await user.mutation(api.quizzes.startAttempt, { quizId, settings })
  await user.mutation(api.quizzes.submitAnswer, { attemptId, questionId, userAnswer: questions[0]!.correctAnswer })
  const question = await t.run(ctx => ctx.db.get(questionId))
  const row = (await t.run(ctx => ctx.db.query('quizAnswerAssessments').withIndex('by_attemptId', q => q.eq('attemptId', attemptId)).unique()))!
  const paginationOpts = { cursor: null, numItems: 8 }
  const exportedQuestions = await user.query(api.dataExport.getUserDataPage, { collection: 'quizQuestions', paginationOpts })
  const exportedQuestion = exportedQuestions.page.find(row => row._id === questionId)
  expect(exportedQuestion).toStrictEqual(question)
  expect(exportedQuestion).toMatchObject({ gradingCriteria: rubric })
  const exported = await user.query(api.dataExport.getUserDataPage, { collection: 'quizAnswerAssessments', paginationOpts })
  expect(exported.page).toStrictEqual([row])
  expect(exported.page[0]).toMatchObject({
    criteriaSnapshot: rubric,
    criterionResults: rubric.map(criterion => ({ key: criterion.key, verdict: 'met' })),
    rubricSnapshot: manifest.decisionKinds.freeResponse.rubric,
  })
})

test('stores verdicts without per-criterion feedback', async () => {
  vi.stubEnv('QUIZ_GRADING_MODE', 'graded')
  const { t, user, quizId, questions } = await createQuiz()
  const { attemptId } = await user.mutation(api.quizzes.startAttempt, { quizId, settings })
  await user.mutation(api.quizzes.submitAnswer, { attemptId, questionId: questions[0]!._id, userAnswer: questions[0]!.correctAnswer })
  const row = (await t.run(ctx => ctx.db.query('quizAnswerAssessments').withIndex('by_attemptId', q => q.eq('attemptId', attemptId)).unique()))!
  const criterion = { key: rubric[0]!.key, verdict: 'met' as const, feedback: 'Per-criterion feedback is not part of the contract.' }
  await expect(t.run(ctx => ctx.db.patch(row._id, { criterionResults: [criterion] }))).rejects.toThrow(/feedback/)
})

test('enabling grading preserves legacy assessment rows and embedded historical answers', async () => {
  const { t, user, quizId, questions } = await createQuiz()
  const { attemptId } = await user.mutation(api.quizzes.startAttempt, { quizId, settings })
  await user.mutation(api.quizzes.submitAnswer, { attemptId, questionId: questions[0]!._id, userAnswer: 'A paraphrase' })
  const original = (await t.run(ctx => ctx.db.query('quizAnswerAssessments').withIndex('by_attemptId', q => q.eq('attemptId', attemptId)).unique()))!
  const historicalId = await t.run(ctx => ctx.db.insert('quizAttempts', {
    userId: USER.tokenIdentifier, quizId, score: 1, total: 1, completedAt: NOW,
    answers: [{ questionId: questions[0]!._id, response: 'Historical answer', isCorrect: true }],
  }))
  const historicalResults = await user.query(api.quizzes.getAttemptResults, { attemptId: historicalId })
  vi.stubEnv('QUIZ_GRADING_MODE', 'graded')
  await user.mutation(api.quizzes.submitAnswer, { attemptId, questionId: questions[0]!._id, userAnswer: 'Different response' })
  expect(await t.run(ctx => ctx.db.get(original._id))).toEqual(original)
  await user.mutation(api.quizzes.completeAttempt, { attemptId })
  const results = await user.query(api.quizzes.getAttemptResults, { attemptId })
  expect(results).not.toHaveProperty('grading')
  expect(results?.results[0]).not.toHaveProperty('grade')
  expect(results?.results[0]?.semanticAssessment).toMatchObject({ status: 'pending', rubricVersion: 'quiz.free_response_assessment.v1' })
  expect(await user.query(api.quizzes.getAttemptResults, { attemptId: historicalId })).toEqual(historicalResults)
})

test('Laya and shadow never list, claim or record rubric rows, even in mixed batches with matching claims', async () => {
  vi.stubEnv('QUIZ_GRADING_MODE', 'graded')
  vi.stubEnv('QUIZ_ASSESSMENT_WRITE_SECRET', 'test-assessment-write-secret-long-enough')
  const { t, user, quizId, questions } = await createQuiz()
  const { attemptId } = await user.mutation(api.quizzes.startAttempt, { quizId, settings })
  await user.mutation(api.quizzes.submitAnswer, { attemptId, questionId: questions[2]!._id, userAnswer: 'A paraphrase' })
  vi.stubEnv('QUIZ_GRADING_MODE', 'off')
  await user.mutation(api.quizzes.submitAnswer, { attemptId, questionId: questions[0]!._id, userAnswer: 'Another paraphrase' })
  await user.mutation(api.quizzes.completeAttempt, { attemptId })
  const rows = await t.run(ctx => ctx.db.query('quizAnswerAssessments').withIndex('by_attemptId', q => q.eq('attemptId', attemptId)).collect())
  const rubricRow = rows.find(row => row.rubricVersion === QUIZ_RUBRIC_GRADE_VERSION)!
  const legacyRow = rows.find(row => row.rubricVersion !== QUIZ_RUBRIC_GRADE_VERSION)!
  for (const query of [api.quizAnswerAssessments.listPendingForAttempt, api.quizAnswerAssessments.listPendingForShadowAttempt]) {
    expect((await user.query(query, { attemptId })).map(row => row.assessmentId)).toEqual([legacyRow._id])
  }
  const inputDigest = 'a'.repeat(64)
  const claimId = 'matching-claim'
  for (const claim of [api.quizAnswerAssessments.claimBatch, api.quizAnswerAssessments.claimShadowBatch]) {
    expect(await user.mutation(claim, { attemptId, assessmentIds: [rubricRow._id], inputDigest, claimId })).toEqual([])
    expect(await user.mutation(claim, { attemptId, assessmentIds: [legacyRow._id, rubricRow._id], inputDigest, claimId })).toEqual([])
  }
  expect(await t.run(ctx => ctx.db.get(rubricRow._id))).toEqual(rubricRow)
  expect(await t.run(ctx => ctx.db.get(legacyRow._id))).toEqual(legacyRow)
  await t.run(async (ctx) => {
    for (const row of rows) await ctx.db.patch(row._id, { inputDigest, claimId, shadowInputDigest: inputDigest, shadowClaimId: claimId })
  })
  const before = await t.run(ctx => ctx.db.query('quizAnswerAssessments').withIndex('by_attemptId', q => q.eq('attemptId', attemptId)).collect())
  const assessmentIds = [legacyRow._id, rubricRow._id]
  const common = { attemptId, evaluatorSecret: 'test-assessment-write-secret-long-enough' }
  const available = { ...common, provider: 'laya', modelRevision: 'test', results: assessmentIds.map(assessmentId => ({ assessmentId, inputDigest, claimId, label: 'fully_correct' as const, confidence: 0.9 })) }
  await expect(user.mutation(api.quizAnswerAssessments.recordAvailable, available)).rejects.toThrow('Assessment not found')
  await expect(user.mutation(api.quizAnswerAssessments.recordUnavailable, { ...common, assessmentIds, inputDigest, claimId, reason: 'timeout', retryable: true })).rejects.toThrow('Assessment not found')
  await expect(user.mutation(api.quizAnswerAssessments.recordShadowAvailable, { ...available, results: available.results.map(result => ({ ...result, reviewRequired: false })) })).rejects.toThrow('Shadow assessment not found')
  await expect(user.mutation(api.quizAnswerAssessments.recordShadowUnavailable, { ...common, assessmentIds, inputDigest, claimId, reason: 'timeout' })).rejects.toThrow('Shadow assessment not found')
  expect(await t.run(ctx => ctx.db.query('quizAnswerAssessments').withIndex('by_attemptId', q => q.eq('attemptId', attemptId)).collect())).toEqual(before)
})
