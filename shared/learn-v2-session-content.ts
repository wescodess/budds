import type { LearnV2AssessmentContract } from './learn-v2-blueprint'

export const LEARN_V2_SESSION_CONTENT_VERSION = 'learn-v2.session-content.v1' as const
export const LEARN_V2_ENTAILMENT_VERIFIER_VERSION = 'learn-v2.entailment.v2' as const
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
  claims: Array<{ order: number, claim: string, supportSourceSnapshotIds: string[] }>
}

export type LearnV2EntailmentDecision = {
  claimOrder: number
  sourceSnapshotId: string
  sourceExcerptId: string
  decision: 'entailed' | 'not_entailed'
  verifierVersion: typeof LEARN_V2_ENTAILMENT_VERIFIER_VERSION
  confidence: number
}

export function learnV2SessionCandidateFailureReason(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  if (/complete mastery loop in order/.test(message)) return 'provider_output_invalid_block_order'
  if (/complete mastery loop/.test(message)) return 'provider_output_invalid_mastery_loop'
  if (/requires supported claims|claim links must be unique/.test(message)) return 'provider_output_invalid_block_claims'
  if (/Every factual claim requires/.test(message)) return 'provider_output_invalid_claim_support'
  if (/Every claim must be referenced/.test(message)) return 'provider_output_invalid_claim_references'
  if (/Assessment rubric|Assessment criterion|Assessment instructions/.test(message)) return 'provider_output_invalid_assessment'
  if (/invalid shape/.test(message)) return 'provider_output_invalid_shape'
  if (/bounded nonblank text/.test(message)) return 'provider_output_invalid_text'
  return 'provider_output_invalid'
}

/**
 * Canonicalize representation-only provider variance before strict validation.
 * This never invents claims, evidence links, block content, or assessment rules.
 */
export function normalizeLearnV2SessionContentProviderOutput(
  input: unknown,
  sourceAliases: ReadonlyMap<string, string>,
  assessmentRubric: LearnV2AssessmentContract,
) {
  const candidate = object(input, 'Session content candidate')
  candidate.assessmentRubric = assessmentRubric
  if (!Array.isArray(candidate.blocks) || !Array.isArray(candidate.claims)) return candidate

  const blocks = candidate.blocks.map((value) => object(value, 'Session content block'))
  const blocksByKind = new Map(blocks.map(block => [block.kind, block]))
  const orderedBlocks = blocksByKind.size === LEARN_V2_MASTERY_LOOP_BLOCKS.length
    && LEARN_V2_MASTERY_LOOP_BLOCKS.every(kind => blocksByKind.has(kind))
    ? LEARN_V2_MASTERY_LOOP_BLOCKS.map(kind => blocksByKind.get(kind)!)
    : blocks
  const claims = candidate.claims.map((value) => object(value, 'Session content claim'))
  const claimKeys = claims.map((claim, index) => Number.isSafeInteger(claim.order) && (claim.order as number) >= 0 ? claim.order as number : index)
  if (new Set(claimKeys).size !== claimKeys.length) return candidate
  const claimsByKey = new Map(claimKeys.map((key, index) => [key, claims[index]!]))
  const resolveClaimKey = (value: unknown) => {
    if (!Number.isSafeInteger(value) || (value as number) < 0) return undefined
    if (claimsByKey.has(value as number)) return value as number
    return claimKeys[value as number]
  }
  const remappedOrder = new Map(claimKeys.map((priorOrder, nextOrder) => [priorOrder, nextOrder]))

  candidate.blocks = orderedBlocks.map((block, order) => ({
    ...block,
    order,
    claimOrders: Array.isArray(block.claimOrders)
      ? block.claimOrders.map(value => {
          const resolved = resolveClaimKey(value)
          return resolved === undefined ? value : remappedOrder.get(resolved)!
        })
      : block.claimOrders,
  }))
  candidate.claims = claimKeys.map((priorOrder, order) => {
    const claim = claimsByKey.get(priorOrder)!
    return {
      ...claim,
      order,
      supportSourceSnapshotIds: Array.isArray(claim.supportSourceSnapshotIds)
        ? claim.supportSourceSnapshotIds.map(value => typeof value === 'string' ? sourceAliases.get(value) ?? value : value)
        : claim.supportSourceSnapshotIds,
    }
  })
  return candidate
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
  const blocks = candidate.blocks.map((raw, index) => { const block = object(raw, `Block ${index}`); exact(block, ['order', 'kind', 'content', 'claimOrders'], `Block ${index}`); const kind = block.kind; if (!LEARN_V2_MASTERY_LOOP_BLOCKS.includes(kind as BlockKind) || !Array.isArray(block.claimOrders) || block.claimOrders.length < 1 || block.claimOrders.length > 8) throw new Error('Every mastery-loop block requires supported claims'); const claimOrders = block.claimOrders.map((value, claimIndex) => order(value, `Block ${index} claim ${claimIndex}`, 31)); if (new Set(claimOrders).size !== claimOrders.length) throw new Error('Block claim links must be unique'); return { order: order(block.order, `Block ${index}`, 9), kind: kind as BlockKind, content: string(block.content, `Block ${index} content`), claimOrders } })
  if (blocks.some((block, index) => block.order !== index || block.kind !== LEARN_V2_MASTERY_LOOP_BLOCKS[index])) throw new Error('Session content must contain the complete mastery loop in order')
  if (!Array.isArray(candidate.claims) || candidate.claims.length < 1 || candidate.claims.length > 32) throw new Error('Session content claims exceed the bounded contract')
  const accepted = new Set(acceptedSourceSnapshotIds)
  const claims = candidate.claims.map((raw, index) => { const claim = object(raw, `Claim ${index}`); exact(claim, ['order', 'claim', 'supportSourceSnapshotIds'], `Claim ${index}`); if (!Array.isArray(claim.supportSourceSnapshotIds) || !claim.supportSourceSnapshotIds.length || claim.supportSourceSnapshotIds.length > 8) throw new Error('Every factual claim requires accepted support'); const supportSourceSnapshotIds = claim.supportSourceSnapshotIds.map((id, supportIndex) => string(id, `Claim ${index} support ${supportIndex}`, 200)); if (new Set(supportSourceSnapshotIds).size !== supportSourceSnapshotIds.length || supportSourceSnapshotIds.some(id => !accepted.has(id))) throw new Error('Every factual claim requires an accepted source'); return { order: order(claim.order, `Claim ${index}`, 31), claim: string(claim.claim, `Claim ${index}`, 1_000), supportSourceSnapshotIds } })
  const referencedClaimOrders = new Set(blocks.flatMap(block => block.claimOrders))
  if (claims.some((claim, index) => claim.order !== index) || blocks.some(block => block.claimOrders.some(claimOrder => !claims[claimOrder])) || referencedClaimOrders.size !== claims.length) throw new Error('Every claim must be referenced by the mastery loop')
  return { version: LEARN_V2_SESSION_CONTENT_VERSION, generatorVersion: string(candidate.generatorVersion, 'Generator version', 200), assessmentRubric: assessment(candidate.assessmentRubric), blocks, claims }
}

