<script setup lang="ts">
const emit = defineEmits<{
  rate: [quality: number]
}>()

const ratings = [
  { label: 'Again', quality: 0, class: 'bg-red-500/20 text-red-400 hover:bg-red-500/30', key: '1' },
  { label: 'Hard', quality: 3, class: 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30', key: '2' },
  { label: 'Good', quality: 4, class: 'bg-green-500/20 text-green-400 hover:bg-green-500/30', key: '3' },
  { label: 'Easy', quality: 5, class: 'bg-teal-500/20 text-teal-400 hover:bg-teal-500/30', key: '4' },
] as const
</script>

<template>
  <div
    class="grid w-full max-w-xl grid-cols-4 gap-2"
    role="group"
    aria-label="Rate your recall"
    data-testid="rating-buttons"
  >
    <button
      v-for="r in ratings"
      :key="r.quality"
      type="button"
      class="h-12 rounded-lg text-sm font-medium transition-colors"
      :class="r.class"
      :data-testid="`rate-${r.label.toLowerCase()}`"
      @click="emit('rate', r.quality)"
    >
      {{ r.label }}
    </button>
  </div>
</template>
