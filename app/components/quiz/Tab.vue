<script setup lang="ts">
import type { Id } from '../../../convex/_generated/dataModel'

defineProps<{
  folderId: Id<'folders'>
  selectedQuizId?: string | null
}>()

const emit = defineEmits<{
  generationStarted: []
}>()
</script>

<template>
  <QuizShell
    :folder-id="folderId"
    :selected-quiz-id="selectedQuizId"
    @generation-started="emit('generationStarted')"
  />
</template>
