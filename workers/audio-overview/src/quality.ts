export type AudioOverviewQualityCheckCode =
  | 'complete-pcm-frames'
  | 'non-empty-duration'
  | 'minimum-duration'
  | 'maximum-duration'
  | 'silence-ratio'
  | 'clipping-ratio'
  | 'unspoken-delivery-directions'
  | 'transcript-divergence'

export type AudioOverviewQualityCheck = {
  code: AudioOverviewQualityCheckCode
  outcome: 'accepted' | 'rejected'
  message: string
  measured?: number
  limit?: number
}

export type AudioOverviewTranscriptEvidence = {
  transcriptDivergence: number
  spokenDirections: string[]
}

type AudioOverviewTranscriptInput = {
  dialogueScript: string
  performanceNotes?: string
  expectedTranscript: string
  renderedTranscript: string
  transcriptEvidence?: never
} | {
  dialogueScript: string
  expectedTranscript?: never
  renderedTranscript?: never
  transcriptEvidence: AudioOverviewTranscriptEvidence
}

export type AudioOverviewQualityGateInput = AudioOverviewTranscriptInput & {
  pcm: Uint8Array
  expectedDurationMs: number
  thresholds?: Partial<{
    minimumDurationRatio: number
    maximumDurationRatio: number
    silenceAmplitude: number
    maximumSilenceRatio: number
    clippingAmplitude: number
    maximumClippingRatio: number
    maximumTranscriptDivergence: number
  }>
}

export type AudioOverviewQualityGateResult = {
  version: 'audio-overview-quality-gate.v2'
  decision: 'accepted' | 'rejected'
  checks: AudioOverviewQualityCheck[]
  metrics: {
    durationMs: number
    expectedDurationMs: number
    silenceRatio: number
    clippingRatio: number
    transcriptDivergence: number
    transcriptDivergenceThreshold: number
    spokenDirections: string[]
  }
}

const SAMPLE_RATE_HZ = 24_000
const BYTES_PER_SAMPLE = 2
const SILENCE_FRAME_SAMPLES = SAMPLE_RATE_HZ / 50
const DEFAULT_THRESHOLDS = {
  minimumDurationRatio: 0.8,
  maximumDurationRatio: 1.35,
  silenceAmplitude: 256,
  maximumSilenceRatio: 0.4,
  clippingAmplitude: 32_760,
  maximumClippingRatio: 0.01,
  // A Scene may contain at most 30% normalized word edits versus the
  // frozen Dialogue Script. The script remains authoritative; ASR is evidence.
  maximumTranscriptDivergence: 0.3,
} as const

export const DEFAULT_MAXIMUM_TRANSCRIPT_DIVERGENCE = DEFAULT_THRESHOLDS.maximumTranscriptDivergence

const DELIVERY_DIRECTION_TERMS = new Set([
  'breathes', 'chuckles', 'excited', 'excitedly', 'laughs', 'pause', 'pauses',
  'reflective', 'reflectively', 'sighs', 'softly', 'thoughtful', 'thoughtfully',
  'warm', 'warmly', 'whispering', 'whispers', 'with emphasis', 'with excitement',
])

function boundedRatio(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError(`${name} must be between 0 and 1`)
  return value
}

function boundedAmplitude(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 32_768) throw new RangeError(`${name} must be an integer between 0 and 32768`)
  return value
}

function normalizeSpeech(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function deliveryDirections(dialogueScript: string, performanceNotes = ''): string[] {
  const directions: string[] = []
  const seen = new Set<string>()
  const expression = /\[([^\]\n]{1,80})\]|\(([^)\n]{1,80})\)|<([^>\n]{1,80})>/g
  for (const match of dialogueScript.matchAll(expression)) {
    const normalized = normalizeSpeech(match[1] ?? match[2] ?? match[3] ?? '')
    if (!DELIVERY_DIRECTION_TERMS.has(normalized) || seen.has(normalized)) continue
    seen.add(normalized)
    directions.push(normalized)
  }
  const normalizedNotes = ` ${normalizeSpeech(performanceNotes)} `
  for (const term of DELIVERY_DIRECTION_TERMS) {
    if (!normalizedNotes.includes(` ${term} `) || seen.has(term)) continue
    seen.add(term)
    directions.push(term)
  }
  return directions
}

function normalizedWords(value: string): string[] {
  const normalized = normalizeSpeech(value)
  return normalized ? normalized.split(' ') : []
}

