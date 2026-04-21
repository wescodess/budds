import { reactive, computed, ref, shallowRef, toRefs } from 'vue'
import type { Id } from '../../convex/_generated/dataModel'

export interface AudioOverviewTurn {
  speaker: 'host_a' | 'host_b'
  text: string
  audioFileId: Id<'_storage'>
  durationMs: number
  sourceIndex?: number
}

interface State {
  overviewId: Id<'audioOverviews'> | null
  folderId: Id<'folders'> | null
  title: string
  turns: AudioOverviewTurn[]
  turnUrls: (string | null)[]
  currentTurnIndex: number
  currentAudioTimeSec: number
  isPlaying: boolean
  playbackRate: number
}

export function createAudioOverviewPlayback() {
  const state = reactive<State>({
    overviewId: null,
    folderId: null,
    title: '',
    turns: [],
    turnUrls: [],
    currentTurnIndex: 0,
    currentAudioTimeSec: 0,
    isPlaying: false,
    playbackRate: 1,
  })

  const audioElRef = shallowRef<HTMLAudioElement | null>(null)
  const preloadElRef = shallowRef<HTMLAudioElement | null>(null)
  const magnitude = ref(0)
  const visualizerSupported = ref(true)
  let listenersAttached = false
  let rafId: number | null = null
  let spliceApplied = false

  function prefixDurationMs(index: number): number {
    let acc = 0
    for (let i = 0; i < index && i < state.turns.length; i++) {
      acc += state.turns[i]!.durationMs
    }
    return acc
  }

  const totalDurationMs = computed(() =>
    state.turns.reduce((s, t) => s + t.durationMs, 0),
  )

  const currentTimeMs = computed(() =>
    prefixDurationMs(state.currentTurnIndex) + Math.round(state.currentAudioTimeSec * 1000),
  )

  const activeTurn = computed(() => state.turns[state.currentTurnIndex] ?? null)

  function schedulePreload() {
    const el = preloadElRef.value
    if (!el) return
    const next = state.currentTurnIndex + 1
    const url = state.turnUrls[next]
    if (!url) return
    if (el.src !== url) el.src = url
  }

  async function loadAndPlayCurrent() {
    const el = audioElRef.value
    if (!el) return
    const url = state.turnUrls[state.currentTurnIndex]
    if (!url) return
    if (el.src !== url) {
      el.src = url
      el.playbackRate = state.playbackRate
    }
    state.currentAudioTimeSec = 0
    try { await el.play() }
    catch { /* user gesture may be required */ }
    schedulePreload()
  }

  let visualizerStart = 0

  function visualizerTick(now: number) {
    if (!state.isPlaying) {
      rafId = null
      magnitude.value = 0
      return
    }
    const elapsed = (now - visualizerStart) / 1000
    const base = 0.55 + 0.25 * Math.sin(elapsed * 2.1)
    const jitter = 0.15 * Math.sin(elapsed * 5.3 + 1.2)
    magnitude.value = Math.max(0, Math.min(1, base + jitter))
    rafId = requestAnimationFrame(visualizerTick)
  }

  function startVisualizer() {
    if (!import.meta.client) return
    if (rafId !== null) return
    visualizerStart = typeof performance !== 'undefined' ? performance.now() : Date.now()
    rafId = requestAnimationFrame(visualizerTick)
  }

  function stopVisualizer() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    magnitude.value = 0
  }

  function setupListeners(el: HTMLAudioElement) {
    el.addEventListener('timeupdate', () => {
      state.currentAudioTimeSec = el.currentTime
    })
    el.addEventListener('play', () => {
      state.isPlaying = true
      startVisualizer()
    })
    el.addEventListener('pause', () => {
      state.isPlaying = false
      stopVisualizer()
    })
    el.addEventListener('ended', () => {
      const next = state.currentTurnIndex + 1
      if (next < state.turns.length) {
        state.currentTurnIndex = next
        void loadAndPlayCurrent()
      }
      else {
        state.isPlaying = false
        stopVisualizer()
        const finalTurn = state.turns[state.currentTurnIndex]
        state.currentAudioTimeSec = finalTurn ? finalTurn.durationMs / 1000 : 0
      }
    })
  }

  function attachAudio(el: HTMLAudioElement | null, preloadEl: HTMLAudioElement | null) {
    if (!import.meta.client) return
    audioElRef.value = el
    preloadElRef.value = preloadEl
    if (el && !listenersAttached) {
      setupListeners(el)
      listenersAttached = true
    }
  }

  function loadOverview(args: {
    overviewId: Id<'audioOverviews'>
    folderId: Id<'folders'> | null
    title: string
    turns: AudioOverviewTurn[]
    turnUrls: (string | null)[]
  }) {
    if (!import.meta.client) return
    const isSameOverview = state.overviewId === args.overviewId
    if (!isSameOverview) {
      state.overviewId = args.overviewId
      state.folderId = args.folderId
      state.title = args.title
      state.currentTurnIndex = 0
      state.currentAudioTimeSec = 0
      state.isPlaying = false
      spliceApplied = false
      const el = audioElRef.value
      if (el) {
        el.pause()
        el.removeAttribute('src')
        el.load()
      }
      stopVisualizer()
    }
    else {
      state.title = args.title
      if (spliceApplied) return
    }
    state.turns = args.turns
    state.turnUrls = args.turnUrls
  }

  async function play() {
    if (!import.meta.client) return
    const el = audioElRef.value
    if (!el) return
    if (!el.src) {
      await loadAndPlayCurrent()
      return
    }
    el.playbackRate = state.playbackRate
    try { await el.play() }
    catch { /* ignore */ }
  }

  function pause() {
    audioElRef.value?.pause()
  }

  function togglePlay() {
    if (state.isPlaying) pause()
    else void play()
  }

  function setSpeed(rate: number) {
    state.playbackRate = rate
    const el = audioElRef.value
    if (el) el.playbackRate = rate
  }

  function seek(absMs: number) {
    const total = totalDurationMs.value
    const clamped = Math.max(0, Math.min(absMs, Math.max(0, total - 10)))
    let offset = clamped
    let targetIndex = 0
    for (let i = 0; i < state.turns.length; i++) {
      const dur = state.turns[i]!.durationMs
      if (offset <= dur) { targetIndex = i; break }
      offset -= dur
      targetIndex = i + 1
    }
    if (targetIndex >= state.turns.length) targetIndex = state.turns.length - 1
    if (targetIndex < 0) targetIndex = 0
    const wasPlaying = state.isPlaying
    const el = audioElRef.value
    if (!el) return
    const targetUrl = state.turnUrls[targetIndex]
    if (targetIndex !== state.currentTurnIndex) {
      if (!targetUrl) {
        state.currentAudioTimeSec = Math.max(0, offset / 1000)
        return
      }
      state.currentTurnIndex = targetIndex
      if (el.src !== targetUrl) el.src = targetUrl
      const seekSec = Math.max(0, offset / 1000)
      el.currentTime = seekSec
      state.currentAudioTimeSec = seekSec
      el.playbackRate = state.playbackRate
      if (wasPlaying) { void el.play().catch(() => {}) }
      schedulePreload()
    }
    else {
      if (!el.src && !targetUrl) return
      const seekSec = Math.max(0, offset / 1000)
      if (el.src) {
        el.currentTime = seekSec
      }
      state.currentAudioTimeSec = seekSec
    }
  }

  function skip(deltaMs: number) {
    seek(currentTimeMs.value + deltaMs)
  }

  function spliceTurns(args: {
    afterIndex: number
    turns: AudioOverviewTurn[]
    turnUrls: (string | null)[]
  }) {
    if (!import.meta.client) return
    if (args.turns.length === 0) return
    if (args.turns.length !== args.turnUrls.length) return
    const maxIndex = state.turns.length
    const clamped = Math.max(-1, Math.min(args.afterIndex, maxIndex - 1))
    const insertAt = clamped + 1
    state.turns.splice(insertAt, 0, ...args.turns)
    state.turnUrls.splice(insertAt, 0, ...args.turnUrls)
    if (state.currentTurnIndex >= insertAt) {
      state.currentTurnIndex += args.turns.length
    }
    spliceApplied = true
  }

  function dismiss() {
    pause()
    stopVisualizer()
    const el = audioElRef.value
    if (el) {
      el.removeAttribute('src')
      el.load()
    }
    state.overviewId = null
    state.folderId = null
    state.title = ''
    state.turns = []
    state.turnUrls = []
    state.currentTurnIndex = 0
    state.currentAudioTimeSec = 0
    state.isPlaying = false
    spliceApplied = false
  }

  const shellVisible = ref(false)

  return {
    ...toRefs(state),
    audioElRef,
    preloadElRef,
    totalDurationMs,
    currentTimeMs,
    activeTurn,
    magnitude,
    visualizerSupported,
    shellVisible,
    attachAudio,
    loadOverview,
    play,
    pause,
    togglePlay,
    seek,
    skip,
    setSpeed,
    spliceTurns,
    dismiss,
  }
}

const singletonInstance = createAudioOverviewPlayback()

export function useAudioOverviewStore() {
  return singletonInstance
}
