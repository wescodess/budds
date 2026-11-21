import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { getFunctionName } from 'convex/server'

const teachingData = ref<any>(null)
const teachingError = ref<any>(null)
const refresh = vi.fn()

mockNuxtImport('useConvexQuery', () => (reference: any) => {
  const name = getFunctionName(reference) ?? ''
  if (name.includes('getWithQuestions') || name.includes('getAttemptResults')) return { data: teachingData, error: teachingError, refresh }
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
async function mount(name: keyof typeof paths) {
  const Comp = await import(paths[name])
  return await mountSuspended(Comp.default, { props: props[name] })
}

describe('quiz teaching-read failures', () => {
  beforeEach(() => {
    teachingData.value = null
    teachingError.value = null
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
    const Comp = await import(paths.QuizBlock)
    const wrapper = await mountSuspended(Comp.default, { props: { quizId: 'quiz_1', isOffline: true, offlineData: { questions: [{ question: 'Offline question', type: 'true_false', correctAnswer: 'True', order: 0 }] } } })
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
})
