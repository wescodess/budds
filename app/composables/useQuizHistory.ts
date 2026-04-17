import type { Id } from '../../convex/_generated/dataModel'

export interface AttemptHistoryItem {
  _id: Id<'quizAttempts'>
  _creationTime: number
  score: number
  total: number
  percentage: number
  status: string
  startedAt: number
  completedAt?: number
  currentQuestionIndex?: number
}

export function useQuizHistory(_quizId: Ref<Id<'quizzes'> | null>) {
  const attempts = ref<AttemptHistoryItem[]>([])

  const hasInProgressAttempt = computed(() =>
    attempts.value.some(a => a.status === 'in_progress'),
  )

  const inProgressAttempt = computed(() =>
    attempts.value.find(a => a.status === 'in_progress') ?? null,
  )

  const latestCompletedAttempt = computed(() =>
    attempts.value.find(a => a.status === 'completed') ?? null,
  )

  function setAttempts(data: AttemptHistoryItem[]) {
    attempts.value = data
  }

  return {
    attempts: readonly(attempts),
    hasInProgressAttempt,
    inProgressAttempt,
    latestCompletedAttempt,
    setAttempts,
  }
}
