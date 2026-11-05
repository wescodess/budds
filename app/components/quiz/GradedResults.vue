<script setup lang="ts">
import { RotateCcw } from '@lucide/vue'
import { api } from '#convex/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { createSsrMutationStub } from '~/utils/convexSsrMutation'
import { QUIZ_STRIP_PAGE_SIZE, QUIZ_STRIP_TILE_LIMIT, formatQuizPoints, needsQuizDecision, quizResultState, type QuizGradedResult, type QuizGradingSummary } from '~/utils/quiz-results'

const props = defineProps<{
  attemptId: Id<'quizAttempts'>
  score: number
  total: number
  percentage: number
  grading: QuizGradingSummary
  results: (QuizGradedResult & { questionId: string })[]
  semanticReviewEnabled?: boolean
  requestFailed?: boolean
}>()

const emit = defineEmits<{
  retake: []
  back: []
  retrySemantic: []
}>()

const retryMutation = import.meta.client
  ? useConvexMutation(api.quizGrading.requestGradingRetry)
  : createSsrMutationStub<typeof api.quizGrading.requestGradingRetry>()

const reviewPanel = useTemplateRef<{ revealAnswer: (focus?: boolean) => void }>('reviewPanel')

const activeIndex = ref(0)
const page = ref(0)
const retrying = ref(false)
const retryFailed = ref(false)
const retryExhausted = ref(false)

const checkingCount = computed(() => props.grading.pending)
const decisionCount = computed(() => props.grading.needsReview + props.grading.unavailable)
const provisional = computed(() => checkingCount.value > 0 || decisionCount.value > 0)
const stripInTile = computed(() => props.results.length <= QUIZ_STRIP_TILE_LIMIT)
const points = computed(() => formatQuizPoints(props.score))

const scoreLabel = computed(() => {
  if (checkingCount.value > 0) return 'Score so far'
  return decisionCount.value > 0 ? 'Your score for now' : 'Your score'
})

const pointsLabel = computed(() => {
  if (checkingCount.value > 0) return 'Points so far'
  return decisionCount.value > 0 ? 'Points for now' : 'Points'
})

const checkingCopy = computed(() => {
  const noun = checkingCount.value === 1 ? 'answer' : 'answers'
  return `Checking ${checkingCount.value} ${noun}. Usually seconds, sometimes a few minutes. It keeps going if you leave.`
})

const scoreTone = computed(() => {
  if (provisional.value) return { text: 'text-muted-foreground', stroke: 'stroke-muted-foreground' }
  if (props.percentage >= 80) return { text: 'text-green-700 dark:text-green-400', stroke: 'stroke-green-700 dark:stroke-green-400' }
  if (props.percentage >= 60) return { text: 'text-yellow-700 dark:text-yellow-400', stroke: 'stroke-yellow-700 dark:stroke-yellow-400' }
  return { text: 'text-destructive', stroke: 'stroke-destructive' }
})

const animatedPct = ref(0)
const displayPct = computed(() => Math.round(animatedPct.value))
let scoreRafId: number | null = null

function cancelScoreAnimation() {
  if (scoreRafId !== null) {
    cancelAnimationFrame(scoreRafId)
    scoreRafId = null
  }
}

function animateScore(from: number, target: number) {
  cancelScoreAnimation()
  if (!import.meta.client || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    animatedPct.value = target
    return
  }
  animatedPct.value = from
  const start = performance.now()
  function tick(now: number) {
    const progress = Math.min((now - start) / 800, 1)
    animatedPct.value = from + (1 - (1 - progress) ** 3) * (target - from)
    scoreRafId = progress < 1 ? requestAnimationFrame(tick) : null
  }
  scoreRafId = requestAnimationFrame(tick)
}

watch(() => props.attemptId, () => {
  activeIndex.value = 0
  page.value = 0
  retryFailed.value = false
  retryExhausted.value = false
  animateScore(0, props.percentage)
})

watch(() => props.percentage, target => animateScore(animatedPct.value, target))

watch(activeIndex, (index) => {
  page.value = Math.floor(index / QUIZ_STRIP_PAGE_SIZE)
})

watch(() => props.grading.unavailable, (count, previous) => {
  if (count > previous) retryExhausted.value = false
})

onMounted(() => animateScore(0, props.percentage))
onUnmounted(cancelScoreAnimation)

function openAnswer(index: number) {
  activeIndex.value = index
  nextTick(() => reviewPanel.value?.revealAnswer())
}

function decideNext() {
  const total = props.results.length
  for (let offset = 0; offset < total; offset++) {
    const index = (activeIndex.value + offset) % total
    if (needsQuizDecision(quizResultState(props.results[index]!))) {
      activeIndex.value = index
      page.value = Math.floor(index / QUIZ_STRIP_PAGE_SIZE)
      nextTick(() => reviewPanel.value?.revealAnswer(true))
      return
    }
  }
}

