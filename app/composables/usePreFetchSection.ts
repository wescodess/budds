import { getErrorMessage } from '~~/shared/errors'
import { CONVEX_INJECTION_KEY } from '@convex-vue/core'
import { api } from '#convex/api'
import type { Id } from '../../convex/_generated/dataModel'
import { createSsrMutationStub } from '~/utils/convexSsrMutation'

type PreFetchStatus = {
  nextSection: { _id: string; status: string }
  needsPreFetch: boolean
  taskStatus: string | null
} | null

export function usePreFetchSection(
  courseId: Ref<Id<'courses'> | null>,
  currentSectionOrder: Ref<number | null>,
) {
  const isPreFetching = ref(false)
  const hasTriggered = ref(false)
  const preFetchKey = ref('')
  const preFetchStatus = ref<PreFetchStatus>(null)

  let unsubStatus: (() => void) | null = null

  if (import.meta.client) {
    const client = inject(CONVEX_INJECTION_KEY)

    watch(
      [courseId, currentSectionOrder],
      ([cid, order]) => {
        unsubStatus?.()
        unsubStatus = null
        preFetchStatus.value = null
        if (!cid || order === null || !client) return

        unsubStatus = client.onUpdate(
          api.courseSections.checkPreFetchStatus,
          { courseId: cid, currentOrder: order },
          (result) => {
            if (result !== undefined) preFetchStatus.value = result
          },
        )
      },
      { immediate: true },
    )

    onScopeDispose(() => unsubStatus?.())
  }

  const nextSectionReady = computed(() => {
    const status = preFetchStatus.value as {
      nextSection: { _id: string; status: string }
      needsPreFetch: boolean
      taskStatus: string | null
    } | null
    if (!status?.nextSection) return false
    return status.nextSection.status === 'ready' || status.nextSection.status === 'completed'
  })

  const triggerMutation = import.meta.client
    ? useConvexMutation(api.courseSections.triggerPreFetch)
    : createSsrMutationStub<typeof api.courseSections.triggerPreFetch>()

  watch(
    () => {
      const key = `${courseId.value ?? ''}-${currentSectionOrder.value ?? ''}`
      return key
    },
    (newKey) => {
      if (newKey !== preFetchKey.value) {
        preFetchKey.value = newKey
        hasTriggered.value = false
      }
    },
    { immediate: true },
  )

  watch(
    preFetchStatus,
    async (status) => {
      if (!import.meta.client) return
      if (hasTriggered.value || isPreFetching.value) return
      if (!courseId.value || currentSectionOrder.value === null) return

      const data = status as {
        nextSection: { _id: string; status: string }
        needsPreFetch: boolean
        taskStatus: string | null
      } | null

      if (!data?.needsPreFetch) return

      hasTriggered.value = true
      isPreFetching.value = true

      try {
        const result = await triggerMutation.mutate({
          courseId: courseId.value,
          currentOrder: currentSectionOrder.value,
        })

        if (result?.sectionId && result?.taskId) {
          $fetch('/api/course/generate-section', {
            method: 'POST',
            body: {
              courseId: courseId.value,
              sectionId: result.sectionId,
              taskId: result.taskId,
            },
          }).catch((err: unknown) => {
            console.error('[usePreFetchSection] Generation failed:', getErrorMessage(err, 'Unknown error'))
          })
        }
      } catch (err) {
        console.error('[usePreFetchSection] Pre-fetch trigger failed:', getErrorMessage(err, 'Unknown error'))
      } finally {
        isPreFetching.value = false
      }
    },
    { immediate: true },
  )

  return {
    nextSectionReady,
    isPreFetching: readonly(isPreFetching),
  }
}
