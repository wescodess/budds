<script setup lang="ts">
import { ref, computed } from 'vue'
import { api } from '#convex/api'
import type { Id } from '../../../convex/_generated/dataModel'
import AudioOverviewCard from './AudioOverviewCard.vue'
import AudioOverviewGenerating from './AudioOverviewGenerating.vue'
import AudioOverviewPlayer from './AudioOverviewPlayer.vue'
import AudioOverviewCustomize from './AudioOverviewCustomize.vue'
import type {
  CustomizeSubmit,
  LengthMinutes,
  Complexity,
  HostVoice,
} from './customize-types'

const props = defineProps<{
  folderId: Id<'folders'>
}>()

const emit = defineEmits<{
  'generation-started': []
}>()

const folderRef = computed(() => props.folderId)
const { tasks, cancel } = useTasks(folderRef)
const { documents } = useDocuments(folderRef)

const indexedCount = computed(() =>
  (documents.value ?? []).filter(doc => doc.status === 'success').length,
)

type OverviewSummary = {
  _id: Id<'audioOverviews'>
  _creationTime: number
  title: string
  status: string
  turnCount: number
  totalDurationMs: number
  taskId?: Id<'tasks'>
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

    emit('generation-started')

    $fetch('/api/audio-overview/generate', {
      method: 'POST',
      body: {
        folderId: props.folderId,
        taskId: result.taskId,
        preferences: { lengthMinutes: value.lengthMinutes, complexity: value.complexity },
        voiceProfile: { hostA: value.voiceProfile.hostA, hostB: value.voiceProfile.hostB },
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
      :submit-label="activeOverview ? 'Generate new' : 'Generate'"
      @submit="handleCustomizeSubmit"
    />
  </div>
</template>
