import type { Id } from '../../convex/_generated/dataModel'

export interface OverviewTurn {
  speaker: 'host_a' | 'host_b'
  text: string
  audioFileId: Id<'_storage'>
  durationMs: number
  sourceIndex?: number
}

export interface UseAudioOverviewPlayerOptions {
  turns: Ref<OverviewTurn[]>
  turnUrls: Ref<(string | null)[]>
}

export function useAudioOverviewPlayer(options: UseAudioOverviewPlayerOptions) {
  const audioRef = ref<HTMLAudioElement | null>(null)
  const preloadRef = ref<HTMLAudioElement | null>(null)
  const currentTurnIndex = ref(0)
  const isPlaying = ref(false)
  const playbackRate = ref(1)
  const currentAudioTimeSec = ref(0)

  const totalDurationMs = computed(() =>
    options.turns.value.reduce((sum, t) => sum + t.durationMs, 0),
  )

  function prefixDurationMs(index: number): number {
    let acc = 0
    for (let i = 0; i < index && i < options.turns.value.length; i++) {
      acc += options.turns.value[i]!.durationMs
    }
    return acc
  }

  const currentTimeMs = computed(() => {
    const base = prefixDurationMs(currentTurnIndex.value)
    return base + Math.round(currentAudioTimeSec.value * 1000)
  })

  const activeTurn = computed(() => options.turns.value[currentTurnIndex.value] ?? null)

  function setupAudioListeners(el: HTMLAudioElement) {
    el.addEventListener('timeupdate', () => {
      currentAudioTimeSec.value = el.currentTime
    })
    el.addEventListener('play', () => { isPlaying.value = true })
    el.addEventListener('pause', () => { isPlaying.value = false })
    el.addEventListener('ended', () => {
      const next = currentTurnIndex.value + 1
      if (next < options.turns.value.length) {
        currentTurnIndex.value = next
        void loadAndPlay()
      }
      else {
        isPlaying.value = false
        const finalTurn = options.turns.value[currentTurnIndex.value]
        currentAudioTimeSec.value = finalTurn ? finalTurn.durationMs / 1000 : 0
      }
    })
  }

  function attach(el: HTMLAudioElement | null, preload: HTMLAudioElement | null) {
    audioRef.value = el
    preloadRef.value = preload
    if (el) setupAudioListeners(el)
  }

  async function loadAndPlay() {
    const el = audioRef.value
    if (!el) return
    const url = options.turnUrls.value[currentTurnIndex.value]
    if (!url) return
    if (el.src !== url) {
      el.src = url
      el.playbackRate = playbackRate.value
    }
    currentAudioTimeSec.value = 0
    try { await el.play() }
    catch { /* user may need a gesture first */ }
    schedulePreload()
  }

  function schedulePreload() {
    const next = currentTurnIndex.value + 1
    const nextUrl = options.turnUrls.value[next]
    if (!nextUrl || !preloadRef.value) return
    if (preloadRef.value.src !== nextUrl) preloadRef.value.src = nextUrl
  }

  async function play() {
    const el = audioRef.value
    if (!el) return
    if (!el.src) {
      await loadAndPlay()
      return
    }
    el.playbackRate = playbackRate.value
    try { await el.play() }
    catch { /* ignore */ }
  }

  function pause() {
    audioRef.value?.pause()
  }

  function setSpeed(rate: number) {
    playbackRate.value = rate
    if (audioRef.value) audioRef.value.playbackRate = rate
  }

  function skip(deltaMs: number) {
    seek(currentTimeMs.value + deltaMs)
  }

  function seek(absMs: number) {
    const total = totalDurationMs.value
    const clamped = Math.max(0, Math.min(absMs, Math.max(0, total - 10)))
    let offset = clamped
    let targetIndex = 0
    for (let i = 0; i < options.turns.value.length; i++) {
      const dur = options.turns.value[i]!.durationMs
      if (offset <= dur) {
        targetIndex = i
        break
      }
      offset -= dur
      targetIndex = i + 1
    }
    if (targetIndex >= options.turns.value.length) targetIndex = options.turns.value.length - 1
    if (targetIndex < 0) targetIndex = 0

    const wasPlaying = isPlaying.value
    if (targetIndex !== currentTurnIndex.value) {
      currentTurnIndex.value = targetIndex
      const el = audioRef.value
      const url = options.turnUrls.value[targetIndex]
      if (el && url) {
        if (el.src !== url) el.src = url
        const seekSec = Math.max(0, offset / 1000)
        el.currentTime = seekSec
        currentAudioTimeSec.value = seekSec
        el.playbackRate = playbackRate.value
        if (wasPlaying) { void el.play().catch(() => {}) }
        schedulePreload()
      }
    }
    else {
      const el = audioRef.value
      if (el) {
        const seekSec = Math.max(0, offset / 1000)
        el.currentTime = seekSec
        currentAudioTimeSec.value = seekSec
      }
    }
  }

  watch(
    () => options.turnUrls.value[currentTurnIndex.value],
    (url) => {
      if (!url) return
      const el = audioRef.value
      if (!el) return
      if (!el.src) {
        el.src = url
      }
    },
  )

  return {
    audioRef,
    preloadRef,
    attach,
    currentTurnIndex,
    isPlaying,
    playbackRate,
    currentTimeMs,
    totalDurationMs,
    activeTurn,
    play,
    pause,
    skip,
    seek,
    setSpeed,
    loadAndPlay,
  }
}
