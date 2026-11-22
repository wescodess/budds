import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { getFunctionName } from 'convex/server'
import { resetTeachingReads, teachingClient, teachingRead } from '../support/teaching-reads'

vi.mock('#shared/learn-v2-measurement-storage-manifest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#shared/learn-v2-measurement-storage-manifest')>()
  return { ...actual, LEARN_MEASUREMENT_CAPABILITIES: { ...actual.LEARN_MEASUREMENT_CAPABILITIES, responses: true } }
})

const withQuestions = teachingRead('quizzes:getWithQuestions')
const attemptResults = teachingRead('quizzes:getAttemptResults')
attemptResults.data = withQuestions.data
attemptResults.error = withQuestions.error
const teachingData = withQuestions.data as Ref<any>
const teachingError = withQuestions.error as Ref<any>
const subscriptions = () => withQuestions.subscriptions + attemptResults.subscriptions
const attemptsData = ref<any>([])
const mutate = vi.fn()

mockNuxtImport('useConvex', () => () => teachingClient)
mockNuxtImport('useConvexQuery', () => (reference: any) => {
  const name = getFunctionName(reference) ?? ''
  if (name.includes('listAttempts')) return { data: attemptsData, error: ref(null), refresh: vi.fn() }
  return { data: ref([]), error: ref(null), refresh: vi.fn() }
})
mockNuxtImport('useConvexMutation', () => () => ({ mutate, isLoading: ref(false) }))
mockNuxtImport('useMotionPresets', () => () => ({ springGentle: {} }))

const denied = (reasonCode: string) => Object.assign(new Error('denied'), { data: { admission: { status: 'denied', reasonCode } } })
const quiz = {
  quiz: { _id: 'quiz_1', _creationTime: 1, title: 'Cell Biology Quiz', status: 'ready', userId: 'user_test', folderId: 'folder_1' },
  questions: [{ _id: 'q_1', _creationTime: 1, quizId: 'quiz_1', userId: 'user_test', order: 0, type: 'true_false', question: 'Cells have membranes.', correctAnswer: 'True', explanation: 'They do.' }],
}
const paths = {
  Taker: ['~', 'components', 'quiz', 'Taker.vue'].join('/'),
  QuizBlock: ['~', 'components', 'learn', 'QuizBlock.vue'].join('/'),
  OverviewView: ['~', 'components', 'quiz', 'OverviewView.vue'].join('/'),
  ResultsView: ['~', 'components', 'quiz', 'ResultsView.vue'].join('/'),
  Editor: ['~', 'components', 'quiz', 'Editor.vue'].join('/'),
  CardPreview: ['~', 'components', 'quiz', 'CardPreview.vue'].join('/'),
}
const props = {
  Taker: { quizId: 'quiz_1' },
  QuizBlock: { quizId: 'quiz_1' },
  OverviewView: { quizId: 'quiz_1' },
  ResultsView: { quizId: 'quiz_1', attemptId: 'attempt_1' },
  Editor: { quizId: 'quiz_1' },
  CardPreview: { quizId: 'quiz_1' },
}
const mounted: Array<{ unmount: () => void }> = []
async function mountTracked(path: string, mountProps: Record<string, unknown>) {
  const Comp = await import(path)
  const wrapper = await mountSuspended(Comp.default, { props: mountProps, global: { stubs: { Motion: { template: '<div><slot /></div>' } } } })
  mounted.push(wrapper)
  return wrapper
}
async function mount(name: keyof typeof paths) {
  return await mountTracked(paths[name], props[name])
}

