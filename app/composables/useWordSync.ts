import { computed, ref, type Ref, type ComputedRef } from 'vue'

export interface WordTiming {
  word: string
  startSec: number
  endSec: number
  index: number
  turnIndex: number
}

export interface TurnWordTimings {
  turnIndex: number
  speaker: string
  speakerLabel: string
  isHostA: boolean
  words: WordTiming[]
  hasRealTimings: boolean
}

interface Turn {
  speaker: 'host_a' | 'host_b'
  text: string
  durationMs: number
  wordTimings?: { word: string, start: number, end: number }[]
}

function stripDialoguePrefix(text: string): string {
  return text.replace(/^Host [AB]:\s*/gm, '')
}

function fromRealTimings(timings: { word: string, start: number, end: number }[], turnIndex: number): WordTiming[] {
  return timings.map((wt, i) => ({
    word: wt.word,
    startSec: wt.start,
    endSec: wt.end,
    index: i,
    turnIndex,
  }))
}

const PAUSE_AFTER_SENTENCE = 0.35
const PAUSE_AFTER_COMMA = 0.15
const PAUSE_AFTER_COLON = 0.2

function trailingPauseWeight(word: string): number {
  if (/[.!?]$/.test(word)) return PAUSE_AFTER_SENTENCE
  if (/[,;]$/.test(word)) return PAUSE_AFTER_COMMA
  if (/:$/.test(word)) return PAUSE_AFTER_COLON
  return 0
}

export function estimateWordTimings(text: string, durationMs: number, turnIndex: number): WordTiming[] {
  const cleaned = stripDialoguePrefix(text)
  const words = cleaned.split(/\s+/).filter(Boolean)
  if (words.length === 0 || durationMs <= 0) return []

  const durationSec = durationMs / 1000

  const syllableWeights = words.map((w) => {
    const letters = w.replace(/[^a-zA-Z]/g, '')
    const vowelGroups = letters.match(/[aeiouy]+/gi)
    const syllables = Math.max(1, vowelGroups ? vowelGroups.length : Math.ceil(letters.length / 3))
    return syllables
  })

  const pauseWeights = words.map(w => trailingPauseWeight(w))
  const totalPauseWeight = pauseWeights.reduce((a, b) => a + b, 0)

  const pauseFraction = Math.min(0.3, totalPauseWeight / durationSec)
  const pauseBudgetSec = pauseFraction * durationSec
  const speechBudgetSec = durationSec - pauseBudgetSec

  const totalSyllables = syllableWeights.reduce((a, b) => a + b, 0)
  const totalPauseRaw = totalPauseWeight || 1

  let cursor = 0
  return words.map((word, i) => {
    const speechPortion = (syllableWeights[i]! / totalSyllables) * speechBudgetSec
    const pausePortion = (pauseWeights[i]! / totalPauseRaw) * pauseBudgetSec
    const wordDur = speechPortion + pausePortion

    const timing: WordTiming = {
      word,
      startSec: cursor,
      endSec: cursor + wordDur,
      index: i,
      turnIndex,
    }
    cursor += wordDur
    return timing
  })
}

function binarySearchActiveWord(timings: WordTiming[], timeSec: number): number {
  if (timings.length === 0) return -1
  let lo = 0
  let hi = timings.length - 1

  while (lo <= hi) {
    const mid = (lo + hi) >>> 1
    const t = timings[mid]!
    if (timeSec < t.startSec) hi = mid - 1
    else if (timeSec >= t.endSec) lo = mid + 1
    else return mid
  }

  if (lo >= timings.length) return timings.length - 1
  return Math.max(0, lo)
}

const ESTIMATION_LEAD_SEC = 0.25

export function useWordSync(
  turns: Ref<Turn[]> | ComputedRef<Turn[]>,
  currentTurnIndex: Ref<number> | ComputedRef<number>,
  currentTimeSec: Ref<number> | ComputedRef<number>,
) {
  const allTurnTimings = computed<TurnWordTimings[]>(() => {
    return turns.value.map((turn, tIdx) => {
      const isHostA = turn.speaker === 'host_a'
      const hasReal = !!turn.wordTimings && turn.wordTimings.length > 0
      return {
        turnIndex: tIdx,
        speaker: turn.speaker,
        speakerLabel: isHostA ? 'Host A · Expert' : 'Host B · Learner',
        isHostA,
        words: hasReal
          ? fromRealTimings(turn.wordTimings!, tIdx)
          : estimateWordTimings(turn.text, turn.durationMs, tIdx),
        hasRealTimings: hasReal,
      }
    })
  })

  const activeWordIndex = computed(() => {
    const tIdx = currentTurnIndex.value
    const turnData = allTurnTimings.value[tIdx]
    if (!turnData) return -1
    const offset = turnData.hasRealTimings ? 0 : ESTIMATION_LEAD_SEC
    return binarySearchActiveWord(turnData.words, currentTimeSec.value + offset)
  })

  const userScrolling = ref(false)
  let scrollTimer: ReturnType<typeof setTimeout> | null = null

  function onUserScroll() {
    userScrolling.value = true
    if (scrollTimer) clearTimeout(scrollTimer)
    scrollTimer = setTimeout(() => {
      userScrolling.value = false
    }, 3000)
  }

  return {
    allTurnTimings,
    activeWordIndex,
    userScrolling,
    onUserScroll,
  }
}
