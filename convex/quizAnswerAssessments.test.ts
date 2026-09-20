/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const USER_A = { tokenIdentifier: 'https://auth.example.com|semantic_a', name: 'Alice' }
const USER_B = { tokenIdentifier: 'https://auth.example.com|semantic_b', name: 'Bob' }
const settings = { shuffleQuestions: false, showAllQuestions: false, immediateFeedback: false }
const WRITE_SECRET = 'test-assessment-write-secret-long-enough'
process.env.QUIZ_ASSESSMENT_WRITE_SECRET = WRITE_SECRET

async function createAttempt() {
  const t = convexTest(schema, modules)
  const alice = t.withIdentity(USER_A)
  const folderId = await alice.mutation(api.folders.createFolder, { name: 'Biology' })
  const { quizId } = await alice.mutation(api.quizzes.createWithQuestions, {
    folderId,
    title: 'Mitosis',
    questions: [{
      order: 0,
      question: 'What is produced by mitosis?',
      type: 'free-response',
      correctAnswer: 'Two genetically identical daughter cells.',
      explanation: 'Original explanation of mitosis.',
      sourceChunkContent: 'Mitosis produces two genetically identical daughter cells.',
      sourceFilename: 'biology.pdf',
    }],
  })
  const started = await alice.mutation(api.quizzes.startAttempt, { quizId, settings })
  const questionId = started.questions[0]!._id
  await alice.mutation(api.quizzes.submitAnswer, {
    attemptId: started.attemptId,
    questionId,
    userAnswer: 'It makes two identical cells.',
  })
  await alice.mutation(api.quizzes.completeAttempt, { attemptId: started.attemptId })
  return { t, alice, bob: t.withIdentity(USER_B), quizId, attemptId: started.attemptId, questionId }
}

