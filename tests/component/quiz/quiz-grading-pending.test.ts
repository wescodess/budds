import { beforeAll, describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import type { AttemptHistoryItem } from '~/composables/useQuizHistory'

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

describe.each(['free-response', 'fill_in_the_blank'])('saving a graded %s answer', (type) => {
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

  it.each([true, false])('shows the saved message and reference with no verdict when gradingPending is %s', async (gradingPending) => {
    const wrapper = await mountSaved({ gradingPending })
    expect(wrapper.text()).toContain('Saved. Your result comes with your score.')
    expect(wrapper.text()).toContain('Reference answer')
    expect(wrapper.text()).toContain('Two identical daughter cells.')
    expect(wrapper.text()).not.toContain('No exact answer match')
    expect(wrapper.text()).not.toMatch(/incorrect|not correct/i)
    expect(wrapper.html()).not.toContain('text-destructive')
    expect(wrapper.get('textarea, input').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('keeps the existing wording when grading is off', async () => {
    const wrapper = await mountSaved({})
    expect(wrapper.text()).toContain('No exact answer match')
    expect(wrapper.text()).not.toContain('Saved. Your result comes with your score.')
    expect(wrapper.get('textarea, input').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it.each([false, undefined])('keeps exact-match feedback when gradingPending is %s', async (gradingPending) => {
    const wrapper = await mountSaved({ isCorrect: true, gradingPending })
    expect(wrapper.text()).toContain('Correct!')
    expect(wrapper.text()).not.toContain('Saved. Your result comes with your score.')
    expect(wrapper.text()).not.toContain('No exact answer match')
    expect(wrapper.get('textarea, input').classes()).toContain('border-l-green-500')
    wrapper.unmount()
  })
})

describe('QuizHistoryDropdown scores', () => {
  const attempt = (overrides: Partial<Omit<AttemptHistoryItem, '_id'>>) => ({
    _id: 'attempt_1',
    _creationTime: 1,
    score: 3.5,
    total: 5,
    percentage: 70,
    status: 'completed',
    startedAt: 1,
    currentQuestionIndex: 5,
    completedAt: 2,
    ...overrides,
  })

  const popover = () => document.body.querySelector('[data-slot="popover-content"]')!

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

  it('gives checking priority over an answer that also needs the learner', async () => {
    const wrapper = await mountOpen([attempt({ score: 2, percentage: 40, gradingStatus: 'grading', gradingNeedsAttention: true })])
    expect(document.body.textContent).toContain('2/5 so far')
    expect(popover().querySelector('span.bg-muted')?.textContent?.trim()).toBe('Checking')
    expect(document.body.textContent).not.toContain('Your call')
    expect(document.body.textContent).not.toContain('40%')
    wrapper.unmount()
  })

  it.each([
    { outcome: 'unavailable', score: 0, total: 1, percentage: 0, expected: '0/1 so far' },
    { outcome: 'uncertain', score: 0.4, total: 1, percentage: 40, expected: '0.4/1 so far' },
  ])('shows a settled $outcome grade as the learner\'s call, not a final red score', async ({ score, total, percentage, expected }) => {
    const wrapper = await mountOpen([attempt({ score, total, percentage, gradingStatus: 'settled', gradingNeedsAttention: true })])
    expect(document.body.textContent).toContain(expected)
    expect(popover().querySelector('span.bg-muted')?.textContent?.trim()).toBe('Your call')
    expect(document.body.textContent).not.toContain('Checking')
    expect(document.body.textContent).not.toContain(`${percentage}%`)
    expect(popover().querySelector('.text-destructive')).toBeNull()
    wrapper.unmount()
  })

  it('shows the final percentage once the learner has made the last decision', async () => {
    const wrapper = await mountOpen([attempt({ score: 0.5, total: 1, percentage: 50, gradingStatus: 'settled', gradingNeedsAttention: false })])
    expect(document.body.textContent).toContain('0.5/1')
    expect(document.body.textContent).toContain('50%')
    expect(document.body.textContent).not.toContain('so far')
    expect(document.body.textContent).not.toContain('Your call')
    expect(popover().querySelector('span.bg-muted')).toBeNull()
    expect(popover().querySelector('.text-destructive')).not.toBeNull()
    wrapper.unmount()
  })

  it.each([
    { era: 'without grading fields', fields: {} },
    { era: 'graded before the attention field', fields: { gradingStatus: 'settled' as const } },
  ])('keeps the final percentage for an attempt $era', async ({ fields }) => {
    const wrapper = await mountOpen([attempt({ score: 2, percentage: 40, ...fields })])
    expect(document.body.textContent).toContain('2/5')
    expect(document.body.textContent).toContain('40%')
    expect(document.body.textContent).not.toContain('so far')
    expect(popover().querySelector('span.bg-muted')).toBeNull()
    expect(popover().querySelector('.text-destructive')).not.toBeNull()
    wrapper.unmount()
  })

  describe.each(['in_progress', 'abandoned'])('an %s attempt', (status) => {
    it.each([
      { state: 'still checking', fields: { gradingStatus: 'grading' as const } },
      { state: 'checking with attention', fields: { gradingStatus: 'grading' as const, gradingNeedsAttention: true } },
      { state: 'settled with attention', fields: { gradingStatus: 'settled' as const, gradingNeedsAttention: true } },
    ])('never claims a pending state when $state', async ({ fields }) => {
      const wrapper = await mountOpen([attempt({ status, completedAt: undefined, currentQuestionIndex: 1, score: 2, percentage: 40, ...fields })])
      expect(document.body.textContent).toContain('40%')
      expect(document.body.textContent).not.toContain('so far')
      expect(document.body.textContent).not.toContain('Checking')
      expect(document.body.textContent).not.toContain('Your call')
      wrapper.unmount()
    })
  })
})
