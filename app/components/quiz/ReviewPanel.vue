<script setup lang="ts">
import { Check, CircleMinus, Clock3, Sparkles, TriangleAlert, X } from '@lucide/vue'

type SemanticAssessment = {
  status: 'pending' | 'available' | 'unavailable'
  label?: 'fully_correct' | 'partially_correct' | 'incorrect' | 'uncertain'
  unavailableReason?: string
  retryable?: boolean
  retryDueAt?: number
  deterministicScoreUnchanged: boolean
}

interface ReviewQuestion {
  questionId: string
  questionText: string
  questionType: string
  options?: string[]
  userAnswer: string
  isCorrect: boolean
  correctAnswer: string
  explanation?: string
  semanticAssessment?: SemanticAssessment
}

const props = defineProps<{
  results: ReviewQuestion[]
  semanticReviewEnabled?: boolean
  requestFailed?: boolean
}>()
const emit = defineEmits<{ retrySemantic: [] }>()

const activeIndex = ref(0)
const activeResult = computed(() => props.results[activeIndex.value] ?? null)
const currentTime = ref(Date.now())
let retryClock: ReturnType<typeof setInterval> | undefined

onMounted(() => {
  retryClock = setInterval(() => { currentTime.value = Date.now() }, 1_000)
})

onUnmounted(() => {
  if (retryClock) clearInterval(retryClock)
})

function truncate(text: string, max = 60) {
  return text.length > max ? `${text.slice(0, max)}...` : text
}

function semanticLabel(label?: SemanticAssessment['label']) {
  if (label === 'fully_correct') return 'Strong meaning match'
  if (label === 'partially_correct') return 'Partial meaning match'
  if (label === 'incorrect') return 'Meaning does not align with the reference'
  return 'Meaning review: uncertain'
}

function isFreeForm(type: string) {
  return type === 'free-response' || type === 'fill_in_the_blank'
}

function retryIsDue(assessment: SemanticAssessment) {
  return props.requestFailed === true
    || (assessment.retryable === true && (assessment.retryDueAt ?? 0) <= currentTime.value)
}
</script>

