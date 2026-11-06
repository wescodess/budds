import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { LEARN_MEASUREMENT_STORAGE_VERSION } from '../../shared/learn-v2-measurement-storage-manifest'
import { LEARN_V2_ASSESSMENT_DISCLOSURE_VERSION, projectAttemptHistory } from '../../shared/learn-v2-assessment-disclosure'
import { learnAssistanceSnapshotSchema, learnValiditySnapshotSchema } from '../../shared/learn-v2-responses'
import { legacyResponseAvailable, privacyDigest, privateFields, retainedResponsePayload, sourceBodyAvailable } from './learnV2ResponsePrivacy'

export const PERSONAL_EXPORT_POLICY = 'learn-v2.personal-export.v1'
const PENDING = 'learn-v2.personal-export-pending.v1'

async function inventoryDigest(ctx: QueryCtx | MutationCtx, userId: string, documentId?: Id<'documents'>) {
  const tables = ['learnAssessmentOpportunities', 'documents', 'messages', 'courses', 'courseSections', 'quizQuestions',
    'flashcards', 'flashcardRoomCards', 'learningThreadArtifacts', 'learnResponses', 'masteryAttempts'] as const
  const latest = await Promise.all(tables.map(table => ctx.db.query(table).withIndex('by_userId', q => q.eq('userId', userId)).order('desc').first()))
  return await privacyDigest([latest.map(row => row?._id ?? null), documentId ?? null])
}

export async function authorizePersonalExportPage(ctx: MutationCtx, userId: string, args: {
  authorizationId?: Id<'learnAssessmentExposures'>, cursor?: string, documentId?: Id<'documents'>,
}) {
  if (args.documentId) {
    const document = await ctx.db.get(args.documentId)
    const folder = document && await ctx.db.get(document.folderId)
    if (!document || document.userId !== userId || document.status !== 'success' || !folder || folder.userId !== userId) throw new Error('Export authorization unavailable')
  }
  const inventory = await inventoryDigest(ctx, userId, args.documentId)
  const completeReceiptHash = await privacyDigest('personal-export-complete')
  let authorizationId = args.authorizationId
  if (!authorizationId) {
    if (args.cursor !== undefined) throw new Error('Export authorization unavailable')
    const previous = await ctx.db.query('learnAssessmentExposures').withIndex('by_userId_and_deliveryReceiptHash', q => q.eq('userId', userId).eq('deliveryReceiptHash', completeReceiptHash)).order('desc').take(8)
    const reusable = previous.find(row => row.policyVersion === PERSONAL_EXPORT_POLICY && row.provenanceVersion === PERSONAL_EXPORT_POLICY
      && row.status === 'granted' && row.projectionDigest === inventory)
    if (reusable) return { authorizationId: reusable._id, cursor: null, done: true }
    authorizationId = await ctx.db.insert('learnAssessmentExposures', { userId, storageVersion: LEARN_MEASUREMENT_STORAGE_VERSION,
      createdAt: Date.now(), purpose: 'imported', status: 'possible', projectionDigest: inventory,
      deliveryReceiptHash: await privacyDigest(null), serverTime: Date.now(), policyVersion: PERSONAL_EXPORT_POLICY, provenanceVersion: PENDING })
  }
  const authorization = await ctx.db.get(authorizationId)
  if (!authorization || authorization.userId !== userId || authorization.policyVersion !== PERSONAL_EXPORT_POLICY
    || authorization.provenanceVersion !== PENDING || authorization.status !== 'possible' || authorization.projectionDigest !== inventory
    || authorization.deliveryReceiptHash !== await privacyDigest(args.cursor ?? null)) throw new Error('Export authorization unavailable')
  const page = await ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId', q => q.eq('userId', userId))
    .paginate({ cursor: args.cursor ?? null, numItems: 8 })
  // An export of only the current own response has no help exposure. A full
  // archive that also releases prior records or original material is unknown
  // support unless a later purpose-specific authority establishes relevance.
  const content = await Promise.all([
    ctx.db.query('documents').withIndex('by_userId', q => q.eq('userId', userId)).first(),
    ctx.db.query('messages').withIndex('by_userId', q => q.eq('userId', userId)).first(),
    ctx.db.query('courses').withIndex('by_userId', q => q.eq('userId', userId)).first(),
    ctx.db.query('flashcards').withIndex('by_userId', q => q.eq('userId', userId)).first(),
    ctx.db.query('learningThreadArtifacts').withIndex('by_userId', q => q.eq('userId', userId)).first(),
    ctx.db.query('quizQuestions').withIndex('by_userId', q => q.eq('userId', userId)).first(),
    ctx.db.query('courseSections').withIndex('by_userId', q => q.eq('userId', userId)).first(),
    ctx.db.query('flashcardRoomCards').withIndex('by_userId', q => q.eq('userId', userId)).first(),
  ])
  const responses = await ctx.db.query('learnResponses').withIndex('by_userId', q => q.eq('userId', userId)).take(2)
  const legacy = await ctx.db.query('masteryAttempts').withIndex('by_userId', q => q.eq('userId', userId)).take(2)
  for (const opportunity of page.page) {
    if (opportunity.submissionId || ['submitted_sealed', 'scoring_pending', 'scored_pass', 'scored_fail', 'cancelled', 'abandoned', 'invalid'].includes(opportunity.phase)) continue
    const mayHelp = !!args.documentId || content.some(Boolean)
      || responses.some(row => !('assessmentOpportunityId' in row) || row.assessmentOpportunityId !== opportunity._id)
      || legacy.some(row => row.assessmentOpportunityId !== opportunity._id)
    if (!mayHelp) continue
    const receiptHash = await privacyDigest(['personal-export', opportunity._id])
    const previous = await ctx.db.query('learnAssessmentExposures').withIndex('by_userId_and_deliveryReceiptHash', q => q.eq('userId', userId).eq('deliveryReceiptHash', receiptHash)).first()
    if (!previous) await ctx.db.insert('learnAssessmentExposures', { userId, storageVersion: LEARN_MEASUREMENT_STORAGE_VERSION,
      createdAt: Date.now(), learningVoidId: opportunity.learningVoidId, blueprintRevisionId: opportunity.blueprintRevisionId,
      objectiveId: opportunity.objectiveId, assessmentOpportunityId: opportunity._id, purpose: 'imported', status: 'unknown',
      projectionDigest: receiptHash, deliveryReceiptHash: receiptHash, serverTime: Date.now(),
      policyVersion: PERSONAL_EXPORT_POLICY, provenanceVersion: PERSONAL_EXPORT_POLICY })
    // The opportunity read above conflicts with a concurrent seal; the
    // exposure range read during acceptance conflicts with this insert.
  }
  await ctx.db.patch(authorizationId, { deliveryReceiptHash: page.isDone ? completeReceiptHash : await privacyDigest(page.continueCursor),
    ...(page.isDone ? { status: 'granted' as const, provenanceVersion: PERSONAL_EXPORT_POLICY } : {}) })
  return { authorizationId, cursor: page.isDone ? null : page.continueCursor, done: page.isDone }
}

