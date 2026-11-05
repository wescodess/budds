<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { Check, CircleHelp, CircleMinus, Clock, X } from '@lucide/vue'
import { cn } from '@/lib/utils'
import type { QuizResultState } from '~/utils/quiz-results'

const props = defineProps<{
  state: QuizResultState
  class?: HTMLAttributes['class']
}>()

const icons = {
  correct: Check,
  partial: CircleMinus,
  incorrect: X,
  your_call: CircleHelp,
  not_checked: Clock,
  unreviewed: CircleMinus,
}

const tones = {
  correct: 'text-green-700 dark:text-green-400',
  partial: 'text-yellow-700 dark:text-yellow-400',
  incorrect: 'text-destructive',
  your_call: 'text-foreground',
  not_checked: 'text-muted-foreground',
  unreviewed: 'text-muted-foreground',
}
</script>

<template>
  <UiSpinner
    v-if="state === 'checking'"
    aria-hidden="true"
    :class="cn('text-muted-foreground motion-reduce:animate-none', props.class)"
  />
  <component
    :is="icons[state]"
    v-else
    aria-hidden="true"
    :class="cn(tones[state], props.class)"
  />
</template>
