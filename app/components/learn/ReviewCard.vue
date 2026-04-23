<script setup lang="ts">
const props = defineProps<{
  prompt: string
  answer: string
  courseTitle: string
  sectionOrder: number
  revealed: boolean
  flagged?: boolean
  correctedAnswer?: string
}>()

const emit = defineEmits<{
  reveal: []
}>()

const displayAnswer = computed(() =>
  props.flagged && props.correctedAnswer ? props.correctedAnswer : props.answer,
)
</script>

<template>
  <div class="flex flex-col items-center gap-4">
    <div
      class="w-full max-w-xl rounded-2xl border border-stone-800 bg-stone-900 p-8 sm:p-10"
      :aria-live="revealed ? 'polite' : 'off'"
      data-testid="review-card"
    >
      <p class="text-center text-xl font-medium text-stone-100 sm:text-2xl" data-testid="review-prompt">
        {{ prompt }}
      </p>

      <div v-if="!revealed" class="mt-8 flex justify-center">
        <button
          type="button"
          class="rounded-lg border border-stone-700 px-6 py-3 text-sm text-stone-400 transition-colors hover:border-stone-600 hover:text-stone-200"
          data-testid="reveal-button"
          @click="emit('reveal')"
        >
          Tap to reveal
        </button>
      </div>

      <div v-else class="mt-8 border-t border-stone-800 pt-6" data-testid="review-answer">
        <p class="text-center text-base text-stone-200">
          {{ displayAnswer }}
        </p>
        <p
          v-if="flagged && correctedAnswer"
          class="mt-2 text-center text-xs text-stone-500 line-through"
        >
          {{ answer }}
        </p>
      </div>
    </div>

    <p class="text-xs text-stone-500" data-testid="source-attribution">
      From: {{ courseTitle }}, Section {{ sectionOrder + 1 }}
    </p>
  </div>
</template>
