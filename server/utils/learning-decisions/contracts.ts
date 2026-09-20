/** Provider-neutral, advisory-only learning decisions. Do not add provider wire types here. */
export const LEARNING_DECISION_MAX_ITEMS = 20
export const LEARNING_DECISION_MAX_SEMANTIC_ITEMS = 8
export const LEARNING_DECISION_MAX_QUESTION_CHARS = 1_200
export const LEARNING_DECISION_MAX_OPTION_CHARS = 400
export const LEARNING_DECISION_MAX_EVIDENCE_CHARS = 1_200
export const LEARNING_DECISION_MAX_RESPONSE_CHARS = 800
export const FREE_RESPONSE_ASSESSMENT_KIND = 'quiz.free_response_assessment.v1' as const

export const FREE_RESPONSE_RUBRIC = [
  { label: 'fully_correct', description: 'The response answers the question completely and is supported by the evidence.' },
  { label: 'partially_correct', description: 'The response contains a supported correct idea but is materially incomplete or has a minor error.' },
  { label: 'incorrect', description: 'The response is contradicted by the evidence, unsupported, or misses the requested concept.' },
  { label: 'uncertain', description: 'The evidence or response is insufficient to make a reliable assessment.' },
] as const

export type QuizQualityDecisionLabel = 'supported' | 'needs_review'
export type FreeResponseDecisionLabel = typeof FREE_RESPONSE_RUBRIC[number]['label']
export type TypedDecisionLabel = QuizQualityDecisionLabel | FreeResponseDecisionLabel

export type QuizDecisionItem = { id: string, question: string, options?: string[], correctAnswer: string }
export type FreeResponseAssessmentItem = {
  id: string
  question: string
  questionType: 'free-response' | 'fill_in_the_blank'
  expectedAnswer: string
  learnerAnswer: string
  evidenceExcerpt: string
  rubricVersion: typeof FREE_RESPONSE_ASSESSMENT_KIND
  rubric: Array<{ label: FreeResponseDecisionLabel, description: string }>
}

type RequestEnvelope = { requestId: string, inputDigest: string }
export type QuizQualityDecisionRequest = RequestEnvelope & { kind: 'quiz_quality', items: QuizDecisionItem[] }
export type FreeResponseAssessmentRequest = RequestEnvelope & { kind: typeof FREE_RESPONSE_ASSESSMENT_KIND, items: FreeResponseAssessmentItem[] }
export type TypedDecisionRequest = QuizQualityDecisionRequest | FreeResponseAssessmentRequest

export type TypedDecision = { id: string, label: TypedDecisionLabel, confidence: number, probabilities?: Record<string, number> }
export type CompletedTypedDecision = { status: 'completed', provider: string, modelRevision: string, decisions: TypedDecision[], timingMs?: number }
export type UnavailableTypedDecision = {
  status: 'unavailable'
  reason: 'disabled' | 'unconfigured' | 'timeout' | 'unavailable' | 'malformed' | 'over_budget'
  retryable: boolean
}
export type TypedDecisionResult = CompletedTypedDecision | UnavailableTypedDecision

export function unavailableDecision(reason: UnavailableTypedDecision['reason'], retryable = false): UnavailableTypedDecision {
  return { status: 'unavailable', reason, retryable }
}

export function isBoundedDecisionRequest(value: unknown): value is TypedDecisionRequest {
  if (!value || typeof value !== 'object') return false
  const request = value as Partial<TypedDecisionRequest>
  if (!hasOnlyKeys(value, ['requestId', 'inputDigest', 'kind', 'items']) || !validEnvelope(request) || !Array.isArray(request.items)) return false
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
    ? new Set<TypedDecisionLabel>(['supported', 'needs_review'])
    : new Set<TypedDecisionLabel>(FREE_RESPONSE_RUBRIC.map(item => item.label))
  return result.decisions.every(decision => isDecision(decision, labels))
    && new Set(result.decisions.map(decision => decision.id)).size === result.decisions.length
}

function validEnvelope(request: Partial<TypedDecisionRequest>): boolean {
  return typeof request.requestId === 'string' && request.requestId.length >= 1 && request.requestId.length <= 128
    && typeof request.inputDigest === 'string' && /^[a-f0-9]{64}$/.test(request.inputDigest)
}

function uniqueIds(items: unknown[]): boolean {
  return new Set(items.map(item => (item as { id?: unknown })?.id)).size === items.length
}

function isQuizQualityItem(item: unknown): item is QuizDecisionItem {
  if (!item || typeof item !== 'object' || !hasOnlyKeys(item, ['id', 'question', 'options', 'correctAnswer'])) return false
  const candidate = item as Partial<QuizDecisionItem>
  return validId(candidate.id) && validText(candidate.question, LEARNING_DECISION_MAX_QUESTION_CHARS)
    && validText(candidate.correctAnswer, LEARNING_DECISION_MAX_OPTION_CHARS)
    && (candidate.options === undefined || (Array.isArray(candidate.options) && candidate.options.length <= 8
      && candidate.options.every(option => validText(option, LEARNING_DECISION_MAX_OPTION_CHARS))))
}

function isFreeResponseItem(item: unknown): item is FreeResponseAssessmentItem {
  if (!item || typeof item !== 'object' || !hasOnlyKeys(item, ['id', 'question', 'questionType', 'expectedAnswer', 'learnerAnswer', 'evidenceExcerpt', 'rubricVersion', 'rubric'])) return false
  const candidate = item as Partial<FreeResponseAssessmentItem>
  return validId(candidate.id) && validText(candidate.question, LEARNING_DECISION_MAX_QUESTION_CHARS)
    && (candidate.questionType === 'free-response' || candidate.questionType === 'fill_in_the_blank')
    && validText(candidate.expectedAnswer, LEARNING_DECISION_MAX_OPTION_CHARS)
    && validText(candidate.learnerAnswer, LEARNING_DECISION_MAX_RESPONSE_CHARS)
    && validText(candidate.evidenceExcerpt, LEARNING_DECISION_MAX_EVIDENCE_CHARS)
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
function validId(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 64 }
function validText(value: unknown, max: number): value is string { return typeof value === 'string' && value.length > 0 && value.length <= max }
function hasOnlyKeys(value: object, allowed: string[]): boolean { return Object.keys(value).every(key => allowed.includes(key)) }
