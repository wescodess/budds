<script setup lang="ts">
import { Headphones } from 'lucide-vue-next'

defineProps<{ entityId?: string }>()
</script>

<template>
  <div class="p-6" data-testid="audio-block">
    <div class="mb-4 flex items-center gap-2">
      <Headphones class="h-4 w-4 text-amber-500" />
      <span class="text-xs font-medium uppercase tracking-wide text-stone-400">Audio Primer</span>
    </div>

    <div class="flex items-center gap-4 rounded-lg border border-stone-800 bg-stone-950 p-4">
      <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-500/10">
        <Headphones class="h-5 w-5 text-amber-500" />
      </div>
      <div class="flex-1">
        <p class="text-sm text-stone-300">Audio primer available</p>
        <p class="text-xs text-stone-500">Audio playback will be available in a future update</p>
      </div>
    </div>
  </div>
</template>
