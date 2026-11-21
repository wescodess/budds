<script setup lang="ts">
import { useTeachingQuery } from '~/composables/useTeachingQuery'

import type { Doc, Id } from '~~/convex/_generated/dataModel'
import { CircleAlert } from '@lucide/vue'
import { api } from '#convex/api'
import { injectFolderContext } from '~/composables/useFolderPageContext'

const route = useRoute()
const router = useRouter()
const ctx = injectFolderContext()
const { folderId } = ctx

const courseId = computed(() => route.params.courseId as Id<'courses'>)

const courseQuery = import.meta.client
  ? useTeachingQuery(api.courses.get, computed(() => ({ id: courseId.value })))
  : { data: ref(null), failure: computed(() => null), refresh: async () => {} }

const sectionsQuery = import.meta.client
  ? useTeachingQuery(api.courseSections.listByCourse, computed(() => ({ courseId: courseId.value })))
  : { data: ref(null), failure: computed(() => null), refresh: async () => {} }

const course = computed(() => courseQuery.data?.value ?? null)
const sections = computed(() => (sectionsQuery.data?.value as Doc<'courseSections'>[] | null) ?? [])

const readFailure = computed(() => courseQuery.failure.value ?? sectionsQuery.failure.value)

function retryRead() {
  for (const query of [courseQuery, sectionsQuery]) {
    if (query.failure.value) void query.refresh?.()
  }
}

const needsStart = computed(() =>
  course.value?.status === 'ready'
  && sections.value.length > 0
  && sections.value.every(s => s.status === 'locked'),
)

const backUrl = computed(() => `/app/folders/${folderId.value}/learn/`)
const sectionUrlPrefix = computed(() => `/app/folders/${folderId.value}/learn/${courseId.value}`)

function handleDeleted() {
  router.push(`/app/folders/${folderId.value}/learn/`)
}
</script>

<template>
  <div class="h-full w-full overflow-y-auto bg-background">
    <div v-if="readFailure" class="mx-auto max-w-3xl px-4 py-8">
      <p v-if="!readFailure.retryable" role="status" data-testid="course-view-read-paused" class="flex items-start gap-2 rounded-lg border border-border px-4 py-3 text-sm leading-6 text-foreground"><CircleAlert class="mt-1 size-4 shrink-0 text-[var(--learn-attention)]" aria-hidden="true" /><span class="min-w-0">{{ readFailure.message }}</span></p>
      <div v-else role="alert" data-testid="course-view-read-error" class="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm leading-6 text-destructive"><p>Could not load this Void.</p><button type="button" data-testid="course-view-read-retry" class="mt-2 font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" @click="retryRead">Try again</button></div>
    </div>
    <LearnCourseViewBody
      v-else
      :course="course"
      :sections="sections"
      :course-id="courseId"
      :folder-id="folderId"
      :back-url="backUrl"
      back-label="Back to folder courses"
      :section-url-prefix="sectionUrlPrefix"
      :needs-start="needsStart"
      @deleted="handleDeleted"
    />
  </div>
</template>
