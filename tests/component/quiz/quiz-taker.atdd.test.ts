/**
 * ATDD — Story 6.2 AC #3, #4, #5, #6, #9
 *
 * Generated BEFORE Taker.vue exists. These tests MUST fail at this point;
 * dev-story makes them pass.
 *
 * Covers the happy path: load quiz → answer both questions → submit →
 * results mode renders correct + incorrect states.
 *
 * Portal constraint (Story 6.1 Dev Agent Record + 6.2 AC #7):
 * Taker introduces NO portaled primitives. All assertions target direct DOM.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'

const mockQuizData = ref<any>(null)
const mockSubmitAttempt = vi.fn()

mockNuxtImport('useConvexQuery', () => {
  return (_api: unknown, _args: unknown) => ({ data: mockQuizData })
})

mockNuxtImport('useConvexMutation', () => {
  return (_api: unknown) => ({
    mutate: mockSubmitAttempt,
    isLoading: ref(false),
  })
})

const takerPath = ['~', 'components', 'quiz', 'Taker.vue'].join('/')

function sampleQuiz() {
  return {
    quiz: {
      _id: 'quiz_1',
      _creationTime: Date.now(),
      title: 'Cell Biology Quiz',
      status: 'ready',
      userId: 'user_test',
      folderId: 'folder_abc',
    },
    questions: [
      {
        _id: 'q_1',
        _creationTime: Date.now(),
        quizId: 'quiz_1',
        userId: 'user_test',
        order: 0,
        type: 'multiple-choice',
        question: 'What do mitochondria produce?',
        options: ['ATP', 'DNA', 'RNA', 'Glucose'],
        correctAnswer: 'ATP',
        sourceChunkContent: 'Mitochondria are the powerhouse of the cell, producing ATP.',
        sourceFilename: 'bio1.pdf',
      },
      {
        _id: 'q_2',
        _creationTime: Date.now(),
        quizId: 'quiz_1',
        userId: 'user_test',
        order: 1,
        type: 'free-response',
        question: 'Describe photosynthesis in one sentence.',
        correctAnswer: 'Plants convert light into chemical energy.',
        sourceChunkContent: 'Photosynthesis transforms light energy into glucose.',
        sourceFilename: 'bio2.pdf',
      },
    ],
  }
}

describe('QuizTaker — Story 6.2 happy-path ATDD', () => {
  beforeEach(() => {
    mockQuizData.value = undefined
    mockSubmitAttempt.mockReset()
  })

  it('[P0] renders loading skeletons while getWithQuestions resolves', async () => {
    const Taker = await import(takerPath)
    mockQuizData.value = undefined

    const wrapper = await mountSuspended(Taker.default, {
      props: { quizId: 'quiz_1' },
    })

    expect(wrapper.html()).toMatch(/skeleton|animate-pulse/i)
  })

  it('[P0] renders one Question block per loaded question in answering mode', async () => {
    const Taker = await import(takerPath)
    mockQuizData.value = sampleQuiz()

    const wrapper = await mountSuspended(Taker.default, {
      props: { quizId: 'quiz_1' },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('What do mitochondria produce?')
    expect(wrapper.text()).toContain('Describe photosynthesis in one sentence.')
  })

  it('[P0] disables Submit until every question has a non-empty response', async () => {
    const Taker = await import(takerPath)
    mockQuizData.value = sampleQuiz()

    const wrapper = await mountSuspended(Taker.default, {
      props: { quizId: 'quiz_1' },
    })
    await flushPromises()

    const submit = wrapper.find('[data-testid="quiz-submit-button"]')
    expect(submit.exists()).toBe(true)
    expect(submit.attributes('disabled')).toBeDefined()
  })

  it('[P0] calls submitAttempt with { quizId, answers[] } when Submit is clicked', async () => {
    const Taker = await import(takerPath)
    mockQuizData.value = sampleQuiz()
    mockSubmitAttempt.mockResolvedValue({
      attemptId: 'attempt_1',
      score: 1,
      total: 2,
      correctCount: 1,
    })

    const wrapper = await mountSuspended(Taker.default, {
      props: { quizId: 'quiz_1' },
    })
    await flushPromises()

    const mcRadios = wrapper.findAll('input[type="radio"], [role="radio"]')
    if (mcRadios.length > 0) {
      await mcRadios[0]!.trigger('click')
    }

    const textareas = wrapper.findAll('textarea')
    if (textareas.length > 0) {
      await textareas[0]!.setValue('Some answer')
    }

    await flushPromises()

    const submit = wrapper.find('[data-testid="quiz-submit-button"]')
    await submit.trigger('click')
    await flushPromises()

    expect(mockSubmitAttempt).toHaveBeenCalledTimes(1)
    const [payload] = mockSubmitAttempt.mock.calls[0] as any[]
    expect(payload.quizId).toBe('quiz_1')
    expect(Array.isArray(payload.answers)).toBe(true)
    expect(payload.answers).toHaveLength(2)
  })

  it('[P0] results mode shows score header and per-question correct/incorrect states', async () => {
    const Taker = await import(takerPath)
    mockQuizData.value = sampleQuiz()
    mockSubmitAttempt.mockResolvedValue({
      attemptId: 'attempt_1',
      score: 1,
      total: 2,
      correctCount: 1,
      results: [
        { questionId: 'q_1', isCorrect: true, correctAnswer: 'ATP', userResponse: 'ATP' },
        { questionId: 'q_2', isCorrect: false, correctAnswer: 'Plants convert light into chemical energy.', userResponse: 'wrong answer' },
      ],
    })

    const wrapper = await mountSuspended(Taker.default, {
      props: { quizId: 'quiz_1' },
    })
    await flushPromises()

    const mcRadios = wrapper.findAll('input[type="radio"], [role="radio"]')
    if (mcRadios.length > 0) await mcRadios[0]!.trigger('click')
    const textareas = wrapper.findAll('textarea')
    if (textareas.length > 0) await textareas[0]!.setValue('wrong answer')
    await flushPromises()

    await wrapper.find('[data-testid="quiz-submit-button"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="quiz-results-score"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="quiz-results-score"]').text()).toContain('1')
    expect(wrapper.find('[data-testid="quiz-results-score"]').text()).toContain('2')

    expect(wrapper.find('[data-testid="quiz-result-correct"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="quiz-result-incorrect"]').exists()).toBe(true)

    expect(wrapper.text()).toContain('Plants convert light into chemical energy.')
  })

  it('[P1] back button emits back in answering mode', async () => {
    const Taker = await import(takerPath)
    mockQuizData.value = sampleQuiz()

    const wrapper = await mountSuspended(Taker.default, {
      props: { quizId: 'quiz_1' },
    })
    await flushPromises()

    const back = wrapper.find('[data-testid="quiz-taker-back"]')
    expect(back.exists()).toBe(true)
    await back.trigger('click')
    expect(wrapper.emitted('back')).toBeTruthy()
  })
})
