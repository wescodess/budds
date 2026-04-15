/**
 * QuizEditor — Story 6.3 AC #5, #6, #7, #11
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'

const mockQuizData = ref<any>(undefined)
const mockUpdateQuestion = vi.fn()

mockNuxtImport('useConvexQuery', () => {
  return (_api: unknown, _args: unknown) => ({ data: mockQuizData })
})

mockNuxtImport('useConvexMutation', () => {
  return (_api: unknown) => ({
    mutate: mockUpdateQuestion,
    isLoading: ref(false),
  })
})

const editorPath = ['~', 'components', 'quiz', 'Editor.vue'].join('/')

function sampleQuiz() {
  return {
    quiz: {
      _id: 'quiz_1',
      _creationTime: Date.now(),
      title: 'Cell Biology',
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

describe('QuizEditor', () => {
  beforeEach(() => {
    mockQuizData.value = undefined
    mockUpdateQuestion.mockReset()
  })

  it('[P0] renders loading state', async () => {
    const Editor = await import(editorPath)
    const wrapper = await mountSuspended(Editor.default, {
      props: { quizId: 'quiz_1' },
    })
    expect(wrapper.find('[data-testid="quiz-editor-loading"]').exists()).toBe(true)
  })

  it('[P0] renders one row per question', async () => {
    const Editor = await import(editorPath)
    mockQuizData.value = sampleQuiz()
    const wrapper = await mountSuspended(Editor.default, {
      props: { quizId: 'quiz_1' },
    })
    expect(wrapper.findAll('[data-testid="quiz-editor-question-row"]')).toHaveLength(2)
  })

  it('[P0] Edit on MC row expands MC form controls', async () => {
    const Editor = await import(editorPath)
    mockQuizData.value = sampleQuiz()
    const wrapper = await mountSuspended(Editor.default, {
      props: { quizId: 'quiz_1' },
    })
    const editBtns = wrapper.findAll('[data-testid="quiz-editor-question-edit"]')
    await editBtns[0]!.trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="quiz-editor-question-text"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-testid="quiz-editor-question-option"]')).toHaveLength(4)
  })

  it('[P0] Edit on free-response row expands correct-answer textarea', async () => {
    const Editor = await import(editorPath)
    mockQuizData.value = sampleQuiz()
    const wrapper = await mountSuspended(Editor.default, {
      props: { quizId: 'quiz_1' },
    })
    const editBtns = wrapper.findAll('[data-testid="quiz-editor-question-edit"]')
    await editBtns[1]!.trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="quiz-editor-question-correct-free"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-testid="quiz-editor-question-option"]')).toHaveLength(0)
  })

  it('[P0] Save MC with valid input calls updateQuestion with correct payload', async () => {
    const Editor = await import(editorPath)
    mockQuizData.value = sampleQuiz()
    mockUpdateQuestion.mockResolvedValue(undefined)
    const wrapper = await mountSuspended(Editor.default, {
      props: { quizId: 'quiz_1' },
    })
    await wrapper.findAll('[data-testid="quiz-editor-question-edit"]')[0]!.trigger('click')
    await flushPromises()
    await wrapper.find('[data-testid="quiz-editor-question-save"]').trigger('click')
    await flushPromises()
    expect(mockUpdateQuestion).toHaveBeenCalledTimes(1)
    const payload = mockUpdateQuestion.mock.calls[0]![0]
    expect(payload.questionId).toBe('q_1')
    expect(payload.question).toBe('What do mitochondria produce?')
    expect(payload.correctAnswer).toBe('ATP')
    expect(payload.options).toEqual(['ATP', 'DNA', 'RNA', 'Glucose'])
  })

  it('[P0] Cancel does not call the mutation and collapses the form', async () => {
    const Editor = await import(editorPath)
    mockQuizData.value = sampleQuiz()
    const wrapper = await mountSuspended(Editor.default, {
      props: { quizId: 'quiz_1' },
    })
    await wrapper.findAll('[data-testid="quiz-editor-question-edit"]')[0]!.trigger('click')
    await flushPromises()
    await wrapper.find('[data-testid="quiz-editor-question-cancel"]').trigger('click')
    await flushPromises()
    expect(mockUpdateQuestion).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="quiz-editor-question-save"]').exists()).toBe(false)
  })

  it('[P1] back button emits back event', async () => {
    const Editor = await import(editorPath)
    mockQuizData.value = sampleQuiz()
    const wrapper = await mountSuspended(Editor.default, {
      props: { quizId: 'quiz_1' },
    })
    await wrapper.find('[data-testid="quiz-editor-back"]').trigger('click')
    expect(wrapper.emitted('back')).toBeTruthy()
  })

  it('[P1] clicking Edit on a second row collapses the first', async () => {
    const Editor = await import(editorPath)
    mockQuizData.value = sampleQuiz()
    const wrapper = await mountSuspended(Editor.default, {
      props: { quizId: 'quiz_1' },
    })
    const editBtns = wrapper.findAll('[data-testid="quiz-editor-question-edit"]')
    await editBtns[0]!.trigger('click')
    await flushPromises()
    expect(wrapper.findAll('[data-testid="quiz-editor-question-save"]')).toHaveLength(1)

    const editBtnsAfter = wrapper.findAll('[data-testid="quiz-editor-question-edit"]')
    expect(editBtnsAfter.length).toBe(1)
    await editBtnsAfter[0]!.trigger('click')
    await flushPromises()
    expect(wrapper.findAll('[data-testid="quiz-editor-question-save"]')).toHaveLength(1)
  })

  it('[P1] does not mark the full editor surface as a gesture owner', async () => {
    const Editor = await import(editorPath)
    mockQuizData.value = sampleQuiz()
    const wrapper = await mountSuspended(Editor.default, {
      props: { quizId: 'quiz_1' },
    })

    expect(wrapper.get('[data-testid="quiz-editor"]').attributes('data-gesture-owner')).toBeUndefined()
  })
})
