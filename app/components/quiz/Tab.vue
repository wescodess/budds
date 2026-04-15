<script setup lang="ts">
import { ClipboardList, MoreHorizontal, Pencil, Plus, Trash2, ChevronDown } from 'lucide-vue-next'
import { api } from '#convex/api'
import type { Id } from '../../../convex/_generated/dataModel'

const props = defineProps<{
  folderId: Id<'folders'>
}>()

const {
  quizzes,
  hasIndexedDocuments,
  generating,
  lastError,
  generate,
} = useQuizzes(toRef(props, 'folderId'))

const expandedQuizPreview = ref<string | null>(null)
const activeQuizId = ref<Id<'quizzes'> | null>(null)
const editingQuizId = ref<Id<'quizzes'> | null>(null)
const openMenuQuizId = ref<string | null>(null)
const confirmingDeleteQuizId = ref<string | null>(null)
const deleting = ref(false)
const liveMessage = ref('')

const deleteQuizMutation = import.meta.client
  ? useConvexMutation(api.quizzes.deleteQuiz)
  : {
      mutate: async (_args: unknown): Promise<any> => null,
      isLoading: ref(false),
    }

async function handleGenerate() {
  try {
    await generate()
    const { toast } = await import('vue-sonner')
    toast.success('Quiz generated')
  }
  catch (e: any) {
    const { toast } = await import('vue-sonner')
    toast.error(lastError.value || e?.message || 'Failed to generate quiz')
  }
}

function togglePreview(id: string) {
  expandedQuizPreview.value = expandedQuizPreview.value === id ? null : id
}

function handleCardSelect(quizId: string) {
  activeQuizId.value = quizId as Id<'quizzes'>
}

function handleTakerBack() {
  activeQuizId.value = null
}

function handleEditorBack() {
  editingQuizId.value = null
}

function toggleMenu(quizId: string) {
  openMenuQuizId.value = openMenuQuizId.value === quizId ? null : quizId
  if (openMenuQuizId.value !== quizId) {
    confirmingDeleteQuizId.value = null
  }
}

function handleEditQuiz(quizId: string) {
  openMenuQuizId.value = null
  confirmingDeleteQuizId.value = null
  editingQuizId.value = quizId as Id<'quizzes'>
}

function handleDeleteClick(quizId: string) {
  confirmingDeleteQuizId.value = quizId
}

function handleDeleteCancel() {
  confirmingDeleteQuizId.value = null
}

async function handleDeleteConfirm(quizId: string) {
  deleting.value = true
  try {
    await deleteQuizMutation.mutate({ quizId })
    confirmingDeleteQuizId.value = null
    openMenuQuizId.value = null
    liveMessage.value = 'Quiz deleted'
    setTimeout(() => {
      if (liveMessage.value === 'Quiz deleted') liveMessage.value = ''
    }, 3000)
    const { toast } = await import('vue-sonner')
    toast.success('Quiz deleted')
  }
  catch (e: any) {
    const { toast } = await import('vue-sonner')
    toast.error(e?.message || 'Failed to delete quiz')
  }
  finally {
    deleting.value = false
  }
}
</script>

