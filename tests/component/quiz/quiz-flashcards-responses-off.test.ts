import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { getFunctionName } from 'convex/server'

const quizData = ref<any>(null)
const quizError = ref<any>(null)
const resultsData = ref<any>(null)
const resultsError = ref<any>(null)
const roomData = ref<any>(null)
const roomError = ref<any>(null)
const versionsData = ref<any>(null)
const versionsError = ref<any>(null)
const attemptsData = ref<any>([])

mockNuxtImport('useConvexQuery', () => (reference: any) => {
  const name = getFunctionName(reference) ?? ''
  if (name === 'quizzes:getWithQuestions') return { data: quizData, error: quizError }
  if (name === 'quizzes:getAttemptResults') return { data: resultsData, error: resultsError }
  if (name === 'flashcardRooms:getRoom') return { data: roomData, error: roomError }
  if (name === 'flashcardRooms:listRoomVersions') return { data: versionsData, error: versionsError }
  if (name === 'quizzes:listAttempts') return { data: attemptsData, error: ref(null) }
  return { data: ref(null), error: ref(null) }
})
mockNuxtImport('useConvexMutation', () => () => ({ mutate: vi.fn(), isLoading: ref(false) }))
mockNuxtImport('useMotionPresets', () => () => ({ springGentle: {} }))
mockNuxtImport('useTasks', () => () => ({ tasks: ref([]), activeCount: ref(0), cancel: vi.fn(), dismiss: vi.fn(), retry: vi.fn() }))

const ssrError = () => new Error('SSR query failed')
const denied = (reasonCode: string) => Object.assign(new Error('denied'), { data: { admission: { status: 'denied', reasonCode } } })
const quiz = {
  quiz: { _id: 'quiz_1', _creationTime: 1, title: 'Cell Biology Quiz', status: 'ready', userId: 'user_test', folderId: 'folder_1' },
  questions: [{ _id: 'q_1', _creationTime: 1, quizId: 'quiz_1', userId: 'user_test', order: 0, type: 'true_false', question: 'Cells have membranes.', correctAnswer: 'True', explanation: 'They do.' }],
}
const blockQuiz = { quiz: { title: 'Practice' }, questions: [{ _id: 'q_1', question: 'Cells have membranes.', type: 'multiple-choice', options: ['True', 'False'], correctAnswer: 'True', explanation: 'They do.', order: 0 }] }
const room = {
  room: { _id: 'room_1', _creationTime: Date.now(), title: 'Cell Biology', userId: 'user_a', folderId: 'folder_abc', updatedAt: Date.now() },
  cards: [{ _id: 'c1', displayOrder: 0, term: 'Mitosis', definition: 'Cell division' }],
}
const failureIds = ['quiz-read-paused', 'quiz-read-error', 'flashcards-read-paused', 'flashcards-read-error', 'flashcard-block-read-paused', 'flashcard-block-read-error']
const stubs = { Motion: { template: '<div><slot /></div>' }, AnimatePresence: { template: '<div><slot /></div>' } }
const path = (...parts: string[]) => ['~', 'components', ...parts].join('/')

const mounted: Array<{ unmount: () => void }> = []
async function mount(componentPath: string, props: Record<string, unknown>) {
  const Comp = await import(componentPath)
  const wrapper = await mountSuspended(Comp.default, { props, global: { stubs } })
  mounted.push(wrapper)
  await flushPromises()
  return wrapper
}
function expectNoFailureUi(wrapper: { find: (selector: string) => { exists: () => boolean } }) {
  for (const id of failureIds) expect(wrapper.find(`[data-testid="${id}"]`).exists()).toBe(false)
}

