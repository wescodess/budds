import { MeasurementItemBoundsError } from '../../shared/learn-v2-measurement-item-limits'
import { LearnScoringInputError } from '../../shared/learn-v2-errors'
import { readLearnAssessmentScoringInput } from './learnV2AssessmentScoringInput'
import { measurementReadContext } from './learnV2MeasurementReadContext'
import { ZodError } from 'zod'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { requireOwnedResponseTarget } from './learnV2PublicAccess'
import {
  disabledLearnV2Result, grantAssessmentDeliverySchema, LEARN_V2_PUBLIC_API_VERSION, parsePublicLearnRequest,
  type LearnV2AssessmentDelivery, type LearnV2AssessmentState, type LearnV2DeliveryGrant,
} from './learnV2PublicContract'
import { resolveAssessmentDisclosureContext } from './learnV2AssessmentDisclosure'
import { getValidatedMeasurementFamily, measurementCanonical, measurementDigest, requireMeasurementCapability, MeasurementValidationError } from './learnV2MeasurementItems'
import { measurementCaseExposed, measurementItemReason, measurementScopeReason, writeMeasurementOpportunityFact } from './learnV2Measurement'
import { getFrozenLearnMeasurementProtocol, measurementWindowPolicyDigest } from './learnV2MeasurementAssignment'
import { getScopedMasteryRecord } from './learnV2MasteryScope'
import { isLearnV2ContentEvidenceReady } from './learnV2ContentEvidenceReady'
import { privacyDigest } from './learnV2ResponsePrivacy'
import { LEARN_MEASUREMENT_CAPABILITIES, LEARN_MEASUREMENT_STORAGE_VERSION } from '../../shared/learn-v2-measurement-storage-manifest'
import {
  doesLearnAssessmentPurposeMatchPins, isLearnAssessmentTestOnly, isLearnRetainedPromotionTimeEligible,
  learnAssessmentPurposeSchema, resolveLearnAssessmentCapabilities,
} from '../../shared/learn-v2-delayed-check'
import { learnAssessmentPinsSchema, learnMeasurementItemPinsSchema, learnScorerBindingSchema, learnAssessmentBoundSurface } from '../../shared/learn-v2-measurement'
import { LEARN_V2_RESPONSE_DELIVERY_PINS_VERSION } from '../../shared/learn-v2-responses'
import { LEARN_V2_ASSESSMENT_DISCLOSURE_VERSION, projectDeliveredAssessment } from '../../shared/learn-v2-assessment-disclosure'

type ReadCtx = QueryCtx | MutationCtx
type Flow = 'today' | 'canvas'
const command = 'grantAssessmentDelivery'
const provenance = (flow: Flow) => `learn-v2.assessment-delivery.${flow}.v1`
const unavailable = (reasonCode: string) => ({ version: LEARN_V2_PUBLIC_API_VERSION, status: 'unavailable' as const, reasonCodes: [reasonCode] })

