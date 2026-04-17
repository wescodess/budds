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
  latestAttemptStatus?: 'in_progress' | 'completed' | 'abandoned'
  difficulty?: string
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
    : { mutate: async (_args: unknown): Promise<any> => null, isLoading: ref(false) }

  const updateQuizMutation = import.meta.client
    ? useConvexMutation(api.quizzes.updateQuiz)
    : { mutate: async (_args: unknown): Promise<any> => null, isLoading: ref(false) }

  const deleteQuizMutation = import.meta.client
    ? useConvexMutation(api.quizzes.deleteQuiz)
    : { mutate: async (_args: unknown): Promise<any> => null, isLoading: ref(false) }

  const generating = ref(false)
  const lastError = ref<string | null>(null)

  async function generate(options: {
    model?: string
    questionCount?: number
    topics?: string[]
    questionTypes?: string[]
    difficulty?: string
  } = {}) {
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
          type: 'multiple-choice' | 'free-response' | 'true_false' | 'fill_in_the_blank'
          options?: string[]
          correctAnswer: string
          explanation?: string
          sourceDocumentId?: string
          sourceChunkContent?: string
          sourceFilename?: string
        }>
      }>('/api/quiz/generate', {
        method: 'POST',
        body: { folderId: id.value, ...options },
      })

      await createQuizMutation.mutate({
        folderId: id.value,
        title: generated.title,
        model: generated.model,
        creationMethod: 'auto_generated' as const,
        difficulty: options.difficulty,
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

  async function updateQuiz(quizId: Id<'quizzes'>, patch: { title?: string; description?: string; difficulty?: string }) {
    await updateQuizMutation.mutate({ quizId, ...patch })
  }

  async function deleteQuiz(quizId: Id<'quizzes'>) {
    await deleteQuizMutation.mutate({ quizId })
  }

  return {
    quizzes,
    hasIndexedDocuments,
    generating,
    lastError,
    generate,
    updateQuiz,
    deleteQuiz,
  }
}
