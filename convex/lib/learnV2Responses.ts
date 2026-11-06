import { z } from 'zod'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { requireOwnedResponseTarget } from './learnV2PublicAccess'
import { getScopedMasteryRecord } from './learnV2MasteryScope'
import {
  acceptResponseCommandSchema, disabledResponseReceipt, disabledLearnV2Result, LEARN_V2_PUBLIC_API_VERSION,
  validateLearnMasterySubmission, parsePublicLearnRequest, terminalizeResponseSchema, authorizeAssistanceSchema,
  type LearnV2AcceptResponseCommand, type LearnV2ResponseState, type LearnV2Terminalization, type LearnV2AssistanceAuthorization,
} from './learnV2PublicContract'
import {
  LEARN_V2_RESPONSE_CONTRACT_VERSION, LEARN_V2_RESPONSE_TERMINALIZATION_VERSION,
  LEARN_V2_ASSISTANCE_POLICY_VERSION, LEARN_V2_VALIDITY_POLICY_VERSION, LEARN_V2_RESPONSE_LIMITS,
  learnSerializedBytes, parseLearnContract, learnAssistanceSnapshotSchema, learnValiditySnapshotSchema,
  learnResponseSlotPinsSchema, learnResponseDependencySchema, learnResponseReceiptSchema, learnResponseTerminalizedResultSchema,
  resolveLearnInstrumentation, validateLearnAcceptResponseRequest, validateLearnFinalResponseBundle,
  learnIdSchema, learnTimestampSchema, learnCodeSchema, learnVersionSchema,
  type LearnResponseTarget, type LearnResponseReceipt, type LearnAssistanceSnapshot,
  type learnAcceptResponseEntrySchema, type LEARN_V2_RESPONSE_REJECTION_CODES,
} from '../../shared/learn-v2-responses'
import {
  learnResponseScopeSchema, deriveLearnAssessmentResponseContext, learnAssessmentPinsSchema,
  learnScorerBindingSchema, learnMeasurementAllocationSchema, type LearnResponseScope,
} from '../../shared/learn-v2-measurement'
import {
  learnAssessmentPurposeSchema, evaluateLearnAssessmentEligibility, isLearnAssessmentTestOnly,
} from '../../shared/learn-v2-delayed-check'
import { LEARN_V2_ASSESSMENT_DISCLOSURE_VERSION, learnAttemptHistorySchema } from '../../shared/learn-v2-assessment-disclosure'
import { LEARN_MEASUREMENT_CAPABILITIES, LEARN_MEASUREMENT_STORAGE_VERSION } from '../../shared/learn-v2-measurement-storage-manifest'
import {
  appendLearnMeasurementFact, nextLearnMeasurementSourceSequence, writeLearnMeasurementEnrollmentFact, writeLearnResponseAcceptanceFact,
} from './learnV2MeasurementFacts'

type ReadCtx = QueryCtx | MutationCtx
type Target = Doc<'learnResponseSlots'> | Doc<'learnAssessmentOpportunities'>
type Entry = z.infer<typeof learnAcceptResponseEntrySchema>
type Dependency = z.infer<typeof learnResponseDependencySchema>
type Rejection = typeof LEARN_V2_RESPONSE_REJECTION_CODES[number]

class ResponseRejection extends Error {
  constructor(readonly code: Rejection) { super(code) }
}
function reject(code: Rejection): never { throw new ResponseRejection(code) }
function rejected(reasonCode: Rejection): LearnResponseReceipt {
  return { kind: 'rejected', version: LEARN_V2_RESPONSE_CONTRACT_VERSION, reasonCode }
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}
async function digest(value: unknown) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value))))
  return `sha256:${[...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')}`
}
function scope(row: Target | Doc<'learnResponses'>): LearnResponseScope {
  return parseLearnContract(learnResponseScopeSchema, row.scopeKind === 'standalone'
    ? { scopeKind: row.scopeKind, threadId: row.threadId, activityId: row.activityId, threadRevision: row.threadRevision,
        activityRevision: row.activityRevision, activityContractVersion: row.activityContractVersion }
    : { scopeKind: row.scopeKind, learningVoidId: row.learningVoidId, blueprintRevisionId: row.blueprintRevisionId,
        objectiveId: row.objectiveId, blueprintRecordRevision: row.blueprintRecordRevision, assessmentContractVersion: row.assessmentContractVersion,
        assessmentContractDigest: row.assessmentContractDigest, depth: row.depth, contextPins: row.contextPins })
}
function anchors(row: Target | Doc<'learnResponses'>) {
  if (row.scopeKind === 'standalone') return { threadId: row.threadId }
  return { learningVoidId: row.learningVoidId,
    ...(row.contextPins.kind === 'session' && row.contextPins.canvas ? { threadId: row.contextPins.canvas.threadId } : {}) }
}
function aggregate(row: Target | Doc<'learnResponses'>) {
  return row.scopeKind === 'v2' ? { learningVoidId: row.learningVoidId } : { threadId: row.threadId }
}
function targetReference(row: Target): LearnResponseTarget {
  return 'stage' in row ? { responseSlotId: row._id } : { assessmentOpportunityId: row._id }
}
function requireAvailable(row: { evidenceStatus: string, invalidatedAt?: number }) {
  if (row.evidenceStatus !== 'available' || row.invalidatedAt !== undefined) reject('evidence_unavailable')
}