<template>
  <div class="flex h-full flex-col overflow-y-auto p-6" data-testid="quiz-tab-content">
    <span class="sr-only" aria-live="polite" data-testid="quiz-tab-live">{{ liveMessage }}</span>

    <template v-if="editingQuizId">
      <QuizEditor :quiz-id="editingQuizId" @back="handleEditorBack" />
    </template>

    <template v-else-if="activeQuizId">
      <QuizTaker :quiz-id="activeQuizId" @back="handleTakerBack" />
    </template>

    <template v-else-if="!hasIndexedDocuments">
      <div
        data-testid="quiz-empty-no-docs"
        class="flex flex-1 items-center justify-center py-12 text-muted-foreground"
      >
        <div class="text-center">
          <ClipboardList class="mx-auto mb-3 h-12 w-12 opacity-40" />
          <p class="text-lg font-medium">Upload and index documents to generate quizzes</p>
        </div>
      </div>
    </template>

    <template v-else-if="generating">
      <div data-testid="quiz-shimmer" class="space-y-3">
        <UiSkeleton v-for="i in 3" :key="i" class="h-30 w-full rounded-md" />
      </div>
    </template>

    <template v-else-if="quizzes.length === 0">
      <div
        data-testid="quiz-empty-ready"
        class="flex flex-1 flex-col items-center justify-center gap-4 py-12 text-muted-foreground"
      >
        <ClipboardList class="h-12 w-12 opacity-40" />
        <p class="text-lg font-medium">No quizzes yet</p>
        <UiButton data-testid="quiz-generate-button" @click="handleGenerate">
          <Plus class="mr-1.5 h-4 w-4" />
          Generate Quiz
        </UiButton>
      </div>
    </template>

    <template v-else>
      <div class="space-y-3">
        <div class="flex items-center justify-end">
          <UiButton data-testid="quiz-generate-button" size="sm" @click="handleGenerate">
            <Plus class="mr-1.5 h-4 w-4" />
            Generate Quiz
          </UiButton>
        </div>
        <div
          v-for="quiz in quizzes"
          :key="quiz._id"
          class="rounded-md border"
          data-testid="quiz-card"
        >
          <div
            role="button"
            tabindex="0"
            class="flex cursor-pointer items-center justify-between p-4 hover:bg-accent/50"
            @click="handleCardSelect(quiz._id)"
            @keydown.enter="handleCardSelect(quiz._id)"
            @keydown.space.prevent="handleCardSelect(quiz._id)"
          >
            <div class="flex flex-col gap-1">
              <p class="font-medium">{{ quiz.title }}</p>
              <p class="text-xs text-muted-foreground">
                {{ new Date(quiz._creationTime).toLocaleDateString() }}
                &middot;
                {{ quiz.questionCount }} questions
              </p>
            </div>
            <div class="flex items-center gap-3">
              <span
                v-if="quiz.score !== undefined"
                class="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
                data-testid="quiz-score-badge"
              >
                {{ quiz.score }}%
              </span>
              <button
                type="button"
                class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                data-testid="quiz-preview-toggle"
                @click.stop="togglePreview(quiz._id)"
              >
                Preview questions
                <ChevronDown
                  class="h-3 w-3 transition-transform"
                  :class="{ 'rotate-180': expandedQuizPreview === quiz._id }"
                />
              </button>
              <button
                type="button"
                class="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                data-testid="quiz-card-menu"
                aria-label="Quiz actions"
                @click.stop="toggleMenu(quiz._id)"
              >
                <MoreHorizontal class="h-4 w-4" />
              </button>
            </div>
          </div>

          <div
            v-if="openMenuQuizId === quiz._id"
            class="flex items-center gap-2 border-t px-4 py-2"
            data-testid="quiz-card-actions"
          >
            <template v-if="confirmingDeleteQuizId === quiz._id">
              <UiButton
                variant="destructive"
                size="sm"
                :disabled="deleting"
                data-testid="quiz-card-delete-confirm"
                @click.stop="handleDeleteConfirm(quiz._id)"
              >
                <Trash2 class="mr-1.5 h-3 w-3" />
                Confirm delete
              </UiButton>
              <UiButton
                variant="ghost"
                size="sm"
                :disabled="deleting"
                data-testid="quiz-card-delete-cancel"
                @click.stop="handleDeleteCancel"
              >
                Cancel
              </UiButton>
            </template>
            <template v-else>
              <UiButton
                variant="outline"
                size="sm"
                data-testid="quiz-card-edit"
                @click.stop="handleEditQuiz(quiz._id)"
              >
                <Pencil class="mr-1.5 h-3 w-3" />
                Edit
              </UiButton>
              <UiButton
                variant="ghost"
                size="sm"
                class="text-destructive hover:text-destructive"
                data-testid="quiz-card-delete"
                @click.stop="handleDeleteClick(quiz._id)"
              >
                <Trash2 class="mr-1.5 h-3 w-3" />
                Delete
              </UiButton>
            </template>
          </div>

          <QuizCardPreview
            v-if="expandedQuizPreview === quiz._id"
            :quiz-id="quiz._id"
          />
        </div>
      </div>
    </template>
  </div>
</template>
