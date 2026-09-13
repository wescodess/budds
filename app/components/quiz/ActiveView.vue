<script setup lang="ts">
import { api } from '#convex/api'
import type { Id } from '../../../convex/_generated/dataModel'
import type { AttemptSettings, AttemptQuestion } from '~/composables/useQuizAttempt'
import type { AttemptHistoryItem } from '~/composables/useQuizHistory'
import { createSsrMutationStub } from '~/utils/convexSsrMutation'

interface AttemptResult {
  questions: AttemptQuestion[]
  settings: AttemptSettings
  attemptId: Id<'quizAttempts'>
  currentQuestionIndex: number
  answeredQuestionIds: string[]
}

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
  : createSsrMutationStub<typeof api.quizzes.startAttempt>()

type ViewState = 'overview' | 'taking' | 'results'
const viewState = ref<ViewState>('overview')

const quiz = computed(() => quizData.value?.quiz ?? null)
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

function applyAttemptResult(result: AttemptResult) {
  takingQuestions.value = result.questions
  takingSettings.value = result.settings
  takingAttemptId.value = result.attemptId
  takingInitialIndex.value = result.currentQuestionIndex
  takingAnsweredIds.value = new Set(result.answeredQuestionIds)
  viewState.value = 'taking'
}

async function handleStartAttempt(settings: AttemptSettings) {
  const result = await startAttemptMutation.mutate({
    quizId: props.quizId,
    settings,
    restart: true,
  })
  if (result) applyAttemptResult(result)
}

async function handleResume() {
  const result = await startAttemptMutation.mutate({
    quizId: props.quizId,
    settings: { shuffleQuestions: false, showAllQuestions: false, immediateFeedback: true },
    restart: false,
  })
  if (result) applyAttemptResult(result)
}

function handleComplete(attemptId: Id<'quizAttempts'>) {
  resultsAttemptId.value = attemptId
  viewState.value = 'results'
}

function handleViewAttempt(attemptId: Id<'quizAttempts'>) {
  resultsAttemptId.value = attemptId
  viewState.value = 'results'
}

function handleQuit() {
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
      @quit="handleQuit"
    />

    <QuizResultsView
      v-else-if="viewState === 'results' && resultsAttemptId"
      :quiz-id="quizId"
      :attempt-id="resultsAttemptId"
      @retake="handleRetake"
      @back="handleBackToOverview"
      @view-attempt="handleViewAttempt"
    />

    <QuizOverviewView
      v-else
      :quiz-id="quizId"
      @take-quiz="handleTakeQuiz"
      @generate-more="emit('openWizard')"
      @view-attempt="handleViewAttempt"
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
