<script setup lang="ts">
import type { Id } from '../../../../../convex/_generated/dataModel'
import { api } from '#convex/api'

const route = useRoute()
const router = useRouter()

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

function navigateToNextSection() {
  if (nextSection.value) {
    router.push(`/app/learn/${courseId.value}/${nextSection.value._id}`)
  }
}

function navigateBack() {
  router.push(`/app/learn/${courseId.value}`)
}
</script>

<template>
  <div class="flex min-h-screen flex-col bg-stone-950">
    <div v-if="!section || !course" class="flex flex-1 items-center justify-center">
      <div class="space-y-3 text-center">
        <div class="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
        <p class="text-sm text-stone-400">Loading section...</p>
      </div>
    </div>

    <template v-else-if="section.status !== 'ready' && section.status !== 'completed'">
      <div class="flex flex-1 flex-col items-center justify-center gap-4 px-4">
        <div class="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
        <p class="text-sm text-stone-400">
          {{ section.status === 'generating' ? 'Generating section content...' : 'Section not available' }}
        </p>
        <button
          type="button"
          class="text-sm text-amber-500 hover:text-amber-400"
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
        <div class="rounded-lg bg-amber-500/10 px-4 py-3 text-sm text-amber-400">
          {{ section.failureNotice }}
        </div>
      </div>

      <main class="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <LearnSectionBlockRenderer
          :content-blocks="contentBlocks"
          :course-id="courseId"
          @block-viewed="handleBlockViewed"
        />

        <div class="mt-8 flex justify-center pb-8">
          <button
            v-if="nextSection && (nextSection.status === 'ready' || nextSection.status === 'completed')"
            type="button"
            class="rounded-lg bg-amber-500 px-6 py-3 text-sm font-medium text-stone-950 transition-colors hover:bg-amber-400"
            @click="navigateToNextSection"
          >
            Next Section
          </button>
          <div
            v-else-if="nextSection && nextSection.status === 'generating'"
            class="flex items-center gap-2 rounded-lg bg-stone-900 px-6 py-3 text-sm text-stone-400"
          >
            <div class="h-4 w-4 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
            Preparing next section...
          </div>
          <button
            v-else-if="!nextSection"
            type="button"
            class="rounded-lg border border-stone-700 bg-stone-900 px-6 py-3 text-sm font-medium text-stone-200 transition-colors hover:border-stone-600"
            @click="navigateBack"
          >
            Back to Course
          </button>
        </div>
      </main>
    </template>
  </div>
</template>