async function deliveryAuthority(ctx: ReadCtx, userId: string, id: Id<'learnAssessmentOpportunities'>, flow: Flow) {
  ctx = measurementReadContext(ctx, userId)
  const target = await requireOwnedResponseTarget(ctx, userId, { assessmentOpportunityId: id })
  if (!('assessmentPins' in target)) throw new Error('Assessment is unavailable')
  const row = target
  const deny = (reasonCode: string) => ({ row, reasonCode, context: null })
  if (!LEARN_MEASUREMENT_CAPABILITIES.responses) return deny('disabled')
  const purpose = learnAssessmentPurposeSchema.safeParse(row.purpose)
  const pins = learnAssessmentPinsSchema.safeParse(row.assessmentPins)
  if (!purpose.success || !pins.success || !learnScorerBindingSchema.safeParse(row.scoringBinding).success
    || !doesLearnAssessmentPurposeMatchPins(purpose.data, pins.data)) return deny('pins_mismatch')
  const assignment = row.assignmentId ? await ctx.db.get(row.assignmentId) : null
  const canvas = row.contextPins.kind === 'session' ? row.contextPins.canvas : undefined
  const explicit = assignment?.checkSurface || row.contextPins.kind !== 'calibration' && row.contextPins.checkSurface
  const boundFlow = explicit ? learnAssessmentBoundSurface(assignment?.status === 'admitted' ? assignment : null, row.contextPins)
    : assignment?.status === 'admitted' ? assignment.flow === 'v2_canvas' ? 'canvas' : 'today' : canvas ? 'canvas' : 'today'
  if (flow !== boundFlow || canvas && flow !== 'canvas') return deny('flow_mismatch')
  if (row.contextPins.kind !== 'calibration') {
    const reason = await measurementScopeReason(ctx, userId, row)
    if (reason) return deny(reason)
  }
  const context = await resolveAssessmentDisclosureContext(ctx, id)
  if (!context?.owned || !context.accessAvailable) return deny('unavailable')
  if (!context.evidenceAvailable) return deny('evidence_unavailable')
  if (!context.pinsMatch) return deny('pins_mismatch')
  if (['invalid', 'cancelled', 'abandoned', 'preparing'].includes(row.phase)) return deny('assessment_unavailable')
  if (!row.submissionId && (Date.now() < row.openAt || Date.now() >= row.closeAt)) return deny('outside_window')
  if (!row.submissionId && row.operationalEligibility !== 'eligible') return deny('assessment_unavailable')
  if (pins.data.kind !== 'measurement' && !row.submissionId) {
    try { await readLearnAssessmentScoringInput(ctx, userId, row, 'publication', 'x') }
    catch (error) {
      if (error instanceof MeasurementItemBoundsError) return deny(error.code)
      if (error instanceof LearnScoringInputError) return deny('assessment_unavailable')
      throw error
    }
  }
  if (row.deliveryGrantId) {
    const grant = await ctx.db.get(row.deliveryGrantId)
    const promptDigest = pins.data.kind === 'measurement' ? pins.data.itemPins.promptDigest : pins.data.promptDigest
    if (!context.grant || grant?.provenanceVersion !== provenance(flow) || grant.projectionDigest !== promptDigest) return deny('disclosure_unknown')
  }
  if (isLearnAssessmentTestOnly(purpose.data)) {
    try { await requireMeasurementCapability(ctx, userId) }
    catch (error) {
      if (!(error instanceof MeasurementValidationError) && !(error instanceof MeasurementItemBoundsError) && !(error instanceof ZodError)) throw error
      return deny('unknown_history')
    }
    const caseId = pins.data.kind === 'measurement' ? pins.data.itemPins.caseId : pins.data.caseId
    const caseRow = await ctx.db.get(caseId)
    if (!caseRow || caseRow.userId !== userId || !caseRow.identityValidationId
      || await measurementCaseExposed(ctx, userId, caseId, row._id)) return deny('novel_item_unavailable')
  }
  if (pins.data.kind === 'measurement') {
    const protocol = getFrozenLearnMeasurementProtocol()
    if (!protocol) return deny('protocol_not_frozen')
    if (!LEARN_MEASUREMENT_CAPABILITIES.enrollment) return deny('disabled')
    if (!assignment || assignment.userId !== userId || assignment.status !== 'admitted'
      || assignment.protocolVersion !== protocol.version || assignment.epoch !== protocol.epoch
      || assignment.windowPolicyDigest !== await measurementWindowPolicyDigest(protocol)
      || !protocol.flows.includes(assignment.flow)) return deny('not_admitted')
    if (!row.submissionId) try {
      const manifest = await getValidatedMeasurementFamily(ctx, userId, pins.data.itemPins.familyId)
      const itemPins = pins.data.itemPins
      const caseRow = await ctx.db.get(itemPins.caseId)
      if (!manifest.members.some(member => (itemPins.noveltyPolicyVersion === member.pins.noveltyPolicyVersion
        || itemPins.noveltyPolicyVersion === caseRow?.identityPolicyVersion)
        && measurementCanonical({ ...member.pins, noveltyPolicyVersion: itemPins.noveltyPolicyVersion }) === measurementCanonical(itemPins))) return deny('pins_mismatch')
    } catch (error) {
      if (!(error instanceof MeasurementValidationError) && !(error instanceof MeasurementItemBoundsError) && !(error instanceof ZodError)) throw error
      return deny(error instanceof MeasurementItemBoundsError ? error.code : 'evidence_unavailable')
    }
  }
  if (purpose.data.kind === 'retained_transfer' && !row.submissionId) {
    const basis = await ctx.db.get(purpose.data.basisAttemptId)
    const { record } = await getScopedMasteryRecord(ctx, userId, row.blueprintRevisionId, row.objectiveId)
    if (!basis || basis.userId !== userId || basis.objectiveId !== row.objectiveId || basis.blueprintRevisionId !== row.blueprintRevisionId
      || !isLearnRetainedPromotionTimeEligible({ previousState: record?.state ?? 'unseen', acceptedAt: Date.now(),
        firstIndependentLocalDate: record?.firstIndependentLocalDate ?? null, firstIndependentTimezone: record?.firstIndependentTimezone ?? null })) return deny('retained_promotion_ineligible')
  }
  return { row, context, reasonCode: null }
}

