<script setup lang="ts">
import { Upload } from '@lucide/vue'
import type { Id } from '~~/convex/_generated/dataModel'

defineOptions({ name: 'FolderShellFilesList' })

type Doc = {
  _id: Id<'documents'> | string
  filename: string
  status: 'pending' | 'processing' | 'indexing' | 'success' | 'failed'
  fileSize: number
  _creationTime: number
  failureReason?: string
}

defineProps<{
  documents: Doc[] | null | undefined
  loading?: boolean
}>()

const emit = defineEmits<{
  open: [id: string]
  rename: [id: string]
  move: [id: string]
  download: [id: string]
  delete: [id: string]
  dismiss: [id: string]
  upload: []
}>()
</script>

<template>
  <div class="rounded-xl border border-border/60 bg-card/40" data-testid="files-list">
    <div class="grid grid-cols-[minmax(0,1fr)_140px_140px_100px_32px] items-center gap-3 border-b border-border/60 px-4 py-2.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
      <div>Name</div>
      <div>Status</div>
      <div>Added</div>
      <div>Size</div>
      <div />
    </div>

    <template v-if="documents && documents.length > 0">
      <FolderShellFileRow
        v-for="doc in documents"
        :key="doc._id"
        variant="list"
        :document-id="doc._id"
        :filename="doc.filename"
        :status="doc.status"
        :file-size="doc.fileSize"
        :created-at="doc._creationTime"
        :failure-reason="doc.failureReason"
        @open="emit('open', $event)"
        @rename="emit('rename', $event)"
        @move="emit('move', $event)"
        @download="emit('download', $event)"
        @delete="emit('delete', $event)"
        @dismiss="emit('dismiss', $event)"
      />
    </template>

    <div
      v-else
      class="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center"
      data-testid="folder-empty-state"
    >
      <div class="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Upload class="h-5 w-5" />
      </div>
      <p class="text-sm font-medium text-foreground">No files yet</p>
      <p class="max-w-xs text-xs text-muted-foreground">
        Documents will appear here once you add files or links to this folder.
      </p>
      <UiButton size="sm" class="mt-2 rounded-full" @click="emit('upload')">
        Add files
      </UiButton>
    </div>
  </div>
</template>
