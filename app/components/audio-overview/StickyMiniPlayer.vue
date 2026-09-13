<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { Pause, Play, Maximize2, X, Rewind, FastForward, ChevronUp, ChevronDown } from '@lucide/vue'

const {
  overviewId, folderId, title, hostNames, activeTurn,
  isPlaying, totalDurationMs, currentTimeMs, playbackRate,
  shellVisible,
  togglePlay, skip, seek, setSpeed, dismiss,
} = useAudioOverviewStore()

const route = useRoute()
const { allFolders } = useFolders()
const expanded = ref(false)
const isTransitioning = ref(false)

const POSITION_KEY = 'budds.mini-player.position'
const floatingRef = ref<HTMLElement | null>(null)
const dragHandleRef = ref<HTMLElement | null>(null)
const posX = ref<number | null>(null)
const posY = ref<number | null>(null)
const isDragging = ref(false)
let dragStartX = 0
let dragStartY = 0
let dragStartPosX = 0
let dragStartPosY = 0

function getSafeAreaBottom(): number {
  if (!import.meta.client) return 0
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--vk-safe-bottom')
  return raw ? parseFloat(raw) || 0 : 0
}

function getDefaultPosition() {
  if (!import.meta.client) return { x: 0, y: 0 }
  const safeBottom = Math.max(getSafeAreaBottom(), 8)
  return {
    x: window.innerWidth - (expanded.value ? 340 : 300),
    y: window.innerHeight - (expanded.value ? 240 : 60) - safeBottom,
  }
}

function clampPosition(x: number, y: number) {
  if (!import.meta.client) return { x, y }
  const w = expanded.value ? 320 : 288
  const h = expanded.value ? 220 : 44
  const safeBottom = Math.max(getSafeAreaBottom(), 8)
  return {
    x: Math.max(8, Math.min(x, window.innerWidth - w - 8)),
    y: Math.max(8, Math.min(y, window.innerHeight - h - safeBottom)),
  }
}

function loadPosition() {
  if (!import.meta.client) return
  try {
    const raw = localStorage.getItem(POSITION_KEY)
    if (raw) {
      const { x, y } = JSON.parse(raw)
      const clamped = clampPosition(x, y)
      posX.value = clamped.x
      posY.value = clamped.y
      return
    }
  } catch { /* ignore */ }
  const def = getDefaultPosition()
  posX.value = def.x
  posY.value = def.y
}

function savePosition() {
  if (!import.meta.client || posX.value === null || posY.value === null) return
  try {
    localStorage.setItem(POSITION_KEY, JSON.stringify({ x: posX.value, y: posY.value }))
  } catch { /* ignore */ }
}

function onDragStart(e: PointerEvent) {
  if ((e.target as HTMLElement)?.closest('button, input')) return
  isDragging.value = true
  dragStartX = e.clientX
  dragStartY = e.clientY
  dragStartPosX = posX.value ?? getDefaultPosition().x
  dragStartPosY = posY.value ?? getDefaultPosition().y
  document.addEventListener('pointermove', onDragMove)
  document.addEventListener('pointerup', onDragEnd)
  e.preventDefault()
}

function onDragMove(e: PointerEvent) {
  if (!isDragging.value) return
  const dx = e.clientX - dragStartX
  const dy = e.clientY - dragStartY
  const clamped = clampPosition(dragStartPosX + dx, dragStartPosY + dy)
  posX.value = clamped.x
  posY.value = clamped.y
}

function onDragEnd() {
  isDragging.value = false
  document.removeEventListener('pointermove', onDragMove)
  document.removeEventListener('pointerup', onDragEnd)
  savePosition()
}

const floatingStyle = computed(() => {
  if (posX.value === null || posY.value === null) {
    return {
      right: '16px',
      bottom: '16px',
    }
  }
  return {
    left: `${posX.value}px`,
    top: `${posY.value}px`,
  }
})

const onPublicAudioRoute = computed(() =>
  typeof route.path === 'string' && route.path.startsWith('/audio/'),
)

const visible = computed(() =>
  import.meta.client
  && overviewId.value !== null
  && !shellVisible.value
  && !onPublicAudioRoute.value,
)

onMounted(() => { loadPosition() })

watch(visible, (v) => {
  if (v && posX.value === null) loadPosition()
})

watch(expanded, () => {
  if (posX.value !== null && posY.value !== null) {
    const clamped = clampPosition(posX.value, posY.value)
    posX.value = clamped.x
    posY.value = clamped.y
  }
})

const speakerSwatchClass = computed(() =>
  activeTurn.value?.speaker === 'host_b' ? 'bg-accent' : 'bg-primary',
)

