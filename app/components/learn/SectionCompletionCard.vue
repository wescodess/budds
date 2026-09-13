<script setup lang="ts">
import { Trophy, ArrowRight, ChevronLeft, Sparkles, BookOpen } from '@lucide/vue'

type MasteryLevel = 'new' | 'learning' | 'reviewing' | 'mastered'

const props = defineProps<{
  practiceScore: number
  masteryLevel: MasteryLevel
  conceptsForReview: number
  feedbackText: string
  hasNextSection: boolean
  isLastSection: boolean
  nextSectionReady: boolean
  nextSectionGenerating: boolean
}>()

const emit = defineEmits<{
  continueToNext: []
  backToCourse: []
}>()

const masteryConfig: Record<MasteryLevel, { label: string; color: string; bgColor: string }> = {
  new: { label: 'New', color: 'text-stone-400', bgColor: 'bg-stone-700' },
  learning: { label: 'Learning', color: 'text-amber-400', bgColor: 'bg-amber-500/20' },
  reviewing: { label: 'Reviewing', color: 'text-yellow-400', bgColor: 'bg-yellow-500/20' },
  mastered: { label: 'Mastered', color: 'text-green-400', bgColor: 'bg-green-500/20' },
}

const mastery = computed(() => masteryConfig[props.masteryLevel])

const scorePercent = computed(() => Math.round(props.practiceScore))

const circumference = 2 * Math.PI * 40
const strokeDashoffset = computed(() => {
  return circumference - (scorePercent.value / 100) * circumference
})

const scoreColor = computed(() => {
  if (props.practiceScore >= 90) return 'text-green-400'
  if (props.practiceScore >= 70) return 'text-yellow-400'
  if (props.practiceScore >= 60) return 'text-amber-400'
  return 'text-red-400'
})

const strokeColor = computed(() => {
  if (props.practiceScore >= 90) return 'stroke-green-400'
  if (props.practiceScore >= 70) return 'stroke-yellow-400'
  if (props.practiceScore >= 60) return 'stroke-amber-400'
  return 'stroke-red-400'
})
</script>

<template>
  <div
    class="mx-auto w-full max-w-md rounded-2xl border border-stone-800 bg-stone-900 p-8"
    data-testid="section-completion-card"
    role="region"
    aria-label="Section completion summary"
  >
    <div class="mb-6 flex flex-col items-center">
      <Trophy class="mb-3 h-8 w-8 text-amber-500" />
      <h2 class="text-lg font-semibold text-stone-100">
        {{ isLastSection ? 'Course Complete!' : 'Section Complete' }}
      </h2>
    </div>

    <div class="mb-6 flex justify-center">
      <div class="relative flex h-28 w-28 items-center justify-center">
        <svg class="absolute inset-0" viewBox="0 0 100 100">
          <circle
            cx="50" cy="50" r="40"
            fill="none"
            stroke-width="6"
            class="stroke-stone-800"
          />
          <circle
            cx="50" cy="50" r="40"
            fill="none"
            stroke-width="6"
            stroke-linecap="round"
            :class="strokeColor"
            :stroke-dasharray="circumference"
            :stroke-dashoffset="strokeDashoffset"
            transform="rotate(-90 50 50)"
            style="transition: stroke-dashoffset 0.6s ease-out"
          />
        </svg>
        <span :class="['text-2xl font-bold', scoreColor]" data-testid="accuracy-score">
          {{ scorePercent }}%
        </span>
      </div>
    </div>

    <div class="mb-6 flex flex-col items-center gap-3">
      <div
        :class="['inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium', mastery.bgColor, mastery.color]"
        data-testid="mastery-badge"
      >
        <Sparkles class="h-3.5 w-3.5" />
        {{ mastery.label }}
      </div>

      <div class="flex items-center gap-2 text-sm text-stone-400" data-testid="review-count">
        <BookOpen class="h-4 w-4" />
        <span>
          {{ conceptsForReview > 0
            ? `${conceptsForReview} concepts added to review`
            : 'Concepts ready for future review'
          }}
        </span>
      </div>
    </div>

    <div
      v-if="feedbackText"
      class="mb-6 rounded-lg bg-stone-800/50 px-4 py-3 text-center text-sm text-stone-300"
      data-testid="adaptive-feedback"
    >
      {{ feedbackText }}
    </div>

    <div class="flex flex-col gap-3">
      <button
        v-if="hasNextSection && !isLastSection"
        type="button"
        class="flex w-full items-center justify-center gap-2 rounded-lg px-6 py-3 text-sm font-medium transition-colors"
        :class="nextSectionReady
          ? 'bg-amber-500 text-stone-950 hover:bg-amber-400'
          : 'bg-stone-700 text-stone-400 cursor-not-allowed'"
        :disabled="!nextSectionReady"
        data-testid="continue-button"
        @click="emit('continueToNext')"
      >
        <template v-if="nextSectionGenerating">
          <div class="h-4 w-4 animate-spin rounded-full border-2 border-stone-400 border-t-transparent" />
          Preparing next section...
        </template>
        <template v-else>
          Continue to next section
          <ArrowRight class="h-4 w-4" />
        </template>
      </button>

      <button
        type="button"
        class="flex w-full items-center justify-center gap-2 rounded-lg border border-stone-700 bg-transparent px-6 py-3 text-sm font-medium text-stone-300 transition-colors hover:border-stone-600 hover:bg-stone-800"
        data-testid="back-button"
        @click="emit('backToCourse')"
      >
        <ChevronLeft class="h-4 w-4" />
        Back to Course Overview
      </button>
    </div>
  </div>
</template>
