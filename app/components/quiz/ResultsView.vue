<script setup lang="ts">
import { RotateCcw } from 'lucide-vue-next'
import { api } from '#convex/api'
import type { Id } from '../../../convex/_generated/dataModel'
import type { AttemptHistoryItem } from '~/composables/useQuizHistory'

const props = defineProps<{
  quizId: Id<'quizzes'>
  attemptId: Id<'quizAttempts'>
}>()

const emit = defineEmits<{
  retake: []
  back: []
  viewAttempt: [attemptId: Id<'quizAttempts'>]
}>()

const { data: resultsData } = useConvexQuery(
  api.quizzes.getAttemptResults,
  computed(() => ({ attemptId: props.attemptId })),
)

const { data: historyData } = useConvexQuery(
  api.quizzes.getQuizHistory,
  computed(() => ({ quizId: props.quizId })),
)

const results = computed(() => resultsData.value)
const attempts = computed<AttemptHistoryItem[]>(() =>
  (historyData.value as AttemptHistoryItem[] | undefined) ?? [],
)

function scoreColor(pct: number) {
  if (pct >= 80) return 'text-green-500'
  if (pct >= 60) return 'text-yellow-500'
  return 'text-destructive'
}

function ringColor(pct: number) {
  if (pct >= 80) return 'stroke-green-500'
  if (pct >= 60) return 'stroke-yellow-500'
  return 'stroke-destructive'
}

function formatDateTime(ts?: number) {
  if (!ts) return ''
  return new Date(ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function handleSelectAttempt(attemptId: Id<'quizAttempts'>) {
  if (attemptId === props.attemptId) return
  emit('viewAttempt', attemptId)
}

const animatedPct = ref(0)
const displayPct = computed(() => Math.round(animatedPct.value))
let scoreRafId: number | null = null

function cancelScoreAnimation() {
  if (scoreRafId !== null) {
    cancelAnimationFrame(scoreRafId)
    scoreRafId = null
  }
}

watch(results, (r) => {
  cancelScoreAnimation()
  if (!r) return
  animatedPct.value = 0
  const target = r.percentage
  const duration = 800
  const start = performance.now()
  function tick(now: number) {
    const elapsed = now - start
    const progress = Math.min(elapsed / duration, 1)
    const eased = 1 - (1 - progress) ** 3
    animatedPct.value = eased * target
    if (progress < 1) { scoreRafId = requestAnimationFrame(tick) }
    else { scoreRafId = null }
  }
  scoreRafId = requestAnimationFrame(tick)
}, { immediate: true })

onUnmounted(cancelScoreAnimation)

const { springGentle } = useMotionPresets()
</script>

<template>
  <div v-if="!results" class="space-y-3 p-6">
    <UiSkeleton v-for="i in 3" :key="i" class="h-24 w-full rounded-lg" />
  </div>

  <Motion
    v-else
    :initial="{ opacity: 0, y: 12 }"
    :animate="{ opacity: 1, y: 0 }"
    :transition="springGentle"
    class="space-y-5 p-4 sm:space-y-6 sm:p-6"
  >
    <div class="flex items-start justify-between">
      <div>
        <h2 class="text-xl font-bold">Quiz results</h2>
        <p class="mt-1 text-xs text-muted-foreground">
          {{ formatDateTime(results.startedAt) }}
          <template v-if="results.completedAt"> &mdash; {{ formatDateTime(results.completedAt) }}</template>
        </p>
      </div>
      <QuizHistoryDropdown :attempts="attempts" @select="handleSelectAttempt" />
    </div>

    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
      <div class="rounded-lg border p-4 text-center sm:p-5">
        <p class="text-xs font-medium text-muted-foreground">Your Score</p>
        <div class="relative mx-auto my-3 h-20 w-20">
          <svg class="h-full w-full -rotate-90" viewBox="0 0 36 36">
            <circle cx="18" cy="18" r="15.5" fill="none" stroke="currentColor" stroke-width="2" class="text-muted/50" />
            <circle
              cx="18" cy="18" r="15.5" fill="none" stroke-width="2.5" stroke-linecap="round"
              pathLength="100"
              :class="ringColor(results.percentage)"
              :stroke-dasharray="`${animatedPct} ${100 - animatedPct}`"
            />
          </svg>
          <span class="absolute inset-0 flex items-center justify-center text-xl font-bold" :class="scoreColor(results.percentage)">
            {{ displayPct }}%
          </span>
        </div>
      </div>
      <div class="rounded-lg border p-4 text-center sm:p-5">
        <p class="text-xs font-medium text-muted-foreground">Correct Answers</p>
        <p class="mt-5 text-3xl font-bold">{{ results.score }} <span class="text-lg text-muted-foreground">of {{ results.total }}</span></p>
      </div>
    </div>

    <div class="flex flex-wrap gap-2">
      <UiButton class="flex-1 sm:flex-none" @click="emit('retake')">
        <RotateCcw class="mr-1.5 h-3.5 w-3.5" />
        Retake Quiz
      </UiButton>
      <UiButton variant="outline" class="flex-1 sm:flex-none" @click="emit('back')">Back to overview</UiButton>
    </div>

    <div v-if="results.results.length > 0">
      <h3 class="mb-3 text-sm font-semibold">Question Review</h3>
      <QuizReviewPanel :results="results.results" />
    </div>
  </Motion>
</template>
