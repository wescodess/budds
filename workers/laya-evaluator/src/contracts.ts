import manifest from '../learningDecisionManifest.json'

export const MANIFEST_VERSION = manifest.manifestVersion
export const CONTRACT_VERSION = manifest.contractVersion
export const SNAPSHOT_VERSION = manifest.snapshotVersion
export const MAX_REQUEST_BYTES = manifest.limits.requestBytes
export const MAX_BATCH_SIZE = manifest.limits.qualityBatchSize
export const MAX_SEMANTIC_BATCH_SIZE = manifest.limits.semanticBatchSize
export const MAX_REQUEST_ID_CHARS = manifest.limits.requestIdChars
export const MAX_ITEM_ID_CHARS = manifest.limits.itemIdChars
export const MAX_OPTION_COUNT = manifest.limits.optionCount
export const PINNED_MODEL_REVISION = manifest.model.revision
export const CONTAINER_DEADLINE_MS = manifest.timeouts.containerDeadlineMs
export const FREE_RESPONSE_ASSESSMENT_KIND = manifest.decisionKinds.freeResponse.kind

const qualityLabels = new Set<string>(manifest.decisionKinds.quizQuality.labels)
const semanticLabels = new Set<string>(manifest.decisionKinds.freeResponse.labels)
const semanticRubric = manifest.decisionKinds.freeResponse.rubric

export type EvaluationKind = 'quiz_quality' | typeof FREE_RESPONSE_ASSESSMENT_KIND
export type Decision = { id: string, label: string, confidence: number, probabilities?: Record<string, number> }
export type Evaluation = { status: 'completed', provider: 'laya', modelRevision: string, decisions: Decision[] }
export type EvaluationRequest = {
  kind: EvaluationKind
  requestId: string
  inputDigest: string
  contractVersion: string
  snapshotVersion: string
  items: Array<Record<string, unknown>>
}

export function isEvaluationRequest(value: unknown): value is EvaluationRequest {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  if (!hasOnlyKeys(candidate, ['kind', 'requestId', 'inputDigest', 'contractVersion', 'snapshotVersion', 'items'])
    || (candidate.kind !== 'quiz_quality' && candidate.kind !== FREE_RESPONSE_ASSESSMENT_KIND)
    || typeof candidate.requestId !== 'string' || candidate.requestId.length < 1 || candidate.requestId.length > MAX_REQUEST_ID_CHARS
    || typeof candidate.inputDigest !== 'string' || !/^[a-f0-9]{64}$/.test(candidate.inputDigest)
    || candidate.contractVersion !== CONTRACT_VERSION || candidate.snapshotVersion !== SNAPSHOT_VERSION
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
  return hasOnlyKeys(candidate, ['id', 'question', 'correctAnswer', 'options', 'language', 'evidence'])
    && validText(candidate.id, MAX_ITEM_ID_CHARS) && validText(candidate.question, manifest.limits.questionChars) && validText(candidate.correctAnswer, manifest.limits.optionChars)
    && supportedEnglish(candidate.language) && sourceEvidenceIsValid(candidate.evidence)
    && (candidate.options === undefined || (Array.isArray(candidate.options) && candidate.options.length <= MAX_OPTION_COUNT
      && candidate.options.every(option => validText(option, manifest.limits.optionChars))))
}

function semanticItemIsValid(item: unknown): boolean {
  if (!item || typeof item !== 'object') return false
  const candidate = item as Record<string, unknown>
  const rubric = candidate.rubric
  return hasOnlyKeys(candidate, ['id', 'question', 'questionType', 'expectedAnswer', 'learnerAnswer', 'evidenceExcerpt', 'language', 'rubricVersion', 'rubric'])
    && validText(candidate.id, MAX_ITEM_ID_CHARS) && validText(candidate.question, manifest.limits.questionChars)
    && (candidate.questionType === 'free-response' || candidate.questionType === 'fill_in_the_blank')
    && validText(candidate.expectedAnswer, manifest.limits.optionChars) && validText(candidate.learnerAnswer, manifest.limits.learnerAnswerChars) && validText(candidate.evidenceExcerpt, manifest.limits.evidenceChars)
    && supportedEnglish(candidate.language)
    && candidate.rubricVersion === FREE_RESPONSE_ASSESSMENT_KIND && Array.isArray(rubric) && rubric.length === semanticRubric.length
    && rubric.every((entry, index) => {
      if (!entry || typeof entry !== 'object') return false
      const row = entry as Record<string, unknown>
      return hasOnlyKeys(row, ['label', 'description'])
        && row.label === semanticRubric[index]?.label && row.description === semanticRubric[index]?.description
    })
}

function decisionIsValid(decision: unknown, labels: Set<string>): boolean {
  if (!decision || typeof decision !== 'object') return false
  const item = decision as Record<string, unknown>
  return hasOnlyKeys(item, ['id', 'label', 'confidence', 'probabilities']) && validText(item.id, MAX_ITEM_ID_CHARS)
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

function supportedEnglish(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const normalized = value.trim().toLowerCase().replaceAll('_', '-')
  return manifest.supportedLanguages.some(pattern => pattern.endsWith('*')
    ? normalized.startsWith(pattern.slice(0, -1))
    : normalized === pattern)
}

function sourceEvidenceIsValid(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const evidence = value as Record<string, unknown>
  return hasOnlyKeys(evidence, ['sourceIndex', 'excerpt'])
    && Number.isSafeInteger(evidence.sourceIndex) && (evidence.sourceIndex as number) >= 0
    && validText(evidence.excerpt, manifest.limits.evidenceChars)
}