async function assessmentProjection(ctx: ReadCtx, userId: string, row: Doc<'learnAssessmentOpportunities'>) {
  const pins = row.assessmentPins
  if (pins.kind === 'measurement') {
    const item = await ctx.db.get(pins.itemPins.itemId)
    if (!item?.prompt || await measurementDigest({ prompt: item.prompt, declaredStimulus: item.declaredStimulus ?? null, responseSpec: item.responseSpec }) !== pins.itemPins.promptDigest) return null
    return { identity: { kind: 'measurement' as const, itemId: item._id, itemRevision: item.revision, promptDigest: item.promptDigest },
      prompt: item.prompt, declaredStimulus: item.declaredStimulus ?? null, instructions: 'Respond using the declared test material.',
      responseSpec: item.responseSpec, projectionDigest: item.promptDigest }
  }
  const objective = await ctx.db.get(row.objectiveId)
  if (!objective?.assessmentContract || typeof objective.assessmentContract === 'string'
    || await privacyDigest(objective.assessmentContract) !== row.assessmentContractDigest) return null
  const responseSpec = { kind: 'bounded_rubric' as const, version: 'learn-v2.text-response.v1', maxCodeUnits: 12000 as const }
  if (pins.kind === 'calibration') {
    if (await privacyDigest(objective.assessmentContract.instructions) !== pins.promptDigest) return null
    return { identity: { kind: 'calibration' as const, objectiveId: row.objectiveId, blueprintRevisionId: row.blueprintRevisionId, promptDigest: pins.promptDigest },
      prompt: objective.assessmentContract.instructions, declaredStimulus: null, instructions: 'Respond to the check.', responseSpec, projectionDigest: pins.promptDigest }
  }
  if (row.contextPins.kind !== 'session') return null
  const content = await ctx.db.get(row.contextPins.sessionContentId)
  if (!content || !await isLearnV2ContentEvidenceReady(ctx, userId, content, row.learningVoidId)) return null
  let rubric: unknown
  try { rubric = JSON.parse(content.assessmentRubricSnapshot ?? '') } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    return null
  }
  if (await privacyDigest(rubric) !== pins.rubricDigest) return null
  const blocks = await ctx.db.query('sessionContentBlocks').withIndex('by_userId_and_sessionContentId_and_order', q => q.eq('userId', userId).eq('sessionContentId', content._id)).take(17)
  const prompts = blocks.filter(block => (block.kind === 'independent_application' || block.kind === 'transfer_challenge') && block.content)
  if (blocks.length > 16 || prompts.length !== 1 || await privacyDigest(prompts[0]!.content) !== pins.promptDigest) return null
  return { identity: { kind: 'session_application' as const, sessionContentId: content._id, contentRevision: content.revision, promptDigest: pins.promptDigest },
    prompt: prompts[0]!.content!, declaredStimulus: null, instructions: 'Respond to the check.', responseSpec, projectionDigest: pins.promptDigest }
}

