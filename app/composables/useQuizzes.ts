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

  const createQuizMutation = import.meta.client
    ? useConvexMutation(api.quizzes.createWithQuestions)
    : {
        mutate: async (_args: unknown): Promise<any> => null,
        isLoading: ref(false),
      }

  const generating = ref(false)
  const lastError = ref<string | null>(null)

  async function generate(options: { model?: string; questionCount?: number } = {}) {
    if (generating.value) return
    generating.value = true
    lastError.value = null
    try {
      const generated = await $fetch<{
        title: string
        model: string
        questionCount: number
        questions: Array<{
          order: number
          question: string
          type: 'multiple-choice' | 'free-response'
          options?: string[]
          correctAnswer: string
          sourceDocumentId?: string
          sourceChunkContent: string
          sourceFilename: string
        }>
      }>('/api/quiz/generate', {
        method: 'POST',
        body: {
          folderId: id.value,
          ...options,
        },
      })

      await createQuizMutation.mutate({
        folderId: id.value,
        title: generated.title,
        model: generated.model,
        questions: generated.questions,
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
