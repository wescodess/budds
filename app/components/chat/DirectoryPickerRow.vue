<script setup lang="ts">
import { ChevronRight, Folder, FileText } from 'lucide-vue-next'
import type { TriState } from '~/composables/useReferenceScope'

const props = defineProps<{
  kind: 'folder' | 'file'
  label: string
  sublabel?: string
  badge?: string
  state: TriState
  expanded?: boolean
  expandable?: boolean
  depth?: number
  loading?: boolean
}>()

const emit = defineEmits<{
  toggle: []
  'toggle-expand': []
}>()

const indent = computed(() => ({ paddingLeft: `${(props.depth ?? 0) * 16 + 8}px` }))
</script>

<template>
  <div
    :data-testid="`picker-row-${props.kind}`"
    :style="indent"
    class="group flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm hover:bg-accent/10"
  >
    <button
      v-if="props.kind === 'folder' && props.expandable"
      type="button"
      :aria-label="props.expanded ? 'Collapse' : 'Expand'"
      :aria-expanded="props.expanded"
      class="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      @click="emit('toggle-expand')"
    >
      <ChevronRight
        class="h-3.5 w-3.5 transition-transform motion-reduce:transition-none"
        :class="props.expanded ? 'rotate-90' : ''"
      />
    </button>
    <span v-else class="w-6 shrink-0" />

    <UiCheckbox
      :model-value="props.state === 'on' ? true : props.state === 'indeterminate' ? 'indeterminate' : false"
      :aria-label="`Select ${props.label}`"
      @update:model-value="emit('toggle')"
    />

    <component
      :is="props.kind === 'folder' ? Folder : FileText"
      class="h-4 w-4 shrink-0 text-muted-foreground"
    />

    <button
      type="button"
      class="flex min-w-0 flex-1 items-center gap-2 text-left"
      @click="props.kind === 'folder' && props.expandable ? emit('toggle-expand') : emit('toggle')"
    >
      <span class="truncate text-foreground">{{ props.label }}</span>
      <span
        v-if="props.sublabel"
        class="shrink-0 text-[11px] text-muted-foreground"
      >
        {{ props.sublabel }}
      </span>
    </button>

    <span
      v-if="props.badge"
      class="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
    >
      {{ props.badge }}
    </span>
    <span
      v-if="props.loading"
      class="shrink-0 text-[11px] text-muted-foreground"
    >
      loading…
    </span>
  </div>
</template>
