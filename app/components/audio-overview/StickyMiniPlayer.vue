<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { Pause, Play, Maximize2, X, Rewind, FastForward, ChevronUp, ChevronDown } from 'lucide-vue-next'

const {
  overviewId, folderId, title, activeTurn,
  isPlaying, totalDurationMs, currentTimeMs, playbackRate,
  togglePlay, skip, seek, setSpeed, dismiss,
} = useAudioOverviewStore()

const route = useRoute()
const { allFolders } = useFolders()
const expanded = ref(false)

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

const onActiveFolderRoute = computed(() => {
  const fid = folderId.value
  if (!fid) return false
  if (route.path !== `/app/folders/${fid}`) return false
  const tab = route.query?.tab
  return !tab || tab === 'chat' || tab === 'audio-overview'
})

const onPublicAudioRoute = computed(() =>
  typeof route.path === 'string' && route.path.startsWith('/audio/'),
)

const visible = computed(() =>
  import.meta.client
  && overviewId.value !== null
  && !onActiveFolderRoute.value
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
  const speaker = activeTurn.value.speaker === 'host_a' ? 'Host A' : 'Host B'
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
  void navigateTo(`/app/folders/${fid}`)
}
</script>

<template>
  <AnimatePresence mode="wait">
    <Motion
      v-if="visible"
      key="mini-player"
      :initial="{ opacity: 0, scale: 0.9, y: 20 }"
      :animate="{ opacity: 1, scale: 1, y: 0 }"
      :exit="{ opacity: 0, scale: 0.9, y: 20 }"
      :transition="{ type: 'spring', stiffness: 350, damping: 28 }"
      as="div"
      ref="floatingRef"
      data-testid="audio-overview-sticky-mini-player"
      :class="[
        'fixed z-[9999]',
        expanded
          ? 'w-80 rounded-2xl border border-border/60 bg-card shadow-lg'
          : 'w-72 rounded-full border border-border/60 bg-card shadow-lg',
        isDragging ? '' : 'transition-shadow duration-200',
      ]"
      :style="floatingStyle"
    >
      <!-- Collapsed pill — drag handle is the non-button area -->
      <div
        ref="dragHandleRef"
        class="flex cursor-grab items-center gap-2 px-3 py-2 select-none active:cursor-grabbing"
        :class="expanded ? 'border-b border-border/40' : ''"
        @pointerdown="onDragStart"
      >
        <span :class="['h-5 w-5 shrink-0 rounded-full shadow-[0_0_12px_rgba(245,158,11,0.3)]', speakerSwatchClass]" aria-hidden="true" />
        <div class="min-w-0 flex-1">
          <p data-testid="audio-overview-sticky-title" class="truncate font-dm-sans text-xs font-medium text-foreground">{{ title || 'Audio overview' }}</p>
        </div>
        <button type="button" :aria-label="isPlaying ? 'Pause' : 'Play'" class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform hover:scale-105" @click="togglePlay">
          <Pause v-if="isPlaying" class="h-3.5 w-3.5" /><Play v-else class="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          :aria-label="expanded ? 'Collapse' : 'Expand controls'"
          class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent/20 hover:text-foreground"
          @click="expanded = !expanded"
        >
          <ChevronDown v-if="expanded" class="h-3.5 w-3.5" />
          <ChevronUp v-else class="h-3.5 w-3.5" />
        </button>
        <button type="button" aria-label="Close" class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive" @click="dismiss">
          <X class="h-3.5 w-3.5" />
        </button>
      </div>

      <!-- Expanded controls -->
      <div v-if="expanded" class="space-y-2 px-3 pb-3 pt-2">
        <p class="truncate font-inter text-[10px] text-muted-foreground">{{ captionLine }}</p>

        <div class="flex items-center gap-2">
          <span class="w-8 font-inter text-[10px] tabular-nums text-muted-foreground">{{ formatMs(currentTimeMs) }}</span>
          <input
            type="range"
            min="0"
            max="1000"
            :value="Math.round(progressPercent * 10)"
            data-testid="audio-overview-sticky-scrubber"
            class="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-border/40 accent-primary"
            @input="handleScrubInput"
          />
          <span class="w-8 text-right font-inter text-[10px] tabular-nums text-muted-foreground">{{ formatMs(totalDurationMs) }}</span>
        </div>

        <div class="flex items-center justify-between">
          <div class="relative">
            <button
              type="button"
              class="inline-flex h-6 items-center gap-0.5 rounded-full border border-border/60 bg-background px-2 font-inter text-[10px] font-medium text-foreground hover:bg-accent/20"
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
            <button type="button" aria-label="Skip back 10s" class="inline-flex h-7 w-7 items-center justify-center rounded-full text-foreground hover:bg-accent/20" @click="skip(-10000)">
              <Rewind class="h-3 w-3" />
            </button>
            <button type="button" :aria-label="isPlaying ? 'Pause' : 'Play'" class="inline-flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform hover:scale-105" @click="togglePlay">
              <Pause v-if="isPlaying" class="h-4 w-4" /><Play v-else class="h-4 w-4" />
            </button>
            <button type="button" aria-label="Skip forward 10s" class="inline-flex h-7 w-7 items-center justify-center rounded-full text-foreground hover:bg-accent/20" @click="skip(10000)">
              <FastForward class="h-3 w-3" />
            </button>
          </div>
          <button
            type="button"
            data-testid="audio-overview-sticky-expand"
            aria-label="Open full player"
            class="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:bg-accent/20 hover:text-foreground"
            @click="handleExpand"
          >
            <Maximize2 class="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </Motion>
  </AnimatePresence>
</template>
