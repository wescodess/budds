import manifest from '../../../workers/laya-evaluator/learningDecisionManifest.json'

/** Provider-neutral, advisory-only learning decisions. Do not add provider wire types here. */
export const LEARNING_DECISION_MANIFEST_VERSION = manifest.manifestVersion
export const LEARNING_DECISION_CONTRACT_VERSION = manifest.contractVersion
export const LEARNING_DECISION_SNAPSHOT_VERSION = manifest.snapshotVersion
export const LEARNING_DECISION_MODEL_REVISION = manifest.model.revision
export const LEARNING_DECISION_MAX_REQUEST_BYTES = manifest.limits.requestBytes
export const LEARNING_DECISION_MAX_ITEMS = manifest.limits.qualityBatchSize
export const LEARNING_DECISION_MAX_SEMANTIC_ITEMS = manifest.limits.semanticBatchSize
export const LEARNING_DECISION_MAX_REQUEST_ID_CHARS = manifest.limits.requestIdChars
export const LEARNING_DECISION_MAX_ITEM_ID_CHARS = manifest.limits.itemIdChars
export const LEARNING_DECISION_MAX_OPTION_COUNT = manifest.limits.optionCount
export const LEARNING_DECISION_MAX_QUESTION_CHARS = manifest.limits.questionChars
export const LEARNING_DECISION_MAX_OPTION_CHARS = manifest.limits.optionChars
export const LEARNING_DECISION_MAX_EVIDENCE_CHARS = manifest.limits.evidenceChars
export const LEARNING_DECISION_MAX_RESPONSE_CHARS = manifest.limits.learnerAnswerChars
export const LEARNING_DECISION_CLIENT_DEADLINE_MS = manifest.timeouts.clientDeadlineMs
export const LEARNING_DECISION_RETRY_AFTER_MIN_MS = manifest.retry.retryAfterMinMs
export const LEARNING_DECISION_RETRY_AFTER_MAX_MS = manifest.retry.retryAfterMaxMs
export const LEARNING_DECISION_MAX_ATTEMPTS = manifest.retry.maxAttempts
export const FREE_RESPONSE_ASSESSMENT_KIND = manifest.decisionKinds.freeResponse.kind as 'quiz.free_response_assessment.v1'

export const FREE_RESPONSE_RUBRIC = manifest.decisionKinds.freeResponse.rubric as ReadonlyArray<{
  label: 'fully_correct' | 'partially_correct' | 'incorrect' | 'uncertain'
  description: string
}>

export type QuizQualityDecisionLabel = 'supported' | 'needs_review'
export type FreeResponseDecisionLabel = typeof FREE_RESPONSE_RUBRIC[number]['label']
export type TypedDecisionLabel = QuizQualityDecisionLabel | FreeResponseDecisionLabel

export type SourceEvidence = { sourceIndex: number, excerpt: string }
export type QuizDecisionItem = {
  id: string
  question: string
  options?: string[]
  correctAnswer: string
  language: string
  evidence: SourceEvidence
}
export type FreeResponseAssessmentItem = {
  id: string
  question: string
  questionType: 'free-response' | 'fill_in_the_blank'
  expectedAnswer: string
  learnerAnswer: string
  evidenceExcerpt: string
  language: string
  rubricVersion: typeof FREE_RESPONSE_ASSESSMENT_KIND
  rubric: Array<{ label: FreeResponseDecisionLabel, description: string }>
}

type RequestEnvelope = {
  requestId: string
  inputDigest: string
  contractVersion: typeof LEARNING_DECISION_CONTRACT_VERSION
  snapshotVersion: typeof LEARNING_DECISION_SNAPSHOT_VERSION
}
export type QuizQualityDecisionRequest = RequestEnvelope & { kind: 'quiz_quality', items: QuizDecisionItem[] }
export type FreeResponseAssessmentRequest = RequestEnvelope & { kind: typeof FREE_RESPONSE_ASSESSMENT_KIND, items: FreeResponseAssessmentItem[] }
export type TypedDecisionRequest = QuizQualityDecisionRequest | FreeResponseAssessmentRequest

export type TypedDecision = { id: string, label: TypedDecisionLabel, confidence: number, probabilities?: Record<string, number> }
export type CompletedTypedDecision = { status: 'completed', provider: string, modelRevision: string, decisions: TypedDecision[], timingMs?: number }
export type UnavailableTypedDecision = {
  status: 'unavailable'
  reason: 'disabled' | 'unconfigured' | 'timeout' | 'unavailable' | 'malformed' | 'over_budget'
    | 'unsupported_language' | 'unknown_language' | 'missing_evidence' | 'oversized_evidence'
  retryable: boolean
  retryAfterMs?: number
}
export type TypedDecisionResult = CompletedTypedDecision | UnavailableTypedDecision

