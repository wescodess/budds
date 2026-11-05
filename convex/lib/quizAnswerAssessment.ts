import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import manifest from '../../workers/laya-evaluator/learningDecisionManifest.json'
import { QUIZ_RUBRIC_GRADE_VERSION, defaultQuizGradingCriteria, validateQuizGradingCriteria, type QuizGrade, type QuizGradingCriterion } from '../../shared/quiz-grading'

export const FREE_RESPONSE_ASSESSMENT_KIND = manifest.decisionKinds.freeResponse.kind as 'quiz.free_response_assessment.v1'
export const FREE_RESPONSE_RUBRIC = manifest.decisionKinds.freeResponse.rubric

export function isQuizGradingEnabled() {
  return process.env.QUIZ_GRADING_MODE === 'graded'
}

export function isRubricAssessment(row: Pick<Doc<'quizAnswerAssessments'>, 'rubricVersion'> | null | undefined) {
  return row?.rubricVersion === QUIZ_RUBRIC_GRADE_VERSION
}

export function projectLearnerQuizQuestion({ gradingCriteria: _criteria, ...question }: Doc<'quizQuestions'>) {
  return question
}

export function projectQuizGrade(row: Doc<'quizAnswerAssessments'>): QuizGrade {
  const status = row.status === 'available' ? (row.label === 'uncertain' ? 'needs_review' : 'graded') : row.status
  return {
    status,
    credit: row.status === 'available' ? row.credit : undefined,
    label: row.label,
    source: row.gradeSource,
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
  let criteria: QuizGradingCriterion[] | undefined
  if (isQuizGradingEnabled()) {
    const fallback = defaultQuizGradingCriteria(input.question.correctAnswer)
    try {
      criteria = validateQuizGradingCriteria(input.question.gradingCriteria ?? fallback)
    }
    catch {
      criteria = fallback
    }
  }
  const isEmpty = input.learnerAnswer.trim().length === 0
  const grade = criteria && (input.deterministicIsCorrect || isEmpty)
    ? { credit: isEmpty ? 0 : 1, label: isEmpty ? 'incorrect' as const : 'fully_correct' as const }
    : null
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
