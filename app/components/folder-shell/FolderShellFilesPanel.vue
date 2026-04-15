<script setup lang="ts">
import type { Id } from '~~/convex/_generated/dataModel'

defineOptions({ name: 'FolderShellFilesPanel' })

type Doc = {
  _id: Id<'documents'> | string
  filename: string
  status: 'pending' | 'processing' | 'indexing' | 'success' | 'failed'
  fileSize: number
  _creationTime: number
  failureReason?: string
}

const props = defineProps<{
  documents: Doc[] | null | undefined
  bulkMode?: boolean
  selectedIds?: string[]
  pending?: boolean
}>()

const emit = defineEmits<{
  open: [id: string]
  rename: [id: string]
  move: [id: string]
  download: [id: string]
  delete: [id: string]
  dismiss: [id: string]
  toggleBulkMode: [value: boolean]
  selectAll: []
  clearSelection: []
  bulkMove: []
  bulkDelete: []
  toggleSelect: [id: string]
}>()

const selectedIdSet = computed(() => new Set(props.selectedIds ?? []))
const selectedCount = computed(() => props.selectedIds?.length ?? 0)
const hasDocuments = computed(() => (props.documents?.length ?? 0) > 0)
const selectableDocuments = computed(() => (props.documents ?? []).filter(doc => doc.status !== 'pending'))
const allVisibleSelected = computed(() => {
  if (!selectableDocuments.value.length) return false
  return selectableDocuments.value.every(doc => selectedIdSet.value.has(String(doc._id)))
})

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
    <div v-if="hasDocuments" class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 bg-card/50 px-3 py-2">
      <template v-if="bulkMode">
        <div class="flex items-center gap-2">
          <span class="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
            {{ selectedCount }} selected
          </span>
        <UiButton
          size="sm"
          variant="ghost"
          class="h-8 px-2 text-xs"
          data-testid="files-panel-select-visible"
          :disabled="pending || selectableDocuments.length === 0"
          @click="allVisibleSelected ? emit('clearSelection') : emit('selectAll')"
        >
          {{ allVisibleSelected ? 'Clear visible' : 'Select visible' }}
        </UiButton>
        </div>
        <div class="flex items-center gap-2">
          <UiButton
            size="sm"
            variant="outline"
            class="h-8 px-2 text-xs"
            data-testid="files-panel-bulk-move"
            :disabled="selectedCount === 0 || pending"
            @click="emit('bulkMove')"
          >
            Move
          </UiButton>
          <UiButton
            size="sm"
            variant="destructive"
            class="h-8 px-2 text-xs"
            data-testid="files-panel-bulk-delete"
            :disabled="selectedCount === 0 || pending"
            @click="emit('bulkDelete')"
          >
            Delete
          </UiButton>
          <UiButton
            size="sm"
            variant="ghost"
            class="h-8 px-2 text-xs"
            data-testid="files-panel-bulk-done"
            :disabled="pending"
            @click="emit('toggleBulkMode', false)"
          >
            Done
          </UiButton>
        </div>
      </template>
      <template v-else>
        <p class="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
          Bulk actions
        </p>
        <UiButton
          size="sm"
          variant="ghost"
          class="h-8 px-2 text-xs"
          data-testid="files-panel-bulk-toggle"
          :disabled="selectableDocuments.length === 0"
          @click="emit('toggleBulkMode', true)"
        >
          Select files
        </UiButton>
      </template>
    </div>
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
        :selectable="bulkMode"
        :selected="selectedIdSet.has(String(doc._id))"
        @open="emit('open', $event)"
        @rename="emit('rename', $event)"
        @move="emit('move', $event)"
        @download="emit('download', $event)"
        @delete="emit('delete', $event)"
        @dismiss="emit('dismiss', $event)"
        @toggle-select="emit('toggleSelect', $event)"
      />
    </div>
  </div>
</template>
