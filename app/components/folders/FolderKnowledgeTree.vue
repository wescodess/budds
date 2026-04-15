<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronDown, ChevronRight, Search, Plus, Upload, FileText, MoreHorizontal, FolderPlus, FolderInput, Trash2, Pencil } from 'lucide-vue-next'
import type { Doc, Id } from '~~/convex/_generated/dataModel'

const props = defineProps<{
  subfolders: Doc<'folders'>[]
  documents: Doc<'documents'>[]
  loading?: boolean
  canCreateSubfolder?: boolean
}>()

const emit = defineEmits<{
  openSubfolder: [id: Id<'folders'>]
  newSubfolder: []
  uploadFiles: [files: File[]]
  renameSubfolder: [id: Id<'folders'>]
  deleteSubfolder: [id: Id<'folders'>]
  moveDocument: [id: Id<'documents'>]
  deleteDocument: [id: Id<'documents'>]
}>()

const search = ref('')
const subfoldersOpen = ref(true)
const documentsOpen = ref(true)
const fileInputRef = ref<HTMLInputElement | null>(null)

const filteredSubfolders = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return props.subfolders
  return props.subfolders.filter(f => f.name.toLowerCase().includes(q))
})

const filteredDocuments = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return props.documents
  return props.documents.filter(d => d.filename.toLowerCase().includes(q))
})

function formatFileSize(bytes: number): string {
  if (!bytes) return ''
  if (bytes >= 1_048_576) return `${Math.round(bytes / 1_048_576)} MB`
  return `${Math.round(bytes / 1024)} KB`
}

function triggerUpload() {
  fileInputRef.value?.click()
}

function onFilesChosen(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files && input.files.length) {
    emit('uploadFiles', Array.from(input.files))
    input.value = ''
  }
}
</script>

