import type { QuizGrade } from '../../shared/quiz-grading'

export const QUIZ_STRIP_PAGE_SIZE = 24
export const QUIZ_STRIP_TILE_LIMIT = 6

export type QuizResultState = 'correct' | 'partial' | 'incorrect' | 'your_call' | 'checking' | 'not_checked' | 'unreviewed'
export type QuizSelfVerdict = 'correct' | 'partial' | 'incorrect'

export interface QuizGradingSummary {
  pending: number
  needsReview: number
  unavailable: number
}

export interface QuizGradedResult {
  questionText: string
  questionType: string
  options?: string[]
  userAnswer: string
  isCorrect: boolean
  correctAnswer: string
  explanation?: string
  attemptAnswerId?: string
  grade?: QuizGrade
}

export const QUIZ_RESULT_LABELS: Record<QuizResultState, string> = {
  correct: 'Correct',
  partial: 'Partly correct',
  incorrect: 'Incorrect',
  your_call: 'Your call',
  checking: 'Checking',
  not_checked: 'Not checked yet',
  unreviewed: 'No exact answer match',
}

export function isQuizFreeForm(type: string) {
  return type === 'free-response' || type === 'fill_in_the_blank'
}

export function usesGradedAnswer(result: Pick<QuizGradedResult, 'grade' | 'questionType'>) {
  return Boolean(result.grade) || !isQuizFreeForm(result.questionType)
}

export function quizResultState(result: Pick<QuizGradedResult, 'grade' | 'isCorrect' | 'questionType'>): QuizResultState {
  const { grade } = result
  if (grade) {
    if (grade.status === 'pending') return 'checking'
    if (grade.status === 'unavailable') return 'not_checked'
    if (grade.status === 'needs_review') return 'your_call'
    if (grade.label === 'fully_correct') return 'correct'
    return grade.label === 'partially_correct' ? 'partial' : 'incorrect'
  }
  if (result.isCorrect) return 'correct'
  return isQuizFreeForm(result.questionType) ? 'unreviewed' : 'incorrect'
}

export function quizResultCredit(result: Pick<QuizGradedResult, 'grade' | 'isCorrect'>) {
  return result.grade ? result.grade.credit ?? 0 : result.isCorrect ? 1 : 0
}

export function needsQuizDecision(state: QuizResultState) {
  return state === 'your_call' || state === 'not_checked'
}

export function formatQuizPoints(points: number) {
  return String(Math.round(points * 100) / 100)
}