export async function grantLearnAssessmentDeliveryForOwner(
  ctx: MutationCtx,
  userId: string,
  request: { assessmentOpportunityId: Id<'learnAssessmentOpportunities'>; expectedRevision: number; idempotencyKey: string; flow: 'today' | 'canvas' },
): Promise<LearnV2DeliveryGrant> {
  ctx = measurementReadContext(ctx, userId)
  const { flow, ...input } = request
  parsePublicLearnRequest(grantAssessmentDeliverySchema, { version: LEARN_V2_PUBLIC_API_VERSION, ...input })
  const authority = await deliveryAuthority(ctx, userId, request.assessmentOpportunityId, flow)
  if (authority.reasonCode) return authority.reasonCode === 'disabled' ? disabledLearnV2Result() : unavailable(authority.reasonCode)
  const { row } = authority
  const key = `assessment-delivery:${await privacyDigest(request.idempotencyKey)}`
  const fingerprint = await privacyDigest({ command, ...input, flow })
  const prior = await ctx.db.query('learnPlanCommandReceipts').withIndex('by_userId_and_idempotencyKey', q => q.eq('userId', userId).eq('idempotencyKey', key)).unique()
  if (prior && (prior.command !== command || prior.requestFingerprint !== fingerprint)) return unavailable('idempotency_conflict')
  if (!await assessmentProjection(ctx, userId, row)) return unavailable('evidence_unavailable')
  if (prior) {
    const saved: unknown = JSON.parse(prior.response)
    if (!saved || typeof saved !== 'object' || !('deliveryGrantId' in saved) || saved.deliveryGrantId !== row.deliveryGrantId) return unavailable('disclosure_unknown')
    return { version: LEARN_V2_PUBLIC_API_VERSION, status: 'granted', assessmentOpportunityId: row._id, deliveryGrantId: row.deliveryGrantId!,
      revision: request.expectedRevision + 1, phase: 'test_open' }
  }
  if (row.deliveryGrantId && row.phase === 'test_open') return { version: LEARN_V2_PUBLIC_API_VERSION, status: 'granted',
    assessmentOpportunityId: row._id, deliveryGrantId: row.deliveryGrantId, revision: row.revision, phase: 'test_open' }
  if (row.phase !== 'ready' || row.submissionId) return unavailable('assessment_unavailable')
  if (row.revision !== request.expectedRevision) return unavailable('revision_conflict')
  if (row.assessmentPins.kind === 'measurement') {
    const reason = await measurementItemReason(ctx, userId, learnMeasurementItemPinsSchema.parse(row.assessmentPins.itemPins), row, row.scoringBinding)
    if (reason) return unavailable(reason)
  }
  const pins = row.assessmentPins
  const now = Date.now()
  const deliveryGrantId = await ctx.db.insert('learnAssessmentExposures', {
    userId, storageVersion: LEARN_MEASUREMENT_STORAGE_VERSION, createdAt: now, serverTime: now,
    learningVoidId: row.learningVoidId, blueprintRevisionId: row.blueprintRevisionId, objectiveId: row.objectiveId,
    assessmentOpportunityId: row._id, ...(row.assignmentId ? { assignmentId: row.assignmentId } : {}),
    ...(row.contextPins.kind === 'session' ? { studySessionId: row.contextPins.studySessionId,
      ...(row.contextPins.canvas ? { threadId: row.contextPins.canvas.threadId, activityId: row.contextPins.canvas.activityId } : {}) } : {}),
    ...(pins.kind === 'measurement' ? { caseId: pins.itemPins.caseId, itemId: pins.itemPins.itemId, itemRevision: pins.itemPins.itemRevision,
      familyId: pins.itemPins.familyId, formLabel: pins.itemPins.formLabel, projectionDigest: pins.itemPins.promptDigest }
      : { caseId: pins.caseId, projectionDigest: pins.promptDigest }),
    purpose: row.purpose.kind === 'measurement_cold' ? 'cold_measurement' : row.purpose.kind === 'measurement_delayed' ? 'delayed_measurement'
      : row.purpose.kind === 'retained_transfer' ? 'retained_check' : row.purpose.kind === 'calibration' ? 'calibration' : 'practice',
    status: 'granted', deliveryReceiptHash: await privacyDigest([command, row._id]),
    policyVersion: LEARN_V2_ASSESSMENT_DISCLOSURE_VERSION, provenanceVersion: provenance(flow),
  })
  await ctx.db.patch(row._id, { deliveryGrantId, phase: 'test_open', revision: row.revision + 1,
    deliveryPins: row.deliveryPins ?? { version: LEARN_V2_RESPONSE_DELIVERY_PINS_VERSION, confidenceRequested: false } })
  if (row.assignmentId) {
    const assignment = await ctx.db.get(row.assignmentId)
    if (assignment?.status === 'admitted') await writeMeasurementOpportunityFact(ctx, assignment, (await ctx.db.get(row._id))!)
  }
  const result = { version: LEARN_V2_PUBLIC_API_VERSION, status: 'granted' as const, assessmentOpportunityId: row._id,
    deliveryGrantId, revision: row.revision + 1, phase: 'test_open' as const }
  await ctx.db.insert('learnPlanCommandReceipts', { userId, learningVoidId: row.learningVoidId, idempotencyKey: key,
    command, requestFingerprint: fingerprint, response: JSON.stringify(result), createdAt: now })
  return result
}

