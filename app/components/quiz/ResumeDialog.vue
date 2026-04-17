<script setup lang="ts">
import type { AttemptHistoryItem } from '~/composables/useQuizHistory'

const props = defineProps<{
  open: boolean
  quizTitle: string
  attempt: AttemptHistoryItem | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  resume: []
  startNew: []
}>()

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <UiDialog :open="open" @update:open="emit('update:open', $event)">
    <UiDialogContent class="sm:max-w-sm">
      <UiDialogHeader>
        <UiDialogTitle>{{ quizTitle }}</UiDialogTitle>
      </UiDialogHeader>

      <div v-if="attempt" class="space-y-4 py-4">
        <div class="flex items-center justify-between text-sm">
          <span class="text-muted-foreground">Progress</span>
          <span>{{ attempt.currentQuestionIndex ?? 0 }} of {{ attempt.total }} answered</span>
        </div>

        <div class="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            class="h-full rounded-full bg-primary transition-all"
            :style="{ width: `${attempt.total > 0 ? ((attempt.currentQuestionIndex ?? 0) / attempt.total) * 100 : 0}%` }"
          />
        </div>

        <p class="text-xs text-muted-foreground">
          Started {{ formatDate(attempt.startedAt) }} at {{ formatTime(attempt.startedAt) }}
        </p>
      </div>

      <div class="flex flex-col gap-2">
        <UiButton class="w-full" @click="emit('resume'); emit('update:open', false)">
          Resume quiz
        </UiButton>
        <UiButton variant="outline" class="w-full" @click="emit('startNew'); emit('update:open', false)">
          Start new quiz
        </UiButton>
      </div>
    </UiDialogContent>
  </UiDialog>
</template>
