<script setup lang="ts">
import { teachingReadFailure, useTeachingQuery, type TeachingReadFailure } from '~/composables/useTeachingQuery'
import { LEARN_MEASUREMENT_CAPABILITIES } from '#shared/learn-v2-measurement-storage-manifest'

import { getErrorMessage } from '~~/shared/errors'
import type { Doc, Id } from '~~/convex/_generated/dataModel'
import { CircleAlert } from '@lucide/vue'
import { api } from '#convex/api'
import { toast } from 'vue-sonner'
import { injectFolderContext } from '~/composables/useFolderPageContext'
import type { CachedSection } from '~/composables/useOfflineCache'
import { createSsrMutationStub } from '~/utils/convexSsrMutation'

const route = useRoute()
const router = useRouter()
const ctx = injectFolderContext()
const { folderId } = ctx

const courseId = computed(() => route.params.courseId as Id<'courses'>)
const sectionId = computed(() => route.params.sectionId as Id<'courseSections'>)

const { isOnline } = useOnlineStatus()
const { cacheSectionContent, getCachedSection, forgetCachedCourse } = useOfflineCache()
const { isSyncing, pendingCount } = useOfflineSync()

const offlineData = ref<CachedSection | null>(null)
const usingOfflineData = ref(false)
const offlineRevoked = ref(false)
const cacheFailure = shallowRef<TeachingReadFailure | null>(null)
watch([courseId, sectionId], () => { cacheFailure.value = null }, { flush: 'sync' })

const courseQuery = import.meta.client
  ? useTeachingQuery(api.courses.get, computed(() => ({ id: courseId.value })))
  : { data: ref(null), failure: computed(() => null), refresh: async () => {} }

const sectionQuery = import.meta.client
  ? useTeachingQuery(api.courseSections.get, computed(() => ({ id: sectionId.value })))
  : { data: ref(null), failure: computed(() => null), refresh: async () => {} }

const sectionsQuery = import.meta.client
  ? useTeachingQuery(api.courseSections.listByCourse, computed(() => ({ courseId: courseId.value })))
  : { data: ref(null), failure: computed(() => null), refresh: async () => {} }

const revokedFailure = computed(() => cacheFailure.value ?? [courseQuery, sectionQuery, sectionsQuery].map(query => query.failure.value).find(failure => failure?.revoked) ?? null)
const enforceTeachingAuthority = LEARN_MEASUREMENT_CAPABILITIES.responses
const authorityCourseId = computed(() => enforceTeachingAuthority ? courseId.value : null)
const authoritySectionId = computed(() => enforceTeachingAuthority ? sectionId.value : null)
let contentGeneration = 0
onScopeDispose(() => { if (enforceTeachingAuthority) contentGeneration++ })
watch([revokedFailure, authorityCourseId, authoritySectionId], ([revoked], previous) => {
  if (!revoked && previous && authorityCourseId.value === previous[1] && authoritySectionId.value === previous[2]) return
  contentGeneration++
  offlineRevoked.value = !!revoked
  offlineData.value = null
  usingOfflineData.value = false
  if (revoked) void forgetCachedCourse(courseId.value).catch(() => {})
}, { immediate: true, flush: 'sync' })
const course = computed(() => courseQuery.data?.value ?? null)
const section = computed(() => sectionQuery.data?.value ?? null)

watch([isOnline, section, authorityCourseId, authoritySectionId, revokedFailure, offlineRevoked], async ([online, sec], _previous, onCleanup) => {
  let cancelled = false
  onCleanup(() => { cancelled = true })
  if (!online && !sec && import.meta.client && !revokedFailure.value && !offlineRevoked.value) {
    const cached = await getCachedSection(sectionId.value)
    if (cached && !revokedFailure.value && (!enforceTeachingAuthority || (!cancelled && cached.sectionId === sectionId.value && cached.courseId === courseId.value))) {
      offlineData.value = cached
      usingOfflineData.value = true
    }
  }
  if (online && sec) {
    usingOfflineData.value = false
  }
}, { immediate: true })

const displayTitle = computed(() => {
  if (usingOfflineData.value && offlineData.value) return offlineData.value.title
  return section.value?.title ?? ''
})

const contentBlocks = computed(() => {
  if (usingOfflineData.value && offlineData.value) {
    return [...offlineData.value.contentBlocks].sort((a, b) => a.order - b.order)
  }
  if (!section.value?.contentBlocks) return []
  return [...section.value.contentBlocks].sort((a, b) => a.order - b.order)
})

const currentBlockIndex = ref(0)
const totalBlocks = computed(() => contentBlocks.value.length)

function handleBlockViewed(index: number) {
  if (index >= currentBlockIndex.value) {
    currentBlockIndex.value = Math.min(index + 1, totalBlocks.value)
  }
}

const sectionOrder = computed(() => section.value?.order ?? null)

usePreFetchSection(courseId, sectionOrder)

