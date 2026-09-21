import {
  ADAPTIVE_ACTIVITY_CONTRACT_VERSION,
  ADAPTIVE_ACTIVITY_FALLBACK_VERSION,
  ADAPTIVE_ACTIVITY_RENDERER_VERSION,
  ADAPTIVE_ACTIVITY_SEQUENCE_VALIDATION_ANALYTICS_VERSION,
  ADAPTIVE_ACTIVITY_VALIDATION_ANALYTICS_VERSION,
  type ValidatedAdaptiveActivityPrimitive,
  validateAdaptiveActivityPrimitiveSequence,
} from './learn-adaptive-activity-registry'

export const ADAPTIVE_ACTIVITY_PLAN_VERSION = 'learn-adaptive.activity-plan.v1' as const
export const ADAPTIVE_ACTIVITY_REPLAY_VERSION = 'learn-adaptive.activity-replay.v1' as const

export type AdaptiveLearningIntent = 'understand' | 'prepare' | 'build' | 'master' | 'refresh' | 'explore'
export type AdaptiveAvailableTime = '15' | '25' | '45' | '60' | 'no_limit'
export type AdaptiveEvidenceState = 'none' | 'preparing' | 'ready' | 'blocked' | 'stale' | 'invalidated' | 'unavailable'
export type AdaptiveActivityClass = 'factual' | 'non_factual'

export type AdaptiveActivityEvidenceReference = {
  claimId: string
  supportId: string
  sourceSnapshotId: string
  sourceSnapshotRevision: number
  sourceRecordRevision: number
  verifierVersion: string
  integrityState: 'accepted'
}

export type AdaptiveActivityPlanInput = {
  activityId: string
  threadId: string
  boundaryOrdinal: number
  planRevision: number
  activityClass: AdaptiveActivityClass
  intent: AdaptiveLearningIntent
  objectiveId: string | null
  purpose: string
  reasonCode: string
  primitiveSequence: unknown
  requiredAction: { kind: string, label: string }
  evaluationContract: {
    version: string
    kind: 'acknowledgement' | 'learner_response' | 'server_scored'
    responseFormat: 'none' | 'short_text' | 'long_text' | 'structured'
    passingScorePercent: number | null
  }
  accessibilityMetadata: {
    heading: string
    instructions: string
    focusTargetTestId: string
    liveRegionMode: 'off' | 'polite' | 'assertive'
  }
  pins: {
    learningVoidId: string | null
    blueprintRevisionId: string | null
    objectiveId: string | null
    sessionContentId: string | null
  }
  evidenceReferences: AdaptiveActivityEvidenceReference[]
  generationInputs: {
    sessionContentRevision: number | null
    sessionContentInputDigest: string | null
    generatorVersion: string | null
  }
  decisionInputs: {
    availableTime: AdaptiveAvailableTime
    sourceState: AdaptiveEvidenceState
    priorActivityId: string | null
    priorOutcome: string | null
    assistance: 'none' | 'hint' | 'reveal'
    confidence: number | null
  }
  replacesActivityId?: string
}

export type ComposedAdaptiveActivityPlan = Omit<AdaptiveActivityPlanInput, 'primitiveSequence' | 'replacesActivityId'> & {
  planVersion: typeof ADAPTIVE_ACTIVITY_PLAN_VERSION
  replayVersion: typeof ADAPTIVE_ACTIVITY_REPLAY_VERSION
  contractVersion: typeof ADAPTIVE_ACTIVITY_CONTRACT_VERSION
  rendererVersion: typeof ADAPTIVE_ACTIVITY_RENDERER_VERSION
  validationVersion: typeof ADAPTIVE_ACTIVITY_VALIDATION_ANALYTICS_VERSION
  sequenceValidationVersion: typeof ADAPTIVE_ACTIVITY_SEQUENCE_VALIDATION_ANALYTICS_VERSION
  fallbackVersion: typeof ADAPTIVE_ACTIVITY_FALLBACK_VERSION
  primitivePlan: ValidatedAdaptiveActivityPrimitive[]
  fallback: {
    version: typeof ADAPTIVE_ACTIVITY_FALLBACK_VERSION
    kind: 'text_card'
    title: string
    body: string
    primaryAction: { type: 'continue_safe', label: string }
    testId: 'learn-activity-fallback'
  }
  replacesActivityId: string | null
  canonicalInputSnapshot: string
  inputDigest: string
}

