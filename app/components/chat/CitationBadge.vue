<script setup lang="ts">
const props = defineProps<{
  index: number
  filename: string
}>()

const emit = defineEmits<{
  click: [index: number]
}>()
</script>

<template>
  <button
    role="button"
    :aria-label="`Source ${props.index} from ${props.filename}`"
    class="mx-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/10 px-1.5 text-xs font-medium text-primary hover:bg-primary/20"
    @click="emit('click', props.index)"
  >
    {{ props.index }}
  </button>
</template>