const sections = computed(() => (sectionsQuery.data?.value as Doc<'courseSections'>[] | null) ?? [])

const nextSection = computed(() => {
  if (!section.value) return null
  return sections.value.find(s => s.order === section.value!.order + 1) ?? null
})

const isLastSection = computed(() => {
  if (!section.value || !course.value) return false
  return section.value.order === course.value.totalSectionCount - 1
})

const quizResults = ref<{ correct: number; total: number } | null>(null)

function handleQuizCompleted(data: { correct: number; total: number }) {
  quizResults.value = data
}

const showCompletionCard = ref(false)
const completionData = ref<{
  practiceScore: number
  masteryLevel: 'new' | 'learning' | 'reviewing' | 'mastered'
  conceptsForReview: number
  feedbackText: string
} | null>(null)

watch([revokedFailure, authorityCourseId, authoritySectionId], ([revoked], previous) => {
  if (!revoked && previous && authorityCourseId.value === previous[1] && authoritySectionId.value === previous[2]) return
  currentBlockIndex.value = 0
  quizResults.value = null
  showCompletionCard.value = false
  completionData.value = null
}, { flush: 'sync' })

const completeSectionMutation = import.meta.client
  ? useConvexMutation(api.courseSections.completeSection)
  : createSsrMutationStub<typeof api.courseSections.completeSection>()

const setOfflineMutation = import.meta.client
  ? useConvexMutation(api.courseSections.setOfflineAvailable)
  : createSsrMutationStub<typeof api.courseSections.setOfflineAvailable>()

const isCompleting = ref(false)

async function cacheForOffline() {
  if (!import.meta.client || revokedFailure.value) return
  const generation = contentGeneration
  const requestedSectionId = sectionId.value
  const requestedCourseId = courseId.value
  const superseded = () => generation !== contentGeneration || !!revokedFailure.value
  try {
    const payload = await $fetch<Omit<CachedSection, 'cachedAt'>>(`/api/learn/section-cache-payload?sectionId=${requestedSectionId}`)
    if (!payload || superseded() || (enforceTeachingAuthority && (payload.sectionId !== requestedSectionId || payload.courseId !== requestedCourseId))) return

    const audioUrls: string[] = []
    for (const block of payload.contentBlocks) {
      if (block.audioUrls) audioUrls.push(...block.audioUrls)
    }

    await cacheSectionContent(
      payload.sectionId,
      payload.courseId,
      payload.title,
      payload.contentBlocks,
      audioUrls,
    )

    if (superseded()) return
    offlineRevoked.value = false
    await setOfflineMutation.mutate({
      sectionId: enforceTeachingAuthority ? requestedSectionId : sectionId.value,
      offlineAvailable: true,
    })
  } catch (cause) {
    const failure = enforceTeachingAuthority && !superseded() ? teachingReadFailure(cause) : null
    if (failure?.revoked) cacheFailure.value = failure
    // Transport errors leave an otherwise authorized offline copy available.
  }
}

async function handleCompleteSection() {
  if (isCompleting.value || showCompletionCard.value || revokedFailure.value) return
  isCompleting.value = true
  const generation = contentGeneration

  const quiz = quizResults.value
  const score = quiz && quiz.total > 0
    ? Math.round((quiz.correct / quiz.total) * 100)
    : 100

  try {
    const result = await completeSectionMutation.mutate({
      sectionId: sectionId.value,
      practiceScore: score,
      quizCorrect: quiz?.correct ?? 0,
      quizTotal: quiz?.total ?? 0,
    })

    if (generation !== contentGeneration || revokedFailure.value) return
    if (result) {
      completionData.value = {
        practiceScore: result.practiceScore,
        masteryLevel: result.masteryLevel,
        conceptsForReview: result.conceptsForReview,
        feedbackText: result.feedbackText,
      }
    }
    showCompletionCard.value = true

    cacheForOffline()
  } catch (e) {
    if (generation !== contentGeneration || revokedFailure.value) return
    toast.error(getErrorMessage(e, 'Failed to complete section'))
    showCompletionCard.value = true
    completionData.value = {
      practiceScore: score,
      masteryLevel: 'learning',
      conceptsForReview: 0,
      feedbackText: '',
    }
  } finally {
    isCompleting.value = false
  }
}

watch(() => section.value?.status, (status) => {
  if (status === 'completed' && !showCompletionCard.value && completionData.value === null) {
    completionData.value = {
      practiceScore: section.value?.practiceScore ?? 0,
      masteryLevel: section.value?.masteryLevel ?? 'new',
      conceptsForReview: 0,
      feedbackText: '',
    }
    showCompletionCard.value = true
  }
})

function navigateToNextSection() {
  if (nextSection.value) {
    router.push(`/app/folders/${folderId.value}/learn/${courseId.value}/${nextSection.value._id}`)
  }
}

function navigateBack() {
  router.push(`/app/folders/${folderId.value}/learn/${courseId.value}`)
}

