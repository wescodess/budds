<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'
import { FileText, ExternalLink } from 'lucide-vue-next'

const props = defineProps<{
  index: number
  filename?: string
  score?: number
  content?: string
}>()

const emit = defineEmits<{
  click: [index: number]
  'long-press': [index: number]
  'open-in-knowledge': [index: number]
}>()

const LONG_PRESS_MS = 450

const folderThemeStyle = inject(
  'folderShellThemeStyle',
  computed<Record<string, string>>(() => ({})),
)

const popoverOpen = ref(false)
const isTouchDevice = useMediaQuery('(hover: none), (pointer: coarse)')
const hasHoverDetails = computed(() => Boolean(props.filename))
const scorePct = computed(() =>
  typeof props.score === 'number' ? `${Math.round(props.score * 100)}%` : null,
)
const excerpt = computed(() => {
  if (!props.content) return ''
  const normalized = props.content.replace(/\s+/g, ' ').trim()
  return normalized.length > 260 ? `${normalized.slice(0, 260)}…` : normalized
})

let longPressTimer: ReturnType<typeof setTimeout> | null = null
const suppressNextClick = ref(false)

function clearLongPressTimer() {
  if (!longPressTimer) return
  clearTimeout(longPressTimer)
  longPressTimer = null
}

function startLongPress(event: PointerEvent) {
  if (!isTouchDevice.value || !hasHoverDetails.value || event.pointerType === 'mouse') return

  clearLongPressTimer()
  longPressTimer = setTimeout(() => {
    suppressNextClick.value = true
    popoverOpen.value = false
    emit('long-press', props.index)
    clearLongPressTimer()
  }, LONG_PRESS_MS)
}

function cancelLongPress() {
  clearLongPressTimer()
}

function handleDesktopClick() {
  emit('click', props.index)
}

function handleMobileClick(event: MouseEvent) {
  if (suppressNextClick.value) {
    suppressNextClick.value = false
    event.preventDefault()
    event.stopPropagation()
    return
  }

  if (!hasHoverDetails.value) {
    emit('click', props.index)
  }
}

function handleOpenInKnowledge() {
  popoverOpen.value = false
  emit('open-in-knowledge', props.index)
}

onBeforeUnmount(() => {
  clearLongPressTimer()
})
</script>

<template>
  <UiHoverCard v-if="hasHoverDetails && !isTouchDevice" :open-delay="300" :close-delay="120">
    <UiHoverCardTrigger as-child>
      <button
        type="button"
        :aria-label="`Source ${props.index}${props.filename ? ` from ${props.filename}` : ''}`"
        class="mx-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground align-baseline transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        @click="handleDesktopClick"
      >
        {{ props.index }}
      </button>
    </UiHoverCardTrigger>
    <UiHoverCardContent
      side="top"
      align="start"
      :style="folderThemeStyle"
      class="w-80 space-y-2 rounded-xl border bg-card p-4 text-foreground"
    >
      <div class="flex items-center gap-2">
        <FileText class="h-4 w-4 text-muted-foreground shrink-0" />
        <span class="truncate text-sm font-semibold">{{ props.filename }}</span>
      </div>
      <div v-if="scorePct" class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {{ scorePct }} relevance
      </div>
      <div
        v-if="excerpt"
        class="rounded-lg bg-primary/10 p-3 font-mono text-[13px] leading-[1.54] text-foreground/90"
      >
        {{ excerpt }}
      </div>
      <button
        type="button"
        class="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        @click="emit('open-in-knowledge', props.index)"
      >
        Open in knowledge
        <ExternalLink class="h-3 w-3" />
      </button>
    </UiHoverCardContent>
  </UiHoverCard>
  <UiPopover v-else-if="hasHoverDetails" v-model:open="popoverOpen">
    <UiPopoverTrigger as-child>
      <button
        type="button"
        :aria-label="`Source ${props.index}${props.filename ? ` from ${props.filename}` : ''}`"
        class="mx-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground align-baseline transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        @pointerdown="startLongPress"
        @pointerup="cancelLongPress"
        @pointercancel="cancelLongPress"
        @pointerleave="cancelLongPress"
        @contextmenu.prevent
        @click="handleMobileClick"
      >
        {{ props.index }}
      </button>
    </UiPopoverTrigger>
    <UiPopoverContent
      side="top"
      align="start"
      :style="folderThemeStyle"
      class="w-[min(20rem,calc(100vw-2rem))] space-y-2 rounded-xl border bg-card p-4 text-foreground"
    >
      <div class="flex items-center gap-2">
        <FileText class="h-4 w-4 shrink-0 text-muted-foreground" />
        <span class="truncate text-sm font-semibold">{{ props.filename }}</span>
      </div>
      <div v-if="scorePct" class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {{ scorePct }} relevance
      </div>
      <div
        v-if="excerpt"
        class="rounded-lg bg-primary/10 p-3 font-mono text-[13px] leading-[1.54] text-foreground/90"
      >
        {{ excerpt }}
      </div>
      <button
        type="button"
        class="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        @click="handleOpenInKnowledge"
      >
        Open in knowledge
        <ExternalLink class="h-3 w-3" />
      </button>
    </UiPopoverContent>
  </UiPopover>
  <button
  v-else
    type="button"
    :aria-label="`Source ${props.index}`"
    class="mx-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground align-baseline transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    @click="emit('click', props.index)"
  >
    {{ props.index }}
  </button>
</template>
