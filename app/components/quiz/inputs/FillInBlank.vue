<script setup lang="ts">
defineProps<{
  modelValue: string
  disabled?: boolean
  feedback?: { isCorrect: boolean; correctAnswer: string } | null
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <div>
    <input
      type="text"
      :value="modelValue"
      :disabled="disabled || !!feedback"
      placeholder="Type your answer..."
      autocapitalize="sentences"
      autocorrect="on"
      spellcheck="true"
      class="w-full rounded-lg border border-input bg-background px-4 py-3 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-70"
      :class="{
        'border-l-4 border-l-green-500': feedback?.isCorrect,
        'border-l-4 border-l-muted-foreground/50': feedback && !feedback.isCorrect,
      }"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    >
    <div v-if="feedback && !feedback.isCorrect" class="mt-2 rounded-md border bg-muted/30 p-3 text-sm">
      <span class="text-xs font-medium text-muted-foreground">No exact answer match</span>
      <p class="mt-1 text-xs text-muted-foreground">Reference answer</p>
      <p class="mt-1">{{ feedback.correctAnswer }}</p>
    </div>
  </div>
</template>
