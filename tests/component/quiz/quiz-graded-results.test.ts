import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'

const resultsData = ref<any>()
const historyData = ref<any[]>([])
let queryCall = 0
const selfAssess = vi.hoisted(() => vi.fn())
const requestRetry = vi.hoisted(() => vi.fn())
const mutationError = ref<Error | null>(null)

mockNuxtImport('useConvexQuery', () => () => ({ data: queryCall++ % 2 === 0 ? resultsData : historyData }))
mockNuxtImport('useMotionPresets', () => () => ({ springGentle: {} }))
mockNuxtImport('useConvexMutation', () => () => ({
  error: mutationError,
  isLoading: ref(false),
  mutate: async (args: Record<string, unknown>) => {
    try {
      return 'verdict' in args ? await selfAssess(args) : await requestRetry(args)
    }
    catch (error) {
      mutationError.value = error as Error
    }
  },
}))

const resultsViewPath = ['~', 'components', 'quiz', 'ResultsView.vue'].join('/')
const stubs = { Motion: { template: '<div><slot /></div>' }, QuizHistoryDropdown: true }

beforeAll(async () => {
  await import(resultsViewPath)
})

type Grade = { status: string, credit?: number, label?: string, source?: string, feedback?: string }

function freeForm(id: string, grade: Grade, overrides: Record<string, unknown> = {}) {
  return {
    questionId: id,
    attemptAnswerId: `answer_${id}`,
    questionText: `Question text ${id}`,
    questionType: 'free-response',
    userAnswer: `Learner answer ${id}`,
    isCorrect: grade.credit === 1,
    correctAnswer: `Reference ${id}`,
    grade,
    ...overrides,
  }
}

const correct = (id: string) => freeForm(id, { status: 'graded', credit: 1, label: 'fully_correct', source: 'deterministic' })
const partial = (id: string) => freeForm(id, { status: 'graded', credit: 0.5, label: 'partially_correct', source: 'model', feedback: 'You covered the split.' })
const incorrect = (id: string) => freeForm(id, { status: 'graded', credit: 0, label: 'incorrect', source: 'model', feedback: 'That describes prophase.' })
const pending = (id: string) => freeForm(id, { status: 'pending' })
const yourCall = (id: string) => freeForm(id, { status: 'needs_review', credit: 0.5, label: 'uncertain', source: 'model', feedback: 'Hard to say.' })
const notChecked = (id: string) => freeForm(id, { status: 'unavailable' })
const marked = (id: string) => freeForm(id, { status: 'graded', credit: 1, label: 'fully_correct', source: 'self', feedback: 'Model said otherwise.' })
const multipleChoice = (id: string, isCorrect = true) => ({
  questionId: id,
  questionText: `Choice ${id}`,
  questionType: 'multiple-choice',
  options: ['Prophase', 'Metaphase'],
  userAnswer: isCorrect ? 'Metaphase' : 'Prophase',
  isCorrect,
  correctAnswer: 'Metaphase',
})

function attempt(results: any[], score: number, overrides: Record<string, unknown> = {}) {
  const rows = results.filter(row => row.grade)
  return {
    attemptId: 'attempt_1',
    score,
    total: results.length,
    percentage: Math.round((score / results.length) * 100),
    startedAt: 1,
    completedAt: 2,
    status: 'completed',
    grading: {
      pending: rows.filter(row => row.grade.status === 'pending').length,
      needsReview: rows.filter(row => row.grade.status === 'needs_review').length,
      unavailable: rows.filter(row => row.grade.status === 'unavailable').length,
    },
    results,
    ...overrides,
  }
}

async function mountResults(data: any, stubOverrides: Record<string, unknown> = {}) {
  resultsData.value = data
  const ResultsView = await import(resultsViewPath)
  const wrapper = await mountSuspended(ResultsView.default, {
    props: { quizId: 'quiz_1', attemptId: 'attempt_1' },
    global: { stubs: { ...stubs, ...stubOverrides } },
    attachTo: document.body,
  })
  await flushPromises()
  return wrapper
}

