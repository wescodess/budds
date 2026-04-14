<script setup lang="ts">
import { Folder, FileText, X } from 'lucide-vue-next'
import type { useReferenceScope } from '~/composables/useReferenceScope'

const props = defineProps<{
  scope: ReturnType<typeof useReferenceScope>
}>()
</script>

<template>
  <div
    v-if="props.scope.hasSelection.value"
    data-testid="reference-scope-strip"
    class="flex flex-wrap items-center gap-2 px-1 pb-2"
  >
    <span class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      Scope
    </span>
    <button
      v-for="chip in props.scope.chips.value"
      :key="`${chip.kind}-${chip.id}`"
      type="button"
      :aria-label="`Remove ${chip.label}`"
      class="inline-flex h-7 max-w-[220px] items-center gap-1.5 rounded-xl border border-border bg-card px-2.5 text-xs text-foreground transition-colors hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      @click="props.scope.removeChip(chip)"
    >
      <component :is="chip.kind === 'folder' ? Folder : FileText" class="h-3 w-3 shrink-0 text-muted-foreground" />
      <span class="truncate">{{ chip.label }}</span>
      <X class="h-3 w-3 shrink-0 text-muted-foreground" />
    </button>
    <button
      type="button"
      class="ml-auto text-[11px] font-medium text-muted-foreground hover:text-foreground"
      @click="props.scope.clear()"
    >
      Clear all
    </button>
  </div>
</template>
