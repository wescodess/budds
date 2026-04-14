import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'

const questionPath = ['~', 'components', 'quiz', 'Question.vue'].join('/')

function mcQuestion() {
  return {
    _id: 'q_1',
    type: 'multiple-choice' as const,
    question: 'What is 2+2?',
    options: ['3', '4', '5', '6'],
    sourceFilename: 'math.pdf',
    sourceChunkContent: 'Basic arithmetic: 2+2 equals 4.',
  }
}

function frQuestion() {
  return {
    _id: 'q_2',
    type: 'free-response' as const,
    question: 'Describe gravity.',
    sourceFilename: 'physics.pdf',
    sourceChunkContent: 'Gravity is the force that attracts objects with mass.',
  }
}

describe('QuizQuestion — Story 6.2 AC #4, #6', () => {
  it('[P0] renders multiple-choice as radio group with options', async () => {
    const Question = await import(questionPath)

    const wrapper = await mountSuspended(Question.default, {
      props: {
        index: 0,
        total: 2,
        question: mcQuestion(),
        response: '',
      },
    })

    expect(wrapper.text()).toContain('What is 2+2?')
    expect(wrapper.text()).toContain('3')
    expect(wrapper.text()).toContain('4')
    expect(wrapper.text()).toContain('5')
    expect(wrapper.text()).toContain('6')
  })

  it('[P0] renders free-response as textarea', async () => {
    const Question = await import(questionPath)

    const wrapper = await mountSuspended(Question.default, {
      props: {
        index: 0,
        total: 1,
        question: frQuestion(),
        response: '',
      },
    })

    const textarea = wrapper.find('[data-testid="quiz-question-textarea"]')
    expect(textarea.exists()).toBe(true)
  })

  it('[P0] emits update:response when typing in free-response', async () => {
    const Question = await import(questionPath)

    const wrapper = await mountSuspended(Question.default, {
      props: {
        index: 0,
        total: 1,
        question: frQuestion(),
        response: '',
      },
    })

    await wrapper.find('[data-testid="quiz-question-textarea"]').setValue('new answer')

    const events = wrapper.emitted('update:response')
    expect(events).toBeTruthy()
    expect(events![0]).toEqual(['new answer'])
  })

  it('[P0] results mode shows correct badge for correct answer', async () => {
    const Question = await import(questionPath)

    const wrapper = await mountSuspended(Question.default, {
      props: {
        index: 0,
        total: 1,
        question: mcQuestion(),
        response: '4',
        result: {
          isCorrect: true,
          correctAnswer: '4',
          userResponse: '4',
        },
      },
    })

    expect(wrapper.find('[data-testid="quiz-result-correct"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="quiz-result-incorrect"]').exists()).toBe(false)
  })

  it('[P0] results mode shows incorrect badge + revealed correct answer', async () => {
    const Question = await import(questionPath)

    const wrapper = await mountSuspended(Question.default, {
      props: {
        index: 0,
        total: 1,
        question: frQuestion(),
        response: 'wrong',
        result: {
          isCorrect: false,
          correctAnswer: 'Gravity attracts masses',
          userResponse: 'wrong',
        },
      },
    })

    expect(wrapper.find('[data-testid="quiz-result-incorrect"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="quiz-reveal-correct"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="quiz-reveal-correct"]').text()).toContain('Gravity attracts masses')
  })

  it('[P1] source citation row toggles inline source panel in results mode', async () => {
    const Question = await import(questionPath)

    const wrapper = await mountSuspended(Question.default, {
      props: {
        index: 0,
        total: 1,
        question: mcQuestion(),
        response: '3',
        result: {
          isCorrect: false,
          correctAnswer: '4',
          userResponse: '3',
        },
      },
    })

    expect(wrapper.find('[data-testid="quiz-source-panel"]').exists()).toBe(false)
    await wrapper.find('[data-testid="quiz-source-toggle"]').trigger('click')
    expect(wrapper.find('[data-testid="quiz-source-panel"]').exists()).toBe(true)
  })
})
