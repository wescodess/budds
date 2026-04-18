<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { api } from '#convex/api'
import type { Id } from '../../../convex/_generated/dataModel'
import AudioOverviewCard from './AudioOverviewCard.vue'
import AudioOverviewGenerating from './AudioOverviewGenerating.vue'
import AudioOverviewPlayer from './AudioOverviewPlayer.vue'
import AudioOverviewCustomize from './AudioOverviewCustomize.vue'
import AudioOverviewShareDialog from './AudioOverviewShareDialog.vue'
import type {
  CustomizeSubmit,
  LengthMinutes,
  Complexity,
  HostVoice,
} from './customize-types'

import type { useReferenceScope } from '~/composables/useReferenceScope'

const props = defineProps<{
  folderId: Id<'folders'>
  scope?: ReturnType<typeof useReferenceScope>
}>()

const emit = defineEmits<{
  'generation-started': []
  'podcast-ask': [context: {
    overviewId: Id<'audioOverviews'>
    turnIndex: number
    timeMs: number
    quotedText: string
    sourceFilename?: string
  }]
}>()

const folderRef = computed(() => props.folderId)
const { tasks, cancel } = useTasks(folderRef)
const { documents } = useDocuments(folderRef)

const indexedCount = computed(() =>
  (documents.value ?? []).filter(doc => doc.status === 'success').length,
)

const { data: folderData } = useConvexQuery(
  api.folders.getFolder,
  computed(() => ({ folderId: props.folderId })),
)
const folderScope = computed(() => {
  const row = folderData.value as any
  return row?.referenceScope ?? null
})
const hasFolderScope = computed(() => {
  const s = folderScope.value
  if (!s) return false
  return (s.folderIds?.length ?? 0) > 0 || (s.fileIds?.length ?? 0) > 0
})

const { data: resolvedScopeData } = useConvexQuery(
  api.folders.resolveScope,
  computed(() => {
    const s = folderScope.value
    if (!s) return 'skip' as any
    return { folderIds: s.folderIds, fileIds: s.fileIds }
  }) as any,
)
const folderScopeDocIds = computed<string[]>(() => {
  const row = resolvedScopeData.value as { documentIds?: string[] } | null | undefined
  return row?.documentIds ?? []
})
const folderScopeDocCount = computed(() => {
  if (hasFolderScope.value) return folderScopeDocIds.value.length
  return indexedCount.value
})

type OverviewSummary = {
  _id: Id<'audioOverviews'>
  _creationTime: number
  title: string
  status: string
  turnCount: number
  totalDurationMs: number
  taskId?: Id<'tasks'>
  shareToken?: string
  publishedAt?: number
}

const { data: overviewsData } = useConvexQuery(
  api.audioOverviews.listByFolder,
  computed(() => ({ folderId: props.folderId })),
)
const overviews = computed<OverviewSummary[]>(
  () => (overviewsData.value as OverviewSummary[] | null | undefined) ?? [],
)
const readyOverviews = computed(() => overviews.value.filter(o => o.status === 'ready'))

const activeTask = computed(() => {
  const candidates = tasks.value.filter(t =>
    t.type === 'audio-overview-generation'
    && (t.status === 'pending' || t.status === 'running'),
  )
  if (candidates.length === 0) return null
  return [...candidates].sort((a, b) => b._creationTime - a._creationTime)[0] ?? null
})

const selectedOverviewId = ref<Id<'audioOverviews'> | null>(null)

const activeOverview = computed<OverviewSummary | null>(() => {
  const list = readyOverviews.value
  if (list.length === 0) return null
  if (selectedOverviewId.value) {
    const match = list.find(o => o._id === selectedOverviewId.value)
    if (match) return match
  }
  return list[0] ?? null
})

const createTaskMutation = import.meta.client
  ? useConvexMutation(api.tasks.create)
  : { mutate: async () => ({ taskId: '' }), isLoading: ref(false) } as any

