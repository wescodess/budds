import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'

const resultsData = ref<any>()
const historyData = ref<any[]>([])
let queryCall = 0
const fetchMock = vi.hoisted(() => vi.fn())

mockNuxtImport('useConvexQuery', () => () => ({ data: queryCall++ === 0 ? resultsData : historyData }))
mockNuxtImport('useMotionPresets', () => () => ({ springGentle: {} }))
mockNuxtImport('$fetch', () => fetchMock)

const resultsViewPath = ['~', 'components', 'quiz', 'ResultsView.vue'].join('/')

function attempt(status: 'pending' | 'available') {
  return {
    score: 0,
    total: 1,
    percentage: 0,
    startedAt: 1,
    completedAt: 2,
    results: [{
      questionId: 'question_1',
      questionText: 'Describe ATP.',
      questionType: 'free-response',
      userAnswer: 'It carries energy.',
      isCorrect: false,
      correctAnswer: 'ATP is an energy carrier.',
      semanticAssessment: {
        status,
        label: status === 'available' ? 'fully_correct' : undefined,
        deterministicScoreUnchanged: true,
      },
    }],
  }
}

describe('QuizResultsView semantic assessment orchestration', () => {
  beforeEach(() => {
    queryCall = 0
    resultsData.value = attempt('pending')
    historyData.value = []
    useRuntimeConfig().public.quizSemanticReviewEnabled = true
    useRuntimeConfig().public.quizSemanticAssessmentEnabled = true
    fetchMock.mockReset().mockResolvedValue({ status: 'queued' })
  })

  it('requests one pending assessment and reacts to the persisted advisory result without changing score', async () => {
    const ResultsView = await import(resultsViewPath)
    const wrapper = await mountSuspended(ResultsView.default, {
      props: { quizId: 'quiz_1', attemptId: 'attempt_1' },
      global: {
        stubs: {
          Motion: { template: '<div><slot /></div>' },
          QuizHistoryDropdown: true,
        },
      },
    })
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/quiz/assess-attempt', {
      method: 'POST',
      body: { attemptId: 'attempt_1' },
    })
    expect(wrapper.text()).toContain('0 of 1')
    expect(wrapper.text()).toContain('Reviewing meaning and evidence')

    resultsData.value = attempt('available')
    await nextTick()
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('Strong meaning match')
    expect(wrapper.text()).toContain('0 of 1')
    expect(wrapper.text()).toContain('score has not changed')
    wrapper.unmount()
  })

  it('makes one bounded retry when a queued review remains pending', async () => {
    vi.useFakeTimers()
    try {
      const ResultsView = await import(resultsViewPath)
      const wrapper = await mountSuspended(ResultsView.default, {
        props: { quizId: 'quiz_1', attemptId: 'attempt_1' },
        global: { stubs: { Motion: { template: '<div><slot /></div>' }, QuizHistoryDropdown: true } },
      })
      await flushPromises()
      expect(fetchMock).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(5_000)
      await flushPromises()
      expect(fetchMock).toHaveBeenCalledTimes(2)

      await vi.advanceTimersByTimeAsync(5_000)
      await flushPromises()
      expect(fetchMock).toHaveBeenCalledTimes(2)
      wrapper.unmount()
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('offers a learner retry after two failed requests and posts again from the parent control', async () => {
    vi.useFakeTimers()
    fetchMock.mockRejectedValue(new Error('network unavailable'))
    try {
      const ResultsView = await import(resultsViewPath)
      const wrapper = await mountSuspended(ResultsView.default, {
        props: { quizId: 'quiz_1', attemptId: 'attempt_1' },
        global: { stubs: { Motion: { template: '<div><slot /></div>' }, QuizHistoryDropdown: true } },
      })
      await flushPromises()
      expect(fetchMock).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(5_000)
      await flushPromises()
      expect(fetchMock).toHaveBeenCalledTimes(2)

      const retry = wrapper.get('[data-testid="quiz-semantic-retry"]')
      expect(retry.attributes('disabled')).toBeUndefined()
      fetchMock.mockResolvedValueOnce({ status: 'queued' })
      await retry.trigger('click')
      await flushPromises()

      expect(fetchMock).toHaveBeenCalledTimes(3)
      expect(fetchMock).toHaveBeenLastCalledWith('/api/quiz/assess-attempt', {
        method: 'POST',
        body: { attemptId: 'attempt_1' },
      })
      wrapper.unmount()
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('does not post or render semantic review when activation is off', async () => {
    useRuntimeConfig().public.quizSemanticReviewEnabled = false
    useRuntimeConfig().public.quizSemanticAssessmentEnabled = false
    const ResultsView = await import(resultsViewPath)
    const wrapper = await mountSuspended(ResultsView.default, {
      props: { quizId: 'quiz_1', attemptId: 'attempt_1' },
      global: { stubs: { Motion: { template: '<div><slot /></div>' }, QuizHistoryDropdown: true } },
    })
    await flushPromises()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="quiz-semantic-assessment"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('runs hidden shadow assessment without rendering a learner-facing verdict', async () => {
    vi.useFakeTimers()
    useRuntimeConfig().public.quizSemanticReviewEnabled = false
    useRuntimeConfig().public.quizSemanticAssessmentEnabled = true
    try {
      const ResultsView = await import(resultsViewPath)
      const wrapper = await mountSuspended(ResultsView.default, {
        props: { quizId: 'quiz_1', attemptId: 'attempt_1' },
        global: { stubs: { Motion: { template: '<div><slot /></div>' }, QuizHistoryDropdown: true } },
      })
      await flushPromises()
      expect(fetchMock).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(10_000)
      expect(fetchMock).toHaveBeenCalledOnce()
      expect(wrapper.find('[data-testid="quiz-semantic-assessment"]').exists()).toBe(false)
      expect(wrapper.text()).toContain('0 of 1')
      wrapper.unmount()
    }
    finally {
      vi.useRealTimers()
    }
  })
})
