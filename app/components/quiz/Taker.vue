<script setup lang="ts">
import { ArrowLeft } from 'lucide-vue-next'
import { api } from '#convex/api'
import type { Id } from '../../../convex/_generated/dataModel'
import type { QuestionResult } from './Question.vue'

const props = defineProps<{
  quizId: Id<'quizzes'>
}>()

const emit = defineEmits<{
  back: []
}>()

const { data: quizData } = useConvexQuery(
  api.quizzes.getWithQuestions,
  computed(() => ({ id: props.quizId })),
)

const { data: attemptsData } = useConvexQuery(
  api.quizzes.listAttempts,
  computed(() => ({ quizId: props.quizId })),
)

const submitAttemptMutation = import.meta.client
  ? useConvexMutation(api.quizzes.submitAttempt)
  : {
      mutate: async (_args: unknown): Promise<any> => null,
      isLoading: ref(false),
    }

type TakerState = 'loading' | 'answering' | 'submitting' | 'results' | 'error'
const state = ref<TakerState>('loading')
const reviewMode = ref(false)
const answerState = ref<Record<string, string>>({})
const resultsByQuestion = ref<Record<string, QuestionResult>>({})
const scoreSummary = ref<{ correct: number; total: number } | null>(null)
const hydratedFromAttempt = ref(false)

const quiz = computed(() => quizData.value?.quiz ?? null)
const questions = computed(() => quizData.value?.questions ?? [])

function hydrateFromAttempt() {
  const quizLoaded = quizData.value
  const attempts = attemptsData.value
  if (!quizLoaded || !attempts || attempts.length === 0) return
  const latest = attempts[0]
  if (!latest) return
  const byId: Record<string, QuestionResult> = {}
  const questionMap = new Map<string, { correctAnswer: string }>()
  for (const q of quizLoaded.questions ?? []) {
    questionMap.set(String(q._id), { correctAnswer: q.correctAnswer })
  }
  for (const a of latest.answers ?? []) {
    const qid = String(a.questionId)
    byId[qid] = {
      isCorrect: a.isCorrect,
      correctAnswer: questionMap.get(qid)?.correctAnswer ?? '',
      userResponse: a.response,
    }
  }
  resultsByQuestion.value = byId
  scoreSummary.value = { correct: latest.score, total: latest.total }
  reviewMode.value = true
  state.value = 'results'
  hydratedFromAttempt.value = true
}

watch(
  [quizData, attemptsData],
  ([quizVal, attemptsVal]) => {
    if (state.value === 'submitting') return
    if (quizVal === undefined) {
      if (!hydratedFromAttempt.value) state.value = 'loading'
      return
    }
    if (quizVal === null) {
      state.value = 'error'
      return
    }
    if (!hydratedFromAttempt.value && Array.isArray(attemptsVal) && attemptsVal.length > 0) {
      hydrateFromAttempt()
      return
    }
    if (state.value === 'results') return
    state.value = 'answering'
  },
  { immediate: true },
)

const allAnswered = computed(() => {
  if (questions.value.length === 0) return false
  return questions.value.every((q) => {
    const r = answerState.value[q._id as unknown as string]
    return typeof r === 'string' && r.trim().length > 0
  })
})

function updateResponse(questionId: string, value: string) {
  answerState.value = { ...answerState.value, [questionId]: value }
}

async function handleSubmit() {
  if (!allAnswered.value || state.value === 'submitting') return
  state.value = 'submitting'
  try {
    const payload = {
      quizId: props.quizId,
      answers: questions.value.map((q) => ({
        questionId: q._id,
        response: answerState.value[q._id as unknown as string] ?? '',
      })),
    }
    const result = await submitAttemptMutation.mutate(payload) as {
      attemptId: string
      score: number
      total: number
      correctCount: number
      results: Array<{
        questionId: string
        isCorrect: boolean
        correctAnswer: string
        userResponse: string
      }>
    }

    const byId: Record<string, QuestionResult> = {}
    for (const r of result.results) {
      byId[r.questionId] = {
        isCorrect: r.isCorrect,
        correctAnswer: r.correctAnswer,
        userResponse: r.userResponse,
      }
    }
    resultsByQuestion.value = byId
    scoreSummary.value = { correct: result.correctCount, total: result.total }
    state.value = 'results'
  }
  catch (e: any) {
    const { toast } = await import('vue-sonner')
    toast.error(e?.message || 'Failed to submit quiz')
    state.value = 'answering'
  }
}

