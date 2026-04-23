<script setup lang="ts">
import type { Id } from '../../../../convex/_generated/dataModel'
import { api } from '#convex/api'

const route = useRoute()
const router = useRouter()
const courseId = computed(() => route.params.courseId as Id<'courses'>)

const courseQuery = import.meta.client
  ? useConvexQuery(api.courses.get, computed(() => ({ id: courseId.value })))
  : { data: ref(null) }

const course = computed(() => courseQuery.data?.value ?? null)

function handleDeleted() {
  router.push('/app/learn/')
}
</script>

<template>
  <div class="flex min-h-screen flex-col items-center justify-center bg-stone-950 px-4">
    <div class="w-full max-w-lg text-center">
      <h1 class="mb-2 text-2xl font-bold text-stone-100">
        {{ course?.title ?? 'Loading...' }}
      </h1>
      <p class="mb-6 text-sm text-stone-400">Course view coming soon</p>
      <div class="flex items-center justify-center gap-4">
        <NuxtLink
          to="/app/learn/"
          class="text-sm text-amber-500 hover:text-amber-400"
        >
          &larr; Back to Learn
        </NuxtLink>
        <LearnDeleteCourseDialog
          v-if="course"
          :course-id="courseId"
          :course-title="course.title"
          @deleted="handleDeleted"
        />
      </div>
    </div>
  </div>
</template>
