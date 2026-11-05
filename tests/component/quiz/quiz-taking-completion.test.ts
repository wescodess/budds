import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'

const submitAnswer = vi.hoisted(() => vi.fn())
const submitAll = vi.hoisted(() => vi.fn())
const completeAttempt = vi.hoisted(() => vi.fn())

mockNuxtImport('useMotionPresets', () => () => ({ springSnappy: {} }))
mockNuxtImport('useConvexMutation', () => () => {
  const error = ref<Error | null>(null)
  return {
    error,
    isLoading: ref(false),
    mutate: async (args: Record<string, unknown>) => {
      try {
        if ('answers' in args) return await submitAll(args)
        return 'questionId' in args ? await submitAnswer(args) : await completeAttempt(args)
      }
      catch (caught) {
        error.value = caught as Error
      }
    },
  }
})

const takingViewPath = ['~', 'components', 'quiz', 'TakingView.vue'].join('/')

beforeAll(async () => {
  await import(takingViewPath)
})

const completed = { score: 1, total: 1, percentage: 100 }
const failureCopy = 'We couldn\'t submit your quiz. Try again.'
const question = {
  _id: 'q_1',
  quizId: 'quiz_1',
  order: 0,
  question: 'What is the result of mitosis?',
  type: 'free-response',
  correctAnswer: 'Two identical daughter cells.',
}

async function mountTaking(settings: Record<string, boolean>) {
  const TakingView = await import(takingViewPath)
  return await mountSuspended(TakingView.default, {
    props: {
      quizId: 'quiz_1',
      attemptId: 'attempt_1',
      settings: { shuffleQuestions: false, showAllQuestions: false, immediateFeedback: true, ...settings },
      questions: [question],
      initialIndex: 0,
      answeredIds: new Set<string>(),
    },
    global: { stubs: { Motion: { template: '<div><slot /></div>' } } },
    attachTo: document.body,
  })
}

function submitButton(wrapper: any, label = 'Submit') {
  const button = wrapper.findAll('button').find((node: any) => node.text() === label)
  expect(button, `button "${label}"`).toBeTruthy()
  return button
}

async function type(wrapper: any) {
  await wrapper.get('textarea').setValue('Two cells.')
  await flushPromises()
}

function deferred() {
  let resolve!: (value: unknown) => void
  let reject!: (error: Error) => void
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function press(button: any) {
  button.element.focus()
  await button.trigger('click')
  await flushPromises()
}

function dropFocusFromDisabledButton(button: any) {
  expect(button.attributes('disabled')).toBeDefined()
  document.body.focus()
}

describe('QuizTakingView completion', () => {
  beforeEach(() => {
    submitAnswer.mockReset().mockResolvedValue({ isCorrect: false, correctAnswer: question.correctAnswer, alreadyAnswered: false, gradingPending: true })
    submitAll.mockReset()
    completeAttempt.mockReset()
  })

  it('stays on the quiz when completing fails, then completes on a successful retry', async () => {
    const failing = deferred()
    completeAttempt.mockReturnValueOnce(failing.promise).mockResolvedValueOnce(completed)
    const wrapper = await mountTaking({})
    await type(wrapper)
    await submitButton(wrapper, 'Next').trigger('click')
    await flushPromises()

    const submit = submitButton(wrapper)
    await press(submit)
    dropFocusFromDisabledButton(submit)
    failing.reject(new Error('Attempt is not in progress'))
    await flushPromises()
    expect(completeAttempt).toHaveBeenCalledOnce()
    expect(wrapper.emitted('complete')).toBeUndefined()
    expect(wrapper.text()).toContain('What is the result of mitosis?')
    expect(wrapper.get('[role="alert"]').text()).toBe(failureCopy)
    expect(wrapper.text()).not.toMatch(/connection/i)
    expect(submit.attributes('disabled')).toBeUndefined()
    expect(document.activeElement).toBe(submit.element)

    await press(submit)
    expect(completeAttempt).toHaveBeenCalledTimes(2)
    expect(wrapper.emitted('complete')).toEqual([['attempt_1']])
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('treats a result-less completion as a failure', async () => {
    completeAttempt.mockResolvedValue(undefined)
    const wrapper = await mountTaking({})
    await type(wrapper)
    await submitButton(wrapper, 'Next').trigger('click')
    await flushPromises()
    await press(submitButton(wrapper))
    expect(wrapper.emitted('complete')).toBeUndefined()
    expect(wrapper.get('[role="alert"]').text()).toBe(failureCopy)
    wrapper.unmount()
  })

  it('retries the last answer and completion together when feedback is off', async () => {
    const failing = deferred()
    completeAttempt.mockReturnValueOnce(failing.promise).mockResolvedValueOnce(completed)
    const wrapper = await mountTaking({ immediateFeedback: false })
    await type(wrapper)

    const submit = submitButton(wrapper)
    await press(submit)
    dropFocusFromDisabledButton(submit)
    failing.reject(new Error('offline'))
    await flushPromises()
    expect(wrapper.emitted('complete')).toBeUndefined()
    expect(wrapper.get('[role="alert"]').text()).toBe(failureCopy)
    expect(document.activeElement).toBe(submit.element)

    submitAnswer.mockResolvedValue({ isCorrect: false, correctAnswer: question.correctAnswer, alreadyAnswered: true, gradingPending: true })
    await press(submit)
    expect(submitAnswer).toHaveBeenCalledTimes(2)
    expect(completeAttempt).toHaveBeenCalledTimes(2)
    expect(wrapper.emitted('complete')).toEqual([['attempt_1']])
    wrapper.unmount()
  })

  it('does not complete when saving the last answer fails', async () => {
    submitAnswer.mockRejectedValue(new Error('offline'))
    const wrapper = await mountTaking({ immediateFeedback: false })
    await type(wrapper)
    await press(submitButton(wrapper))
    expect(completeAttempt).not.toHaveBeenCalled()
    expect(wrapper.emitted('complete')).toBeUndefined()
    wrapper.unmount()
  })

  it('keeps every answer and permits retry when submitting all fails', async () => {
    const failing = deferred()
    submitAll.mockReturnValueOnce(failing.promise).mockResolvedValueOnce({ ...completed, results: [], gradingPending: true })
    const wrapper = await mountTaking({ showAllQuestions: true })
    await type(wrapper)

    const submit = submitButton(wrapper)
    await press(submit)
    dropFocusFromDisabledButton(submit)
    failing.reject(new Error('offline'))
    await flushPromises()
    expect(wrapper.emitted('complete')).toBeUndefined()
    expect(wrapper.get('[role="alert"]').text()).toBe(failureCopy)
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('Two cells.')
    expect(submit.attributes('disabled')).toBeUndefined()
    expect(document.activeElement).toBe(submit.element)

    await press(submit)
    expect(submitAll).toHaveBeenCalledTimes(2)
    expect(submitAll).toHaveBeenLastCalledWith({ attemptId: 'attempt_1', answers: [{ questionId: 'q_1', userAnswer: 'Two cells.' }] })
    expect(wrapper.emitted('complete')).toEqual([['attempt_1']])
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('does not take focus away from another control after a failure', async () => {
    completeAttempt.mockRejectedValue(new Error('offline'))
    const wrapper = await mountTaking({})
    await type(wrapper)
    await submitButton(wrapper, 'Next').trigger('click')
    await flushPromises()
    const quit = submitButton(wrapper, 'Save & quit')
    quit.element.focus()
    await submitButton(wrapper).trigger('click')
    await flushPromises()
    expect(document.activeElement).toBe(quit.element)
    wrapper.unmount()
  })
})
