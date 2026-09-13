<script setup lang="ts">
import { Plus } from '@lucide/vue'

withDefaults(defineProps<{ inline?: boolean }>(), { inline: false })

const modalOpen = ref(false)

function openModal() {
  modalOpen.value = true
}
</script>

<template>
  <div v-if="inline">
    <UiButton
      type="button"
      data-testid="add-course-card"
      data-testid-variant="inline"
      @click="openModal"
    >
      <Plus class="mr-2 h-4 w-4" />
      New folder
    </UiButton>
    <FoldersFolderFormModal v-model:open="modalOpen" mode="create" />
  </div>

  <div v-else>
    <button
      type="button"
      class="block h-[140px] w-full cursor-pointer text-left"
      data-testid="add-course-card"
      @click="openModal"
    >
      <UiCard class="flex h-full items-center justify-center border border-dashed border-border bg-card p-4 transition-colors hover:border-foreground/20">
        <div class="text-center text-muted-foreground">
          <Plus class="mx-auto mb-2 h-6 w-6" />
          <p class="text-sm font-medium">Add Course</p>
        </div>
      </UiCard>
    </button>
    <FoldersFolderFormModal v-model:open="modalOpen" mode="create" />
  </div>
</template>
