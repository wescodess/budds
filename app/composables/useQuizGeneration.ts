import { api } from '#convex/api'
import type { Id } from '../../convex/_generated/dataModel'
import { createSsrMutationStub } from '~/utils/convexSsrMutation'

export type WizardStep = 1 | 2 | 3

export function useQuizGeneration(folderId: Ref<Id<'folders'>>) {
  const createTaskMutation = import.meta.client
    ? useConvexMutation(api.tasks.create)
    : createSsrMutationStub<typeof api.tasks.create>()

  const wizardOpen = ref(false)
  const wizardStep = ref<WizardStep>(1)
  const selectedFileIds = ref<Set<string>>(new Set())
  const selectedFolderIds = ref<Set<string>>(new Set())
  const suggestedTopics = ref<string[]>([])
  const selectedTopics = ref<string[]>([])
  const customTopics = ref<string[]>([])
  const loadingTopics = ref(false)
  const questionCount = ref(10)
  const questionTypes = ref<string[]>(['multiple-choice', 'true_false'])
  const difficulty = ref<string>('medium')
  const submitting = ref(false)

  function openWizard() {
    wizardStep.value = 1
    selectedFileIds.value = new Set()
    selectedFolderIds.value = new Set()
    suggestedTopics.value = []
    selectedTopics.value = []
    customTopics.value = []
    questionCount.value = 10
    questionTypes.value = ['multiple-choice', 'true_false']
    difficulty.value = 'medium'
    wizardOpen.value = true
  }

  function closeWizard() {
    wizardOpen.value = false
  }

  function nextStep() {
    if (wizardStep.value < 3) wizardStep.value = (wizardStep.value + 1) as WizardStep
  }

  function prevStep() {
    if (wizardStep.value > 1) wizardStep.value = (wizardStep.value - 1) as WizardStep
  }

  async function generateTopics() {
    loadingTopics.value = true
    try {
      const result = await $fetch<{ topics: string[] }>('/api/quiz/topics', {
        method: 'POST',
        body: {
          folderId: folderId.value,
          resourceIds: [...selectedFileIds.value, ...selectedFolderIds.value],
        },
      })
      suggestedTopics.value = result.topics
      selectedTopics.value = [...result.topics]
    }
    catch {
      suggestedTopics.value = []
    }
    finally {
      loadingTopics.value = false
    }
  }

  function toggleTopic(topic: string) {
    const idx = selectedTopics.value.indexOf(topic)
    if (idx >= 0) {
      selectedTopics.value = selectedTopics.value.filter((_, i) => i !== idx)
    }
    else {
      selectedTopics.value = [...selectedTopics.value, topic]
    }
  }

  function addCustomTopic(topic: string) {
    const trimmed = topic.trim()
    if (trimmed && !customTopics.value.includes(trimmed)) {
      customTopics.value = [...customTopics.value, trimmed]
    }
  }

  function removeCustomTopic(topic: string) {
    customTopics.value = customTopics.value.filter(t => t !== topic)
  }

  function toggleQuestionType(type: string) {
    const idx = questionTypes.value.indexOf(type)
    if (idx >= 0 && questionTypes.value.length > 1) {
      questionTypes.value = questionTypes.value.filter((_, i) => i !== idx)
    }
    else if (idx < 0) {
      questionTypes.value = [...questionTypes.value, type]
    }
  }

  const selectedCount = computed(() => selectedFileIds.value.size + selectedFolderIds.value.size)
  const allTopics = computed(() => [...selectedTopics.value, ...customTopics.value])

  async function generateQuiz() {
    if (submitting.value) return
    submitting.value = true
    try {
      const result = await createTaskMutation.mutate({
        folderId: folderId.value,
        type: 'quiz-generation',
        title: `Generating ${questionCount.value} questions…`,
        metadata: {
          questionCount: questionCount.value,
          difficulty: difficulty.value,
        },
      })

      if (!result) throw new Error('Task creation returned no task')

      closeWizard()

      $fetch('/api/quiz/generate', {
        method: 'POST',
        body: {
          folderId: folderId.value,
          taskId: result.taskId,
          questionCount: questionCount.value,
          topics: allTopics.value.length > 0 ? allTopics.value : undefined,
          questionTypes: questionTypes.value,
          difficulty: difficulty.value,
          language: 'en',
        },
      }).catch(() => {})
    }
    finally {
      submitting.value = false
    }
  }

  return {
    wizardOpen,
    wizardStep,
    selectedFileIds,
    selectedFolderIds,
    suggestedTopics,
    selectedTopics,
    customTopics,
    loadingTopics,
    questionCount,
    questionTypes,
    difficulty,
    submitting,
    selectedCount,
    allTopics,
    openWizard,
    closeWizard,
    nextStep,
    prevStep,
    generateTopics,
    toggleTopic,
    addCustomTopic,
    removeCustomTopic,
    toggleQuestionType,
    generateQuiz,
  }
}
