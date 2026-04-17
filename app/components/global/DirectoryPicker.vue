<script setup lang="ts">
import { refDebounced } from '@vueuse/core'
import { Search, X, Folder, FileText, ChevronRight } from 'lucide-vue-next'

export type TriState = 'all' | 'some' | 'none'

export interface PickerFolder {
  id: string
  name: string
  parentId?: string
  fileCount?: number
}

export interface PickerFile {
  id: string
  name: string
  folderId: string
}

const props = withDefaults(defineProps<{
  folders: PickerFolder[]
  files: PickerFile[]
  isFileSelected: (fileId: string) => boolean
  isFolderSelected: (folderId: string) => TriState
  onToggleFile: (fileId: string) => void
  onToggleFolder: (folderId: string) => void
  onClear: () => void
  selectedCount: number
  searchPlaceholder?: string
  presentation?: 'popover' | 'drawer'
}>(), {
  searchPlaceholder: 'Search this directory',
  presentation: 'popover',
})

const emit = defineEmits<{
  close: []
}>()

const expanded = ref<Set<string>>(new Set())
const search = ref('')
const searchInputRef = ref<HTMLInputElement | null>(null)
const debouncedSearch = refDebounced(search, 140)
const normalizedSearch = computed(() => debouncedSearch.value.trim().toLowerCase())
const displaySearchTerm = computed(() => search.value.trim())
const isDrawer = computed(() => props.presentation === 'drawer')
const isSearching = computed(() => search.value.trim().length > 0)

const rootFolders = computed(() =>
  props.folders.filter((f) => !f.parentId),
)

function childFolders(parentId: string) {
  return props.folders.filter((f) => f.parentId === parentId)
}

function filesForFolder(folderId: string) {
  return props.files.filter((f) => f.folderId === folderId)
}

const matchingFolders = computed(() => {
  if (!normalizedSearch.value) return []
  return props.folders
    .filter((f) => f.name.toLowerCase().includes(normalizedSearch.value))
    .slice(0, 20)
})

const matchingFiles = computed(() => {
  if (!normalizedSearch.value) return []
  return props.files
    .filter((f) => f.name.toLowerCase().includes(normalizedSearch.value))
    .slice(0, 30)
})

const hasSearchResults = computed(() =>
  matchingFolders.value.length > 0 || matchingFiles.value.length > 0,
)

const folderCountLabel = computed(() => {
  const n = props.folders.length
  return `${n} folder${n === 1 ? '' : 's'}`
})

const fileCountLabel = computed(() => {
  const n = props.files.length
  return `${n} file${n === 1 ? '' : 's'}`
})

function toggleExpand(id: string) {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}

function hasExpandableChildren(folderId: string): boolean {
  return childFolders(folderId).length > 0 || filesForFolder(folderId).length > 0
}

