<script setup lang="ts">
import { usePointerSwipe } from '@vueuse/core'
import { ChevronDown, ChevronUp, X } from 'lucide-vue-next'
import { nextTick, ref, watch } from 'vue'
import type { Source } from '~/composables/useChat'
import { PANEL_DISMISS_THRESHOLD_PX, useGestureGuards } from '~/composables/useGestureGuards'

const props = defineProps<{
  sources: Source[]
  activeCitationIndex: number | null
}>()

const emit = defineEmits<{
  close: []
}>()

const cardRefs = ref<HTMLElement[]>([])
const expanded = ref<Record<number, boolean>>({})
const paneRef = ref<HTMLElement | null>(null)
const { shouldStartHorizontalGesture } = useGestureGuards()
const allowDismissSwipe = ref(false)
const SIDEBAR_SWIPE_EDGE_GUARD_PX = 12

watch(() => props.activeCitationIndex, (index) => {
  if (index !== null && cardRefs.value[index]) {
    nextTick(() => {
      cardRefs.value[index]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    })
  }
})

function toggle(i: number) {
  expanded.value[i] = !expanded.value[i]
}

let paneSwipe: ReturnType<typeof usePointerSwipe>
paneSwipe = usePointerSwipe(paneRef, {
  threshold: 24,
  pointerTypes: ['touch', 'pen'],
  onSwipeStart(event) {
    allowDismissSwipe.value = shouldStartHorizontalGesture(event, {
      allowGestureOwners: true,
      edgeGuardPx: SIDEBAR_SWIPE_EDGE_GUARD_PX,
    })
  },
  onSwipeEnd() {
    if (allowDismissSwipe.value) {
      const deltaX = paneSwipe.posEnd.x - paneSwipe.posStart.x
      if (deltaX >= PANEL_DISMISS_THRESHOLD_PX) emit('close')
    }
    allowDismissSwipe.value = false
  },
})
</script>

<template>
  <aside
    ref="paneRef"
    data-testid="folder-helper-pane"
    data-gesture-owner="source-panel"
    class="flex h-full flex-col bg-background"
  >
    <div class="flex items-center justify-between border-b px-4 py-3">
      <h3 class="font-semibold tracking-tight">Sources</h3>
      <button
        type="button"
        data-testid="folder-helper-close"
        aria-label="Close sources panel"
        class="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-accent"
        @click="emit('close')"
      >
        <X class="h-4 w-4" />
      </button>
    </div>
    <div class="flex-1 overflow-y-auto p-4">
      <div v-if="props.sources.length === 0" class="text-sm text-muted-foreground">
        No sources cited yet. Send a question to see referenced documents here.
      </div>
      <div v-else class="space-y-3">
        <div
          v-for="(source, i) in props.sources"
          :key="i"
          :ref="(el) => { if (el) cardRefs[i] = (el as HTMLElement) }"
          :data-testid="`folder-helper-card-${i}`"
        >
          <ChatSourceCard
            :index="i + 1"
            :filename="source.filename"
            :content="source.content"
            :score="source.score"
            :highlighted="props.activeCitationIndex === i"
          />
          <button
            type="button"
            class="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            :data-testid="`folder-helper-card-${i}-toggle`"
            :aria-expanded="!!expanded[i]"
            @click="toggle(i)"
          >
            <component :is="expanded[i] ? ChevronUp : ChevronDown" class="h-3.5 w-3.5" />
            {{ expanded[i] ? 'Hide passages' : 'Show more passages' }}
          </button>
          <div
            v-if="expanded[i]"
            class="mt-2 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground"
            :data-testid="`folder-helper-card-${i}-passages`"
          >
            No further excerpts available for this source.
          </div>
        </div>
      </div>
    </div>
  </aside>
</template>
