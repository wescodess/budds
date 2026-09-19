/** Provider-neutral, advisory-only learning decisions. Do not add provider wire types here. */
export const LEARNING_DECISION_MAX_ITEMS = 20
export const LEARNING_DECISION_MAX_QUESTION_CHARS = 1_200
export const LEARNING_DECISION_MAX_OPTION_CHARS = 400

export type QuizDecisionItem = {
  id: string
  question: string
  options?: string[]
  correctAnswer: string
}

export type TypedDecisionRequest = {
  requestId: string
  inputDigest: string
  kind: 'quiz_quality'
  items: QuizDecisionItem[]
}

export type TypedDecision = {
  id: string
  label: 'supported' | 'needs_review'
  confidence: number
}

export type CompletedTypedDecision = {
  status: 'completed'
  provider: string
  modelRevision: string
  decisions: TypedDecision[]
  timingMs?: number
}

export type UnavailableTypedDecision = {
  status: 'unavailable'
  reason: 'disabled' | 'unconfigured' | 'timeout' | 'unavailable' | 'malformed' | 'over_budget'
  retryable: boolean
}

export type TypedDecisionResult = CompletedTypedDecision | UnavailableTypedDecision

export function unavailableDecision(
  reason: UnavailableTypedDecision['reason'],
  retryable = false,
): UnavailableTypedDecision {
  return { status: 'unavailable', reason, retryable }
}

export function isBoundedDecisionRequest(value: unknown): value is TypedDecisionRequest {
  if (!value || typeof value !== 'object') return false
  const request = value as Partial<TypedDecisionRequest>
  if (!hasOnlyKeys(value, ['requestId', 'inputDigest', 'kind', 'items'])) return false
  if (request.kind !== 'quiz_quality' || typeof request.requestId !== 'string' || request.requestId.length < 1 || request.requestId.length > 128 || typeof request.inputDigest !== 'string' || !/^[a-f0-9]{64}$/.test(request.inputDigest) || !Array.isArray(request.items) || request.items.length < 1 || request.items.length > LEARNING_DECISION_MAX_ITEMS) return false
  return new Set(request.items.map(item => item?.id)).size === request.items.length && request.items.every((item) => {
    if (!item || typeof item !== 'object') return false
    if (!hasOnlyKeys(item, ['id', 'question', 'options', 'correctAnswer'])) return false
    const candidate = item as Partial<QuizDecisionItem>
    return typeof candidate.id === 'string' && candidate.id.length > 0 && candidate.id.length <= 64
      && typeof candidate.question === 'string' && candidate.question.length > 0 && candidate.question.length <= LEARNING_DECISION_MAX_QUESTION_CHARS
      && typeof candidate.correctAnswer === 'string' && candidate.correctAnswer.length > 0 && candidate.correctAnswer.length <= LEARNING_DECISION_MAX_OPTION_CHARS
      && (candidate.options === undefined || (Array.isArray(candidate.options) && candidate.options.length <= 8 && candidate.options.every(option => typeof option === 'string' && option.length > 0 && option.length <= LEARNING_DECISION_MAX_OPTION_CHARS)))
  })
}

export function isCompletedTypedDecision(value: unknown): value is CompletedTypedDecision {
  if (!value || typeof value !== 'object') return false
  if (!hasOnlyKeys(value, ['status', 'provider', 'modelRevision', 'decisions', 'timingMs'])) return false
  const result = value as Partial<CompletedTypedDecision>
  return result.status === 'completed' && typeof result.provider === 'string' && result.provider.length > 0
    && typeof result.modelRevision === 'string' && result.modelRevision.length > 0
    && (result.timingMs === undefined || (typeof result.timingMs === 'number' && Number.isFinite(result.timingMs) && result.timingMs >= 0))
    && Array.isArray(result.decisions) && result.decisions.every(decision => Boolean(decision) && hasOnlyKeys(decision, ['id', 'label', 'confidence']) && typeof decision.id === 'string'
      && (decision.label === 'supported' || decision.label === 'needs_review')
      && typeof decision.confidence === 'number' && Number.isFinite(decision.confidence) && decision.confidence >= 0 && decision.confidence <= 1)
    && new Set(result.decisions.map(d => d.id)).size === result.decisions.length
}

function hasOnlyKeys(value: object, allowed: string[]): boolean {
  const keys = Object.keys(value)
  return keys.length <= allowed.length && keys.every(key => allowed.includes(key))
}
