<script setup lang="ts">
import { Loader2, AlertTriangle } from 'lucide-vue-next'
import type { Id } from '../../../convex/_generated/dataModel'
import { api } from '#convex/api'

type SourceType = 'folder' | 'cross-folder' | 'web-only'

interface SubmitPayload {
  title: string
  sourceType: SourceType
  folderIds: Id<'folders'>[]
  documentIds: Id<'documents'>[]
  webSearchEnabled: boolean
}

const props = defineProps<{
  initialFolderId?: string
  loading?: boolean
}>()

const emit = defineEmits<{
  submit: [payload: SubmitPayload]
}>()

const topic = ref('')
const webSearchEnabled = ref(false)
const selectedFolderIds = ref<Set<string>>(new Set())

const foldersQuery = import.meta.client
  ? useConvexQuery(api.folders.listAllFolders, {})
  : { data: ref([]) }

const docCountsQuery = import.meta.client
  ? useConvexQuery(api.documents.countsByFolder, {})
  : { data: ref([]) }

const backlogQuery = import.meta.client
  ? useConvexQuery(api.reviewItems.getReviewBacklogCount, {})
  : { data: ref(null) }

const folders = computed(() => foldersQuery.data?.value ?? [])
const docCounts = computed(() => {
  const counts = docCountsQuery.data?.value ?? []
  const map = new Map<string, number>()
  for (const c of counts) map.set(c.folderId, c.count)
  return map
})

const showBacklogWarning = computed(() => {
  const data = backlogQuery.data?.value as { dueCount: number; dailyCap: number } | null | undefined
  if (!data) return false
  return data.dueCount > data.dailyCap * 2
})

const backlogCount = computed(() => {
  const data = backlogQuery.data?.value as { dueCount: number; dailyCap: number } | null | undefined
  return data?.dueCount ?? 0
})

if (props.initialFolderId) {
  selectedFolderIds.value.add(props.initialFolderId)
}

function toggleFolder(folderId: string) {
  const set = new Set(selectedFolderIds.value)
  if (set.has(folderId)) set.delete(folderId)
  else set.add(folderId)
  selectedFolderIds.value = set
}

const hasSources = computed(() => selectedFolderIds.value.size > 0)
const canSubmit = computed(() => {
  return (topic.value.trim().length > 0 || hasSources.value) && !props.loading
})

function resolveSourceType(): SourceType {
  if (!hasSources.value) return 'web-only'
  return 'folder'
}

function handleSubmit() {
  if (!canSubmit.value) return
  const sourceType = resolveSourceType()
  const folderIds = [...selectedFolderIds.value] as Id<'folders'>[]

  const title = topic.value.trim() || folderIds.map((fid) => {
    const f = folders.value.find((fo: any) => fo._id === fid)
    return f ? (f as any).name : ''
  }).filter(Boolean).join(', ')

  emit('submit', {
    title,
    sourceType,
    folderIds,
    documentIds: [],
    webSearchEnabled: sourceType === 'web-only' ? true : webSearchEnabled.value,
  })
}
</script>

<template>
  <div class="mx-auto w-full max-w-2xl px-4 py-6" data-testid="source-selector">
    <h2 class="mb-6 text-2xl font-bold text-stone-100">Create a Course</h2>

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
      <label class="mb-1.5 block text-sm font-medium text-stone-400" for="topic-input">
        What do you want to learn?
      </label>
      <input
        id="topic-input"
        v-model="topic"
        type="text"
        placeholder="e.g. React hooks, Organic Chemistry..."
        class="w-full rounded-lg border border-stone-700 bg-stone-800 px-4 py-3 text-sm text-stone-100 placeholder-stone-500 outline-none focus:border-amber-500"
        data-testid="topic-input"
      />
    </div>

    <div class="mb-6">
      <p class="mb-3 text-sm text-stone-500">&mdash; or select from your knowledge base &mdash;</p>

      <div
        v-if="folders.length === 0"
        class="rounded-lg border border-dashed border-stone-700 px-4 py-6 text-center text-sm text-stone-500"
      >
        No folders yet. Enter a topic above to create a web-sourced course.
      </div>

      <div v-else class="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-stone-700 bg-stone-900 p-3">
        <label
          v-for="folder in folders"
          :key="(folder as any)._id"
          class="flex cursor-pointer items-center gap-3 rounded px-2 py-2 transition-colors hover:bg-stone-800"
          :data-testid="`folder-row-${(folder as any)._id}`"
        >
          <input
            type="checkbox"
            :checked="selectedFolderIds.has((folder as any)._id)"
            class="h-4 w-4 rounded border-stone-600 bg-stone-800 text-amber-500 accent-amber-500"
            data-testid="folder-checkbox"
            @change="toggleFolder((folder as any)._id)"
          />
          <span class="flex-1 text-sm text-stone-200">{{ (folder as any).name }}</span>
          <span class="text-xs text-stone-500">
            {{ docCounts.get((folder as any)._id) ?? 0 }} docs
          </span>
        </label>
      </div>
    </div>

    <div class="mb-8">
      <label class="flex cursor-pointer items-center gap-3" data-testid="web-search-toggle">
        <input
          v-model="webSearchEnabled"
          type="checkbox"
          class="h-4 w-4 rounded border-stone-600 bg-stone-800 text-amber-500 accent-amber-500"
          :disabled="!hasSources"
          data-testid="web-search-checkbox"
        />
        <span class="text-sm text-stone-300" :class="{ 'text-stone-500': !hasSources }">
          Supplement from web
        </span>
      </label>
      <p v-if="!hasSources && topic.trim()" class="mt-1 pl-7 text-xs text-stone-500">
        Web sources will be used automatically for topic-only courses
      </p>
    </div>

    <button
      class="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
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
