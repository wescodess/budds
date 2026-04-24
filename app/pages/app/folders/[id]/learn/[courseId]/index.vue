<script setup lang="ts">
import type { Id } from '~~/convex/_generated/dataModel'
import { api } from '#convex/api'
import { injectFolderContext } from '~/composables/useFolderPageContext'

const route = useRoute()
const router = useRouter()
const ctx = injectFolderContext()
const { folderId } = ctx

const courseId = computed(() => route.params.courseId as Id<'courses'>)

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

function handleDeleted() {
  router.push(`/app/folders/${folderId.value}/learn/`)
}
</script>

<template>
  <div class="h-full overflow-y-auto bg-background">
    <LearnCourseViewBody
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
