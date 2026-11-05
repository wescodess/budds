import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import manifest from '../../workers/laya-evaluator/learningDecisionManifest.json'
import { QUIZ_RUBRIC_GRADE_VERSION, defaultQuizGradingCriteria, getDeterministicQuizGrade, validateQuizGradingCriteria, type QuizGrade } from '../../shared/quiz-grading'

export const FREE_RESPONSE_ASSESSMENT_KIND = manifest.decisionKinds.freeResponse.kind as 'quiz.free_response_assessment.v1'
export const FREE_RESPONSE_RUBRIC = manifest.decisionKinds.freeResponse.rubric

export function isQuizGradingEnabled() {
  return process.env.QUIZ_GRADING_MODE === 'graded'
}

export function isRubricAssessment(row: Pick<Doc<'quizAnswerAssessments'>, 'rubricVersion'> | null | undefined) {
  return row?.rubricVersion === QUIZ_RUBRIC_GRADE_VERSION
}

export function projectQuizGrade(row: Doc<'quizAnswerAssessments'>): QuizGrade {
  const status = row.status === 'available' ? (row.label === 'uncertain' ? 'needs_review' : 'graded') : row.status
  const resultsByKey = new Map(row.criterionResults?.map(result => [result.key, result]))
  return {
    status,
    credit: status === 'graded' ? row.credit : undefined,
    label: row.label,
    source: row.gradeSource,
    criteria: (row.criteriaSnapshot ?? []).map(criterion => ({
      ...criterion,
      verdict: resultsByKey.get(criterion.key)?.verdict,
      feedback: resultsByKey.get(criterion.key)?.feedback,
    })),
    feedback: row.feedback,
  }
}

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
  const criteria = isQuizGradingEnabled()
    ? validateQuizGradingCriteria(input.question.gradingCriteria ?? defaultQuizGradingCriteria(input.question.correctAnswer))
    : undefined
  const grade = criteria ? getDeterministicQuizGrade(input.learnerAnswer, input.question.correctAnswer) : null
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
    ...(criteria ? {
      rubricVersion: QUIZ_RUBRIC_GRADE_VERSION,
      criteriaSnapshot: criteria,
      ...(grade ? {
        status: 'available' as const,
        credit: grade.credit,
        label: grade.label,
        gradeSource: 'deterministic' as const,
        criterionResults: criteria.map(criterion => ({ key: criterion.key, verdict: grade.credit === 1 ? 'met' as const : 'not_met' as const })),
        completedAt: now,
        nextAttemptAt: undefined,
      } : {}),
    } : {}),
  })
}
