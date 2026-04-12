<script setup lang="ts">
import { Check, X } from 'lucide-vue-next'

export interface QuestionView {
  _id: string
  type: 'multiple-choice' | 'free-response'
  question: string
  options?: string[]
  sourceFilename: string
  sourceChunkContent: string
}

export interface QuestionResult {
  isCorrect: boolean
  correctAnswer: string
  userResponse: string
}

const props = defineProps<{
  index: number
  total: number
  question: QuestionView
  response: string
  disabled?: boolean
  result?: QuestionResult | null
}>()

const emit = defineEmits<{
  'update:response': [value: string]
}>()

const sourceExpanded = ref(false)

const isReadOnly = computed(() => props.disabled || !!props.result)

function onRadioChange(val: string) {
  emit('update:response', val)
}

function onTextInput(e: Event) {
  emit('update:response', (e.target as HTMLTextAreaElement).value)
}

function truncate(text: string, max = 120): string {
  if (text.length <= max) return text
  return `${text.slice(0, max).trimEnd()}...`
}
</script>

<template>
  <div
    class="rounded-md border p-4"
    :class="{
      'border-l-4 border-l-green-500 bg-green-50/30 dark:bg-green-950/10': result?.isCorrect,
      'border-l-4 border-l-destructive bg-destructive/5': result && !result.isCorrect,
    }"
    data-testid="quiz-question"
  >
    <div class="mb-3 flex items-start justify-between gap-3">
      <p class="font-medium">
        <span class="text-muted-foreground">{{ index + 1 }}.</span>
        {{ question.question }}
      </p>
      <span
        v-if="result?.isCorrect"
        class="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-400"
        data-testid="quiz-result-correct"
      >
        <Check class="h-3 w-3" />
        Correct
      </span>
      <span
        v-else-if="result && !result.isCorrect"
        class="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive"
        data-testid="quiz-result-incorrect"
      >
        <X class="h-3 w-3" />
        Incorrect
      </span>
    </div>

    <div v-if="question.type === 'multiple-choice'" class="space-y-2">
      <UiRadioGroup
        :model-value="response"
        :disabled="isReadOnly"
        @update:model-value="onRadioChange"
      >
        <div
          v-for="option in question.options ?? []"
          :key="option"
          class="flex items-center gap-2"
        >
          <UiRadioGroupItem
            :id="`q-${question._id}-${option}`"
            :value="option"
            :disabled="isReadOnly"
          />
          <UiLabel
            :for="`q-${question._id}-${option}`"
            class="cursor-pointer text-sm font-normal"
            :class="{
              'text-green-700 dark:text-green-400': result?.isCorrect && option === response,
              'text-destructive': result && !result.isCorrect && option === response,
            }"
          >
            {{ option }}
          </UiLabel>
        </div>
      </UiRadioGroup>
    </div>

    <div v-else>
      <textarea
        :value="response"
        :disabled="isReadOnly"
        rows="3"
        placeholder="Type your answer"
        class="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-70"
        :class="{
          'border-l-4 border-l-green-500': result?.isCorrect,
          'border-l-4 border-l-destructive': result && !result.isCorrect,
        }"
        data-testid="quiz-question-textarea"
        @input="onTextInput"
      />
    </div>

    <div
      v-if="result && !result.isCorrect"
      class="mt-3 rounded-md bg-muted/50 p-3 text-sm"
      data-testid="quiz-reveal-correct"
    >
      <span class="text-xs font-medium text-muted-foreground">Correct answer:</span>
      <p class="mt-1">{{ result.correctAnswer }}</p>
      <p v-if="!result.userResponse" class="mt-1 text-xs italic text-muted-foreground">
        — no answer —
      </p>
    </div>

    <div class="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
      <ChatCitationBadge :index="index + 1" :filename="question.sourceFilename" />
      <button
        v-if="result"
        type="button"
        class="flex-1 text-left hover:text-foreground"
        data-testid="quiz-source-toggle"
        @click="sourceExpanded = !sourceExpanded"
      >
        <span class="truncate">{{ truncate(question.sourceChunkContent) }}</span>
      </button>
      <span v-else class="flex-1 truncate">{{ truncate(question.sourceChunkContent) }}</span>
    </div>

    <div v-if="result && sourceExpanded" class="mt-2" data-testid="quiz-source-panel">
      <ChatSourceCard
        :index="index + 1"
        :filename="question.sourceFilename"
        :content="question.sourceChunkContent"
        :score="1"
      />
    </div>
  </div>
</template>
