import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'

export const FREE_RESPONSE_ASSESSMENT_KIND = 'quiz.free_response_assessment.v1' as const
export const FREE_RESPONSE_RUBRIC = [
  { label: 'fully_correct', description: 'The response answers the question completely and is supported by the evidence.' },
  { label: 'partially_correct', description: 'The response contains a supported correct idea but is materially incomplete or has a minor error.' },
  { label: 'incorrect', description: 'The response is contradicted by the evidence, unsupported, or misses the requested concept.' },
  { label: 'uncertain', description: 'The evidence or response is insufficient to make a reliable assessment.' },
]
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
  return await ctx.db.insert('quizAnswerAssessments', {
    userId: input.userId,
    attemptId: input.attemptId,
    attemptAnswerId: input.attemptAnswerId,
    questionId: input.question._id,
    kind: FREE_RESPONSE_ASSESSMENT_KIND,
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
    requestedAt: Date.now(),
  })
}
