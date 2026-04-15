/**
 * QuizTaker review mode — Story 6.3 AC #8
 *
 * When listAttempts returns a prior attempt, the taker mounts in review mode
 * with the score header + Retake button visible (no loading, no answering).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'

const mockQuizData = ref<any>(undefined)
const mockAttemptsData = ref<any>(undefined)
const mockSubmitAttempt = vi.fn()

mockNuxtImport('useConvexQuery', () => {
  return (_apiRef: any, args: any) => {
    const resolved = args && typeof args === 'object' && 'value' in args ? args.value : args
    if (resolved && typeof resolved === 'object' && 'quizId' in resolved && !('id' in resolved)) {
      return { data: mockAttemptsData }
    }
    return { data: mockQuizData }
  }
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
        sourceChunkContent: 'Mitochondria produce ATP.',
        sourceFilename: 'bio.pdf',
      },
      {
        _id: 'q_2',
        _creationTime: Date.now(),
        quizId: 'quiz_1',
        userId: 'user_test',
        order: 1,
        type: 'free-response',
        question: 'Describe photosynthesis.',
        correctAnswer: 'Plants convert light to chemical energy.',
        sourceChunkContent: 'Photosynthesis uses light.',
        sourceFilename: 'bio2.pdf',
      },
    ],
  }
}

function sampleAttempt() {
  return [
    {
      _id: 'attempt_1',
      _creationTime: Date.now(),
      userId: 'user_test',
      quizId: 'quiz_1',
      answers: [
        { questionId: 'q_1', response: 'ATP', isCorrect: true },
        { questionId: 'q_2', response: 'wrong', isCorrect: false },
      ],
      score: 1,
      total: 2,
      completedAt: Date.now(),
    },
  ]
}

describe('QuizTaker — review mode (Story 6.3 AC #8)', () => {
  beforeEach(() => {
    mockQuizData.value = undefined
    mockAttemptsData.value = undefined
    mockSubmitAttempt.mockReset()
  })

  it('[P0] with a prior attempt, mounts in review mode with score header + Retake button', async () => {
    const Taker = await import(takerPath)
    mockQuizData.value = sampleQuiz()
    mockAttemptsData.value = sampleAttempt()

    const wrapper = await mountSuspended(Taker.default, {
      props: { quizId: 'quiz_1' },
    })
    await flushPromises()

    expect(wrapper.find('[data-testid="quiz-results-score"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="quiz-results-score"]').text()).toContain('1')
    expect(wrapper.find('[data-testid="quiz-results-score"]').text()).toContain('2')
    expect(wrapper.find('[data-testid="quiz-taker-retake"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="quiz-submit-button"]').exists()).toBe(false)
  })

  it('[P0] clicking Retake transitions to answering mode', async () => {
    const Taker = await import(takerPath)
    mockQuizData.value = sampleQuiz()
    mockAttemptsData.value = sampleAttempt()

    const wrapper = await mountSuspended(Taker.default, {
      props: { quizId: 'quiz_1' },
    })
    await flushPromises()

    await wrapper.find('[data-testid="quiz-taker-retake"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="quiz-submit-button"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="quiz-taker-retake"]').exists()).toBe(false)
  })

  it('[P1] does not mark the full taker surface as a gesture owner', async () => {
    const Taker = await import(takerPath)
    mockQuizData.value = sampleQuiz()
    mockAttemptsData.value = sampleAttempt()

    const wrapper = await mountSuspended(Taker.default, {
      props: { quizId: 'quiz_1' },
    })
    await flushPromises()

    expect(wrapper.get('[data-testid="quiz-taker"]').attributes('data-gesture-owner')).toBeUndefined()
  })
})
