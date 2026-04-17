import type { Id } from '../../convex/_generated/dataModel'

export type WizardStep = 1 | 2 | 3

export function useQuizGeneration(folderId: Ref<Id<'folders'>>) {
  const { generate } = useQuizzes(folderId)

  const wizardOpen = ref(false)
  const wizardStep = ref<WizardStep>(1)
  const selectedResourceIds = ref<string[]>([])
  const suggestedTopics = ref<string[]>([])
  const selectedTopics = ref<string[]>([])
  const customTopics = ref<string[]>([])
  const loadingTopics = ref(false)
  const questionCount = ref(10)
  const questionTypes = ref<string[]>(['multiple-choice', 'true_false'])
  const difficulty = ref<string>('medium')
  const generating = ref(false)

  function openWizard() {
    wizardStep.value = 1
    selectedResourceIds.value = []
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
          resourceIds: selectedResourceIds.value,
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

  const allTopics = computed(() => [...selectedTopics.value, ...customTopics.value])

  async function generateQuiz() {
    generating.value = true
    try {
      await generate({
        questionCount: questionCount.value,
        topics: allTopics.value.length > 0 ? allTopics.value : undefined,
        questionTypes: questionTypes.value,
        difficulty: difficulty.value,
      })
      closeWizard()
    }
    finally {
      generating.value = false
    }
  }

  return {
    wizardOpen,
    wizardStep,
    selectedResourceIds,
    suggestedTopics,
    selectedTopics,
    customTopics,
    loadingTopics,
    questionCount,
    questionTypes,
    difficulty,
    generating,
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
