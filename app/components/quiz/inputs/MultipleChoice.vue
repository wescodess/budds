<script setup lang="ts">
const props = defineProps<{
  options: string[]
  selected: string
  disabled?: boolean
  feedback?: { isCorrect: boolean; correctAnswer: string } | null
}>()

const emit = defineEmits<{ select: [value: string] }>()

const { springSnappy } = useMotionPresets()

function optionClass(option: string) {
  if (!props.feedback) {
    return option === props.selected
      ? 'border-primary bg-primary/10'
      : 'hover:bg-accent/50'
  }
  if (option === props.feedback.correctAnswer) return 'border-l-4 border-l-green-500 bg-green-500/10'
  if (option === props.selected && !props.feedback.isCorrect) return 'border-l-4 border-l-destructive bg-destructive/5'
  return 'opacity-50'
}
</script>

<template>
  <div class="space-y-2">
    <Motion
      v-for="(option, idx) in options"
      :key="option"
      :initial="{ opacity: 0, y: 8 }"
      :animate="{ opacity: 1, y: 0 }"
      :transition="{ ...springSnappy, delay: idx * 0.03 }"
      as="button"
      type="button"
      :disabled="disabled || !!feedback"
      class="flex w-full items-center gap-3 rounded-lg border p-4 text-left text-sm transition-all duration-150"
      :class="optionClass(option)"
      @click="emit('select', option)"
    >
      <span class="flex-1">{{ option }}</span>
      <span v-if="feedback && option === feedback.correctAnswer" class="text-green-500">&#10003;</span>
      <span v-else-if="feedback && option === selected && !feedback.isCorrect" class="text-destructive">&#10007;</span>
    </Motion>
  </div>
</template>
