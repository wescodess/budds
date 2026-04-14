<script setup lang="ts">
import type { FunctionalComponent } from 'vue'

defineOptions({ name: 'FolderShellRailItem' })

defineProps<{
  label: string
  icon: FunctionalComponent
  active?: boolean
  compact?: boolean
  count?: number | null
}>()
</script>

<template>
  <button
    type="button"
    :class="[
      'group relative flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition',
      active
        ? 'bg-primary/10 text-primary'
        : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
      compact && 'justify-center px-0',
    ]"
    :data-active="active ? 'true' : 'false'"
    :data-testid="`rail-item-${label.toLowerCase()}`"
  >
    <span
      v-if="active"
      class="absolute left-0 top-1.5 h-[calc(100%-0.75rem)] w-0.5 rounded-r bg-primary"
    />
    <component :is="icon" class="h-4 w-4 shrink-0" />
    <span v-if="!compact" class="flex-1 truncate text-left">{{ label }}</span>
    <span
      v-if="!compact && count !== undefined && count !== null && count > 0"
      class="rounded-full bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground"
    >
      {{ count }}
    </span>
  </button>
</template>
