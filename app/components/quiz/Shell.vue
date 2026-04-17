<script setup lang="ts">
import { ClipboardList, Plus, Sparkles } from 'lucide-vue-next'
import type { Id } from '../../../convex/_generated/dataModel'
import type { AttemptSettings, AttemptQuestion } from '~/composables/useQuizAttempt'

const props = defineProps<{
  folderId: Id<'folders'>
  selectedQuizId?: string | null
}>()

const { quizzes, hasIndexedDocuments, generating } = useQuizzes(toRef(props, 'folderId'))

const activeQuizId = ref<Id<'quizzes'> | null>(null)
const flow = useQuizFlow(activeQuizId)
const attempt = useQuizAttempt(activeQuizId)
const history = useQuizHistory(activeQuizId)

const settingsOpen = ref(false)
const resumeDialogOpen = ref(false)
const wizardOpen = ref(false)

const takingQuestions = ref<AttemptQuestion[]>([])
const takingSettings = ref<AttemptSettings | null>(null)
const takingAttemptId = ref<Id<'quizAttempts'> | null>(null)
const takingInitialIndex = ref(0)
const takingAnsweredIds = ref<Set<string>>(new Set())

watch(() => props.selectedQuizId, (next) => {
  if (next) activeQuizId.value = next as Id<'quizzes'>
}, { immediate: true })

watch(quizzes, (list) => {
  if (!activeQuizId.value && list.length > 0) {
    activeQuizId.value = list[0]._id
  }
}, { immediate: true })

function handleSelectQuiz(quizId: Id<'quizzes'>) {
  activeQuizId.value = quizId
  flow.goToOverview()
}

function handleTakeQuiz() {
  if (history.hasInProgressAttempt.value) {
    resumeDialogOpen.value = true
  }
  else {
    settingsOpen.value = true
  }
}

async function handleStartAttempt(settings: AttemptSettings) {
  const result = await attempt.startAttempt(settings, true)
  if (result) {
    takingQuestions.value = result.questions
    takingSettings.value = result.settings
    takingAttemptId.value = result.attemptId
    takingInitialIndex.value = result.currentQuestionIndex
    takingAnsweredIds.value = new Set(result.answeredQuestionIds)
    flow.goToTaking(result.attemptId)
  }
}

async function handleResume() {
  const result = await attempt.startAttempt({
    shuffleQuestions: false,
    showAllQuestions: false,
    immediateFeedback: true,
  }, false)
  if (result) {
    takingQuestions.value = result.questions
    takingSettings.value = result.settings
    takingAttemptId.value = result.attemptId
    takingInitialIndex.value = result.currentQuestionIndex
    takingAnsweredIds.value = new Set(result.answeredQuestionIds)
    flow.goToTaking(result.attemptId)
  }
}

function handleStartNew() {
  settingsOpen.value = true
}

function handleComplete(attemptId: Id<'quizAttempts'>) {
  flow.goToResults(attemptId)
}

function handleAbandon() {
  attempt.abandonAttempt()
  flow.goToOverview()
}

function handleRetake() {
  settingsOpen.value = true
}

function handleBackToOverview() {
  flow.goToOverview()
}

function handleOpenWizard() {
  wizardOpen.value = true
}
</script>

<template>
  <div class="flex h-full flex-col overflow-y-auto">
    <template v-if="!hasIndexedDocuments">
      <div class="flex flex-1 items-center justify-center py-12 text-muted-foreground">
        <div class="text-center">
          <ClipboardList class="mx-auto mb-3 h-12 w-12 opacity-40" />
          <p class="text-lg font-medium">Upload and index documents to generate quizzes</p>
        </div>
      </div>
    </template>

    <template v-else-if="generating">
      <div class="space-y-3 p-6">
        <UiSkeleton v-for="i in 3" :key="i" class="h-30 w-full rounded-md" />
      </div>
    </template>

    <template v-else-if="quizzes.length === 0">
      <div class="flex flex-1 flex-col items-center justify-center gap-4 py-12 text-muted-foreground">
        <ClipboardList class="h-12 w-12 opacity-40" />
        <p class="text-lg font-medium">No quizzes yet</p>
        <div class="flex gap-2">
          <UiButton variant="outline" @click="handleOpenWizard">
            <Sparkles class="mr-1.5 h-4 w-4" />
            Generate Quiz
          </UiButton>
        </div>
      </div>
    </template>

    <template v-else-if="flow.state.value === 'taking' && takingAttemptId && takingSettings">
      <QuizTakingView
        :quiz-id="activeQuizId!"
        :attempt-id="takingAttemptId"
        :settings="takingSettings"
        :questions="takingQuestions"
        :initial-index="takingInitialIndex"
        :answered-ids="takingAnsweredIds"
        @complete="handleComplete"
        @abandon="handleAbandon"
      />
    </template>

    <template v-else-if="flow.state.value === 'results' && flow.activeAttemptId.value">
      <QuizResultsView
        :quiz-id="activeQuizId!"
        :attempt-id="flow.activeAttemptId.value"
        @retake="handleRetake"
        @back="handleBackToOverview"
      />
    </template>

    <template v-else-if="activeQuizId && flow.state.value === 'overview'">
      <QuizOverviewView
        :quiz-id="activeQuizId"
        @take-quiz="handleTakeQuiz"
        @generate-more="handleOpenWizard"
      />
    </template>

    <template v-else>
      <div class="space-y-3 p-6">
        <div class="flex items-center justify-end">
          <UiButton size="sm" @click="handleOpenWizard">
            <Sparkles class="mr-1.5 h-4 w-4" />
            Generate Quiz
          </UiButton>
        </div>
        <div
          v-for="quiz in quizzes"
          :key="quiz._id"
          class="cursor-pointer rounded-lg border p-4 hover:bg-accent/50"
          @click="handleSelectQuiz(quiz._id)"
        >
          <p class="font-medium">{{ quiz.title }}</p>
          <p class="text-xs text-muted-foreground">
            {{ new Date(quiz._creationTime).toLocaleDateString() }}
            &middot;
            {{ quiz.questionCount }} questions
          </p>
        </div>
      </div>
    </template>

    <QuizSettingsModal
      :open="settingsOpen"
      @update:open="settingsOpen = $event"
      @start="handleStartAttempt"
    />

    <QuizResumeDialog
      :open="resumeDialogOpen"
      :quiz-title="flow.quiz.value?.title ?? ''"
      :attempt="history.inProgressAttempt.value"
      @update:open="resumeDialogOpen = $event"
      @resume="handleResume"
      @start-new="handleStartNew"
    />

    <QuizGenerationWizard
      :open="wizardOpen"
      :folder-id="folderId"
      @update:open="wizardOpen = $event"
      @generated="() => {}"
    />
  </div>
</template>
