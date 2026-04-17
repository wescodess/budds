<script setup lang="ts">
import { Sparkles, Loader2 } from 'lucide-vue-next'
import type { Id } from '../../../convex/_generated/dataModel'

const props = defineProps<{
  open: boolean
  folderId: Id<'folders'>
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  generationStarted: []
}>()

const gen = useQuizGeneration(computed(() => props.folderId))

watch(() => props.open, (isOpen) => {
  if (isOpen) gen.openWizard()
})

async function handleNextFromStep1() {
  gen.nextStep()
  await gen.generateTopics()
}

async function handleGenerate() {
  try {
    await gen.generateQuiz()
    emit('generationStarted')
    const { toast } = await import('vue-sonner')
    toast.success('Generation started')
  }
  catch (e: any) {
    const { toast } = await import('vue-sonner')
    toast.error(e?.message || 'Failed to start generation')
  }
}

const stepIndicator = computed(() =>
  [1, 2, 3].map(s => ({
    step: s,
    active: s === gen.wizardStep.value,
    completed: s < gen.wizardStep.value,
  })),
)
</script>

<template>
  <UiDialog :open="open" @update:open="emit('update:open', $event)">
    <UiDialogContent class="sm:max-w-lg">
      <div class="flex justify-center gap-2 py-2">
        <div
          v-for="s in stepIndicator"
          :key="s.step"
          class="h-2.5 w-2.5 rounded-full transition-colors"
          :class="{
            'bg-primary': s.active || s.completed,
            'bg-muted': !s.active && !s.completed,
          }"
        />
      </div>

      <QuizWizardResourceStep
        v-if="gen.wizardStep.value === 1"
        :folder-id="folderId"
        :selected-file-ids="gen.selectedFileIds.value"
        :selected-folder-ids="gen.selectedFolderIds.value"
        @update:selected-file-ids="gen.selectedFileIds.value = $event"
        @update:selected-folder-ids="gen.selectedFolderIds.value = $event"
      />

      <QuizWizardTopicStep
        v-else-if="gen.wizardStep.value === 2"
        :suggested-topics="gen.suggestedTopics.value"
        :selected-topics="gen.selectedTopics.value"
        :custom-topics="gen.customTopics.value"
        :loading="gen.loadingTopics.value"
        @toggle-topic="gen.toggleTopic"
        @add-custom="gen.addCustomTopic"
        @remove-custom="gen.removeCustomTopic"
      />

      <QuizWizardSettingsStep
        v-else
        :question-count="gen.questionCount.value"
        :question-types="gen.questionTypes.value"
        :difficulty="gen.difficulty.value"
        @update:question-count="gen.questionCount.value = $event"
        @update:difficulty="gen.difficulty.value = $event"
        @toggle-type="gen.toggleQuestionType"
      />

      <UiDialogFooter>
        <UiButton v-if="gen.wizardStep.value > 1" variant="ghost" @click="gen.prevStep()">Back</UiButton>
        <UiButton v-if="gen.wizardStep.value === 1" variant="ghost" @click="emit('update:open', false)">Cancel</UiButton>

        <UiButton
          v-if="gen.wizardStep.value === 1"
          :disabled="gen.selectedCount.value === 0"
          @click="handleNextFromStep1"
        >
          Next
        </UiButton>
        <UiButton v-else-if="gen.wizardStep.value === 2" @click="gen.nextStep()">Next</UiButton>
        <UiButton
          v-else
          :disabled="gen.submitting.value || gen.questionTypes.value.length === 0"
          @click="handleGenerate"
        >
          <Loader2 v-if="gen.submitting.value" class="mr-1.5 h-3.5 w-3.5 animate-spin" />
          <Sparkles v-else class="mr-1.5 h-3.5 w-3.5" />
          {{ gen.submitting.value ? 'Starting...' : 'Generate' }}
        </UiButton>
      </UiDialogFooter>
    </UiDialogContent>
  </UiDialog>
</template>
