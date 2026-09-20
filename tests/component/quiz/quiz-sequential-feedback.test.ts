import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { nextTick } from 'vue'

const sequentialModePath = ['~', 'components', 'quiz', 'SequentialMode.vue'].join('/')

describe('QuizSequentialMode free-form feedback', () => {
  it('shows the reference answer once when an explanation is present', async () => {
    const component = await import(sequentialModePath)
    const wrapper = await mountSuspended(component.default, {
      props: {
        questions: [{
          _id: 'q_1',
          quizId: 'quiz_1',
          order: 0,
          question: 'List two factors.',
          type: 'free-response',
          correctAnswer: 'Company culture, job opportunities',
          explanation: 'Both factors align the role with personal career goals.',
        }],
        currentIndex: 0,
        immediateFeedback: true,
        submitting: false,
        answeredIds: new Set<string>(),
      },
    })

    wrapper.vm.receiveFeedback('q_1', {
      isCorrect: false,
      correctAnswer: 'Company culture, job opportunities',
      explanation: 'Both factors align the role with personal career goals.',
      alreadyAnswered: false,
    })
    await nextTick()

    expect(wrapper.text().match(/Company culture, job opportunities/g)).toHaveLength(1)
    expect(wrapper.text()).toContain('Reference answer')
    expect(wrapper.text()).not.toContain('Correct answer:')
    expect(wrapper.text()).not.toContain("Oops, that's not correct.")
    expect(wrapper.html()).not.toContain('text-destructive')
    expect(wrapper.text()).toContain('Both factors align the role with personal career goals.')
  })
})
