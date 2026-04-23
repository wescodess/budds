<script setup lang="ts">
import { Check, X, HelpCircle } from 'lucide-vue-next'
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
  }>
} | null)

const questions = computed(() => quizData.value?.questions ?? [])

const emit = defineEmits<{
  quizCompleted: [data: { correct: number; total: number }]
}>()

const answers = ref<Record<string, string>>({})
const submitted = ref<Record<string, boolean>>({})
const correctCount = ref(0)

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
        <p class="mb-1 text-xs font-medium text-stone-500">
          Question {{ qIndex + 1 }}
        </p>
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
                ? option === q.correctAnswer
                  ? 'border-green-500/50 bg-green-500/10 text-green-400'
                  : option === answers[q._id] && option !== q.correctAnswer
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
            <Check v-if="submitted[q._id] && option === q.correctAnswer" class="h-4 w-4 shrink-0 text-green-400" />
            <X v-else-if="submitted[q._id] && option === answers[q._id] && option !== q.correctAnswer" class="h-4 w-4 shrink-0 text-red-400" />
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
                ? option === q.correctAnswer
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
          @click="submitAnswer(q._id, q.correctAnswer)"
        >
          Check Answer
        </button>

        <div aria-live="polite" class="mt-3">
          <template v-if="submitted[q._id]">
            <div
              v-if="isCorrect(q._id, q.correctAnswer)"
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
                Correct answer: <span class="text-green-400">{{ q.correctAnswer }}</span>
              </p>
            </div>
            <p v-if="q.explanation" class="mt-2 text-xs text-stone-400">
              {{ q.explanation }}
            </p>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
