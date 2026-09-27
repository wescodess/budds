<script setup lang="ts">
import type { NeedFirstDraftInput } from '~~/shared/learn-adaptive-draft'

type Intent = NeedFirstDraftInput['intent']
const props = withDefaults(defineProps<{ modelValue: Intent, disabled?: boolean }>(), { disabled: false })
const emit = defineEmits<{ 'update:modelValue': [intent: Intent] }>()
const options: { value: Intent, label: string }[] = [
  { value: 'understand', label: 'Understand' },
  { value: 'prepare', label: 'Prepare' },
  { value: 'build', label: 'Build or solve' },
  { value: 'master', label: 'Master' },
  { value: 'refresh', label: 'Refresh' },
  { value: 'explore', label: 'Explore' },
]
const selectedLabel = computed(() => options.find(option => option.value === props.modelValue)?.label ?? '')
function selectIntent(intent: Intent) {
  if (!props.disabled) emit('update:modelValue', intent)
}
</script>

<template>
  <fieldset>
    <legend class="text-sm font-medium">Learning intent</legend>
    <div class="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
      <button
        v-for="option in options"
        :key="option.value"
        type="button"
        :data-testid="`learn-intent-chip-${option.value}`"
        :aria-pressed="modelValue === option.value"
        :aria-disabled="disabled"
        class="min-h-11 rounded-lg border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 aria-disabled:opacity-50"
        :class="modelValue === option.value ? 'border-primary bg-primary/10 text-foreground' : 'border-input bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground'"
        @click="selectIntent(option.value)"
      >{{ option.label }}</button>
    </div>
    <p role="status" aria-live="polite" class="sr-only">Selected intent: {{ selectedLabel }}.</p>
  </fieldset>
</template>
