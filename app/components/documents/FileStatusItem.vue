<script setup lang="ts">
import { Loader2, CheckCircle2, XCircle, MoreHorizontal, FolderInput, Trash2 } from '@lucide/vue'
import { onClickOutside } from '@vueuse/core'

defineOptions({ name: 'FileStatusItem' })

const props = defineProps<{
  filename: string
  status: 'processing' | 'indexing' | 'success' | 'failed'
  fileSize: number
  createdAt: number
  failureReason?: string
  documentId?: string
}>()

const emit = defineEmits<{
  delete: [id: string]
  move: [id: string]
}>()

const menuOpen = ref(false)
const menuRef = ref<HTMLElement | null>(null)
onClickOutside(menuRef, () => { menuOpen.value = false })

function formatFileSize(bytes: number): string {
  if (bytes >= 1_048_576) {
    return `${Math.round(bytes / 1_048_576)} MB`
  }
  return `${Math.round(bytes / 1024)} KB`
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString()
}
</script>

<template>
  <div class="flex items-center gap-3 rounded-lg border px-4 py-3">
    <div class="shrink-0">
      <Loader2 v-if="status === 'processing' || status === 'indexing'" class="h-5 w-5 animate-spin text-amber-500" />
      <CheckCircle2 v-else-if="status === 'success'" class="h-5 w-5 text-green-500" />
      <XCircle
        v-else
        class="h-5 w-5 cursor-pointer text-red-500 hover:text-red-700"
        @click="documentId && emit('delete', documentId)"
      />
    </div>

    <div class="min-w-0 flex-1">
      <p class="truncate text-sm font-medium">{{ filename }}</p>
      <div aria-live="polite" class="text-xs text-muted-foreground">
        <template v-if="status === 'processing'">
          {{ formatFileSize(fileSize) }} · Processing...
        </template>
        <template v-else-if="status === 'indexing'">
          {{ formatFileSize(fileSize) }} · Indexing...
        </template>
        <template v-else-if="status === 'success'">
          {{ formatFileSize(fileSize) }} · {{ formatDate(createdAt) }}
        </template>
        <template v-else>
          {{ failureReason || 'Processing failed' }}
        </template>
      </div>
    </div>

    <div v-if="documentId" ref="menuRef" class="relative shrink-0">
      <button
        data-testid="document-actions-trigger"
        class="rounded-md p-1 hover:bg-muted"
        @click="menuOpen = !menuOpen"
      >
        <MoreHorizontal class="h-4 w-4 text-muted-foreground" />
      </button>
      <div
        v-if="menuOpen"
        class="absolute right-0 z-50 mt-1 min-w-40 rounded-md border bg-popover p-1 shadow-md"
      >
        <button
          data-testid="action-move"
          class="flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
          @click="emit('move', props.documentId!); menuOpen = false"
        >
          <FolderInput class="mr-2 h-4 w-4" />
          Move to folder
        </button>
        <div class="my-1 h-px bg-border" />
        <button
          data-testid="action-delete"
          class="flex w-full items-center rounded-sm px-2 py-1.5 text-sm text-destructive hover:bg-accent"
          @click="emit('delete', props.documentId!); menuOpen = false"
        >
          <Trash2 class="mr-2 h-4 w-4" />
          Delete
        </button>
      </div>
    </div>
  </div>
</template>