function focusSearch() {
  nextTick(() => searchInputRef.value?.focus())
}

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
          {{ folderCountLabel }} &bull; {{ fileCountLabel }}
        </span>
      </div>
      <div class="flex items-center gap-2">
        <button
          v-if="selectedCount > 0"
          type="button"
          class="text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded px-1"
          @click="onClear()"
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
          :placeholder="searchPlaceholder"
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
        <div
          v-for="folder in matchingFolders"
          :key="`search-folder-${folder.id}`"
          class="group flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm hover:bg-accent/10"
          style="padding-left: 8px"
        >
          <span class="w-7 shrink-0" />
          <UiCheckbox
            :model-value="isFolderSelected(folder.id) === 'all' ? true : isFolderSelected(folder.id) === 'some' ? 'indeterminate' : false"
            :aria-label="`Select ${folder.name}`"
            @update:model-value="onToggleFolder(folder.id)"
          />
          <Folder class="h-4 w-4 shrink-0 text-muted-foreground" />
          <button type="button" class="flex min-w-0 flex-1 items-center gap-2 text-left" @click="onToggleFolder(folder.id)">
            <span class="truncate text-foreground">{{ folder.name }}</span>
          </button>
          <span v-if="folder.fileCount" class="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {{ folder.fileCount }} file{{ folder.fileCount === 1 ? '' : 's' }}
          </span>
        </div>

        <div v-if="matchingFiles.length > 0" class="px-2 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Files
        </div>
        <div
          v-for="file in matchingFiles"
          :key="`search-file-${file.id}`"
          class="group flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm hover:bg-accent/10"
          style="padding-left: 8px"
        >
          <span class="w-7 shrink-0" />
          <UiCheckbox
            :model-value="isFileSelected(file.id)"
            :aria-label="`Select ${file.name}`"
            @update:model-value="onToggleFile(file.id)"
          />
          <FileText class="h-4 w-4 shrink-0 text-muted-foreground" />
          <button type="button" class="flex min-w-0 flex-1 items-center gap-2 text-left" @click="onToggleFile(file.id)">
            <span class="truncate text-foreground">{{ file.name }}</span>
          </button>
        </div>

        <div
          v-if="!hasSearchResults"
          class="px-4 py-6 text-center text-xs text-muted-foreground"
        >
          No files or folders matched "{{ displaySearchTerm }}".
        </div>
      </template>

      <template v-else>
        <template v-for="folder in rootFolders" :key="folder.id">
          <div class="group flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm hover:bg-accent/10" style="padding-left: 8px">
            <button
              v-if="hasExpandableChildren(folder.id)"
              type="button"
              :aria-label="expanded.has(folder.id) ? 'Collapse' : 'Expand'"
              :aria-expanded="expanded.has(folder.id)"
              class="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              @click="toggleExpand(folder.id)"
            >
              <ChevronRight
                class="h-3.5 w-3.5 transition-transform motion-reduce:transition-none"
                :class="expanded.has(folder.id) ? 'rotate-90' : ''"
              />
            </button>
            <span v-else class="w-7 shrink-0" />
            <UiCheckbox
              :model-value="isFolderSelected(folder.id) === 'all' ? true : isFolderSelected(folder.id) === 'some' ? 'indeterminate' : false"
              :aria-label="`Select ${folder.name}`"
              @update:model-value="onToggleFolder(folder.id)"
            />
            <Folder class="h-4 w-4 shrink-0 text-muted-foreground" />
            <button type="button" class="flex min-w-0 flex-1 items-center gap-2 text-left" @click="onToggleFolder(folder.id)">
              <span class="truncate text-foreground">{{ folder.name }}</span>
            </button>
            <span v-if="folder.fileCount" class="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {{ folder.fileCount }} file{{ folder.fileCount === 1 ? '' : 's' }}
            </span>
          </div>

          <template v-if="expanded.has(folder.id)">
            <div
              v-for="file in filesForFolder(folder.id)"
              :key="file.id"
              class="group flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm hover:bg-accent/10"
              :style="{ paddingLeft: '24px' }"
            >
              <span class="w-7 shrink-0" />
              <UiCheckbox
                :model-value="isFileSelected(file.id)"
                :aria-label="`Select ${file.name}`"
                @update:model-value="onToggleFile(file.id)"
              />
              <FileText class="h-4 w-4 shrink-0 text-muted-foreground" />
              <button type="button" class="flex min-w-0 flex-1 items-center gap-2 text-left" @click="onToggleFile(file.id)">
                <span class="truncate text-foreground">{{ file.name }}</span>
              </button>
            </div>

            <template v-for="sub in childFolders(folder.id)" :key="sub.id">
              <div
                class="group flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm hover:bg-accent/10"
                :style="{ paddingLeft: '24px' }"
              >
                <span class="w-7 shrink-0" />
                <UiCheckbox
                  :model-value="isFolderSelected(sub.id) === 'all' ? true : isFolderSelected(sub.id) === 'some' ? 'indeterminate' : false"
                  :aria-label="`Select ${sub.name}`"
                  @update:model-value="onToggleFolder(sub.id)"
                />
                <Folder class="h-4 w-4 shrink-0 text-muted-foreground" />
                <button type="button" class="flex min-w-0 flex-1 items-center gap-2 text-left" @click="onToggleFolder(sub.id)">
                  <span class="truncate text-foreground">{{ sub.name }}</span>
                </button>
                <span v-if="sub.fileCount" class="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {{ sub.fileCount }} file{{ sub.fileCount === 1 ? '' : 's' }}
                </span>
              </div>
            </template>
          </template>
        </template>
      </template>
    </div>

    <div v-if="selectedCount > 0" class="border-t px-4 py-2 text-xs text-muted-foreground">
      {{ selectedCount }} file{{ selectedCount === 1 ? '' : 's' }} selected
    </div>
  </div>
</template>