const isReady = computed(() => {
  if (usingOfflineData.value) return true
  return section.value && (section.value.status === 'ready' || section.value.status === 'completed')
})

const readFailure = computed(() => revokedFailure.value ?? (usingOfflineData.value ? null : courseQuery.failure.value ?? sectionQuery.failure.value ?? sectionsQuery.failure.value))

function retryRead() {
  const retryCacheDenial = !!cacheFailure.value
  cacheFailure.value = null
  for (const query of [courseQuery, sectionQuery, sectionsQuery]) {
    if (query.failure.value || retryCacheDenial) void query.refresh?.()
  }
}

const isLoading = computed(() => {
  if (usingOfflineData.value) return false
  return !section.value || !course.value
})

const isNotReady = computed(() => {
  if (usingOfflineData.value) return false
  if (!section.value) return false
  return section.value.status !== 'ready' && section.value.status !== 'completed'
})
</script>

<template>
  <div class="flex min-h-0 w-full flex-1 flex-col overflow-y-auto bg-background">
    <div v-if="readFailure" class="mx-auto w-full max-w-3xl px-4 py-8">
      <p v-if="!readFailure.retryable" role="status" data-testid="section-page-read-paused" class="flex items-start gap-2 rounded-lg border border-border px-4 py-3 text-sm leading-6 text-foreground"><CircleAlert class="mt-1 size-4 shrink-0 text-[var(--learn-attention)]" aria-hidden="true" /><span class="min-w-0">{{ readFailure.message }}</span></p>
      <div v-else role="alert" data-testid="section-page-read-error" class="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm leading-6 text-destructive"><p>Could not load this section.</p><button type="button" data-testid="section-page-read-retry" class="mt-2 font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" @click="retryRead">Try again</button></div>
    </div>

    <div v-else-if="isLoading" class="flex flex-1 items-center justify-center">
      <div class="space-y-3 text-center">
        <div class="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p class="text-sm text-muted-foreground">Loading section...</p>
      </div>
    </div>

    <template v-else-if="isNotReady">
      <div class="flex flex-1 flex-col items-center justify-center gap-4 px-4">
        <div class="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p class="text-sm text-muted-foreground">
          {{ section?.status === 'generating' ? 'Generating section content...' : 'Section not available' }}
        </p>
        <button
          type="button"
          class="text-sm text-primary hover:text-primary/80"
          @click="navigateBack"
        >
          Back to Void
        </button>
      </div>
    </template>

    <template v-else-if="isReady">
      <LearnSectionVoidTopBar
        :course-title="course?.title ?? ''"
        :section-title="displayTitle"
        :current-block="currentBlockIndex"
        :total-blocks="totalBlocks"
        @back="navigateBack"
      />

      <div v-if="usingOfflineData" class="mx-auto w-full max-w-3xl px-4 pt-4">
        <div class="rounded-lg bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-200">
          Viewing cached offline version
        </div>
      </div>

      <div v-if="isSyncing && pendingCount > 0" class="mx-auto w-full max-w-3xl px-4 pt-2">
        <div class="rounded-lg bg-primary/10 px-4 py-2 text-xs text-primary">
          Syncing {{ pendingCount }} offline attempt{{ pendingCount !== 1 ? 's' : '' }}...
        </div>
      </div>

      <div v-if="section?.failureNotice && !usingOfflineData" class="mx-auto w-full max-w-3xl px-4 pt-4">
        <div class="rounded-lg bg-primary/10 px-4 py-3 text-sm text-primary">
          {{ section.failureNotice }}
        </div>
      </div>

      <main class="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <template v-if="showCompletionCard && completionData">
          <LearnSectionCompletionCard
            :practice-score="completionData.practiceScore"
            :mastery-level="completionData.masteryLevel"
            :concepts-for-review="completionData.conceptsForReview"
            :feedback-text="completionData.feedbackText"
            :has-next-section="!!nextSection"
            :is-last-section="isLastSection"
            :next-section-ready="!!nextSection && (nextSection.status === 'ready' || nextSection.status === 'completed')"
            :next-section-generating="!!nextSection && nextSection.status === 'generating'"
            @continue-to-next="navigateToNextSection"
            @back-to-course="navigateBack"
          />
        </template>

        <template v-else>
          <LearnSectionBlockRenderer
            :content-blocks="contentBlocks"
            :course-id="courseId"
            :is-offline="usingOfflineData"
            :section-id="sectionId"
            @block-viewed="handleBlockViewed"
            @quiz-completed="handleQuizCompleted"
          />

          <div v-if="!usingOfflineData" class="mt-8 flex justify-center pb-8">
            <button
              type="button"
              class="rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="isCompleting"
              data-testid="complete-section-button"
              @click="handleCompleteSection"
            >
              {{ isCompleting ? 'Completing...' : 'Complete Section' }}
            </button>
          </div>
        </template>
      </main>
    </template>
  </div>
</template>