const deleteOverviewMutation = import.meta.client
  ? useConvexMutation(api.audioOverviews.deleteOverview)
  : { mutate: async (_args: { id: Id<'audioOverviews'> }) => ({ deletedTurns: 0 }) } as any

const incrementQuotaMutation = import.meta.client
  ? useConvexMutation(api.users.incrementDailyQuota)
  : { mutate: async () => ({ used: 0, cap: 10, date: '' }) } as any

const { data: quotaData } = useConvexQuery(api.users.getDailyQuota, computed(() => ({})))
const quota = computed<{ used: number, cap: number, date: string } | null>(
  () => (quotaData.value as { used: number, cap: number, date: string } | null | undefined) ?? null,
)
const quotaState = computed(() => {
  const q = quota.value
  if (!q) return null
  return { used: q.used, cap: q.cap }
})
const quotaExceeded = computed(() => {
  const q = quota.value
  return q ? q.used >= q.cap : false
})

const shareOpen = ref(false)
const shareTargetOverviewId = ref<Id<'audioOverviews'> | null>(null)

const shareTarget = computed(() => {
  const id = shareTargetOverviewId.value
  if (!id) return null
  return readyOverviews.value.find(o => o._id === id) ?? null
})

const store = useAudioOverviewStore()

const submitting = ref(false)
const cancelling = ref(false)

const customizeOpen = ref(false)
const customizeDefaults = ref<{
  lengthMinutes: LengthMinutes
  complexity: Complexity
  voiceA: HostVoice
  voiceB: HostVoice
}>({ lengthMinutes: 10, complexity: 'beginner', voiceA: 'asteria', voiceB: 'orion' })

function openCustomize() {
  customizeOpen.value = true
}

async function handleCustomizeSubmit(value: CustomizeSubmit) {
  if (submitting.value) return
  if (quotaExceeded.value) {
    const { toast } = await import('vue-sonner')
    toast.error('Daily quota reached. Come back tomorrow.')
    return
  }
  submitting.value = true
  customizeOpen.value = false
  customizeDefaults.value = {
    lengthMinutes: value.lengthMinutes,
    complexity: value.complexity,
    voiceA: value.voiceProfile.hostA,
    voiceB: value.voiceProfile.hostB,
  }
  try {
    const result = (await createTaskMutation.mutate({
      folderId: props.folderId,
      type: 'audio-overview-generation',
      title: 'Generating audio overview…',
      metadata: { lengthMinutes: value.lengthMinutes, complexity: value.complexity },
    } as any)) as { taskId: Id<'tasks'> }

    let updatedQuota: { used: number, cap: number, date: string } | null = null
    try {
      updatedQuota = (await incrementQuotaMutation.mutate({} as any)) as { used: number, cap: number, date: string }
    }
    catch (err) {
      console.warn('[audio-overview] failed to increment daily quota', err)
    }

    if (updatedQuota && import.meta.client) {
      const thresholdKey = `audio-overview-quota-warning-${updatedQuota.date}`
      const ratio = updatedQuota.used / updatedQuota.cap
      if (ratio >= 0.8 && updatedQuota.used < updatedQuota.cap && !sessionStorage.getItem(thresholdKey)) {
        sessionStorage.setItem(thresholdKey, '1')
        const { toast } = await import('vue-sonner')
        toast.warning(`Heads up — ${updatedQuota.used} of ${updatedQuota.cap} audio overviews used today`, {
          description: 'Quota resets at midnight local time.',
        })
      }
    }

    emit('generation-started')

    const scopeDocIds = hasFolderScope.value && folderScopeDocIds.value.length > 0
      ? folderScopeDocIds.value
      : undefined

    $fetch('/api/audio-overview/generate', {
      method: 'POST',
      body: {
        folderId: props.folderId,
        taskId: result.taskId,
        preferences: { lengthMinutes: value.lengthMinutes, complexity: value.complexity },
        voiceProfile: { hostA: value.voiceProfile.hostA, hostB: value.voiceProfile.hostB },
        scopeDocIds,
      },
    }).catch(() => { /* task will surface failure state */ })
  }
  catch (err: any) {
    const { toast } = await import('vue-sonner')
    toast.error(err?.message ?? 'Failed to start audio overview')
  }
  finally {
    submitting.value = false
  }
}