export async function requirePersonalExportAuthorization(ctx: QueryCtx, userId: string, authorizationId?: Id<'learnAssessmentExposures'>, documentId?: Id<'documents'>) {
  const authorization = authorizationId && await ctx.db.get(authorizationId)
  if (!authorization || authorization.userId !== userId || authorization.policyVersion !== PERSONAL_EXPORT_POLICY
    || authorization.provenanceVersion !== PERSONAL_EXPORT_POLICY || authorization.status !== 'granted') throw new Error('Export authorization unavailable')
  const full = await inventoryDigest(ctx, userId)
  if (authorization.projectionDigest !== full && (!documentId || authorization.projectionDigest !== await inventoryDigest(ctx, userId, documentId))) throw new Error('Export authorization unavailable')
}

export const PERSONAL_METADATA = {
  learningVoids: ['folderId', 'title', 'goal', 'status', 'revision', 'createdAt', 'updatedAt'],
  learnBlueprints: ['learningVoidId', 'revision', 'createdAt'],
  learnBlueprintRevisions: ['learningVoidId', 'blueprintId', 'revision', 'recordRevision', 'status', 'createdAt', 'updatedAt'],
  learnMilestones: ['blueprintRevisionId', 'order', 'title'],
  learnObjectives: ['blueprintRevisionId', 'order', 'title', 'capability', 'depth'],
  learnObjectivePrerequisites: ['blueprintRevisionId', 'objectiveId', 'prerequisiteObjectiveId'],
  learnSourceIdentities: ['origin', 'tombstonedAt'],
  learnSourceSnapshots: ['learningVoidId', 'blueprintRevisionId', 'revision', 'recordRevision', 'status', 'effectiveStatus', 'unavailableReason', 'rightsStatus', 'conflictStatus', 'evidencePurgedAt', 'createdAt'],
  learnSourceExcerpts: ['rightsStatus', 'evidencePurgedAt'],
  learnClaimSupports: ['entailment', 'conflictStatus', 'evidenceStatus'],
  learnSourceCommandReceipts: ['learningVoidId', 'command', 'createdAt'],
  learnSourceFetchLeases: ['learningVoidId', 'expiresAt', 'createdAt'],
  learnFolderSourceManifests: ['learningVoidId', 'status', 'coverage', 'recordRevision', 'createdAt'],
  learnFolderSourceManifestFolders: ['manifestId', 'order', 'evidencePurgedAt'],
  learnFolderSourceManifestEntries: ['manifestId', 'order', 'availability', 'unavailableReason', 'evidencePurgedAt'],
  learnJobs: ['userId', 'learningVoidId', 'blueprintRevisionId', 'type', 'status', 'revision', 'attempts', 'createdAt', 'updatedAt',
    'providerProductPolicyVersion', 'providerRollbackPolicyVersion', 'providerReservationAttempt', 'providerReservedMicroUsd', 'providerReservationStatus', 'providerAdmissionDenialCode', 'providerAdmissionDeniedAt'],
  studyPlans: ['learningVoidId', 'revision', 'activeRevisionId', 'createdAt'],
  studyPlanRevisions: ['learningVoidId', 'studyPlanId', 'blueprintRevisionId', 'revision', 'recordRevision', 'status', 'timezone', 'feasibility', 'createdAt', 'acceptedAt'],
  studySessions: ['studyPlanRevisionId', 'primaryObjectiveId', 'assessmentOpportunityId', 'assessmentPurpose', 'status', 'revision', 'scheduledStartAt', 'scheduledEndAt', 'timezone', 'substantiveHintUsedAt', 'answerRevealedAt', 'assistanceRevision'],
  studySessionRetrievalObjectives: ['studySessionId', 'objectiveId', 'order'],
  sessionContent: ['studySessionId', 'studyPlanRevisionId', 'blueprintRevisionId', 'objectiveId', 'revision', 'status', 'createdAt', 'publishedAt'],
  sessionContentBlocks: ['sessionContentId', 'order', 'kind'],
  sessionContentClaims: ['sessionContentId', 'order'],
  learnLifecycleReceipts: ['learningVoidId', 'command', 'revision', 'status', 'blueprintRevisionId', 'createdAt'],
  learnPlanAuditEvents: ['learningVoidId', 'studyPlanRevisionId', 'studySessionId', 'reasonCode', 'createdAt'],
  learningThreads: ['learningVoidId', 'authorityKind', 'originalNeed', 'outcome', 'outcomeProvenance', 'intent', 'availableTime', 'evidenceState', 'lifecycle', 'revision', 'createdAt', 'updatedAt'],
  learningThreadArtifacts: ['threadId', 'activityId', 'status', 'title', 'summary', 'createdAt', 'updatedAt'],
  learningThreadContributions: ['threadId', 'sourceFeature', 'sourceIdentity', 'sourceRevision', 'contributionKind', 'sourceStatus', 'createdAt'],
  learnActivityDecisions: ['threadId', 'activityId', 'status', 'createdAt'],
  learnActivityEvidenceLinks: ['threadId', 'activityId', 'invalidatedAt', 'createdAt'],
} as const

