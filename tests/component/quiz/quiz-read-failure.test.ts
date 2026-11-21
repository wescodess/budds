import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { getFunctionName } from 'convex/server'

const teachingData = ref<any>(null)
const teachingError = ref<any>(null)
const refresh = vi.fn()
const attemptsData = ref<any>([])

mockNuxtImport('useConvexQuery', () => (reference: any) => {
  const name = getFunctionName(reference) ?? ''
  if (name.includes('getWithQuestions') || name.includes('getAttemptResults')) return { data: teachingData, error: teachingError, refresh }
  if (name.includes('listAttempts')) return { data: attemptsData, error: ref(null), refresh: vi.fn() }
  return { data: ref([]), error: ref(null), refresh: vi.fn() }
})
mockNuxtImport('useConvexMutation', () => () => ({ mutate: vi.fn(), isLoading: ref(false) }))
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
  const wrapper = await mountSuspended(Comp.default, { props: mountProps })
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
    teachingData.value = null
    teachingError.value = null
    attemptsData.value = []
    refresh.mockReset().mockImplementation(() => {
      teachingError.value = null
      teachingData.value = quiz
    })
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
        await wrapper.get('[data-testid="quiz-read-retry"]').trigger('click')
        expect(refresh).toHaveBeenCalledTimes(1)
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
      refresh.mockReset()
      teachingError.value = denied('test_open')
      const wrapper = await mount(name)
      expect(wrapper.get('[data-testid="quiz-read-paused"]').text()).toContain('This is paused while you have a check open.')
      teachingError.value = new Error('Network down')
      await flushPromises()
      await wrapper.get('[data-testid="quiz-read-retry"]').trigger('click')
      expect(refresh).toHaveBeenCalledTimes(1)
    })
  }

  describe('when a denial arrives after content was shown', () => {
    const offlineData = { questions: [{ question: 'Offline question', type: 'multiple-choice', options: ['True', 'False'], correctAnswer: 'True', explanation: 'Offline explanation', order: 0 }] }

    it('Taker drops the revealed answers, score and actions', async () => {
      teachingData.value = quiz
      attemptsData.value = [{ _id: 'attempt_1', score: 0, total: 1, answers: [{ questionId: 'q_1', isCorrect: false, response: 'False' }] }]
      const wrapper = await mount('Taker')
      await flushPromises()
      expect(wrapper.text()).toContain('Cells have membranes.')
      expect(wrapper.find('[data-testid="quiz-result-incorrect"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="quiz-results-score"]').exists()).toBe(true)

      teachingError.value = denied('test_open')
      teachingData.value = null
      await flushPromises()
      expect(wrapper.get('[data-testid="quiz-read-paused"]').text()).toContain('This is paused while you have a check open.')
      expect(wrapper.text()).not.toContain('Cells have membranes.')
      expect(wrapper.find('[data-testid="quiz-result-incorrect"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="quiz-results-score"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="quiz-taker-retake"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="quiz-submit-button"]').exists()).toBe(false)
    })

    it('QuizBlock drops revealed answers and never falls back to offline questions after test_open', async () => {
      teachingData.value = { quiz: { title: 'Practice' }, questions: [{ _id: 'q_1', question: 'Cells have membranes.', type: 'multiple-choice', options: ['True', 'False'], correctAnswer: 'True', explanation: 'They do.', order: 0 }] }
      const wrapper = await mountTracked(paths.QuizBlock, { quizId: 'quiz_1', isOffline: false, offlineData })
      await wrapper.findAll('button').find(button => button.text() === 'False')!.trigger('click')
      await wrapper.findAll('button').find(button => button.text().includes('Check'))!.trigger('click')
      expect(wrapper.text()).toContain('They do.')

      teachingError.value = denied('test_open')
      teachingData.value = null
      await flushPromises()
      expect(wrapper.get('[data-testid="quiz-read-paused"]').exists()).toBe(true)
      expect(wrapper.text()).not.toContain('They do.')

      await wrapper.setProps({ isOffline: true })
      await flushPromises()
      expect(wrapper.get('[data-testid="quiz-read-paused"]').exists()).toBe(true)
      expect(wrapper.text()).not.toContain('Offline question')
      expect(wrapper.text()).not.toContain('Offline explanation')

      teachingError.value = null
      teachingData.value = { quiz: { title: 'Practice' }, questions: [{ _id: 'q_1', question: 'Cells have membranes.', type: 'multiple-choice', options: ['True', 'False'], correctAnswer: 'True', explanation: 'They do.', order: 0 }] }
      await wrapper.setProps({ isOffline: false })
      await flushPromises()
      expect(wrapper.text()).toContain('Cells have membranes.')
      expect(wrapper.text()).not.toContain('They do.')
    })

    it('ResultsView drops the graded attempt', async () => {
      teachingData.value = { score: 1, total: 1, percentage: 100, startedAt: 1, completedAt: 2, status: 'completed', results: [{ questionId: 'q_1', questionText: 'Cells have membranes.', questionType: 'free-response', userAnswer: 'Yes', isCorrect: true, correctAnswer: 'True' }] }
      const wrapper = await mount('ResultsView')
      await flushPromises()
      expect(wrapper.text()).toContain('Cells have membranes.')
      teachingError.value = denied('disclosure_unknown')
      teachingData.value = null
      await flushPromises()
      expect(wrapper.get('[data-testid="quiz-read-paused"]').text()).toContain('This isn’t available right now.')
      expect(wrapper.text()).not.toContain('Cells have membranes.')
    })
  })
})
