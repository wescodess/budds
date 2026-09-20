/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test, vi } from 'vitest'
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
    language: 'en',
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
      claimId: 'claim-a',
    })
    expect(claimed).toEqual([pending[0]!.assessmentId])
    expect(await alice.mutation(api.quizAnswerAssessments.claimBatch, {
      attemptId,
      assessmentIds: [pending[0]!.assessmentId],
      inputDigest,
      claimId: 'claim-b',
    })).toEqual([])

    await t.run(async ctx => await ctx.db.patch(pending[0]!.assessmentId, { claimedAt: 0, leaseExpiresAt: 0 }))
    expect(await alice.query(api.quizAnswerAssessments.listPendingForAttempt, { attemptId })).toHaveLength(1)
    expect(await alice.mutation(api.quizAnswerAssessments.claimBatch, {
      attemptId,
      assessmentIds: [pending[0]!.assessmentId],
      inputDigest: 'd'.repeat(64),
      claimId: 'claim-d',
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
    expect(rows.every(row => row.languageSnapshot === 'unknown')).toBe(true)
  })

  test('rejects forged terminal writes and invalid confidence', async () => {
    const { alice, attemptId } = await createAttempt()
    const [pending] = await alice.query(api.quizAnswerAssessments.listPendingForAttempt, { attemptId })
    const inputDigest = 'e'.repeat(64)
    await alice.mutation(api.quizAnswerAssessments.claimBatch, { attemptId, assessmentIds: [pending!.assessmentId], inputDigest, claimId: 'claim-e' })
    const result = { assessmentId: pending!.assessmentId, inputDigest, claimId: 'claim-e', label: 'fully_correct' as const, confidence: 0.8 }
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
    await alice.mutation(api.quizAnswerAssessments.claimBatch, { attemptId, assessmentIds: [pending!.assessmentId], inputDigest, claimId: 'claim-b' })
    await alice.mutation(api.quizAnswerAssessments.recordAvailable, {
      attemptId,
      evaluatorSecret: WRITE_SECRET,
      provider: 'laya',
      modelRevision: 'pinned-revision',
      results: [{
        assessmentId: pending!.assessmentId,
        inputDigest,
        claimId: 'claim-b',
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

  test('enforces exponential/provider backoff and terminal exhaustion without rewriting due times', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const { t, alice, attemptId } = await createAttempt()
    const [pending] = await alice.query(api.quizAnswerAssessments.listPendingForAttempt, { attemptId })
    const original = await t.run(ctx => ctx.db.get(pending!.assessmentId))

    try {
      const firstDigest = '1'.repeat(64)
      expect(await alice.mutation(api.quizAnswerAssessments.claimBatch, { attemptId, assessmentIds: [pending!.assessmentId], inputDigest: firstDigest, claimId: 'claim-1' })).toEqual([pending!.assessmentId])
      await alice.mutation(api.quizAnswerAssessments.recordUnavailable, {
        attemptId,
        evaluatorSecret: WRITE_SECRET,
        assessmentIds: [pending!.assessmentId],
        inputDigest: firstDigest,
        claimId: 'claim-1',
        reason: 'timeout',
        retryable: true,
        retryAfterMs: 1_000,
      })
      expect((await t.run(ctx => ctx.db.get(pending!.assessmentId)))?.nextAttemptAt).toBe(3_000)
      expect(await alice.query(api.quizAnswerAssessments.listPendingForAttempt, { attemptId })).toEqual([])
      expect(await alice.mutation(api.quizAnswerAssessments.claimBatch, { attemptId, assessmentIds: [pending!.assessmentId], inputDigest: '2'.repeat(64), claimId: 'claim-early' })).toEqual([])

      vi.setSystemTime(3_000)
      expect(await alice.query(api.quizAnswerAssessments.listPendingForAttempt, { attemptId })).toHaveLength(1)
      const secondDigest = '2'.repeat(64)
      expect(await alice.mutation(api.quizAnswerAssessments.claimBatch, { attemptId, assessmentIds: [pending!.assessmentId], inputDigest: secondDigest, claimId: 'claim-2' })).toEqual([pending!.assessmentId])
      await alice.mutation(api.quizAnswerAssessments.recordUnavailable, {
        attemptId, evaluatorSecret: WRITE_SECRET, assessmentIds: [pending!.assessmentId], inputDigest: secondDigest,
        claimId: 'claim-2', reason: 'timeout', retryable: true, retryAfterMs: 10_000,
      })
      expect((await t.run(ctx => ctx.db.get(pending!.assessmentId)))?.nextAttemptAt).toBe(13_000)
      expect(await alice.query(api.quizAnswerAssessments.listPendingForAttempt, { attemptId })).toEqual([])

      vi.setSystemTime(13_000)
      const thirdDigest = '3'.repeat(64)
      expect(await alice.mutation(api.quizAnswerAssessments.claimBatch, { attemptId, assessmentIds: [pending!.assessmentId], inputDigest: thirdDigest, claimId: 'claim-3' })).toEqual([pending!.assessmentId])
      await alice.mutation(api.quizAnswerAssessments.recordUnavailable, {
        attemptId, evaluatorSecret: WRITE_SECRET, assessmentIds: [pending!.assessmentId], inputDigest: thirdDigest,
        claimId: 'claim-3', reason: 'timeout', retryable: true,
      })
      const results = await alice.query(api.quizzes.getAttemptResults, { attemptId })
      expect(results?.results[0]!.semanticAssessment).toMatchObject({ status: 'unavailable', retryable: false, attemptCount: 3 })
      expect(await alice.query(api.quizAnswerAssessments.listPendingForAttempt, { attemptId })).toEqual([])

      const persisted = await t.run(ctx => ctx.db.get(pending!.assessmentId))
      expect(JSON.stringify({ questionSnapshot: persisted?.questionSnapshot, learnerAnswerSnapshot: persisted?.learnerAnswerSnapshot,
        contractVersion: persisted?.contractVersion, snapshotVersion: persisted?.snapshotVersion,
        languageSnapshot: persisted?.languageSnapshot, rubricSnapshot: persisted?.rubricSnapshot }))
        .toBe(JSON.stringify({ questionSnapshot: original?.questionSnapshot, learnerAnswerSnapshot: original?.learnerAnswerSnapshot,
          contractVersion: original?.contractVersion, snapshotVersion: original?.snapshotVersion,
          languageSnapshot: original?.languageSnapshot, rubricSnapshot: original?.rubricSnapshot }))
    }
    finally {
      vi.useRealTimers()
    }
  })

  test('never requeues a nonretryable unavailable result', async () => {
    const { alice, attemptId } = await createAttempt()
    const [pending] = await alice.query(api.quizAnswerAssessments.listPendingForAttempt, { attemptId })
    const inputDigest = 'f'.repeat(64)
    await alice.mutation(api.quizAnswerAssessments.claimBatch, { attemptId, assessmentIds: [pending!.assessmentId], inputDigest, claimId: 'claim-f' })
    await alice.mutation(api.quizAnswerAssessments.recordUnavailable, {
      attemptId,
      evaluatorSecret: WRITE_SECRET,
      assessmentIds: [pending!.assessmentId],
      inputDigest,
      claimId: 'claim-f',
      reason: 'unsupported_language',
      retryable: false,
    })
    expect(await alice.query(api.quizAnswerAssessments.listPendingForAttempt, { attemptId })).toEqual([])
    const results = await alice.query(api.quizzes.getAttemptResults, { attemptId })
    expect(results?.results[0]!.semanticAssessment).toMatchObject({ status: 'unavailable', unavailableReason: 'unsupported_language', retryable: false })
  })

  test('rejects duplicate IDs before incrementing and rejects a late response from an expired claim', async () => {
    const { t, alice, attemptId } = await createAttempt()
    const [pending] = await alice.query(api.quizAnswerAssessments.listPendingForAttempt, { attemptId })
    const digest = 'a'.repeat(64)
    await expect(alice.mutation(api.quizAnswerAssessments.claimBatch, {
      attemptId, assessmentIds: [pending!.assessmentId, pending!.assessmentId], inputDigest: digest, claimId: 'duplicate',
    })).rejects.toThrow(/Invalid assessment claim/)
    expect((await t.run(ctx => ctx.db.get(pending!.assessmentId)))?.attemptCount).toBe(0)

    await alice.mutation(api.quizAnswerAssessments.claimBatch, { attemptId, assessmentIds: [pending!.assessmentId], inputDigest: digest, claimId: 'old-claim' })
    await t.run(ctx => ctx.db.patch(pending!.assessmentId, { leaseExpiresAt: 0 }))
    await alice.mutation(api.quizAnswerAssessments.claimBatch, { attemptId, assessmentIds: [pending!.assessmentId], inputDigest: digest, claimId: 'new-claim' })
    await expect(alice.mutation(api.quizAnswerAssessments.recordAvailable, {
      attemptId, evaluatorSecret: WRITE_SECRET, provider: 'laya', modelRevision: 'x',
      results: [{ assessmentId: pending!.assessmentId, inputDigest: digest, claimId: 'old-claim', label: 'fully_correct', confidence: 0.9 }],
    })).rejects.toThrow(/Assessment not found/)

    await t.run(ctx => ctx.db.patch(pending!.assessmentId, { attemptCount: 3, leaseExpiresAt: 0 }))
    expect(await alice.query(api.quizAnswerAssessments.listPendingForAttempt, { attemptId })).toHaveLength(1)
    expect(await alice.mutation(api.quizAnswerAssessments.claimBatch, {
      attemptId, assessmentIds: [pending!.assessmentId], inputDigest: digest, claimId: 'exhausted-claim',
    })).toEqual([])
    expect((await t.run(ctx => ctx.db.get(pending!.assessmentId)))?.status).toBe('unavailable')
  })

  test('finds a legacy pending row even when terminal rows exceed the scan bound', async () => {
    const { t, alice, attemptId } = await createAttempt()
    const [pending] = await alice.query(api.quizAnswerAssessments.listPendingForAttempt, { attemptId })
    const source = await t.run(ctx => ctx.db.get(pending!.assessmentId))
    await t.run(async (ctx) => {
      await ctx.db.patch(pending!.assessmentId, { nextAttemptAt: undefined })
      for (let index = 0; index < 205; index++) {
        await ctx.db.insert('quizAnswerAssessments', {
          userId: source!.userId,
          attemptId,
          attemptAnswerId: source!.attemptAnswerId,
          questionId: source!.questionId,
          kind: source!.kind,
          status: 'unavailable',
          questionSnapshot: source!.questionSnapshot,
          learnerAnswerSnapshot: source!.learnerAnswerSnapshot,
          deterministicIsCorrect: source!.deterministicIsCorrect,
          rubricVersion: source!.rubricVersion,
          rubricSnapshot: source!.rubricSnapshot,
          requestedAt: source!.requestedAt + index + 1,
          unavailableReason: 'unavailable',
          retryable: false,
          completedAt: source!.requestedAt + index + 1,
        })
      }
    })

    expect(await alice.query(api.quizAnswerAssessments.listPendingForAttempt, { attemptId }))
      .toEqual([expect.objectContaining({ assessmentId: pending!.assessmentId })])
  })
})
