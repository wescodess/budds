<script setup lang="ts">
import { injectFolderContext } from '~/composables/useFolderPageContext'

const ctx = injectFolderContext()
const { folderId, helperPane } = ctx

function onSelectRoom(roomId: string | null) {
  if (roomId) navigateTo(`/app/folders/${folderId.value}/flashcards/${roomId}`)
}

function onGenerationStarted() {
  helperPane.open('tasks')
}
</script>

<template>
  <FlashcardsTab
    :folder-id="folderId"
    :selected-room-id="null"
    @select-room="onSelectRoom"
    @generation-started="onGenerationStarted"
  />
</template>
