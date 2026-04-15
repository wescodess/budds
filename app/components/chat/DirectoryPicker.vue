<script setup lang="ts">
import { refDebounced } from '@vueuse/core'
import { Search, X } from 'lucide-vue-next'
import { api } from '#convex/api'
import type { Id } from '../../../convex/_generated/dataModel'
import type { ScopeFileSummary, ScopeFolderSummary, useReferenceScope } from '~/composables/useReferenceScope'

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
const expanded = ref<Set<string>>(new Set())
const search = ref('')
const searchInputRef = ref<HTMLInputElement | null>(null)

const debouncedSearch = refDebounced(search, 140)
const normalizedSearch = computed(() => debouncedSearch.value.trim().toLowerCase())
const displaySearchTerm = computed(() => search.value.trim())
const folderCountLabel = computed(() =>
  `${props.scope.totalFolderCount.value} folder${props.scope.totalFolderCount.value === 1 ? '' : 's'}`,
)
const fileCountLabel = computed(() =>
  `${props.scope.totalFileCount.value} file${props.scope.totalFileCount.value === 1 ? '' : 's'}`,
)

const { data: scopeInventory } = useConvexQuery(api.folders.searchScopeItems, computed(() => ({
  rootFolderId: props.folderId,
  search: '',
})))

const matchingFolders = computed(() => {
  if (!normalizedSearch.value) return []
  return (scopeInventory.value?.folders ?? [])
    .filter(folder => folder.name.toLowerCase().includes(normalizedSearch.value))
    .slice(0, 20)
})
const matchingFiles = computed(() => {
  if (!normalizedSearch.value) return []
  return (scopeInventory.value?.files ?? [])
    .filter(file => file.filename.toLowerCase().includes(normalizedSearch.value))
    .slice(0, 30)
})
const isSearching = computed(() => search.value.trim().length > 0)
const hasSearchResults = computed(() => matchingFolders.value.length > 0 || matchingFiles.value.length > 0)
const isDrawer = computed(() => props.presentation === 'drawer')

function toggleExpand(id: Id<'folders'>) {
  const key = id as unknown as string
  const next = new Set(expanded.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expanded.value = next
}

function focusSearch() {
  nextTick(() => searchInputRef.value?.focus())
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

async function handleFolderPick(folder: ScopeFolderSummary) {
  const selected = props.scope.toggleFolder(await resolveFolderSelection(folder))
  if (selected) emit('select', { kind: 'folder', id: folder.id, label: folder.name })
}

function handleFilePick(file: ScopeFileSummary) {
  const selected = props.scope.toggleFile(file)
  if (selected) emit('select', { kind: 'file', id: file.id, label: file.filename })
}

watch(
  () => props.autoFocusSearch,
  (next) => {
    if (next) focusSearch()
  },
  { immediate: true },
)

defineExpose({ focusSearch })
</script>

<template>
  <div
    data-testid="directory-picker"
    :class="[
      'flex flex-col overflow-hidden bg-card text-sm',
      isDrawer
        ? 'w-full rounded-none border-0 shadow-none'
        : 'w-[360px] rounded-xl border shadow-lg',
    ]"
  >
    <div class="flex items-center justify-between border-b px-4 py-3">
      <div class="flex flex-col">
        <span class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Directory
        </span>
        <span class="text-sm font-semibold">
          {{ folderCountLabel }} • {{ fileCountLabel }}
        </span>
      </div>
      <div class="flex items-center gap-2">
        <button
          v-if="props.scope.hasSelection.value"
          type="button"
          class="text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded px-1"
          @click="props.scope.clear()"
        >
          Clear
        </button>
        <button
          type="button"
          aria-label="Close directory picker"
          class="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          @click="emit('close')"
        >
          <X class="h-4 w-4" />
        </button>
      </div>
    </div>

    <div class="border-b px-3 py-2">
      <label class="flex items-center gap-2 rounded-lg border bg-background px-3 py-1.5 focus-within:border-primary">
        <Search class="h-4 w-4 text-muted-foreground" />
        <input
          ref="searchInputRef"
          v-model="search"
          type="search"
          placeholder="Search this directory"
          inputmode="search"
          enterkeyhint="search"
          autocapitalize="none"
          autocorrect="off"
          spellcheck="false"
          autocomplete="off"
          class="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
      </label>
    </div>

    <div :class="[isDrawer ? 'max-h-[calc(var(--mobile-vh,100dvh)-14rem)]' : 'max-h-80', 'keyboard-scroll-area flex-1 overflow-y-auto py-1']">
      <template v-if="isSearching">
        <div v-if="matchingFolders.length > 0" class="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Folders
        </div>
        <ChatDirectoryPickerRow
          v-for="folder in matchingFolders"
          :key="`search-folder-${folder.id}`"
          kind="folder"
          :label="folder.name"
          :badge="`${folder.descendantFileCount} file${folder.descendantFileCount === 1 ? '' : 's'}`"
          :state="props.scope.selectionStateForFolder(folder)"
          @toggle="handleFolderPick(folder)"
        />

        <div v-if="matchingFiles.length > 0" class="px-2 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Files
        </div>
        <ChatDirectoryPickerRow
          v-for="file in matchingFiles"
          :key="`search-file-${file.id}`"
          kind="file"
          :label="file.filename"
          :state="props.scope.isFileSelected(file.id) ? 'on' : 'off'"
          @toggle="handleFilePick(file)"
        />

        <div
          v-if="!hasSearchResults"
          class="px-4 py-6 text-center text-xs text-muted-foreground"
        >
          No files or folders matched "{{ displaySearchTerm }}".
        </div>
      </template>

      <ChatDirectoryPickerBranch
        v-else
        :folder-id="props.folderId"
        :depth="0"
        :scope="props.scope"
        :expanded="expanded"
        :inherited-selected="false"
        @toggle-expand="toggleExpand"
        @pick-folder="handleFolderPick"
        @pick-file="handleFilePick"
      />
    </div>
  </div>
</template>
