<script setup lang="ts">
import { FolderPlus } from 'lucide-vue-next'
import type { Doc } from '~~/convex/_generated/dataModel'

const props = defineProps<{
  open: boolean
  title: string
  description?: string
  folders: Doc<'folders'>[] | null
  loading?: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'select': [folderId: string]
}>()

const rootFolders = computed(() => {
  if (!props.folders) return []
  return props.folders.filter((f) => !f.parentId)
})

function handleSelect(id: string) {
  emit('select', id)
  emit('update:open', false)
}
</script>

<template>
  <UiDialog :open="open" @update:open="(v: boolean) => emit('update:open', v)">
    <UiDialogContent data-testid="dashboard-folder-picker">
      <UiDialogHeader>
        <UiDialogTitle>{{ title }}</UiDialogTitle>
        <UiDialogDescription v-if="description">{{ description }}</UiDialogDescription>
      </UiDialogHeader>

      <div class="max-h-80 overflow-y-auto py-1">
        <div v-if="loading" class="space-y-2 p-2">
          <UiSkeleton v-for="i in 3" :key="i" class="h-10 w-full rounded-md" />
        </div>

        <template v-else-if="rootFolders.length > 0">
          <button
            v-for="folder in rootFolders"
            :key="folder._id"
            type="button"
            class="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            :data-folder-id="folder._id"
            @click="handleSelect(folder._id)"
          >
            <FoldersFolderBadge :color="folder.color" :icon="folder.icon" size="sm" />
            <span class="truncate font-medium text-foreground">{{ folder.name }}</span>
          </button>
        </template>

        <div v-else class="flex flex-col items-center gap-2 px-3 py-8 text-center text-sm text-muted-foreground">
          <FolderPlus class="h-8 w-8 opacity-40 animate-float-idle" />
          <p>Create a course folder to use this tool.</p>
        </div>
      </div>
    </UiDialogContent>
  </UiDialog>
</template>
