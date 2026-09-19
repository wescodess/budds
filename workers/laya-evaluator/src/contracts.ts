export const MAX_REQUEST_BYTES = 32_000
export const MAX_BATCH_SIZE = 20
export const PINNED_MODEL_REVISION = 'f9ab0b228f0fc0f14d873dbc99038f135c2da1b2'

export type Decision = { id: string, label: 'supported' | 'needs_review', confidence: number }
export type Evaluation = { status: 'completed', provider: 'laya', modelRevision: string, decisions: Decision[] }

function itemIsValid(item: unknown): item is { id: string, question: string, correctAnswer: string, options?: string[] } {
  if (!item || typeof item !== 'object') return false
  const candidate = item as Record<string, unknown>
  return hasOnlyKeys(candidate, ['id', 'question', 'correctAnswer', 'options'])
    && typeof candidate.id === 'string' && candidate.id.length > 0 && candidate.id.length <= 64
    && typeof candidate.question === 'string' && candidate.question.length > 0 && candidate.question.length <= 1_200
    && typeof candidate.correctAnswer === 'string' && candidate.correctAnswer.length > 0 && candidate.correctAnswer.length <= 400
    && (candidate.options === undefined || (Array.isArray(candidate.options) && candidate.options.length <= 8 && candidate.options.every(option => typeof option === 'string' && option.length > 0 && option.length <= 400)))
}

export function isEvaluationRequest(value: unknown): value is { kind: 'quiz_quality', items: Array<{ id: string, question: string, correctAnswer: string, options?: string[] }> } {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return hasOnlyKeys(candidate, ['kind', 'requestId', 'inputDigest', 'items'])
    && candidate.kind === 'quiz_quality' && typeof candidate.requestId === 'string' && candidate.requestId.length > 0 && candidate.requestId.length <= 128 && typeof candidate.inputDigest === 'string' && /^[a-f0-9]{64}$/.test(candidate.inputDigest) && Array.isArray(candidate.items) && candidate.items.length > 0 && candidate.items.length <= MAX_BATCH_SIZE && new Set(candidate.items.map(item => (item as Record<string, unknown>)?.id)).size === candidate.items.length && candidate.items.every(itemIsValid)
}

export function isEvaluation(value: unknown): value is Evaluation {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return hasOnlyKeys(candidate, ['status', 'provider', 'modelRevision', 'decisions', 'timingMs'])
    && candidate.status === 'completed' && candidate.provider === 'laya' && candidate.modelRevision === PINNED_MODEL_REVISION
    && Array.isArray(candidate.decisions) && candidate.decisions.every((decision) => {
      if (!decision || typeof decision !== 'object') return false
      const item = decision as Record<string, unknown>
      return hasOnlyKeys(item, ['id', 'label', 'confidence']) && typeof item.id === 'string' && (item.label === 'supported' || item.label === 'needs_review') && typeof item.confidence === 'number' && Number.isFinite(item.confidence) && item.confidence >= 0 && item.confidence <= 1
    }) && new Set(candidate.decisions.map(decision => (decision as Record<string, unknown>).id)).size === candidate.decisions.length
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  const keys = Object.keys(value)
  return keys.length <= allowed.length && keys.every(key => allowed.includes(key))
}
