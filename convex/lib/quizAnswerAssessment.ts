import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import manifest from '../../workers/laya-evaluator/learningDecisionManifest.json'

export const FREE_RESPONSE_ASSESSMENT_KIND = manifest.decisionKinds.freeResponse.kind as 'quiz.free_response_assessment.v1'
export const FREE_RESPONSE_RUBRIC = manifest.decisionKinds.freeResponse.rubric
export async function createPendingAnswerAssessment(
  ctx: MutationCtx,
  input: {
    userId: string
    attemptId: Id<'quizAttempts'>
    attemptAnswerId: Id<'attemptAnswers'>
    question: Doc<'quizQuestions'>
    learnerAnswer: string
    deterministicIsCorrect: boolean
  },
) {
  if (input.question.type !== 'free-response' && input.question.type !== 'fill_in_the_blank') return null
  const existing = await ctx.db
    .query('quizAnswerAssessments')
    .withIndex('by_attemptAnswerId', q => q.eq('attemptAnswerId', input.attemptAnswerId))
    .unique()
  if (existing) return existing._id
  const quiz = await ctx.db.get(input.question.quizId)
  const language = quiz?.language?.trim().toLowerCase().replaceAll('_', '-') || 'unknown'
  const now = Date.now()
  return await ctx.db.insert('quizAnswerAssessments', {
    userId: input.userId,
    attemptId: input.attemptId,
    attemptAnswerId: input.attemptAnswerId,
    questionId: input.question._id,
    kind: FREE_RESPONSE_ASSESSMENT_KIND,
    contractVersion: manifest.contractVersion,
    snapshotVersion: manifest.snapshotVersion,
    languageSnapshot: language,
    status: 'pending',
    questionSnapshot: {
      question: input.question.question,
      questionType: input.question.type,
      expectedAnswer: input.question.correctAnswer,
      evidenceExcerpt: input.question.sourceChunkContent ?? '',
      sourceFilename: input.question.sourceFilename,
      explanation: input.question.explanation,
    },
    learnerAnswerSnapshot: input.learnerAnswer,
    deterministicIsCorrect: input.deterministicIsCorrect,
    rubricVersion: FREE_RESPONSE_ASSESSMENT_KIND,
    rubricSnapshot: FREE_RESPONSE_RUBRIC,
    attemptCount: 0,
    nextAttemptAt: now,
    requestedAt: now,
  })
}
