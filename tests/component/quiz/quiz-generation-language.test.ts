import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useQuizGeneration } from '~/composables/useQuizGeneration'
import { useQuizzes } from '~/composables/useQuizzes'

const fetchMock = vi.hoisted(() => vi.fn())
const useConvexMutationMock = vi.hoisted(() => vi.fn())

mockNuxtImport('$fetch', () => fetchMock)
mockNuxtImport('useConvexMutation', () => useConvexMutationMock)
mockNuxtImport('useConvexQuery', () => () => ({ data: ref([]) }))
mockNuxtImport('useDocuments', () => () => ({ documents: ref([{ status: 'success' }]) }))

describe('English quiz generation boundary', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    useConvexMutationMock.mockReset()
  })

  it('sends explicit English metadata from the task-backed generation caller', async () => {
    const createTask = vi.fn().mockResolvedValue({ taskId: 'task_1' })
    useConvexMutationMock.mockReturnValue({ mutate: createTask })
    fetchMock.mockResolvedValue({})
    const generation = useQuizGeneration(ref('folder_1' as never))

    await generation.generateQuiz()
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/api/quiz/generate', expect.objectContaining({
      method: 'POST',
      body: expect.objectContaining({ folderId: 'folder_1', language: 'en' }),
    }))
  })

  it('preserves explicit English metadata through client-side quiz persistence', async () => {
    const createQuiz = vi.fn().mockResolvedValue({ quizId: 'quiz_1' })
    useConvexMutationMock
      .mockReturnValueOnce({ mutate: createQuiz })
      .mockReturnValue({ mutate: vi.fn() })
    fetchMock.mockResolvedValue({
      title: 'English quiz',
      model: 'openai/gpt-4o-mini',
      questionCount: 1,
      questions: [{ order: 0, question: 'What is ATP?', type: 'free-response', correctAnswer: 'Energy currency' }],
    })
    const quizzes = useQuizzes(ref('folder_1' as never))

    await quizzes.generate()

    expect(fetchMock).toHaveBeenCalledWith('/api/quiz/generate', {
      method: 'POST',
      body: { folderId: 'folder_1', language: 'en' },
    })
    expect(createQuiz).toHaveBeenCalledWith(expect.objectContaining({ language: 'en' }))
  })
})
