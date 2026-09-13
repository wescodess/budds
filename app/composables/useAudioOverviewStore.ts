import { reactive, computed, ref, shallowRef, toRefs } from 'vue'
import type { Id } from '../../convex/_generated/dataModel'

export interface AudioOverviewTurn {
  speaker: 'host_a' | 'host_b'
  text: string
  audioFileId?: Id<'_storage'>
  durationMs: number
  sourceIndex?: number
  wordTimings?: { word: string, start: number, end: number }[]
  utteranceId?: string
  sceneId?: string
  sourceIds?: string[]
}

export interface ContinuousPlaybackScene {
  sceneId: string
  order: number
  durationMs: number
}

export interface ContinuousPlaybackUtterance {
  utteranceId: string
  sceneId: string
  order: number
  speaker: 'host_a' | 'host_b'
  text: string
  pauseAfterMs?: number
  alignmentStartMs?: number
  sourceIds?: string[]
  wordTimings?: { word: string, start: number, end: number }[]
}

export interface InterjectionPlaybackUtterance {
  speaker: 'host_a' | 'host_b'
  text: string
  sourceIds?: string[]
}

export function buildInterjectionPlaybackTurns(
  utterances: InterjectionPlaybackUtterance[],
  totalDurationMs: number,
): AudioOverviewTurn[] {
  const total = Math.max(1, Math.round(totalDurationMs))
  const weights = utterances.map(utterance => Math.max(1, utterance.text.trim().split(/\s+/).filter(Boolean).length))
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
  let allocated = 0
  return utterances.map((utterance, index) => {
    const durationMs = index === utterances.length - 1
      ? total - allocated
      : Math.max(1, Math.round(total * weights[index]! / totalWeight))
    allocated += durationMs
    return { ...utterance, durationMs }
  })
}

export function buildContinuousPlaybackTurns(
  scenes: ContinuousPlaybackScene[],
  utterances: ContinuousPlaybackUtterance[],
  totalDurationMs: number,
): AudioOverviewTurn[] {
  const orderedScenes = [...scenes].sort((left, right) => left.order - right.order)
  const requestedTotal = Math.max(0, Math.round(totalDurationMs))
  const sceneOrderById = new Map(orderedScenes.map(scene => [String(scene.sceneId), scene.order]))
  const orderedUtterances = [...utterances].sort((left, right) =>
    (sceneOrderById.get(String(left.sceneId)) ?? Number.MAX_SAFE_INTEGER)
    - (sceneOrderById.get(String(right.sceneId)) ?? Number.MAX_SAFE_INTEGER)
    || left.order - right.order,
  )
  const hasCompleteAlignment = orderedUtterances.length > 0
    && orderedUtterances.every((utterance, index) => Number.isFinite(utterance.alignmentStartMs)
      && utterance.alignmentStartMs! >= 0
      && (index === 0 || utterance.alignmentStartMs! >= orderedUtterances[index - 1]!.alignmentStartMs!))
  if (hasCompleteAlignment) {
    return orderedUtterances.map((utterance, index) => {
      const turnStartMs = index === 0 ? 0 : Math.min(requestedTotal, utterance.alignmentStartMs!)
      const nextStartMs = index + 1 < orderedUtterances.length
        ? Math.min(requestedTotal, orderedUtterances[index + 1]!.alignmentStartMs!)
        : requestedTotal
      return {
        speaker: utterance.speaker,
        text: utterance.text,
        durationMs: Math.max(0, nextStartMs - turnStartMs),
        wordTimings: utterance.wordTimings?.map(timing => ({
          word: timing.word,
          start: Math.max(0, timing.start - turnStartMs / 1_000),
          end: Math.max(0, timing.end - turnStartMs / 1_000),
        })),
        utteranceId: utterance.utteranceId,
        sceneId: utterance.sceneId,
        sourceIds: utterance.sourceIds,
      }
    })
  }
  const sceneDurationTotal = orderedScenes.reduce((sum, scene) => sum + Math.max(0, scene.durationMs), 0)
  let allocatedEpisodeMs = 0
  const turns: AudioOverviewTurn[] = []

  orderedScenes.forEach((scene, sceneIndex) => {
    const sceneUtterances = utterances
      .filter(utterance => String(utterance.sceneId) === String(scene.sceneId))
      .sort((left, right) => left.order - right.order)
    if (sceneUtterances.length === 0) return
    const sceneDurationMs = sceneIndex === orderedScenes.length - 1
      ? Math.max(0, requestedTotal - allocatedEpisodeMs)
      : Math.min(Math.max(0, requestedTotal - allocatedEpisodeMs), Math.max(0, Math.round(sceneDurationTotal > 0
          ? requestedTotal * Math.max(0, scene.durationMs) / sceneDurationTotal
          : requestedTotal / orderedScenes.length)))
    allocatedEpisodeMs += sceneDurationMs
    const weights = sceneUtterances.map((utterance) => {
      const spokenWords = utterance.text.trim().split(/\s+/).filter(Boolean).length
      return Math.max(1, spokenWords) + Math.max(0, utterance.pauseAfterMs ?? 0) / 400
    })
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
    let allocatedSceneMs = 0
    sceneUtterances.forEach((utterance, utteranceIndex) => {
      const durationMs = utteranceIndex === sceneUtterances.length - 1
        ? Math.max(0, sceneDurationMs - allocatedSceneMs)
        : Math.max(0, Math.round(sceneDurationMs * weights[utteranceIndex]! / totalWeight))
      allocatedSceneMs += durationMs
      turns.push({
        speaker: utterance.speaker,
        text: utterance.text,
        durationMs,
        wordTimings: utterance.wordTimings,
        utteranceId: utterance.utteranceId,
        sceneId: utterance.sceneId,
        sourceIds: utterance.sourceIds,
      })
    })
  })
  return turns
}

