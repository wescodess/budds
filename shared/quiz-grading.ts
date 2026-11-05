import { v, type Infer } from 'convex/values'
import { scoreCriteria } from './learn-v2-mastery'

export const QUIZ_RUBRIC_GRADE_VERSION = 'quiz.rubric_grade.v1'

export const quizGradingCriterionValidator = v.object({
  key: v.string(),
  description: v.string(),
  weightPercent: v.number(),
})
export const quizCriterionResultValidator = v.object({
  key: v.string(),
  verdict: v.union(v.literal('met'), v.literal('not_met'), v.literal('uncertain')),
})
export const quizGradeSourceValidator = v.union(v.literal('deterministic'), v.literal('model'), v.literal('self'))

export type QuizGradingCriterion = Infer<typeof quizGradingCriterionValidator>
export type QuizCriterionResult = Infer<typeof quizCriterionResultValidator>
export type QuizGradeLabel = 'fully_correct' | 'partially_correct' | 'incorrect' | 'uncertain'
export type QuizGrade = {
  status: 'pending' | 'graded' | 'needs_review' | 'unavailable'
  credit?: number
  label?: QuizGradeLabel
  source?: Infer<typeof quizGradeSourceValidator>
  feedback?: string
}

export function validateQuizGradingCriteria(criteria: QuizGradingCriterion[]) {
  if (criteria.length < 1 || criteria.length > 4
    || new Set(criteria.map(criterion => criterion.key)).size !== criteria.length
    || criteria.some(criterion => !/^[a-z0-9_]{1,40}$/.test(criterion.key)
      || criterion.key !== criterion.key.trim()
      || criterion.description.length > 300
      || !Number.isInteger(criterion.weightPercent) || criterion.weightPercent <= 0)
    || criteria.reduce((sum, criterion) => sum + criterion.weightPercent, 0) !== 100) {
    throw new Error('Invalid quiz grading criteria')
  }
  return criteria.map(criterion => ({ ...criterion }))
}

export function defaultQuizGradingCriteria(referenceAnswer: string): QuizGradingCriterion[] {
  let description = ''
  for (const codePoint of `Conveys the reference answer: ${referenceAnswer.trim()}`) {
    if (description.length + codePoint.length > 300) break
    description += codePoint
  }
  return [{
    key: 'reference_answer',
    description,
    weightPercent: 100,
  }]
}

export function scoreQuizCriteria(criteria: QuizGradingCriterion[], results: QuizCriterionResult[]): { credit: number, label: QuizGradeLabel } {
  validateQuizGradingCriteria(criteria)
  if (results.some(result => !['met', 'not_met', 'uncertain'].includes(result.verdict))) throw new Error('Invalid quiz criterion verdict')
  const scorePercent = scoreCriteria(criteria, results.map(result => ({ key: result.key, awarded: result.verdict === 'met' })))
  const credit = scorePercent / 100
  if (results.some(result => result.verdict === 'uncertain')) return { credit, label: 'uncertain' }
  return { credit, label: credit === 1 ? 'fully_correct' : credit === 0 ? 'incorrect' : 'partially_correct' }
}
