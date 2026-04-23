<script setup lang="ts">
import type { Id } from '~~/convex/_generated/dataModel'
import { api } from '#convex/api'

const route = useRoute()
const router = useRouter()
const courseId = computed(() => route.params.courseId as Id<'courses'>)
const folderId = computed(() => route.params.id as string)

const courseQuery = import.meta.client
  ? useConvexQuery(api.courses.get, computed(() => ({ id: courseId.value })))
  : { data: ref(null) }

const sectionsQuery = import.meta.client
  ? useConvexQuery(api.courseSections.listByCourse, computed(() => ({ courseId: courseId.value })))
  : { data: ref(null) }

const course = computed(() => courseQuery.data?.value ?? null)
const sections = computed(() => (sectionsQuery.data?.value as any[]) ?? [])

const needsStart = computed(() =>
  course.value?.status === 'ready'
  && sections.value.length > 0
  && sections.value.every((s: any) => s.status === 'locked'),
)

const backUrl = computed(() => `/app/folders/${folderId.value}/learn/`)
const sectionUrlPrefix = computed(() => `/app/folders/${folderId.value}/learn/${courseId.value}`)
const editOutlineUrl = computed(() => `/app/learn/create?courseId=${courseId.value}&folderId=${folderId.value}`)

function handleDeleted() {
  router.push(`/app/folders/${folderId.value}/learn/`)
}
</script>

<template>
  <div class="min-h-screen bg-stone-950">
    <LearnCourseViewBody
      :course="course"
      :sections="sections"
      :course-id="courseId"
      :back-url="backUrl"
      back-label="Back to folder courses"
      :section-url-prefix="sectionUrlPrefix"
      :edit-outline-url="editOutlineUrl"
      :needs-start="needsStart"
      @deleted="handleDeleted"
    />
  </div>
</template>