export type TypedUnavailableReason = UnavailableTypedDecision['reason']

export function unavailableDecision(reason: UnavailableTypedDecision['reason'], retryable = false, retryAfterMs?: number): UnavailableTypedDecision {
  return { status: 'unavailable', reason, retryable, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) }
}

export function preflightUnavailable(request: TypedDecisionRequest): UnavailableTypedDecision | null {
  if (request.items.length === 0
    || request.items.length > (request.kind === 'quiz_quality' ? LEARNING_DECISION_MAX_ITEMS : LEARNING_DECISION_MAX_SEMANTIC_ITEMS)) {
    return unavailableDecision('over_budget')
  }
  if (request.kind === 'quiz_quality') {
    for (const item of request.items) {
      const language = normalizeDecisionLanguage(item.language)
      if (!language) return unavailableDecision('unknown_language')
      if (!isSupportedEnglish(language)) return unavailableDecision('unsupported_language')
      if (typeof item.evidence?.excerpt !== 'string' || item.evidence.excerpt.trim().length === 0) return unavailableDecision('missing_evidence')
      if (item.evidence.excerpt.length > LEARNING_DECISION_MAX_EVIDENCE_CHARS) return unavailableDecision('oversized_evidence')
    }
  }
  else {
    for (const item of request.items) {
      const language = normalizeDecisionLanguage(item.language)
      if (!language) return unavailableDecision('unknown_language')
      if (!isSupportedEnglish(language)) return unavailableDecision('unsupported_language')
      if (typeof item.evidenceExcerpt !== 'string' || item.evidenceExcerpt.trim().length === 0) return unavailableDecision('missing_evidence')
      if (item.evidenceExcerpt.length > LEARNING_DECISION_MAX_EVIDENCE_CHARS) return unavailableDecision('oversized_evidence')
    }
  }
  if (new TextEncoder().encode(JSON.stringify(request)).byteLength > LEARNING_DECISION_MAX_REQUEST_BYTES) {
    return unavailableDecision('over_budget')
  }
  return null
}

export function isBoundedDecisionRequest(value: unknown): value is TypedDecisionRequest {
  if (!value || typeof value !== 'object') return false
  const request = value as Partial<TypedDecisionRequest>
  if (!hasOnlyKeys(value, ['requestId', 'inputDigest', 'contractVersion', 'snapshotVersion', 'kind', 'items']) || !validEnvelope(request) || !Array.isArray(request.items)) return false
  if (request.kind === 'quiz_quality') {
    return request.items.length >= 1 && request.items.length <= LEARNING_DECISION_MAX_ITEMS
      && uniqueIds(request.items) && request.items.every(isQuizQualityItem)
  }
  if (request.kind === FREE_RESPONSE_ASSESSMENT_KIND) {
    return request.items.length >= 1 && request.items.length <= LEARNING_DECISION_MAX_SEMANTIC_ITEMS
      && uniqueIds(request.items) && request.items.every(isFreeResponseItem)
  }
  return false
}

export function isCompletedTypedDecision(value: unknown, kind: TypedDecisionRequest['kind']): value is CompletedTypedDecision {
  if (!value || typeof value !== 'object' || !hasOnlyKeys(value, ['status', 'provider', 'modelRevision', 'decisions', 'timingMs'])) return false
  const result = value as Partial<CompletedTypedDecision>
  if (result.status !== 'completed' || typeof result.provider !== 'string' || result.provider.length < 1
    || typeof result.modelRevision !== 'string' || result.modelRevision.length < 1
    || (result.timingMs !== undefined && (typeof result.timingMs !== 'number' || !Number.isFinite(result.timingMs) || result.timingMs < 0))
    || !Array.isArray(result.decisions)) return false
  const labels = kind === 'quiz_quality'
    ? new Set<TypedDecisionLabel>(manifest.decisionKinds.quizQuality.labels as QuizQualityDecisionLabel[])
    : new Set<TypedDecisionLabel>(FREE_RESPONSE_RUBRIC.map(item => item.label))
  return result.decisions.every(decision => isDecision(decision, labels))
    && new Set(result.decisions.map(decision => decision.id)).size === result.decisions.length
}

function validEnvelope(request: Partial<TypedDecisionRequest>): boolean {
  return typeof request.requestId === 'string' && request.requestId.length >= 1 && request.requestId.length <= LEARNING_DECISION_MAX_REQUEST_ID_CHARS
    && typeof request.inputDigest === 'string' && /^[a-f0-9]{64}$/.test(request.inputDigest)
    && request.contractVersion === LEARNING_DECISION_CONTRACT_VERSION
    && request.snapshotVersion === LEARNING_DECISION_SNAPSHOT_VERSION
}

function uniqueIds(items: unknown[]): boolean {
  return new Set(items.map(item => (item as { id?: unknown })?.id)).size === items.length
}

