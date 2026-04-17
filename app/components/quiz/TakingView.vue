<script setup lang="ts">
import { ArrowLeft } from 'lucide-vue-next'
import { api } from '#convex/api'
import type { Id } from '../../../convex/_generated/dataModel'
import type { AttemptSettings, AttemptQuestion, AnswerFeedback } from '~/composables/useQuizAttempt'

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
  : { mutate: async (_args: unknown): Promise<any> => null, isLoading: ref(false) }

const submitAllMutation = import.meta.client
  ? useConvexMutation(api.quizzes.submitAllAnswers)
  : { mutate: async (_args: unknown): Promise<any> => null, isLoading: ref(false) }

const completeAttemptMutation = import.meta.client
  ? useConvexMutation(api.quizzes.completeAttempt)
  : { mutate: async (_args: unknown): Promise<any> => null, isLoading: ref(false) }

const sequentialRef = ref<InstanceType<typeof QuizSequentialMode> | null>(null)
const currentIndex = ref(props.initialIndex)
const submitting = ref(false)

async function handleAnswer(questionId: string, value: string) {
  submitting.value = true
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

async function handleComplete() {
  submitting.value = true
  try {
    await completeAttemptMutation.mutate({ attemptId: props.attemptId })
    emit('complete', props.attemptId)
  }
  finally {
    submitting.value = false
  }
}

async function handleSubmitAll(answers: Array<{ questionId: string; userAnswer: string }>) {
  submitting.value = true
  try {
    await submitAllMutation.mutate({
      attemptId: props.attemptId,
      answers: answers.map(a => ({
        questionId: a.questionId as Id<'quizQuestions'>,
        userAnswer: a.userAnswer,
      })),
    })
    emit('complete', props.attemptId)
  }
  finally {
    submitting.value = false
  }
}

function handleQuit() {
  emit('quit')
}
</script>

<template>
  <div class="flex h-full flex-col">
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
      @submit-all="handleSubmitAll"
    />

    <QuizSequentialMode
      v-else
      ref="sequentialRef"
      :questions="questions"
      :current-index="currentIndex"
      :immediate-feedback="settings.immediateFeedback"
      :submitting="submitting"
      :answered-ids="answeredIds"
      @answer="handleAnswer"
      @next="handleNext"
      @submit="handleComplete"
    />
  </div>
</template>
