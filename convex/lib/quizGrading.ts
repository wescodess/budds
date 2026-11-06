import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { internal } from '../_generated/api'
import { hasAccountDeletionTombstone } from './accountDeletionTombstone'
import { isRubricAssessment } from './quizAnswerAssessment'
import { QUIZ_RUBRIC_GRADE_VERSION, validateQuizGradingCriteria } from '../../shared/quiz-grading'
import { QUIZ_GRADER_POLICY, boundQuizGradingEvidence, type QuizGradingInput } from '../../server/utils/quiz-grading'

export const MAX_QUIZ_GRADING_ROWS = 200

export function getQuizGradingState(rows: Doc<'quizAnswerAssessments'>[]) {
  const rubricRows = rows.filter(isRubricAssessment)
  return {
    gradingStatus: rubricRows.some(row => row.status === 'pending') ? 'grading' as const : 'settled' as const,
    // Independent of pending work: History gives checking priority over learner input.
    gradingNeedsAttention: rubricRows.some(row => row.status === 'unavailable' || (row.status === 'available' && row.label === 'uncertain')),
  }
}

export async function getQuizAttemptAnswers(ctx: QueryCtx | MutationCtx, attempt: Doc<'quizAttempts'>) {
  if (!attempt.gradingQuestionIds) {
    // Historical attempts predate the grading admission cap. Stream the indexed
    // rows so their existing review remains complete.
    const answers: Doc<'attemptAnswers'>[] = []
    for await (const answer of ctx.db.query('attemptAnswers').withIndex('by_attemptId', q => q.eq('attemptId', attempt._id))) answers.push(answer)
    return answers
  }
  const questionIds = [...new Set(attempt.gradingQuestionIds)]
  if (questionIds.length > MAX_QUIZ_GRADING_ROWS) throw new Error('Quiz question limit exceeded')
  // Most attempts fit one bounded read. Replaced questions can leave more
  // stored answers than the frozen limit, so retain per-question lookups there.
  const stored = await ctx.db.query('attemptAnswers').withIndex('by_attemptId', q => q.eq('attemptId', attempt._id)).take(MAX_QUIZ_GRADING_ROWS + 1)
  const eligible = new Set(questionIds)
  const matching = stored.filter(answer => eligible.has(answer.questionId))
  if (stored.length <= MAX_QUIZ_GRADING_ROWS && new Set(matching.map(answer => answer.questionId)).size === matching.length) {
    return matching.sort((a, b) => a._creationTime - b._creationTime || String(a._id).localeCompare(String(b._id)))
  }
  const answers = await Promise.all(questionIds.map(questionId => ctx.db.query('attemptAnswers')
    .withIndex('by_attemptId_and_questionId', q => q.eq('attemptId', attempt._id).eq('questionId', questionId)).unique()))
  return answers.filter(answer => answer !== null)
    .sort((a, b) => a._creationTime - b._creationTime || String(a._id).localeCompare(String(b._id)))
}

export async function getQuizAttemptAssessments(ctx: QueryCtx | MutationCtx, attempt: Doc<'quizAttempts'>, answers: Doc<'attemptAnswers'>[]) {
  if (!attempt.gradingQuestionIds) {
    const rows: Doc<'quizAnswerAssessments'>[] = []
    for await (const row of ctx.db.query('quizAnswerAssessments')
      .withIndex('by_userId_and_attemptId', q => q.eq('userId', attempt.userId).eq('attemptId', attempt._id))) rows.push(row)
    return rows
  }
  const stored = await ctx.db.query('quizAnswerAssessments')
    .withIndex('by_userId_and_attemptId', q => q.eq('userId', attempt.userId).eq('attemptId', attempt._id)).take(MAX_QUIZ_GRADING_ROWS + 1)
  const byAnswer = new Map(stored.map(row => [row.attemptAnswerId, row]))
  if (stored.length <= MAX_QUIZ_GRADING_ROWS && byAnswer.size === stored.length) {
    return answers.map(answer => byAnswer.get(answer._id)).filter((row): row is Doc<'quizAnswerAssessments'> => row !== undefined)
  }
  const rows = await Promise.all(answers.map(answer => ctx.db.query('quizAnswerAssessments')
    .withIndex('by_attemptAnswerId', q => q.eq('attemptAnswerId', answer._id)).unique()))
  return rows.filter((row): row is Doc<'quizAnswerAssessments'> => row !== null && row.attemptId === attempt._id && row.userId === attempt.userId)
}

export async function isQuizGradingParentEligible(ctx: QueryCtx | MutationCtx, quiz: Doc<'quizzes'>) {
  const folder = await ctx.db.get(quiz.folderId)
  if (!folder || folder.userId !== quiz.userId) return false
  if (quiz.courseScoped !== true && quiz.courseId === undefined) return true
  // Legacy course quizzes have no bounded parent lookup and cannot accept rubric work.
  if (!quiz.courseId) return false
  const course = await ctx.db.get(quiz.courseId)
  return course !== null && course.userId === quiz.userId && course.status !== 'deleting'
}

export async function getQuizGradingAttempt(ctx: MutationCtx, attemptId: Id<'quizAttempts'>) {
  const attempt = await ctx.db.get(attemptId)
  if (!attempt || attempt.status !== 'completed' || await hasAccountDeletionTombstone(ctx, attempt.userId)) return null
  const quiz = await ctx.db.get(attempt.quizId)
  if (!quiz || quiz.deletedAt !== undefined || quiz.userId !== attempt.userId) return null
  if (!await isQuizGradingParentEligible(ctx, quiz)) return null
  return { attempt, quiz }
}

export async function getQuizGradingRows(ctx: MutationCtx, attemptId: Id<'quizAttempts'>) {
  const attempt = await ctx.db.get(attemptId)
  if (!attempt?.gradingQuestionIds) return []
  const answers = await getQuizAttemptAnswers(ctx, attempt)
  return (await getQuizAttemptAssessments(ctx, attempt, answers)).filter(isRubricAssessment)
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
    evidenceExcerpt: boundQuizGradingEvidence(row.questionSnapshot.evidenceExcerpt),
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

// A single tracked wakeup per attempt; superseded scheduled entries are no-ops.
export async function scheduleQuizGrading(ctx: MutationCtx, attemptId: Id<'quizAttempts'>, dueAt = Date.now()) {
  const attempt = await ctx.db.get(attemptId)
  if (!attempt) return
  const row = await ctx.db.query('quizAnswerAssessments')
    .withIndex('by_attemptId_and_rubricVersion_and_status', q => q.eq('attemptId', attemptId).eq('rubricVersion', QUIZ_RUBRIC_GRADE_VERSION).eq('status', 'pending'))
    .first()
  if (!row || (attempt.gradingWakeAt !== undefined && attempt.gradingWakeAt <= dueAt)) return
  await ctx.db.patch(attemptId, { gradingWakeAt: dueAt })
  await ctx.scheduler.runAfter(Math.max(0, dueAt - Date.now()), internal.quizGrading.gradeAttempt, { attemptId, scheduledFor: dueAt })
}

export async function recomputeQuizGradingScore(ctx: MutationCtx, attemptId: Id<'quizAttempts'>) {
  const scope = await getQuizGradingAttempt(ctx, attemptId)
  if (!scope) return
  if (!scope.attempt.gradingQuestionIds) return
  const answers = await getQuizAttemptAnswers(ctx, scope.attempt)
  const rows = (await getQuizAttemptAssessments(ctx, scope.attempt, answers)).filter(isRubricAssessment)
  if (rows.length === 0) return
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
  await ctx.db.patch(attemptId, { score, ...getQuizGradingState(rows) })
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
