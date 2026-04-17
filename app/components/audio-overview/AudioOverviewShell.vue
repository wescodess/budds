<script setup lang="ts">
import { api } from '#convex/api'
import type { Id } from '../../../convex/_generated/dataModel'
import AudioOverviewCard from './AudioOverviewCard.vue'
import AudioOverviewGenerating from './AudioOverviewGenerating.vue'
import AudioOverviewPlayer from './AudioOverviewPlayer.vue'

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

const { data: overviewsData } = useConvexQuery(
  api.audioOverviews.listByFolder,
  computed(() => ({ folderId: props.folderId })),
)
const overviews = computed(() => (overviewsData.value as Array<{ _id: Id<'audioOverviews'>; status: string; title: string; _creationTime: number }> | null | undefined) ?? [])

const activeTask = computed(() => {
  const candidates = tasks.value.filter(t =>
    t.type === 'audio-overview-generation'
    && (t.status === 'pending' || t.status === 'running'),
  )
  if (candidates.length === 0) return null
  return [...candidates].sort((a, b) => b._creationTime - a._creationTime)[0] ?? null
})

const readyOverview = computed(() => overviews.value.find(o => o.status === 'ready') ?? null)

const createTaskMutation = import.meta.client
  ? useConvexMutation(api.tasks.create)
  : { mutate: async () => ({ taskId: '' }), isLoading: ref(false) } as any

const submitting = ref(false)
const cancelling = ref(false)

async function handleGenerate() {
  if (submitting.value) return
  submitting.value = true
  try {
    const result = (await createTaskMutation.mutate({
      folderId: props.folderId,
      type: 'audio-overview-generation',
      title: 'Generating audio overview…',
      metadata: { lengthMinutes: 10, complexity: 'beginner' },
    } as any)) as { taskId: Id<'tasks'> }

    emit('generation-started')

    $fetch('/api/audio-overview/generate', {
      method: 'POST',
      body: {
        folderId: props.folderId,
        taskId: result.taskId,
        preferences: { lengthMinutes: 10, complexity: 'beginner' as const },
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

defineExpose({
  startGeneration: handleGenerate,
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
      v-else-if="readyOverview"
      :overview-id="readyOverview._id"
      :folder-id="props.folderId"
      :regenerating="submitting"
      @request-regenerate="handleGenerate"
    />
    <AudioOverviewCard
      v-else
      :indexed-count="indexedCount"
      :generating="submitting"
      @generate="handleGenerate"
    />
  </div>
</template>