function boundedText(value: string, label: string, maximum: number) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\p{Cc}\p{Cf}]/u.test(value)) {
    throw new Error(`${label} is invalid`)
  }
  return value.trim()
}

function positiveInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} is invalid`)
  return value
}

export function canonicalAdaptiveActivityJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Canonical activity input contains a non-finite number')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalAdaptiveActivityJson).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalAdaptiveActivityJson(record[key])}`).join(',')}}`
  }
  throw new Error('Canonical activity input contains an unsupported value')
}

async function sha256(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
  return `sha256:${[...digest].map(byte => byte.toString(16).padStart(2, '0')).join('')}`
}

function validateEvidence(input: AdaptiveActivityPlanInput) {
  if (input.evidenceReferences.length > 16) throw new Error('Activity evidence exceeds the maximum of 16 references')
  const keys = new Set<string>()
  const evidenceReferences = input.evidenceReferences.map((reference) => {
    const validated = {
      claimId: boundedText(reference.claimId, 'Claim reference', 200),
      supportId: boundedText(reference.supportId, 'Support reference', 200),
      sourceSnapshotId: boundedText(reference.sourceSnapshotId, 'Source snapshot reference', 200),
      sourceSnapshotRevision: positiveInteger(reference.sourceSnapshotRevision, 'Source snapshot revision'),
      sourceRecordRevision: positiveInteger(reference.sourceRecordRevision, 'Source record revision'),
      verifierVersion: boundedText(reference.verifierVersion, 'Evidence verifier version', 120),
      integrityState: reference.integrityState,
    }
    if (validated.integrityState !== 'accepted') throw new Error('Factual activity requires accepted evidence')
    const key = `${validated.claimId}\u0000${validated.supportId}\u0000${validated.sourceSnapshotId}`
    if (keys.has(key)) throw new Error('Activity evidence references must be unique')
    keys.add(key)
    return validated
  })
  if (input.activityClass === 'factual' && evidenceReferences.length === 0) throw new Error('Factual activity requires accepted evidence')
  if (input.activityClass === 'non_factual' && evidenceReferences.length > 0) throw new Error('Non-factual activity cannot cite evidence')
  return evidenceReferences
}

export async function composeAdaptiveActivityPlan(input: AdaptiveActivityPlanInput): Promise<ComposedAdaptiveActivityPlan> {
  const evidenceReferences = validateEvidence(input)
  const factualPins = Object.values(input.pins).every(value => typeof value === 'string' && value.length > 0)
  if (input.activityClass === 'factual' && (!factualPins || input.objectiveId !== input.pins.objectiveId)) {
    throw new Error('Factual activity requires complete matching V2 pins')
  }
  if (input.activityClass === 'factual' && (input.generationInputs.sessionContentRevision === null || input.generationInputs.sessionContentInputDigest === null || input.generationInputs.generatorVersion === null)) {
    throw new Error('Factual activity requires complete generation inputs')
  }
  if (input.activityClass === 'non_factual' && input.objectiveId !== null) throw new Error('Non-factual activity cannot target an objective')

  const evidenceContext = Object.fromEntries(evidenceReferences.map(reference => [reference.sourceSnapshotId, { integrityState: reference.integrityState }]))
  const primitiveResult = validateAdaptiveActivityPrimitiveSequence(input.primitiveSequence, evidenceContext)
  if (!primitiveResult.ok) throw new Error(`Primitive sequence is invalid: ${primitiveResult.error.code}`)

  const passingScorePercent = input.evaluationContract.passingScorePercent
  if (passingScorePercent !== null && (!Number.isSafeInteger(passingScorePercent) || passingScorePercent < 0 || passingScorePercent > 100)) {
    throw new Error('Evaluation passing score is invalid')
  }
  if (input.decisionInputs.confidence !== null && (!Number.isFinite(input.decisionInputs.confidence) || input.decisionInputs.confidence < 0 || input.decisionInputs.confidence > 1)) {
    throw new Error('Decision confidence is invalid')
  }

  const core = {
    planVersion: ADAPTIVE_ACTIVITY_PLAN_VERSION,
    replayVersion: ADAPTIVE_ACTIVITY_REPLAY_VERSION,
    contractVersion: ADAPTIVE_ACTIVITY_CONTRACT_VERSION,
    rendererVersion: ADAPTIVE_ACTIVITY_RENDERER_VERSION,
    validationVersion: ADAPTIVE_ACTIVITY_VALIDATION_ANALYTICS_VERSION,
    sequenceValidationVersion: ADAPTIVE_ACTIVITY_SEQUENCE_VALIDATION_ANALYTICS_VERSION,
    fallbackVersion: ADAPTIVE_ACTIVITY_FALLBACK_VERSION,
    activityId: boundedText(input.activityId, 'Activity identity', 160),
    threadId: boundedText(input.threadId, 'Thread identity', 200),
    boundaryOrdinal: positiveInteger(input.boundaryOrdinal, 'Boundary ordinal'),
    planRevision: positiveInteger(input.planRevision, 'Plan revision'),
    activityClass: input.activityClass,
    intent: input.intent,
    objectiveId: input.objectiveId === null ? null : boundedText(input.objectiveId, 'Objective identity', 200),
    purpose: boundedText(input.purpose, 'Activity purpose', 1_000),
    reasonCode: boundedText(input.reasonCode, 'Activity reason code', 120),
    primitivePlan: primitiveResult.value.primitives,
    requiredAction: {
      kind: boundedText(input.requiredAction.kind, 'Required action kind', 80),
      label: boundedText(input.requiredAction.label, 'Required action label', 160),
    },
    evaluationContract: {
      version: boundedText(input.evaluationContract.version, 'Evaluation version', 120),
      kind: input.evaluationContract.kind,
      responseFormat: input.evaluationContract.responseFormat,
      passingScorePercent,
    },
    fallback: {
      version: ADAPTIVE_ACTIVITY_FALLBACK_VERSION,
      kind: 'text_card' as const,
      title: 'Activity unavailable',
      body: 'This activity could not be replayed safely.',
      primaryAction: { type: 'continue_safe' as const, label: 'Continue safely' },
      testId: 'learn-activity-fallback' as const,
    },
    accessibilityMetadata: {
      heading: boundedText(input.accessibilityMetadata.heading, 'Accessibility heading', 200),
      instructions: boundedText(input.accessibilityMetadata.instructions, 'Accessibility instructions', 1_000),
      focusTargetTestId: boundedText(input.accessibilityMetadata.focusTargetTestId, 'Accessibility focus target', 160),
      liveRegionMode: input.accessibilityMetadata.liveRegionMode,
    },
    pins: {
      learningVoidId: input.pins.learningVoidId,
      blueprintRevisionId: input.pins.blueprintRevisionId,
      objectiveId: input.pins.objectiveId,
      sessionContentId: input.pins.sessionContentId,
    },
    evidenceReferences,
    generationInputs: {
      sessionContentRevision: input.generationInputs.sessionContentRevision === null ? null : positiveInteger(input.generationInputs.sessionContentRevision, 'Session content revision'),
      sessionContentInputDigest: input.generationInputs.sessionContentInputDigest === null ? null : boundedText(input.generationInputs.sessionContentInputDigest, 'Session content input digest', 160),
      generatorVersion: input.generationInputs.generatorVersion === null ? null : boundedText(input.generationInputs.generatorVersion, 'Generator version', 120),
    },
    decisionInputs: {
      availableTime: input.decisionInputs.availableTime,
      sourceState: input.decisionInputs.sourceState,
      priorActivityId: input.decisionInputs.priorActivityId,
      priorOutcome: input.decisionInputs.priorOutcome === null ? null : boundedText(input.decisionInputs.priorOutcome, 'Prior outcome', 120),
      assistance: input.decisionInputs.assistance,
      confidence: input.decisionInputs.confidence,
    },
    replacesActivityId: input.replacesActivityId ? boundedText(input.replacesActivityId, 'Replacement activity identity', 160) : null,
  }
  const canonicalInputSnapshot = canonicalAdaptiveActivityJson(core)
  if (canonicalInputSnapshot.length > 32_000) throw new Error('Canonical activity input exceeds 32000 characters')
  return { ...core, canonicalInputSnapshot, inputDigest: await sha256(canonicalInputSnapshot) }
}

export async function replayAdaptiveActivityPlan(candidate: ComposedAdaptiveActivityPlan) {
  try {
    const { canonicalInputSnapshot, inputDigest, ...core } = candidate
    if (canonicalAdaptiveActivityJson(core) !== canonicalInputSnapshot) return { ok: false as const, reason: 'replay_integrity_failed' as const }
    if (await sha256(canonicalInputSnapshot) !== inputDigest) return { ok: false as const, reason: 'replay_integrity_failed' as const }
    return { ok: true as const, value: candidate }
  }
  catch {
    return { ok: false as const, reason: 'replay_integrity_failed' as const }
  }
}
