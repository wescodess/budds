<script setup lang="ts">
import { injectFolderContext } from '~/composables/useFolderPageContext'

const route = useRoute()
const ctx = injectFolderContext()
const { folderId, helperPane } = ctx

const quizId = computed(() => (route.params.quizId as string) ?? null)

function onGenerationStarted() {
  helperPane.open('tasks')
}
</script>

<template>
  <QuizTab
    :folder-id="folderId"
    :selected-quiz-id="quizId"
    @generation-started="onGenerationStarted"
  />
</template>