function isQuizQualityItem(item: unknown): item is QuizDecisionItem {
  if (!item || typeof item !== 'object' || !hasOnlyKeys(item, ['id', 'question', 'options', 'correctAnswer', 'language', 'evidence'])) return false
  const candidate = item as Partial<QuizDecisionItem>
  return validId(candidate.id) && validText(candidate.question, LEARNING_DECISION_MAX_QUESTION_CHARS)
    && validText(candidate.correctAnswer, LEARNING_DECISION_MAX_OPTION_CHARS)
    && isSupportedEnglish(candidate.language)
    && isSourceEvidence(candidate.evidence)
    && (candidate.options === undefined || (Array.isArray(candidate.options) && candidate.options.length <= LEARNING_DECISION_MAX_OPTION_COUNT
      && candidate.options.every(option => validText(option, LEARNING_DECISION_MAX_OPTION_CHARS))))
}

function isFreeResponseItem(item: unknown): item is FreeResponseAssessmentItem {
  if (!item || typeof item !== 'object' || !hasOnlyKeys(item, ['id', 'question', 'questionType', 'expectedAnswer', 'learnerAnswer', 'evidenceExcerpt', 'language', 'rubricVersion', 'rubric'])) return false
  const candidate = item as Partial<FreeResponseAssessmentItem>
  return validId(candidate.id) && validText(candidate.question, LEARNING_DECISION_MAX_QUESTION_CHARS)
    && (candidate.questionType === 'free-response' || candidate.questionType === 'fill_in_the_blank')
    && validText(candidate.expectedAnswer, LEARNING_DECISION_MAX_OPTION_CHARS)
    && validText(candidate.learnerAnswer, LEARNING_DECISION_MAX_RESPONSE_CHARS)
    && validText(candidate.evidenceExcerpt, LEARNING_DECISION_MAX_EVIDENCE_CHARS)
    && isSupportedEnglish(candidate.language)
    && candidate.rubricVersion === FREE_RESPONSE_ASSESSMENT_KIND
    && Array.isArray(candidate.rubric) && candidate.rubric.length === FREE_RESPONSE_RUBRIC.length
    && candidate.rubric.every((entry, index) => entry?.label === FREE_RESPONSE_RUBRIC[index]!.label
      && entry.description === FREE_RESPONSE_RUBRIC[index]!.description)
}

function isDecision(value: unknown, labels: Set<TypedDecisionLabel>): value is TypedDecision {
  if (!value || typeof value !== 'object' || !hasOnlyKeys(value, ['id', 'label', 'confidence', 'probabilities'])) return false
  const decision = value as Partial<TypedDecision>
  return validId(decision.id) && typeof decision.label === 'string' && labels.has(decision.label as TypedDecisionLabel)
    && validProbability(decision.confidence)
    && (decision.probabilities === undefined || isProbabilityRecord(decision.probabilities, labels, decision.label as TypedDecisionLabel))
}

function isProbabilityRecord(value: unknown, labels: Set<TypedDecisionLabel>, selectedLabel: TypedDecisionLabel): value is Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  if (keys.length !== labels.size || !keys.every(label => labels.has(label as TypedDecisionLabel)) || !Object.values(record).every(validProbability)) return false
  const probabilities = Object.values(record) as number[]
  return Math.abs(probabilities.reduce((sum, probability) => sum + probability, 0) - 1) <= 0.001
    && typeof record[selectedLabel] === 'number' && record[selectedLabel] >= Math.max(...probabilities)
}
function validProbability(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 }
function validId(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= LEARNING_DECISION_MAX_ITEM_ID_CHARS }
function validText(value: unknown, max: number): value is string { return typeof value === 'string' && value.length > 0 && value.length <= max }
function hasOnlyKeys(value: object, allowed: string[]): boolean { return Object.keys(value).every(key => allowed.includes(key)) }

function isSourceEvidence(value: unknown): value is SourceEvidence {
  if (!value || typeof value !== 'object' || !hasOnlyKeys(value, ['sourceIndex', 'excerpt'])) return false
  const evidence = value as Partial<SourceEvidence>
  return Number.isSafeInteger(evidence.sourceIndex) && (evidence.sourceIndex ?? -1) >= 0
    && validText(evidence.excerpt, LEARNING_DECISION_MAX_EVIDENCE_CHARS)
}

export function normalizeDecisionLanguage(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null
  return value.trim().toLowerCase().replaceAll('_', '-')
}

export function isSupportedEnglish(value: unknown): value is string {
  const normalized = normalizeDecisionLanguage(value)
  return normalized !== null && manifest.supportedLanguages.some(pattern => pattern.endsWith('*')
    ? normalized.startsWith(pattern.slice(0, -1))
    : normalized === pattern)
}
