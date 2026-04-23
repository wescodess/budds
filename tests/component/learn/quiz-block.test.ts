import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'

const mockQuizData = ref<any>(null)

mockNuxtImport('useConvexQuery', () => {
  return (_apiRef: any, _args?: any) => {
    return { data: mockQuizData }
  }
})

const componentPath = ['~', 'components', 'learn', 'QuizBlock.vue'].join('/')

const sampleQuiz = {
  quiz: { title: 'Practice Quiz' },
  questions: [
    {
      _id: 'q1',
      question: 'What is 2 + 2?',
      type: 'multiple-choice',
      options: ['3', '4', '5', '6'],
      correctAnswer: '4',
      explanation: 'Basic arithmetic.',
      order: 0,
    },
    {
      _id: 'q2',
      question: 'The sky is blue.',
      type: 'true_false',
      correctAnswer: 'True',
      order: 1,
    },
  ],
}

describe('QuizBlock', () => {
  beforeEach(() => {
    mockQuizData.value = null
  })

  it('renders quiz block container', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { quizId: 'quiz_123' },
    })
    expect(wrapper.find('[data-testid="quiz-block"]').exists()).toBe(true)
  })

  it('shows loading state when quiz data not available', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { quizId: 'quiz_123' },
    })
    expect(wrapper.text()).toContain('Loading questions...')
  })

  it('renders questions when data is loaded', async () => {
    mockQuizData.value = sampleQuiz
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { quizId: 'quiz_123' },
    })
    expect(wrapper.text()).toContain('What is 2 + 2?')
    expect(wrapper.text()).toContain('The sky is blue.')
  })

  it('has aria-live="polite" on feedback containers for each question', async () => {
    mockQuizData.value = sampleQuiz
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { quizId: 'quiz_123' },
    })
    const liveRegions = wrapper.findAll('[aria-live="polite"]')
    expect(liveRegions.length).toBe(sampleQuiz.questions.length)
    for (const region of liveRegions) {
      expect(region.attributes('aria-live')).toBe('polite')
    }
  })

  it('shows practice label', async () => {
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { quizId: 'quiz_123' },
    })
    expect(wrapper.text()).toContain('Practice')
  })

  it('renders multiple-choice options with aria-labels', async () => {
    mockQuizData.value = sampleQuiz
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { quizId: 'quiz_123' },
    })
    const optionBtns = wrapper.findAll('[aria-label^="Option:"]')
    expect(optionBtns.length).toBe(4)
  })
})
