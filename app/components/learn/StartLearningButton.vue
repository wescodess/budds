<script setup lang="ts">
import { getErrorMessage } from '~~/shared/errors'
import type { Id } from '../../../convex/_generated/dataModel'
import { api } from '#convex/api'
import { toast } from 'vue-sonner'
import { createSsrMutationStub } from '~/utils/convexSsrMutation'

const props = defineProps<{
  courseId: Id<'courses'>
  folderId?: Id<'folders'>
}>()

const startCourseMutation = import.meta.client
  ? useConvexMutation(api.courses.startCourse)
  : createSsrMutationStub<typeof api.courses.startCourse>()

const loading = ref(false)

async function handleStart() {
  if (loading.value) return
  loading.value = true
  try {
    const result = await startCourseMutation.mutate({ courseId: props.courseId })
    const res = result as unknown as { courseId: string; sectionId: string; taskId: string } | string
    const courseId = typeof res === 'string' ? res : res?.courseId

    if (courseId) {
      if (typeof res === 'object' && res.sectionId && res.taskId) {
        $fetch('/api/course/generate-section', {
          method: 'POST',
          body: {
            courseId: props.courseId,
            sectionId: res.sectionId,
            taskId: res.taskId,
          },
        }).catch((err: unknown) => {
          console.error('[StartLearningButton] Section generation failed:', getErrorMessage(err, 'Unknown error'))
        })
      }

      const target = props.folderId
        ? `/app/folders/${props.folderId}/learn/${courseId}`
        : `/app/learn/${courseId}`
      await navigateTo(target)
    }
  } catch (e) {
    toast.error(getErrorMessage(e, 'Failed to start course'))
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <button
    class="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
    :disabled="loading"
    data-testid="start-learning-button"
    @click="handleStart"
  >
    <template v-if="loading">
      <svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      Starting...
    </template>
    <template v-else>
      Start Learning
      <span aria-hidden="true">&rarr;</span>
    </template>
  </button>
</template>