async function requestRetry() {
  if (retrying.value) return
  retrying.value = true
  retryFailed.value = false
  const outcome = await retryMutation.mutate({ attemptId: props.attemptId })
  retrying.value = false
  if (retryMutation.error.value || !outcome) {
    retryMutation.error.value = null
    retryFailed.value = true
    return
  }
  retryExhausted.value = outcome.retried === 0
}
</script>

<template>
  <div class="space-y-5 sm:space-y-6">
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
      <div class="rounded-lg border p-4 text-center sm:p-5">
        <p class="text-xs font-medium text-muted-foreground">{{ scoreLabel }}</p>
        <div class="relative mx-auto my-3 h-20 w-20">
          <svg class="h-full w-full -rotate-90" viewBox="0 0 36 36" aria-hidden="true">
            <circle cx="18" cy="18" r="15.5" fill="none" stroke="currentColor" stroke-width="2" class="text-muted/50" />
            <circle
              cx="18" cy="18" r="15.5" fill="none" stroke-width="2.5" stroke-linecap="round"
              pathLength="100"
              :class="scoreTone.stroke"
              :stroke-dasharray="`${animatedPct} ${100 - animatedPct}`"
              data-testid="quiz-score-ring"
            />
          </svg>
          <span class="absolute inset-0 flex items-center justify-center text-xl font-bold" :class="scoreTone.text" data-testid="quiz-score-value">
            <template v-if="checkingCount > 0">{{ points }}/{{ total }}</template>
            <template v-else>{{ displayPct }}%</template>
          </span>
        </div>
      </div>

      <div class="hidden rounded-lg border p-4 sm:block sm:p-5">
        <p class="text-center text-xs font-medium text-muted-foreground">{{ pointsLabel }}</p>
        <p class="mt-3 text-center text-3xl font-bold">{{ points }} <span class="text-lg text-muted-foreground">of {{ total }}</span></p>
        <QuizScoreStrip
          v-if="stripInTile"
          class="mt-3"
          :results="results"
          :selected-index="activeIndex"
          :page="page"
          @select="openAnswer"
        />
        <p v-if="checkingCount > 0" role="status" class="mt-2 text-center text-xs text-muted-foreground">{{ checkingCopy }}</p>
      </div>
    </div>

    <QuizScoreStrip
      v-if="!stripInTile"
      v-model:page="page"
      class="hidden sm:block"
      :results="results"
      :selected-index="activeIndex"
      @select="openAnswer"
    />

    <div class="flex flex-wrap gap-2">
      <template v-if="decisionCount > 0">
        <UiButton class="flex-1 sm:flex-none" @click="decideNext">
          Decide {{ decisionCount }} {{ decisionCount === 1 ? 'answer' : 'answers' }}
        </UiButton>
        <UiButton variant="outline" class="flex-1 hover:text-foreground sm:flex-none" @click="emit('retake')">
          <RotateCcw class="mr-1.5 h-3.5 w-3.5" />
          Retake Quiz
        </UiButton>
        <UiButton variant="ghost" class="flex-1 sm:flex-none" @click="emit('back')">Back to overview</UiButton>
      </template>
      <template v-else>
        <UiButton class="flex-1 sm:flex-none" @click="emit('retake')">
          <RotateCcw class="mr-1.5 h-3.5 w-3.5" />
          Retake Quiz
        </UiButton>
        <UiButton variant="outline" class="flex-1 hover:text-foreground sm:flex-none" @click="emit('back')">Back to overview</UiButton>
      </template>
    </div>

    <div>
      <h3 class="mb-3 text-sm font-semibold">Question Review</h3>
      <QuizReviewPanel
        ref="reviewPanel"
        v-model:active-index="activeIndex"
        graded
        :page="page"
        :results="results"
        :semantic-review-enabled="semanticReviewEnabled"
        :request-failed="requestFailed"
        @retry-semantic="emit('retrySemantic')"
      >
        <template #summary>
          <p class="text-3xl font-bold">{{ points }} <span class="text-lg text-muted-foreground">of {{ total }}</span></p>
          <QuizScoreStrip
            v-model:page="page"
            :results="results"
            :selected-index="activeIndex"
            @select="activeIndex = $event"
          />
          <p v-if="checkingCount > 0" role="status" class="text-xs text-muted-foreground">{{ checkingCopy }}</p>
        </template>
        <template #answer="{ result }">
          <QuizGradedAnswer
            :key="result.questionId"
            :result="result"
            :retrying="retrying"
            :retry-failed="retryFailed"
            :retry-exhausted="retryExhausted"
            @retry="requestRetry"
          />
        </template>
      </QuizReviewPanel>
    </div>
  </div>
</template>
