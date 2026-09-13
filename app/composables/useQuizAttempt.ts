import { api } from '#convex/api'
import type { Id } from '../../convex/_generated/dataModel'
import { createSsrMutationStub } from '~/utils/convexSsrMutation'

export interface AttemptSettings {
  shuffleQuestions: boolean
  showAllQuestions: boolean
  immediateFeedback: boolean
}

export interface AttemptQuestion {
  _id: Id<'quizQuestions'>
  quizId: Id<'quizzes'>
  order: number
  question: string
  type: 'multiple-choice' | 'free-response' | 'true_false' | 'fill_in_the_blank'
  options?: string[]
  correctAnswer: string
  explanation?: string
}

export interface AnswerFeedback {
  isCorrect: boolean
  correctAnswer: string
  explanation?: string
  alreadyAnswered: boolean
}

export function useQuizAttempt(quizId: Ref<Id<'quizzes'> | null>) {
  const startAttemptMutation = import.meta.client
    ? useConvexMutation(api.quizzes.startAttempt)
    : createSsrMutationStub<typeof api.quizzes.startAttempt>()

  const submitAnswerMutation = import.meta.client
    ? useConvexMutation(api.quizzes.submitAnswer)
    : createSsrMutationStub<typeof api.quizzes.submitAnswer>()

  const submitAllMutation = import.meta.client
    ? useConvexMutation(api.quizzes.submitAllAnswers)
    : createSsrMutationStub<typeof api.quizzes.submitAllAnswers>()

  const completeAttemptMutation = import.meta.client
    ? useConvexMutation(api.quizzes.completeAttempt)
    : createSsrMutationStub<typeof api.quizzes.completeAttempt>()

  const abandonAttemptMutation = import.meta.client
    ? useConvexMutation(api.quizzes.abandonAttempt)
    : createSsrMutationStub<typeof api.quizzes.abandonAttempt>()

  const attemptId = ref<Id<'quizAttempts'> | null>(null)
  const settings = ref<AttemptSettings | null>(null)
  const questions = ref<AttemptQuestion[]>([])
  const currentQuestionIndex = ref(0)
  const answeredQuestionIds = ref<Set<string>>(new Set())
  const submitting = ref(false)
  const isResumed = ref(false)

  async function startAttempt(attemptSettings: AttemptSettings, restart = false) {
    if (!quizId.value) return null
    submitting.value = true
    try {
      const result = await startAttemptMutation.mutate({
        quizId: quizId.value,
        settings: attemptSettings,
        restart,
      }) as {
        status: 'started' | 'resumed'
        attemptId: Id<'quizAttempts'>
        settings: AttemptSettings
        currentQuestionIndex: number
        questions: AttemptQuestion[]
        answeredQuestionIds: string[]
        answers: Array<{ questionId: Id<'quizQuestions'>; userAnswer: string; isCorrect: boolean }>
      }

      attemptId.value = result.attemptId
      settings.value = result.settings
      questions.value = result.questions
      currentQuestionIndex.value = result.currentQuestionIndex
      answeredQuestionIds.value = new Set(result.answeredQuestionIds)
      isResumed.value = result.status === 'resumed'

      return result
    }
    finally {
      submitting.value = false
    }
  }

  async function submitAnswer(questionId: Id<'quizQuestions'>, userAnswer: string): Promise<AnswerFeedback | null> {
    if (!attemptId.value) return null
    submitting.value = true
    try {
      const result = await submitAnswerMutation.mutate({
        attemptId: attemptId.value,
        questionId,
        userAnswer,
      }) as AnswerFeedback

      answeredQuestionIds.value = new Set([...answeredQuestionIds.value, questionId as string])
      currentQuestionIndex.value = Math.min(currentQuestionIndex.value + 1, questions.value.length)

      return result
    }
    finally {
      submitting.value = false
    }
  }

  async function submitAllAnswers(answers: Array<{ questionId: Id<'quizQuestions'>; userAnswer: string }>) {
    if (!attemptId.value) return null
    submitting.value = true
    try {
      return await submitAllMutation.mutate({
        attemptId: attemptId.value,
        answers,
      }) as { score: number; total: number; percentage: number; results: Array<{ questionId: Id<'quizQuestions'>; isCorrect: boolean; correctAnswer: string; explanation?: string; userAnswer: string }> }
    }
    finally {
      submitting.value = false
    }
  }

  async function completeAttempt() {
    if (!attemptId.value) return null
    submitting.value = true
    try {
      return await completeAttemptMutation.mutate({ attemptId: attemptId.value }) as { score: number; total: number; percentage: number }
    }
    finally {
      submitting.value = false
    }
  }

  async function abandonAttempt() {
    if (!attemptId.value) return
    await abandonAttemptMutation.mutate({ attemptId: attemptId.value })
    reset()
  }

  function reset() {
    attemptId.value = null
    settings.value = null
    questions.value = []
    currentQuestionIndex.value = 0
    answeredQuestionIds.value = new Set()
    isResumed.value = false
  }

  const progress = computed(() => ({
    answered: answeredQuestionIds.value.size,
    total: questions.value.length,
    percentage: questions.value.length > 0
      ? Math.round((answeredQuestionIds.value.size / questions.value.length) * 100)
      : 0,
  }))

  const allAnswered = computed(() =>
    questions.value.length > 0 && answeredQuestionIds.value.size >= questions.value.length,
  )

  const currentQuestion = computed(() =>
    questions.value[currentQuestionIndex.value] ?? null,
  )

  const isLastQuestion = computed(() =>
    currentQuestionIndex.value >= questions.value.length - 1,
  )

  return {
    attemptId: readonly(attemptId),
    settings: readonly(settings),
    questions: readonly(questions),
    currentQuestionIndex,
    answeredQuestionIds: readonly(answeredQuestionIds),
    submitting: readonly(submitting),
    isResumed: readonly(isResumed),
    progress,
    allAnswered,
    currentQuestion,
    isLastQuestion,
    startAttempt,
    submitAnswer,
    submitAllAnswers,
    completeAttempt,
    abandonAttempt,
    reset,
  }
}
