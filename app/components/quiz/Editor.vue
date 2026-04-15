<script setup lang="ts">
import { ArrowLeft, Pencil, Plus, X } from 'lucide-vue-next'
import { api } from '#convex/api'
import type { Id } from '../../../convex/_generated/dataModel'

type Question = {
  _id: string
  quizId: string
  userId: string
  order: number
  type: 'multiple-choice' | 'free-response'
  question: string
  options?: string[]
  correctAnswer: string
  sourceDocumentId?: string
  sourceChunkContent: string
  sourceFilename: string
}

type Draft = {
  question: string
  options: string[]
  correctOptionIndex: number
  correctAnswer: string
  error: string | null
}

const props = defineProps<{
  quizId: Id<'quizzes'>
}>()

const emit = defineEmits<{
  back: []
}>()

const { data: quizData } = useConvexQuery(
  api.quizzes.getWithQuestions,
  computed(() => ({ id: props.quizId })),
)

const updateQuestionMutation = import.meta.client
  ? useConvexMutation(api.quizzes.updateQuestion)
  : {
      mutate: async (_args: unknown): Promise<any> => null,
      isLoading: ref(false),
    }

type EditorState = 'loading' | 'ready' | 'error'
const state = ref<EditorState>('loading')
const editingQuestionId = ref<string | null>(null)
const drafts = ref<Record<string, Draft>>({})
const saving = ref(false)

const quiz = computed(() => quizData.value?.quiz ?? null)
const questions = computed<Question[]>(() => (quizData.value?.questions ?? []) as Question[])

watch(
  quizData,
  (val) => {
    if (val === undefined) {
      state.value = 'loading'
      return
    }
    if (val === null) {
      state.value = 'error'
      return
    }
    state.value = 'ready'
  },
  { immediate: true },
)

function startEdit(q: Question) {
  const options = q.type === 'multiple-choice' ? [...(q.options ?? [])] : []
  const correctOptionIndex = q.type === 'multiple-choice'
    ? Math.max(0, options.indexOf(q.correctAnswer))
    : 0
  drafts.value = {
    ...drafts.value,
    [q._id]: {
      question: q.question,
      options,
      correctOptionIndex,
      correctAnswer: q.correctAnswer,
      error: null,
    },
  }
  editingQuestionId.value = q._id
}

function cancelEdit(qid: string) {
  const next = { ...drafts.value }
  delete next[qid]
  drafts.value = next
  if (editingQuestionId.value === qid) editingQuestionId.value = null
}

function setDraftField(qid: string, patch: Partial<Draft>) {
  const current = drafts.value[qid]
  if (!current) return
  drafts.value = { ...drafts.value, [qid]: { ...current, ...patch } }
}

function setOptionText(qid: string, idx: number, value: string) {
  const current = drafts.value[qid]
  if (!current) return
  const options = [...current.options]
  options[idx] = value
  drafts.value = { ...drafts.value, [qid]: { ...current, options } }
}

function addOption(qid: string) {
  const current = drafts.value[qid]
  if (!current) return
  drafts.value = {
    ...drafts.value,
    [qid]: { ...current, options: [...current.options, ''] },
  }
}

function removeOption(qid: string, idx: number) {
  const current = drafts.value[qid]
  if (!current || current.options.length <= 2) return
  const options = current.options.filter((_, i) => i !== idx)
  const correctOptionIndex = current.correctOptionIndex >= options.length
    ? options.length - 1
    : current.correctOptionIndex === idx
      ? 0
      : current.correctOptionIndex > idx
        ? current.correctOptionIndex - 1
        : current.correctOptionIndex
  drafts.value = {
    ...drafts.value,
    [qid]: { ...current, options, correctOptionIndex: Math.max(0, correctOptionIndex) },
  }
}

function setCorrectOptionIndex(qid: string, idx: number) {
  setDraftField(qid, { correctOptionIndex: idx })
}

function setCorrectAnswerFree(qid: string, value: string) {
  setDraftField(qid, { correctAnswer: value })
}

