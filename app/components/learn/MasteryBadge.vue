<script setup lang="ts">
import { Check } from '@lucide/vue'

type MasteryLevel = 'new' | 'learning' | 'reviewing' | 'mastered'

const props = withDefaults(defineProps<{
  level: MasteryLevel
  compact?: boolean
}>(), {
  compact: false,
})

const config = {
  new: { dotClass: 'bg-stone-500', label: 'New' },
  learning: { dotClass: 'bg-amber-500', label: 'Learning' },
  reviewing: { dotClass: 'bg-amber-400', label: 'Reviewing' },
  mastered: { dotClass: 'bg-green-500', label: 'Mastered' },
} as const

const display = computed(() => config[props.level] ?? config.new)
</script>

<template>
  <span
    class="inline-flex items-center gap-1.5"
    :aria-label="`Mastery: ${display.label}`"
    data-testid="mastery-badge"
  >
    <Check
      v-if="level === 'mastered'"
      class="h-3.5 w-3.5 text-green-500"
      data-testid="mastery-checkmark"
    />
    <span
      v-else
      class="inline-block h-2 w-2 shrink-0 rounded-full"
      :class="display.dotClass"
      data-testid="mastery-dot"
    />
    <span
      v-if="!compact"
      class="text-xs text-stone-400"
      data-testid="mastery-label"
    >
      {{ display.label }}
    </span>
  </span>
</template>
