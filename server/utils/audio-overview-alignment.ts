export interface RecognizedWord {
  word: string
  start: number
  end: number
}

export interface KnownUtterance {
  utteranceId: string
  text: string
}

export interface KnownWordAlignment {
  utteranceId: string
  wordIndex: number
  word: string
  startMs: number
  endMs: number
  confidence?: number
}

type ScriptWord = KnownWordAlignment & { normalized: string, matched?: { startMs: number, endMs: number } }

function tokens(value: string): string[] {
  return value.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? []
}

function normalize(value: string): string {
  return value.normalize('NFKD').toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]+/gu, '')
}

/** Align ASR evidence onto the immutable Dialogue Script.
 *
 * The returned words always come from the known script. ASR supplies timing
 * anchors only; it never replaces or rewrites the authored transcript.
 */
export function alignRecognizedWordsToScript(args: {
  utterances: KnownUtterance[]
  recognizedWords: RecognizedWord[]
  sceneOffsetMs: number
  sceneDurationMs: number
}): KnownWordAlignment[] {
  if (!Number.isFinite(args.sceneOffsetMs) || args.sceneOffsetMs < 0
    || !Number.isFinite(args.sceneDurationMs) || args.sceneDurationMs <= 0) return []

  const script: ScriptWord[] = args.utterances.flatMap(utterance =>
    tokens(utterance.text).map((word, wordIndex) => ({
      utteranceId: utterance.utteranceId,
      wordIndex,
      word,
      normalized: normalize(word),
      startMs: 0,
      endMs: 0,
    })),
  )
  if (script.length === 0) return []

  const recognized = args.recognizedWords
    .map(word => ({
      normalized: normalize(word.word),
      startMs: Math.max(0, Math.round(word.start * 1_000)),
      endMs: Math.max(0, Math.round(word.end * 1_000)),
    }))
    .filter(word => word.normalized && word.endMs >= word.startMs && word.startMs <= args.sceneDurationMs)

  let cursor = 0
  for (const word of script) {
    const matchIndex = recognized.findIndex((candidate, index) =>
      index >= cursor && index < cursor + 16 && candidate.normalized === word.normalized,
    )
    if (matchIndex < 0) continue
    word.matched = recognized[matchIndex]
    cursor = matchIndex + 1
  }

  const duration = Math.round(args.sceneDurationMs)
  let previousEnd = 0
  for (let index = 0; index < script.length; index++) {
    const word = script[index]!
    const fallbackStart = Math.round(index / script.length * duration)
    const fallbackEnd = Math.round((index + 1) / script.length * duration)
    const start = Math.max(previousEnd, Math.min(duration, word.matched?.startMs ?? fallbackStart))
    const end = Math.max(start, Math.min(duration, word.matched?.endMs ?? fallbackEnd))
    word.startMs = args.sceneOffsetMs + start
    word.endMs = args.sceneOffsetMs + end
    if (word.matched) word.confidence = 1
    previousEnd = end
  }

  return script.map(({ normalized: _normalized, matched: _matched, ...word }) => word)
}