function handleRequestShare() {
  if (!activeOverview.value) return
  shareTargetOverviewId.value = activeOverview.value._id
  shareOpen.value = true
}

function handleRequestAsk() {
  if (!activeOverview.value) return
  const turn = store.activeTurn.value
  const overviewTitle = activeOverview.value.title
  emit('podcast-ask', {
    overviewId: activeOverview.value._id,
    turnIndex: store.currentTurnIndex.value,
    timeMs: store.currentTimeMs.value,
    quotedText: turn?.text?.slice(0, 120) ?? '',
    sourceFilename: undefined,
  })
}


async function handleCancel(taskId: Id<'tasks'>) {
  if (cancelling.value) return
  cancelling.value = true
  try {
    await cancel(taskId)
  }
  catch (err: any) {
    const { toast } = await import('vue-sonner')
    toast.error(err?.message ?? 'Failed to cancel task')
  }
  finally {
    cancelling.value = false
  }
}

function handleSelectOverview(id: Id<'audioOverviews'>) {
  selectedOverviewId.value = id
}

async function handleDeleteOverview(id: Id<'audioOverviews'>) {
  try {
    await deleteOverviewMutation.mutate({ id } as any)
    if (selectedOverviewId.value === id) selectedOverviewId.value = null
    const { toast } = await import('vue-sonner')
    toast.success('Audio overview deleted')
  }
  catch (err: any) {
    const { toast } = await import('vue-sonner')
    toast.error(err?.message ?? 'Failed to delete audio overview')
  }
}

defineExpose({
  startGeneration: openCustomize,
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-1 flex-col" data-testid="audio-overview-shell">
    <AudioOverviewGenerating
      v-if="activeTask"
      :task-id="activeTask._id"
      :progress="activeTask.progress ?? 'Preparing…'"
      :cancelling="cancelling"
      @cancel="handleCancel"
    />
    <AudioOverviewPlayer
      v-else-if="activeOverview"
      :key="activeOverview._id"
      :overview-id="activeOverview._id"
      :folder-id="props.folderId"
      :overviews="readyOverviews"
      :regenerating="submitting"
      @request-regenerate="openCustomize"
      @request-customize="openCustomize"
      @request-share="handleRequestShare"
      @request-ask="handleRequestAsk"
      @select-overview="handleSelectOverview"
      @delete-overview="handleDeleteOverview"
    />
    <AudioOverviewCard
      v-else
      :indexed-count="indexedCount"
      :generating="submitting"
      @generate="openCustomize"
      @customize="openCustomize"
    />

    <AudioOverviewCustomize
      v-model:open="customizeOpen"
      :initial-length-minutes="customizeDefaults.lengthMinutes"
      :initial-complexity="customizeDefaults.complexity"
      :initial-voice-a="customizeDefaults.voiceA"
      :initial-voice-b="customizeDefaults.voiceB"
      :submitting="submitting"
      :quota-state="quotaState"
      :folder-scope-doc-count="folderScopeDocCount"
      :folder-scope-is-narrowed="hasFolderScope"
      :folder-id="props.folderId"
      :scope="props.scope"
      :submit-label="activeOverview ? 'Generate new' : 'Generate'"
      @submit="handleCustomizeSubmit"
    />

    <AudioOverviewShareDialog
      v-if="shareTargetOverviewId"
      v-model:open="shareOpen"
      :overview-id="shareTargetOverviewId"
      :share-token="shareTarget?.shareToken ?? null"
      :published-at="shareTarget?.publishedAt ?? null"
    />

  </div>
</template>