export async function readLearnAssessmentForOwner(ctx: ReadCtx, userId: string, id: Id<'learnAssessmentOpportunities'>, flow: Flow): Promise<LearnV2AssessmentDelivery> {
  ctx = measurementReadContext(ctx, userId)
  const authority = await deliveryAuthority(ctx, userId, id, flow)
  if (authority.reasonCode) return authority.reasonCode === 'disabled' ? disabledLearnV2Result() : unavailable(authority.reasonCode)
  const projection = await assessmentProjection(ctx, userId, authority.row)
  if (!projection || !authority.context) return unavailable('evidence_unavailable')
  return projectDeliveredAssessment(projection, authority.context)
}

export async function readLearnAssessmentStateForOwner(ctx: ReadCtx, userId: string, id: Id<'learnAssessmentOpportunities'>, flow: Flow): Promise<LearnV2AssessmentState> {
  ctx = measurementReadContext(ctx, userId)
  const authority = await deliveryAuthority(ctx, userId, id, flow)
  if (authority.reasonCode) return authority.reasonCode === 'disabled' ? disabledLearnV2Result() : unavailable(authority.reasonCode)
  if (!authority.context) return unavailable('disclosure_unknown')
  const { row, context } = authority
  return { version: LEARN_V2_PUBLIC_API_VERSION, status: 'available', assessmentOpportunityId: row._id, revision: row.revision,
    phase: row.phase, submissionId: row.submissionId ?? null, capabilities: resolveLearnAssessmentCapabilities({ lifecycle: context.lifecycle,
      enabled: true, authorized: true, evidenceAvailable: context.evidenceAvailable, pinsMatch: context.pinsMatch,
      validScore: row.authoritativeAttemptId !== undefined && ['scored_pass', 'scored_fail'].includes(row.phase) }) }
}
