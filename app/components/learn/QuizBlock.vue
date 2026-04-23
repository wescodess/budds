<script setup lang="ts">
import { Check, X, HelpCircle, Flag } from 'lucide-vue-next'
import { api } from '#convex/api'
import type { Id } from '../../../convex/_generated/dataModel'

const props = defineProps<{ quizId: string }>()

const quizQuery = import.meta.client
  ? useConvexQuery(
      api.quizzes.getWithQuestions,
      computed(() => ({ id: props.quizId as Id<'quizzes'> })),
    )
  : { data: ref(null) }

const quizData = computed(() => quizQuery.data?.value as {
  quiz: { title: string }
  questions: Array<{
    _id: string
    question: string
    type: string
    options?: string[]
    correctAnswer: string
    explanation?: string
    order: number
    flagged?: boolean
    correctedAnswer?: string
    correctedExplanation?: string
  }>
} | null)

const questions = computed(() => quizData.value?.questions ?? [])

const emit = defineEmits<{
  quizCompleted: [data: { correct: number; total: number }]
}>()

const answers = ref<Record<string, string>>({})
const submitted = ref<Record<string, boolean>>({})
const correctCount = ref(0)

const flaggingOpen = ref<Record<string, boolean>>({})
const flagCorrectedAnswer = ref<Record<string, string>>({})
const flagCorrectedExplanation = ref<Record<string, string>>({})
const flagSaving = ref<Record<string, boolean>>({})
const flagError = ref<Record<string, string>>({})

const flagMutation = import.meta.client
  ? useConvexMutation(api.contentFlags.flagQuizQuestion)
  : { mutate: async () => ({ success: true }) }

const allAnswered = computed(() => {
  if (questions.value.length === 0) return false
  return questions.value.every((q) => submitted.value[q._id])
})

watch(allAnswered, (done) => {
  if (done) {
    emit('quizCompleted', { correct: correctCount.value, total: questions.value.length })
  }
})

function selectAnswer(questionId: string, value: string) {
  if (submitted.value[questionId]) return
  answers.value = { ...answers.value, [questionId]: value }
}

function submitAnswer(questionId: string, correctAnswer: string) {
  if (submitted.value[questionId]) return
  submitted.value = { ...submitted.value, [questionId]: true }
  if (answers.value[questionId] === correctAnswer) {
    correctCount.value++
  }
}

function isCorrect(questionId: string, correctAnswer: string) {
  return answers.value[questionId] === correctAnswer
}

function effectiveAnswer(q: { correctAnswer: string; flagged?: boolean; correctedAnswer?: string }) {
  return (q.flagged && q.correctedAnswer) ? q.correctedAnswer : q.correctAnswer
}

function effectiveExplanation(q: { explanation?: string; flagged?: boolean; correctedExplanation?: string }) {
  return (q.flagged && q.correctedExplanation) ? q.correctedExplanation : q.explanation
}

function openFlagEditor(questionId: string, currentAnswer: string, currentExplanation?: string) {
  flaggingOpen.value = { ...flaggingOpen.value, [questionId]: true }
  flagCorrectedAnswer.value = { ...flagCorrectedAnswer.value, [questionId]: currentAnswer }
  flagCorrectedExplanation.value = { ...flagCorrectedExplanation.value, [questionId]: currentExplanation ?? '' }
}

function closeFlagEditor(questionId: string) {
  flaggingOpen.value = { ...flaggingOpen.value, [questionId]: false }
}

async function saveFlag(questionId: string) {
  const corrected = flagCorrectedAnswer.value[questionId]?.trim()
  if (!corrected) return

  flagSaving.value = { ...flagSaving.value, [questionId]: true }
  flagError.value = { ...flagError.value, [questionId]: '' }
  try {
    await flagMutation.mutate({
      questionId: questionId as Id<'quizQuestions'>,
      correctedAnswer: corrected,
      correctedExplanation: flagCorrectedExplanation.value[questionId]?.trim() || undefined,
    })
    closeFlagEditor(questionId)
  } catch (e) {
    flagError.value = { ...flagError.value, [questionId]: 'Failed to save correction. Please try again.' }
  } finally {
    flagSaving.value = { ...flagSaving.value, [questionId]: false }
  }
}
</script>

