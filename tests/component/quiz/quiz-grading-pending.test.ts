import { beforeAll, describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'

const sequentialModePath = ['~', 'components', 'quiz', 'SequentialMode.vue'].join('/')
const historyDropdownPath = ['~', 'components', 'quiz', 'HistoryDropdown.vue'].join('/')

beforeAll(async () => {
  await Promise.all([import(sequentialModePath), import(historyDropdownPath)])
})

const questionOf = (type: string) => ({
  _id: 'q_1',
  quizId: 'quiz_1',
  order: 0,
  question: 'What is the result of mitosis?',
  type,
  correctAnswer: 'Two identical daughter cells.',
})

describe.each(['free-response', 'fill_in_the_blank'])('saving a pending %s answer', (type) => {
  async function mountSaved(feedback: Record<string, unknown>) {
    const component = await import(sequentialModePath)
    const wrapper = await mountSuspended(component.default, {
      props: {
        questions: [questionOf(type)],
        currentIndex: 0,
        immediateFeedback: true,
        submitting: false,
        answeredIds: new Set<string>(),
      },
    })
    wrapper.vm.receiveFeedback('q_1', { isCorrect: false, correctAnswer: 'Two identical daughter cells.', alreadyAnswered: false, ...feedback })
    await nextTick()
    return wrapper
  }

  it('shows the saved message and reference right after saving, with no verdict', async () => {
    const wrapper = await mountSaved({ gradingPending: true })
    expect(wrapper.text()).toContain('Saved. Your result comes with your score.')
    expect(wrapper.text()).toContain('Reference answer')
    expect(wrapper.text()).toContain('Two identical daughter cells.')
    expect(wrapper.text()).not.toContain('No exact answer match')
    expect(wrapper.text()).not.toMatch(/incorrect|not correct/i)
    expect(wrapper.html()).not.toContain('text-destructive')
    expect(wrapper.get('textarea, input').attributes('disabled')).toBeDefined()
  })

  it('keeps the existing wording when grading is off', async () => {
    const wrapper = await mountSaved({})
    expect(wrapper.text()).toContain('No exact answer match')
    expect(wrapper.text()).not.toContain('Saved. Your result comes with your score.')
    expect(wrapper.get('textarea, input').attributes('disabled')).toBeDefined()
  })
})

describe('QuizHistoryDropdown scores', () => {
  const attempt = (overrides: Record<string, unknown>) => ({
    _id: 'attempt_1',
    _creationTime: 1,
    score: 3.5,
    total: 5,
    percentage: 70,
    status: 'completed',
    startedAt: 1,
    ...overrides,
  })

  async function mountOpen(attempts: unknown[]) {
    const component = await import(historyDropdownPath)
    const wrapper = await mountSuspended(component.default, { props: { attempts } })
    await wrapper.get('button').trigger('click')
    await flushPromises()
    return wrapper
  }

  it('shows a fractional score with its rounded percentage', async () => {
    const wrapper = await mountOpen([attempt({})])
    expect(document.body.textContent).toContain('3.5/5')
    expect(document.body.textContent).toContain('70%')
    expect(document.body.textContent).not.toContain('Checking')
    wrapper.unmount()
  })

  it('shows a still-checking attempt plainly instead of a final percentage', async () => {
    const wrapper = await mountOpen([attempt({ score: 2, percentage: 40, gradingStatus: 'grading' })])
    expect(document.body.textContent).toContain('2/5 so far')
    expect(document.body.textContent).toContain('Checking')
    expect(document.body.textContent).not.toContain('40%')
    wrapper.unmount()
  })
})
