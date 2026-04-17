<script setup lang="ts">
import { Pencil, Trash2, Plus, Sparkles, Check, X } from 'lucide-vue-next'
import { api } from '#convex/api'
import type { Id } from '../../../convex/_generated/dataModel'

const props = defineProps<{
  quizId: Id<'quizzes'>
}>()

const emit = defineEmits<{
  takeQuiz: []
  generateMore: []
  viewAttempt: [attemptId: Id<'quizAttempts'>]
}>()

const { data: quizData } = useConvexQuery(
  api.quizzes.getWithQuestions,
  computed(() => ({ id: props.quizId })),
)

const { data: historyData } = useConvexQuery(
  api.quizzes.getQuizHistory,
  computed(() => ({ quizId: props.quizId })),
)

const quiz = computed(() => quizData.value?.quiz ?? null)
const questions = computed(() => quizData.value?.questions ?? [])
const attempts = computed(() => (historyData.value as any[] | undefined) ?? [])

const editingTitle = ref(false)
const titleDraft = ref('')
const questionModalOpen = ref(false)
const editingQuestion = ref<any>(null)
const confirmDeleteId = ref<string | null>(null)

const updateQuizMutation = import.meta.client
  ? useConvexMutation(api.quizzes.updateQuiz)
  : { mutate: async (_args: unknown): Promise<any> => null, isLoading: ref(false) }

const deleteQuestionMutation = import.meta.client
  ? useConvexMutation(api.quizzes.deleteQuestion)
  : { mutate: async (_args: unknown): Promise<any> => null, isLoading: ref(false) }

function startEditTitle() {
  titleDraft.value = quiz.value?.title ?? ''
  editingTitle.value = true
}

async function saveTitle() {
  if (titleDraft.value.trim()) {
    await updateQuizMutation.mutate({ quizId: props.quizId, title: titleDraft.value.trim() })
  }
  editingTitle.value = false
}

function openAddQuestion() {
  editingQuestion.value = null
  questionModalOpen.value = true
}

function openEditQuestion(q: any) {
  editingQuestion.value = q
  questionModalOpen.value = true
}

async function handleDeleteQuestion(questionId: string) {
  await deleteQuestionMutation.mutate({ questionId })
  confirmDeleteId.value = null
}

function typeBadge(type: string) {
  switch (type) {
    case 'multiple-choice': return 'MC'
    case 'true_false': return 'T/F'
    case 'fill_in_the_blank': return 'Fill'
    case 'free-response': return 'Short'
    default: return type
  }
}
</script>

<template>
  <div v-if="!quiz" class="space-y-3 p-6">
    <UiSkeleton v-for="i in 3" :key="i" class="h-24 w-full rounded-lg" />
  </div>

  <div v-else class="flex h-full flex-col">
    <div class="flex-1 space-y-4 overflow-y-auto p-6 pb-24">
      <div class="flex items-center justify-between gap-3">
        <div v-if="editingTitle" class="flex flex-1 items-center gap-2">
          <input
            v-model="titleDraft"
            class="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-lg font-semibold focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            @keydown.enter="saveTitle"
            @blur="saveTitle"
          />
        </div>
        <button
          v-else
          type="button"
          class="group flex items-center gap-2 text-lg font-semibold"
          @click="startEditTitle"
        >
          {{ quiz.title }}
          <Pencil class="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100" />
        </button>
        <QuizHistoryDropdown
          :attempts="attempts"
          @select="(id) => emit('viewAttempt', id)"
        />
      </div>

      <div class="space-y-3">
        <div
          v-for="(q, i) in questions"
          :key="q._id"
          class="rounded-lg border p-4"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0 flex-1">
              <div class="mb-1 flex items-center gap-2">
                <span class="text-xs text-muted-foreground">{{ i + 1 }}.</span>
                <span class="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
                  {{ typeBadge(q.type) }}
                </span>
              </div>
              <p class="text-sm">{{ q.question }}</p>
              <div v-if="q.options && q.options.length > 0" class="mt-2 space-y-1">
                <p
                  v-for="opt in q.options"
                  :key="opt"
                  class="text-xs text-muted-foreground"
                  :class="{ 'text-green-500': opt === q.correctAnswer }"
                >
                  {{ opt }}
                </p>
              </div>
            </div>
            <div class="flex shrink-0 gap-1">
              <button
                type="button"
                class="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                @click="openEditQuestion(q)"
              >
                <Pencil class="h-3.5 w-3.5" />
              </button>
              <button
                v-if="confirmDeleteId !== (q._id as string)"
                type="button"
                class="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                @click="confirmDeleteId = q._id as string"
              >
                <Trash2 class="h-3.5 w-3.5" />
              </button>
              <div v-else class="flex gap-1">
                <button
                  type="button"
                  class="rounded bg-destructive p-1.5 text-destructive-foreground"
                  @click="handleDeleteQuestion(q._id as string)"
                >
                  <Check class="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  class="rounded bg-muted p-1.5 text-muted-foreground"
                  @click="confirmDeleteId = null"
                >
                  <X class="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="flex gap-2">
        <UiButton variant="outline" size="sm" @click="openAddQuestion">
          <Plus class="mr-1 h-3 w-3" />
          Add question
        </UiButton>
        <UiButton variant="outline" size="sm" @click="emit('generateMore')">
          <Sparkles class="mr-1 h-3 w-3" />
          Generate questions
        </UiButton>
      </div>
    </div>

    <div class="sticky bottom-0 border-t bg-card/80 backdrop-blur p-4">
      <div class="flex items-center justify-between">
        <UiButton variant="outline" @click="emit('generateMore')">
          <Sparkles class="mr-1.5 h-3.5 w-3.5" />
          Generate questions
        </UiButton>
        <UiButton :disabled="questions.length === 0" @click="emit('takeQuiz')">
          Take quiz
        </UiButton>
      </div>
    </div>

    <QuizQuestionModal
      :open="questionModalOpen"
      :quiz-id="quizId"
      :edit-question="editingQuestion"
      @update:open="questionModalOpen = $event"
      @saved="editingQuestion = null"
    />
  </div>
</template>
