<script setup lang="ts">
import { ArrowLeft } from '@lucide/vue'
import { api } from '#convex/api'
import type { Id } from '../../../convex/_generated/dataModel'
import type { AttemptSettings, AttemptQuestion, AnswerFeedback } from '~/composables/useQuizAttempt'
import QuizSequentialMode from './SequentialMode.vue'
import { createSsrMutationStub } from '~/utils/convexSsrMutation'

const props = defineProps<{
  quizId: Id<'quizzes'>
  attemptId: Id<'quizAttempts'>
  settings: AttemptSettings
  questions: AttemptQuestion[]
  initialIndex: number
  answeredIds: Set<string>
}>()

const emit = defineEmits<{
  complete: [attemptId: Id<'quizAttempts'>]
  quit: []
}>()

const submitAnswerMutation = import.meta.client
  ? useConvexMutation(api.quizzes.submitAnswer)
  : createSsrMutationStub<typeof api.quizzes.submitAnswer>()

const submitAllMutation = import.meta.client
  ? useConvexMutation(api.quizzes.submitAllAnswers)
  : createSsrMutationStub<typeof api.quizzes.submitAllAnswers>()

const completeAttemptMutation = import.meta.client
  ? useConvexMutation(api.quizzes.completeAttempt)
  : createSsrMutationStub<typeof api.quizzes.completeAttempt>()

const sequentialRef = ref<InstanceType<typeof QuizSequentialMode> | null>(null)
const currentIndex = ref(props.initialIndex)
const submitting = ref(false)
const submitFailed = ref(false)
const root = useTemplateRef<HTMLElement>('root')

async function handleAnswer(questionId: string, value: string) {
  submitting.value = true
  submitFailed.value = false
  try {
    const feedback = await submitAnswerMutation.mutate({
      attemptId: props.attemptId,
      questionId: questionId as Id<'quizQuestions'>,
      userAnswer: value,
    }) as AnswerFeedback | null

    if (feedback && props.settings.immediateFeedback && sequentialRef.value) {
      sequentialRef.value.receiveFeedback(questionId, feedback)
    }
    else if (feedback && !props.settings.immediateFeedback) {
      if (currentIndex.value < props.questions.length - 1) {
        currentIndex.value++
      }
      else {
        await handleComplete()
      }
    }
  }
  finally {
    submitting.value = false
  }
}

function handleNext() {
  if (currentIndex.value < props.questions.length - 1) {
    currentIndex.value++
  }
}

async function finishAttempt(submit: () => Promise<unknown>) {
  submitting.value = true
  submitFailed.value = false
  try {
    if (await submit()) {
      emit('complete', props.attemptId)
      return
    }
    submitFailed.value = true
  }
  finally {
    submitting.value = false
  }
  await nextTick()
  if (document.activeElement === document.body) {
    root.value?.querySelector<HTMLElement>('[data-quiz-submit]')?.focus()
  }
}

function handleComplete() {
  return finishAttempt(() => completeAttemptMutation.mutate({ attemptId: props.attemptId }))
}

function handleSubmitAll(answers: Array<{ questionId: string; userAnswer: string }>) {
  return finishAttempt(() => submitAllMutation.mutate({
    attemptId: props.attemptId,
    answers: answers.map(a => ({
      questionId: a.questionId as Id<'quizQuestions'>,
      userAnswer: a.userAnswer,
    })),
  }))
}

function handleQuit() {
  emit('quit')
}
</script>

<template>
  <div ref="root" class="flex h-full flex-col">
    <div class="flex items-center gap-2 border-b p-3">
      <UiButton variant="ghost" size="sm" @click="handleQuit">
        <ArrowLeft class="mr-1 h-3.5 w-3.5" />
        Save & quit
      </UiButton>
    </div>

    <QuizShowAllMode
      v-if="settings.showAllQuestions"
      :questions="questions"
      :submitting="submitting"
      :submit-failed="submitFailed"
      @submit-all="handleSubmitAll"
    />

    <QuizSequentialMode
      v-else
      ref="sequentialRef"
      :questions="questions"
      :current-index="currentIndex"
      :immediate-feedback="settings.immediateFeedback"
      :submitting="submitting"
      :submit-failed="submitFailed"
      :answered-ids="answeredIds"
      @answer="handleAnswer"
      @next="handleNext"
      @submit="handleComplete"
    />
  </div>
</template>
