<script setup lang="ts">
const props = defineProps<{
  current: number
  total: number
}>()

const progress = computed(() => {
  if (props.total === 0) return 0
  return Math.round((props.current / props.total) * 100)
})
</script>

<template>
  <div class="flex items-center gap-3" data-testid="review-progress">
    <div class="flex-1">
      <div
        class="h-1.5 w-full overflow-hidden rounded-full bg-stone-800"
        role="progressbar"
        :aria-valuenow="progress"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-label="`Review progress: ${current} of ${total}`"
      >
        <div
          class="h-full rounded-full bg-amber-500 transition-all"
          :style="{ width: `${progress}%` }"
        />
      </div>
    </div>
    <span class="shrink-0 text-xs text-stone-400" data-testid="progress-count">
      {{ current }}/{{ total }}
    </span>
  </div>
</template>
