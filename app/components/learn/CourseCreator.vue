<script setup lang="ts">
import { getErrorMessage } from '~~/shared/errors'
import type { Doc, Id } from '../../../convex/_generated/dataModel'
import { CONVEX_INJECTION_KEY } from '@convex-vue/core'
import { api } from '#convex/api'
import { toast } from 'vue-sonner'
import { createSsrMutationStub } from '~/utils/convexSsrMutation'

type Step = 'source-selection' | 'generating' | 'outline-editor' | 'error'

const props = defineProps<{
  folderId: Id<'folders'>
  existingCourseId?: Id<'courses'>
}>()

const step = ref<Step>(props.existingCourseId ? 'generating' : 'source-selection')
const courseId = ref<Id<'courses'> | null>(props.existingCourseId ?? null)
const skeletonWidths = [85, 72, 90, 65, 78, 95, 70, 88]

const createMutation = import.meta.client
  ? useConvexMutation(api.courses.create)
  : createSsrMutationStub<typeof api.courses.create>()

const submitting = ref(false)

const course = ref<Doc<'courses'> | null>(null)
const sections = ref<Doc<'courseSections'>[]>([])

let unsubCourse: (() => void) | null = null
let unsubSections: (() => void) | null = null

if (import.meta.client) {
  const client = inject(CONVEX_INJECTION_KEY)

  watch(courseId, (id) => {
    unsubCourse?.()
    unsubSections?.()
    unsubCourse = null
    unsubSections = null
    if (!id || !client) return

    unsubCourse = client.onUpdate(api.courses.get, { id }, (result) => {
      if (result !== undefined) course.value = result
    })
    unsubSections = client.onUpdate(api.courseSections.listByCourse, { courseId: id }, (result) => {
      if (result !== undefined) sections.value = result
    })
  }, { immediate: true })

  onScopeDispose(() => {
    unsubCourse?.()
    unsubSections?.()
  })
}

watch(course, (c) => {
  if (!c) return
  if (c.status === 'ready' && (step.value === 'generating' || step.value === 'source-selection')) {
    step.value = 'outline-editor'
  } else if (c.status === 'failed') {
    step.value = 'error'
  }
})

async function onSourceSubmit(payload: {
  title: string
  sourceType: 'folder' | 'web-only'
  folderId: Id<'folders'>
  documentIds: Id<'documents'>[]
  webSearchEnabled: boolean
}) {
  submitting.value = true
  try {
    const result = await createMutation.mutate({
      title: payload.title,
      sourceType: payload.sourceType,
      folderId: payload.folderId,
      documentIds: payload.documentIds.length > 0 ? payload.documentIds : undefined,
      webSearchEnabled: payload.webSearchEnabled,
    })

    if (result?.courseId) {
      courseId.value = result.courseId
      step.value = 'generating'

      $fetch('/api/course/generate-outline', {
        method: 'POST',
        body: { courseId: result.courseId, taskId: result.taskId },
      }).catch(() => {
        step.value = 'error'
      })
    }
  } catch (e) {
    toast.error(getErrorMessage(e, 'Failed to create course'))
    step.value = 'error'
  } finally {
    submitting.value = false
  }
}

function handleTryAgain() {
  step.value = 'source-selection'
  courseId.value = null
  course.value = null
  sections.value = []
}
</script>

<template>
  <div data-testid="course-creator">
    <LearnSourceSelector
      v-if="step === 'source-selection'"
      :folder-id="folderId"
      :loading="submitting"
      @submit="onSourceSubmit"
    />

    <div
      v-else-if="step === 'generating'"
      class="mx-auto w-full max-w-2xl px-4 py-6"
      data-testid="generating-skeleton"
    >
      <p class="mb-6 text-sm text-muted-foreground">Analyzing your materials...</p>
      <div class="space-y-3">
        <div
          v-for="(w, i) in skeletonWidths"
          :key="i"
          class="h-10 animate-pulse rounded-lg bg-muted"
          :style="{ width: `${w}%` }"
        />
      </div>
    </div>

    <div
      v-else-if="step === 'error'"
      class="mx-auto w-full max-w-2xl px-4 py-6 text-center"
      data-testid="error-state"
    >
      <p class="mb-4 text-muted-foreground">We couldn't generate an outline. Please try again.</p>
      <button
        class="inline-flex items-center gap-2 rounded-lg border border-border px-5 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
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
        <LearnStartLearningButton :course-id="courseId" :folder-id="folderId" />
      </div>
    </template>
  </div>
</template>