/** Fail closed: each generated claim/source pair needs one exact-excerpt verifier decision. */
export function validateLearnV2EntailmentDecisions(
  input: unknown,
  candidate: LearnV2SessionContentCandidate,
  evidence: ReadonlyMap<string, { sourceExcerptId: string }>,
): LearnV2EntailmentDecision[] {
  const envelope = object(input, 'Entailment verification')
  exact(envelope, ['version', 'decisions'], 'Entailment verification')
  if (envelope.version !== LEARN_V2_ENTAILMENT_VERIFIER_VERSION || !Array.isArray(envelope.decisions)) throw new Error('Entailment verification has an invalid shape')
  const expected = new Map<string, { sourceExcerptId: string }>()
  for (const claim of candidate.claims) for (const sourceSnapshotId of claim.supportSourceSnapshotIds) {
    const source = evidence.get(sourceSnapshotId)
    if (!source) throw new Error('Entailment verification evidence is unavailable')
    expected.set(`${claim.order}\u0000${sourceSnapshotId}`, source)
  }
  if (envelope.decisions.length !== expected.size) throw new Error('Entailment verification is incomplete')
  const seen = new Set<string>()
  const decisions = envelope.decisions.map((raw, index) => {
    const value = object(raw, `Entailment decision ${index}`)
    exact(value, ['claimOrder', 'sourceSnapshotId', 'sourceExcerptId', 'decision', 'verifierVersion', 'confidence'], `Entailment decision ${index}`)
    const claimOrder = order(value.claimOrder, `Entailment decision ${index} claim order`, 31)
    const sourceSnapshotId = string(value.sourceSnapshotId, `Entailment decision ${index} source snapshot`, 200)
    const key = `${claimOrder}\u0000${sourceSnapshotId}`
    const pair = expected.get(key)
    if (!pair || seen.has(key)) throw new Error('Entailment verification has an unknown or duplicate claim/source pair')
    seen.add(key)
    const sourceExcerptId = string(value.sourceExcerptId, `Entailment decision ${index} source excerpt`, 200)
    if (sourceExcerptId !== pair.sourceExcerptId) throw new Error('Entailment verification must match the exact source excerpt identity')
    if (value.decision !== 'entailed') throw new Error('Entailment verification is not entailed')
    if (value.verifierVersion !== LEARN_V2_ENTAILMENT_VERIFIER_VERSION) throw new Error('Entailment verifier version is unsupported')
    if (typeof value.confidence !== 'number' || !Number.isFinite(value.confidence) || value.confidence < LEARN_V2_SESSION_CONTENT_MIN_CONFIDENCE || value.confidence > 1) throw new Error('Entailment verification confidence is below the publication threshold')
    return { claimOrder, sourceSnapshotId, sourceExcerptId, decision: 'entailed' as const, verifierVersion: LEARN_V2_ENTAILMENT_VERIFIER_VERSION, confidence: value.confidence }
  })
  return decisions
}
