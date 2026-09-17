import type { LearnV2AssessmentContract } from './learn-v2-blueprint'

export const LEARN_V2_SESSION_CONTENT_VERSION = 'learn-v2.session-content.v1' as const
export const LEARN_V2_ENTAILMENT_VERIFIER_VERSION = 'learn-v2.entailment.v1' as const
export const LEARN_V2_SESSION_CONTENT_MIN_CONFIDENCE = 0.8
export const LEARN_V2_MASTERY_LOOP_BLOCKS = [
  'retrieval', 'objective', 'cold_attempt', 'explanation', 'worked_example',
  'faded_example', 'independent_application', 'confidence_teach_back',
  'misconception_feedback', 'next_review',
] as const

type BlockKind = typeof LEARN_V2_MASTERY_LOOP_BLOCKS[number]
type RecordValue = Record<string, unknown>

export type LearnV2SessionContentCandidate = {
  version: typeof LEARN_V2_SESSION_CONTENT_VERSION
  generatorVersion: string
  assessmentRubric: LearnV2AssessmentContract
  blocks: Array<{ order: number, kind: BlockKind, content: string, claimOrders: number[] }>
  claims: Array<{ order: number, claim: string, supportSourceSnapshotIds: string[], verifierVersion: typeof LEARN_V2_ENTAILMENT_VERIFIER_VERSION, confidence: number }>
}