function cells(wrapper: any) {
  return wrapper.get('[data-testid="quiz-score-strip"]').findAll('[data-testid="quiz-score-cell"]')
}

async function clickButton(wrapper: any, label: string) {
  const button = wrapper.findAll('button').find((node: any) => node.text() === label)
  expect(button, `button "${label}"`).toBeTruthy()
  await button.trigger('click')
  await flushPromises()
}

describe('QuizResultsView graded results', () => {
  beforeEach(() => {
    queryCall = 0
    historyData.value = []
    mutationError.value = null
    useRuntimeConfig().public.quizSemanticReviewEnabled = true
    useRuntimeConfig().public.quizSemanticAssessmentEnabled = false
    selfAssess.mockReset().mockResolvedValue(null)
    requestRetry.mockReset().mockResolvedValue({ retried: 1 })
  })

  it('state 1: shows the still-checking header with muted score and spinner cells', async () => {
    const wrapper = await mountResults(attempt([correct('a'), pending('b'), pending('c'), correct('d'), pending('e')], 2))
    expect(wrapper.text()).toContain('Score so far')
    expect(wrapper.text()).toContain('Points so far')
    expect(wrapper.get('[data-testid="quiz-score-value"]').text()).toBe('2/5')
    expect(wrapper.get('[data-testid="quiz-score-ring"]').classes()).toContain('stroke-muted-foreground')
    expect(wrapper.text()).toContain('Checking 3 answers. Usually seconds, sometimes a few minutes. It keeps going if you leave.')
    const strip = cells(wrapper)
    expect(strip).toHaveLength(5)
    expect(strip[1].classes()).toContain('border-dashed')
    expect(strip[1].find('.animate-spin').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('Decide')
    expect(wrapper.text()).toContain('Retake Quiz')
    wrapper.unmount()
  })

  it('state 2: shows the settled fractional score with fills by credit', async () => {
    const wrapper = await mountResults(attempt([correct('a'), correct('b'), partial('c'), correct('d'), incorrect('e')], 3.5))
    expect(wrapper.text()).toContain('Your score')
    expect(wrapper.text()).not.toContain('for now')
    expect(wrapper.text()).toContain('3.5 of 5')
    const ring = wrapper.get('[data-testid="quiz-score-ring"]')
    expect(ring.classes()).toEqual(expect.arrayContaining(['stroke-yellow-700', 'dark:stroke-yellow-400']))
    const strip = cells(wrapper)
    expect(strip[0].get('[data-testid="quiz-score-cell-fill"]').attributes('style')).toContain('width: 100%')
    expect(strip[2].get('[data-testid="quiz-score-cell-fill"]').attributes('style')).toContain('width: 50%')
    expect(strip[4].find('[data-testid="quiz-score-cell-fill"]').exists()).toBe(false)
    expect(strip[0].attributes('aria-current')).toBe('true')
    wrapper.unmount()
  })

  it('state 3: shows the graded answer alongside multiple choice', async () => {
    const wrapper = await mountResults(attempt([partial('a'), multipleChoice('b'), incorrect('c')], 1.5))
    expect(wrapper.text()).toContain('Partly correct')
    expect(wrapper.text()).toContain('0.5 of 1')
    expect(wrapper.text()).toContain('You covered the split.')
    expect(wrapper.text()).toContain('Learner answer a')
    expect(wrapper.text()).toContain('Reference a')
    expect(wrapper.text()).toContain('Think this is wrong?')

    await cells(wrapper)[1].trigger('click')
    expect(wrapper.text()).toContain('1 of 1')
    expect(wrapper.text()).toContain('Metaphase')
    expect(wrapper.text()).not.toContain('Think this is wrong?')

    await cells(wrapper)[2].trigger('click')
    expect(wrapper.text()).toContain('0 of 1')
    expect(wrapper.text()).toContain('That describes prophase.')
    wrapper.unmount()
  })

  it('state 4: leads with a decide button and jumps to the next answer needing a decision', async () => {
    const wrapper = await mountResults(attempt([correct('a'), correct('b'), yourCall('c'), correct('d'), incorrect('e')], 3.5))
    expect(wrapper.text()).toContain('Your score for now')
    expect(wrapper.text()).toContain('Points for now')
    expect(wrapper.get('[data-testid="quiz-score-ring"]').classes()).toContain('stroke-muted-foreground')
    const decide = wrapper.findAll('button').find(node => node.text() === 'Decide 1 answer')!
    expect(decide.attributes('data-variant')).toBeUndefined()
    const retake = wrapper.findAll('button').find(node => node.text() === 'Retake Quiz')!
    expect(retake.classes()).toContain('border')

    await decide.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('0.5 of 1 for now')
    expect(wrapper.text()).toContain('We weren\'t sure about this answer, so it\'s your call. 0.5 is counted for now, and your choice replaces it.')
    expect(wrapper.text()).not.toContain('Hard to say.')
    expect(cells(wrapper)[2].attributes('aria-current')).toBe('true')
    wrapper.unmount()
  })

  it('state 5: explains an unavailable answer without marking it wrong', async () => {
    const wrapper = await mountResults(attempt([notChecked('a'), correct('b')], 1))
    expect(wrapper.text()).toContain('Not checked yet')
    expect(wrapper.text()).toContain('We couldn\'t finish checking this answer. It isn\'t marked wrong and doesn\'t count yet. Try again later, or mark it yourself.')
    expect(wrapper.text()).not.toContain('Incorrect')
    expect(wrapper.text()).not.toContain('Reference a')
    expect(wrapper.text()).toContain('Decide 1 answer')

    await clickButton(wrapper, 'Mark it myself')
    expect(wrapper.text()).toContain('Reference a')
    expect(wrapper.findAll('[data-slot="toggle-group-item"]')).toHaveLength(3)
    wrapper.unmount()
  })

  it('state 6: shows a marked answer and lets the learner change it', async () => {
    const wrapper = await mountResults(attempt([marked('a'), incorrect('b')], 1))
    expect(wrapper.text()).toContain('Correct · marked by you')
    expect(wrapper.text()).toContain('Your choice counts')
    expect(wrapper.text()).not.toContain('Model said otherwise.')
    expect(wrapper.text()).not.toContain('Think this is wrong?')

    await clickButton(wrapper, 'Change')
    const on = wrapper.findAll('[data-slot="toggle-group-item"]').find(node => node.attributes('data-state') === 'on')!
    expect(on.text()).toBe('Correct')
    await wrapper.findAll('[data-slot="toggle-group-item"]')[2]!.trigger('click')
    await flushPromises()
    expect(selfAssess).toHaveBeenCalledWith({ attemptAnswerId: 'answer_a', verdict: 'incorrect' })
    wrapper.unmount()
  })

  it('state 6: opens the decision control from a model grade with the current result selected', async () => {
    const wrapper = await mountResults(attempt([incorrect('a'), correct('b')], 1))
    await clickButton(wrapper, 'Think this is wrong?')
    expect(wrapper.text()).toContain('Your choice replaces this result.')
    const items = wrapper.findAll('[data-slot="toggle-group-item"]')
    expect(items[2]!.attributes('data-state')).toBe('on')

    await items[2]!.trigger('click')
    await flushPromises()
    expect(selfAssess).not.toHaveBeenCalled()

    await items[0]!.trigger('click')
    await flushPromises()
    expect(selfAssess).toHaveBeenCalledWith({ attemptAnswerId: 'answer_a', verdict: 'correct' })
    expect(wrapper.text()).not.toContain('Your choice replaces this result.')
    wrapper.unmount()
  })

  it('state 8: renders the mobile strip in the review with previous and next', async () => {
    const wrapper = await mountResults(attempt([correct('a'), partial('b'), incorrect('c')], 1.5))
    expect(wrapper.findAll('[data-testid="quiz-score-strip"]')).toHaveLength(2)
    expect(wrapper.text()).toContain('Question text a')
    const previous = wrapper.findAll('button').find(node => node.text() === 'Previous')!
    expect(previous.attributes('disabled')).toBeDefined()
    await clickButton(wrapper, 'Next')
    expect(wrapper.text()).toContain('Question text b')
    await clickButton(wrapper, 'Next')
    expect(wrapper.text()).toContain('Question text c')
    expect(wrapper.findAll('button').find(node => node.text() === 'Next')!.attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('updates live from pending to graded without restarting the score animation', async () => {
    const frames: FrameRequestCallback[] = []
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback)
      return frames.length
    })
    const runFrames = (time: number) => frames.splice(0).forEach(frame => frame(time))
    const dash = () => wrapper.get('[data-testid="quiz-score-ring"]').attributes('stroke-dasharray')!
    const wrapper = await mountResults(attempt([correct('a'), pending('b')], 1))
    try {
      runFrames(performance.now() + 2_000)
      await nextTick()
      expect(dash()).toBe('50 50')
      expect(wrapper.text()).toContain('Checking 1 answer.')

      resultsData.value = attempt([correct('a'), pending('b')], 1, { results: [correct('a'), pending('b')] })
      await nextTick()
      expect(frames).toHaveLength(0)
      expect(dash()).toBe('50 50')

      resultsData.value = attempt([correct('a'), partial('b')], 1.5)
      await nextTick()
      expect(dash()).toBe('50 50')
      expect(wrapper.text()).not.toContain('Checking')
      expect(wrapper.text()).toContain('1.5 of 2')
      expect(wrapper.text()).toContain('Your score')
      expect(cells(wrapper)[1].get('[data-testid="quiz-score-cell-fill"]').attributes('style')).toContain('width: 50%')

      runFrames(performance.now() + 2_000)
      await nextTick()
      expect(dash()).toBe('75 25')
    }
    finally {
      raf.mockRestore()
      wrapper.unmount()
    }
  })

  it('keeps a failed decision in place and shows an error', async () => {
    selfAssess.mockRejectedValue(new Error('offline'))
    const wrapper = await mountResults(attempt([yourCall('a'), correct('b')], 1.5))
    await wrapper.findAll('[data-slot="toggle-group-item"]')[0]!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('We couldn\'t save your choice. Check your connection and try again.')
    expect(wrapper.text()).toContain('Your call')
    expect(wrapper.text()).toContain('Learner answer a')
    expect(wrapper.findAll('[data-slot="toggle-group-item"]').every(node => node.attributes('data-state') === 'off')).toBe(true)

    selfAssess.mockResolvedValue(null)
    await wrapper.findAll('[data-slot="toggle-group-item"]')[0]!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).not.toContain('We couldn\'t save your choice.')
    wrapper.unmount()
  })

  it('disables the decision while it saves', async () => {
    let finish!: () => void
    selfAssess.mockReturnValue(new Promise<null>((resolve) => { finish = () => resolve(null) }))
    const wrapper = await mountResults(attempt([yourCall('a')], 0.5))
    await wrapper.findAll('[data-slot="toggle-group-item"]')[1]!.trigger('click')
    await nextTick()
    expect(wrapper.findAll('[data-slot="toggle-group-item"]')[0]!.attributes('disabled')).toBeDefined()
    expect(wrapper.findAll('[data-slot="toggle-group-item"]')[1]!.attributes('data-state')).toBe('on')
    finish()
    await flushPromises()
    expect(selfAssess).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('retries unchecked answers and hides try again once nothing was retried', async () => {
    const wrapper = await mountResults(attempt([notChecked('a'), correct('b')], 1))
    await clickButton(wrapper, 'Try again')
    expect(requestRetry).toHaveBeenCalledWith({ attemptId: 'attempt_1' })
    expect(wrapper.text()).toContain('Try again')

    requestRetry.mockResolvedValue({ retried: 0 })
    await clickButton(wrapper, 'Try again')
    expect(wrapper.findAll('button').some(node => node.text() === 'Try again')).toBe(false)
    expect(wrapper.text()).toContain('You can mark it yourself.')
    expect(wrapper.text()).toContain('Mark it myself')
    wrapper.unmount()
  })

  it('keeps try again and shows an error when the retry fails', async () => {
    requestRetry.mockRejectedValue(new Error('offline'))
    const wrapper = await mountResults(attempt([notChecked('a'), correct('b')], 1))
    await clickButton(wrapper, 'Try again')
    expect(wrapper.text()).toContain('We couldn\'t start checking again.')
    expect(wrapper.text()).toContain('Not checked yet')
    expect(wrapper.findAll('button').some(node => node.text() === 'Try again')).toBe(true)
    wrapper.unmount()
  })

  it('keeps a challenged grade and its selection when saving the override fails', async () => {
    selfAssess.mockRejectedValue(new Error('offline'))
    const wrapper = await mountResults(attempt([partial('a'), correct('b')], 1.5))
    await clickButton(wrapper, 'Think this is wrong?')
    await wrapper.findAll('[data-slot="toggle-group-item"]')[0]!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain("We couldn't save your choice.")
    expect(wrapper.text()).toContain('You covered the split.')
    expect(wrapper.text()).toContain('0.5 of 1')
    expect(wrapper.findAll('[data-slot="toggle-group-item"]')[1]!.attributes('data-state')).toBe('on')
    expect(cells(wrapper)[0]!.attributes('aria-current')).toBe('true')
    wrapper.unmount()
  })

  it('prevents duplicate retries while keeping the unchecked answer visible', async () => {
    let finish!: () => void
    requestRetry.mockReturnValue(new Promise((resolve) => { finish = () => resolve({ retried: 1 }) }))
    const wrapper = await mountResults(attempt([notChecked('a'), correct('b')], 1))
    await clickButton(wrapper, 'Try again')
    const retry = wrapper.findAll('button').find(node => node.text() === 'Try again')!
    expect(retry.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('Not checked yet')
    expect(wrapper.text()).toContain('Learner answer a')
    expect(requestRetry).toHaveBeenCalledOnce()
    finish()
    await flushPromises()
    expect(retry.attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })

  it('clears per-attempt retry state when a different attempt is loaded', async () => {
    requestRetry.mockResolvedValue({ retried: 0 })
    const wrapper = await mountResults(attempt([notChecked('a')], 0))
    await clickButton(wrapper, 'Try again')
    expect(wrapper.text()).not.toContain('Try again')
    resultsData.value = attempt([notChecked('b')], 0, { attemptId: 'attempt_2' })
    await wrapper.setProps({ attemptId: 'attempt_2' })
    await flushPromises()
    expect(wrapper.text()).toContain('Try again')
    expect(wrapper.text()).toContain('Learner answer b')
    wrapper.unmount()
  })

  it('counts unchecked and undecided answers, then moves the button to the next one', async () => {
    const wrapper = await mountResults(attempt([correct('a'), yourCall('b'), notChecked('c')], 1.5))
    await clickButton(wrapper, 'Decide 2 answers')
    expect(wrapper.text()).toContain('Question text b')

    resultsData.value = attempt([correct('a'), marked('b'), notChecked('c')], 2)
    await flushPromises()
    await clickButton(wrapper, 'Decide 1 answer')
    expect(wrapper.text()).toContain('Question text c')
    wrapper.unmount()
  })

  it('uses plain words on a pending answer', async () => {
    const wrapper = await mountResults(attempt([pending('a'), correct('b')], 1))
    expect(wrapper.text()).toContain('Learner answer a')
    expect(wrapper.text()).toContain('Reference a')
    expect(wrapper.text()).not.toContain('Incorrect')
    expect(wrapper.text()).not.toContain('No exact answer match')
    wrapper.unmount()
  })

  it('renders a free-form answer without a grade as it does today inside a graded attempt', async () => {
    const advisory = {
      questionId: 'old',
      questionText: 'Old row',
      questionType: 'free-response',
      userAnswer: 'Old answer',
      isCorrect: false,
      correctAnswer: 'Old reference',
      semanticAssessment: { status: 'available', label: 'fully_correct', deterministicScoreUnchanged: true },
    }
    const wrapper = await mountResults(attempt([advisory, correct('b')], 1))
    expect(wrapper.text()).toContain('No exact answer match')
    expect(wrapper.find('[data-testid="quiz-semantic-assessment"]').exists()).toBe(true)
    wrapper.unmount()
  })

  describe('long strips', () => {
    const quiz = (count: number) => attempt(Array.from({ length: count }, (_, index) => {
      const id = `q${index + 1}`
      if (index % 5 === 2) return partial(id)
      return index % 7 === 4 ? incorrect(id) : correct(id)
    }), count / 2)

    it('7 questions wrap below the tiles at 12 columns, 6 on mobile, without Q or correct icons', async () => {
      const wrapper = await mountResults(quiz(7))
      const strips = wrapper.findAll('[data-testid="quiz-score-strip"]')
      expect(strips).toHaveLength(2)
      expect(strips[0]!.classes()).toContain('sm:block')
      const grid = strips[0]!.get('.grid')
      expect(grid.classes()).toEqual(expect.arrayContaining(['grid-cols-6', 'sm:grid-cols-12']))
      const first = strips[0]!.findAll('[data-testid="quiz-score-cell"]')
      expect(first).toHaveLength(7)
      expect(first[0]!.text()).toBe('1')
      expect(first[0]!.find('svg').exists()).toBe(false)
      expect(first[0]!.attributes('aria-label')).toBe('Question 1, correct')
      expect(first[2]!.find('svg').exists()).toBe(true)
      expect(first[2]!.attributes('aria-label')).toBe('Question 3, partly correct')
      expect(wrapper.find('nav').exists()).toBe(false)
      wrapper.unmount()
    })

    it('6 questions keep the strip inside the score tile with Q labels and icons', async () => {
      const wrapper = await mountResults(quiz(6))
      const first = cells(wrapper)
      expect(first).toHaveLength(6)
      expect(first[0]!.text()).toBe('Q1')
      expect(first[0]!.find('svg').exists()).toBe(true)
      wrapper.unmount()
    })

    it('24 questions fit one page without pagination', async () => {
      const wrapper = await mountResults(quiz(24))
      expect(cells(wrapper)).toHaveLength(24)
      expect(wrapper.text()).not.toContain('Questions 1–24')
      expect(wrapper.find('nav').exists()).toBe(false)
      wrapper.unmount()
    })

    it('200 questions show 24 cells at a time and the rail pages in step', async () => {
      const wrapper = await mountResults(quiz(200))
      const strip = () => wrapper.findAll('[data-testid="quiz-score-strip"]')[0]!
      expect(strip().findAll('[data-testid="quiz-score-cell"]')).toHaveLength(24)
      expect(wrapper.findAll('[data-testid="quiz-score-cell"]')).toHaveLength(48)
      expect(strip().text()).toContain('Questions 1–24 of 200')
      expect(strip().get('[data-slot="pagination-content"]').element.tagName).toBe('UL')
      expect(wrapper.text()).toContain('Question 24')
      expect(wrapper.text()).not.toContain('Question 25')

      await strip().get('[data-slot="pagination-next"]').trigger('click')
      await flushPromises()
      expect(strip().text()).toContain('Questions 25–48 of 200')
      const page = strip().findAll('[data-testid="quiz-score-cell"]')
      expect(page[0]!.text()).toBe('25')
      expect(wrapper.text()).toContain('Question 25')
      expect(wrapper.text()).not.toContain('Question 24')
      expect(wrapper.text()).toContain('Question text q1')

      await page[1]!.trigger('click')
      await flushPromises()
      expect(wrapper.text()).toContain('Question text q26')
      expect(strip().findAll('[data-testid="quiz-score-cell"]')[1]!.attributes('aria-current')).toBe('true')
      wrapper.unmount()
    })

    it('200 questions bound the last page and keep mobile navigation in step', async () => {
      const wrapper = await mountResults(quiz(200))
      const strip = () => wrapper.findAll('[data-testid="quiz-score-strip"]')[0]!
      for (let page = 0; page < 8; page++) {
        await strip().get('[data-slot="pagination-next"]').trigger('click')
      }
      expect(strip().findAll('[data-testid="quiz-score-cell"]')).toHaveLength(8)
      expect(strip().text()).toContain('Questions 193–200 of 200')
      expect(strip().get('[data-slot="pagination-next"]').attributes('disabled')).toBeDefined()
      await strip().findAll('[data-testid="quiz-score-cell"]')[0]!.trigger('click')
      const previous = wrapper.findAll('button').filter(node => node.text() === 'Previous').at(-1)!
      await previous.trigger('click')
      expect(strip().text()).toContain('Questions 169–192 of 200')
      expect(wrapper.text()).toContain('Question text q192')
      expect(cells(wrapper)[23]!.attributes('aria-current')).toBe('true')
      wrapper.unmount()
    })

    it('200 questions page the strip to the answer the decide button opens', async () => {
      const rows = Array.from({ length: 200 }, (_, index) => index === 150 ? yourCall(`q${index + 1}`) : correct(`q${index + 1}`))
      const wrapper = await mountResults(attempt(rows, 199.5))
      await clickButton(wrapper, 'Decide 1 answer')
      expect(wrapper.findAll('[data-testid="quiz-score-strip"]')[0]!.text()).toContain('Questions 145–168 of 200')
      expect(wrapper.text()).toContain('Question text q151')
      wrapper.unmount()
    })
  })

  it('never renders the internal vocabulary or model details', async () => {
    const internal = /\bcriteria\b|\bcriterion\b|rubric|\bAI\b|\bgrader\b|confidence|provider|xingchen|weight/i
    const wrapper = await mountResults(attempt([correct('a'), partial('b'), incorrect('c'), yourCall('d'), notChecked('e'), marked('f'), pending('g')], 3))
    for (let index = 0; index < 7; index++) {
      await wrapper.findAll('[data-testid="quiz-score-strip"]')[0]!.findAll('[data-testid="quiz-score-cell"]')[index]!.trigger('click')
      await flushPromises()
      expect(wrapper.text()).not.toMatch(internal)
    }
    wrapper.unmount()
  })
})

describe('QuizResultsView attempt status', () => {
  const historyEntry = (overrides: Record<string, unknown>) => ({
    _id: 'attempt_1',
    _creationTime: 1,
    score: 1,
    total: 2,
    percentage: 50,
    status: 'completed',
    startedAt: 1,
    currentQuestionIndex: 2,
    completedAt: 2,
    ...overrides,
  })

  beforeEach(() => {
    queryCall = 0
    historyData.value = []
    useRuntimeConfig().public.quizSemanticReviewEnabled = false
    useRuntimeConfig().public.quizSemanticAssessmentEnabled = false
  })

  async function openHistory(wrapper: any) {
    await wrapper.findAll('button').find((node: any) => node.text() === 'History')!.trigger('click')
    await flushPromises()
    return document.body.querySelector('[data-slot="popover-content"]')!.textContent
  }

  it.each(['in_progress', 'abandoned'])('keeps an %s attempt with pending rows on the baseline view', async (status) => {
    const frames: FrameRequestCallback[] = []
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback)
      return frames.length
    })
    historyData.value = [historyEntry({ status, completedAt: undefined, currentQuestionIndex: 1 })]
    const wrapper = await mountResults(attempt([correct('a'), pending('b')], 1, { status, completedAt: undefined }), { QuizHistoryDropdown: false })
    try {
      frames.splice(0).forEach(frame => frame(performance.now() + 2_000))
      await nextTick()
      expect(wrapper.text()).toContain('Your Score')
      expect(wrapper.text()).toContain('50%')
      expect(wrapper.text()).toContain('Correct Answers')
      expect(wrapper.text()).toContain('1 of 2')
      expect(wrapper.text()).not.toContain('Score so far')
      expect(wrapper.text()).not.toContain('Checking')
      expect(wrapper.text()).not.toContain('It keeps going if you leave')
      expect(wrapper.find('[data-testid="quiz-score-strip"]').exists()).toBe(false)
      const history = await openHistory(wrapper)
      expect(history).toContain('50%')
      expect(history).not.toContain('Checking')
    }
    finally {
      raf.mockRestore()
      wrapper.unmount()
    }
  })

  it('keeps a completed attempt with undecided rows on the graded view', async () => {
    const wrapper = await mountResults(attempt([yourCall('a'), correct('b')], 1.5))
    expect(wrapper.text()).toContain('Your score for now')
    expect(wrapper.find('[data-testid="quiz-score-strip"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('takes the history status from the backend rather than the open attempt', async () => {
    historyData.value = [historyEntry({ gradingStatus: 'settled' })]
    const settled = await mountResults(attempt([correct('a'), pending('b')], 1), { QuizHistoryDropdown: false })
    expect(settled.text()).toContain('Checking 1 answer.')
    const history = await openHistory(settled)
    expect(history).toContain('50%')
    expect(history).not.toContain('so far')
    settled.unmount()

    queryCall = 0
    historyData.value = [historyEntry({ gradingStatus: 'grading' })]
    const grading = await mountResults(attempt([correct('a'), correct('b')], 2), { QuizHistoryDropdown: false })
    const reported = await openHistory(grading)
    expect(reported).toContain('1/2 so far')
    expect(reported).toContain('Checking')
    grading.unmount()
  })
})

describe('QuizResultsView without grades', () => {
  const legacy = {
    attemptId: 'attempt_1',
    score: 1,
    total: 2,
    percentage: 50,
    startedAt: 1,
    completedAt: 2,
    status: 'completed',
    results: [
      { questionId: 'a', questionText: 'Describe ATP.', questionType: 'free-response', userAnswer: 'It carries energy.', isCorrect: false, correctAnswer: 'An energy carrier.' },
      { questionId: 'b', questionText: 'Pick one.', questionType: 'multiple-choice', options: ['Yes', 'No'], userAnswer: 'Yes', isCorrect: true, correctAnswer: 'Yes' },
    ],
  }

  beforeEach(() => {
    queryCall = 0
    historyData.value = []
    useRuntimeConfig().public.quizSemanticReviewEnabled = false
    useRuntimeConfig().public.quizSemanticAssessmentEnabled = false
  })

  it('renders historical attempts with the original header, labels and colours', async () => {
    const wrapper = await mountResults(legacy)
    expect(wrapper.text()).toContain('Your Score')
    expect(wrapper.text()).toContain('Correct Answers')
    expect(wrapper.text()).toContain('1 of 2')
    expect(wrapper.text()).toContain('No exact answer match')
    expect(wrapper.text()).toContain('Retake Quiz')
    expect(wrapper.find('[data-testid="quiz-score-strip"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Decide')
    expect(wrapper.text()).not.toContain('Think this is wrong?')
    expect(wrapper.html()).not.toContain('dark:text-green-400')
    expect(wrapper.html()).toContain('stroke-destructive')
    expect(wrapper.findAll('button').some(node => node.text() === 'Previous')).toBe(false)
    wrapper.unmount()
  })

  it('keeps the original mobile chips and rail for ungraded attempts', async () => {
    const wrapper = await mountResults(legacy)
    expect(wrapper.text()).toContain('Q1')
    expect(wrapper.text()).toContain('Question 1')
    expect(wrapper.html()).toContain('text-green-500')
    wrapper.unmount()
  })
})
