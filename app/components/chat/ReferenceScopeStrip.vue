<script setup lang="ts">
import { ChevronDown, Folder, FileText, X } from '@lucide/vue'
import type { useReferenceScope } from '~/composables/useReferenceScope'

const props = defineProps<{
  scope: ReturnType<typeof useReferenceScope>
}>()

const expanded = ref(false)
const scrollContainerRef = ref<HTMLElement | null>(null)
const showBottomFade = ref(false)
const MAX_PREVIEW = 3
const previewChips = computed(() =>
  expanded.value ? props.scope.chips.value : props.scope.chips.value.slice(0, MAX_PREVIEW),
)
const remainingCount = computed(() => Math.max(0, props.scope.chips.value.length - MAX_PREVIEW))

function syncBottomFade() {
  const el = scrollContainerRef.value
  if (!expanded.value || !el) {
    showBottomFade.value = false
    return
  }

  showBottomFade.value = el.scrollHeight > el.clientHeight && el.scrollTop + el.clientHeight < el.scrollHeight - 2
}

watch(() => props.scope.chips.value, () => {
  expanded.value = false
})

watch([expanded, previewChips], () => {
  nextTick(() => syncBottomFade())
}, { immediate: true })
</script>

<template>
  <div
    v-if="props.scope.hasSelection.value"
    data-testid="reference-scope-strip"
    class="pb-2"
  >
    <div class="flow-root">
      <div class="float-left mr-1.5 mb-1.5 flex flex-wrap items-center gap-1 text-[11px] font-medium text-muted-foreground sm:mr-2 sm:mb-2">
        <span class="inline-flex items-center gap-1 rounded-full border border-border/60 bg-card/70 px-2 py-1">
          <Folder class="h-3 w-3" />
          <span>{{ props.scope.totalFolderCount.value }}</span>
        </span>
        <span class="inline-flex items-center gap-1 rounded-full border border-border/60 bg-card/70 px-2 py-1">
          <FileText class="h-3 w-3" />
          <span>{{ props.scope.totalFileCount.value }}</span>
        </span>
      </div>

      <div class="relative">
        <div
          ref="scrollContainerRef"
          :class="expanded ? 'max-h-28 overflow-y-auto pr-1 sm:max-h-36' : 'overflow-visible'"
          @scroll="syncBottomFade"
        >
        <div class="min-w-0">
          <button
            v-for="chip in previewChips"
            :key="`${chip.kind}-${chip.id}`"
            type="button"
            :aria-label="`Remove ${chip.label}`"
            class="mr-1.5 mb-1.5 inline-flex h-7 max-w-[min(100%,15rem)] items-center gap-1.5 rounded-xl border border-border bg-card px-2 align-top text-xs text-foreground transition-colors hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:mr-2 sm:mb-2 sm:max-w-[220px] sm:px-2.5"
            @click="props.scope.removeChip(chip)"
          >
            <component :is="chip.kind === 'folder' ? Folder : FileText" class="h-3 w-3 shrink-0 text-muted-foreground" />
            <span class="truncate">{{ chip.label }}</span>
            <X class="h-3 w-3 shrink-0 text-muted-foreground" />
          </button>

          <span
            v-if="!expanded && remainingCount > 0"
            class="mr-1.5 mb-1.5 inline-flex h-7 items-center rounded-full border border-dashed border-border/70 px-2 align-top text-[11px] font-medium text-muted-foreground sm:mr-2 sm:mb-2"
          >
            +{{ remainingCount }}
          </span>

          <button
            v-if="props.scope.chips.value.length > MAX_PREVIEW"
            type="button"
            class="mr-1.5 mb-1.5 inline-flex h-7 items-center justify-center rounded-full border border-border/70 px-2 align-top text-[11px] font-medium text-primary transition-colors hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:mr-2 sm:mb-2 sm:gap-1 sm:rounded sm:border-transparent sm:px-1 sm:hover:bg-transparent sm:hover:underline"
            :aria-label="expanded ? 'Show fewer selected sources' : 'View all selected sources'"
            @click="expanded = !expanded"
          >
            <span class="hidden sm:inline">{{ expanded ? 'Show less' : 'View all' }}</span>
            <ChevronDown class="h-3 w-3 transition-transform" :class="expanded ? 'rotate-180' : ''" />
          </button>

          <button
            type="button"
            class="mr-1.5 mb-1.5 inline-flex h-7 items-center justify-center rounded-full border border-border/70 px-2 align-top text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:mr-0 sm:mb-2 sm:gap-1 sm:rounded sm:border-transparent sm:px-1"
            aria-label="Clear all selected sources"
            @click="props.scope.clear()"
          >
            <X class="h-3 w-3" />
            <span class="hidden sm:inline">Clear all</span>
          </button>
        </div>
        </div>
        <div
          v-if="showBottomFade"
          class="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-background via-background/85 to-transparent"
        />
      </div>
    </div>
  </div>
</template>
