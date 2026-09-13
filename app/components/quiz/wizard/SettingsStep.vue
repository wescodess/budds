<script setup lang="ts">
defineProps<{
  questionCount: number
  questionTypes: string[]
  difficulty: string
}>()

const emit = defineEmits<{
  'update:questionCount': [value: number]
  'update:difficulty': [value: string]
  toggleType: [type: string]
}>()

const typeOptions = [
  { value: 'multiple-choice', label: 'Multiple choice' },
  { value: 'true_false', label: 'True / false' },
  { value: 'free-response', label: 'Short response' },
  { value: 'fill_in_the_blank', label: 'Fill in the blank' },
]

function clampCount(val: string) {
  const n = parseInt(val, 10)
  if (isNaN(n)) return
  emit('update:questionCount', Math.min(50, Math.max(1, n)))
}
</script>

<template>
  <div class="space-y-5">
    <div>
      <h3 class="text-lg font-semibold">Configure Quiz</h3>
    </div>

    <div>
      <UiLabel class="text-xs font-medium">Number of questions</UiLabel>
      <div class="mt-1 flex items-center gap-2">
        <input
          type="number"
          :value="questionCount"
          min="1"
          max="50"
          class="w-24 rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          @input="clampCount(($event.target as HTMLInputElement).value)"
        >
        <span class="text-xs text-muted-foreground">Range: 1-50</span>
      </div>
    </div>

    <div>
      <UiLabel class="text-xs font-medium">Question types</UiLabel>
      <div class="mt-2 space-y-2">
        <label
          v-for="opt in typeOptions"
          :key="opt.value"
          class="flex cursor-pointer items-center gap-2 text-sm"
        >
          <input
            type="checkbox"
            :checked="questionTypes.includes(opt.value)"
            class="accent-primary"
            @change="emit('toggleType', opt.value)"
          >
          {{ opt.label }}
        </label>
      </div>
    </div>

    <div>
      <UiLabel class="text-xs font-medium">Difficulty</UiLabel>
      <select
        :value="difficulty"
        class="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        @change="emit('update:difficulty', ($event.target as HTMLSelectElement).value)"
      >
        <option value="easy">Easy</option>
        <option value="medium">Medium</option>
        <option value="hard">Hard</option>
        <option value="mixed">Mixed</option>
      </select>
    </div>
  </div>
</template>
