<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue'
import { Headphones, Play, Pause, FileText, ChevronDown, ChevronUp } from 'lucide-vue-next'
import { api } from '#convex/api'
import type { Id } from '../../../convex/_generated/dataModel'

const props = defineProps<{ entityId?: string }>()

const overviewData = props.entityId
  ? useConvexQuery(
      api.audioOverviews.getCourseScopedOverview,
      computed(() => ({ id: props.entityId as Id<'audioOverviews'> })),
    )
  : { data: ref(null) }

const overview = computed(() => (overviewData.data?.value as any) ?? null)
const turns = computed(() => overview.value?.turns ?? [])
const turnUrls = computed<(string | null)[]>(() => overview.value?.turnUrls ?? [])
const sourceFilenames = computed<string[]>(() => overview.value?.sourceFilenames ?? [])

const audioEl = ref<HTMLAudioElement | null>(null)
const isPlaying = ref(false)
const currentTurnIndex = ref(0)
const currentTime = ref(0)
const transcriptExpanded = ref(false)

const totalDurationMs = computed(() => turns.value.reduce((s: number, t: any) => s + t.durationMs, 0))

function formatMs(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

const prefixDurationMs = (index: number): number => {
  let acc = 0
  for (let i = 0; i < index && i < turns.value.length; i++) {
    acc += turns.value[i]!.durationMs
  }
  return acc
}

const currentTimeMs = computed(() => prefixDurationMs(currentTurnIndex.value) + Math.round(currentTime.value * 1000))
const progressPercent = computed(() => {
  if (totalDurationMs.value <= 0) return 0
  return Math.min(100, (currentTimeMs.value / totalDurationMs.value) * 100)
})

function handleTimeUpdate() {
  if (audioEl.value) currentTime.value = audioEl.value.currentTime
}

function handleEnded() {
  const next = currentTurnIndex.value + 1
  if (next < turnUrls.value.length && turnUrls.value[next]) {
    currentTurnIndex.value = next
    playTurn(next)
  } else {
    isPlaying.value = false
    currentTurnIndex.value = 0
    currentTime.value = 0
  }
}

function playTurn(index: number) {
  const el = audioEl.value
  const url = turnUrls.value[index]
  if (!el || !url) return
  el.src = url
  el.play().catch(() => { isPlaying.value = false })
}

function togglePlay() {
  const el = audioEl.value
  if (!el) return

  if (isPlaying.value) {
    el.pause()
    isPlaying.value = false
  } else {
    const url = turnUrls.value[currentTurnIndex.value]
    if (!url) return
    if (!el.src || el.src !== url) el.src = url
    el.play().then(() => { isPlaying.value = true }).catch(() => { isPlaying.value = false })
  }
}

onUnmounted(() => {
  if (audioEl.value) {
    audioEl.value.pause()
    audioEl.value.src = ''
  }
})

function seekTo(absMs: number) {
  const el = audioEl.value
  if (!el) return
  let offset = Math.max(0, absMs)
  let targetIndex = 0
  for (let i = 0; i < turns.value.length; i++) {
    const dur = turns.value[i]!.durationMs
    if (offset <= dur) { targetIndex = i; break }
    offset -= dur
    targetIndex = i + 1
  }
  if (targetIndex >= turns.value.length) targetIndex = turns.value.length - 1
  if (targetIndex < 0) targetIndex = 0
  const wasPlaying = isPlaying.value
  if (targetIndex !== currentTurnIndex.value) {
    currentTurnIndex.value = targetIndex
    const url = turnUrls.value[targetIndex]
    if (!url) return
    el.src = url
    el.currentTime = Math.max(0, offset / 1000)
    currentTime.value = Math.max(0, offset / 1000)
    if (wasPlaying) el.play().catch(() => {})
  } else {
    el.currentTime = Math.max(0, offset / 1000)
    currentTime.value = Math.max(0, offset / 1000)
  }
}

const hasData = computed(() => !!overview.value && turns.value.length > 0)
</script>

<template>
  <div class="p-6" data-testid="audio-block">
    <div class="mb-4 flex items-center gap-2">
      <Headphones class="h-4 w-4 text-amber-500" />
      <span class="text-xs font-medium uppercase tracking-wide text-stone-400">Audio Primer</span>
    </div>

    <div v-if="!entityId || !hasData" class="flex items-center gap-4 rounded-lg border border-stone-800 bg-stone-950 p-4">
      <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-500/10">
        <Headphones class="h-5 w-5 text-amber-500" />
      </div>
      <div class="flex-1">
        <p class="text-sm text-stone-300">Audio primer loading...</p>
        <p class="text-xs text-stone-500">{{ !entityId ? 'No audio available for this section' : 'Loading audio data...' }}</p>
      </div>
    </div>

    <template v-else>
      <audio
        ref="audioEl"
        preload="auto"
        data-testid="audio-block-audio"
        @timeupdate="handleTimeUpdate"
        @ended="handleEnded"
        @play="isPlaying = true"
        @pause="isPlaying = false"
      />

      <div class="rounded-lg border border-stone-800 bg-stone-950 p-4">
        <div class="flex items-center gap-3">
          <button
            type="button"
            data-testid="audio-block-play"
            :aria-label="isPlaying ? 'Pause audio primer' : 'Play audio primer'"
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-500 text-stone-950 transition-transform hover:scale-105"
            @click="togglePlay"
          >
            <Pause v-if="isPlaying" class="h-4 w-4" />
            <Play v-else class="h-4 w-4" />
          </button>

          <div class="flex-1">
            <div class="flex items-center justify-between">
              <p class="text-sm font-medium text-stone-200">{{ overview.title }}</p>
              <span class="text-xs tabular-nums text-stone-500">{{ formatMs(currentTimeMs) }} / {{ formatMs(totalDurationMs) }}</span>
            </div>
            <div class="mt-2 h-1 w-full overflow-hidden rounded-full bg-stone-800">
              <div
                class="h-full rounded-full bg-amber-500 transition-[width] duration-200"
                :style="{ width: `${progressPercent}%` }"
                data-testid="audio-block-progress"
              />
            </div>
          </div>
        </div>
      </div>

      <div class="mt-3">
        <button
          type="button"
          data-testid="audio-block-transcript-toggle"
          :aria-expanded="transcriptExpanded"
          class="flex w-full items-center gap-2 rounded-lg border border-stone-800 bg-stone-950/50 px-4 py-2.5 text-left transition-colors hover:bg-stone-900"
          @click="transcriptExpanded = !transcriptExpanded"
        >
          <FileText class="h-3.5 w-3.5 text-stone-400" />
          <span class="flex-1 text-xs font-medium text-stone-400">Transcript</span>
          <ChevronUp v-if="transcriptExpanded" class="h-3.5 w-3.5 text-stone-500" />
          <ChevronDown v-else class="h-3.5 w-3.5 text-stone-500" />
        </button>

        <div
          v-if="transcriptExpanded"
          data-testid="audio-block-transcript"
          class="mt-1 rounded-lg border border-stone-800 bg-stone-950/30 p-4"
        >
          <AudioOverviewSyncedTranscript
            :turns="turns"
            :current-turn-index="currentTurnIndex"
            :current-time-sec="currentTime"
            :is-playing="isPlaying"
            compact
            max-height="16rem"
            :on-seek="seekTo"
          />
        </div>
      </div>

      <div v-if="sourceFilenames.length > 0" class="mt-3" data-testid="audio-block-sources">
        <p class="text-[10px] font-medium uppercase tracking-wider text-stone-500">Sources</p>
        <div class="mt-1.5 flex flex-wrap gap-1.5">
          <span
            v-for="(name, idx) in sourceFilenames"
            :key="idx"
            class="rounded border border-stone-800 bg-stone-900/50 px-2 py-0.5 text-xs text-stone-400"
          >{{ name }}</span>
        </div>
      </div>
    </template>
  </div>
</template>
