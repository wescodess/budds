<script setup lang="ts">
import { injectFolderContext } from '~/composables/useFolderPageContext'

const ctx = injectFolderContext()
const { folderId, helperPane } = ctx

function onGenerationStarted() {
  helperPane.open('tasks')
}
</script>

<template>
  <QuizTab
    :folder-id="folderId"
    :selected-quiz-id="null"
    @generation-started="onGenerationStarted"
  />
</template>