async function currentScope(ctx: ReadCtx, userId: string, row: Target) {
  const pins = scope(row)
  requireAvailable(row)
  if (pins.scopeKind === 'standalone') {
    const [thread, activity] = await Promise.all([ctx.db.get(pins.threadId), ctx.db.get(pins.activityId)])
    if (!thread || !activity || thread.deletionStartedAt !== undefined || ['ended', 'rollback'].includes(thread.lifecycle)) reject('unavailable')
    if (thread.revision !== pins.threadRevision || activity.planRevision !== pins.activityRevision
      || activity.contractVersion !== pins.activityContractVersion || thread.currentActivityId !== activity._id
      || activity.status !== 'started' || activity.activityClass !== 'non_factual'
      || activity.primitivePlan.length !== 1 || activity.primitivePlan[0]?.type !== 'diagnostic_prompt') reject('pins_mismatch')
    return { pins, session: null, content: null }
  }
  const [learningVoid, blueprint, objective] = await Promise.all([
    ctx.db.get(pins.learningVoidId), ctx.db.get(pins.blueprintRevisionId), ctx.db.get(pins.objectiveId),
  ])
  const folder = learningVoid && await ctx.db.get(learningVoid.folderId)
  if (!learningVoid || !folder || folder.userId !== userId || !blueprint || !objective) reject('unavailable')
  if (learningVoid.activeBlueprintRevisionId !== blueprint._id || blueprint.status !== 'accepted'
    || blueprint.recordRevision !== pins.blueprintRecordRevision || objective.depth !== pins.depth
    || typeof objective.assessmentContract !== 'object' || objective.assessmentContract.version !== pins.assessmentContractVersion
    || await digest(objective.assessmentContract) !== pins.assessmentContractDigest) reject('pins_mismatch')
  const context = pins.contextPins
  if (context.kind === 'calibration') return { pins, session: null, content: null }
  const [plan, revision] = await Promise.all([ctx.db.get(context.studyPlanId), ctx.db.get(context.studyPlanRevisionId)])
  if (!plan || !revision || plan.activeRevisionId !== revision._id || revision.status !== 'accepted'
    || revision.blueprintRevisionId !== blueprint._id || revision.blueprintRecordRevision !== blueprint.recordRevision
    || revision.revision !== context.planRevision || revision.recordRevision !== context.planRecordRevision) reject('pins_mismatch')
  if (context.kind === 'planned_measurement') return { pins, session: null, content: null }
  const [session, content] = await Promise.all([ctx.db.get(context.studySessionId), ctx.db.get(context.sessionContentId)])
  if (!session || !content || session.status !== 'in_progress' || session.revision !== context.sessionRevision
    || content.status !== 'published' || content.revision !== context.contentRevision || content.inputDigest !== context.contentInputDigest
    || content.generatorVersion !== context.generatorVersion || content.studyPlanRevisionId !== revision._id
    || session.startedSessionContentId !== content._id || session.startedSessionContentRevision !== content.revision) reject('pins_mismatch')
  if (context.canvas) {
    const [thread, activity] = await Promise.all([ctx.db.get(context.canvas.threadId), ctx.db.get(context.canvas.activityId)])
    if (!thread || !activity || thread.deletionStartedAt !== undefined || thread.revision !== context.canvas.threadRevision
      || thread.currentActivityId !== activity._id || activity.planRevision !== context.canvas.activityRevision
      || activity.planVersion !== context.canvas.planVersion || activity.replayVersion !== context.canvas.replayVersion
      || activity.rendererVersion !== context.canvas.rendererVersion || activity.evaluationContract.version !== context.canvas.evaluationVersion
      || ['ended', 'replaced', 'blocked'].includes(activity.status)) reject('pins_mismatch')
  }
  return { pins, session, content }
}

async function snapshotDependency(ctx: ReadCtx, userId: string, learningVoidId: Id<'learningVoids'>, id: Id<'learnSourceSnapshots'>, manifest: string) {
  const source = await ctx.db.get(id)
  if (!source || source.userId !== userId || source.learningVoidId !== learningVoidId
    || source.status !== 'user_accepted' || source.effectiveStatus !== 'user_accepted' || source.conflictStatus !== 'clear'
    || source.evidencePurgedAt !== undefined || source.rightsStatus === 'prohibited') reject('evidence_unavailable')
  const identity = await ctx.db.get(source.sourceIdentityId)
  if (!identity || identity.userId !== userId || identity.learningVoidId !== learningVoidId || identity.tombstonedAt !== undefined) reject('evidence_unavailable')
  if (identity.folderDocumentId) {
    const document = await ctx.db.get(identity.folderDocumentId)
    const folder = document && await ctx.db.get(document.folderId)
    if (!document || document.userId !== userId || document.status !== 'success' || !folder || folder.userId !== userId
      || document.sourceRevision !== source.sourceRevision) reject('evidence_unavailable')
  }
  return parseLearnContract(learnResponseDependencySchema, { kind: 'snapshot', sourceSnapshotId: source._id,
    sourceSnapshotRevision: source.revision, sourceRecordRevision: source.recordRevision ?? 1, supportManifestDigest: manifest })
}

async function responseDependencies(ctx: ReadCtx, userId: string, authority: Awaited<ReturnType<typeof currentScope>>, row: Target): Promise<Dependency[]> {
  const { pins, content } = authority
  if (pins.scopeKind === 'standalone') {
    const thread = (await ctx.db.get(pins.threadId))!
    if (thread.sourceScope.kind === 'none') return []
    if (thread.sourceScope.kind === 'document') {
      const id = ctx.db.normalizeId('documents', thread.sourceScope.sourceId)
      const document = id && await ctx.db.get(id)
      const folder = document && await ctx.db.get(document.folderId)
      if (!document || document.userId !== userId || document.status !== 'success' || !folder || folder.userId !== userId || !document.sourceRevision) reject('evidence_unavailable')
      return [parseLearnContract(learnResponseDependencySchema, { kind: 'document', documentId: document._id, sourceRevision: document.sourceRevision })]
    }
    if (thread.sourceScope.kind !== 'folder') return []
    const id = ctx.db.normalizeId('folders', thread.sourceScope.sourceId)
    const folder = id && await ctx.db.get(id)
    if (!folder || folder.userId !== userId) reject('evidence_unavailable')
    return [parseLearnContract(learnResponseDependencySchema, { kind: 'folder', folderId: folder._id, scopeRevision: `thread:${pins.threadRevision}` })]
  }
  const sources = new Set<Id<'learnSourceSnapshots'>>()
  const supportPins: unknown[] = []
  const item = 'assessmentPins' in row && row.assessmentPins.kind === 'measurement' ? row.assessmentPins.itemPins : null
  if (item) {
    const claims = await ctx.db.query('learnMeasurementClaims')
      .withIndex('by_userId_and_itemId_and_order', q => q.eq('userId', userId).eq('itemId', item.itemId)).take(33)
    if (!claims.length || claims.length > 32) reject('evidence_unavailable')
    for (const claim of claims) {
      requireAvailable(claim)
      if (claim.scoringSpecId !== item.scoringSpecId) reject('pins_mismatch')
      const supports = await ctx.db.query('learnMeasurementSupports')
        .withIndex('by_userId_and_claimId', q => q.eq('userId', userId).eq('claimId', claim._id)).take(9)
      if (!supports.length || supports.length > 8) reject('evidence_unavailable')
      for (const support of supports) {
        requireAvailable(support)
        const excerpt = await ctx.db.get(support.sourceExcerptId)
        const source = await ctx.db.get(support.sourceSnapshotId)
        if (support.entailment !== 'entailed' || !excerpt || excerpt.userId !== userId || excerpt.evidencePurgedAt !== undefined
          || excerpt.sourceSnapshotId !== support.sourceSnapshotId || !source || source.revision !== support.sourceSnapshotRevision
          || (source.recordRevision ?? 1) !== support.sourceRecordRevision || source.contentHash !== support.sourceContentHash
          || source.sourceRevision !== support.sourceRevision) reject('evidence_unavailable')
        sources.add(support.sourceSnapshotId)
      }
    }
  }
  if (content) {
    const claims = await ctx.db.query('sessionContentClaims')
      .withIndex('by_userId_and_sessionContentId_and_order', q => q.eq('userId', userId).eq('sessionContentId', content._id)).take(33)
    if (!claims.length || claims.length > 32) reject('evidence_unavailable')
    for (const claim of claims) {
      const supports = await ctx.db.query('learnClaimSupports')
        .withIndex('by_userId_and_sessionContentClaimId', q => q.eq('userId', userId).eq('sessionContentClaimId', claim._id)).take(9)
      if (!supports.length || supports.length > 8) reject('evidence_unavailable')
      for (const support of supports) {
        const excerpt = await ctx.db.get(support.sourceExcerptId)
        const sourceId = support.sourceSnapshotId ?? excerpt?.sourceSnapshotId
        if (!excerpt || excerpt.userId !== userId || excerpt.evidencePurgedAt !== undefined || !sourceId || excerpt.sourceSnapshotId !== sourceId
          || support.entailment !== 'entailed' || support.conflictStatus !== 'clear' || support.evidenceStatus !== 'evidence_available'
          || !support.verifierVersion || (support.confidence ?? 0) < 0.8) reject('evidence_unavailable')
        sources.add(sourceId)
        supportPins.push([support._id, sourceId, support.verifierVersion])
      }
    }
  } else if (!item) {
    const links = await ctx.db.query('learnObjectiveSources')
      .withIndex('by_userId_and_objectiveId_and_sourceSnapshotId', q => q.eq('userId', userId).eq('objectiveId', pins.objectiveId)).take(65)
    if (links.length > 64) reject('source_scope_too_large')
    for (const link of links) if (link.coverage !== 'gap') sources.add(link.sourceSnapshotId)
  }
  if (!sources.size) reject('evidence_unavailable')
  if (sources.size > 64) reject('source_scope_too_large')
  const manifest = item?.supportManifestDigest ?? ('assessmentPins' in row && row.assessmentPins.kind !== 'measurement'
    ? row.assessmentPins.supportManifestDigest : await digest(supportPins))
  const result: Dependency[] = []
  for (const id of [...sources].sort()) result.push(await snapshotDependency(ctx, userId, pins.learningVoidId, id, manifest))
  return result
}

