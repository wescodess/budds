import { describe, expect, test } from 'vitest'
import { analyzeAudioOverviewTranscript, evaluateAudioOverviewQuality } from './quality'

function pcm16(...samples: number[]): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2)
  const view = new DataView(bytes.buffer)
  samples.forEach((sample, index) => view.setInt16(index * 2, sample, true))
  return bytes
}

function outcome(result: ReturnType<typeof evaluateAudioOverviewQuality>, code: string) {
  return result.checks.find(check => check.code === code)?.outcome
}

describe('Audio Overview Quality Gate', () => {
  test('rejects an empty Audio Artifact', () => {
    const result = evaluateAudioOverviewQuality({
      pcm: new Uint8Array(),
      expectedDurationMs: 10_000,
      dialogueScript: 'Host A: A grounded explanation.',
      expectedTranscript: 'A grounded explanation.',
      renderedTranscript: 'A grounded explanation.',
    })

    expect(result.decision).toBe('rejected')
    expect(outcome(result, 'non-empty-duration')).toBe('rejected')
  })

  test('rejects an Audio Artifact shorter than the allowed share of expected duration', () => {
    const result = evaluateAudioOverviewQuality({
      pcm: pcm16(...Array.from({ length: 24_000 }, () => 4_000)),
      expectedDurationMs: 2_000,
      dialogueScript: 'Host A: A complete explanation.',
      expectedTranscript: 'A complete explanation.',
      renderedTranscript: 'A complete explanation.',
    })

    expect(result.metrics.durationMs).toBe(1000)
    expect(outcome(result, 'minimum-duration')).toBe('rejected')
  })

  test('rejects an Audio Artifact whose duration indicates excessive tempo drift', () => {
    const result = evaluateAudioOverviewQuality({
      pcm: pcm16(...Array.from({ length: 48_000 }, (_, index) => index % 2 ? 4_000 : -4_000)),
      expectedDurationMs: 1_000,
      dialogueScript: 'Host A: A concise point.',
      expectedTranscript: 'A concise point.',
      renderedTranscript: 'A concise point.',
    })

    expect(result.metrics.durationMs).toBe(2_000)
    expect(outcome(result, 'maximum-duration')).toBe('rejected')
  })

  test('rejects excessive silence', () => {
    const result = evaluateAudioOverviewQuality({
      pcm: pcm16(...Array.from({ length: 90 }, () => 0), ...Array.from({ length: 10 }, () => 4_000)),
      expectedDurationMs: 100 / 24,
      dialogueScript: 'Host A: The point.',
      expectedTranscript: 'The point.',
      renderedTranscript: 'The point.',
    })

    expect(result.metrics.silenceRatio).toBe(0.9)
    expect(outcome(result, 'silence-ratio')).toBe('rejected')
  })

  test('rejects excessive clipping', () => {
    const result = evaluateAudioOverviewQuality({
      pcm: pcm16(32_767, -32_768, 4_000, -4_000),
      expectedDurationMs: 4 / 48,
      dialogueScript: 'Host A: The point.',
      expectedTranscript: 'The point.',
      renderedTranscript: 'The point.',
    })

    expect(result.metrics.clippingRatio).toBe(0.5)
    expect(outcome(result, 'clipping-ratio')).toBe('rejected')
  })

  test('rejects delivery direction markup spoken into the rendered audio', () => {
    const result = evaluateAudioOverviewQuality({
      pcm: pcm16(4_000, -4_000, 4_000, -4_000),
      expectedDurationMs: 4 / 48,
      dialogueScript: 'Host A: [chuckles] That result is surprising. Host B: (warmly) It is.',
      expectedTranscript: 'That result is surprising. It is.',
      renderedTranscript: 'Chuckles. That result is surprising. Warmly, it is.',
    })

    expect(result.metrics.spokenDirections).toEqual(['chuckles', 'warmly'])
    expect(outcome(result, 'unspoken-delivery-directions')).toBe('rejected')
  })

  test('detects spoken directions from the actual performance notes supplied to the renderer', () => {
    const evidence = analyzeAudioOverviewTranscript({
      dialogueScript: 'Host A: This result is surprising. Host B: It changes the conclusion.',
      performanceNotes: [
        'Scene guidance: Begin reflective, then sound excited.',
        'Host A — emotion: thoughtful confidence; delivery: softly; pause after: 450 ms',
      ].join('\n'),
      expectedTranscript: 'This result is surprising. It changes the conclusion.',
      renderedTranscript: 'Reflective. This result is surprising. Softly. It changes the conclusion.',
    })

    expect(evidence.spokenDirections).toEqual(['reflective', 'softly'])
  })

  test('accepts a complete, audible, unclipped artifact whose directions were performed, not spoken', () => {
    const samples = Array.from({ length: 24_000 }, (_, index) => index % 2 === 0 ? 4_000 : -4_000)
    const result = evaluateAudioOverviewQuality({
      pcm: pcm16(...samples),
      expectedDurationMs: 1_000,
      dialogueScript: 'Host A: [chuckles] That result is surprising.',
      expectedTranscript: 'That result is surprising.',
      renderedTranscript: 'That result is surprising.',
    })

    expect(result.decision).toBe('accepted')
    expect(result.checks.every(check => check.outcome === 'accepted')).toBe(true)
  })

  test('normalizes punctuation and case before measuring transcript divergence', () => {
    const evidence = analyzeAudioOverviewTranscript({
      dialogueScript: 'Host A: We should test this carefully.',
      expectedTranscript: 'We should test this carefully.',
      renderedTranscript: 'WE SHOULD test this, carefully!',
    })

    expect(evidence.transcriptDivergence).toBe(0)
    expect(evidence.spokenDirections).toEqual([])
  })

  test('rejects a rendered transcript above the documented normalized word-error threshold', () => {
    const samples = Array.from({ length: 24_000 }, (_, index) => index % 2 === 0 ? 4_000 : -4_000)
    const result = evaluateAudioOverviewQuality({
      pcm: pcm16(...samples),
      expectedDurationMs: 1_000,
      dialogueScript: 'Host A: The mitochondria releases energy for the cell.',
      expectedTranscript: 'The mitochondria releases energy for the cell.',
      renderedTranscript: 'A bicycle waits beside the quiet river.',
    })

    expect(result.metrics.transcriptDivergence).toBe(1)
    expect(result.metrics.transcriptDivergenceThreshold).toBe(0.3)
    expect(outcome(result, 'transcript-divergence')).toBe('rejected')
    expect(result.decision).toBe('rejected')
  })
})