describe('quiz and flashcard surfaces with responses off', () => {
  afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount()
  })
  beforeEach(() => {
    for (const value of [quizData, quizError, resultsData, resultsError, roomData, roomError, versionsData, versionsError]) value.value = null
    attemptsData.value = []
    document.body.innerHTML = ''
  })

  it('Taker shows content that arrives after an SSR error, exactly as on dev', async () => {
    quizError.value = ssrError()
    const wrapper = await mount(path('quiz', 'Taker.vue'), { quizId: 'quiz_1' })
    quizData.value = quiz
    await flushPromises()
    expect(quizError.value).not.toBeNull()
    expect(wrapper.text()).toContain('Cells have membranes.')
    expect(wrapper.find('[data-testid="quiz-submit-button"]').exists()).toBe(true)
    expectNoFailureUi(wrapper)
  })

  it('Taker keeps revealed results when a denial-shaped error appears', async () => {
    quizData.value = quiz
    attemptsData.value = [{ _id: 'attempt_1', score: 0, total: 1, answers: [{ questionId: 'q_1', isCorrect: false, response: 'False' }] }]
    const wrapper = await mount(path('quiz', 'Taker.vue'), { quizId: 'quiz_1' })
    expect(wrapper.find('[data-testid="quiz-result-incorrect"]').exists()).toBe(true)
    quizError.value = denied('test_open')
    await flushPromises()
    expect(wrapper.find('[data-testid="quiz-result-incorrect"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="quiz-results-score"]').exists()).toBe(true)
    expectNoFailureUi(wrapper)
  })

  for (const [name, props] of [['OverviewView.vue', { quizId: 'quiz_1' }], ['Editor.vue', { quizId: 'quiz_1' }], ['CardPreview.vue', { quizId: 'quiz_1' }]] as const) {
    it(`${name} renders content despite a stale error`, async () => {
      quizError.value = ssrError()
      const wrapper = await mount(path('quiz', name), props)
      quizData.value = quiz
      await flushPromises()
      expect(wrapper.html()).toContain('Cells have membranes.')
      expectNoFailureUi(wrapper)
    })
  }

  it('ResultsView renders graded results despite a denial-shaped error', async () => {
    resultsError.value = denied('test_open')
    resultsData.value = { score: 1, total: 1, percentage: 100, startedAt: 1, completedAt: 2, status: 'completed', results: [{ questionId: 'q_1', questionText: 'Cells have membranes.', questionType: 'free-response', userAnswer: 'Yes', isCorrect: true, correctAnswer: 'True' }] }
    const wrapper = await mount(path('quiz', 'ResultsView.vue'), { quizId: 'quiz_1', attemptId: 'attempt_1' })
    expect(wrapper.text()).toContain('Cells have membranes.')
    expectNoFailureUi(wrapper)
  })

  it('QuizBlock keeps checked answers and offline questions when a denial-shaped error appears', async () => {
    quizData.value = blockQuiz
    const offlineData = { questions: [{ question: 'Offline question', type: 'multiple-choice', options: ['True', 'False'], correctAnswer: 'True', explanation: 'Offline explanation', order: 0 }] }
    const wrapper = await mount(path('learn', 'QuizBlock.vue'), { quizId: 'quiz_1', isOffline: false, offlineData })
    await wrapper.findAll('button').find(button => button.text() === 'False')!.trigger('click')
    await wrapper.findAll('button').find(button => button.text().includes('Check'))!.trigger('click')
    expect(wrapper.text()).toContain('They do.')

    quizError.value = denied('test_open')
    await flushPromises()
    expect(wrapper.text()).toContain('They do.')
    expectNoFailureUi(wrapper)

    await wrapper.setProps({ isOffline: true })
    await flushPromises()
    expect(wrapper.text()).toContain('Offline question')
    expectNoFailureUi(wrapper)
  })

  it('RoomShell shows cards that arrive after an SSR error, with actions enabled', async () => {
    roomError.value = ssrError()
    const wrapper = await mount(path('flashcards', 'RoomShell.vue'), { roomId: 'room_1', folderId: 'folder_abc' })
    roomData.value = room
    await flushPromises()
    expect(wrapper.get('[data-testid="flashcard-room-title"]').text()).toBe('Cell Biology')
    expect(wrapper.text()).toContain('Mitosis')
    for (const id of ['flashcard-room-mode-editor', 'flashcard-room-mode-practice', 'flashcard-room-history-toggle', 'flashcard-room-generate-trigger']) {
      expect(wrapper.get(`[data-testid="${id}"]`).attributes('disabled')).toBeUndefined()
    }
    expectNoFailureUi(wrapper)
  })

  it('RoomShell keeps practice mode when a denial-shaped error appears', async () => {
    roomData.value = room
    const wrapper = await mount(path('flashcards', 'RoomShell.vue'), { roomId: 'room_1', folderId: 'folder_abc' })
    await wrapper.get('[data-testid="flashcard-room-mode-practice"]').trigger('click')
    await flushPromises()
    roomError.value = denied('test_open')
    await flushPromises()
    expect(wrapper.text()).toContain('Mitosis')
    expect(wrapper.get('[data-testid="flashcard-room-mode-practice"]').attributes('disabled')).toBeUndefined()
    expectNoFailureUi(wrapper)
  })

  it('RoomHistoryPanel shows the empty history despite a stale error', async () => {
    versionsError.value = ssrError()
    versionsData.value = []
    const Comp = await import(path('flashcards', 'RoomHistoryPanel.vue'))
    mounted.push(await mountSuspended(Comp.default, { props: { open: true, roomId: 'room_1' } }))
    await flushPromises()
    expect(document.querySelector('[data-testid="flashcard-room-history-empty"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="flashcard-history-read-error"]')).toBeNull()
  })

  it('FlashcardBlock shows cards and offline cards despite a denial-shaped error', async () => {
    roomData.value = { room: { title: 'Test Room' }, cards: [{ _id: 'c1', term: 'Mitosis', definition: 'Cell division', displayOrder: 0 }] }
    roomError.value = denied('test_open')
    const wrapper = await mount(path('learn', 'FlashcardBlock.vue'), { roomId: 'room_123', isOffline: false, offlineData: { cards: [{ term: 'Offline term', definition: 'Offline definition' }] } })
    expect(wrapper.text()).toContain('Mitosis')
    expect(wrapper.find('[data-testid="flag-button"]').exists()).toBe(true)
    expectNoFailureUi(wrapper)
    await wrapper.setProps({ isOffline: true })
    await flushPromises()
    expect(wrapper.text()).toContain('Offline term')
    expectNoFailureUi(wrapper)
  })
})