async function requireDelivery(ctx: ReadCtx, userId: string, row: Target, now: number) {
  const id = 'stage' in row ? row.deliveryExposureId : row.deliveryGrantId
  const grant = id && await ctx.db.get(id)
  if (!grant || grant.userId !== userId || !['granted', 'acknowledged', 'known'].includes(grant.status)
    || grant.serverTime > now || grant.purpose === 'assistance_requested_denied') reject('not_delivered')
  if (row.scopeKind === 'standalone') {
    if (grant.threadId !== row.threadId || grant.activityId !== row.activityId) reject('not_delivered')
  } else if (grant.learningVoidId !== row.learningVoidId || grant.objectiveId !== row.objectiveId || grant.blueprintRevisionId !== row.blueprintRevisionId) reject('not_delivered')
  if ('stage' in row) {
    parseLearnContract(learnResponseSlotPinsSchema, { stage: row.stage, slotKey: row.slotKey, blockId: row.blockId,
      promptDigest: row.promptDigest, promptRevision: row.promptRevision, responseFormatVersion: row.responseFormatVersion,
      deliveryExposureId: row.deliveryExposureId, revision: row.revision,
      ...(row.confidenceRequested === undefined ? {} : { confidenceRequested: row.confidenceRequested }) })
    if (grant.projectionDigest !== row.promptDigest || grant.assessmentOpportunityId !== undefined) reject('pins_mismatch')
  } else {
    const pins = parseLearnContract(learnAssessmentPinsSchema, row.assessmentPins)
    const identity = pins.kind === 'measurement' ? pins.itemPins : pins
    if (grant.assessmentOpportunityId !== row._id || grant.caseId !== identity.caseId || grant.projectionDigest !== identity.promptDigest
      || (pins.kind === 'measurement' && (grant.itemId !== pins.itemPins.itemId || grant.itemRevision !== pins.itemPins.itemRevision
        || grant.familyId !== pins.itemPins.familyId || grant.formLabel !== pins.itemPins.formLabel))) reject('pins_mismatch')
  }
  return grant
}

async function matchingAssignment(ctx: ReadCtx, userId: string, row: Doc<'learnAssessmentOpportunities'>) {
  const purpose = parseLearnContract(learnAssessmentPurposeSchema, row.purpose)
  const purposeId = 'assignmentId' in purpose ? purpose.assignmentId : undefined
  if (purposeId && row.assignmentId !== purposeId) reject('pins_mismatch')
  if (!row.assignmentId) return null
  const assignment = await ctx.db.get(row.assignmentId)
  if (!assignment || assignment.userId !== userId || assignment.learningVoidId !== row.learningVoidId
    || assignment.blueprintRevisionId !== row.blueprintRevisionId || assignment.objectiveId !== row.objectiveId
    || assignment.blueprintRecordRevision !== row.blueprintRecordRevision || assignment.depth !== row.depth
    || assignment.assessmentContractDigest !== row.assessmentContractDigest || assignment.assessmentContractVersion !== row.assessmentContractVersion) reject('pins_mismatch')
  requireAvailable(assignment)
  if (assignment.status === 'admitted') {
    const allocation = parseLearnContract(learnMeasurementAllocationSchema, assignment.allocation)
    if (row.assessmentPins.kind === 'measurement') {
      const assigned = purpose.kind === 'measurement_cold' ? allocation.cold
        : purpose.kind === 'measurement_delayed'
          ? allocation.kind === 'three_case' ? (purpose.horizonDays === 7 ? allocation.day7 : allocation.day30)
            : allocation.horizonDays === purpose.horizonDays ? allocation.delayed : null
          : null
      if (!assigned || canonical(assigned) !== canonical(row.assessmentPins.itemPins)
        || canonical(row.scoringBinding) !== canonical(assignment.scoringBinding)) reject('pins_mismatch')
    }
  }
  return assignment
}

