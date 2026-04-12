import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'

// Mock factories — mutated per-test to drive the three render branches the Quiz tab
// renders (AC #7). NOTE (Decision — Epic 5 retro prep #3, Reka-portal mountSuspended):
// QuizTab intentionally avoids introducing any new portaled primitive. The four
// assertions below all run against the tab's non-portal surface (empty states,
// generate button, list cards), so mountSuspended exposes everything we need.
// If Story 6.2 adds a Select / DropdownMenu (Reka portals) inside the tab, that
// story owns extending this test — see Story 6.1 Dev Agent Record.
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

    expect(wrapper.find('[data-testid="quiz-empty-no-docs"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="quiz-generate-button"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Upload and index documents to generate quizzes')
  })

  it('[P0] renders empty-ready state with Generate button when docs indexed but no quizzes', async () => {
    const QuizTab = await import(quizTabPath)
    mockHasIndexedDocuments.value = true
    mockQuizzes.value = []

    const wrapper = await mountSuspended(QuizTab.default, {
      props: { folderId: 'folder_abc' },
    })

    expect(wrapper.find('[data-testid="quiz-empty-ready"]').exists()).toBe(true)
    const generateBtn = wrapper.find('[data-testid="quiz-generate-button"]')
    expect(generateBtn.exists()).toBe(true)
    expect(generateBtn.text()).toContain('Generate Quiz')
  })

  it('[P0] invokes generate() when the Generate button is clicked', async () => {
    const QuizTab = await import(quizTabPath)
    mockHasIndexedDocuments.value = true
    mockQuizzes.value = []
    mockGenerate.mockResolvedValue(undefined)

    const wrapper = await mountSuspended(QuizTab.default, {
      props: { folderId: 'folder_abc' },
    })

    await wrapper.find('[data-testid="quiz-generate-button"]').trigger('click')
    await flushPromises()

    expect(mockGenerate).toHaveBeenCalledTimes(1)
  })

  it('[P0] renders one card per quiz in the list state', async () => {
    const QuizTab = await import(quizTabPath)
    mockHasIndexedDocuments.value = true
    mockQuizzes.value = [
      {
        _id: 'quiz_1',
        _creationTime: Date.now(),
        title: 'Cellular Biology Quiz',
        status: 'ready',
        questionCount: 5,
      },
      {
        _id: 'quiz_2',
        _creationTime: Date.now() - 86_400_000,
        title: 'Krebs Cycle Quiz',
        status: 'ready',
        score: 80,
        questionCount: 8,
      },
    ]

    const wrapper = await mountSuspended(QuizTab.default, {
      props: { folderId: 'folder_abc' },
    })

    const cards = wrapper.findAll('[data-testid="quiz-card"]')
    expect(cards).toHaveLength(2)
    expect(wrapper.text()).toContain('Cellular Biology Quiz')
    expect(wrapper.text()).toContain('Krebs Cycle Quiz')
    expect(wrapper.find('[data-testid="quiz-score-badge"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="quiz-score-badge"]').text()).toContain('80')
  })

  it('[P0] quiz-card-menu toggles inline actions row with Edit and Delete (Story 6.3 AC #3)', async () => {
    const QuizTab = await import(quizTabPath)
    mockHasIndexedDocuments.value = true
    mockQuizzes.value = [
      {
        _id: 'quiz_1',
        _creationTime: Date.now(),
        title: 'Bio',
        status: 'ready',
        questionCount: 5,
      },
    ]

    const wrapper = await mountSuspended(QuizTab.default, {
      props: { folderId: 'folder_abc' },
    })

    expect(wrapper.find('[data-testid="quiz-card-actions"]').exists()).toBe(false)
    await wrapper.find('[data-testid="quiz-card-menu"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="quiz-card-actions"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="quiz-card-edit"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="quiz-card-delete"]').exists()).toBe(true)
  })

  it('[P0] delete flow: Delete → Confirm delete invokes deleteQuiz mutation (Story 6.3 AC #4)', async () => {
    const QuizTab = await import(quizTabPath)
    mockHasIndexedDocuments.value = true
    mockQuizzes.value = [
      {
        _id: 'quiz_1',
        _creationTime: Date.now(),
        title: 'Bio',
        status: 'ready',
        questionCount: 5,
      },
    ]
    mockDeleteQuiz.mockResolvedValue(undefined)

    const wrapper = await mountSuspended(QuizTab.default, {
      props: { folderId: 'folder_abc' },
    })

    await wrapper.find('[data-testid="quiz-card-menu"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-testid="quiz-card-delete"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="quiz-card-delete-confirm"]').exists()).toBe(true)
    await wrapper.find('[data-testid="quiz-card-delete-confirm"]').trigger('click')
    await flushPromises()

    expect(mockDeleteQuiz).toHaveBeenCalledTimes(1)
    expect(mockDeleteQuiz.mock.calls[0]![0]).toEqual({ quizId: 'quiz_1' })
  })

  it('[P1] renders shimmer placeholders while generating', async () => {
    const QuizTab = await import(quizTabPath)
    mockHasIndexedDocuments.value = true
    mockGenerating.value = true

    const wrapper = await mountSuspended(QuizTab.default, {
      props: { folderId: 'folder_abc' },
    })

    expect(wrapper.find('[data-testid="quiz-shimmer"]').exists()).toBe(true)
  })
})
