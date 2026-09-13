<script setup lang="ts">
import { Loader2, AlertTriangle } from '@lucide/vue'
import type { Id } from '../../../convex/_generated/dataModel'
import { api } from '#convex/api'
import type { PickerFolder, PickerFile } from '~/components/global/DirectoryPicker.vue'

type SourceType = 'folder' | 'web-only'

interface SubmitPayload {
  title: string
  sourceType: SourceType
  folderId: Id<'folders'>
  documentIds: Id<'documents'>[]
  webSearchEnabled: boolean
}

const props = defineProps<{
  folderId: Id<'folders'>
  loading?: boolean
}>()

const emit = defineEmits<{
  submit: [payload: SubmitPayload]
}>()

const topic = ref('')
const webSearchEnabled = ref(false)
const selectedFileIds = ref<Set<string>>(new Set())
const selectedFolderIds = ref<Set<string>>(new Set())

const backlogQuery = import.meta.client
  ? useConvexQuery(api.reviewItems.getReviewBacklogCount, {})
  : { data: ref(null) }

const scopeQuery = import.meta.client
  ? useConvexQuery(api.folders.searchScopeItems, computed(() => ({
    rootFolderId: props.folderId,
    search: '',
  })))
  : { data: ref(null) }

const showBacklogWarning = computed(() => {
  const data = backlogQuery.data?.value as { dueCount: number; dailyCap: number } | null | undefined
  if (!data) return false
  return data.dueCount > data.dailyCap * 2
})

const backlogCount = computed(() => {
  const data = backlogQuery.data?.value as { dueCount: number; dailyCap: number } | null | undefined
  return data?.dueCount ?? 0
})

const pickerFolders = computed<PickerFolder[]>(() =>
  (scopeQuery.data?.value?.folders ?? []).map((f: any) => ({
    id: f.id as string,
    name: f.name,
    parentId: f.parentId as string | undefined,
    fileCount: f.descendantFileCount ?? f.fileCount ?? 0,
  })),
)

const pickerFiles = computed<PickerFile[]>(() =>
  (scopeQuery.data?.value?.files ?? []).map((f: any) => ({
    id: f.id as string,
    name: f.filename,
    folderId: (f.folderId ?? props.folderId) as string,
  })),
)

const totalFileCount = computed(() => pickerFiles.value.length)
const hasFiles = computed(() => totalFileCount.value > 0)
const selectedCount = computed(() => selectedFileIds.value.size + selectedFolderIds.value.size)
const hasSelection = computed(() => selectedCount.value > 0)

const canSubmit = computed(() => {
  return topic.value.trim().length > 0 && !props.loading
})

function isFileSelected(fileId: string): boolean {
  return selectedFileIds.value.has(fileId)
}

function isFolderSelected(folderId: string): 'all' | 'some' | 'none' {
  if (selectedFolderIds.value.has(folderId)) return 'all'
  return 'none'
}

function handleToggleFile(fileId: string) {
  const next = new Set(selectedFileIds.value)
  if (next.has(fileId)) next.delete(fileId)
  else next.add(fileId)
  selectedFileIds.value = next
}

function handleToggleFolder(folderId: string) {
  const next = new Set(selectedFolderIds.value)
  if (next.has(folderId)) next.delete(folderId)
  else next.add(folderId)
  selectedFolderIds.value = next
}

function handleClear() {
  selectedFileIds.value = new Set()
  selectedFolderIds.value = new Set()
}

function resolveSourceType(): SourceType {
  if (!hasFiles.value && !hasSelection.value) return 'web-only'
  return 'folder'
}

function handleSubmit() {
  if (!canSubmit.value) return
  const sourceType = resolveSourceType()

  const documentIds = [...selectedFileIds.value] as Id<'documents'>[]

  emit('submit', {
    title: topic.value.trim(),
    sourceType,
    folderId: props.folderId,
    documentIds,
    webSearchEnabled: sourceType === 'web-only' ? true : webSearchEnabled.value,
  })
}
</script>

<template>
  <div class="mx-auto w-full max-w-2xl px-4 py-6" data-testid="source-selector">
    <h2 class="mb-6 text-2xl font-bold text-foreground">Create a Course</h2>

    <div
      v-if="showBacklogWarning"
      class="mb-6 flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3"
      data-testid="backlog-warning"
      role="alert"
    >
      <AlertTriangle class="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
      <div>
        <p class="text-sm text-amber-200">
          You have {{ backlogCount }} items due for review.
          Consider completing reviews before starting new courses.
        </p>
        <NuxtLink
          to="/app/learn/review"
          class="mt-1 inline-block text-xs text-amber-400 underline transition-colors hover:text-amber-300"
        >
          Go to review
        </NuxtLink>
      </div>
    </div>

    <div class="mb-6">
      <label class="mb-1.5 block text-sm font-medium text-muted-foreground" for="topic-input">
        What do you want to learn?
      </label>
      <input
        id="topic-input"
        v-model="topic"
        type="text"
        placeholder="e.g. React hooks, Organic Chemistry..."
        class="w-full rounded-lg border border-input bg-background px-4 py-3 text-sm text-foreground placeholder-muted-foreground outline-none focus:border-primary"
        data-testid="topic-input"
      />
    </div>

    <div v-if="hasFiles" class="mb-6 space-y-3">
      <div class="flex items-center justify-between">
        <div>
          <h3 class="text-sm font-medium text-foreground">Select source material</h3>
          <p class="text-xs text-muted-foreground">
            <template v-if="hasSelection">
              {{ selectedCount }} selected
            </template>
            <template v-else>
              All {{ totalFileCount }} documents will be used
            </template>
          </p>
        </div>
      </div>

      <div class="min-w-0 overflow-hidden rounded-lg border border-border/60" data-testid="directory-picker">
        <DirectoryPicker
          :folders="pickerFolders"
          :files="pickerFiles"
          :is-file-selected="isFileSelected"
          :is-folder-selected="isFolderSelected"
          :on-toggle-file="handleToggleFile"
          :on-toggle-folder="handleToggleFolder"
          :on-clear="handleClear"
          :selected-count="selectedCount"
          search-placeholder="Search documents"
          presentation="drawer"
        />
      </div>
    </div>

    <div v-else class="mb-6 rounded-lg border border-dashed border-border px-4 py-3">
      <p class="text-sm text-muted-foreground">
        No documents in this folder. The course will be generated from web sources.
      </p>
    </div>

    <div v-if="hasFiles" class="mb-8">
      <label class="flex cursor-pointer items-center gap-3" data-testid="web-search-toggle">
        <input
          v-model="webSearchEnabled"
          type="checkbox"
          class="h-4 w-4 rounded border-input bg-background text-primary accent-primary"
          data-testid="web-search-checkbox"
        />
        <span class="text-sm text-foreground">
          Supplement from web
        </span>
      </label>
    </div>

    <button
      class="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
      :disabled="!canSubmit"
      data-testid="generate-outline-button"
      @click="handleSubmit"
    >
      <Loader2 v-if="loading" class="h-4 w-4 animate-spin" />
      Generate Outline
      <span v-if="!loading" aria-hidden="true">&rarr;</span>
    </button>
  </div>
</template>
