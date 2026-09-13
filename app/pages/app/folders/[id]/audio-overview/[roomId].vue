<script setup lang="ts">
import type { Id } from '~~/convex/_generated/dataModel'
import { injectFolderContext } from '~/composables/useFolderPageContext'

const route = useRoute()
const { folderId, referenceScope } = injectFolderContext()
const roomId = computed(() => route.params.roomId as Id<'audioOverviewRooms'>)
</script>

<template>
  <AudioOverviewShell
    :folder-id="folderId"
    :room-id="roomId"
    :scope="referenceScope"
  />
</template>
