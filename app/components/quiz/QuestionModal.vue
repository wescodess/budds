<script setup lang="ts">
import { Plus, X } from '@lucide/vue'
import { api } from '#convex/api'
import type { Id } from '../../../convex/_generated/dataModel'

type QuestionType = 'multiple-choice' | 'free-response' | 'true_false' | 'fill_in_the_blank'

const props = defineProps<{
  open: boolean
  quizId: Id<'quizzes'>
  editQuestion?: {
    _id: Id<'quizQuestions'>
    type: QuestionType
    question: string
    options?: string[]
    correctAnswer: string
    explanation?: string
  } | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  saved: []
}>()

const addMutation = import.meta.client
  ? useConvexMutation(api.quizzes.addQuestion)
  : { mutate: async (_args: unknown): Promise<any> => null, isLoading: ref(false) }

const updateMutation = import.meta.client
  ? useConvexMutation(api.quizzes.updateQuestion)
  : { mutate: async (_args: unknown): Promise<any> => null, isLoading: ref(false) }

const questionType = ref<QuestionType>('multiple-choice')
const questionText = ref('')
const options = ref<string[]>(['', '', '', ''])
const correctAnswer = ref('')
const correctOptionIndex = ref(0)
const explanation = ref('')
const saving = ref(false)
const error = ref<string | null>(null)

watch(() => props.open, (isOpen) => {
  if (!isOpen) return
  if (props.editQuestion) {
    questionType.value = props.editQuestion.type
    questionText.value = props.editQuestion.question
    options.value = props.editQuestion.options ? [...props.editQuestion.options] : ['', '', '', '']
    correctAnswer.value = props.editQuestion.correctAnswer
    correctOptionIndex.value = props.editQuestion.options
      ? Math.max(0, props.editQuestion.options.indexOf(props.editQuestion.correctAnswer))
      : 0
    explanation.value = props.editQuestion.explanation ?? ''
  }
  else {
    questionType.value = 'multiple-choice'
    questionText.value = ''
    options.value = ['', '', '', '']
    correctAnswer.value = ''
    correctOptionIndex.value = 0
    explanation.value = ''
  }
  error.value = null
})

function addOption() {
  options.value = [...options.value, '']
}

function removeOption(idx: number) {
  if (options.value.length <= 2) return
  options.value = options.value.filter((_, i) => i !== idx)
  if (correctOptionIndex.value >= options.value.length) correctOptionIndex.value = 0
}

async function handleSave() {
  const text = questionText.value.trim()
  if (!text) { error.value = 'Question text required'; return }

  let correct = correctAnswer.value.trim()

  if (questionType.value === 'multiple-choice') {
    const cleaned = options.value.map(o => o.trim()).filter(o => o.length > 0)
    if (cleaned.length < 2) { error.value = 'At least 2 options required'; return }
    correct = options.value[correctOptionIndex.value]?.trim() ?? ''
    if (!correct || !cleaned.includes(correct)) { error.value = 'Select a valid correct answer'; return }
  }

  if (questionType.value === 'true_false') {
    if (correct !== 'True' && correct !== 'False') { error.value = 'Select True or False'; return }
  }

  if (!correct) { error.value = 'Correct answer required'; return }

  saving.value = true
  error.value = null

  try {
    if (props.editQuestion) {
      await updateMutation.mutate({
        questionId: props.editQuestion._id,
        question: text,
        type: questionType.value,
        options: questionType.value === 'multiple-choice'
          ? options.value.map(o => o.trim()).filter(o => o.length > 0)
          : questionType.value === 'true_false' ? ['True', 'False'] : undefined,
        correctAnswer: correct,
        explanation: explanation.value.trim() || undefined,
      })
    }
    else {
      await addMutation.mutate({
        quizId: props.quizId,
        type: questionType.value,
        questionText: text,
        options: questionType.value === 'multiple-choice'
          ? options.value.map(o => o.trim()).filter(o => o.length > 0)
          : undefined,
        correctAnswer: correct,
        explanation: explanation.value.trim() || undefined,
      })
    }
    emit('saved')
    emit('update:open', false)
  }
  catch (e: any) {
    error.value = e?.message ?? 'Failed to save'
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <UiDialog :open="open" @update:open="emit('update:open', $event)">
    <UiDialogContent class="sm:max-w-lg max-h-[85vh] overflow-y-auto">
      <UiDialogHeader>
        <UiDialogTitle>{{ editQuestion ? 'Edit Question' : 'Add Question' }}</UiDialogTitle>
      </UiDialogHeader>

      <div class="space-y-4 py-4">
        <div>
          <UiLabel class="text-xs font-medium">Question Type</UiLabel>
          <select
            v-model="questionType"
            class="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="multiple-choice">Multiple Choice</option>
            <option value="true_false">True / False</option>
            <option value="fill_in_the_blank">Fill in the Blank</option>
            <option value="free-response">Short Response</option>
          </select>
        </div>

        <div>
          <UiLabel class="text-xs font-medium">Question</UiLabel>
          <textarea
            v-model="questionText"
            rows="2"
            :placeholder="questionType === 'fill_in_the_blank' ? 'Use ___ for the blank...' : 'Enter your question...'"
            class="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>

        <div v-if="questionType === 'multiple-choice'" class="space-y-2">
          <UiLabel class="text-xs font-medium">Options (select correct)</UiLabel>
          <div v-for="(opt, idx) in options" :key="idx" class="flex items-center gap-2">
            <input
              type="radio"
              :name="'correct-option'"
              :checked="correctOptionIndex === idx"
              class="accent-primary"
              @change="correctOptionIndex = idx"
            />
            <input
              v-model="options[idx]"
              type="text"
              placeholder="Option text..."
              class="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <button
              v-if="options.length > 2"
              type="button"
              class="rounded p-1 text-muted-foreground hover:text-foreground"
              @click="removeOption(idx)"
            >
              <X class="h-3.5 w-3.5" />
            </button>
          </div>
          <UiButton variant="outline" size="sm" @click="addOption">
            <Plus class="mr-1 h-3 w-3" />
            Add option
          </UiButton>
        </div>

        <div v-if="questionType === 'true_false'">
          <UiLabel class="text-xs font-medium">Correct Answer</UiLabel>
          <div class="mt-1 flex gap-3">
            <button
              v-for="val in ['True', 'False']"
              :key="val"
              type="button"
              class="flex-1 rounded-lg border py-2 text-center text-sm font-medium transition-colors"
              :class="correctAnswer === val ? 'border-primary bg-primary/10' : 'hover:bg-accent/50'"
              @click="correctAnswer = val"
            >
              {{ val }}
            </button>
          </div>
        </div>

        <div v-if="questionType === 'fill_in_the_blank' || questionType === 'free-response'">
          <UiLabel class="text-xs font-medium">Correct Answer</UiLabel>
          <input
            v-model="correctAnswer"
            type="text"
            placeholder="The correct answer..."
            class="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>

        <div>
          <UiLabel class="text-xs font-medium">Explanation (optional)</UiLabel>
          <textarea
            v-model="explanation"
            rows="2"
            placeholder="Why is this the correct answer?"
            class="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>

        <div v-if="error" class="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {{ error }}
        </div>
      </div>

      <UiDialogFooter>
        <UiButton variant="ghost" :disabled="saving" @click="emit('update:open', false)">Cancel</UiButton>
        <UiButton :disabled="saving" @click="handleSave">
          {{ saving ? 'Saving...' : editQuestion ? 'Save' : 'Add Question' }}
        </UiButton>
      </UiDialogFooter>
    </UiDialogContent>
  </UiDialog>
</template>