export function exportThread(row: Doc<'learningThreads'>) {
  const decision = row.initialDecision
  return { ...privateFields(row, PERSONAL_METADATA.learningThreads),
    ...(decision ? { initialDecision: {
      decisionVersion: decision.decisionVersion, templateVersion: decision.templateVersion,
      status: decision.status, reasonCode: decision.reasonCode, continuationKind: decision.continuationKind,
      questionKey: decision.questionKey, answer: decision.answer, preparedAt: decision.preparedAt, resolvedAt: decision.resolvedAt,
    } } : {}) }
}

export function exportDecision(row: Doc<'learnActivityDecisions'>) {
  const override = row.overrideApplication
  return { ...privateFields(row, PERSONAL_METADATA.learnActivityDecisions),
    reasonCode: row.reasonCode,
    selectedActivity: row.selectedActivity ? { primitive: row.selectedActivity.primitive, activityClass: row.selectedActivity.activityClass } : null,
    ...(override ? { overrideApplication: {
      version: override.version, option: override.option, outcome: override.outcome,
      applicationReason: override.applicationReason, effectiveAvailableTime: override.effectiveAvailableTime,
    } } : {}) }
}

export async function exportPersonalResponse(ctx: QueryCtx, userId: string, response: Doc<'learnResponses'>) {
  const payload = await retainedResponsePayload(ctx, userId, response)
  const work = projectAttemptHistory({ submissionId: response._id, acceptedAt: response.acceptedAt, confidence: response.confidence,
    assistanceSnapshot: response.assistanceSnapshot, validitySnapshot: response.validitySnapshot, currentEligibility: response.currentEligibility,
    body: payload ? { bodyAvailability: 'available', payload } : response.bodyAvailability === 'purged'
      ? { bodyAvailability: 'purged', reasonCode: 'evidence_unavailable', purgedAt: response.bodyPurgedAt ?? response.acceptedAt }
      : { bodyAvailability: 'unavailable', reasonCode: 'evidence_unavailable' }, result: null },
  { owned: response.userId === userId, bodyDisclosureAllowed: payload !== null, resultDisclosureAllowed: false })
  return { version: LEARN_V2_ASSESSMENT_DISCLOSURE_VERSION, assistance: work.assistanceSnapshot, validity: work.validitySnapshot,
    currentEligibility: payload ? response.currentEligibility : 'excluded',
    evidenceStatus: payload ? 'available' : 'evidence_unavailable',
    bodyAvailability: work.body.bodyAvailability, ...(payload ? {} : { bodyUnavailableReason: 'evidence_unavailable' }) }
}

