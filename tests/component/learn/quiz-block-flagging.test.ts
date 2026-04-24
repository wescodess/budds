import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'

const mockQuizData = ref<any>(null)
const mockMutate = vi.fn().mockResolvedValue({ success: true })

mockNuxtImport('useConvexQuery', () => {
  return (_apiRef: any, _args?: any) => {
    return { data: mockQuizData }
  }
})

mockNuxtImport('useConvexMutation', () => {
  return (_apiRef: any) => {
    return { mutate: mockMutate }
  }
})

const componentPath = ['~', 'components', 'learn', 'QuizBlock.vue'].join('/')

const unflaggedQuiz = {
  quiz: { title: 'Test Quiz' },
  questions: [
    {
      _id: 'q1',
      question: 'What is 2 + 2?',
      type: 'multiple-choice',
      options: ['3', '4', '5'],
      correctAnswer: '4',
      explanation: 'Basic math.',
      order: 0,
    },
  ],
}

const flaggedQuiz = {
  quiz: { title: 'Test Quiz' },
  questions: [
    {
      _id: 'q1',
      question: 'What is 2 + 2?',
      type: 'multiple-choice',
      options: ['3', '4', '5'],
      correctAnswer: '4',
      explanation: 'Basic math.',
      order: 0,
      flagged: true,
      correctedAnswer: '5',
      correctedExplanation: 'Actually its 5 in this quiz.',
    },
  ],
}

describe('QuizBlock flagging', () => {
  beforeEach(() => {
    mockQuizData.value = null
    mockMutate.mockClear()
  })

  it('shows flag button after answering a question', async () => {
    mockQuizData.value = unflaggedQuiz
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { quizId: 'quiz_123' },
    })

    const option4 = wrapper.findAll('button[aria-label^="Option:"]').find(
      (b) => b.text().includes('4'),
    )
    await option4?.trigger('click')

    const checkBtn = wrapper.findAll('button').find((b) => b.text() === 'Check Answer')
    await checkBtn?.trigger('click')

    const flagBtn = wrapper.find('[data-testid="flag-button"]')
    expect(flagBtn.exists()).toBe(true)
    expect(flagBtn.text()).toContain('Flag as incorrect')
  })

  it('opens flag editor on click', async () => {
    mockQuizData.value = unflaggedQuiz
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { quizId: 'quiz_123' },
    })

    const option4 = wrapper.findAll('button[aria-label^="Option:"]').find(
      (b) => b.text().includes('4'),
    )
    await option4?.trigger('click')
    const checkBtn = wrapper.findAll('button').find((b) => b.text() === 'Check Answer')
    await checkBtn?.trigger('click')

    const flagBtn = wrapper.find('[data-testid="flag-button"]')
    await flagBtn.trigger('click')

    expect(wrapper.find('[data-testid="flag-editor"]').exists()).toBe(true)
  })

  it('shows flag badge when question is already flagged', async () => {
    mockQuizData.value = flaggedQuiz
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { quizId: 'quiz_123' },
    })

    expect(wrapper.find('[data-testid="flag-badge"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="flag-badge"]').text()).toContain('Corrected')
  })

  it('flag editor inputs have aria-labels', async () => {
    mockQuizData.value = unflaggedQuiz
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { quizId: 'quiz_123' },
    })

    const option4 = wrapper.findAll('button[aria-label^="Option:"]').find(
      (b) => b.text().includes('4'),
    )
    await option4?.trigger('click')
    const checkBtn = wrapper.findAll('button').find((b) => b.text() === 'Check Answer')
    await checkBtn?.trigger('click')

    const flagBtn = wrapper.find('[data-testid="flag-button"]')
    await flagBtn.trigger('click')

    const editor = wrapper.find('[data-testid="flag-editor"]')
    const answerInput = editor.find('input[aria-label="Corrected answer"]')
    const explanationInput = editor.find('input[aria-label="Corrected explanation"]')
    expect(answerInput.exists()).toBe(true)
    expect(explanationInput.exists()).toBe(true)
  })

  it('shows corrected answer instead of original when flagged', async () => {
    mockQuizData.value = flaggedQuiz
    const Comp = await import(componentPath)
    const wrapper = await mountSuspended(Comp.default, {
      props: { quizId: 'quiz_123' },
    })

    const option5 = wrapper.findAll('button[aria-label^="Option:"]').find(
      (b) => b.text().includes('5'),
    )
    await option5?.trigger('click')
    const checkBtn = wrapper.findAll('button').find((b) => b.text() === 'Check Answer')
    await checkBtn?.trigger('click')

    const correctMsg = wrapper.find('.text-green-400')
    expect(correctMsg.exists()).toBe(true)
  })
})
