<script setup lang="ts">
interface Course {
  _id: string
  title: string
  completedSectionCount: number
  totalSectionCount: number
  pace: 'intensive' | 'steady' | 'relaxed'
  status: string
}

const props = defineProps<{ course: Course; folderId?: string }>()

const progress = computed(() => {
  if (!props.course.totalSectionCount) return 0
  return Math.round((props.course.completedSectionCount / props.course.totalSectionCount) * 100)
})

const paceConfig = {
  intensive: { label: 'Intensive', class: 'bg-red-500/20 text-red-400' },
  steady: { label: 'Steady', class: 'bg-amber-500/20 text-amber-400' },
  relaxed: { label: 'Relaxed', class: 'bg-green-500/20 text-green-400' },
} as const

const paceDisplay = computed(() => paceConfig[props.course.pace] ?? paceConfig.steady)

const courseUrl = computed(() =>
  props.folderId
    ? `/app/folders/${props.folderId}/learn/${props.course._id}`
    : `/app/learn/${props.course._id}`,
)
</script>

<template>
  <NuxtLink
    :to="courseUrl"
    class="group block rounded-xl border border-stone-800 bg-stone-900 p-5 transition-colors hover:border-stone-700"
    :data-testid="`course-card-${course._id}`"
  >
    <h3 class="mb-3 truncate text-base font-semibold text-stone-100 group-hover:text-amber-400">
      {{ course.title }}
    </h3>

    <div class="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-stone-800">
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

    <div class="flex items-center justify-between">
      <span class="text-xs text-stone-400" data-testid="section-count">
        {{ course.completedSectionCount }}/{{ course.totalSectionCount }} sections
      </span>
      <span
        class="rounded-full px-2 py-0.5 text-xs font-medium"
        :class="paceDisplay.class"
        data-testid="pace-badge"
      >
        {{ paceDisplay.label }}
      </span>
    </div>
  </NuxtLink>
</template>