function normalizedWordError(expectedTranscript: string, renderedTranscript: string): number {
  const expected = normalizedWords(expectedTranscript)
  const rendered = normalizedWords(renderedTranscript)
  if (expected.length === 0) return rendered.length === 0 ? 0 : 1

  let previous = Array.from({ length: rendered.length + 1 }, (_, index) => index)
  for (let expectedIndex = 1; expectedIndex <= expected.length; expectedIndex++) {
    const current = [expectedIndex]
    for (let renderedIndex = 1; renderedIndex <= rendered.length; renderedIndex++) {
      const substitutionCost = expected[expectedIndex - 1] === rendered[renderedIndex - 1] ? 0 : 1
      current[renderedIndex] = Math.min(
        previous[renderedIndex]! + 1,
        current[renderedIndex - 1]! + 1,
        previous[renderedIndex - 1]! + substitutionCost,
      )
    }
    previous = current
  }
  return Math.min(1, previous[rendered.length]! / expected.length)
}

export function analyzeAudioOverviewTranscript(input: {
  dialogueScript: string
  performanceNotes?: string
  expectedTranscript: string
  renderedTranscript: string
}): AudioOverviewTranscriptEvidence {
  const normalizedTranscript = ` ${normalizeSpeech(input.renderedTranscript)} `
  const spokenDirections = deliveryDirections(input.dialogueScript, input.performanceNotes)
    .filter(direction => normalizedTranscript.includes(` ${direction} `))
  return {
    transcriptDivergence: normalizedWordError(input.expectedTranscript, input.renderedTranscript),
    spokenDirections,
  }
}

function transcriptEvidence(input: AudioOverviewQualityGateInput): AudioOverviewTranscriptEvidence {
  const evidence = input.transcriptEvidence ?? analyzeAudioOverviewTranscript({
    dialogueScript: input.dialogueScript,
    performanceNotes: input.performanceNotes,
    expectedTranscript: input.expectedTranscript!,
    renderedTranscript: input.renderedTranscript!,
  })
  if (!Number.isFinite(evidence.transcriptDivergence)
    || evidence.transcriptDivergence < 0 || evidence.transcriptDivergence > 1
    || !Array.isArray(evidence.spokenDirections)
    || evidence.spokenDirections.some(direction => typeof direction !== 'string')) {
    throw new RangeError('Transcript evidence is invalid')
  }
  return evidence
}

function accepted(code: AudioOverviewQualityCheckCode, message: string, measured?: number, limit?: number): AudioOverviewQualityCheck {
  return { code, outcome: 'accepted', message, measured, limit }
}

function rejected(code: AudioOverviewQualityCheckCode, message: string, measured?: number, limit?: number): AudioOverviewQualityCheck {
  return { code, outcome: 'rejected', message, measured, limit }
}

