import { api } from '#convex/api'
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
}

export function useQuizHistory(quizId: Ref<Id<'quizzes'> | null>) {
  const { data: historyData } = useConvexQuery(
    api.quizzes.getQuizHistory,
    computed(() => quizId.value ? { quizId: quizId.value } : 'skip'),
  )

  const attempts = computed<AttemptHistoryItem[]>(() =>
    (historyData.value as AttemptHistoryItem[] | undefined) ?? [],
  )

  const hasInProgressAttempt = computed(() =>
    attempts.value.some(a => a.status === 'in_progress'),
  )

  const inProgressAttempt = computed(() =>
    attempts.value.find(a => a.status === 'in_progress') ?? null,
  )

  const latestCompletedAttempt = computed(() =>
    attempts.value.find(a => a.status === 'completed') ?? null,
  )

  return {
    attempts,
    hasInProgressAttempt,
    inProgressAttempt,
    latestCompletedAttempt,
  }
}
