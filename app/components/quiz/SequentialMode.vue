<script setup lang="ts">
import { Check, X, ChevronDown } from 'lucide-vue-next'
import type { AttemptQuestion, AnswerFeedback } from '~/composables/useQuizAttempt'

const props = defineProps<{
  questions: AttemptQuestion[]
  currentIndex: number
  immediateFeedback: boolean
  submitting: boolean
  answeredIds: Set<string>
}>()

const emit = defineEmits<{
  answer: [questionId: string, value: string]
  next: []
  submit: []
}>()

const localAnswers = ref<Record<string, string>>({})
const feedbackMap = ref<Record<string, AnswerFeedback>>({})
const showExplanation = ref(false)
const awaitingFeedback = ref(false)

const { springSnappy } = useMotionPresets()
const slideDirection = ref<'next' | 'prev'>('next')
const questionKey = ref(0)
let prevIndex = props.currentIndex

watch(() => props.currentIndex, (newIdx) => {
  slideDirection.value = newIdx > prevIndex ? 'next' : 'prev'
  questionKey.value++
  prevIndex = newIdx
})

const slideInitial = computed(() => ({
  opacity: 0,
  x: slideDirection.value === 'next' ? 40 : -40,
}))


const currentQuestion = computed(() => props.questions[props.currentIndex] ?? null)
const isLast = computed(() => props.currentIndex >= props.questions.length - 1)
const currentAnswer = computed(() => localAnswers.value[currentQuestion.value?._id as string] ?? '')
const currentFeedback = computed(() => feedbackMap.value[currentQuestion.value?._id as string] ?? null)
const hasAnswered = computed(() => currentAnswer.value.trim().length > 0)

function setAnswer(value: string) {
  if (!currentQuestion.value || currentFeedback.value) return
  localAnswers.value = { ...localAnswers.value, [currentQuestion.value._id as string]: value }
}

async function handleNext() {
  if (!currentQuestion.value) return
  const qid = currentQuestion.value._id as string

  if (!currentFeedback.value && hasAnswered.value) {
    awaitingFeedback.value = true
    emit('answer', qid, currentAnswer.value)
  }
  else if (currentFeedback.value || !props.immediateFeedback) {
    showExplanation.value = false
    awaitingFeedback.value = false

    if (isLast.value) {
      emit('submit')
    }
    else {
      emit('next')
    }
  }
}

function receiveFeedback(questionId: string, feedback: AnswerFeedback) {
  feedbackMap.value = { ...feedbackMap.value, [questionId]: feedback }
  awaitingFeedback.value = false
}

defineExpose({ receiveFeedback })
</script>

<template>
  <div v-if="currentQuestion" class="flex h-full flex-col">
    <Motion
      :key="questionKey"
      :initial="slideInitial"
      :animate="{ opacity: 1, x: 0 }"
      :transition="springSnappy"
      class="flex-1 space-y-6 p-6"
    >
      <div v-if="currentFeedback && immediateFeedback" class="rounded-lg p-3">
        <div
          v-if="currentFeedback.isCorrect"
          class="flex items-center gap-2 rounded-lg bg-green-500/10 px-4 py-3 text-green-500"
        >
          <Check class="h-4 w-4" />
          <span class="text-sm font-medium">Correct!</span>
        </div>
        <div
          v-else
          class="flex items-center gap-2 rounded-lg bg-destructive/10 px-4 py-3 text-destructive"
        >
          <X class="h-4 w-4" />
          <span class="text-sm font-medium">Oops, that's not correct.</span>
        </div>
      </div>

      <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Question {{ currentIndex + 1 }}
      </p>
      <p class="text-lg font-medium leading-relaxed">{{ currentQuestion.question }}</p>

      <div v-if="currentQuestion.type === 'multiple-choice'">
        <QuizInputsMultipleChoice
          :options="currentQuestion.options ?? []"
          :selected="currentAnswer"
          :disabled="submitting"
          :feedback="currentFeedback ? { isCorrect: currentFeedback.isCorrect, correctAnswer: currentFeedback.correctAnswer } : null"
          @select="setAnswer"
        />
      </div>
      <div v-else-if="currentQuestion.type === 'true_false'">
        <QuizInputsTrueFalse
          :selected="currentAnswer"
          :disabled="submitting"
          :feedback="currentFeedback ? { isCorrect: currentFeedback.isCorrect, correctAnswer: currentFeedback.correctAnswer } : null"
          @select="setAnswer"
        />
      </div>
      <div v-else-if="currentQuestion.type === 'fill_in_the_blank'">
        <QuizInputsFillInBlank
          :model-value="currentAnswer"
          :disabled="submitting"
          :feedback="currentFeedback ? { isCorrect: currentFeedback.isCorrect, correctAnswer: currentFeedback.correctAnswer } : null"
          @update:model-value="setAnswer"
        />
      </div>
      <div v-else>
        <QuizInputsShortResponse
          :model-value="currentAnswer"
          :disabled="submitting"
          :feedback="currentFeedback ? { isCorrect: currentFeedback.isCorrect, correctAnswer: currentFeedback.correctAnswer } : null"
          @update:model-value="setAnswer"
        />
      </div>

      <div v-if="currentFeedback && immediateFeedback && !currentFeedback.isCorrect && currentQuestion.explanation" class="rounded-lg bg-muted/50 p-4 text-sm">
        <p class="mb-1 text-xs font-medium text-muted-foreground">Correct answer:</p>
        <p class="text-green-500">{{ currentFeedback.correctAnswer }}</p>
        <p class="mt-2 text-muted-foreground">{{ currentQuestion.explanation }}</p>
      </div>

      <button
        v-if="currentFeedback && currentFeedback.isCorrect && currentQuestion.explanation"
        type="button"
        class="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        @click="showExplanation = !showExplanation"
      >
        <ChevronDown class="h-3.5 w-3.5 transition-transform" :class="{ 'rotate-180': showExplanation }" />
        Explain why
      </button>

      <div v-if="showExplanation && currentQuestion.explanation" class="rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground">
        {{ currentQuestion.explanation }}
      </div>
    </Motion>

    <div class="sticky bottom-0 border-t bg-background p-4">
      <div class="flex items-center justify-between">
        <span class="text-sm text-muted-foreground">{{ currentIndex + 1 }} of {{ questions.length }}</span>
        <div class="flex-1 mx-4">
          <div class="h-2 overflow-hidden rounded-full bg-muted">
            <div
              class="h-full rounded-full bg-primary transition-all duration-300"
              :style="{ width: `${((currentIndex + 1) / questions.length) * 100}%` }"
            />
          </div>
        </div>
        <UiButton
          :disabled="(!hasAnswered && !currentFeedback) || (awaitingFeedback && immediateFeedback) || submitting"
          @click="handleNext"
        >
          {{ submitting ? 'Submitting...' : isLast && (currentFeedback || !immediateFeedback) ? 'Submit' : 'Next' }}
        </UiButton>
      </div>
    </div>
  </div>
</template>
