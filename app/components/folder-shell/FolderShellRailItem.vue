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
      'group relative flex w-full items-center rounded-md py-1.5 text-sm transition-[background-color,color,padding,gap] duration-200 ease-out',
      active
        ? 'bg-primary/10 text-primary'
        : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
      compact ? 'justify-center gap-0 px-0' : 'gap-2.5 px-2',
    ]"
    :data-active="active ? 'true' : 'false'"
    :data-testid="`rail-item-${label.toLowerCase()}`"
  >
    <span
      v-if="active"
      class="absolute left-0 top-1.5 h-[calc(100%-0.75rem)] w-0.5 rounded-r bg-primary"
    />
    <component :is="icon" class="h-4 w-4 shrink-0" />
    <span
      :class="[
        'min-w-0 overflow-hidden whitespace-nowrap text-left transition-[max-width,opacity,transform] duration-200 ease-out',
        compact ? 'max-w-0 flex-none translate-x-1 opacity-0' : 'max-w-[11rem] flex-1 translate-x-0 opacity-100',
      ]"
    >
      {{ label }}
    </span>
    <span
      v-if="count !== undefined && count !== null"
      :class="[
        'shrink-0 overflow-hidden rounded-full bg-muted text-[10px] font-medium text-muted-foreground transition-[max-width,opacity,transform,padding] duration-200 ease-out',
        compact ? 'max-w-0 translate-x-1 px-0 py-0 opacity-0' : 'max-w-12 translate-x-0 px-1.5 py-px opacity-100',
      ]"
    >
      {{ count }}
    </span>
  </button>
</template>
