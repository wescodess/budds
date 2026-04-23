<script setup lang="ts">
import { Flame, Snowflake, Shield } from 'lucide-vue-next'

const props = defineProps<{
  streakCurrent: number
  streakFreezeAvailable?: boolean
  streakFreezeUsedAt?: string | null
}>()

const isFreezeRecent = computed(() => {
  if (!props.streakFreezeUsedAt) return false
  const usedAt = new Date(props.streakFreezeUsedAt)
  const now = new Date()
  const diffMs = now.getTime() - usedAt.getTime()
  return diffMs < 24 * 60 * 60 * 1000
})
</script>

<template>
  <div
    v-if="streakCurrent > 0"
    class="flex items-center gap-1.5"
    :aria-label="`Learning streak: ${streakCurrent} days${streakFreezeAvailable ? ', freeze available' : ''}`"
    data-testid="streak-display"
  >
    <Snowflake v-if="isFreezeRecent" class="h-4 w-4 text-stone-500" />
    <Flame v-else class="h-4 w-4 text-amber-500" />
    <span class="text-sm font-medium text-stone-300">{{ streakCurrent }}</span>
    <span class="text-xs text-stone-500">{{ streakCurrent === 1 ? 'day' : 'days' }}</span>
    <Shield
      v-if="streakFreezeAvailable && !isFreezeRecent"
      class="h-3 w-3 text-stone-500"
      data-testid="streak-freeze-available"
      aria-label="Streak freeze available"
    />
  </div>
</template>
