<script setup lang="ts">
import { BookOpen } from '@lucide/vue'

const props = defineProps<{
  dueCount: number
  dailyCap: number
}>()

const itemCount = computed(() => Math.min(props.dueCount, props.dailyCap))
const estimatedMinutes = computed(() => Math.max(1, Math.round((itemCount.value * 15) / 60)))
</script>

<template>
  <NuxtLink
    to="/app/learn/review"
    class="block rounded-xl border border-stone-800 bg-stone-900 p-4 transition-colors hover:border-amber-500/40"
    data-testid="daily-review-cta"
  >
    <div class="flex items-center gap-3">
      <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10">
        <BookOpen class="h-5 w-5 text-amber-500" />
      </div>
      <div class="flex-1">
        <h3 class="text-sm font-medium text-stone-100">Daily Review</h3>
        <p class="text-xs text-stone-400">
          {{ itemCount }} {{ itemCount === 1 ? 'item' : 'items' }} due · ~{{ estimatedMinutes }} min
        </p>
      </div>
    </div>
  </NuxtLink>
</template>
