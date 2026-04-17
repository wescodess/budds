<script setup lang="ts">
import { FileText, Check } from 'lucide-vue-next'
import type { Id } from '../../../../convex/_generated/dataModel'

const props = defineProps<{
  folderId: Id<'folders'>
  selectedIds: string[]
}>()

const emit = defineEmits<{
  'update:selectedIds': [ids: string[]]
  next: []
}>()

const { documents } = useDocuments(computed(() => props.folderId))

const indexedDocs = computed(() =>
  (documents.value ?? []).filter(d => d.status === 'success'),
)

function toggle(docId: string) {
  const current = props.selectedIds
  if (current.includes(docId)) {
    emit('update:selectedIds', current.filter(id => id !== docId))
  }
  else {
    emit('update:selectedIds', [...current, docId])
  }
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
</script>

<template>
  <div class="space-y-4">
    <div>
      <h3 class="text-lg font-semibold">Select Resources</h3>
      <p class="text-sm text-muted-foreground">Choose documents to generate questions from</p>
    </div>

    <div class="max-h-64 space-y-1 overflow-y-auto">
      <button
        v-for="doc in indexedDocs"
        :key="doc._id"
        type="button"
        class="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent/50"
        :class="selectedIds.includes(doc._id as string) ? 'bg-primary/10' : ''"
        @click="toggle(doc._id as string)"
      >
        <div
          class="flex h-5 w-5 shrink-0 items-center justify-center rounded border"
          :class="selectedIds.includes(doc._id as string) ? 'border-primary bg-primary' : 'border-input'"
        >
          <Check v-if="selectedIds.includes(doc._id as string)" class="h-3 w-3 text-primary-foreground" />
        </div>
        <FileText class="h-4 w-4 shrink-0 text-muted-foreground" />
        <span class="flex-1 truncate">{{ doc.filename }}</span>
        <span class="text-xs text-muted-foreground">{{ formatSize(doc.fileSize) }}</span>
      </button>
    </div>

    <p v-if="selectedIds.length > 0" class="text-sm text-primary">
      {{ selectedIds.length }} resource{{ selectedIds.length !== 1 ? 's' : '' }} selected
    </p>
  </div>
</template>