async function assessmentValidity(ctx: ReadCtx, userId: string, row: Doc<'learnAssessmentOpportunities'>,
  authority: Awaited<ReturnType<typeof currentScope>>, assistance: LearnAssistanceSnapshot, now: number,
  assignment: Awaited<ReturnType<typeof matchingAssignment>>) {
  const purpose = parseLearnContract(learnAssessmentPurposeSchema, row.purpose)
  parseLearnContract(learnScorerBindingSchema, row.scoringBinding)
  if (now < row.openAt || now >= row.closeAt) reject('outside_window')
  if (row.operationalEligibility !== 'eligible') reject('unavailable')
  const pins = parseLearnContract(learnAssessmentPinsSchema, row.assessmentPins)
  const measurement = pins.kind === 'measurement'
  if (measurement !== purpose.kind.startsWith('measurement_')
    || (purpose.kind === 'calibration' && pins.kind !== 'calibration')
    || (purpose.kind === 'independent_application' && pins.kind !== 'session_application')) reject('pins_mismatch')
  const catalog = await ctx.db.query('learnAssessmentCatalogs').withIndex('by_userId', q => q.eq('userId', userId)).unique()
  const historyKnown = catalog?.historyCompleteness === 'prospective_complete' && !!catalog.historyCoverageWatermark
  const caseId = measurement ? pins.itemPins.caseId : pins.caseId
  const caseRow = await ctx.db.get(caseId)
  if (!caseRow || caseRow.userId !== userId) reject('pins_mismatch')
  const exposures = await ctx.db.query('learnAssessmentExposures')
    .withIndex('by_userId_and_caseId_and_serverTime', q => q.eq('userId', userId).eq('caseId', caseId)).take(65)
  if (exposures.length > 64) reject('unavailable')
  const previous = exposures.some(exposure => exposure.status !== 'requested_denied' && exposure.serverTime <= now
    && exposure.assessmentOpportunityId !== row._id)
  const novel = previous ? 'no' : historyKnown && caseRow.identityValidationId ? 'yes' as const : 'unknown' as const
  assistance.priorExposure = previous ? 'known' : historyKnown ? 'prospectively_unexposed' : 'unknown'
  if (authority.session === null && historyKnown && assistance.state === 'unknown') assistance.state = 'unassisted'
  if (measurement) {
    const itemPins = pins.itemPins
    const [item, family, spec, validation] = await Promise.all([
      ctx.db.get(itemPins.itemId), ctx.db.get(itemPins.familyId), ctx.db.get(itemPins.scoringSpecId), ctx.db.get(itemPins.publicationValidationId),
    ])
    if (!item || !family || !spec || !validation || [item, family, spec, validation].some(value => value.userId !== userId
      || value.learningVoidId !== row.learningVoidId || value.blueprintRevisionId !== row.blueprintRevisionId
      || value.objectiveId !== row.objectiveId || value.assessmentContractDigest !== row.assessmentContractDigest)) reject('pins_mismatch')
    for (const value of [item, family, spec, validation]) requireAvailable(value)
    if (item.status !== 'published' || !item.prompt || family.status === 'quarantined' || family.status === 'retired'
      || validation.decision !== 'pass' || validation.subject.kind !== 'item' || validation.subject.itemId !== item._id
      || validation.subjectRevision !== item.revision || validation.check !== 'publication'
      || item.revision !== itemPins.itemRevision || item.promptDigest !== itemPins.promptDigest || item.caseId !== caseId
      || item.familyId !== family._id || item.familyRevision !== itemPins.familyRevision || family.revision !== itemPins.familyRevision
      || item.formLabel !== itemPins.formLabel || family.equivalenceVersion !== itemPins.equivalenceVersion
      || item.scoringSpecId !== spec._id || spec.itemId !== item._id || spec.revision !== itemPins.scoringSpecRevision
      || spec.digest !== itemPins.scoringSpecDigest || item.supportManifestDigest !== itemPins.supportManifestDigest
      || canonical(spec.scoringBinding) !== canonical(row.scoringBinding) || caseRow.usageClass !== 'measurement_reserved') reject('pins_mismatch')
  } else if (pins.kind === 'session_application') {
    if (!authority.content || !authority.content.assessmentRubricSnapshot) reject('pins_mismatch')
    const rubric: unknown = JSON.parse(authority.content.assessmentRubricSnapshot)
    const blocks = await ctx.db.query('sessionContentBlocks')
      .withIndex('by_userId_and_sessionContentId_and_order', q => q.eq('userId', userId).eq('sessionContentId', authority.content!._id)).take(16)
    const prompts = blocks.filter(block => block.kind === 'transfer_challenge' && block.content)
    if (prompts.length !== 1 || await digest(prompts[0]!.content) !== pins.promptDigest || await digest(rubric) !== pins.rubricDigest) reject('pins_mismatch')
  } else if (pins.assessmentContractDigest !== row.assessmentContractDigest || pins.assessmentContractVersion !== row.assessmentContractVersion) reject('pins_mismatch')
  const { record } = await getScopedMasteryRecord(ctx, userId, row.blueprintRevisionId, row.objectiveId)
  if (purpose.kind === 'retained_transfer') {
    const basis = await ctx.db.get(purpose.basisAttemptId)
    if (!basis || basis.userId !== userId || basis.objectiveId !== row.objectiveId || basis.blueprintRevisionId !== row.blueprintRevisionId) reject('pins_mismatch')
  }
  const teachings = await ctx.db.query('learnAssessmentExposures')
    .withIndex('by_userId_and_learningVoidId', q => q.eq('userId', userId).eq('learningVoidId', row.learningVoidId)).take(65)
  const coldBeforeTeaching = teachings.length <= 64 && !teachings.some(exposure => exposure.objectiveId === row.objectiveId
    && exposure.serverTime <= now && exposure.status !== 'requested_denied' && ['teaching', 'practice', 'feedback'].includes(exposure.purpose))
  const eligibility = evaluateLearnAssessmentEligibility({ purpose, acceptedAt: now, acceptedT0: true, evidenceAvailable: true,
    pinsMatch: true, deliveryGranted: true, historyKnown, novelCase: novel, inAssignedWindow: true,
    assignmentAdmitted: assignment?.status === 'admitted', coldBeforeTeaching, assistance,
    previousState: record?.state ?? 'unseen', firstIndependentLocalDate: record?.firstIndependentLocalDate ?? null,
    firstIndependentTimezone: record?.firstIndependentTimezone ?? null })
  return parseLearnContract(learnValiditySnapshotSchema, { policyVersion: LEARN_V2_VALIDITY_POLICY_VERSION,
    status: eligibility.measurementEligible || eligibility.masteryEligible ? 'valid' : 'excluded',
    measurementEligible: eligibility.measurementEligible, masteryEligible: eligibility.masteryEligible,
    exclusionReasons: eligibility.reasonCodes.length ? eligibility.reasonCodes : [] })
}

