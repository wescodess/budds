<script setup lang="ts">
import { api } from '#convex/api'
import type { Id } from '../../../convex/_generated/dataModel'
import type { ScopeFileSummary, ScopeFolderSummary, useReferenceScope } from '~/composables/useReferenceScope'
import GlobalDirectoryPicker from '~/components/global/DirectoryPicker.vue'
import type { PickerFolder, PickerFile } from '~/components/global/DirectoryPicker.vue'

const props = defineProps<{
  folderId: Id<'folders'>
  scope: ReturnType<typeof useReferenceScope>
  autoFocusSearch?: boolean
  presentation?: 'popover' | 'drawer'
}>()

const emit = defineEmits<{
  close: []
  select: [item:
    | { kind: 'folder'; id: Id<'folders'>; label: string }
    | { kind: 'file'; id: Id<'documents'>; label: string }
  ]
}>()

const convex = useConvex()
const pickerRef = ref<{ focusSearch: () => void } | null>(null)

const { data: scopeInventory } = useConvexQuery(api.folders.searchScopeItems, computed(() => ({
  rootFolderId: props.folderId,
  search: '',
})))

const genericFolders = computed<PickerFolder[]>(() =>
  (scopeInventory.value?.folders ?? []).map((f) => ({
    id: f.id as unknown as string,
    name: f.name,
    parentId: undefined,
    fileCount: f.descendantFileCount,
  })),
)

const genericFiles = computed<PickerFile[]>(() =>
  (scopeInventory.value?.files ?? []).map((f) => ({
    id: f.id as unknown as string,
    name: f.filename,
    folderId: props.folderId as unknown as string,
  })),
)

const selectedCount = computed(() => {
  const folderCount = props.scope.totalFolderCount.value
  const fileCount = props.scope.totalFileCount.value
  return folderCount + fileCount
})

function isFileSelected(fileId: string): boolean {
  return props.scope.isFileSelected(fileId as unknown as Id<'documents'>)
}

function isFolderSelected(folderId: string): 'all' | 'some' | 'none' {
  const folder = (scopeInventory.value?.folders ?? []).find(
    (f) => (f.id as unknown as string) === folderId,
  )
  if (!folder) return 'none'
  const state = props.scope.selectionStateForFolder(folder)
  if (state === 'on') return 'all'
  if (state === 'indeterminate') return 'some'
  return 'none'
}

async function resolveFolderSelection(folder: ScopeFolderSummary) {
  const existing = props.scope.folderMeta.value.get(folder.id as unknown as string)
  if (existing?.descendantFileIds?.length) return existing

  const result = await convex.query(api.folders.resolveScope, { folderIds: [folder.id] })
  return {
    ...folder,
    descendantFileIds: (result.documentIds ?? []) as Id<'documents'>[],
  } satisfies ScopeFolderSummary
}

async function handleToggleFolder(folderId: string) {
  const folder = (scopeInventory.value?.folders ?? []).find(
    (f) => (f.id as unknown as string) === folderId,
  )
  if (!folder) return
  const selected = props.scope.toggleFolder(await resolveFolderSelection(folder))
  if (selected) emit('select', { kind: 'folder', id: folder.id, label: folder.name })
}

function handleToggleFile(fileId: string) {
  const file = (scopeInventory.value?.files ?? []).find(
    (f) => (f.id as unknown as string) === fileId,
  )
  if (!file) return
  const selected = props.scope.toggleFile(file)
  if (selected) emit('select', { kind: 'file', id: file.id, label: file.filename })
}

function handleClear() {
  props.scope.clear()
}

watch(
  () => props.autoFocusSearch,
  (next) => {
    if (next) pickerRef.value?.focusSearch()
  },
  { immediate: true },
)

defineExpose({
  focusSearch() {
    pickerRef.value?.focusSearch()
  },
})
</script>

<template>
  <div
    v-if="genericFolders.length === 0 && genericFiles.length === 0 && scopeInventory !== undefined"
    data-testid="directory-picker-empty-state"
    class="flex flex-col items-center gap-3 p-6 text-center"
  >
    <div class="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
      <svg class="h-5 w-5 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
      </svg>
    </div>
    <div>
      <p class="font-dm-sans text-sm font-semibold text-foreground">No documents yet</p>
      <p class="mt-1 font-inter text-xs text-muted-foreground">
        Upload or import files to ground your chat and audio overviews in real sources.
      </p>
    </div>
  </div>
  <GlobalDirectoryPicker
    v-else
    ref="pickerRef"
    :folders="genericFolders"
    :files="genericFiles"
    :is-file-selected="isFileSelected"
    :is-folder-selected="isFolderSelected"
    :on-toggle-file="handleToggleFile"
    :on-toggle-folder="handleToggleFolder"
    :on-clear="handleClear"
    :selected-count="selectedCount"
    :search-placeholder="'Search this directory'"
    :presentation="props.presentation"
    @close="emit('close')"
  />
</template>
