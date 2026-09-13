<script setup lang="ts">
import { api } from '#convex/api'
import type { Id } from '../../../../convex/_generated/dataModel'
import type { PickerFolder, PickerFile } from '~/components/global/DirectoryPicker.vue'
import type { ScopeInventoryFile, ScopeInventoryFolder } from '~/composables/useReferenceScope'

const props = defineProps<{
  folderId: Id<'folders'>
  selectedFileIds: Set<string>
  selectedFolderIds: Set<string>
}>()

const emit = defineEmits<{
  'update:selectedFileIds': [ids: Set<string>]
  'update:selectedFolderIds': [ids: Set<string>]
}>()

const { data: scopeInventory } = useConvexQuery(api.folders.searchScopeItems, computed(() => ({
  rootFolderId: props.folderId,
  search: '',
})))

const pickerFolders = computed<PickerFolder[]>(() =>
  ((scopeInventory.value?.folders ?? []) as ScopeInventoryFolder[]).map(f => ({
    id: f.id as string,
    name: f.name,
    parentId: f.parentId as string | undefined,
    fileCount: f.descendantFileCount ?? f.fileCount ?? 0,
  })),
)

const pickerFiles = computed<PickerFile[]>(() =>
  ((scopeInventory.value?.files ?? []) as ScopeInventoryFile[]).map(f => ({
    id: f.id as string,
    name: f.filename,
    folderId: (f.folderId ?? props.folderId) as string,
  })),
)

const selectedCount = computed(() => props.selectedFileIds.size + props.selectedFolderIds.size)

function isFileSelected(fileId: string): boolean {
  return props.selectedFileIds.has(fileId)
}

function isFolderSelected(folderId: string): 'all' | 'some' | 'none' {
  if (props.selectedFolderIds.has(folderId)) return 'all'
  return 'none'
}

function handleToggleFile(fileId: string) {
  const next = new Set(props.selectedFileIds)
  if (next.has(fileId)) next.delete(fileId)
  else next.add(fileId)
  emit('update:selectedFileIds', next)
}

function handleToggleFolder(folderId: string) {
  const next = new Set(props.selectedFolderIds)
  if (next.has(folderId)) next.delete(folderId)
  else next.add(folderId)
  emit('update:selectedFolderIds', next)
}

function handleClear() {
  emit('update:selectedFileIds', new Set())
  emit('update:selectedFolderIds', new Set())
}
</script>

<template>
  <div class="space-y-4">
    <div>
      <h3 class="text-lg font-semibold">Select Resources</h3>
      <p class="text-sm text-muted-foreground">Choose documents to generate questions from</p>
    </div>

    <div class="min-w-0 overflow-hidden rounded-lg border border-border/60">
      <DirectoryPicker
        :folders="pickerFolders"
        :files="pickerFiles"
        :is-file-selected="isFileSelected"
        :is-folder-selected="isFolderSelected"
        :on-toggle-file="handleToggleFile"
        :on-toggle-folder="handleToggleFolder"
        :on-clear="handleClear"
        :selected-count="selectedCount"
        search-placeholder="Search folder documents"
        presentation="drawer"
        @close="() => {}"
      />
    </div>
  </div>
</template>
