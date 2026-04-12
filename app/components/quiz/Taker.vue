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

const submitAttemptMutation = import.meta.client
  ? useConvexMutation(api.quizzes.submitAttempt)
  : {
      mutate: async (_args: unknown): Promise<any> => null,
      isLoading: ref(false),
    }

type TakerState = 'loading' | 'answering' | 'submitting' | 'results' | 'error'
const state = ref<TakerState>('loading')
const answerState = ref<Record<string, string>>({})
const resultsByQuestion = ref<Record<string, QuestionResult>>({})
const scoreSummary = ref<{ correct: number; total: number } | null>(null)

const quiz = computed(() => quizData.value?.quiz ?? null)
const questions = computed(() => quizData.value?.questions ?? [])

watch(
  quizData,
  (val) => {
    if (state.value === 'submitting' || state.value === 'results') return
    if (val === undefined) {
      state.value = 'loading'
      return
    }
    if (val === null) {
      state.value = 'error'
      return
    }
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
        <UiButton
          class="mt-4"
          variant="outline"
          size="sm"
          data-testid="quiz-results-back"
          @click="handleBack"
        >
          Back to quiz list
        </UiButton>
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