export function evaluateAudioOverviewQuality(input: AudioOverviewQualityGateInput): AudioOverviewQualityGateResult {
  if (!Number.isFinite(input.expectedDurationMs) || input.expectedDurationMs <= 0) {
    throw new RangeError('Expected Audio Artifact duration must be greater than zero')
  }

  const minimumDurationRatio = boundedRatio(
    input.thresholds?.minimumDurationRatio ?? DEFAULT_THRESHOLDS.minimumDurationRatio,
    'minimumDurationRatio',
  )
  const maximumSilenceRatio = boundedRatio(
    input.thresholds?.maximumSilenceRatio ?? DEFAULT_THRESHOLDS.maximumSilenceRatio,
    'maximumSilenceRatio',
  )
  const maximumDurationRatio = input.thresholds?.maximumDurationRatio ?? DEFAULT_THRESHOLDS.maximumDurationRatio
  if (!Number.isFinite(maximumDurationRatio) || maximumDurationRatio < 1 || maximumDurationRatio > 3) {
    throw new RangeError('maximumDurationRatio must be between 1 and 3')
  }
  const maximumClippingRatio = boundedRatio(
    input.thresholds?.maximumClippingRatio ?? DEFAULT_THRESHOLDS.maximumClippingRatio,
    'maximumClippingRatio',
  )
  const maximumTranscriptDivergence = boundedRatio(
    input.thresholds?.maximumTranscriptDivergence ?? DEFAULT_THRESHOLDS.maximumTranscriptDivergence,
    'maximumTranscriptDivergence',
  )
  const silenceAmplitude = boundedAmplitude(
    input.thresholds?.silenceAmplitude ?? DEFAULT_THRESHOLDS.silenceAmplitude,
    'silenceAmplitude',
  )
  const clippingAmplitude = boundedAmplitude(
    input.thresholds?.clippingAmplitude ?? DEFAULT_THRESHOLDS.clippingAmplitude,
    'clippingAmplitude',
  )

  const completeFrames = input.pcm.byteLength % BYTES_PER_SAMPLE === 0
  const sampleCount = Math.floor(input.pcm.byteLength / BYTES_PER_SAMPLE)
  const durationMs = sampleCount / SAMPLE_RATE_HZ * 1000
  let silentSamples = 0
  let clippedSamples = 0
  const view = new DataView(input.pcm.buffer, input.pcm.byteOffset, input.pcm.byteLength)
  for (let frameStart = 0; frameStart < sampleCount; frameStart += SILENCE_FRAME_SAMPLES) {
    const frameEnd = Math.min(sampleCount, frameStart + SILENCE_FRAME_SAMPLES)
    let squareSum = 0
    for (let sampleIndex = frameStart; sampleIndex < frameEnd; sampleIndex++) {
      const amplitude = Math.abs(view.getInt16(sampleIndex * BYTES_PER_SAMPLE, true))
      squareSum += amplitude * amplitude
      if (amplitude >= clippingAmplitude) clippedSamples += 1
    }
    const frameSamples = frameEnd - frameStart
    const rmsAmplitude = Math.sqrt(squareSum / frameSamples)
    if (rmsAmplitude <= silenceAmplitude) silentSamples += frameSamples
  }
  const silenceRatio = sampleCount === 0 ? 1 : silentSamples / sampleCount
  const clippingRatio = sampleCount === 0 ? 0 : clippedSamples / sampleCount

  const transcript = transcriptEvidence(input)
  const minimumDurationMs = input.expectedDurationMs * minimumDurationRatio
  const maximumDurationMs = input.expectedDurationMs * maximumDurationRatio

  const checks: AudioOverviewQualityCheck[] = [
    completeFrames
      ? accepted('complete-pcm-frames', 'Audio Artifact contains complete PCM frames')
      : rejected('complete-pcm-frames', 'Audio Artifact ends with a partial PCM frame'),
    durationMs > 0
      ? accepted('non-empty-duration', 'Audio Artifact has a non-empty duration', durationMs, 0)
      : rejected('non-empty-duration', 'Audio Artifact duration is empty', durationMs, 0),
    durationMs >= minimumDurationMs
      ? accepted('minimum-duration', 'Audio Artifact meets the minimum expected duration', durationMs, minimumDurationMs)
      : rejected('minimum-duration', 'Audio Artifact appears truncated', durationMs, minimumDurationMs),
    durationMs <= maximumDurationMs
      ? accepted('maximum-duration', 'Audio Artifact stays within the maximum expected duration', durationMs, maximumDurationMs)
      : rejected('maximum-duration', 'Audio Artifact tempo is unexpectedly slow', durationMs, maximumDurationMs),
    silenceRatio <= maximumSilenceRatio
      ? accepted('silence-ratio', 'Audio Artifact silence is within the allowed ratio', silenceRatio, maximumSilenceRatio)
      : rejected('silence-ratio', 'Audio Artifact contains excessive silence', silenceRatio, maximumSilenceRatio),
    clippingRatio <= maximumClippingRatio
      ? accepted('clipping-ratio', 'Audio Artifact clipping is within the allowed ratio', clippingRatio, maximumClippingRatio)
      : rejected('clipping-ratio', 'Audio Artifact contains excessive clipping', clippingRatio, maximumClippingRatio),
    transcript.spokenDirections.length === 0
      ? accepted('unspoken-delivery-directions', 'Delivery directions were performed rather than spoken')
      : rejected('unspoken-delivery-directions', `Delivery directions were spoken: ${transcript.spokenDirections.join(', ')}`),
    transcript.transcriptDivergence <= maximumTranscriptDivergence
      ? accepted(
          'transcript-divergence',
          'Observed speech stays within the normalized word-error threshold',
          transcript.transcriptDivergence,
          maximumTranscriptDivergence,
        )
      : rejected(
          'transcript-divergence',
          'Observed speech diverges from the frozen Dialogue Script',
          transcript.transcriptDivergence,
          maximumTranscriptDivergence,
        ),
  ]

  return {
    version: 'audio-overview-quality-gate.v2',
    decision: checks.some(check => check.outcome === 'rejected') ? 'rejected' : 'accepted',
    checks,
    metrics: {
      durationMs,
      expectedDurationMs: input.expectedDurationMs,
      silenceRatio,
      clippingRatio,
      transcriptDivergence: transcript.transcriptDivergence,
      transcriptDivergenceThreshold: maximumTranscriptDivergence,
      spokenDirections: transcript.spokenDirections,
    },
  }
}
