<script setup lang="ts">
import { Headphones, FileText } from '@lucide/vue'

type Tab = 'podcast' | 'sources'

const props = defineProps<{
  modelValue: Tab
}>()

const emit = defineEmits<{
  'update:modelValue': [value: Tab]
}>()

function setTab(next: Tab) {
  if (next !== props.modelValue) emit('update:modelValue', next)
}
</script>

<template>
  <div class="flex shrink-0 items-center gap-1 border-b border-border/60 bg-card/50 px-2 py-1.5">
    <button
      type="button"
      role="tab"
      :aria-selected="props.modelValue === 'podcast'"
      data-testid="unified-helper-tab-podcast"
      :class="[
        'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-inter text-[11px] font-medium transition-colors',
        props.modelValue === 'podcast'
          ? 'bg-primary/15 text-primary'
          : 'text-muted-foreground hover:bg-accent/20 hover:text-foreground',
      ]"
      @click="setTab('podcast')"
    >
      <Headphones class="h-3 w-3" />
      Podcast
    </button>
    <button
      type="button"
      role="tab"
      :aria-selected="props.modelValue === 'sources'"
      data-testid="unified-helper-tab-sources"
      :class="[
        'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-inter text-[11px] font-medium transition-colors',
        props.modelValue === 'sources'
          ? 'bg-primary/15 text-primary'
          : 'text-muted-foreground hover:bg-accent/20 hover:text-foreground',
      ]"
      @click="setTab('sources')"
    >
      <FileText class="h-3 w-3" />
      Sources
    </button>
  </div>
</template>
