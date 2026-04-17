<script setup lang="ts">
import { History } from 'lucide-vue-next'
import type { Id } from '../../../convex/_generated/dataModel'
import type { AttemptHistoryItem } from '~/composables/useQuizHistory'

defineProps<{
  attempts: AttemptHistoryItem[]
}>()

const emit = defineEmits<{
  select: [attemptId: Id<'quizAttempts'>]
}>()

const open = ref(false)

function scoreColor(percentage: number) {
  if (percentage >= 80) return 'bg-green-500/20 text-green-500'
  if (percentage >= 60) return 'bg-yellow-500/20 text-yellow-500'
  return 'bg-destructive/20 text-destructive'
}

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <UiPopover v-model:open="open">
    <UiPopoverTrigger as-child>
      <UiButton variant="outline" size="sm" class="gap-1.5">
        <History class="h-3.5 w-3.5" />
        History
      </UiButton>
    </UiPopoverTrigger>
    <UiPopoverContent align="end" class="w-64 p-0">
      <div v-if="attempts.length === 0" class="p-4 text-center text-sm text-muted-foreground">
        No attempts yet
      </div>
      <div v-else class="max-h-64 overflow-y-auto">
        <button
          v-for="attempt in attempts"
          :key="attempt._id"
          type="button"
          class="flex w-full items-center justify-between gap-2 border-b border-border/50 px-4 py-3 text-left text-sm hover:bg-accent/50 last:border-b-0"
          @click="emit('select', attempt._id); open = false"
        >
          <div class="flex flex-col gap-0.5">
            <span class="text-xs text-muted-foreground">{{ formatDate(attempt.startedAt) }} at {{ formatTime(attempt.startedAt) }}</span>
            <span class="text-xs text-muted-foreground">{{ attempt.score }}/{{ attempt.total }}</span>
          </div>
          <span
            class="rounded-full px-2 py-0.5 text-xs font-medium"
            :class="scoreColor(attempt.percentage)"
          >
            {{ attempt.percentage }}%
          </span>
        </button>
      </div>
    </UiPopoverContent>
  </UiPopover>
</template>
