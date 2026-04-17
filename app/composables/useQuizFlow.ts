import { api } from '#convex/api'
import type { Id } from '../../convex/_generated/dataModel'

export type QuizFlowState = 'initial' | 'overview' | 'taking' | 'results'

export function useQuizFlow(quizId: Ref<Id<'quizzes'> | null>) {
  const state = ref<QuizFlowState>('initial')
  const activeAttemptId = ref<Id<'quizAttempts'> | null>(null)

  const { data: quizData } = useConvexQuery(
    api.quizzes.getWithQuestions,
    computed(() => quizId.value ? { id: quizId.value } : 'skip'),
  )

  const quiz = computed(() => quizData.value?.quiz ?? null)
  const questions = computed(() => quizData.value?.questions ?? [])
  const hasQuestions = computed(() => questions.value.length > 0)

  watch(quizData, (val) => {
    if (state.value === 'taking' || state.value === 'results') return
    if (!val || !val.quiz) {
      state.value = 'initial'
      return
    }
    if (val.questions.length > 0) {
      state.value = 'overview'
    }
    else {
      state.value = 'initial'
    }
  }, { immediate: true })

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
    quiz,
    questions,
    hasQuestions,
    goToOverview,
    goToTaking,
    goToResults,
    goToInitial,
  }
}
