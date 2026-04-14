<script setup lang="ts">
import { FileText, ArrowRight } from 'lucide-vue-next'
import type { Source } from '~/composables/useChat'

const props = defineProps<{
  sources: Source[]
  maxPreview?: number
}>()

const emit = defineEmits<{
  'view-all': []
  'chip-click': [index: number]
}>()

const MAX = computed(() => props.maxPreview ?? 3)
const previewChips = computed(() => props.sources.slice(0, MAX.value))
const remaining = computed(() => Math.max(0, props.sources.length - MAX.value))
</script>

<template>
  <div
    v-if="props.sources.length > 0"
    data-testid="chat-reference-chips"
    class="mt-3 flex flex-wrap items-center gap-2 border-t border-border/50 pt-3"
  >
    <span class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      References
    </span>
    <button
      v-for="(source, i) in previewChips"
      :key="i"
      type="button"
      :aria-label="`Source ${i + 1}: ${source.filename}`"
      class="inline-flex h-8 max-w-[200px] items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      @click="emit('chip-click', i + 1)"
    >
      <FileText class="h-3 w-3 shrink-0 text-muted-foreground" />
      <span class="truncate">[{{ i + 1 }}] {{ source.filename }}</span>
    </button>
    <span
      v-if="remaining > 0"
      class="text-xs text-muted-foreground"
    >
      +{{ remaining }} more
    </span>
    <button
      type="button"
      class="ml-auto inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded px-1"
      data-testid="view-all-references"
      @click="emit('view-all')"
    >
      View all references
      <ArrowRight class="h-3 w-3" />
    </button>
  </div>
</template>
