<script setup lang="ts">
import { MoreHorizontal, Eye, Pencil, FolderInput, Download, Trash2 } from 'lucide-vue-next'

defineOptions({ name: 'FileKebabMenu' })

defineProps<{
  documentId: string
  canDownload?: boolean
}>()

const emit = defineEmits<{
  open: [id: string]
  rename: [id: string]
  move: [id: string]
  download: [id: string]
  delete: [id: string]
}>()
</script>

<template>
  <UiDropdownMenu>
    <UiDropdownMenuTrigger as-child>
      <button
        type="button"
        data-testid="file-kebab-trigger"
        class="rounded-md p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
        @click.stop
      >
        <MoreHorizontal class="h-4 w-4" />
      </button>
    </UiDropdownMenuTrigger>
    <UiDropdownMenuContent align="end" class="w-44">
      <UiDropdownMenuItem @click="emit('open', documentId)">
        <Eye class="mr-2 h-4 w-4" />
        Open
      </UiDropdownMenuItem>
      <UiDropdownMenuItem @click="emit('rename', documentId)">
        <Pencil class="mr-2 h-4 w-4" />
        Rename
      </UiDropdownMenuItem>
      <UiDropdownMenuItem @click="emit('move', documentId)">
        <FolderInput class="mr-2 h-4 w-4" />
        Move to…
      </UiDropdownMenuItem>
      <UiDropdownMenuItem v-if="canDownload" @click="emit('download', documentId)">
        <Download class="mr-2 h-4 w-4" />
        Download
      </UiDropdownMenuItem>
      <UiDropdownMenuSeparator />
      <UiDropdownMenuItem class="text-destructive focus:text-destructive" @click="emit('delete', documentId)">
        <Trash2 class="mr-2 h-4 w-4" />
        Delete
      </UiDropdownMenuItem>
    </UiDropdownMenuContent>
  </UiDropdownMenu>
</template>