async function prepareResponse(ctx: ReadCtx, userId: string, entry: Entry, row: Target, now: number) {
  if (row.submissionId) reject('already_accepted')
  if (entry.expectedRevision !== row.revision) reject('stale_revision')
  if ('stage' in row ? row.status !== 'open' : row.phase !== 'test_open') reject('unavailable')
  const authority = await currentScope(ctx, userId, row)
  await requireDelivery(ctx, userId, row, now)
  const dependencies = await responseDependencies(ctx, userId, authority, row)
  const observation = resolveLearnInstrumentation(entry.instrumentation)
  const exposures = 'assessmentPins' in row ? await ctx.db.query('learnAssessmentExposures')
    .withIndex('by_userId_and_assessmentOpportunityId', q => q.eq('userId', userId).eq('assessmentOpportunityId', row._id)).take(65) : []
  if (exposures.length > 64) reject('unavailable')
  const priorExposures = exposures.filter(value => value._id !== ('deliveryGrantId' in row ? row.deliveryGrantId : undefined)
    && value.serverTime <= now && value.status !== 'requested_denied' && value.purpose !== 'assistance_requested_denied')
  const actualHelp = priorExposures.some(value => ['granted', 'acknowledged', 'known'].includes(value.status)
    && ['teaching', 'practice', 'feedback'].includes(value.purpose))
  const unresolvedExposure = priorExposures.some(value => value.status === 'possible' || value.status === 'unknown')
  const session = authority.session
  const hint = session?.substantiveHintUsedAt ?? null
  const reveal = session?.answerRevealedAt ?? null
  const assistance = parseLearnContract(learnAssistanceSnapshotSchema, {
    policyVersion: LEARN_V2_ASSISTANCE_POLICY_VERSION, state: actualHelp || hint !== null || reveal !== null ? 'assisted'
      : unresolvedExposure || session?.assistanceRevision === undefined ? 'unknown' : 'unassisted',
    assistanceRevision: session?.assistanceRevision ?? 0, substantiveHintUsedAt: hint, answerRevealedAt: reveal,
    priorExposure: 'unknown', outsideHelp: 'unknown', pasteObserved: observation.pasteObserved, focusLossObserved: observation.focusLossObserved,
    instrumentationVersion: observation.version, instrumentationProvenance: entry.instrumentation ? 'client_observation.v1' : 'missing_instrumentation.v1',
  })
  const assignment = 'assessmentPins' in row ? await matchingAssignment(ctx, userId, row) : null
  const context = 'assessmentPins' in row ? deriveLearnAssessmentResponseContext({ contextPins: row.contextPins,
    assignment: assignment?.status === 'admitted' ? { status: 'admitted', assignmentId: assignment._id, epoch: assignment.epoch, flow: assignment.flow }
      : assignment ? { status: assignment.status } : null }) : null
  const validity = 'assessmentPins' in row ? await assessmentValidity(ctx, userId, row, authority, assistance, now, assignment)
    : parseLearnContract(learnValiditySnapshotSchema, { policyVersion: LEARN_V2_VALIDITY_POLICY_VERSION,
        status: 'excluded', measurementEligible: false, masteryEligible: false, exclusionReasons: ['formative'] })
  if (entry.payload.kind !== 'text' && 'stage' in row) reject('invalid_payload')
  if ('assessmentPins' in row && row.assessmentPins.kind === 'measurement') {
    const item = (await ctx.db.get(row.assessmentPins.itemPins.itemId))!
    const spec = item.responseSpec
    const payload = entry.payload
    if (spec.kind === 'bounded_rubric' ? payload.kind !== 'text'
      : spec.kind === 'numeric' ? payload.kind !== 'numeric' || payload.unit !== spec.unit
        : spec.kind === 'keyed' ? payload.kind !== 'keyed' || payload.keys.length > spec.maxSelections
          : payload.kind !== 'ordered' || payload.entries.length > spec.maxEntries) reject('invalid_payload')
  } else if ('assessmentPins' in row && !['text', 'source_comparison'].includes(entry.payload.kind)) reject('invalid_payload')
  if (entry.payload.kind === 'source_comparison') {
    if (row.scopeKind !== 'v2' || row.contextPins.kind !== 'session' || !row.contextPins.canvas) reject('invalid_payload')
    const activity = await ctx.db.get(row.contextPins.canvas.activityId)
    const sourceRef = entry.payload.sourceRef
    if (!activity || !activity.evidenceReferences.some(value => String(value.sourceSnapshotId) === sourceRef)) reject('invalid_payload')
  }
  return { entry, row, pins: authority.pins, dependencies, assistance, validity, assignment, context,
    payloadDigest: await digest(entry.payload), payloadBytes: learnSerializedBytes(entry.payload, LEARN_V2_RESPONSE_LIMITS.maxResponseBytes) }
}

async function commandReceipt(ctx: ReadCtx, userId: string, key: string) {
  const idempotencyKeyHash = await digest(key)
  const receipt = await ctx.db.query('learnResponseCommandReceipts')
    .withIndex('by_userId_and_idempotencyKeyHash', q => q.eq('userId', userId).eq('idempotencyKeyHash', idempotencyKeyHash)).unique()
  return { idempotencyKeyHash, receipt }
}

async function saveRejection(ctx: MutationCtx, userId: string, row: Target, key: string, requestDigest: string, reason: Rejection) {
  const { idempotencyKeyHash, receipt } = await commandReceipt(ctx, userId, key)
  if (!receipt) {
    const recent = await ctx.db.query('learnResponseCommandReceipts')
      .withIndex('by_userId', q => q.eq('userId', userId).gte('_creationTime', Date.now() - 60_000)).take(8)
    if (recent.length < 8) {
      await ctx.db.insert('learnResponseCommandReceipts', { userId, storageVersion: LEARN_MEASUREMENT_STORAGE_VERSION, createdAt: Date.now(),
        ...anchors(row), idempotencyKeyHash, requestDigest, commandVersion: LEARN_V2_RESPONSE_CONTRACT_VERSION, target: targetReference(row),
        result: { kind: 'rejected', reasonCode: reason }, expiresAt: Date.now() + LEARN_V2_RESPONSE_LIMITS.rejectionRetentionDays * 86_400_000 })
    }
  }
  return rejected(reason)
}

