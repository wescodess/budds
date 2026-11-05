import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import { internal } from '../_generated/api'
import { hasAccountDeletionTombstone } from './accountDeletionTombstone'
import { isRubricAssessment } from './quizAnswerAssessment'
import { QUIZ_RUBRIC_GRADE_VERSION, validateQuizGradingCriteria } from '../../shared/quiz-grading'
import { QUIZ_GRADER_POLICY, type QuizGradingInput } from '../../server/utils/quiz-grading'

export const MAX_QUIZ_GRADING_ROWS = 200

export async function getQuizGradingAttempt(ctx: MutationCtx, attemptId: Id<'quizAttempts'>) {
  const attempt = await ctx.db.get(attemptId)
  if (!attempt || attempt.status !== 'completed' || await hasAccountDeletionTombstone(ctx, attempt.userId)) return null
  const quiz = await ctx.db.get(attempt.quizId)
  if (!quiz || quiz.deletedAt !== undefined || quiz.userId !== attempt.userId) return null
  return { attempt, quiz }
}

export async function getQuizGradingRows(ctx: MutationCtx, attemptId: Id<'quizAttempts'>) {
  const attempt = await ctx.db.get(attemptId)
  if (!attempt?.gradingQuestionIds) return []
  const rows = await ctx.db.query('quizAnswerAssessments')
    .withIndex('by_attemptId_and_rubricVersion_and_status', q => q.eq('attemptId', attemptId).eq('rubricVersion', QUIZ_RUBRIC_GRADE_VERSION))
    .take(MAX_QUIZ_GRADING_ROWS + 1)
  if (rows.length > MAX_QUIZ_GRADING_ROWS) throw new Error('Quiz grading row limit exceeded')
  const eligible = new Set(attempt.gradingQuestionIds)
  return rows.filter(row => eligible.has(row.questionId))
}

export async function getQuizGradingAnswer(ctx: MutationCtx, row: Doc<'quizAnswerAssessments'>, attempt: Doc<'quizAttempts'>) {
  if (!isRubricAssessment(row) || row.attemptId !== attempt._id || row.userId !== attempt.userId
    || !attempt.gradingQuestionIds?.includes(row.questionId)) return null
  const answer = await ctx.db.get(row.attemptAnswerId)
  if (!answer || answer.attemptId !== attempt._id || answer.questionId !== row.questionId || answer.userAnswer !== row.learnerAnswerSnapshot) return null
  return answer
}

export function quizGradingInput(row: Doc<'quizAnswerAssessments'>): QuizGradingInput {
  return {
    id: String(row._id),
    question: row.questionSnapshot.question,
    referenceAnswer: row.questionSnapshot.expectedAnswer,
    criteria: validateQuizGradingCriteria(row.criteriaSnapshot ?? []),
    evidenceExcerpt: row.questionSnapshot.evidenceExcerpt,
    learnerAnswer: row.learnerAnswerSnapshot,
  }
}

export async function quizGradingInputDigest(row: Doc<'quizAnswerAssessments'>) {
  const bytes = new TextEncoder().encode(JSON.stringify({
    userId: row.userId, attemptId: row.attemptId, attemptAnswerId: row.attemptAnswerId, questionId: row.questionId,
    rubricVersion: row.rubricVersion, policy: QUIZ_GRADER_POLICY, input: quizGradingInput(row),
  }))
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function scheduleQuizGrading(ctx: MutationCtx, attemptId: Id<'quizAttempts'>) {
  const row = await ctx.db.query('quizAnswerAssessments')
    .withIndex('by_attemptId_and_rubricVersion_and_status', q => q.eq('attemptId', attemptId).eq('rubricVersion', QUIZ_RUBRIC_GRADE_VERSION).eq('status', 'pending'))
    .first()
  if (row) await ctx.scheduler.runAfter(0, internal.quizGrading.gradeAttempt, { attemptId })
}

export async function recomputeQuizGradingScore(ctx: MutationCtx, attemptId: Id<'quizAttempts'>) {
  const scope = await getQuizGradingAttempt(ctx, attemptId)
  if (!scope) return
  const rows = await getQuizGradingRows(ctx, attemptId)
  if (rows.length === 0) return
  const answers = await ctx.db.query('attemptAnswers').withIndex('by_attemptId', q => q.eq('attemptId', attemptId)).take(MAX_QUIZ_GRADING_ROWS + 1)
  if (answers.length > MAX_QUIZ_GRADING_ROWS) throw new Error('Quiz answer limit exceeded')
  const grades = new Map(rows.filter(row => row.userId === scope.attempt.userId).map(row => [row.attemptAnswerId, row]))
  const seen = new Set<Id<'quizQuestions'>>()
  const eligible = new Set(scope.attempt.gradingQuestionIds)
  let hundredths = 0
  for (const answer of answers) {
    if (!eligible.has(answer.questionId) || seen.has(answer.questionId)) continue
    seen.add(answer.questionId)
    const grade = grades.get(answer._id)
    hundredths += grade ? (grade.status === 'available' ? Math.round((grade.credit ?? 0) * 100) : 0) : answer.isCorrect ? 100 : 0
  }
  const score = hundredths / 100
  await ctx.db.patch(attemptId, { score, gradingStatus: rows.some(row => row.status === 'pending') ? 'grading' : 'settled' })
  const completed = await ctx.db.query('quizAttempts')
    .withIndex('by_quizId_and_status_and_completedAt', q => q.eq('quizId', scope.quiz._id).eq('status', 'completed')).order('desc').first()
  const legacy = await ctx.db.query('quizAttempts')
    .withIndex('by_quizId_and_status_and_completedAt', q => q.eq('quizId', scope.quiz._id).eq('status', undefined).gt('completedAt', 0)).order('desc').first()
  const latest = [completed, legacy].filter(row => row !== null)
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0) || b._creationTime - a._creationTime || String(b._id).localeCompare(String(a._id)))[0]
  if (latest?._id === attemptId) {
    await ctx.db.patch(scope.quiz._id, { score: scope.attempt.total > 0 ? Math.round((score / scope.attempt.total) * 100) : 0 })
  }
}
