<script setup lang="ts">
import { injectFolderContext } from '~/composables/useFolderPageContext'

const ctx = injectFolderContext()
const { folderId } = ctx
</script>

<template>
  <div class="min-h-0 w-full flex-1 overflow-y-auto bg-background">
    <LearnCourseCreator :folder-id="folderId" />
  </div>
</template>