const scorePercent = computed(() => {
  if (!scoreSummary.value || scoreSummary.value.total === 0) return 0
  return Math.round((scoreSummary.value.correct / scoreSummary.value.total) * 100)
})

function handleRetake() {
  answerState.value = {}
  resultsByQuestion.value = {}
  scoreSummary.value = null
  reviewMode.value = false
  hydratedFromAttempt.value = true
  state.value = 'answering'
}

function handleBack() {
  emit('back')
}
</script>

<template>
  <div data-testid="quiz-taker">
    <div v-if="state === 'loading'" class="space-y-3" data-testid="quiz-taker-loading">
      <UiSkeleton v-for="i in 3" :key="i" class="h-32 w-full rounded-md animate-pulse" />
    </div>

    <div v-else-if="state === 'error'" class="rounded-md border p-6 text-center">
      <p class="font-medium">Quiz not found</p>
      <p class="mt-1 text-sm text-muted-foreground">This quiz may have been deleted.</p>
      <UiButton class="mt-4" variant="outline" data-testid="quiz-taker-back" @click="handleBack">
        <ArrowLeft class="mr-1.5 h-4 w-4" />
        Back
      </UiButton>
    </div>

    <div v-else class="space-y-4">
      <div class="flex items-center justify-between">
        <UiButton variant="ghost" size="sm" data-testid="quiz-taker-back" @click="handleBack">
          <ArrowLeft class="mr-1.5 h-4 w-4" />
          Back to quizzes
        </UiButton>
        <h2 class="text-lg font-semibold">{{ quiz?.title }}</h2>
      </div>

      <div
        v-if="state === 'results' && scoreSummary"
        class="rounded-md border bg-muted/30 p-6 text-center"
      >
        <p class="text-sm text-muted-foreground">Your score</p>
        <p class="mt-1 text-4xl font-bold" data-testid="quiz-results-score">
          {{ scoreSummary.correct }} / {{ scoreSummary.total }}
        </p>
        <p class="mt-1 text-lg text-muted-foreground" data-testid="quiz-results-percent">
          {{ scorePercent }}%
        </p>
        <div class="mt-4 flex items-center justify-center gap-2">
          <UiButton
            variant="outline"
            size="sm"
            data-testid="quiz-results-back"
            @click="handleBack"
          >
            Back to quiz list
          </UiButton>
          <UiButton
            size="sm"
            data-testid="quiz-taker-retake"
            @click="handleRetake"
          >
            Retake quiz
          </UiButton>
        </div>
      </div>

      <div class="space-y-3">
        <QuizQuestion
          v-for="(q, i) in questions"
          :key="q._id"
          :index="i"
          :total="questions.length"
          :question="{
            _id: q._id,
            type: q.type,
            question: q.question,
            options: q.options,
            sourceFilename: q.sourceFilename,
            sourceChunkContent: q.sourceChunkContent,
          }"
          :response="answerState[q._id] ?? ''"
          :disabled="state === 'submitting'"
          :result="resultsByQuestion[q._id] ?? null"
          @update:response="updateResponse(q._id, $event)"
        />
      </div>

      <div v-if="state !== 'results'" class="flex justify-end">
        <UiButton
          data-testid="quiz-submit-button"
          :disabled="!allAnswered || state === 'submitting'"
          @click="handleSubmit"
        >
          <span v-if="state === 'submitting'">Submitting...</span>
          <span v-else>Submit Quiz</span>
        </UiButton>
      </div>
    </div>
  </div>
</template>