<template>
  <div
    data-testid="folder-knowledge-tree"
    class="flex h-full flex-col"
  >
    <div class="relative px-1 pb-3">
      <Search class="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        v-model="search"
        type="search"
        placeholder="Search this folder…"
        data-testid="folder-knowledge-tree-search"
        inputmode="search"
        enterkeyhint="search"
        autocapitalize="none"
        autocorrect="off"
        spellcheck="false"
        autocomplete="off"
        class="h-8 w-full rounded-md border bg-background pl-8 pr-2 text-xs outline-none focus:ring-2 focus:ring-ring"
      >
    </div>

    <div class="flex-1 overflow-y-auto px-1">
      <section class="mb-4">
        <header class="mb-1 flex items-center justify-between">
          <button
            type="button"
            class="inline-flex min-h-9 items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground sm:min-h-7 sm:gap-1 sm:px-1 sm:py-0.5"
            :aria-expanded="subfoldersOpen"
            @click="subfoldersOpen = !subfoldersOpen"
          >
            <component :is="subfoldersOpen ? ChevronDown : ChevronRight" class="h-4 w-4 sm:h-3 sm:w-3" />
            Subfolders
            <span class="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {{ filteredSubfolders.length }}
            </span>
          </button>
          <button
            v-if="canCreateSubfolder"
            type="button"
            data-testid="folder-knowledge-tree-add-subfolder"
            class="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-primary hover:bg-primary/10"
            @click="emit('newSubfolder')"
          >
            <Plus class="h-3 w-3" />
            Add
          </button>
        </header>

        <ul v-if="subfoldersOpen" class="space-y-0.5">
          <li v-if="!filteredSubfolders.length" class="px-2 py-1.5 text-xs text-muted-foreground">
            {{ search ? 'No matches' : 'No subfolders yet' }}
          </li>
          <li
            v-for="sf in filteredSubfolders"
            :key="sf._id"
            class="group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
          >
            <button
              type="button"
              :data-testid="`folder-knowledge-tree-subfolder-${sf._id}`"
              class="flex min-w-0 flex-1 items-center gap-2 text-left"
              @click="emit('openSubfolder', sf._id)"
            >
              <FoldersFolderBadge :color="sf.color" :icon="sf.icon" size="sm" />
              <span class="min-w-0 flex-1 truncate">{{ sf.name }}</span>
              <span
                v-if="sf.documentCount"
                class="shrink-0 text-[10px] text-muted-foreground"
              >
                {{ sf.documentCount }} docs
              </span>
            </button>
            <UiDropdownMenu>
              <UiDropdownMenuTrigger as-child>
                <button
                  type="button"
                  class="hidden h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground group-hover:inline-flex"
                  :aria-label="`Menu for ${sf.name}`"
                >
                  <MoreHorizontal class="h-3.5 w-3.5" />
                </button>
              </UiDropdownMenuTrigger>
              <UiDropdownMenuContent align="end">
                <UiDropdownMenuItem @click="emit('renameSubfolder', sf._id)">
                  <Pencil class="mr-2 h-4 w-4" />
                  Rename
                </UiDropdownMenuItem>
                <UiDropdownMenuSeparator />
                <UiDropdownMenuItem
                  class="text-destructive focus:text-destructive"
                  @click="emit('deleteSubfolder', sf._id)"
                >
                  <Trash2 class="mr-2 h-4 w-4" />
                  Delete
                </UiDropdownMenuItem>
              </UiDropdownMenuContent>
            </UiDropdownMenu>
          </li>
        </ul>
      </section>

      <section>
        <header class="mb-1 flex items-center justify-between">
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
            :aria-expanded="documentsOpen"
            @click="documentsOpen = !documentsOpen"
          >
            <component :is="documentsOpen ? ChevronDown : ChevronRight" class="h-3 w-3" />
            Documents
            <span class="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {{ filteredDocuments.length }}
            </span>
          </button>
          <button
            type="button"
            data-testid="folder-knowledge-tree-add-document"
            class="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-primary hover:bg-primary/10"
            @click="triggerUpload"
          >
            <Plus class="h-3 w-3" />
            Add
          </button>
        </header>

        <ul v-if="documentsOpen" class="space-y-0.5">
          <li v-if="!filteredDocuments.length && !search">
            <button
              type="button"
              data-testid="folder-knowledge-tree-empty-drop"
              class="flex w-full items-center justify-center gap-2 rounded-md border border-dashed px-3 py-4 text-xs text-muted-foreground hover:bg-accent/50"
              @click="triggerUpload"
            >
              <Upload class="h-3.5 w-3.5" />
              Drop files or click to upload
            </button>
          </li>
          <li v-else-if="!filteredDocuments.length" class="px-2 py-1.5 text-xs text-muted-foreground">
            No matches
          </li>
          <li
            v-for="doc in filteredDocuments"
            :key="doc._id"
            :data-testid="`folder-knowledge-tree-doc-${doc._id}`"
            class="group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
          >
            <FileText class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm">{{ doc.filename }}</p>
              <p v-if="doc.fileSize" class="text-[10px] text-muted-foreground">
                {{ formatFileSize(doc.fileSize) }}
              </p>
            </div>
            <UiDropdownMenu>
              <UiDropdownMenuTrigger as-child>
                <button
                  type="button"
                  class="hidden h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground group-hover:inline-flex"
                  :aria-label="`Menu for ${doc.filename}`"
                >
                  <MoreHorizontal class="h-3.5 w-3.5" />
                </button>
              </UiDropdownMenuTrigger>
              <UiDropdownMenuContent align="end">
                <UiDropdownMenuItem @click="emit('moveDocument', doc._id)">
                  <FolderInput class="mr-2 h-4 w-4" />
                  Move
                </UiDropdownMenuItem>
                <UiDropdownMenuSeparator />
                <UiDropdownMenuItem
                  class="text-destructive focus:text-destructive"
                  @click="emit('deleteDocument', doc._id)"
                >
                  <Trash2 class="mr-2 h-4 w-4" />
                  Delete
                </UiDropdownMenuItem>
              </UiDropdownMenuContent>
            </UiDropdownMenu>
          </li>
        </ul>
      </section>
    </div>

    <div class="sticky bottom-0 mt-3 flex items-center gap-2 border-t bg-background pt-3">
      <UiButton
        v-if="canCreateSubfolder"
        size="sm"
        class="flex-1"
        data-testid="folder-knowledge-tree-new-subfolder"
        @click="emit('newSubfolder')"
      >
        <FolderPlus class="mr-1.5 h-4 w-4" />
        New subfolder
      </UiButton>
      <UiButton
        size="sm"
        variant="outline"
        class="flex-1"
        data-testid="folder-knowledge-tree-upload"
        @click="triggerUpload"
      >
        <Upload class="mr-1.5 h-4 w-4" />
        Upload file
      </UiButton>
    </div>

    <input
      ref="fileInputRef"
      type="file"
      multiple
      class="hidden"
      data-testid="folder-knowledge-tree-file-input"
      @change="onFilesChosen"
    >
  </div>
</template>
