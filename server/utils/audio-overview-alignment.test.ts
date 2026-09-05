import { describe, expect, test } from 'vitest'
import { alignRecognizedWordsToScript } from './audio-overview-alignment'

describe('alignRecognizedWordsToScript', () => {
  test('keeps the immutable script words while taking timing anchors from ASR', () => {
    const aligned = alignRecognizedWordsToScript({
      utterances: [
        { utteranceId: 'u1', text: 'Cells store energy.' },
        { utteranceId: 'u2', text: 'Why does that matter?' },
      ],
      recognizedWords: [
        { word: 'cells', start: 0.1, end: 0.3 },
        { word: 'energy', start: 0.7, end: 1.1 },
        { word: 'why', start: 1.3, end: 1.5 },
        { word: 'matter', start: 2.1, end: 2.5 },
      ],
      sceneOffsetMs: 5_000,
      sceneDurationMs: 3_000,
    })

    expect(aligned.map(word => word.word).join(' ')).toBe('Cells store energy Why does that matter')
    expect(aligned[0]).toMatchObject({ utteranceId: 'u1', wordIndex: 0, startMs: 5_100, endMs: 5_300, confidence: 1 })
    expect(aligned[3]).toMatchObject({ utteranceId: 'u2', wordIndex: 0, startMs: 6_300, endMs: 6_500, confidence: 1 })
    expect(aligned.every((word, index) => index === 0 || word.startMs >= aligned[index - 1]!.endMs)).toBe(true)
  })

  test('falls back to deterministic timings when ASR has no word timestamps', () => {
    const aligned = alignRecognizedWordsToScript({
      utterances: [{ utteranceId: 'u1', text: 'One two three.' }],
      recognizedWords: [],
      sceneOffsetMs: 1_000,
      sceneDurationMs: 3_000,
    })

    expect(aligned).toEqual([
      { utteranceId: 'u1', wordIndex: 0, word: 'One', startMs: 1_000, endMs: 2_000 },
      { utteranceId: 'u1', wordIndex: 1, word: 'two', startMs: 2_000, endMs: 3_000 },
      { utteranceId: 'u1', wordIndex: 2, word: 'three', startMs: 3_000, endMs: 4_000 },
    ])
  })

  test('returns no records for invalid media bounds or empty script', () => {
    expect(alignRecognizedWordsToScript({
      utterances: [{ utteranceId: 'u1', text: '' }], recognizedWords: [], sceneOffsetMs: 0, sceneDurationMs: 1_000,
    })).toEqual([])
    expect(alignRecognizedWordsToScript({
      utterances: [{ utteranceId: 'u1', text: 'hello' }], recognizedWords: [], sceneOffsetMs: -1, sceneDurationMs: 1_000,
    })).toEqual([])
  })
})
