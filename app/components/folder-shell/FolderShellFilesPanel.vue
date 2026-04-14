<script setup lang="ts">
import type { Id } from '~~/convex/_generated/dataModel'

defineOptions({ name: 'FolderShellFilesPanel' })

type Doc = {
  _id: Id<'documents'>
  filename: string
  status: 'processing' | 'indexing' | 'success' | 'failed'
  fileSize: number
  _creationTime: number
  failureReason?: string
}

const props = defineProps<{
  documents: Doc[] | null | undefined
}>()

const emit = defineEmits<{
  open: [id: string]
  rename: [id: string]
  move: [id: string]
  download: [id: string]
  delete: [id: string]
}>()

const groups = computed(() => {
  const docs = (props.documents ?? []).slice().sort((a, b) => b._creationTime - a._creationTime)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfYesterday = startOfToday - 86_400_000
  const startOfWeek = startOfToday - 7 * 86_400_000

  const today: Doc[] = []
  const yesterday: Doc[] = []
  const thisWeek: Doc[] = []
  const older: Doc[] = []

  for (const d of docs) {
    if (d._creationTime >= startOfToday) today.push(d)
    else if (d._creationTime >= startOfYesterday) yesterday.push(d)
    else if (d._creationTime >= startOfWeek) thisWeek.push(d)
    else older.push(d)
  }

  return [
    { label: 'Today', items: today },
    { label: 'Yesterday', items: yesterday },
    { label: 'This week', items: thisWeek },
    { label: 'Earlier', items: older },
  ].filter(g => g.items.length > 0)
})
</script>

<template>
  <div class="space-y-4" data-testid="files-panel">
    <div v-if="groups.length === 0" class="py-8 text-center text-xs text-muted-foreground">
      No files in this folder yet.
    </div>
    <div v-for="g in groups" :key="g.label" class="space-y-1">
      <p class="px-2 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
        {{ g.label }}
      </p>
      <FolderShellFileRow
        v-for="doc in g.items"
        :key="doc._id"
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
      />
    </div>
  </div>
</template>
