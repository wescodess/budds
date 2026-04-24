<script setup lang="ts">
import { ArrowLeft } from 'lucide-vue-next'

const props = defineProps<{
  courseTitle: string
  sectionTitle: string
  currentBlock: number
  totalBlocks: number
}>()

const emit = defineEmits<{ back: [] }>()

const progress = computed(() => {
  if (props.totalBlocks === 0) return 0
  return Math.round((props.currentBlock / props.totalBlocks) * 100)
})
</script>

<template>
  <header
    class="sticky top-0 z-10 border-b border-stone-800 bg-stone-900"
    role="banner"
  >
    <div class="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
      <button
        type="button"
        class="shrink-0 rounded-lg p-1.5 text-stone-400 transition-colors hover:bg-stone-800 hover:text-stone-200"
        aria-label="Back to course"
        @click="emit('back')"
      >
        <ArrowLeft class="h-5 w-5" />
      </button>

      <span class="hidden truncate text-sm text-stone-400 sm:block">
        {{ courseTitle }}
      </span>

      <span class="hidden text-stone-600 sm:block">/</span>

      <h1 class="min-w-0 flex-1 truncate text-center text-sm font-medium text-stone-100 sm:text-left">
        {{ sectionTitle }}
      </h1>

      <span
        v-if="totalBlocks > 0"
        class="shrink-0 text-xs text-stone-400"
        :aria-label="`Block ${currentBlock} of ${totalBlocks}`"
      >
        {{ currentBlock }}/{{ totalBlocks }}
      </span>
    </div>

    <div
      class="h-0.5 bg-stone-800"
      role="progressbar"
      :aria-valuenow="progress"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-label="`Section progress: ${progress}%`"
    >
      <div
        class="h-full bg-amber-500 transition-all duration-300"
        :style="{ width: `${progress}%` }"
      />
    </div>
  </header>
</template>