describe('quiz answer semantic assessments', () => {
  test('snapshots evidence, is owner-scoped, and is idempotently claimed', async () => {
    const { t, alice, bob, attemptId } = await createAttempt()
    const pending = await alice.query(api.quizAnswerAssessments.listPendingForAttempt, { attemptId })
    expect(pending).toHaveLength(1)
    expect(pending[0]!.questionSnapshot).toMatchObject({
      question: 'What is produced by mitosis?',
      expectedAnswer: 'Two genetically identical daughter cells.',
      evidenceExcerpt: 'Mitosis produces two genetically identical daughter cells.',
    })
    await expect(bob.query(api.quizAnswerAssessments.listPendingForAttempt, { attemptId })).rejects.toThrow(/Attempt not found/)

    const inputDigest = 'a'.repeat(64)
    const claimed = await alice.mutation(api.quizAnswerAssessments.claimBatch, {
      attemptId,
      assessmentIds: [pending[0]!.assessmentId],
      inputDigest,
    })
    expect(claimed).toEqual([pending[0]!.assessmentId])
    expect(await alice.mutation(api.quizAnswerAssessments.claimBatch, {
      attemptId,
      assessmentIds: [pending[0]!.assessmentId],
      inputDigest,
    })).toEqual([])

    await t.run(async ctx => await ctx.db.patch(pending[0]!.assessmentId, { claimedAt: Date.now() - 5 * 60 * 1000 - 1 }))
    expect(await alice.query(api.quizAnswerAssessments.listPendingForAttempt, { attemptId })).toHaveLength(1)
    expect(await alice.mutation(api.quizAnswerAssessments.claimBatch, {
      attemptId,
      assessmentIds: [pending[0]!.assessmentId],
      inputDigest: 'd'.repeat(64),
    })).toEqual([pending[0]!.assessmentId])
  })

  test('bulk submission snapshots only semantic question types without truncating historical review', async () => {
    const t = convexTest(schema, modules)
    const alice = t.withIdentity(USER_A)
    const folderId = await alice.mutation(api.folders.createFolder, { name: 'Bulk' })
    const { quizId } = await alice.mutation(api.quizzes.createWithQuestions, {
      folderId,
      title: 'Bulk quiz',
      questions: [
        { order: 0, question: 'Q'.repeat(1_300), type: 'free-response', correctAnswer: 'A'.repeat(500), sourceChunkContent: 'E'.repeat(1_300) },
        { order: 1, question: 'Fill this', type: 'fill_in_the_blank', correctAnswer: 'cell' },
        { order: 2, question: 'Pick one', type: 'multiple-choice', options: ['A', 'B'], correctAnswer: 'A' },
      ],
    })
    const started = await alice.mutation(api.quizzes.startAttempt, { quizId, settings })
    await alice.mutation(api.quizzes.submitAllAnswers, {
      attemptId: started.attemptId,
      answers: started.questions.map(question => ({ questionId: question._id, userAnswer: question.type === 'multiple-choice' ? 'A' : 'R'.repeat(900) })),
    })
    const rows = await alice.query(api.quizAnswerAssessments.listPendingForAttempt, { attemptId: started.attemptId })
    expect(rows).toHaveLength(2)
    expect(rows[0]!.questionSnapshot.question).toHaveLength(1_300)
    expect(rows[0]!.questionSnapshot.expectedAnswer).toHaveLength(500)
    expect(rows[0]!.questionSnapshot.evidenceExcerpt).toHaveLength(1_300)
    expect(rows[0]!.learnerAnswerSnapshot).toHaveLength(900)
  })

  test('rejects forged terminal writes and invalid confidence', async () => {
    const { alice, attemptId } = await createAttempt()
    const [pending] = await alice.query(api.quizAnswerAssessments.listPendingForAttempt, { attemptId })
    const inputDigest = 'e'.repeat(64)
    await alice.mutation(api.quizAnswerAssessments.claimBatch, { attemptId, assessmentIds: [pending!.assessmentId], inputDigest })
    const result = { assessmentId: pending!.assessmentId, inputDigest, label: 'fully_correct' as const, confidence: 0.8 }
    await expect(alice.mutation(api.quizAnswerAssessments.recordAvailable, {
      attemptId, evaluatorSecret: 'browser-forged-secret-that-is-long-enough', provider: 'laya', modelRevision: 'x', results: [result],
    })).rejects.toThrow(/not authorized/)
    await expect(alice.mutation(api.quizAnswerAssessments.recordAvailable, {
      attemptId, evaluatorSecret: WRITE_SECRET, provider: 'laya', modelRevision: 'x', results: [{ ...result, confidence: 2 }],
    })).rejects.toThrow(/Invalid assessment probability/)
  })

  test('persists an advisory verdict while preserving the deterministic score and historical snapshot', async () => {
    const { alice, attemptId, questionId } = await createAttempt()
    const [pending] = await alice.query(api.quizAnswerAssessments.listPendingForAttempt, { attemptId })
    const inputDigest = 'b'.repeat(64)
    await alice.mutation(api.quizAnswerAssessments.claimBatch, { attemptId, assessmentIds: [pending!.assessmentId], inputDigest })
    await alice.mutation(api.quizAnswerAssessments.recordAvailable, {
      attemptId,
      evaluatorSecret: WRITE_SECRET,
      provider: 'laya',
      modelRevision: 'pinned-revision',
      results: [{
        assessmentId: pending!.assessmentId,
        inputDigest,
        label: 'fully_correct',
        confidence: 0.81,
        probabilities: { fullyCorrect: 0.81, partiallyCorrect: 0.1, incorrect: 0.04, uncertain: 0.05 },
      }],
    })
    await alice.mutation(api.quizzes.updateQuestion, {
      questionId,
      question: 'A later edited question',
      correctAnswer: 'A later edited answer',
      explanation: 'A later edited explanation',
    })

    const results = await alice.query(api.quizzes.getAttemptResults, { attemptId })
    expect(results?.score).toBe(0)
    expect(results?.results[0]).toMatchObject({
      questionText: 'What is produced by mitosis?',
      correctAnswer: 'Two genetically identical daughter cells.',
      explanation: 'Original explanation of mitosis.',
      isCorrect: false,
      semanticAssessment: {
        status: 'available',
        label: 'fully_correct',
        deterministicScoreUnchanged: true,
      },
    })
  })

  test('records provider failure without changing the deterministic result', async () => {
    const { alice, attemptId } = await createAttempt()
    const [pending] = await alice.query(api.quizAnswerAssessments.listPendingForAttempt, { attemptId })
    const inputDigest = 'c'.repeat(64)
    await alice.mutation(api.quizAnswerAssessments.claimBatch, { attemptId, assessmentIds: [pending!.assessmentId], inputDigest })
    await alice.mutation(api.quizAnswerAssessments.recordUnavailable, {
      attemptId,
      evaluatorSecret: WRITE_SECRET,
      assessmentIds: [pending!.assessmentId],
      inputDigest,
      reason: 'timeout',
      retryable: true,
    })
    const results = await alice.query(api.quizzes.getAttemptResults, { attemptId })
    expect(results?.score).toBe(0)
    expect(results?.results[0]!.semanticAssessment).toMatchObject({ status: 'unavailable', unavailableReason: 'timeout', retryable: true })
  })
})
