<script setup lang="ts">
import { injectFolderContext } from '~/composables/useFolderPageContext'

const route = useRoute()
const ctx = injectFolderContext()
const { folderId, helperPane } = ctx

const roomId = computed(() => route.params.roomId as string)

function onSelectRoom(id: string | null) {
  if (id) navigateTo(`/app/folders/${folderId.value}/flashcards/${id}`)
  else navigateTo(`/app/folders/${folderId.value}/flashcards`)
}

function onGenerationStarted() {
  helperPane.open('tasks')
}
</script>

<template>
  <FlashcardsTab
    :folder-id="folderId"
    :selected-room-id="roomId"
    @select-room="onSelectRoom"
    @generation-started="onGenerationStarted"
  />
</template>
