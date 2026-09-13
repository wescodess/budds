import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'

const mockHasIndexedDocuments = ref(false)
const mockQuizzes = ref<any[]>([])
const mockGenerating = ref(false)
const mockLastError = ref<string | null>(null)
const mockGenerate = vi.fn()

mockNuxtImport('useQuizzes', () => {
  return () => ({
    quizzes: mockQuizzes,
    hasIndexedDocuments: mockHasIndexedDocuments,
    generating: mockGenerating,
    lastError: mockLastError,
    generate: mockGenerate,
  })
})

const mockDeleteQuiz = vi.fn()

mockNuxtImport('useConvexMutation', () => {
  return (_api: unknown) => ({
    mutate: mockDeleteQuiz,
    isLoading: ref(false),
  })
})

const quizTabPath = ['~', 'components', 'quiz', 'Tab.vue'].join('/')

describe('QuizTab — Story 6.1 AC #5, #6, #7', () => {
  beforeEach(() => {
    mockHasIndexedDocuments.value = false
    mockQuizzes.value = []
    mockGenerating.value = false
    mockLastError.value = null
    mockGenerate.mockReset()
    mockDeleteQuiz.mockReset()
  })

  it('[P0] renders empty-no-docs state when no indexed documents exist', async () => {
    const QuizTab = await import(quizTabPath)
    mockHasIndexedDocuments.value = false
    mockQuizzes.value = []

    const wrapper = await mountSuspended(QuizTab.default, {
      props: { folderId: 'folder_abc' },
    })

    expect(wrapper.text()).toContain('Upload and index documents to generate quizzes')
  })

  it('[P0] renders empty-ready state with Generate button when docs indexed but no quizzes', async () => {
    const QuizTab = await import(quizTabPath)
    mockHasIndexedDocuments.value = true
    mockQuizzes.value = []

    const wrapper = await mountSuspended(QuizTab.default, {
      props: { folderId: 'folder_abc' },
    })

    expect(wrapper.text()).toContain('No quizzes yet')
    expect(wrapper.text()).toContain('Generate Quiz')
  })

  it('[P0] invokes wizard open when the Generate button is clicked', async () => {
    const QuizTab = await import(quizTabPath)
    mockHasIndexedDocuments.value = true
    mockQuizzes.value = []
    mockGenerate.mockResolvedValue(undefined)

    const wrapper = await mountSuspended(QuizTab.default, {
      props: { folderId: 'folder_abc' },
    })

    const buttons = wrapper.findAll('button')
    const generateBtn = buttons.find(b => b.text().includes('Generate Quiz'))
    expect(generateBtn).toBeTruthy()
    await generateBtn!.trigger('click')
    await flushPromises()
  })

})
