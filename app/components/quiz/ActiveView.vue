<script setup lang="ts">
import { api } from '#convex/api'
import type { Id } from '../../../convex/_generated/dataModel'
import type { AttemptSettings, AttemptQuestion } from '~/composables/useQuizAttempt'
import type { AttemptHistoryItem } from '~/composables/useQuizHistory'

const props = defineProps<{
  quizId: Id<'quizzes'>
  folderId: Id<'folders'>
}>()

const emit = defineEmits<{
  back: []
  openWizard: []
}>()

const { data: quizData } = useConvexQuery(
  api.quizzes.getWithQuestions,
  computed(() => ({ id: props.quizId })),
)

const { data: historyData } = useConvexQuery(
  api.quizzes.getQuizHistory,
  computed(() => ({ quizId: props.quizId })),
)

const startAttemptMutation = import.meta.client
  ? useConvexMutation(api.quizzes.startAttempt)
  : { mutate: async (_args: unknown): Promise<any> => null, isLoading: ref(false) }

type ViewState = 'overview' | 'taking' | 'results'
const viewState = ref<ViewState>('overview')

const quiz = computed(() => quizData.value?.quiz ?? null)
const questions = computed(() => quizData.value?.questions ?? [])

const attempts = computed<AttemptHistoryItem[]>(() =>
  (historyData.value as AttemptHistoryItem[] | undefined) ?? [],
)
const hasInProgressAttempt = computed(() =>
  attempts.value.some(a => a.status === 'in_progress'),
)
const inProgressAttempt = computed(() =>
  attempts.value.find(a => a.status === 'in_progress') ?? null,
)

const settingsOpen = ref(false)
const resumeDialogOpen = ref(false)

const takingQuestions = ref<AttemptQuestion[]>([])
const takingSettings = ref<AttemptSettings | null>(null)
const takingAttemptId = ref<Id<'quizAttempts'> | null>(null)
const takingInitialIndex = ref(0)
const takingAnsweredIds = ref<Set<string>>(new Set())
const resultsAttemptId = ref<Id<'quizAttempts'> | null>(null)

function handleTakeQuiz() {
  if (hasInProgressAttempt.value) {
    resumeDialogOpen.value = true
  }
  else {
    settingsOpen.value = true
  }
}

async function handleStartAttempt(settings: AttemptSettings) {
  const result = await startAttemptMutation.mutate({
    quizId: props.quizId,
    settings,
    restart: true,
  }) as any
  if (result) {
    takingQuestions.value = result.questions
    takingSettings.value = result.settings
    takingAttemptId.value = result.attemptId
    takingInitialIndex.value = result.currentQuestionIndex
    takingAnsweredIds.value = new Set(result.answeredQuestionIds)
    viewState.value = 'taking'
  }
}

async function handleResume() {
  const result = await startAttemptMutation.mutate({
    quizId: props.quizId,
    settings: { shuffleQuestions: false, showAllQuestions: false, immediateFeedback: true },
    restart: false,
  }) as any
  if (result) {
    takingQuestions.value = result.questions
    takingSettings.value = result.settings
    takingAttemptId.value = result.attemptId
    takingInitialIndex.value = result.currentQuestionIndex
    takingAnsweredIds.value = new Set(result.answeredQuestionIds)
    viewState.value = 'taking'
  }
}

function handleComplete(attemptId: Id<'quizAttempts'>) {
  resultsAttemptId.value = attemptId
  viewState.value = 'results'
}

function handleAbandon() {
  viewState.value = 'overview'
}

function handleRetake() {
  settingsOpen.value = true
}

function handleBackToOverview() {
  viewState.value = 'overview'
  resultsAttemptId.value = null
}
</script>

<template>
  <div class="flex h-full flex-col">
    <QuizTakingView
      v-if="viewState === 'taking' && takingAttemptId && takingSettings"
      :quiz-id="quizId"
      :attempt-id="takingAttemptId"
      :settings="takingSettings"
      :questions="takingQuestions"
      :initial-index="takingInitialIndex"
      :answered-ids="takingAnsweredIds"
      @complete="handleComplete"
      @abandon="handleAbandon"
    />

    <QuizResultsView
      v-else-if="viewState === 'results' && resultsAttemptId"
      :quiz-id="quizId"
      :attempt-id="resultsAttemptId"
      @retake="handleRetake"
      @back="handleBackToOverview"
    />

    <QuizOverviewView
      v-else
      :quiz-id="quizId"
      @take-quiz="handleTakeQuiz"
      @generate-more="emit('openWizard')"
    />

    <QuizSettingsModal
      :open="settingsOpen"
      @update:open="settingsOpen = $event"
      @start="handleStartAttempt"
    />

    <QuizResumeDialog
      :open="resumeDialogOpen"
      :quiz-title="quiz?.title ?? ''"
      :attempt="inProgressAttempt"
      @update:open="resumeDialogOpen = $event"
      @resume="handleResume"
      @start-new="() => { resumeDialogOpen = false; settingsOpen = true }"
    />
  </div>
</template>
