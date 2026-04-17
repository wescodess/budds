<script setup lang="ts">
import { ClipboardList, Sparkles } from 'lucide-vue-next'
import type { Id } from '../../../convex/_generated/dataModel'

const props = defineProps<{
  folderId: Id<'folders'>
  selectedQuizId?: string | null
}>()

const emit = defineEmits<{
  generationStarted: []
}>()

const { quizzes, hasIndexedDocuments } = useQuizzes(toRef(props, 'folderId'))

const activeQuizId = ref<Id<'quizzes'> | null>(null)
const wizardOpen = ref(false)

watch([() => props.selectedQuizId, quizzes], ([next, list]) => {
  if (!next) return
  const isQuiz = list.some(q => (q._id as string) === next)
  if (isQuiz) activeQuizId.value = next as Id<'quizzes'>
}, { immediate: true })

watch(quizzes, (list) => {
  if (!activeQuizId.value && list.length > 0) {
    activeQuizId.value = list[0]._id
  }
}, { immediate: true })

function handleSelectQuiz(quizId: Id<'quizzes'>) {
  activeQuizId.value = quizId
}

function handleOpenWizard() {
  wizardOpen.value = true
}

function handleBack() {
  activeQuizId.value = null
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

    <template v-else-if="quizzes.length === 0">
      <div class="flex flex-1 flex-col items-center justify-center gap-4 py-12 text-muted-foreground">
        <ClipboardList class="h-12 w-12 opacity-40" />
        <p class="text-lg font-medium">No quizzes yet</p>
        <UiButton variant="outline" @click="handleOpenWizard">
          <Sparkles class="mr-1.5 h-4 w-4" />
          Generate Quiz
        </UiButton>
      </div>
    </template>

    <template v-else-if="activeQuizId">
      <QuizActiveView
        :key="activeQuizId"
        :quiz-id="activeQuizId"
        :folder-id="folderId"
        @back="handleBack"
        @open-wizard="handleOpenWizard"
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

    <QuizGenerationWizard
      :open="wizardOpen"
      :folder-id="folderId"
      @update:open="wizardOpen = $event"
      @generation-started="emit('generationStarted')"
    />
  </div>
</template>
