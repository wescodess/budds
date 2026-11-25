<script setup lang="ts">
import { LEARN_TODAY_CHECK_POINTER_VERSION, type LearnTodayCheckPointer } from '#shared/learn-v2-today-check'

const { pointer } = defineProps<{ pointer: LearnTodayCheckPointer }>()

const lines = {
  this_session: 'Start with a quick check on this topic.',
  about_a_week: 'Start with a quick check on last week’s topic.',
  about_a_month: 'Start with a quick check on a topic from about a month ago.',
  earlier: 'Start with a quick check on an earlier topic.',
  retained: 'Start with a quick check on an earlier topic.',
} as const
const line = computed(() => lines[pointer.version === LEARN_TODAY_CHECK_POINTER_VERSION ? pointer.timing : 'earlier'])
</script>

<template>
  <p data-testid="learn-v2-check-header" class="mt-2 text-sm leading-6 text-muted-foreground">{{ line }}</p>
</template>
