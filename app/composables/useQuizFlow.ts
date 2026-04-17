import { api } from '#convex/api'
import type { Id } from '../../convex/_generated/dataModel'

export type QuizFlowState = 'initial' | 'overview' | 'taking' | 'results'

export function useQuizFlow(quizId: Ref<Id<'quizzes'> | null>) {
  const state = ref<QuizFlowState>('initial')
  const activeAttemptId = ref<Id<'quizAttempts'> | null>(null)

  const quiz = ref<any>(null)
  const questions = ref<any[]>([])

  if (import.meta.client) {
    watch(quizId, (id) => {
      if (!id) {
        quiz.value = null
        questions.value = []
        state.value = 'initial'
      }
    })
  }

  const hasQuestions = computed(() => questions.value.length > 0)

  function setQuizData(data: { quiz: any; questions: any[] } | null) {
    if (!data || !data.quiz) {
      quiz.value = null
      questions.value = []
      if (state.value !== 'taking' && state.value !== 'results') {
        state.value = 'initial'
      }
      return
    }
    quiz.value = data.quiz
    questions.value = data.questions
    if (state.value !== 'taking' && state.value !== 'results') {
      state.value = data.questions.length > 0 ? 'overview' : 'initial'
    }
  }

  function goToOverview() {
    state.value = 'overview'
    activeAttemptId.value = null
  }

  function goToTaking(attemptId: Id<'quizAttempts'>) {
    activeAttemptId.value = attemptId
    state.value = 'taking'
  }

  function goToResults(attemptId: Id<'quizAttempts'>) {
    activeAttemptId.value = attemptId
    state.value = 'results'
  }

  function goToInitial() {
    state.value = 'initial'
    activeAttemptId.value = null
  }

  return {
    state: readonly(state),
    activeAttemptId: readonly(activeAttemptId),
    quiz: readonly(quiz),
    questions: readonly(questions),
    hasQuestions,
    setQuizData,
    goToOverview,
    goToTaking,
    goToResults,
    goToInitial,
  }
}
