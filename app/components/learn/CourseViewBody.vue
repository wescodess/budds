<script setup lang="ts">
import { ArrowLeft, Lock, Loader2, AlertCircle, CheckCircle2, ChevronRight, Pencil, MoreVertical } from 'lucide-vue-next'
import type { Id } from '~~/convex/_generated/dataModel'

const props = defineProps<{
  course: any
  sections: any[]
  courseId: Id<'courses'>
  backUrl: string
  backLabel: string
  sectionUrlPrefix: string
  editOutlineUrl: string
  needsStart: boolean
}>()

const emit = defineEmits<{
  deleted: []
}>()

const progress = computed(() => {
  if (!props.course?.totalSectionCount) return 0
  return Math.round(((props.course.completedSectionCount ?? 0) / props.course.totalSectionCount) * 100)
})

const currentSectionIndex = computed(() => {
  const readyIdx = props.sections.findIndex((s: any) => s.status === 'ready')
  if (readyIdx !== -1) return readyIdx
  const generatingIdx = props.sections.findIndex((s: any) => s.status === 'generating')
  return generatingIdx
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

function isCurrent(index: number) {
  return index === currentSectionIndex.value
}

const showPaceSelector = ref(false)
</script>

<template>
  <div class="mx-auto max-w-2xl px-4 py-8">
    <NuxtLink
      :to="backUrl"
      class="mb-6 inline-flex items-center gap-1.5 text-sm text-stone-400 transition-colors hover:text-stone-200"
    >
      <ArrowLeft class="h-4 w-4" />
      {{ backLabel }}
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
        <div class="mt-3 h-2 overflow-hidden rounded-full bg-stone-800" data-testid="progress-bar-track">
          <div
            class="h-full rounded-full bg-amber-500 transition-all"
            :style="{ width: `${progress}%` }"
            role="progressbar"
            :aria-valuenow="progress"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-label="`Course progress: ${progress}%`"
            data-testid="progress-bar"
          />
        </div>
      </div>

      <div v-if="needsStart" class="mb-6 flex justify-center">
        <LearnStartLearningButton :course-id="courseId" />
      </div>

      <div class="space-y-2" role="list" aria-label="Course sections">
        <template v-for="(section, idx) in sections" :key="section._id">
          <NuxtLink
            v-if="canNavigate(section.status)"
            :to="`${sectionUrlPrefix}/${section._id}`"
            class="flex items-center gap-4 rounded-xl border p-4 transition-colors cursor-pointer bg-stone-900 hover:border-stone-700"
            :class="isCurrent(idx)
              ? 'border-l-2 border-l-amber-500 border-stone-800'
              : 'border-stone-800'"
            role="listitem"
            :data-testid="`section-item-${section._id}`"
          >
            <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-stone-800">
              <component :is="getSectionStatus(section.status).icon" class="h-4 w-4" :class="getSectionStatus(section.status).class" />
            </div>
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium text-stone-100">{{ section.title }}</p>
              <p class="text-xs text-stone-500">{{ getSectionStatus(section.status).label }}</p>
            </div>
            <LearnMasteryBadge
              v-if="section.status === 'completed'"
              :level="section.masteryLevel ?? 'new'"
              class="hidden sm:inline-flex"
              data-testid="mastery-badge-desktop"
            />
            <LearnMasteryBadge
              v-if="section.status === 'completed'"
              :level="section.masteryLevel ?? 'new'"
              compact
              class="sm:hidden"
              data-testid="mastery-badge-mobile"
            />
            <ChevronRight v-if="isCurrent(idx)" class="h-4 w-4 shrink-0 text-amber-400" />
            <ChevronRight v-else class="h-4 w-4 shrink-0 text-stone-600" />
          </NuxtLink>

          <div
            v-else
            class="flex items-center gap-4 rounded-xl border p-4 border-stone-800/50 bg-stone-900/50"
            :class="isCurrent(idx) ? 'border-l-2 border-l-amber-500' : ''"
            role="listitem"
            :data-testid="`section-item-${section._id}`"
          >
            <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-stone-800">
              <component :is="getSectionStatus(section.status).icon" class="h-4 w-4" :class="getSectionStatus(section.status).class" />
            </div>
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium text-stone-500">{{ section.title }}</p>
              <p class="text-xs text-stone-500">{{ getSectionStatus(section.status).label }}</p>
            </div>
          </div>
        </template>
      </div>

      <div class="mt-8 border-t border-stone-800 pt-6">
        <div class="hidden items-center justify-center gap-4 sm:flex" data-testid="actions-desktop">
          <NuxtLink
            :to="editOutlineUrl"
            class="inline-flex items-center gap-2 rounded-md border border-stone-700 px-3 py-2 text-sm font-medium text-stone-300 transition-colors hover:border-stone-600 hover:text-stone-100"
            data-testid="edit-outline-btn"
          >
            <Pencil class="h-4 w-4" />
            Edit Outline
          </NuxtLink>

          <button
            class="inline-flex items-center gap-2 rounded-md border border-stone-700 px-3 py-2 text-sm font-medium text-stone-300 transition-colors hover:border-stone-600 hover:text-stone-100"
            data-testid="change-pace-btn"
            @click="showPaceSelector = !showPaceSelector"
          >
            Change Pace
          </button>

          <LearnDeleteCourseDialog
            :course-id="courseId"
            :course-title="course.title"
            @deleted="emit('deleted')"
          />
        </div>

        <div v-if="showPaceSelector" class="mx-auto mt-4 max-w-xs" data-testid="pace-selector-panel">
          <LearnPaceSelector :course-id="courseId" :current-pace="course.pace" />
        </div>

        <div class="flex items-center justify-center sm:hidden" data-testid="actions-mobile">
          <UiDropdownMenu>
            <UiDropdownMenuTrigger as-child>
              <button
                class="inline-flex items-center gap-2 rounded-md border border-stone-700 px-3 py-2 text-sm font-medium text-stone-300"
                aria-label="Course actions"
                data-testid="mobile-menu-trigger"
              >
                <MoreVertical class="h-4 w-4" />
                Actions
              </button>
            </UiDropdownMenuTrigger>
            <UiDropdownMenuContent align="center" class="w-48">
              <UiDropdownMenuItem as-child>
                <NuxtLink
                  :to="editOutlineUrl"
                  class="flex w-full items-center gap-2"
                  data-testid="mobile-edit-outline"
                >
                  <Pencil class="h-4 w-4" />
                  Edit Outline
                </NuxtLink>
              </UiDropdownMenuItem>
              <UiDropdownMenuItem
                data-testid="mobile-change-pace"
                @click="showPaceSelector = !showPaceSelector"
              >
                Change Pace
              </UiDropdownMenuItem>
              <UiDropdownMenuSeparator />
              <UiDropdownMenuItem as-child>
                <LearnDeleteCourseDialog
                  :course-id="courseId"
                  :course-title="course.title"
                  @deleted="emit('deleted')"
                />
              </UiDropdownMenuItem>
            </UiDropdownMenuContent>
          </UiDropdownMenu>
        </div>
      </div>
    </template>
  </div>
</template>