<template>
  <div class="flex flex-col rounded-lg border sm:min-h-[400px] sm:flex-row">
    <div class="flex gap-1.5 overflow-x-auto border-b p-2 sm:hidden">
      <button
        v-for="(r, i) in results"
        :key="r.questionId"
        type="button"
        class="inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors"
        :class="activeIndex === i ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-accent/30'"
        @click="activeIndex = i"
      >
        <Check v-if="r.isCorrect" class="h-3 w-3 text-green-500" />
        <CircleMinus v-else-if="isFreeForm(r.questionType)" class="h-3 w-3 text-muted-foreground" />
        <X v-else class="h-3 w-3 text-destructive" />
        Q{{ i + 1 }}
      </button>
    </div>

    <div class="hidden w-64 shrink-0 overflow-y-auto border-r sm:block">
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
          <CircleMinus v-else-if="isFreeForm(r.questionType)" class="h-3.5 w-3.5 text-muted-foreground" />
          <X v-else class="h-3.5 w-3.5 text-destructive" />
        </span>
        <div class="min-w-0">
          <p class="text-xs font-medium text-muted-foreground">Question {{ i + 1 }}</p>
          <p class="truncate text-xs">{{ truncate(r.questionText) }}</p>
        </div>
      </button>
    </div>

    <div v-if="activeResult" class="flex-1 overflow-y-auto p-4 sm:p-6">
      <p class="text-base font-medium sm:text-lg">{{ activeResult.questionText }}</p>

      <div class="mt-4 space-y-3 sm:mt-6 sm:space-y-4">
        <template v-if="!isFreeForm(activeResult.questionType)">
          <div v-if="activeResult.options" class="space-y-2">
            <div
              v-for="opt in activeResult.options"
              :key="opt"
              class="flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm sm:px-4 sm:py-3"
              :class="{
                'border-green-500 bg-green-500/10': opt === activeResult.correctAnswer,
                'border-destructive bg-destructive/5': opt === activeResult.userAnswer && !activeResult.isCorrect && opt !== activeResult.correctAnswer,
              }"
            >
              <span class="min-w-0 flex-1">{{ opt }}</span>
              <Check v-if="opt === activeResult.correctAnswer" class="h-3.5 w-3.5 shrink-0 text-green-500" />
              <X v-else-if="opt === activeResult.userAnswer && !activeResult.isCorrect" class="h-3.5 w-3.5 shrink-0 text-destructive" />
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
              <p class="mt-1 rounded-md border border-green-500/50 px-3 py-2 text-sm text-green-500">{{ activeResult.correctAnswer }}</p>
            </div>
          </div>
        </template>

        <div v-else class="space-y-3">
          <div>
            <p class="text-xs font-medium text-muted-foreground">Your answer</p>
            <p class="mt-1 rounded-md border px-3 py-2 text-sm" :class="activeResult.isCorrect ? 'border-green-500/50' : 'border-muted-foreground/40'">
              {{ activeResult.userAnswer || '(no answer)' }}
            </p>
            <p v-if="!activeResult.isCorrect" class="mt-1 text-xs font-medium text-muted-foreground">No exact answer match</p>
          </div>
          <div v-if="!activeResult.isCorrect">
            <p class="text-xs font-medium text-muted-foreground">Reference answer</p>
            <p class="mt-1 rounded-md border px-3 py-2 text-sm">
              {{ activeResult.correctAnswer }}
            </p>
          </div>
        </div>

        <div
          v-if="semanticReviewEnabled && activeResult.semanticAssessment"
          class="rounded-lg border border-violet-500/30 bg-violet-500/5 p-3 sm:p-4"
          data-testid="quiz-semantic-assessment"
          role="status"
          aria-live="polite"
        >
          <p class="mb-3 inline-flex rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">
            Development beta · AI-reviewed
          </p>
          <div v-if="activeResult.semanticAssessment.status === 'pending' && !activeResult.semanticAssessment.retryable && !requestFailed" class="flex items-start gap-2">
            <Clock3 class="mt-0.5 h-4 w-4 shrink-0 text-violet-500" aria-hidden="true" />
            <div>
              <p class="text-sm font-medium">Reviewing meaning and evidence…</p>
              <p class="mt-1 text-xs text-muted-foreground">Your quiz result is ready; this optional review may arrive shortly.</p>
            </div>
          </div>
          <div v-else-if="activeResult.semanticAssessment.status === 'pending'" class="flex items-start gap-2">
            <TriangleAlert class="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
            <div>
              <p class="text-sm font-medium">Meaning review temporarily unavailable</p>
              <p class="mt-1 text-xs text-muted-foreground">Your recorded score is complete. You can retry this optional review when it is due.</p>
              <UiButton
                class="mt-2"
                size="sm"
                variant="outline"
                :disabled="!retryIsDue(activeResult.semanticAssessment)"
                data-testid="quiz-semantic-retry"
                @click="emit('retrySemantic')"
              >
                {{ retryIsDue(activeResult.semanticAssessment) ? 'Retry meaning review' : 'Retry available shortly' }}
              </UiButton>
            </div>
          </div>
          <div v-else-if="activeResult.semanticAssessment.status === 'available'" class="flex items-start gap-2">
            <Sparkles class="mt-0.5 h-4 w-4 shrink-0 text-violet-500" aria-hidden="true" />
            <div>
              <p class="text-sm font-medium">{{ semanticLabel(activeResult.semanticAssessment.label) }}</p>
              <p class="mt-1 text-xs text-muted-foreground">Advisory review compares your response with the saved answer and source evidence.</p>
            </div>
          </div>
          <div v-else class="flex items-start gap-2">
            <TriangleAlert class="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
            <div>
              <p class="text-sm font-medium">Meaning review unavailable</p>
              <p class="mt-1 text-xs text-muted-foreground">The automatic reviewer could not make a reliable assessment.</p>
            </div>
          </div>
          <p class="mt-3 border-t border-violet-500/20 pt-2 text-xs font-medium text-muted-foreground">
            Advisory only — this is not a corrected grade. Your recorded score has not changed.
          </p>
        </div>

        <div v-if="activeResult.explanation" class="rounded-lg bg-muted/50 p-3 sm:p-4">
          <p class="mb-1 text-xs font-medium text-muted-foreground">Explanation</p>
          <p class="text-sm">{{ activeResult.explanation }}</p>
        </div>
      </div>
    </div>
  </div>
</template>