describe('quiz teaching-read failures', () => {
  afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount()
  })
  beforeEach(() => {
    resetTeachingReads()
    mutate.mockReset()
    teachingData.value = null
    attemptsData.value = []
  })

  for (const name of ['Taker', 'QuizBlock'] as const) {
    describe(name, () => {
      it('pauses without a retry while a check is open', async () => {
        teachingError.value = denied('test_open')
        const wrapper = await mount(name)
        const paused = wrapper.get('[data-testid="quiz-read-paused"]')
        expect(paused.attributes('role')).toBe('status')
        expect(paused.text()).toContain('This is paused while you have a check open. Finish the check, then come back.')
        expect(wrapper.find('[data-testid="quiz-read-retry"]').exists()).toBe(false)
        expect(wrapper.text()).not.toContain('Loading')
        expect(wrapper.text()).not.toContain('Quiz not found')
      })

      it('says the content is unavailable when disclosure is unknown', async () => {
        teachingError.value = denied('disclosure_unknown')
        const wrapper = await mount(name)
        expect(wrapper.get('[data-testid="quiz-read-paused"]').text()).toContain('This isn’t available right now.')
        expect(wrapper.find('[data-testid="quiz-read-retry"]').exists()).toBe(false)
      })

      it('offers a retry for unavailable reads and recovers to the content', async () => {
        teachingError.value = denied('unavailable')
        const wrapper = await mount(name)
        expect(wrapper.get('[data-testid="quiz-read-error"]').attributes('role')).toBe('alert')
        const before = subscriptions()
        await wrapper.get('[data-testid="quiz-read-retry"]').trigger('click')
        expect(subscriptions()).toBe(before + 1)
        teachingError.value = null
        teachingData.value = quiz
        await flushPromises()
        expect(wrapper.find('[data-testid="quiz-read-error"]').exists()).toBe(false)
        expect(wrapper.text()).toContain('Cells have membranes.')
      })

      it('offers a retry for network failures', async () => {
        teachingError.value = new Error('Network down')
        const wrapper = await mount(name)
        expect(wrapper.get('[data-testid="quiz-read-error"]').text()).toContain('Try again')
      })
    })
  }

  it('keeps offline practice usable when the live read is unavailable', async () => {
    teachingError.value = denied('test_open')
    const wrapper = await mountTracked(paths.QuizBlock, { quizId: 'quiz_1', isOffline: true, offlineData: { questions: [{ question: 'Offline question', type: 'true_false', correctAnswer: 'True', order: 0 }] } })
    expect(wrapper.find('[data-testid="quiz-read-paused"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Offline question')
  })

  for (const name of ['OverviewView', 'ResultsView', 'Editor', 'CardPreview'] as const) {
    it(`${name} shows the paused state and the retryable error`, async () => {
      teachingError.value = denied('test_open')
      const wrapper = await mount(name)
      expect(wrapper.get('[data-testid="quiz-read-paused"]').text()).toContain('This is paused while you have a check open.')
      teachingError.value = new Error('Network down')
      await flushPromises()
      const before = subscriptions()
      await wrapper.get('[data-testid="quiz-read-retry"]').trigger('click')
      expect(subscriptions()).toBe(before + 1)
    })
  }

  describe('when a denial arrives after content was shown', () => {
    const offlineData = { questions: [{ question: 'Offline question', type: 'multiple-choice', options: ['True', 'False'], correctAnswer: 'True', explanation: 'Offline explanation', order: 0 }] }

    it.each(['test_open', 'unavailable'] as const)('Taker drops the revealed answers, score and actions (%s)', async (reason) => {
      teachingData.value = quiz
      attemptsData.value = [{ _id: 'attempt_1', score: 0, total: 1, answers: [{ questionId: 'q_1', isCorrect: false, response: 'False' }] }]
      const wrapper = await mount('Taker')
      await flushPromises()
      expect(wrapper.text()).toContain('Cells have membranes.')
      expect(wrapper.find('[data-testid="quiz-result-incorrect"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="quiz-results-score"]').exists()).toBe(true)

      teachingError.value = denied(reason)
      teachingData.value = null
      await flushPromises()
      expect(wrapper.get(`[data-testid="quiz-read-${reason === 'unavailable' ? 'error' : 'paused'}"]`).text()).toContain(reason === 'test_open' ? 'This is paused while you have a check open.' : 'Could not load')
      expect(wrapper.text()).not.toContain('Cells have membranes.')
      expect(wrapper.find('[data-testid="quiz-result-incorrect"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="quiz-results-score"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="quiz-taker-retake"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="quiz-submit-button"]').exists()).toBe(false)
    })

    it.each(['test_open', 'unavailable'] as const)('QuizBlock drops revealed answers and never falls back to offline questions after test_open (%s)', async (reason) => {
      teachingData.value = { quiz: { title: 'Practice' }, questions: [{ _id: 'q_1', question: 'Cells have membranes.', type: 'multiple-choice', options: ['True', 'False'], correctAnswer: 'True', explanation: 'They do.', order: 0 }] }
      const wrapper = await mountTracked(paths.QuizBlock, { quizId: 'quiz_1', isOffline: false, offlineData })
      await wrapper.findAll('button').find(button => button.text() === 'False')!.trigger('click')
      await wrapper.findAll('button').find(button => button.text().includes('Check'))!.trigger('click')
      expect(wrapper.text()).toContain('They do.')

      teachingError.value = denied(reason)
      teachingData.value = null
      await flushPromises()
      expect(wrapper.get(`[data-testid="quiz-read-${reason === 'unavailable' ? 'error' : 'paused'}"]`).exists()).toBe(true)
      expect(wrapper.text()).not.toContain('They do.')

      await wrapper.setProps({ isOffline: true })
      await flushPromises()
      expect(wrapper.get(`[data-testid="quiz-read-${reason === 'unavailable' ? 'error' : 'paused'}"]`).exists()).toBe(true)
      expect(wrapper.text()).not.toContain('Offline question')
      expect(wrapper.text()).not.toContain('Offline explanation')

      teachingError.value = null
      teachingData.value = { quiz: { title: 'Practice' }, questions: [{ _id: 'q_1', question: 'Cells have membranes.', type: 'multiple-choice', options: ['True', 'False'], correctAnswer: 'True', explanation: 'They do.', order: 0 }] }
      await wrapper.setProps({ isOffline: false })
      await flushPromises()
      expect(wrapper.text()).toContain('Cells have membranes.')
      expect(wrapper.text()).not.toContain('They do.')
    })

    it.each(['disclosure_unknown', 'unavailable'] as const)('ResultsView drops the graded attempt (%s)', async (reason) => {
      teachingData.value = { score: 1, total: 1, percentage: 100, startedAt: 1, completedAt: 2, status: 'completed', results: [{ questionId: 'q_1', questionText: 'Cells have membranes.', questionType: 'free-response', userAnswer: 'Yes', isCorrect: true, correctAnswer: 'True' }] }
      const wrapper = await mount('ResultsView')
      await flushPromises()
      expect(wrapper.text()).toContain('Cells have membranes.')
      teachingError.value = denied(reason)
      teachingData.value = null
      await flushPromises()
      expect(wrapper.get(`[data-testid="quiz-read-${reason === 'unavailable' ? 'error' : 'paused'}"]`).text()).toContain(reason === 'disclosure_unknown' ? 'This isn’t available right now.' : 'Could not load')
      expect(wrapper.text()).not.toContain('Cells have membranes.')
    })
  })
  it('keeps the offline quiz after a live transport failure', async () => {
    teachingData.value = quiz
    const wrapper = await mountTracked(paths.QuizBlock, { quizId: 'quiz_1', isOffline: false, offlineData: { questions: [{ question: 'Offline question', type: 'true_false', correctAnswer: 'True', order: 0 }] } })
    teachingError.value = new Error('Network down')
    await wrapper.setProps({ isOffline: true })
    expect(wrapper.text()).toContain('Offline question')
    expect(wrapper.find('[data-testid="quiz-read-error"]').exists()).toBe(false)
  })

  it('clears an editor draft after unavailable rather than restoring it on recovery', async () => {
    teachingData.value = quiz
    const wrapper = await mount('Editor')
    await wrapper.get('[data-testid="quiz-editor-question-edit"]').trigger('click')
    expect(wrapper.get('[data-testid="quiz-editor-question-text"]').element).toHaveProperty('value', 'Cells have membranes.')
    teachingError.value = denied('unavailable')
    await nextTick()
    expect(wrapper.find('[data-testid="quiz-read-retry"]').exists()).toBe(true)
    teachingError.value = null
    await nextTick()
    expect(wrapper.find('[data-testid="quiz-editor-question-text"]').exists()).toBe(false)
  })

  it('rejects a start-attempt result begun before unavailable, even after subscription recovery', async () => {
    teachingData.value = quiz
    const result = Promise.withResolvers<unknown>()
    mutate.mockReturnValue(result.promise)
    const Component = (await import('~/components/quiz/ActiveView.vue')).default
    const wrapper = await mountSuspended(Component, { props: { quizId: 'quiz_1' as never, folderId: 'folder_1' as never }, global: { stubs: {
      QuizOverviewView: { template: `<button data-testid="take" @click="$emit('take-quiz')">Take</button>` },
      QuizSettingsModal: { props: ['open'], template: `<button v-if="open" data-testid="start" @click="$emit('start', {})">Start</button>` },
      QuizResumeDialog: true,
      QuizTakingView: { props: ['questions'], template: '<div data-testid="taking">{{ questions }}</div>' },
      QuizResultsView: true,
    } } })
    mounted.push(wrapper)
    await wrapper.get('[data-testid="take"]').trigger('click')
    await wrapper.get('[data-testid="start"]').trigger('click')
    expect(mutate).toHaveBeenCalledTimes(1)
    teachingError.value = denied('unavailable')
    await nextTick()
    teachingError.value = null
    await nextTick()
    result.resolve({ questions: [{ question: 'Revoked start result' }], settings: {}, attemptId: 'attempt_1', currentQuestionIndex: 0, answeredQuestionIds: [] })
    await flushPromises()
    expect(wrapper.find('[data-testid="taking"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Revoked start result')
  })

  it('clears a retained overview title draft after unavailable', async () => {
    teachingData.value = quiz
    const wrapper = await mount('OverviewView')
    await wrapper.findAll('button').find(button => button.text() === 'Cell Biology Quiz')!.trigger('click')
    expect(wrapper.get('input').element).toHaveProperty('value', 'Cell Biology Quiz')
    teachingError.value = denied('unavailable')
    await nextTick()
    expect(wrapper.find('[data-testid="quiz-read-retry"]').exists()).toBe(true)
    teachingError.value = null
    await nextTick()
    expect(wrapper.find('input').exists()).toBe(false)
  })

})
