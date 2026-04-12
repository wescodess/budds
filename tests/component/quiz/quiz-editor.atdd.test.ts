/**
 * ATDD — Story 6.3 AC #5, #6, #7, #11
 *
 * Generated BEFORE Editor.vue exists. These tests MUST fail at this point;
 * dev-story makes them pass by Task 2.
 *
 * Portal constraint (Story 6.2 AC #7, Story 6.3 AC #12):
 * Editor introduces NO portaled primitives. All assertions target direct DOM.
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
        sourceFilename: 'bio1.pdf',
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
        sourceChunkContent: 'Photosynthesis transforms light energy.',
        sourceFilename: 'bio2.pdf',
      },
    ],
  }
}

describe('QuizEditor — Story 6.3 ATDD', () => {
  beforeEach(() => {
    mockQuizData.value = undefined
    mockUpdateQuestion.mockReset()
  })

  it('[P0] renders loading skeletons while getWithQuestions resolves', async () => {
    const Editor = await import(editorPath)
    mockQuizData.value = undefined

    const wrapper = await mountSuspended(Editor.default, {
      props: { quizId: 'quiz_1' },
    })

    expect(wrapper.find('[data-testid="quiz-editor-loading"]').exists()).toBe(true)
  })

  it('[P0] renders one quiz-editor-question-row per question', async () => {
    const Editor = await import(editorPath)
    mockQuizData.value = sampleQuiz()

    const wrapper = await mountSuspended(Editor.default, {
      props: { quizId: 'quiz_1' },
    })

    const rows = wrapper.findAll('[data-testid="quiz-editor-question-row"]')
    expect(rows).toHaveLength(2)
    expect(wrapper.text()).toContain('What do mitochondria produce?')
    expect(wrapper.text()).toContain('Describe photosynthesis.')
  })

  it('[P0] clicking Edit on an MC row expands the inline form with option inputs', async () => {
    const Editor = await import(editorPath)
    mockQuizData.value = sampleQuiz()

    const wrapper = await mountSuspended(Editor.default, {
      props: { quizId: 'quiz_1' },
    })

    const editButtons = wrapper.findAll('[data-testid="quiz-editor-question-edit"]')
    await editButtons[0]!.trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="quiz-editor-question-text"]').exists()).toBe(true)
    const optionInputs = wrapper.findAll('[data-testid="quiz-editor-question-option"]')
    expect(optionInputs.length).toBe(4)
    expect(wrapper.find('[data-testid="quiz-editor-question-save"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="quiz-editor-question-cancel"]').exists()).toBe(true)
  })

  it('[P0] Save calls updateQuestion mutation with {questionId, question, options, correctAnswer}', async () => {
    const Editor = await import(editorPath)
    mockQuizData.value = sampleQuiz()
    mockUpdateQuestion.mockResolvedValue(undefined)

    const wrapper = await mountSuspended(Editor.default, {
      props: { quizId: 'quiz_1' },
    })

    const editButtons = wrapper.findAll('[data-testid="quiz-editor-question-edit"]')
    await editButtons[0]!.trigger('click')
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

  it('[P0] Cancel collapses the form without calling the mutation', async () => {
    const Editor = await import(editorPath)
    mockQuizData.value = sampleQuiz()

    const wrapper = await mountSuspended(Editor.default, {
      props: { quizId: 'quiz_1' },
    })

    const editButtons = wrapper.findAll('[data-testid="quiz-editor-question-edit"]')
    await editButtons[0]!.trigger('click')
    await flushPromises()

    await wrapper.find('[data-testid="quiz-editor-question-cancel"]').trigger('click')
    await flushPromises()

    expect(mockUpdateQuestion).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="quiz-editor-question-save"]').exists()).toBe(false)
  })
})
