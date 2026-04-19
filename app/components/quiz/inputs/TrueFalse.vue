<script setup lang="ts">
const props = defineProps<{
  selected: string
  disabled?: boolean
  feedback?: { isCorrect: boolean; correctAnswer: string } | null
}>()

const emit = defineEmits<{ select: [value: string] }>()

const { springSnappy } = useMotionPresets()

function btnClass(value: string) {
  if (!props.feedback) {
    return value === props.selected
      ? 'border-primary bg-primary/10 text-foreground'
      : 'hover:bg-accent/50 text-muted-foreground'
  }
  if (value === props.feedback.correctAnswer) return 'border-green-500 bg-green-500/10 text-green-500'
  if (value === props.selected && !props.feedback.isCorrect) return 'border-destructive bg-destructive/5 text-destructive'
  return 'opacity-50 text-muted-foreground'
}
</script>

<template>
  <div class="flex gap-3">
    <Motion
      v-for="(value, idx) in ['True', 'False']"
      :key="value"
      :initial="{ opacity: 0, scale: 0.95 }"
      :animate="{ opacity: 1, scale: 1 }"
      :transition="{ ...springSnappy, delay: idx * 0.05 }"
      as="button"
      type="button"
      :disabled="disabled || !!feedback"
      class="flex-1 rounded-lg border py-4 text-center text-sm font-medium transition-all duration-150"
      :class="btnClass(value)"
      @click="emit('select', value)"
    >
      {{ value }}
    </Motion>
  </div>
</template>
