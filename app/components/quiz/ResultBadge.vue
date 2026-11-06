<script setup lang="ts">
import { UserRound } from '@lucide/vue'
import { QUIZ_RESULT_LABELS, type QuizResultState } from '~/utils/quiz-results'

const props = defineProps<{
  state: QuizResultState
  markedByYou?: boolean
}>()

const variant = computed(() => {
  if (props.state === 'your_call') return 'default'
  return props.state === 'checking' || props.state === 'not_checked' ? 'secondary' : 'outline'
})
</script>

<template>
  <UiBadge :variant="variant">
    <UserRound v-if="markedByYou" aria-hidden="true" />
    <QuizResultIcon v-else :state="state" :class="state === 'your_call' && 'text-current'" />
    {{ QUIZ_RESULT_LABELS[state] }}<template v-if="markedByYou"> · marked by you</template>
  </UiBadge>
</template>
