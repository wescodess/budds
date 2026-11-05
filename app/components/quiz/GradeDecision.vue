<script setup lang="ts">
import { api } from '#convex/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { createSsrMutationStub } from '~/utils/convexSsrMutation'
import type { QuizSelfVerdict } from '~/utils/quiz-results'

const props = defineProps<{
  attemptAnswerId: string
  current?: QuizSelfVerdict
}>()

const emit = defineEmits<{ decided: [] }>()

const saving = ref<QuizSelfVerdict | null>(null)
const failed = ref(false)
const root = useTemplateRef<HTMLElement>('root')

const selfAssessMutation = import.meta.client
  ? useConvexMutation(api.quizGrading.selfAssess)
  : createSsrMutationStub<typeof api.quizGrading.selfAssess>()

async function choose(value: unknown) {
  const verdict = value as QuizSelfVerdict | undefined
  if (!verdict || saving.value || verdict === props.current) return
  const group = root.value?.querySelector<HTMLElement>('[data-slot="toggle-group"]')
  const hadFocus = group?.contains(document.activeElement)
  saving.value = verdict
  failed.value = false
  const save = selfAssessMutation.mutate({ attemptAnswerId: props.attemptAnswerId as Id<'attemptAnswers'>, verdict })
  if (hadFocus) {
    await nextTick()
    group?.focus({ preventScroll: true })
  }
  await save
  saving.value = null
  if (selfAssessMutation.error.value) {
    selfAssessMutation.error.value = null
    failed.value = true
    await nextTick()
    if (document.activeElement === group) {
      group?.querySelector<HTMLElement>(`button[value="${verdict}"]`)?.focus()
    }
    return
  }
  emit('decided')
}
</script>

<template>
  <div ref="root">
    <UiToggleGroup
      type="single"
      variant="outline"
      size="sm"
      class="flex-wrap focus-visible:ring-[3px] focus-visible:ring-ring/50"
      aria-label="Mark your answer"
      :spacing="2"
      :model-value="saving ?? current"
      :disabled="saving !== null"
      :aria-busy="saving !== null"
      @update:model-value="choose"
    >
      <UiToggleGroupItem value="correct" class="flex-1 sm:flex-none">Correct</UiToggleGroupItem>
      <UiToggleGroupItem value="partial" class="flex-1 sm:flex-none">Partly</UiToggleGroupItem>
      <UiToggleGroupItem value="incorrect" class="flex-1 sm:flex-none">Incorrect</UiToggleGroupItem>
    </UiToggleGroup>
    <p v-if="failed" role="alert" class="mt-2 text-xs text-destructive">
      We couldn't save your choice. Try again.
    </p>
  </div>
</template>