function questionById(qid: string): Question | undefined {
  return questions.value.find((q) => q._id === qid)
}

async function saveEdit(qid: string) {
  const draft = drafts.value[qid]
  const question = questionById(qid)
  if (!draft || !question) return

  const trimmedQuestion = draft.question.trim()
  if (!trimmedQuestion) {
    setDraftField(qid, { error: 'Question text required' })
    return
  }

  let payload: {
    questionId: string
    question: string
    correctAnswer: string
    options?: string[]
  }

  if (question.type === 'multiple-choice') {
    const cleaned = draft.options.map((o) => o.trim()).filter((o) => o.length > 0)
    if (cleaned.length < 2) {
      setDraftField(qid, { error: 'Options required' })
      return
    }
    const correct = draft.options[draft.correctOptionIndex]?.trim() ?? ''
    if (!correct) {
      setDraftField(qid, { error: 'Correct answer required' })
      return
    }
    if (!cleaned.includes(correct)) {
      setDraftField(qid, { error: 'Correct answer must match an option' })
      return
    }
    payload = {
      questionId: qid,
      question: trimmedQuestion,
      correctAnswer: correct,
      options: cleaned,
    }
  } else {
    const correct = draft.correctAnswer.trim()
    if (!correct) {
      setDraftField(qid, { error: 'Correct answer required' })
      return
    }
    payload = {
      questionId: qid,
      question: trimmedQuestion,
      correctAnswer: correct,
    }
  }

  saving.value = true
  try {
    await updateQuestionMutation.mutate(payload as any)
    cancelEdit(qid)
    const { toast } = await import('vue-sonner')
    toast.success('Question updated')
  }
  catch (e: any) {
    const msg = e?.message || 'Failed to save question'
    setDraftField(qid, { error: msg })
  }
  finally {
    saving.value = false
  }
}

function handleBack() {
  emit('back')
}
</script>

