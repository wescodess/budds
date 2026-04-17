<script setup lang="ts">
import { Check, X } from 'lucide-vue-next'

interface ReviewQuestion {
  questionId: string
  questionText: string
  questionType: string
  options?: string[]
  userAnswer: string
  isCorrect: boolean
  correctAnswer: string
  explanation?: string
}

const props = defineProps<{
  results: ReviewQuestion[]
}>()

const activeIndex = ref(0)
const activeResult = computed(() => props.results[activeIndex.value] ?? null)

function truncate(text: string, max = 60) {
  return text.length > max ? `${text.slice(0, max)}...` : text
}
</script>

<template>
  <div class="flex h-full min-h-[400px] rounded-lg border">
    <div class="w-64 shrink-0 overflow-y-auto border-r">
      <button
        v-for="(r, i) in results"
        :key="r.questionId"
        type="button"
        class="flex w-full items-start gap-2 border-b border-border/50 px-3 py-3 text-left text-sm transition-colors last:border-b-0"
        :class="activeIndex === i ? 'border-l-2 border-l-primary bg-accent/50' : 'hover:bg-accent/30'"
        @click="activeIndex = i"
      >
        <span class="mt-0.5 shrink-0">
          <Check v-if="r.isCorrect" class="h-3.5 w-3.5 text-green-500" />
          <X v-else class="h-3.5 w-3.5 text-destructive" />
        </span>
        <div class="min-w-0">
          <p class="text-xs font-medium text-muted-foreground">Question {{ i + 1 }}</p>
          <p class="truncate text-xs">{{ truncate(r.questionText) }}</p>
        </div>
      </button>
    </div>

    <div v-if="activeResult" class="flex-1 overflow-y-auto p-6">
      <p class="text-lg font-medium">{{ activeResult.questionText }}</p>

      <div class="mt-6 space-y-4">
        <div v-if="activeResult.questionType === 'multiple-choice' && activeResult.options" class="space-y-2">
          <div
            v-for="opt in activeResult.options"
            :key="opt"
            class="flex items-center gap-2 rounded-lg border px-4 py-3 text-sm"
            :class="{
              'border-green-500 bg-green-500/10': opt === activeResult.correctAnswer,
              'border-destructive bg-destructive/5': opt === activeResult.userAnswer && !activeResult.isCorrect && opt !== activeResult.correctAnswer,
            }"
          >
            <span class="flex-1">{{ opt }}</span>
            <Check v-if="opt === activeResult.correctAnswer" class="h-3.5 w-3.5 text-green-500" />
            <X v-else-if="opt === activeResult.userAnswer && !activeResult.isCorrect" class="h-3.5 w-3.5 text-destructive" />
          </div>
        </div>

        <div v-else class="space-y-3">
          <div>
            <p class="text-xs font-medium text-muted-foreground">Your answer</p>
            <p class="mt-1 rounded-md border px-3 py-2 text-sm" :class="activeResult.isCorrect ? 'border-green-500/50' : 'border-destructive/50'">
              {{ activeResult.userAnswer || '(no answer)' }}
            </p>
          </div>
          <div v-if="!activeResult.isCorrect">
            <p class="text-xs font-medium text-muted-foreground">Correct answer</p>
            <p class="mt-1 rounded-md border border-green-500/50 px-3 py-2 text-sm text-green-500">
              {{ activeResult.correctAnswer }}
            </p>
          </div>
        </div>

        <div v-if="activeResult.explanation" class="rounded-lg bg-muted/50 p-4">
          <p class="mb-1 text-xs font-medium text-muted-foreground">Explanation</p>
          <p class="text-sm">{{ activeResult.explanation }}</p>
        </div>
      </div>
    </div>
  </div>
</template>