function formatMs(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

const progressPercent = computed(() => {
  const total = totalDurationMs.value
  if (total <= 0) return 0
  return Math.max(0, Math.min(100, (currentTimeMs.value / total) * 100))
})

const captionLine = computed(() => {
  if (!activeTurn.value) return ''
  const speaker = activeTurn.value.speaker === 'host_a' ? hostNames.value.hostA : hostNames.value.hostB
  return `${speaker} · ${formatMs(currentTimeMs.value)} / ${formatMs(totalDurationMs.value)}`
})

function handleScrubInput(event: Event) {
  const target = event.target as HTMLInputElement
  const ratio = Number(target.value) / 1000
  const abs = Math.round(ratio * totalDurationMs.value)
  seek(abs)
}

const speedOptions = [1, 1.2, 1.5, 2] as const
const speedMenuOpen = ref(false)

async function handleExpand() {
  const fid = folderId.value
  if (!fid) return
  const folders = allFolders?.value
  if (Array.isArray(folders) && !folders.some((f: { _id: string }) => f._id === fid)) {
    dismiss()
    const { toast } = await import('vue-sonner')
    toast.error('This folder no longer exists.')
    void navigateTo('/')
    return
  }

  isTransitioning.value = true
  await nextTick()
  setTimeout(() => {
    navigateTo(`/app/folders/${fid}/chat`)
  }, 420)
}

watch(shellVisible, (v) => {
  if (v) isTransitioning.value = false
})
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-300 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition-opacity duration-200 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="isTransitioning"
        class="fixed inset-0 z-[9998] bg-background/80 backdrop-blur-sm"
      />
    </Transition>
  </Teleport>

  <AnimatePresence mode="wait">
    <Motion
      v-if="visible || isTransitioning"
      key="mini-player"
      ref="floatingRef"
      :initial="{ opacity: 0, scale: 0.9, y: 20 }"
      :animate="{ opacity: 1, scale: 1, y: 0 }"
      :exit="{ opacity: 0, scale: 0.9, y: 20 }"
      :transition="{ type: 'spring', stiffness: 350, damping: 28 }"
      as="div"
      data-testid="audio-overview-sticky-mini-player"
      :class="[
        'fixed z-[9999]',
        isTransitioning
          ? 'mini-player-expand rounded-2xl border border-border/60 bg-card shadow-2xl'
          : expanded
            ? 'w-80 rounded-2xl border border-border/60 bg-card shadow-lg'
            : 'w-72 rounded-full border border-border/60 bg-card shadow-lg',
        isDragging ? '' : 'transition-shadow duration-200',
      ]"
      :style="isTransitioning ? undefined : floatingStyle"
    >
      <div
        ref="dragHandleRef"
        class="flex cursor-grab items-center gap-2 px-3 py-2 select-none active:cursor-grabbing"
        :class="[
          expanded || isTransitioning ? 'border-b border-border/40' : '',
          isTransitioning ? 'py-4 px-5' : '',
        ]"
        @pointerdown="isTransitioning ? undefined : onDragStart($event)"
      >
        <span :class="['shrink-0 rounded-full', speakerSwatchClass, isTransitioning ? 'h-8 w-8 shadow-[0_0_20px_rgba(245,158,11,0.4)]' : 'h-5 w-5 shadow-[0_0_12px_rgba(245,158,11,0.3)]']" aria-hidden="true" />
        <div class="min-w-0 flex-1">
          <p data-testid="audio-overview-sticky-title" :class="['truncate font-dm-sans font-medium text-foreground', isTransitioning ? 'text-base' : 'text-xs']">{{ title || 'Audio overview' }}</p>
          <p v-if="isTransitioning" class="truncate font-inter text-xs text-muted-foreground mt-0.5">{{ captionLine }}</p>
        </div>
        <button
          v-if="!isTransitioning"
          type="button"
          :aria-label="isPlaying ? 'Pause' : 'Play'"
          class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform hover:scale-105"
          @click="togglePlay"
        >
          <Pause v-if="isPlaying" class="h-3.5 w-3.5" /><Play v-else class="h-3.5 w-3.5" />
        </button>
        <button
          v-if="!isTransitioning"
          type="button"
          :aria-label="expanded ? 'Collapse' : 'Expand controls'"
          class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent/20 hover:text-foreground"
          @click="expanded = !expanded"
        >
          <ChevronDown v-if="expanded" class="h-3.5 w-3.5" />
          <ChevronUp v-else class="h-3.5 w-3.5" />
        </button>
        <button
          v-if="!isTransitioning"
          type="button"
          aria-label="Close"
          class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          @click="dismiss"
        >
          <X class="h-3.5 w-3.5" />
        </button>
      </div>

      <div v-if="expanded || isTransitioning" :class="['space-y-2 px-3 pb-3 pt-2', isTransitioning ? 'px-5 pb-5 pt-4 space-y-4' : '']">
        <p v-if="!isTransitioning" class="truncate font-inter text-[10px] text-muted-foreground">{{ captionLine }}</p>

        <div class="flex items-center gap-2">
          <span :class="['font-inter tabular-nums text-muted-foreground', isTransitioning ? 'w-10 text-xs' : 'w-8 text-[10px]']">{{ formatMs(currentTimeMs) }}</span>
          <input
            type="range"
            min="0"
            max="1000"
            :value="Math.round(progressPercent * 10)"
            data-testid="audio-overview-sticky-scrubber"
            :class="['flex-1 cursor-pointer appearance-none rounded-full bg-border/40 accent-primary', isTransitioning ? 'h-1.5' : 'h-1']"
            @input="handleScrubInput"
          >
          <span :class="['text-right font-inter tabular-nums text-muted-foreground', isTransitioning ? 'w-10 text-xs' : 'w-8 text-[10px]']">{{ formatMs(totalDurationMs) }}</span>
        </div>

        <div class="flex items-center justify-between">
          <div class="relative">
            <button
              type="button"
              :class="[
                'inline-flex items-center gap-0.5 rounded-full border border-border/60 bg-background font-inter font-medium text-foreground hover:bg-accent/20',
                isTransitioning ? 'h-8 px-3 text-xs' : 'h-6 px-2 text-[10px]',
              ]"
              @click="speedMenuOpen = !speedMenuOpen"
            >
              {{ playbackRate }}x
            </button>
            <div
              v-if="speedMenuOpen"
              class="absolute bottom-full left-0 z-10 mb-1 min-w-16 rounded-lg border border-border/60 bg-card p-0.5 shadow-md"
            >
              <button
                v-for="opt in speedOptions"
                :key="opt"
                type="button"
                class="block w-full rounded px-2 py-1 text-left font-inter text-[10px] hover:bg-accent/20"
                :class="opt === playbackRate ? 'text-primary' : 'text-foreground'"
                @click="setSpeed(opt); speedMenuOpen = false"
              >
                {{ opt }}x
              </button>
            </div>
          </div>
          <div class="flex items-center gap-1">
            <button
              type="button"
              aria-label="Skip back 10s"
              :class="['inline-flex items-center justify-center rounded-full text-foreground hover:bg-accent/20', isTransitioning ? 'h-10 w-10' : 'h-7 w-7']"
              @click="skip(-10000)"
            >
              <Rewind :class="isTransitioning ? 'h-4 w-4' : 'h-3 w-3'" />
            </button>
            <button
              type="button"
              :aria-label="isPlaying ? 'Pause' : 'Play'"
              :class="['inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform hover:scale-105', isTransitioning ? 'h-12 w-12' : 'h-9 w-9']"
              @click="togglePlay"
            >
              <Pause v-if="isPlaying" :class="isTransitioning ? 'h-5 w-5' : 'h-4 w-4'" />
              <Play v-else :class="isTransitioning ? 'h-5 w-5' : 'h-4 w-4'" />
            </button>
            <button
              type="button"
              aria-label="Skip forward 10s"
              :class="['inline-flex items-center justify-center rounded-full text-foreground hover:bg-accent/20', isTransitioning ? 'h-10 w-10' : 'h-7 w-7']"
              @click="skip(10000)"
            >
              <FastForward :class="isTransitioning ? 'h-4 w-4' : 'h-3 w-3'" />
            </button>
          </div>
          <button
            v-if="!isTransitioning"
            type="button"
            data-testid="audio-overview-sticky-expand"
            aria-label="Open full player"
            class="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:bg-accent/20 hover:text-foreground"
            @click="handleExpand"
          >
            <Maximize2 class="h-3.5 w-3.5" />
          </button>
          <div v-else class="w-6" />
        </div>
      </div>
    </Motion>
  </AnimatePresence>
</template>

<style scoped>
.mini-player-expand {
  inset: 12px;
  width: auto;
  animation: mini-player-morph 420ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

@keyframes mini-player-morph {
  0% {
    border-radius: 1rem;
    box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1);
  }
  100% {
    border-radius: 1.25rem;
    box-shadow: 0 25px 50px -12px rgb(0 0 0 / 0.25);
  }
}
</style>
