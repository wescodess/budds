import { api } from '#convex/api'
import type { Id } from '../../convex/_generated/dataModel'

export interface QuizSummary {
  _id: Id<'quizzes'>
  _creationTime: number
  title: string
  status: 'generating' | 'ready' | 'failed'
  score?: number
  completedAt?: number
  questionCount: number
}

export function useQuizzes(folderId: Ref<Id<'folders'>> | Id<'folders'>) {
  const id = isRef(folderId) ? folderId : ref(folderId)

  const { documents } = useDocuments(id)

  const hasIndexedDocuments = computed(() =>
    documents.value?.some((d) => d.status === 'success') ?? false,
  )

  const { data: quizzesData } = useConvexQuery(
    api.quizzes.listByFolder,
    computed(() => ({ folderId: id.value })),
  )

  const quizzes = computed<QuizSummary[]>(() => (quizzesData.value as QuizSummary[] | undefined) ?? [])

  const generating = ref(false)
  const lastError = ref<string | null>(null)

  async function generate(options: { model?: string; questionCount?: number } = {}) {
    if (generating.value) return
    generating.value = true
    lastError.value = null
    try {
      await $fetch<{ quizId: string; title: string; questionCount: number }>('/api/quiz/generate', {
        method: 'POST',
        body: {
          folderId: id.value,
          ...options,
        },
      })
    }
    catch (e: any) {
      const message = e?.data?.message || e?.statusMessage || e?.message || 'Quiz generation failed'
      lastError.value = message
      throw e
    }
    finally {
      generating.value = false
    }
  }

  return {
    quizzes,
    hasIndexedDocuments,
    generating,
    lastError,
    generate,
  }
}
