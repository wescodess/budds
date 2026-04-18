<script setup lang="ts">
import { computed } from 'vue'
import { Pause, Play, Maximize2, X } from 'lucide-vue-next'

const {
  overviewId, folderId, title, activeTurn,
  isPlaying, totalDurationMs, currentTimeMs,
  togglePlay, dismiss,
} = useAudioOverviewStore()

const route = useRoute()
const { allFolders } = useFolders()

const onActiveFolderRoute = computed(() => {
  const fid = folderId.value
  if (!fid) return false
  return route.path === `/app/folders/${fid}`
})

const visible = computed(() =>
  import.meta.client && overviewId.value !== null && !onActiveFolderRoute.value,
)

const speakerLabel = computed(() => {
  const turn = activeTurn.value
  if (!turn) return ''
  return turn.speaker === 'host_a' ? 'Host A' : 'Host B'
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
  return `${speakerLabel.value} · ${formatMs(currentTimeMs.value)} / ${formatMs(totalDurationMs.value)}`
})

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
  <Transition
    enter-from-class="translate-y-full"
    enter-active-class="transition-transform duration-200"
    enter-to-class="translate-y-0"
    leave-from-class="translate-y-0"
    leave-active-class="transition-transform duration-200"
    leave-to-class="translate-y-full"
  >
    <div
      v-if="visible"
      data-testid="audio-overview-sticky-mini-player"
      class="fixed bottom-0 left-0 right-0 z-40 flex h-16 items-center gap-3 border-t border-border bg-card px-4 sm:gap-4 sm:px-6"
    >
      <div class="flex min-w-0 flex-1 items-center gap-3">
        <span
          :class="[
            'h-6 w-6 shrink-0 rounded-full shadow-[0_0_16px_rgba(245,158,11,0.35)]',
            speakerSwatchClass,
          ]"
          aria-hidden="true"
        />
        <div class="min-w-0 flex-1">
          <p
            data-testid="audio-overview-sticky-title"
            class="truncate font-dm-sans text-sm font-medium text-foreground"
          >
            {{ title || 'Audio overview' }}
          </p>
          <p class="truncate font-inter text-[11px] text-muted-foreground">
            {{ captionLine }}
          </p>
        </div>
      </div>

      <button
        type="button"
        data-testid="audio-overview-sticky-play"
        :aria-label="isPlaying ? 'Pause' : 'Play'"
        class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform hover:scale-[1.04]"
        @click="togglePlay"
      >
        <Pause v-if="isPlaying" class="h-4 w-4" />
        <Play v-else class="h-4 w-4" />
      </button>

      <div class="hidden items-center gap-3 sm:flex">
        <div
          class="h-0.5 overflow-hidden rounded-full bg-background"
          style="width: 120px"
        >
          <div
            data-testid="audio-overview-sticky-progress"
            class="h-full bg-primary transition-[width] duration-200"
            :style="{ width: `${progressPercent}%` }"
          />
        </div>
      </div>

      <button
        type="button"
        data-testid="audio-overview-sticky-expand"
        aria-label="Expand player"
        class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent/20 hover:text-foreground"
        @click="handleExpand"
      >
        <Maximize2 class="h-4 w-4" />
      </button>

      <button
        type="button"
        data-testid="audio-overview-sticky-close"
        aria-label="Close mini-player"
        class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        @click="dismiss"
      >
        <X class="h-4 w-4" />
      </button>
    </div>
  </Transition>
</template>
