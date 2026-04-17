<script setup lang="ts">
import type { AttemptSettings } from '~/composables/useQuizAttempt'

defineProps<{ open: boolean }>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  start: [settings: AttemptSettings]
}>()

const shuffle = ref(false)
const showAll = ref(false)
const immediateFeedback = ref(true)

function handleStart() {
  emit('start', {
    shuffleQuestions: shuffle.value,
    showAllQuestions: showAll.value,
    immediateFeedback: immediateFeedback.value,
  })
  emit('update:open', false)
}
</script>

<template>
  <UiDialog :open="open" @update:open="emit('update:open', $event)">
    <UiDialogContent class="sm:max-w-md">
      <UiDialogHeader>
        <UiDialogTitle>Quiz Settings</UiDialogTitle>
      </UiDialogHeader>

      <div class="space-y-5 py-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium">Shuffle questions</p>
            <p class="text-xs text-muted-foreground">Randomize question order</p>
          </div>
          <UiSwitch :checked="shuffle" @update:checked="shuffle = $event" />
        </div>

        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium">Show all questions</p>
            <p class="text-xs text-muted-foreground">Display all questions on one page</p>
          </div>
          <UiSwitch :checked="showAll" @update:checked="showAll = $event" />
        </div>

        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium">Immediate feedback</p>
            <p class="text-xs text-muted-foreground">Show answers after each question</p>
          </div>
          <UiSwitch :checked="immediateFeedback" @update:checked="immediateFeedback = $event" />
        </div>
      </div>

      <UiDialogFooter>
        <UiButton variant="ghost" @click="emit('update:open', false)">Cancel</UiButton>
        <UiButton @click="handleStart">Start</UiButton>
      </UiDialogFooter>
    </UiDialogContent>
  </UiDialog>
</template>
