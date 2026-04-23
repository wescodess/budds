<script setup lang="ts">
import type { Id } from '~~/convex/_generated/dataModel'
import { api } from '#convex/api'
import { injectFolderContext } from '~/composables/useFolderPageContext'

const route = useRoute()
const router = useRouter()
const ctx = injectFolderContext()
const { folderId, helperPane } = ctx

const courseId = computed(() => route.params.courseId as Id<'courses'>)
const sectionId = computed(() => route.params.sectionId as Id<'courseSections'>)

const courseQuery = import.meta.client
  ? useConvexQuery(api.courses.get, computed(() => ({ id: courseId.value })))
  : { data: ref(null) }

const sectionQuery = import.meta.client
  ? useConvexQuery(api.courseSections.get, computed(() => ({ id: sectionId.value })))
  : { data: ref(null) }

const course = computed(() => courseQuery.data?.value ?? null)
const section = computed(() => sectionQuery.data?.value ?? null)

const contentBlocks = computed(() => {
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

const sectionsQuery = import.meta.client
  ? useConvexQuery(api.courseSections.listByCourse, computed(() => ({ courseId: courseId.value })))
  : { data: ref(null) }

const sections = computed(() => (sectionsQuery.data?.value as any[]) ?? [])

const nextSection = computed(() => {
  if (!section.value) return null
  return sections.value.find((s: any) => s.order === section.value!.order + 1) ?? null
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

const completeSectionMutation = import.meta.client
  ? useConvexMutation(api.courseSections.completeSection)
  : { mutate: async () => null }

const isCompleting = ref(false)

async function handleCompleteSection() {
  if (isCompleting.value || showCompletionCard.value) return
  isCompleting.value = true

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

    if (result) {
      completionData.value = {
        practiceScore: result.practiceScore,
        masteryLevel: result.masteryLevel,
        conceptsForReview: result.conceptsForReview,
        feedbackText: result.feedbackText,
      }
    }
    showCompletionCard.value = true
  } catch {
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

function onGenerationStarted() {
  helperPane.open('tasks')
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col overflow-y-auto bg-background">
    <div v-if="!section || !course" class="flex flex-1 items-center justify-center">
      <div class="space-y-3 text-center">
        <div class="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p class="text-sm text-muted-foreground">Loading section...</p>
      </div>
    </div>

    <template v-else-if="section.status !== 'ready' && section.status !== 'completed'">
      <div class="flex flex-1 flex-col items-center justify-center gap-4 px-4">
        <div class="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p class="text-sm text-muted-foreground">
          {{ section.status === 'generating' ? 'Generating section content...' : 'Section not available' }}
        </p>
        <button
          type="button"
          class="text-sm text-primary hover:text-primary/80"
          @click="navigateBack"
        >
          Back to course
        </button>
      </div>
    </template>

    <template v-else>
      <LearnSectionVoidTopBar
        :course-title="course.title"
        :section-title="section.title"
        :current-block="currentBlockIndex"
        :total-blocks="totalBlocks"
        @back="navigateBack"
      />

      <div v-if="section.failureNotice" class="mx-auto w-full max-w-3xl px-4 pt-4">
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
            @block-viewed="handleBlockViewed"
            @quiz-completed="handleQuizCompleted"
          />

          <div class="mt-8 flex justify-center pb-8">
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