<template>
  <div class="p-6" data-testid="quiz-block">
    <div class="mb-4 flex items-center gap-2">
      <HelpCircle class="h-4 w-4 text-amber-500" />
      <span class="text-xs font-medium uppercase tracking-wide text-stone-400">Practice</span>
    </div>

    <div v-if="!quizData" class="py-8 text-center text-sm text-stone-400">
      Loading questions...
    </div>

    <div v-else class="space-y-6">
      <div
        v-for="(q, qIndex) in questions"
        :key="q._id"
        class="rounded-lg border border-stone-800 bg-stone-950 p-5"
      >
        <div class="mb-1 flex items-center justify-between">
          <p class="text-xs font-medium text-stone-500">
            Question {{ qIndex + 1 }}
          </p>
          <span
            v-if="q.flagged"
            class="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-400"
            data-testid="flag-badge"
          >
            <Flag class="h-3 w-3" /> Corrected
          </span>
        </div>
        <p class="mb-4 text-sm font-medium text-stone-100">
          {{ q.question }}
        </p>

        <div v-if="q.type === 'multiple-choice' && q.options" class="space-y-2">
          <button
            v-for="option in q.options"
            :key="option"
            type="button"
            class="flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm transition-colors"
            :class="[
              submitted[q._id]
                ? option === effectiveAnswer(q)
                  ? 'border-green-500/50 bg-green-500/10 text-green-400'
                  : option === answers[q._id] && option !== effectiveAnswer(q)
                    ? 'border-red-500/50 bg-red-500/10 text-red-400'
                    : 'border-stone-800 text-stone-500'
                : option === answers[q._id]
                  ? 'border-amber-500/50 bg-amber-500/10 text-stone-100'
                  : 'border-stone-800 text-stone-300 hover:border-stone-700 hover:bg-stone-900',
            ]"
            :disabled="!!submitted[q._id]"
            :aria-label="`Option: ${option}`"
            @click="selectAnswer(q._id, option)"
          >
            <span class="flex-1">{{ option }}</span>
            <Check v-if="submitted[q._id] && option === effectiveAnswer(q)" class="h-4 w-4 shrink-0 text-green-400" />
            <X v-else-if="submitted[q._id] && option === answers[q._id] && option !== effectiveAnswer(q)" class="h-4 w-4 shrink-0 text-red-400" />
          </button>
        </div>

        <div v-else-if="q.type === 'true_false'" class="flex gap-3">
          <button
            v-for="option in ['True', 'False']"
            :key="option"
            type="button"
            class="flex-1 rounded-lg border px-4 py-3 text-center text-sm font-medium transition-colors"
            :class="[
              submitted[q._id]
                ? option === effectiveAnswer(q)
                  ? 'border-green-500/50 bg-green-500/10 text-green-400'
                  : option === answers[q._id]
                    ? 'border-red-500/50 bg-red-500/10 text-red-400'
                    : 'border-stone-800 text-stone-500'
                : option === answers[q._id]
                  ? 'border-amber-500/50 bg-amber-500/10 text-stone-100'
                  : 'border-stone-800 text-stone-300 hover:border-stone-700',
            ]"
            :disabled="!!submitted[q._id]"
            @click="selectAnswer(q._id, option)"
          >
            {{ option }}
          </button>
        </div>

        <div v-else class="space-y-2">
          <input
            type="text"
            class="w-full rounded-lg border border-stone-800 bg-stone-950 px-4 py-3 text-sm text-stone-100 placeholder-stone-600 focus:border-amber-500 focus:outline-none"
            placeholder="Type your answer..."
            :disabled="!!submitted[q._id]"
            :value="answers[q._id] ?? ''"
            @input="selectAnswer(q._id, ($event.target as HTMLInputElement).value)"
          />
        </div>

        <button
          v-if="answers[q._id] && !submitted[q._id]"
          type="button"
          class="mt-3 rounded-lg bg-amber-500 px-4 py-2 text-xs font-medium text-stone-950 transition-colors hover:bg-amber-400"
          @click="submitAnswer(q._id, effectiveAnswer(q))"
        >
          Check Answer
        </button>

        <div aria-live="polite" class="mt-3">
          <template v-if="submitted[q._id]">
            <div
              v-if="isCorrect(q._id, effectiveAnswer(q))"
              class="flex items-center gap-2 text-sm text-green-400"
            >
              <Check class="h-4 w-4" />
              <span>Correct!</span>
            </div>
            <div v-else class="space-y-1">
              <div class="flex items-center gap-2 text-sm text-red-400">
                <X class="h-4 w-4" />
                <span>Incorrect</span>
              </div>
              <p class="text-xs text-stone-400">
                Correct answer: <span class="text-green-400">{{ effectiveAnswer(q) }}</span>
              </p>
              <p v-if="q.flagged && q.correctedAnswer" class="text-xs text-stone-500">
                <span class="line-through">{{ q.correctAnswer }}</span>
              </p>
            </div>
            <p v-if="effectiveExplanation(q)" class="mt-2 text-xs text-stone-400">
              {{ effectiveExplanation(q) }}
            </p>

            <div class="mt-3">
              <button
                v-if="!flaggingOpen[q._id]"
                type="button"
                class="inline-flex items-center gap-1 text-xs text-stone-500 transition-colors hover:text-amber-400"
                data-testid="flag-button"
                @click="openFlagEditor(q._id, effectiveAnswer(q), effectiveExplanation(q))"
              >
                <Flag class="h-3 w-3" />
                {{ q.flagged ? 'Edit correction' : 'Flag as incorrect' }}
              </button>

              <div v-if="flaggingOpen[q._id]" class="mt-2 space-y-2 rounded-lg border border-stone-700 bg-stone-900 p-3" data-testid="flag-editor">
                <label class="block text-xs text-stone-400">
                  Corrected answer
                  <input
                    type="text"
                    class="mt-1 w-full rounded border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-100 focus:border-amber-500 focus:outline-none"
                    :value="flagCorrectedAnswer[q._id]"
                    @input="flagCorrectedAnswer[q._id] = ($event.target as HTMLInputElement).value"
                  />
                </label>
                <label class="block text-xs text-stone-400">
                  Corrected explanation (optional)
                  <input
                    type="text"
                    class="mt-1 w-full rounded border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-100 focus:border-amber-500 focus:outline-none"
                    :value="flagCorrectedExplanation[q._id]"
                    @input="flagCorrectedExplanation[q._id] = ($event.target as HTMLInputElement).value"
                  />
                </label>
                <p v-if="flagError[q._id]" class="text-xs text-red-400" data-testid="flag-error">
                  {{ flagError[q._id] }}
                </p>
                <div class="flex gap-2">
                  <button
                    type="button"
                    class="rounded bg-amber-500 px-3 py-1.5 text-xs font-medium text-stone-950 transition-colors hover:bg-amber-400 disabled:opacity-50"
                    :disabled="!!flagSaving[q._id]"
                    data-testid="flag-save"
                    @click="saveFlag(q._id)"
                  >
                    {{ flagSaving[q._id] ? 'Saving...' : 'Save' }}
                  </button>
                  <button
                    type="button"
                    class="rounded border border-stone-700 px-3 py-1.5 text-xs text-stone-400 transition-colors hover:text-stone-200"
                    @click="closeFlagEditor(q._id)"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
