import { validateQuizGradingCriteria, type QuizGradingCriterion } from '../../shared/quiz-grading'

export function validatedQuestionGradingCriteria(type: string, criteria?: QuizGradingCriterion[]) {
  if (type !== 'free-response' || !criteria) return undefined
  try {
    return validateQuizGradingCriteria(criteria)
  }
  catch {
    return undefined
  }
}