export async function acceptLearnResponseForOwner(ctx: MutationCtx, userId: string, input: LearnV2AcceptResponseCommand): Promise<LearnResponseReceipt> {
  const request = parsePublicLearnRequest(acceptResponseCommandSchema, input)
  const entries = 'response' in request ? [request.response] : [request.teachBack, request.application]
  const rows: Target[] = []
  for (const entry of entries) {
    const row = await requireOwnedResponseTarget(ctx, userId, entry.target)
    if ('stage' in row && row.stage === 'diagnostic') {
      try { learnSerializedBytes(entry.payload, LEARN_V2_RESPONSE_LIMITS.maxDiagnosticBytes) }
      catch {
        if (LEARN_MEASUREMENT_CAPABILITIES.responses) return await saveRejection(ctx, userId, row, request.idempotencyKey, await digest(request), 'payload_too_large')
        throw new Error('Invalid Learn request')
      }
    }
    rows.push(row)
  }
  if (!LEARN_MEASUREMENT_CAPABILITIES.responses) return disabledResponseReceipt()
  const main = rows[rows.length - 1]!
  const requestDigest = await digest(request)
  const { receipt, idempotencyKeyHash } = await commandReceipt(ctx, userId, request.idempotencyKey)
  if (receipt) {
    if (receipt.commandVersion !== LEARN_V2_RESPONSE_CONTRACT_VERSION || receipt.requestDigest !== requestDigest) return rejected('idempotency_conflict')
    if (receipt.result.kind === 'rejected') return learnResponseReceiptSchema.parse({ kind: 'rejected', version: LEARN_V2_RESPONSE_CONTRACT_VERSION, reasonCode: receipt.result.reasonCode })
    if (receipt.result.kind !== 'accepted' || canonical(receipt.target) !== canonical(targetReference(main))) return rejected('idempotency_conflict')
    return learnResponseReceiptSchema.parse({ kind: 'accepted', version: LEARN_V2_RESPONSE_CONTRACT_VERSION, target: targetReference(main),
      submissionId: receipt.result.submissionId, acceptedAt: receipt.result.acceptedAt,
      revision: entries[entries.length - 1]!.expectedRevision + 1, phase: 'stage' in main ? 'accepted' : 'submitted_sealed', bodyAvailability: 'available' })
  }
  const now = Date.now()
  let prepared: Awaited<ReturnType<typeof prepareResponse>>[]
  try {
    if ('response' in request && 'stage' in main) validateLearnAcceptResponseRequest(request, { confidenceRequested: main.confidenceRequested, diagnostic: main.stage === 'diagnostic' })
    else {
      const application = 'deliveryPins' in main ? { deliveryPins: main.deliveryPins } : {}
      const teachBack = 'stage' in rows[0]! ? { confidenceRequested: rows[0].confidenceRequested } : {}
      const pins = { teachBack, application }
      if ('teachBack' in request) {
        if (!('stage' in rows[0]!) || rows[0].stage !== 'teach_back' || main.scopeKind !== 'v2' || rows[0].scopeKind !== 'v2'
          || main.contextPins.kind !== 'session' || rows[0].contextPins.kind !== 'session'
          || main.contextPins.studySessionId !== rows[0].contextPins.studySessionId || main.objectiveId !== rows[0].objectiveId) reject('pins_mismatch')
        validateLearnFinalResponseBundle(request, pins)
      } else validateLearnAcceptResponseRequest(request, { ...application, diagnostic: false })
      validateLearnMasterySubmission({ submission: request }, pins)
    }
    prepared = []
    for (let index = 0; index < entries.length; index++) prepared.push(await prepareResponse(ctx, userId, entries[index]!, rows[index]!, now))
  } catch (error) {
    return await saveRejection(ctx, userId, main, request.idempotencyKey, requestDigest, error instanceof ResponseRejection ? error.code : 'invalid_payload')
  }
  const receiptId = await ctx.db.insert('learnResponseCommandReceipts', { userId, storageVersion: LEARN_MEASUREMENT_STORAGE_VERSION,
    createdAt: now, ...anchors(main), idempotencyKeyHash, requestDigest, commandVersion: LEARN_V2_RESPONSE_CONTRACT_VERSION,
    target: targetReference(main), result: { kind: 'rejected', reasonCode: 'unavailable' }, expiresAt: now + 90 * 86_400_000 })
  let submissionId: Id<'learnResponses'> | null = null
  for (const value of prepared) {
    const base = { userId, storageVersion: LEARN_MEASUREMENT_STORAGE_VERSION, createdAt: now, evidenceStatus: 'available' as const,
      acceptedAt: now, payloadDigest: value.payloadDigest, ...(value.entry.confidence === undefined ? {} : { confidence: value.entry.confidence }),
      assistanceSnapshot: value.assistance, validitySnapshot: value.validity, bodyAvailability: 'available' as const,
      currentEligibility: value.validity.status === 'valid' ? 'eligible' as const : value.validity.status === 'excluded' ? 'excluded' as const : 'unknown' as const,
      responseContractVersion: LEARN_V2_RESPONSE_CONTRACT_VERSION, disclosurePolicyVersion: LEARN_V2_ASSESSMENT_DISCLOSURE_VERSION, receiptId }
    if ('stage' in value.row) submissionId = await ctx.db.insert('learnResponses', { ...base, ...value.pins, responseSlotId: value.row._id })
    else {
      if (value.pins.scopeKind !== 'v2' || !value.context) throw new Error('Learn assessment scope unavailable')
      const fields = { ...base, ...value.pins, assessmentOpportunityId: value.row._id, assessmentPins: value.row.assessmentPins,
        scoringBinding: value.row.scoringBinding, deliveryGrantId: value.row.deliveryGrantId!, ...value.context }
      if (value.pins.contextPins.kind === 'planned_measurement') {
        if (value.context.measurementContext.status !== 'admitted') throw new Error('Learn measurement context unavailable')
        submissionId = await ctx.db.insert('learnResponses', { ...fields, contextPins: value.pins.contextPins, measurementContext: value.context.measurementContext })
      } else {
        const contextPins = value.pins.contextPins.kind === 'calibration' ? { ...value.pins.contextPins, origin: value.context.flow } : value.pins.contextPins
        submissionId = await ctx.db.insert('learnResponses', { ...fields, contextPins })
      }
      const jobId = await ctx.db.insert('learnJobs', { userId, learningVoidId: value.row.learningVoidId, blueprintRevisionId: value.row.blueprintRevisionId,
        assessmentOpportunityId: value.row._id, assessmentPurpose: value.row.purpose.kind, submissionId,
        scoringBinding: value.row.scoringBinding, type: 'sealed_response_scoring', status: 'queued', revision: 1,
        idempotencyKey: `submission:${submissionId}`, requestFingerprint: value.payloadDigest, providerEnabled: false, attempts: 0, createdAt: now, updatedAt: now })
      await ctx.db.patch(value.row._id, { phase: 'submitted_sealed', submissionId, scoringJobId: jobId, revision: value.row.revision + 1 })
    }
    await ctx.db.insert('learnResponseBodies', { userId, storageVersion: LEARN_MEASUREMENT_STORAGE_VERSION, createdAt: now,
      ...aggregate(value.row), submissionId, payload: value.entry.payload, payloadBytes: value.payloadBytes, payloadDigest: value.payloadDigest })
    for (const dependency of value.dependencies) await ctx.db.insert('learnResponseEvidenceLinks', {
      userId, storageVersion: LEARN_MEASUREMENT_STORAGE_VERSION, createdAt: now, evidenceStatus: 'available', submissionId,
      aggregate: aggregate(value.row), ...aggregate(value.row), dependency,
    })
    if ('stage' in value.row) await ctx.db.patch(value.row._id, { status: 'accepted', submissionId, revision: value.row.revision + 1 })
    if (value.assignment) {
      await writeLearnMeasurementEnrollmentFact(ctx, userId, value.assignment)
      await writeLearnResponseAcceptanceFact(ctx, userId, (await ctx.db.get(submissionId))!, value.assignment.epoch)
    }
  }
  if (!submissionId) throw new Error('Learn submission unavailable')
  await ctx.db.patch(receiptId, { result: { kind: 'accepted', submissionId, acceptedAt: now }, expiresAt: undefined })
  return learnResponseReceiptSchema.parse({ kind: 'accepted', version: LEARN_V2_RESPONSE_CONTRACT_VERSION, target: targetReference(main),
    submissionId, acceptedAt: now, revision: main.revision + 1, phase: 'stage' in main ? 'accepted' : 'submitted_sealed', bodyAvailability: 'available' })
}

