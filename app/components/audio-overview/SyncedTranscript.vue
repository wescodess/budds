<script setup lang="ts">
import { computed, ref, reactive, watch, nextTick, onMounted } from 'vue'
import { useWordSync } from '~/composables/useWordSync'

interface Turn {
  speaker: 'host_a' | 'host_b'
  text: string
  durationMs: number
  wordTimings?: { word: string, start: number, end: number }[]
}

const props = withDefaults(defineProps<{
  turns: Turn[]
  currentTurnIndex: number
  currentTimeSec: number
  isPlaying: boolean
  compact?: boolean
  maxHeight?: string
  onSeek?: (absoluteMs: number) => void
}>(), {
  compact: false,
  maxHeight: '20rem',
})

const turnsRef = computed(() => props.turns)
const turnIndexRef = computed(() => props.currentTurnIndex)
const timeSecRef = computed(() => props.currentTimeSec)

const { allTurnTimings, activeWordIndex, userScrolling, onUserScroll } = useWordSync(
  turnsRef,
  turnIndexRef,
  timeSecRef,
)

const containerRef = ref<HTMLElement | null>(null)
const wordRefs = new Map<string, HTMLElement>()

const pill = reactive({ x: 0, y: 0, w: 0, h: 0, visible: false })

function setWordRef(turnIdx: number, wordIdx: number, el: any) {
  const key = `${turnIdx}-${wordIdx}`
  if (el) wordRefs.set(key, el as HTMLElement)
  else wordRefs.delete(key)
}

function prefixDurationMs(index: number): number {
  let acc = 0
  for (let i = 0; i < index && i < props.turns.length; i++) {
    acc += props.turns[i]!.durationMs
  }
  return acc
}

function handleWordClick(turnIdx: number, wordIdx: number) {
  if (!props.onSeek) return
  const turnTimings = allTurnTimings.value[turnIdx]
  if (!turnTimings) return
  const word = turnTimings.words[wordIdx]
  if (!word) return
  const absoluteMs = prefixDurationMs(turnIdx) + Math.round(word.startSec * 1000)
  props.onSeek(absoluteMs)
}

onMounted(() => {
  nextTick(() => {
    containerRef.value?.addEventListener('scroll', () => onUserScroll(), { passive: true })
  })
})

const PAD_X = 5
const PAD_Y = 2

function updatePill() {
  const key = `${props.currentTurnIndex}-${activeWordIndex.value}`
  const el = wordRefs.get(key)
  const container = containerRef.value
  if (!el || !container || activeWordIndex.value < 0) {
    pill.visible = false
    return
  }
  const cRect = container.getBoundingClientRect()
  const wRect = el.getBoundingClientRect()
  pill.x = wRect.left - cRect.left + container.scrollLeft - PAD_X
  pill.y = wRect.top - cRect.top + container.scrollTop - PAD_Y
  pill.w = wRect.width + PAD_X * 2
  pill.h = wRect.height + PAD_Y * 2
  pill.visible = true
}

watch([() => props.currentTurnIndex, activeWordIndex], () => {
  if (!props.isPlaying) {
    pill.visible = false
    return
  }
  nextTick(updatePill)

  if (userScrolling.value) return
  const key = `${props.currentTurnIndex}-${activeWordIndex.value}`
  const el = wordRefs.get(key)
  if (!el) return
  nextTick(() => {
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  })
}, { flush: 'post' })

watch(() => props.isPlaying, (playing) => {
  if (!playing) pill.visible = false
  else nextTick(updatePill)
})

function isActiveTurn(turnIdx: number): boolean {
  return turnIdx === props.currentTurnIndex
}

function wordClass(turnIdx: number, wordIdx: number): string {
  const isPastTurn = turnIdx < props.currentTurnIndex
  const isFutureTurn = turnIdx > props.currentTurnIndex

  if (isPastTurn) return 'synced-word synced-word--past'
  if (isFutureTurn) return 'synced-word synced-word--future'

  if (wordIdx === activeWordIndex.value) return 'synced-word synced-word--active'
  if (wordIdx < activeWordIndex.value) return 'synced-word synced-word--spoken'
  return 'synced-word synced-word--upcoming'
}
</script>

<template>
  <div
    ref="containerRef"
    class="relative overflow-y-auto scroll-smooth"
    :style="{ maxHeight }"
    data-testid="synced-transcript"
  >
    <div
      class="synced-pill"
      :class="{ 'synced-pill--visible': pill.visible && isPlaying }"
      :style="{
        transform: `translate(${pill.x}px, ${pill.y}px)`,
        width: `${pill.w}px`,
        height: `${pill.h}px`,
      }"
    />

    <div
      v-for="(turnData, tIdx) in allTurnTimings"
      :key="tIdx"
      class="mb-4 last:mb-0 transition-colors duration-300"
      :class="{
        'rounded-lg bg-primary/5 px-3 py-2': isActiveTurn(tIdx) && isPlaying,
      }"
    >
      <span
        class="text-[10px] font-semibold uppercase tracking-wider block mb-1"
        :class="turnData.isHostA
          ? (isActiveTurn(tIdx) ? 'text-primary' : 'text-primary/50')
          : (isActiveTurn(tIdx) ? 'text-muted-foreground' : 'text-muted-foreground/50')
        "
      >{{ turnData.speakerLabel }}</span>
      <p
        class="leading-relaxed wrap-break-word overflow-wrap-anywhere"
        :class="compact ? 'text-sm' : 'text-sm sm:text-base'"
      >
        <span
          v-for="(wt, wIdx) in turnData.words"
          :key="wIdx"
          :ref="(el: any) => setWordRef(tIdx, wIdx, el)"
          :class="wordClass(tIdx, wIdx)"
          @click="handleWordClick(tIdx, wIdx)"
        >{{ wt.word }}{{ wIdx < turnData.words.length - 1 ? ' ' : '' }}</span>
      </p>
    </div>
  </div>
</template>

<style scoped>
.overflow-wrap-anywhere {
  overflow-wrap: anywhere;
}

.synced-pill {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  border-radius: 6px;
  background: color-mix(in oklch, var(--primary) 14%, transparent);
  box-shadow: 0 0 0 1px color-mix(in oklch, var(--primary) 25%, transparent);
  opacity: 0;
  transition:
    transform 0.18s cubic-bezier(0.22, 1, 0.36, 1),
    width 0.18s cubic-bezier(0.22, 1, 0.36, 1),
    height 0.15s ease,
    opacity 0.15s ease;
  z-index: 0;
}

.synced-pill--visible {
  opacity: 1;
}

.synced-word {
  position: relative;
  cursor: pointer;
  z-index: 1;
  transition: color 0.15s ease;
}

.synced-word--active {
  color: var(--color-foreground);
  font-weight: 600;
}

.synced-word--spoken {
  color: color-mix(in oklch, var(--foreground) 70%, transparent);
}

.synced-word--upcoming {
  color: color-mix(in oklch, var(--muted-foreground) 50%, transparent);
}

.synced-word--past {
  color: color-mix(in oklch, var(--foreground) 50%, transparent);
}

.synced-word--future {
  color: color-mix(in oklch, var(--muted-foreground) 40%, transparent);
}
</style>
