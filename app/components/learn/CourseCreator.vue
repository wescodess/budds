<script setup lang="ts">
import type { Id } from '../../../convex/_generated/dataModel'
import { api } from '#convex/api'
import { toast } from 'vue-sonner'

type Step = 'source-selection' | 'generating' | 'outline-editor' | 'error'

const props = defineProps<{
  initialFolderId?: string
}>()

const step = ref<Step>('source-selection')
const courseId = ref<Id<'courses'> | null>(null)
const skeletonWidths = [85, 72, 90, 65, 78, 95, 70, 88]

const ssrStub = {
  mutate: async () => { throw new Error('Mutations are client-only') },
  isLoading: ref(false),
} as { mutate: (_args: any) => Promise<any>; isLoading: Ref<boolean> }

const createMutation = import.meta.client
  ? useConvexMutation(api.courses.create)
  : ssrStub

const submitting = ref(false)

const courseQueryRef = ref<any>(null)
const sectionsQueryRef = ref<any>(null)

const course = computed(() => courseQueryRef.value?.data?.value ?? null)
const sections = computed(() => sectionsQueryRef.value?.data?.value ?? [])

watch(course, (c) => {
  if (!c || step.value !== 'generating') return
  if (c.status === 'ready') step.value = 'outline-editor'
  else if (c.status === 'failed') step.value = 'error'
})

async function onSourceSubmit(payload: {
  title: string
  sourceType: 'folder' | 'cross-folder' | 'web-only'
  folderIds: Id<'folders'>[]
  documentIds: Id<'documents'>[]
  webSearchEnabled: boolean
}) {
  submitting.value = true
  try {
    const folderId = payload.folderIds.length > 0 ? payload.folderIds[0] : undefined

    const result = await createMutation.mutate({
      title: payload.title,
      sourceType: payload.sourceType,
      folderId,
      documentIds: payload.documentIds.length > 0 ? payload.documentIds : undefined,
      webSearchEnabled: payload.webSearchEnabled,
    } as any)

    if (result && (result as any).courseId) {
      courseId.value = (result as any).courseId
      step.value = 'generating'

      if (import.meta.client) {
        courseQueryRef.value = useConvexQuery(api.courses.get, computed(() =>
          courseId.value ? { id: courseId.value } : 'skip',
        ))
        sectionsQueryRef.value = useConvexQuery(api.courseSections.listByCourse, computed(() =>
          courseId.value ? { courseId: courseId.value } : 'skip',
        ))
      }
    }
  } catch (e: any) {
    toast.error(e?.message ?? 'Failed to create course')
    step.value = 'error'
  } finally {
    submitting.value = false
  }
}

function handleTryAgain() {
  step.value = 'source-selection'
  courseId.value = null
  courseQueryRef.value = null
  sectionsQueryRef.value = null
}
</script>

<template>
  <div data-testid="course-creator">
    <LearnSourceSelector
      v-if="step === 'source-selection'"
      :initial-folder-id="initialFolderId"
      :loading="submitting"
      @submit="onSourceSubmit"
    />

    <div
      v-else-if="step === 'generating'"
      class="mx-auto w-full max-w-2xl px-4 py-6"
      data-testid="generating-skeleton"
    >
      <p class="mb-6 text-sm text-stone-400">Analyzing your materials...</p>
      <div class="space-y-3">
        <div
          v-for="(w, i) in skeletonWidths"
          :key="i"
          class="h-10 animate-pulse rounded-lg bg-stone-800"
          :style="{ width: `${w}%` }"
        />
      </div>
    </div>

    <div
      v-else-if="step === 'error'"
      class="mx-auto w-full max-w-2xl px-4 py-6 text-center"
      data-testid="error-state"
    >
      <p class="mb-4 text-stone-300">We couldn't generate an outline. Please try again.</p>
      <button
        class="inline-flex items-center gap-2 rounded-lg border border-stone-600 px-5 py-2 text-sm font-medium text-stone-200 transition-colors hover:border-stone-500 hover:bg-stone-800"
        data-testid="try-again-button"
        @click="handleTryAgain"
      >
        Try Again
      </button>
    </div>

    <template v-else-if="step === 'outline-editor' && course && courseId">
      <LearnOutlineEditor
        :course-id="courseId"
        :outline-sections="course.outlineSections ?? []"
        :source-confidence="course.sourceConfidence ?? { docCount: 0, webPercent: 0 }"
        :source-type="course.sourceType ?? 'web-only'"
        :sections="sections"
      />
      <div class="mx-auto w-full max-w-2xl space-y-4 px-4 pb-8">
        <LearnPaceSelector
          :course-id="courseId"
          :current-pace="course.pace ?? 'steady'"
        />
        <LearnStartLearningButton :course-id="courseId" />
      </div>
    </template>
  </div>
</template>
