<script setup lang="ts">
import type { AttemptQuestion } from '~/composables/useQuizAttempt'

const props = defineProps<{
  questions: AttemptQuestion[]
  submitting: boolean
}>()

const emit = defineEmits<{
  submitAll: [answers: Array<{ questionId: string; userAnswer: string }>]
}>()

const answers = ref<Record<string, string>>({})
const questionRefs = ref<HTMLElement[]>([])

const answeredCount = computed(() =>
  props.questions.filter(q => (answers.value[q._id as string] ?? '').trim().length > 0).length,
)

const allAnswered = computed(() => answeredCount.value >= props.questions.length)

function setAnswer(questionId: string, value: string) {
  answers.value = { ...answers.value, [questionId]: value }
}

function scrollToNextUnanswered() {
  const idx = props.questions.findIndex(q => !(answers.value[q._id as string] ?? '').trim())
  if (idx >= 0 && questionRefs.value[idx]) {
    questionRefs.value[idx]!.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
}

function handleSubmit() {
  const payload = props.questions.map(q => ({
    questionId: q._id as string,
    userAnswer: answers.value[q._id as string] ?? '',
  }))
  emit('submitAll', payload)
}
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="flex-1 space-y-6 overflow-y-auto p-6">
      <div
        v-for="(q, i) in questions"
        :key="q._id"
        :ref="el => { if (el) questionRefs[i] = el as HTMLElement }"
        class="rounded-lg border p-5"
      >
        <p class="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Question {{ i + 1 }}
        </p>
        <p class="mb-4 text-sm font-medium">{{ q.question }}</p>

        <div v-if="q.type === 'multiple-choice'">
          <QuizInputsMultipleChoice
            :options="q.options ?? []"
            :selected="answers[q._id as string] ?? ''"
            :disabled="submitting"
            @select="setAnswer(q._id as string, $event)"
          />
        </div>
        <div v-else-if="q.type === 'true_false'">
          <QuizInputsTrueFalse
            :selected="answers[q._id as string] ?? ''"
            :disabled="submitting"
            @select="setAnswer(q._id as string, $event)"
          />
        </div>
        <div v-else-if="q.type === 'fill_in_the_blank'">
          <QuizInputsFillInBlank
            :model-value="answers[q._id as string] ?? ''"
            :disabled="submitting"
            @update:model-value="setAnswer(q._id as string, $event)"
          />
        </div>
        <div v-else>
          <QuizInputsShortResponse
            :model-value="answers[q._id as string] ?? ''"
            :disabled="submitting"
            @update:model-value="setAnswer(q._id as string, $event)"
          />
        </div>
      </div>
    </div>

    <div class="sticky bottom-0 border-t bg-background p-4">
      <div class="flex items-center justify-between">
        <span class="text-sm text-muted-foreground">{{ answeredCount }} of {{ questions.length }} answered</span>
        <div class="flex-1 mx-4">
          <div class="h-2 overflow-hidden rounded-full bg-muted">
            <div
              class="h-full rounded-full bg-primary transition-all duration-300"
              :style="{ width: `${questions.length > 0 ? (answeredCount / questions.length) * 100 : 0}%` }"
            />
          </div>
        </div>
        <div class="flex gap-2">
          <UiButton v-if="!allAnswered" variant="outline" @click="scrollToNextUnanswered">Next</UiButton>
          <UiButton :disabled="!allAnswered || submitting" @click="handleSubmit">
            {{ submitting ? 'Submitting...' : 'Submit' }}
          </UiButton>
        </div>
      </div>
    </div>
  </div>
</template>