export async function exportLegacyAttempt(ctx: QueryCtx, userId: string, attempt: Doc<'masteryAttempts'>) {
  const assistance = learnAssistanceSnapshotSchema.safeParse(attempt.assistanceSnapshot)
  const validity = learnValiditySnapshotSchema.safeParse(attempt.validitySnapshot)
  return { ...privateFields(attempt, ['objectiveId', 'blueprintRevisionId', 'studySessionId', 'sessionContentId', 'studyPlanRevisionId', 'submissionId', 'assessmentOpportunityId',
    'kind', 'activityContractVersion', 'attemptedAt', 'attemptLocalDate', 'attemptTimezone', 'acceptedAt', 'scoreCommittedAt', 'serverScorePercent', 'confidence', 'usedHint', 'usedReveal',
    'masteryStateBefore', 'masteryStateAfter', 'masteryTransitionReason', 'masteryTransitionVersion', 'result']),
  ...(assistance.success ? { assistance: assistance.data } : {}),
  ...(validity.success ? { validity: validity.data } : {}),
  ...(await legacyResponseAvailable(ctx, userId, attempt)
    ? { bodyAvailability: 'available', ...(attempt.submissionId ? {} : { response: attempt.response }) }
    : { bodyAvailability: 'unavailable', bodyUnavailableReason: 'evidence_unavailable' }) }
}

export async function exportActivity(ctx: QueryCtx, userId: string, activity: Doc<'learningThreadActivities'>) {
  const result = privateFields(activity, ['threadId', 'activityId', 'learningVoidId', 'blueprintRevisionId', 'objectiveId', 'sessionContentId', 'boundaryOrdinal', 'planRevision',
    'activityClass', 'status', 'submittedAt', 'submittedConfidence', 'masteryAttemptId', 'createdAt', 'updatedAt'])
  const thread = await ctx.db.get(activity.threadId)
  let available = !!thread && thread.userId === userId && thread.deletionStartedAt === undefined
  for (const reference of activity.evidenceReferences) if (!await sourceBodyAvailable(ctx, userId, reference.sourceSnapshotId)) available = false
  const links = await ctx.db.query('learnActivityEvidenceLinks').withIndex('by_userId_and_activityId', q => q.eq('userId', userId).eq('activityId', activity._id)).take(65)
  if (links.length > 64 || links.some(link => link.invalidatedAt !== undefined)) available = false
  if (activity.masteryAttemptId) {
    const attempt = await ctx.db.get(activity.masteryAttemptId)
    if (!attempt || !await legacyResponseAvailable(ctx, userId, attempt)) available = false
  }
  if (available && activity.submittedResponse) {
    result.submittedResponse = activity.submittedResponse
    if (activity.activityClass === 'non_factual' && activity.decisionInputs.routerVersion === 'learn-adaptive.preparing-diagnostic.v1') result.diagnosticResponse = activity.submittedResponse
  }
  else if (activity.submittedResponse || activity.submittedConfidence) Object.assign(result, { bodyAvailability: 'unavailable', bodyUnavailableReason: 'evidence_unavailable' })
  return result
}
