<script setup lang="ts">
import { ChevronDown, Folder, FileText, X } from 'lucide-vue-next'
import type { useReferenceScope } from '~/composables/useReferenceScope'

const props = defineProps<{
  scope: ReturnType<typeof useReferenceScope>
}>()

const expanded = ref(false)
const MAX_PREVIEW = 3
const previewChips = computed(() =>
  expanded.value ? props.scope.chips.value : props.scope.chips.value.slice(0, MAX_PREVIEW),
)
const remainingCount = computed(() => Math.max(0, props.scope.chips.value.length - MAX_PREVIEW))

watch(() => props.scope.chips.value, () => {
  expanded.value = false
})
</script>

<template>
  <div
    v-if="props.scope.hasSelection.value"
    data-testid="reference-scope-strip"
    class="px-1 pb-2"
  >
    <div class="flex items-start gap-3">
      <div class="flex shrink-0 items-center gap-1 pt-1 text-[11px] font-medium text-muted-foreground">
        <span class="inline-flex items-center gap-1 rounded-full border border-border/60 bg-card/70 px-2 py-1">
          <Folder class="h-3 w-3" />
          <span>{{ props.scope.totalFolderCount.value }}</span>
        </span>
        <span class="inline-flex items-center gap-1 rounded-full border border-border/60 bg-card/70 px-2 py-1">
          <FileText class="h-3 w-3" />
          <span>{{ props.scope.totalFileCount.value }}</span>
        </span>
      </div>

      <div class="min-w-0 flex-1">
        <div
          :class="expanded ? 'flex flex-wrap items-center gap-2' : 'flex items-center gap-2 overflow-hidden whitespace-nowrap'"
        >
          <button
            v-for="chip in previewChips"
            :key="`${chip.kind}-${chip.id}`"
            type="button"
            :aria-label="`Remove ${chip.label}`"
            class="inline-flex h-7 max-w-[220px] shrink-0 items-center gap-1.5 rounded-xl border border-border bg-card px-2.5 text-xs text-foreground transition-colors hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            @click="props.scope.removeChip(chip)"
          >
            <component :is="chip.kind === 'folder' ? Folder : FileText" class="h-3 w-3 shrink-0 text-muted-foreground" />
            <span class="truncate">{{ chip.label }}</span>
            <X class="h-3 w-3 shrink-0 text-muted-foreground" />
          </button>

          <span
            v-if="!expanded && remainingCount > 0"
            class="shrink-0 text-xs text-muted-foreground"
          >
            +{{ remainingCount }} more
          </span>
        </div>
      </div>

      <div class="flex shrink-0 items-center gap-2 pt-1">
        <button
          v-if="props.scope.chips.value.length > MAX_PREVIEW"
          type="button"
          class="inline-flex items-center gap-1 rounded px-1 text-[11px] font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          @click="expanded = !expanded"
        >
          {{ expanded ? 'Show less' : 'View all' }}
          <ChevronDown class="h-3 w-3 transition-transform" :class="expanded ? 'rotate-180' : ''" />
        </button>
        <button
          type="button"
          class="text-[11px] font-medium text-muted-foreground hover:text-foreground"
          @click="props.scope.clear()"
        >
          Clear all
        </button>
      </div>
    </div>
  </div>
</template>