async function retainedBody(ctx: ReadCtx, userId: string, response: Doc<'learnResponses'>) {
  if (response.bodyAvailability === 'purged') return { bodyAvailability: 'purged' as const, reasonCode: 'evidence_unavailable' as const, purgedAt: response.bodyPurgedAt ?? response.invalidatedAt ?? response.acceptedAt }
  const unavailable = { bodyAvailability: 'unavailable' as const, reasonCode: 'evidence_unavailable' as const }
  if (response.evidenceStatus !== 'available' || response.invalidatedAt !== undefined) return unavailable
  if (response.scopeKind === 'standalone') {
    const thread = await ctx.db.get(response.threadId)
    if (!thread || thread.userId !== userId || thread.deletionStartedAt !== undefined) return unavailable
  } else {
    const learningVoid = await ctx.db.get(response.learningVoidId)
    const folder = learningVoid && await ctx.db.get(learningVoid.folderId)
    if (!learningVoid || learningVoid.userId !== userId || !folder || folder.userId !== userId) return unavailable
  }
  const links = await ctx.db.query('learnResponseEvidenceLinks')
    .withIndex('by_userId_and_submissionId', q => q.eq('userId', userId).eq('submissionId', response._id)).take(65)
  if (links.length > 64 || (response.scopeKind === 'v2' && !links.length)) return unavailable
  for (const link of links) {
    if (link.invalidatedAt !== undefined || link.evidenceStatus !== 'available') return unavailable
    const dependency = link.dependency
    if (dependency.kind === 'snapshot') {
      try {
        const current = await snapshotDependency(ctx, userId, response.scopeKind === 'v2' ? response.learningVoidId : link.learningVoidId!, dependency.sourceSnapshotId, dependency.supportManifestDigest)
        if (canonical(current) !== canonical(dependency)) return unavailable
      } catch { return unavailable }
    } else if (dependency.kind === 'document') {
      const document = await ctx.db.get(dependency.documentId)
      const folder = document && await ctx.db.get(document.folderId)
      if (!document || document.userId !== userId || document.status !== 'success' || !folder || folder.userId !== userId || document.sourceRevision !== dependency.sourceRevision) return unavailable
    } else {
      const folder = await ctx.db.get(dependency.folderId)
      if (!folder || folder.userId !== userId) return unavailable
    }
  }
  const body = await ctx.db.query('learnResponseBodies')
    .withIndex('by_userId_and_submissionId', q => q.eq('userId', userId).eq('submissionId', response._id)).unique()
  if (!body || body.payloadDigest !== response.payloadDigest || await digest(body.payload) !== response.payloadDigest
    || learnSerializedBytes(body.payload, LEARN_V2_RESPONSE_LIMITS.maxResponseBytes) !== body.payloadBytes) return unavailable
  return { bodyAvailability: 'available' as const, payload: body.payload }
}

export async function getLearnResponseStateForOwner(ctx: ReadCtx, userId: string, target: LearnResponseTarget): Promise<LearnV2ResponseState> {
  const row = await requireOwnedResponseTarget(ctx, userId, target)
  if (!LEARN_MEASUREMENT_CAPABILITIES.responses) return disabledLearnV2Result()
  let work = null
  if (row.submissionId) {
    const response = await ctx.db.get(row.submissionId)
    if (!response || response.userId !== userId || canonical('assessmentOpportunityId' in response
      ? { assessmentOpportunityId: response.assessmentOpportunityId } : { responseSlotId: response.responseSlotId }) !== canonical(target)) throw new Error('Learn response unavailable')
    work = parseLearnContract(learnAttemptHistorySchema, { version: LEARN_V2_ASSESSMENT_DISCLOSURE_VERSION,
      submissionId: response._id, acceptedAt: response.acceptedAt, ...(response.confidence === undefined ? {} : { confidence: response.confidence }),
      assistanceSnapshot: response.assistanceSnapshot, validitySnapshot: response.validitySnapshot, currentEligibility: response.currentEligibility,
      body: await retainedBody(ctx, userId, response), result: null })
  }
  return { version: LEARN_V2_PUBLIC_API_VERSION, status: 'available', target, revision: row.revision,
    state: row.submissionId ? 'accepted' : 'stage' in row ? row.status : ['invalid', 'cancelled', 'abandoned'].includes(row.phase) ? 'terminal' : 'open', work }
}

export async function terminalizeLearnResponseForOwner(ctx: MutationCtx, userId: string, input: z.infer<typeof terminalizeResponseSchema>): Promise<LearnV2Terminalization> {
  const request = parsePublicLearnRequest(terminalizeResponseSchema, input)
  const row = await requireOwnedResponseTarget(ctx, userId, request.target)
  if (!LEARN_MEASUREMENT_CAPABILITIES.responses) return disabledLearnV2Result()
  const unavailable = (reason: string): LearnV2Terminalization => ({ version: LEARN_V2_PUBLIC_API_VERSION, status: 'unavailable', reasonCodes: [reason] })
  const { receipt, idempotencyKeyHash } = await commandReceipt(ctx, userId, request.idempotencyKey)
  if (receipt) {
    if (receipt.commandVersion !== LEARN_V2_RESPONSE_TERMINALIZATION_VERSION || receipt.result.kind !== 'terminalized'
      || canonical(receipt.target) !== canonical(request.target) || canonical(receipt.result.target) !== canonical(request.target)) return unavailable('idempotency_conflict')
    const result = parseLearnContract(learnResponseTerminalizedResultSchema, receipt.result)
    return { version: LEARN_V2_PUBLIC_API_VERSION, status: 'terminal', target: result.target, revision: result.revision, reason: result.reasonCode, terminalizedAt: result.terminalizedAt }
  }
  if (row.submissionId) return unavailable('already_accepted')
  if (request.expectedRevision !== row.revision) return unavailable('stale_revision')
  if ('stage' in row ? row.status !== 'open' : !['preparing', 'ready', 'test_open'].includes(row.phase)) return unavailable('unavailable')
  const result = parseLearnContract(learnResponseTerminalizedResultSchema, { kind: 'terminalized', target: request.target,
    revision: row.revision + 1, reasonCode: request.reason, terminalizedAt: Date.now() })
  await ctx.db.insert('learnResponseCommandReceipts', { userId, storageVersion: LEARN_MEASUREMENT_STORAGE_VERSION,
    createdAt: result.terminalizedAt, ...anchors(row), idempotencyKeyHash, requestDigest: await digest(request),
    commandVersion: LEARN_V2_RESPONSE_TERMINALIZATION_VERSION, target: result.target, result })
  if ('stage' in row) await ctx.db.patch(row._id, { status: 'terminal', terminalReason: result.reasonCode, revision: result.revision })
  else {
    await ctx.db.patch(row._id, { phase: result.reasonCode, reasonCode: result.reasonCode, revision: result.revision })
    const assignment = await matchingAssignment(ctx, userId, row)
    if (assignment) await appendLearnMeasurementFact(ctx, userId, { epoch: assignment.epoch, learningVoidId: row.learningVoidId,
      occurredAt: result.terminalizedAt, fact: { kind: 'opportunity', assessmentOpportunityId: row._id, recordRevision: result.revision,
        status: result.reasonCode, dueAt: row.dueAt ?? null, closeAt: row.closeAt, clock: 'clock' in row.purpose ? row.purpose.clock : null, originalSlot: row.originalSlot } })
  }
  return { version: LEARN_V2_PUBLIC_API_VERSION, status: 'terminal', target: result.target, revision: result.revision, reason: result.reasonCode, terminalizedAt: result.terminalizedAt }
}

