<script setup lang="ts">
import { useTeachingQuery } from '~/composables/useTeachingQuery'

import { CircleAlert } from '@lucide/vue'
import { api } from '#convex/api'
import type { Id } from '../../../convex/_generated/dataModel'

const props = defineProps<{
  quizId: Id<'quizzes'>
}>()

const previewQuery = useTeachingQuery(
  api.quizzes.getWithQuestions,
  computed(() => ({ id: props.quizId })),
)
const data = previewQuery.data
const previewFailure = computed(() => previewQuery.failure.value)

const questions = computed(() => data.value?.questions ?? [])

function truncate(text: string, max = 120): string {
  if (text.length <= max) return text
  return `${text.slice(0, max).trimEnd()}...`
}
</script>

<template>
  <div class="border-t bg-muted/30 p-4" data-testid="quiz-card-preview">
    <p v-if="previewFailure && !previewFailure.retryable" role="status" data-testid="quiz-read-paused" class="flex items-start gap-2 text-xs text-foreground"><CircleAlert class="mt-0.5 size-4 shrink-0 text-[var(--learn-attention)]" aria-hidden="true" /><span class="min-w-0">{{ previewFailure.message }}</span></p>
    <div v-else-if="previewFailure" role="alert" data-testid="quiz-read-error" class="text-xs text-foreground">
      Could not load the preview.
      <button type="button" data-testid="quiz-read-retry" class="ml-1 font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" @click="previewQuery.refresh?.()">Try again</button>
    </div>
    <div v-else-if="!data" class="text-xs text-muted-foreground">
      Loading preview...
    </div>
    <ul v-else class="space-y-3">
      <li
        v-for="q in questions"
        :key="q._id"
        class="flex flex-col gap-1 text-sm"
      >
        <p class="font-medium">{{ q.order + 1 }}. {{ q.question }}</p>
        <div class="flex items-center gap-2 text-xs text-muted-foreground">
          <ChatCitationBadge :index="q.order + 1" :filename="q.sourceFilename" />
          <span class="truncate">{{ truncate(q.sourceChunkContent ?? '') }}</span>
        </div>
      </li>
    </ul>
  </div>
</template>
