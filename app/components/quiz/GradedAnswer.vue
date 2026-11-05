<script setup lang="ts">
import { Check, CircleHelp, Clock, Pencil, X } from '@lucide/vue'
import { formatQuizPoints, isQuizFreeForm, quizResultCredit, quizResultState, type QuizGradedResult, type QuizSelfVerdict } from '~/utils/quiz-results'

const props = defineProps<{
  result: QuizGradedResult
  retrying?: boolean
  retryFailed?: boolean
  retryExhausted?: boolean
}>()

const emit = defineEmits<{ retry: [] }>()

const deciding = ref(false)

const state = computed(() => quizResultState(props.result))
const credit = computed(() => formatQuizPoints(quizResultCredit(props.result)))
const markedByYou = computed(() => props.result.grade?.source === 'self')
const settled = computed(() => state.value === 'correct' || state.value === 'partial' || state.value === 'incorrect')
const canChallenge = computed(() => settled.value && props.result.grade?.source === 'model')
const verdict = computed(() => settled.value ? state.value as QuizSelfVerdict : undefined)
const feedback = computed(() => canChallenge.value ? props.result.grade?.feedback : undefined)
const showOptions = computed(() => !isQuizFreeForm(props.result.questionType) && Boolean(props.result.options))
const showKey = computed(() => state.value !== 'not_checked' || deciding.value)

const creditLine = computed(() => {
  if (state.value === 'your_call') return `${credit.value} of 1 for now`
  return settled.value ? `${credit.value} of 1` : null
})
</script>

<template>
  <div class="break-words">
    <div class="mt-3 flex flex-wrap items-center gap-2">
      <QuizResultBadge :state="state" :marked-by-you="markedByYou" />
      <span v-if="creditLine" class="text-xs font-medium text-muted-foreground">{{ creditLine }}</span>
    </div>
    <p v-if="feedback" class="mt-2 text-sm">{{ feedback }}</p>

    <div class="mt-4 space-y-3">
      <div v-if="showOptions" class="space-y-2">
        <div
          v-for="opt in result.options"
          :key="opt"
          class="flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm sm:px-4 sm:py-3"
          :class="{
            'border-green-500 bg-green-500/10': opt === result.correctAnswer,
            'border-destructive bg-destructive/5': opt === result.userAnswer && !result.isCorrect && opt !== result.correctAnswer,
          }"
        >
          <span class="min-w-0 flex-1">{{ opt }}</span>
          <Check v-if="opt === result.correctAnswer" aria-hidden="true" class="h-3.5 w-3.5 shrink-0 text-green-700 dark:text-green-400" />
          <X v-else-if="opt === result.userAnswer && !result.isCorrect" aria-hidden="true" class="h-3.5 w-3.5 shrink-0 text-destructive" />
        </div>
      </div>

      <template v-else>
        <div>
          <p class="text-xs font-medium text-muted-foreground">Your answer</p>
          <p class="mt-1 rounded-md border px-3 py-2 text-sm break-words">{{ result.userAnswer || '(no answer)' }}</p>
        </div>
        <div v-if="showKey && result.correctAnswer">
          <p class="text-xs font-medium text-muted-foreground">Reference answer</p>
          <p class="mt-1 rounded-md border px-3 py-2 text-sm break-words">{{ result.correctAnswer }}</p>
        </div>
      </template>

      <div v-if="result.explanation && showKey" class="rounded-lg bg-muted/50 p-3">
        <p class="mb-1 text-xs font-medium text-muted-foreground">Explanation</p>
        <p class="text-sm">{{ result.explanation }}</p>
      </div>

      <UiAlert v-if="state === 'your_call' && result.attemptAnswerId" role="group">
        <CircleHelp aria-hidden="true" />
        <UiAlertTitle>Your call</UiAlertTitle>
        <UiAlertDescription>
          <p>We weren't sure about this answer, so it's your call. {{ credit }} is counted for now, and your choice replaces it.</p>
          <QuizGradeDecision class="mt-2 text-foreground" :attempt-answer-id="result.attemptAnswerId" />
        </UiAlertDescription>
      </UiAlert>

      <UiAlert v-else-if="state === 'not_checked' && result.attemptAnswerId" role="group">
        <Clock aria-hidden="true" />
        <UiAlertTitle>Not checked yet</UiAlertTitle>
        <UiAlertDescription>
          <p>
            We couldn't finish checking this answer. It isn't marked wrong and doesn't count yet.
            {{ retryExhausted ? 'You can mark it yourself.' : 'Try again later, or mark it yourself.' }}
          </p>
          <QuizGradeDecision
            v-if="deciding"
            class="mt-2 text-foreground"
            :attempt-answer-id="result.attemptAnswerId"
            @decided="deciding = false"
          />
          <div v-else class="mt-2 flex flex-wrap gap-2 text-foreground">
            <UiButton
              v-if="!retryExhausted"
              variant="outline"
              class="hover:text-foreground"
              size="sm"
              :disabled="retrying"
              @click="emit('retry')"
            >
              <UiSpinner v-if="retrying" aria-hidden="true" class="size-3.5 motion-reduce:animate-none" />
              Try again
            </UiButton>
            <UiButton variant="ghost" size="sm" @click="deciding = true">Mark it myself</UiButton>
          </div>
          <p v-if="retryFailed" role="alert" class="mt-2 text-xs text-destructive">
            We couldn't start checking again. Check your connection and try again.
          </p>
        </UiAlertDescription>
      </UiAlert>

      <div v-else-if="deciding && result.attemptAnswerId">
        <p class="mb-2 text-xs font-medium text-muted-foreground">Your choice replaces this result.</p>
        <QuizGradeDecision :attempt-answer-id="result.attemptAnswerId" :current="verdict" @decided="deciding = false" />
      </div>

      <div v-else-if="markedByYou" class="flex items-center justify-between gap-2">
        <p class="text-xs font-medium text-muted-foreground">Your choice counts</p>
        <UiButton variant="ghost" size="sm" @click="deciding = true">
          <Pencil aria-hidden="true" class="h-3.5 w-3.5" />
          Change
        </UiButton>
      </div>
    </div>

    <div v-if="canChallenge && !deciding" class="mt-3">
      <UiButton variant="ghost" size="sm" @click="deciding = true">Think this is wrong?</UiButton>
    </div>
  </div>
</template>
