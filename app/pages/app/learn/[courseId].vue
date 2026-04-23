<script setup lang="ts">
import { ArrowLeft, Lock, Loader2, AlertCircle, CheckCircle2, ChevronRight } from 'lucide-vue-next'
import type { Id } from '../../../../convex/_generated/dataModel'
import { api } from '#convex/api'

const route = useRoute()
const router = useRouter()
const courseId = computed(() => route.params.courseId as Id<'courses'>)

const courseQuery = import.meta.client
  ? useConvexQuery(api.courses.get, computed(() => ({ id: courseId.value })))
  : { data: ref(null) }

const sectionsQuery = import.meta.client
  ? useConvexQuery(api.courseSections.listByCourse, computed(() => ({ courseId: courseId.value })))
  : { data: ref(null) }

const course = computed(() => courseQuery.data?.value ?? null)
const sections = computed(() => (sectionsQuery.data?.value as any[]) ?? [])

const progress = computed(() => {
  if (!course.value?.totalSectionCount) return 0
  return Math.round(((course.value.completedSectionCount ?? 0) / course.value.totalSectionCount) * 100)
})

const statusConfig = {
  completed: { icon: CheckCircle2, class: 'text-green-400', label: 'Completed' },
  ready: { icon: ChevronRight, class: 'text-amber-400', label: 'Ready' },
  generating: { icon: Loader2, class: 'text-amber-500 animate-spin', label: 'Generating' },
  failed: { icon: AlertCircle, class: 'text-red-400', label: 'Failed' },
  locked: { icon: Lock, class: 'text-stone-600', label: 'Locked' },
} as const

function getSectionStatus(status: string) {
  return statusConfig[status as keyof typeof statusConfig] ?? statusConfig.locked
}

function canNavigate(status: string) {
  return status === 'ready' || status === 'completed'
}

function handleDeleted() {
  router.push('/app/learn/')
}
</script>

<template>
  <div class="min-h-screen bg-stone-950">
    <div class="mx-auto max-w-2xl px-4 py-8">
      <NuxtLink
        to="/app/learn/"
        class="mb-6 inline-flex items-center gap-1.5 text-sm text-stone-400 transition-colors hover:text-stone-200"
      >
        <ArrowLeft class="h-4 w-4" />
        Back to Learn
      </NuxtLink>

      <div v-if="!course" class="py-16 text-center">
        <div class="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
        <p class="mt-3 text-sm text-stone-400">Loading course...</p>
      </div>

      <template v-else>
        <div class="mb-8">
          <h1 class="mb-2 text-2xl font-bold text-stone-100">{{ course.title }}</h1>
          <div class="flex items-center gap-4">
            <span class="text-sm text-stone-400">
              {{ course.completedSectionCount ?? 0 }}/{{ course.totalSectionCount }} sections
            </span>
            <span class="text-sm text-stone-500">{{ progress }}% complete</span>
          </div>
          <div class="mt-3 h-1.5 overflow-hidden rounded-full bg-stone-800">
            <div
              class="h-full rounded-full bg-amber-500 transition-all"
              :style="{ width: `${progress}%` }"
              role="progressbar"
              :aria-valuenow="progress"
              aria-valuemin="0"
              aria-valuemax="100"
              :aria-label="`Course progress: ${progress}%`"
            />
          </div>
        </div>

        <div class="space-y-2" role="list" aria-label="Course sections">
          <component
            :is="canNavigate(section.status) ? 'NuxtLink' : 'div'"
            v-for="section in sections"
            :key="section._id"
            :to="canNavigate(section.status) ? `/app/learn/${courseId}/${section._id}` : undefined"
            class="flex items-center gap-4 rounded-xl border p-4 transition-colors"
            :class="[
              canNavigate(section.status)
                ? 'cursor-pointer border-stone-800 bg-stone-900 hover:border-stone-700'
                : 'border-stone-800/50 bg-stone-900/50',
              section.status === 'ready' ? 'border-l-2 border-l-amber-500' : '',
            ]"
            role="listitem"
          >
            <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-stone-800">
              <component
                :is="getSectionStatus(section.status).icon"
                class="h-4 w-4"
                :class="getSectionStatus(section.status).class"
              />
            </div>

            <div class="min-w-0 flex-1">
              <p
                class="truncate text-sm font-medium"
                :class="section.status === 'locked' ? 'text-stone-500' : 'text-stone-100'"
              >
                {{ section.title }}
              </p>
              <p class="text-xs text-stone-500">
                {{ getSectionStatus(section.status).label }}
              </p>
            </div>

            <ChevronRight
              v-if="canNavigate(section.status)"
              class="h-4 w-4 shrink-0 text-stone-600"
            />
          </component>
        </div>

        <div class="mt-8 flex items-center justify-center gap-4 border-t border-stone-800 pt-6">
          <LearnDeleteCourseDialog
            :course-id="courseId"
            :course-title="course.title"
            @deleted="handleDeleted"
          />
        </div>
      </template>
    </div>
  </div>
</template>