interface State {
  overviewId: Id<'audioOverviews'> | null
  folderId: Id<'folders'> | null
  title: string
  hostNames: { hostA: string, hostB: string }
  turns: AudioOverviewTurn[]
  turnUrls: (string | null)[]
  playbackMode: 'segmented' | 'continuous'
  continuousMediaUrl: string | null
  currentTurnIndex: number
  currentAudioTimeSec: number
  isPlaying: boolean
  playbackRate: number
  isInterjectionActive: boolean
  interjectionTurns: AudioOverviewTurn[]
  interjectionCurrentTurnIndex: number
  interjectionCurrentAudioTimeSec: number
}

export function createAudioOverviewPlayback() {
  const state = reactive<State>({
    overviewId: null,
    folderId: null,
    title: '',
    hostNames: { hostA: 'Host A', hostB: 'Host B' },
    turns: [],
    turnUrls: [],
    playbackMode: 'segmented',
    continuousMediaUrl: null,
    currentTurnIndex: 0,
    currentAudioTimeSec: 0,
    isPlaying: false,
    playbackRate: 1,
    isInterjectionActive: false,
    interjectionTurns: [],
    interjectionCurrentTurnIndex: 0,
    interjectionCurrentAudioTimeSec: 0,
  })

  const audioElRef = shallowRef<HTMLAudioElement | null>(null)
  const preloadElRef = shallowRef<HTMLAudioElement | null>(null)
  const magnitude = ref(0)
  const visualizerSupported = ref(true)
  let listenersAttached = false
  let rafId: number | null = null
  let spliceApplied = false
  let interjectionSession: {
    canonicalUrl: string | null
    resumeAtMs: number
    resumeAfter: boolean
    resolve: () => void
    reject: (error: unknown) => void
  } | null = null

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

  function sourceMatches(el: HTMLAudioElement, url: string): boolean {
    if (el.src === url) return true
    try { return el.src === new URL(url, document.baseURI).href }
    catch { return false }
  }

  function syncAudioClock(absoluteTimeSec: number) {
    if (state.playbackMode !== 'continuous') {
      state.currentAudioTimeSec = absoluteTimeSec
      return
    }
    const absoluteMs = Math.max(0, Math.round(absoluteTimeSec * 1000))
    let prefixMs = 0
    for (let index = 0; index < state.turns.length; index++) {
      const durationMs = state.turns[index]!.durationMs
      if (absoluteMs < prefixMs + durationMs || index === state.turns.length - 1) {
        state.currentTurnIndex = index
        state.currentAudioTimeSec = Math.max(0, Math.min(durationMs, absoluteMs - prefixMs)) / 1000
        return
      }
      prefixMs += durationMs
    }
    state.currentTurnIndex = 0
    state.currentAudioTimeSec = 0
  }

  function syncInterjectionClock(absoluteTimeSec: number) {
    const absoluteMs = Math.max(0, Math.round(absoluteTimeSec * 1000))
    let prefixMs = 0
    for (let index = 0; index < state.interjectionTurns.length; index++) {
      const durationMs = state.interjectionTurns[index]!.durationMs
      if (absoluteMs < prefixMs + durationMs || index === state.interjectionTurns.length - 1) {
        state.interjectionCurrentTurnIndex = index
        state.interjectionCurrentAudioTimeSec = Math.max(0, Math.min(durationMs, absoluteMs - prefixMs)) / 1000
        return
      }
      prefixMs += durationMs
    }
  }

  function schedulePreload() {
    if (state.playbackMode === 'continuous') return
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
    const url = state.playbackMode === 'continuous'
      ? state.continuousMediaUrl
      : state.turnUrls[state.currentTurnIndex]
    if (!url) return
    if (!sourceMatches(el, url)) {
      el.src = url
      el.playbackRate = state.playbackRate
    }
    if (state.playbackMode === 'continuous') syncAudioClock(el.currentTime)
    else state.currentAudioTimeSec = 0
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
    const el = audioElRef.value
    if (el) {
      if (state.isInterjectionActive) syncInterjectionClock(el.currentTime)
      else syncAudioClock(el.currentTime)
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
      if (state.isInterjectionActive) syncInterjectionClock(el.currentTime)
      else syncAudioClock(el.currentTime)
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
      if (state.isInterjectionActive) {
        void restoreAfterInterjection()
        return
      }
      if (state.playbackMode === 'continuous') {
        state.isPlaying = false
        stopVisualizer()
        syncAudioClock(totalDurationMs.value / 1000)
        return
      }
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
    hostNames?: { hostA: string, hostB: string }
    turns: AudioOverviewTurn[]
    turnUrls?: (string | null)[]
    playbackMode?: 'segmented' | 'continuous'
    continuousMediaUrl?: string | null
  }) {
    if (!import.meta.client) return
    const nextMode = args.playbackMode ?? 'segmented'
    const nextContinuousUrl = nextMode === 'continuous' ? (args.continuousMediaUrl ?? null) : null
    const nextTurnUrls = nextMode === 'segmented' ? (args.turnUrls ?? []) : []
    const isSameOverview = state.overviewId === args.overviewId
    const mediaChanged = state.playbackMode !== nextMode || state.continuousMediaUrl !== nextContinuousUrl
    if (state.isInterjectionActive && isSameOverview && !mediaChanged) {
      state.title = args.title
      state.hostNames = args.hostNames ?? state.hostNames
      state.turns = args.turns
      state.turnUrls = nextTurnUrls
      return
    }
    if (!isSameOverview || mediaChanged) {
      const el = audioElRef.value
      el?.pause()
      state.overviewId = args.overviewId
      state.folderId = args.folderId
      state.title = args.title
      state.hostNames = args.hostNames ?? { hostA: 'Host A', hostB: 'Host B' }
      state.turns = args.turns
      state.turnUrls = nextTurnUrls
      state.playbackMode = nextMode
      state.continuousMediaUrl = nextContinuousUrl
      state.currentTurnIndex = 0
      state.currentAudioTimeSec = 0
      state.isPlaying = false
      spliceApplied = false
      if (el) {
        const firstUrl = nextMode === 'continuous' ? nextContinuousUrl : nextTurnUrls[0]
        if (firstUrl) el.src = firstUrl
        else el.removeAttribute('src')
        el.playbackRate = state.playbackRate
        el.load()
      }
      stopVisualizer()
      schedulePreload()
      return
    }
    state.title = args.title
    state.hostNames = args.hostNames ?? state.hostNames
    if (spliceApplied && state.playbackMode === 'segmented') return
    const absoluteTimeSec = audioElRef.value?.currentTime ?? currentTimeMs.value / 1000
    state.turns = args.turns
    state.turnUrls = nextTurnUrls
    if (state.playbackMode === 'continuous') syncAudioClock(absoluteTimeSec)
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
    if (state.isInterjectionActive) return
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
    if (state.playbackMode === 'continuous') {
      if (!state.continuousMediaUrl) return
      if (!sourceMatches(el, state.continuousMediaUrl)) el.src = state.continuousMediaUrl
      el.currentTime = clamped / 1000
      syncAudioClock(el.currentTime)
      el.playbackRate = state.playbackRate
      if (wasPlaying) void el.play().catch(() => {})
      return
    }
    const targetUrl = state.turnUrls[targetIndex]
    if (targetIndex !== state.currentTurnIndex) {
      if (!targetUrl) {
        state.currentAudioTimeSec = Math.max(0, offset / 1000)
        return
      }
      state.currentTurnIndex = targetIndex
      if (!sourceMatches(el, targetUrl)) el.src = targetUrl
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
    if (state.playbackMode === 'continuous') return
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

  async function restoreAfterInterjection() {
    const session = interjectionSession
    const el = audioElRef.value
    if (!session || !el) return
    interjectionSession = null
    state.isInterjectionActive = false
    state.isPlaying = false
    state.interjectionTurns = []
    state.interjectionCurrentTurnIndex = 0
    state.interjectionCurrentAudioTimeSec = 0
    if (session.canonicalUrl && !sourceMatches(el, session.canonicalUrl)) el.src = session.canonicalUrl
    el.load()
    if (state.playbackMode === 'continuous') {
      el.currentTime = session.resumeAtMs / 1000
      syncAudioClock(el.currentTime)
    }
    else {
      el.currentTime = state.currentAudioTimeSec
    }
    el.playbackRate = state.playbackRate
    if (session.resumeAfter) {
      try { await el.play() }
      catch { /* browser can require a new gesture; canonical position is still restored */ }
    }
    session.resolve()
  }

  function playInterjection(args: {
    mediaUrl: string
    utterances: InterjectionPlaybackUtterance[]
    totalDurationMs: number
    resumeAtMs: number
    resumeAfter: boolean
  }): Promise<void> {
    if (!import.meta.client) return Promise.resolve()
    const el = audioElRef.value
    if (!el || !state.overviewId || state.isInterjectionActive || args.utterances.length < 1) {
      return Promise.reject(new Error('Audio Interjection playback is unavailable'))
    }
    const canonicalUrl = state.playbackMode === 'continuous'
      ? state.continuousMediaUrl
      : state.turnUrls[state.currentTurnIndex] ?? null
    if (!canonicalUrl) return Promise.reject(new Error('Canonical Audio Overview media is unavailable'))
    const resumeAtMs = Math.max(0, Math.min(Math.round(args.resumeAtMs), Math.max(0, totalDurationMs.value - 10)))
    if (state.playbackMode === 'continuous') syncAudioClock(resumeAtMs / 1000)
    el.pause()
    state.isInterjectionActive = true
    state.interjectionTurns = buildInterjectionPlaybackTurns(args.utterances, args.totalDurationMs)
    state.interjectionCurrentTurnIndex = 0
    state.interjectionCurrentAudioTimeSec = 0
    el.src = args.mediaUrl
    el.currentTime = 0
    el.playbackRate = state.playbackRate
    el.load()
    return new Promise<void>((resolve, reject) => {
      interjectionSession = { canonicalUrl, resumeAtMs, resumeAfter: args.resumeAfter, resolve, reject }
      void el.play().catch(async (error) => {
        const failed = interjectionSession
        interjectionSession = null
        state.isInterjectionActive = false
        state.interjectionTurns = []
        if (canonicalUrl) el.src = canonicalUrl
        el.load()
        el.currentTime = resumeAtMs / 1000
        syncAudioClock(el.currentTime)
        failed?.reject(error)
      })
    })
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
    state.hostNames = { hostA: 'Host A', hostB: 'Host B' }
    state.turns = []
    state.turnUrls = []
    state.playbackMode = 'segmented'
    state.continuousMediaUrl = null
    state.currentTurnIndex = 0
    state.currentAudioTimeSec = 0
    state.isPlaying = false
    if (interjectionSession) {
      interjectionSession.reject(new Error('Audio Overview playback was dismissed'))
      interjectionSession = null
    }
    state.isInterjectionActive = false
    state.interjectionTurns = []
    state.interjectionCurrentTurnIndex = 0
    state.interjectionCurrentAudioTimeSec = 0
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
    playInterjection,
    dismiss,
  }
}

const singletonInstance = createAudioOverviewPlayback()

export function useAudioOverviewStore() {
  return singletonInstance
}
