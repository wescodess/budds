<script setup lang="ts">
import { api } from '#convex/api'
import type { Id } from '../../../convex/_generated/dataModel'

const props = defineProps<{
  quizId: Id<'quizzes'>
}>()

const { data } = useConvexQuery(
  api.quizzes.getWithQuestions,
  computed(() => ({ id: props.quizId })),
)

const questions = computed(() => data.value?.questions ?? [])

function truncate(text: string, max = 120): string {
  if (text.length <= max) return text
  return `${text.slice(0, max).trimEnd()}...`
}
</script>

<template>
  <div class="border-t bg-muted/30 p-4" data-testid="quiz-card-preview">
    <div v-if="!data" class="text-xs text-muted-foreground">
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
