/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const OWNER = { tokenIdentifier: 'https://auth.example.com|quiz_release_owner', name: 'Owner' }
const OTHER = { tokenIdentifier: 'https://auth.example.com|quiz_release_other', name: 'Other' }

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv('QUIZ_GRADING_MODE', 'graded')
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

async function fixture() {
  const t = convexTest(schema, modules)
  async function create(identity: typeof OWNER) {
    const user = t.withIdentity(identity)
    const folderId = await user.mutation(api.folders.createFolder, { name: 'Release compatibility' })
    const { quizId } = await user.mutation(api.quizzes.createWithQuestions, {
      folderId, title: 'Cell division', questions: [{
        order: 0, type: 'free-response', question: 'What does mitosis produce?',
        correctAnswer: 'Two identical daughter cells',
      }],
    })
    const { questions } = (await user.query(api.quizzes.getWithQuestions, { id: quizId }))!
    const { attemptId } = await user.mutation(api.quizzes.submitAttempt, {
      quizId, answers: [{ questionId: questions[0]!._id, response: 'Two identical daughter cells' }],
    })
    const assessment = (await t.run(ctx => ctx.db.query('quizAnswerAssessments')
      .withIndex('by_attemptId', q => q.eq('attemptId', attemptId)).unique()))!
    return { user, quizId, attemptId, assessment }
  }
  return { t, owner: await create(OWNER), other: await create(OTHER) }
}

test('production quiz deletion keeps its response and removes only the owned grading snapshots', async () => {
  const { t, owner, other } = await fixture()
  await expect(owner.user.mutation(api.quizzes.deleteQuiz, { quizId: other.quizId })).rejects.toThrow('Quiz not found')
  expect(await owner.user.mutation(api.quizzes.deleteQuiz, { quizId: owner.quizId })).toEqual({ deletedAttempts: 1, deletedQuestions: 1 })
  expect(await t.run(ctx => ctx.db.get(owner.assessment._id))).toBeNull()
  expect(await t.run(ctx => ctx.db.get(owner.assessment.attemptAnswerId))).toBeNull()
  expect(await t.run(ctx => ctx.db.get(owner.attemptId))).toBeNull()
  expect(await t.run(ctx => ctx.db.get(other.assessment._id))).toEqual(other.assessment)
})

test('production account deletion removes grading snapshots before their answer and attempt', async () => {
  const { t, owner, other } = await fixture()
  await t.run(ctx => ctx.db.insert('accountDeletionJobs', {
    userId: OWNER.tokenIdentifier, status: 'active', phase: 'attemptAnswers', startedAt: Date.now(), updatedAt: Date.now(),
  }))
  await t.mutation(internal.accountDeletion.runDeletionBatch, { userId: OWNER.tokenIdentifier })
  expect(await t.run(ctx => ctx.db.get(owner.assessment._id))).toBeNull()
  expect(await t.run(ctx => ctx.db.get(owner.assessment.attemptAnswerId))).not.toBeNull()
  expect(await t.run(ctx => ctx.db.get(owner.attemptId))).not.toBeNull()
  expect(await t.run(ctx => ctx.db.get(other.assessment._id))).toEqual(other.assessment)
  await t.finishInProgressScheduledFunctions()
})

test('production quiz deletion also removes snapshots retained from replaced questions', async () => {
  const { t, owner, other } = await fixture()
  await t.run(async (ctx) => {
    const { _id: _assessmentId, _creationTime: _createdAt, ...snapshot } = owner.assessment
    // Emulate successive edits during an attempt: only one current question,
    // with additional immutable snapshots for questions that were removed.
    for (let index = 0; index < 200; index++) {
      const questionId = await ctx.db.insert('quizQuestions', {
        quizId: owner.quizId, userId: OWNER.tokenIdentifier, order: 1,
        type: 'free-response', question: `Replaced question ${index}`, correctAnswer: 'Answer',
      })
      const attemptAnswerId = await ctx.db.insert('attemptAnswers', {
        attemptId: owner.attemptId, questionId, userAnswer: 'Answer', isCorrect: true, answeredAt: Date.now(),
      })
      await ctx.db.insert('quizAnswerAssessments', { ...snapshot, questionId, attemptAnswerId })
      await ctx.db.delete(questionId)
    }
  })
  expect(await owner.user.mutation(api.quizzes.deleteQuiz, { quizId: owner.quizId })).toEqual({ deletedAttempts: 1, deletedQuestions: 1 })
  expect(await t.run(ctx => ctx.db.query('quizAnswerAssessments')
    .withIndex('by_attemptId', q => q.eq('attemptId', owner.attemptId)).take(1))).toEqual([])
  expect(await t.run(ctx => ctx.db.get(other.assessment._id))).toEqual(other.assessment)
})

test('production export includes full owned grading data and rejects foreign attempt answers', async () => {
  const { owner, other } = await fixture()
  const exported = await owner.user.query(api.dataExport.getUserDataPage, {
    collection: 'quizAnswerAssessments', paginationOpts: { cursor: null, numItems: 1 },
  })
  expect(exported.page).toEqual([owner.assessment])
  expect(exported.isDone).toBe(true)
  await expect(owner.user.query(api.dataExport.getAttemptAnswersPage, {
    attemptId: other.attemptId, paginationOpts: { cursor: null, numItems: 1 },
  })).resolves.toBeNull()
})