function object(value: unknown, label: string): RecordValue { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`); return value as RecordValue }
function string(value: unknown, label: string, maximum = 4_000) { if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum) throw new Error(`${label} must be bounded nonblank text`); return value.trim() }
function order(value: unknown, label: string, maximum: number) { if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) throw new Error(`${label} must be a bounded order`); return value as number }
function exact(value: RecordValue, keys: string[], label: string) { if (Object.keys(value).length !== keys.length || keys.some(key => !(key in value))) throw new Error(`${label} has an invalid shape`) }
function assessment(value: unknown): LearnV2AssessmentContract {
  const input = object(value, 'Assessment rubric'); exact(input, ['version', 'kind', 'responseFormat', 'instructions', 'passingScorePercent', 'criteria'], 'Assessment rubric')
  if (input.version !== 'learn-v2.assessment.v1' || (input.kind !== 'machine_checkable' && input.kind !== 'bounded_rubric') || (input.responseFormat !== 'short_text' && input.responseFormat !== 'structured') || input.passingScorePercent !== 80 || !Array.isArray(input.criteria) || input.criteria.length < 1 || input.criteria.length > 8) throw new Error('Assessment rubric is invalid')
  const criteria = input.criteria.map((item, index) => { const criterion = object(item, `Assessment criterion ${index}`); exact(criterion, ['key', 'description', 'weightPercent'], `Assessment criterion ${index}`); const weightPercent = criterion.weightPercent; if (!Number.isSafeInteger(weightPercent) || typeof weightPercent !== 'number' || weightPercent < 1 || weightPercent > 100) throw new Error('Assessment rubric weights are invalid'); return { key: string(criterion.key, 'Assessment criterion key', 64), description: string(criterion.description, 'Assessment criterion description', 300), weightPercent } })
  if (new Set(criteria.map(item => item.key)).size !== criteria.length || criteria.reduce((sum, item) => sum + item.weightPercent, 0) !== 100) throw new Error('Assessment rubric weights must total 100')
  return { version: 'learn-v2.assessment.v1', kind: input.kind, responseFormat: input.responseFormat, instructions: string(input.instructions, 'Assessment instructions', 1_000), passingScorePercent: 80, criteria }
}

export function validateLearnV2SessionContentCandidate(input: unknown, acceptedSourceSnapshotIds: readonly string[]): LearnV2SessionContentCandidate {
  if (!acceptedSourceSnapshotIds.length || acceptedSourceSnapshotIds.length > 64 || new Set(acceptedSourceSnapshotIds).size !== acceptedSourceSnapshotIds.length) throw new Error('Session content requires bounded accepted sources')
  const candidate = object(input, 'Session content candidate'); exact(candidate, ['version', 'generatorVersion', 'assessmentRubric', 'blocks', 'claims'], 'Session content candidate')
  if (candidate.version !== LEARN_V2_SESSION_CONTENT_VERSION) throw new Error('Session content candidate has an unsupported version')
  if (!Array.isArray(candidate.blocks) || candidate.blocks.length !== LEARN_V2_MASTERY_LOOP_BLOCKS.length) throw new Error('Session content must contain the complete mastery loop')
  const blocks = candidate.blocks.map((raw, index) => { const block = object(raw, `Block ${index}`); exact(block, ['order', 'kind', 'content', 'claimOrders'], `Block ${index}`); const kind = block.kind; if (!LEARN_V2_MASTERY_LOOP_BLOCKS.includes(kind as BlockKind) || !Array.isArray(block.claimOrders) || block.claimOrders.length > 8) throw new Error('Session content has an unknown mastery-loop block'); const claimOrders = block.claimOrders.map((value, claimIndex) => order(value, `Block ${index} claim ${claimIndex}`, 31)); if (new Set(claimOrders).size !== claimOrders.length) throw new Error('Block claim links must be unique'); return { order: order(block.order, `Block ${index}`, 9), kind: kind as BlockKind, content: string(block.content, `Block ${index} content`), claimOrders } })
  if (blocks.some((block, index) => block.order !== index || block.kind !== LEARN_V2_MASTERY_LOOP_BLOCKS[index])) throw new Error('Session content must contain the complete mastery loop in order')
  if (!Array.isArray(candidate.claims) || candidate.claims.length > 32) throw new Error('Session content claims exceed the bounded contract')
  const accepted = new Set(acceptedSourceSnapshotIds)
  const claims = candidate.claims.map((raw, index) => { const claim = object(raw, `Claim ${index}`); exact(claim, ['order', 'claim', 'supportSourceSnapshotIds', 'verifierVersion', 'confidence'], `Claim ${index}`); if (!Array.isArray(claim.supportSourceSnapshotIds) || !claim.supportSourceSnapshotIds.length || claim.supportSourceSnapshotIds.length > 8) throw new Error('Every factual claim requires accepted support'); const supportSourceSnapshotIds = claim.supportSourceSnapshotIds.map((id, supportIndex) => string(id, `Claim ${index} support ${supportIndex}`, 200)); if (new Set(supportSourceSnapshotIds).size !== supportSourceSnapshotIds.length || supportSourceSnapshotIds.some(id => !accepted.has(id))) throw new Error('Every factual claim requires an accepted source'); if (claim.verifierVersion !== LEARN_V2_ENTAILMENT_VERIFIER_VERSION) throw new Error('Claim verifier version is unsupported'); if (typeof claim.confidence !== 'number' || !Number.isFinite(claim.confidence) || claim.confidence < LEARN_V2_SESSION_CONTENT_MIN_CONFIDENCE || claim.confidence > 1) throw new Error('Claim confidence is below the publication threshold'); return { order: order(claim.order, `Claim ${index}`, 31), claim: string(claim.claim, `Claim ${index}`, 1_000), supportSourceSnapshotIds, verifierVersion: LEARN_V2_ENTAILMENT_VERIFIER_VERSION, confidence: claim.confidence } })
  if (claims.some((claim, index) => claim.order !== index) || blocks.some(block => block.claimOrders.some(claimOrder => !claims[claimOrder]))) throw new Error('Block factual content must reference supported claims')
  return { version: LEARN_V2_SESSION_CONTENT_VERSION, generatorVersion: string(candidate.generatorVersion, 'Generator version', 200), assessmentRubric: assessment(candidate.assessmentRubric), blocks, claims }
}