<template>
  <div data-testid="quiz-editor" data-gesture-owner="quiz-editor">
    <div v-if="state === 'loading'" class="space-y-3" data-testid="quiz-editor-loading">
      <UiSkeleton v-for="i in 3" :key="i" class="h-32 w-full rounded-md animate-pulse" />
    </div>

    <div v-else-if="state === 'error'" class="rounded-md border p-6 text-center">
      <p class="font-medium">Quiz not found</p>
      <p class="mt-1 text-sm text-muted-foreground">This quiz may have been deleted.</p>
      <UiButton class="mt-4" variant="outline" data-testid="quiz-editor-back" @click="handleBack">
        <ArrowLeft class="mr-1.5 h-4 w-4" />
        Back
      </UiButton>
    </div>

    <div v-else class="space-y-4">
      <div class="flex items-center justify-between">
        <UiButton variant="ghost" size="sm" data-testid="quiz-editor-back" @click="handleBack">
          <ArrowLeft class="mr-1.5 h-4 w-4" />
          Back to quizzes
        </UiButton>
        <h2 class="text-lg font-semibold">Edit: {{ quiz?.title }}</h2>
      </div>

      <div class="space-y-3">
        <div
          v-for="(q, i) in questions"
          :key="q._id"
          class="rounded-md border p-4"
          data-testid="quiz-editor-question-row"
        >
          <div class="flex items-start justify-between gap-3">
            <p class="font-medium">
              <span class="text-muted-foreground">{{ i + 1 }}.</span>
              {{ drafts[q._id]?.question ?? q.question }}
            </p>
            <UiButton
              v-if="editingQuestionId !== q._id"
              variant="outline"
              size="sm"
              data-testid="quiz-editor-question-edit"
              @click="startEdit(q)"
            >
              <Pencil class="mr-1.5 h-3 w-3" />
              Edit
            </UiButton>
          </div>

          <div v-if="editingQuestionId === q._id && drafts[q._id]" class="mt-4 space-y-3">
            <div>
              <UiLabel class="text-xs font-medium">Question</UiLabel>
              <textarea
                :value="drafts[q._id]!.question"
                rows="2"
                autocapitalize="sentences"
                autocorrect="on"
                spellcheck="true"
                :enterkeyhint="q.type === 'multiple-choice' ? 'next' : 'done'"
                class="mt-1 flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                data-testid="quiz-editor-question-text"
                @input="setDraftField(q._id, { question: ($event.target as HTMLTextAreaElement).value })"
              />
            </div>

            <div v-if="q.type === 'multiple-choice'" class="space-y-2">
              <UiLabel class="text-xs font-medium">Options (select correct)</UiLabel>
              <div class="space-y-2">
                <div
                  v-for="(opt, idx) in drafts[q._id]!.options"
                  :key="idx"
                  class="flex items-center gap-2"
                >
                  <input
                    type="radio"
                    :name="`correct-${q._id}`"
                    :checked="drafts[q._id]!.correctOptionIndex === idx"
                    data-testid="quiz-editor-question-correct-radio"
                    @change="setCorrectOptionIndex(q._id, idx)"
                  />
                  <input
                    type="text"
                    :value="opt"
                    autocapitalize="sentences"
                    autocorrect="on"
                    spellcheck="true"
                    enterkeyhint="next"
                    class="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    data-testid="quiz-editor-question-option"
                    @input="setOptionText(q._id, idx, ($event.target as HTMLInputElement).value)"
                  />
                  <UiButton
                    variant="ghost"
                    size="icon"
                    :disabled="drafts[q._id]!.options.length <= 2"
                    data-testid="quiz-editor-question-remove-option"
                    @click="removeOption(q._id, idx)"
                  >
                    <X class="h-3 w-3" />
                  </UiButton>
                </div>
              </div>
              <UiButton
                variant="outline"
                size="sm"
                data-testid="quiz-editor-question-add-option"
                @click="addOption(q._id)"
              >
                <Plus class="mr-1.5 h-3 w-3" />
                Add option
              </UiButton>
            </div>

            <div v-else>
              <UiLabel class="text-xs font-medium">Correct answer</UiLabel>
              <textarea
                :value="drafts[q._id]!.correctAnswer"
                rows="2"
                autocapitalize="sentences"
                autocorrect="on"
                spellcheck="true"
                enterkeyhint="done"
                class="mt-1 flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                data-testid="quiz-editor-question-correct-free"
                @input="setCorrectAnswerFree(q._id, ($event.target as HTMLTextAreaElement).value)"
              />
            </div>

            <div
              v-if="drafts[q._id]!.error"
              class="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              data-testid="quiz-editor-question-error"
            >
              {{ drafts[q._id]!.error }}
            </div>

            <div class="flex items-center justify-end gap-2">
              <UiButton
                variant="ghost"
                size="sm"
                data-testid="quiz-editor-question-cancel"
                :disabled="saving"
                @click="cancelEdit(q._id)"
              >
                Cancel
              </UiButton>
              <UiButton
                size="sm"
                data-testid="quiz-editor-question-save"
                :disabled="saving"
                @click="saveEdit(q._id)"
              >
                Save
              </UiButton>
            </div>
          </div>

          <div v-else class="mt-3 space-y-2">
            <div v-if="q.type === 'multiple-choice'" class="text-sm text-muted-foreground">
              <p>Options:</p>
              <ul class="ml-4 list-disc">
                <li
                  v-for="opt in q.options ?? []"
                  :key="opt"
                  :class="{ 'font-medium text-foreground': opt === q.correctAnswer }"
                >
                  {{ opt }}
                  <span v-if="opt === q.correctAnswer" class="text-xs text-green-700 dark:text-green-400">
                    (correct)
                  </span>
                </li>
              </ul>
            </div>
            <div v-else class="text-sm text-muted-foreground">
              <p>Correct answer:</p>
              <p class="text-foreground">{{ q.correctAnswer }}</p>
            </div>
          </div>

          <div class="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
            <ChatCitationBadge :index="i + 1" :filename="q.sourceFilename" />
            <span class="flex-1 truncate">{{ q.sourceChunkContent }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
