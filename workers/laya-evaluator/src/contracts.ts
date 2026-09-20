export const MAX_REQUEST_BYTES = 32_000
export const MAX_BATCH_SIZE = 20
export const MAX_SEMANTIC_BATCH_SIZE = 8
export const PINNED_MODEL_REVISION = 'f9ab0b228f0fc0f14d873dbc99038f135c2da1b2'
export const FREE_RESPONSE_ASSESSMENT_KIND = 'quiz.free_response_assessment.v1'

const qualityLabels = new Set(['supported', 'needs_review'])
const semanticLabels = new Set(['fully_correct', 'partially_correct', 'incorrect', 'uncertain'])
const semanticRubric = [
  ['fully_correct', 'The response answers the question completely and is supported by the evidence.'],
  ['partially_correct', 'The response contains a supported correct idea but is materially incomplete or has a minor error.'],
  ['incorrect', 'The response is contradicted by the evidence, unsupported, or misses the requested concept.'],
  ['uncertain', 'The evidence or response is insufficient to make a reliable assessment.'],
] as const

export type EvaluationKind = 'quiz_quality' | typeof FREE_RESPONSE_ASSESSMENT_KIND
export type Decision = { id: string, label: string, confidence: number, probabilities?: Record<string, number> }
export type Evaluation = { status: 'completed', provider: 'laya', modelRevision: string, decisions: Decision[] }
export type EvaluationRequest = { kind: EvaluationKind, requestId: string, inputDigest: string, items: Array<Record<string, unknown>> }

export function isEvaluationRequest(value: unknown): value is EvaluationRequest {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  if (!hasOnlyKeys(candidate, ['kind', 'requestId', 'inputDigest', 'items'])
    || (candidate.kind !== 'quiz_quality' && candidate.kind !== FREE_RESPONSE_ASSESSMENT_KIND)
    || typeof candidate.requestId !== 'string' || candidate.requestId.length < 1 || candidate.requestId.length > 128
    || typeof candidate.inputDigest !== 'string' || !/^[a-f0-9]{64}$/.test(candidate.inputDigest)
    || !Array.isArray(candidate.items)) return false
  const limit = candidate.kind === 'quiz_quality' ? MAX_BATCH_SIZE : MAX_SEMANTIC_BATCH_SIZE
  return candidate.items.length > 0 && candidate.items.length <= limit
    && new Set(candidate.items.map(item => (item as Record<string, unknown>)?.id)).size === candidate.items.length
    && candidate.items.every(candidate.kind === 'quiz_quality' ? qualityItemIsValid : semanticItemIsValid)
}

export function isEvaluation(value: unknown, kind: EvaluationKind): value is Evaluation {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  const labels = kind === 'quiz_quality' ? qualityLabels : semanticLabels
  return hasOnlyKeys(candidate, ['status', 'provider', 'modelRevision', 'decisions', 'timingMs'])
    && candidate.status === 'completed' && candidate.provider === 'laya' && candidate.modelRevision === PINNED_MODEL_REVISION
    && Array.isArray(candidate.decisions) && candidate.decisions.every(decision => decisionIsValid(decision, labels))
    && new Set(candidate.decisions.map(decision => (decision as Record<string, unknown>).id)).size === candidate.decisions.length
}

function qualityItemIsValid(item: unknown): boolean {
  if (!item || typeof item !== 'object') return false
  const candidate = item as Record<string, unknown>
  return hasOnlyKeys(candidate, ['id', 'question', 'correctAnswer', 'options'])
    && validText(candidate.id, 64) && validText(candidate.question, 1_200) && validText(candidate.correctAnswer, 400)
    && (candidate.options === undefined || (Array.isArray(candidate.options) && candidate.options.length <= 8
      && candidate.options.every(option => validText(option, 400))))
}

function semanticItemIsValid(item: unknown): boolean {
  if (!item || typeof item !== 'object') return false
  const candidate = item as Record<string, unknown>
  const rubric = candidate.rubric
  return hasOnlyKeys(candidate, ['id', 'question', 'questionType', 'expectedAnswer', 'learnerAnswer', 'evidenceExcerpt', 'rubricVersion', 'rubric'])
    && validText(candidate.id, 64) && validText(candidate.question, 1_200)
    && (candidate.questionType === 'free-response' || candidate.questionType === 'fill_in_the_blank')
    && validText(candidate.expectedAnswer, 400) && validText(candidate.learnerAnswer, 800) && validText(candidate.evidenceExcerpt, 1_200)
    && candidate.rubricVersion === FREE_RESPONSE_ASSESSMENT_KIND && Array.isArray(rubric) && rubric.length === 4
    && rubric.every((entry, index) => {
      if (!entry || typeof entry !== 'object') return false
      const row = entry as Record<string, unknown>
      return hasOnlyKeys(row, ['label', 'description'])
        && row.label === semanticRubric[index]?.[0] && row.description === semanticRubric[index]?.[1]
    })
}

function decisionIsValid(decision: unknown, labels: Set<string>): boolean {
  if (!decision || typeof decision !== 'object') return false
  const item = decision as Record<string, unknown>
  return hasOnlyKeys(item, ['id', 'label', 'confidence', 'probabilities']) && validText(item.id, 64)
    && typeof item.label === 'string' && labels.has(item.label) && validProbability(item.confidence)
    && (item.probabilities === undefined || probabilityRecordIsValid(item.probabilities, labels, item.label))
}

function probabilityRecordIsValid(value: unknown, labels: Set<string>, selectedLabel: string): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const entries = Object.entries(value)
  if (entries.length !== labels.size || !entries.every(([label, probability]) => labels.has(label) && validProbability(probability))) return false
  const probabilities = entries.map(([, probability]) => probability as number)
  const selected = (value as Record<string, unknown>)[selectedLabel]
  return typeof selected === 'number' && selected >= Math.max(...probabilities)
    && Math.abs(probabilities.reduce((sum, probability) => sum + probability, 0) - 1) <= 0.001
}

function validProbability(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 }
function validText(value: unknown, max: number): value is string { return typeof value === 'string' && value.length > 0 && value.length <= max }
function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]): boolean { return Object.keys(value).every(key => allowed.includes(key)) }