export async function authorizeLearnResponseAssistanceForOwner(ctx: MutationCtx, userId: string, input: z.infer<typeof authorizeAssistanceSchema>): Promise<LearnV2AssistanceAuthorization> {
  const request = parsePublicLearnRequest(authorizeAssistanceSchema, input)
  const deny = (reasonCode: 'disabled' | 'unavailable' | 'test_open' | 'disclosure_unknown'): LearnV2AssistanceAuthorization => ({ version: LEARN_V2_PUBLIC_API_VERSION, status: 'denied', reasonCode })
  const row = request.assessmentOpportunityId ? await requireOwnedResponseTarget(ctx, userId, { assessmentOpportunityId: request.assessmentOpportunityId }) : null
  if (!LEARN_MEASUREMENT_CAPABILITIES.responses) return deny('disabled')
  if (!row || 'stage' in row) return deny('disclosure_unknown')
  try {
    requireAvailable(row)
    if (!row.submissionId) {
      const authority = await currentScope(ctx, userId, row)
      await responseDependencies(ctx, userId, authority, row)
    } else {
      const response = await ctx.db.get(row.submissionId)
      if (!response || (await retainedBody(ctx, userId, response)).bodyAvailability !== 'available') return deny('unavailable')
    }
  } catch { return deny('unavailable') }
  const denied = !row.submissionId && isLearnAssessmentTestOnly(parseLearnContract(learnAssessmentPurposeSchema, row.purpose))
  if (!row.submissionId && row.phase !== 'test_open') return deny('unavailable')
  const receiptHash = await digest(['assistance', row._id, request.idempotencyKey, request.kind, row.submissionId ? 'sealed' : 'open'])
  const existing = await ctx.db.query('learnAssessmentExposures')
    .withIndex('by_userId_and_deliveryReceiptHash', q => q.eq('userId', userId).eq('deliveryReceiptHash', receiptHash)).unique()
  if (existing) return denied ? deny('test_open') : { version: LEARN_V2_PUBLIC_API_VERSION, status: 'authorized', authorizationId: existing._id, assessmentOpportunityId: row._id }
  const now = Date.now()
  const id = await ctx.db.insert('learnAssessmentExposures', { userId, storageVersion: LEARN_MEASUREMENT_STORAGE_VERSION, createdAt: now,
    ...anchors(row), blueprintRevisionId: row.blueprintRevisionId, objectiveId: row.objectiveId, assessmentOpportunityId: row._id,
    ...(row.contextPins.kind === 'session' ? { studySessionId: row.contextPins.studySessionId } : {}),
    purpose: denied ? 'assistance_requested_denied' : 'teaching', status: denied ? 'requested_denied' : 'granted',
    projectionDigest: await digest({ kind: request.kind, opportunity: row._id }), deliveryReceiptHash: receiptHash, serverTime: now,
    policyVersion: LEARN_V2_ASSISTANCE_POLICY_VERSION, provenanceVersion: 'learn-v2.assistance-authorization.v1' })
  if (!denied && !row.submissionId && row.contextPins.kind === 'session') {
    const session = (await ctx.db.get(row.contextPins.studySessionId))!
    await ctx.db.patch(session._id, { assistanceRevision: (session.assistanceRevision ?? 0) + 1,
      ...(request.kind === 'reveal' ? { answerRevealedAt: session.answerRevealedAt ?? now } : { substantiveHintUsedAt: session.substantiveHintUsedAt ?? now }) })
  }
  return denied ? deny('test_open') : { version: LEARN_V2_PUBLIC_API_VERSION, status: 'authorized', authorizationId: id, assessmentOpportunityId: row._id }
}

const integrityInputSchema = z.strictObject({ submissionId: learnIdSchema<'learnResponses'>(),
  kind: z.enum(['evidence_unavailable', 'pre_seal_contamination', 'body_purged']),
  reasonCode: learnCodeSchema, effectiveAt: learnTimestampSchema, policyVersion: learnVersionSchema })

export async function recordLearnResponseIntegrityForOwner(ctx: MutationCtx, userId: string, input: z.infer<typeof integrityInputSchema>) {
  const value = parseLearnContract(integrityInputSchema, input)
  const response = await ctx.db.get(value.submissionId)
  if (!response || response.userId !== userId) throw new Error('Learn access denied')
  await requireOwnedResponseTarget(ctx, userId, 'assessmentOpportunityId' in response
    ? { assessmentOpportunityId: response.assessmentOpportunityId } : { responseSlotId: response.responseSlotId })
  if (!LEARN_MEASUREMENT_CAPABILITIES.responses) return null
  const previous = await ctx.db.query('learnResponseIntegrityEvents')
    .withIndex('by_userId_and_submissionId_and_sequence', q => q.eq('userId', userId).eq('submissionId', response._id)).order('desc').first()
  if (previous?.kind === value.kind && previous.effectiveAt === value.effectiveAt && previous.reasonCode === value.reasonCode) return previous._id
  const epoch = 'measurementContext' in response && response.measurementContext.status === 'admitted' ? response.measurementContext.baselineEpoch : null
  const sourceFactSequence = epoch ? (await nextLearnMeasurementSourceSequence(ctx, userId)).sequence : 0
  const sequence = (previous?.sequence ?? 0) + 1
  if (!Number.isSafeInteger(sequence) || value.effectiveAt > Date.now()
    || (value.kind === 'pre_seal_contamination' && value.effectiveAt > response.acceptedAt)) throw new Error('Invalid Learn integrity fact')
  const id = await ctx.db.insert('learnResponseIntegrityEvents', { ...value, userId, storageVersion: LEARN_MEASUREMENT_STORAGE_VERSION,
    createdAt: Date.now(), ...anchors(response), sequence, sourceFactSequence })
  const patch = { currentEligibility: 'excluded' as const,
    ...(value.kind !== 'pre_seal_contamination' ? { evidenceStatus: 'evidence_unavailable' as const, invalidatedAt: Date.now() } : {}),
    ...(value.kind === 'body_purged' ? { bodyAvailability: 'purged' as const, bodyUnavailableReason: 'evidence_unavailable' as const, bodyPurgedAt: Date.now() } : {}) }
  await ctx.db.patch(response._id, patch)
  if (value.kind === 'body_purged') {
    const bodies = await ctx.db.query('learnResponseBodies').withIndex('by_userId_and_submissionId', q => q.eq('userId', userId).eq('submissionId', response._id)).take(2)
    for (const body of bodies) await ctx.db.delete(body._id)
  }
  if (epoch) await appendLearnMeasurementFact(ctx, userId, { epoch, learningVoidId: response.scopeKind === 'v2' ? response.learningVoidId : undefined,
    occurredAt: Date.now(), expectedSequence: sourceFactSequence, fact: { kind: 'integrity', submissionId: response._id, integrityEventId: id,
      currentEligibility: 'excluded', evidenceAvailable: value.kind === 'pre_seal_contamination' && response.evidenceStatus === 'available',
      bodyAvailability: value.kind === 'body_purged' ? 'purged' : response.bodyAvailability } })
  return id
}
