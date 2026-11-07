import type { Doc, Id } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'
import { LEARN_MEASUREMENT_STORAGE_LIMITS, type LearnMeasurementCollection } from '../../shared/learn-v2-measurement-storage-manifest'

type ExportRow = Record<string, unknown> & { _id: Id<LearnMeasurementCollection>, _creationTime: number }

const metadataFields = {
  // nextId is private lineage linkage and is intentionally withheld.
  learnArtifactLineages: ['lineageVersion', 'classification', 'derivation', 'evidenceStatus', 'invalidatedAt'],
  learnArtifactLineageOrigins: ['transformation'],
  learnArtifactCaseBindings: [],
  learnArtifactValidations: ['decision', 'coverage', 'evidenceStatus', 'invalidatedAt'],
  learnArtifactSourceLinks: ['evidenceStatus', 'invalidatedAt'],
  learnAssessmentCatalogs: ['catalogRevision', 'instrumentationEpoch', 'historyCompleteness'],
  learnAssessmentCases: ['usageClass', 'reservedAt'],
  learnMeasurementFamilies: ['revision', 'recordRevision', 'status', 'evidenceStatus'],
  learnMeasurementItems: ['revision', 'status', 'evidenceStatus'],
  learnMeasurementScoringSpecs: ['revision', 'evidenceStatus'],
  learnMeasurementClaims: ['revision', 'evidenceStatus'],
  learnMeasurementSupports: ['supportRevision', 'evidenceStatus'],
  learnMeasurementValidations: ['check', 'decision', 'evidenceStatus'],
  learnMeasurementAssignments: ['learningVoidId', 'epoch', 'flow', 'entryPoint', 'status', 'protocolStatus', 'historyStatus', 'enrollmentAt', 'evidenceStatus'],
  learnAssessmentOpportunities: ['learningVoidId', 'assignmentId', 'horizonDays', 'phase', 'revision', 'operationalEligibility', 'dueAt', 'openAt', 'closeAt', 'eligibleAt', 'submissionId', 'authoritativeAttemptId', 'checkSequence', 'originalSlot', 'deliveryPins', 'evidenceStatus'],
  learnAssessmentExposures: ['purpose', 'status', 'serverTime', 'observedAt', 'assessmentOpportunityId', 'policyVersion'],
  learnResponseSlots: ['learningVoidId', 'threadId', 'stage', 'revision', 'status', 'submissionId', 'confidenceRequested', 'evidenceStatus'],
  learnResponses: ['learningVoidId', 'threadId', 'assessmentOpportunityId', 'responseSlotId', 'acceptedAt', 'confidence', 'responseContractVersion', 'responseContextVersion', 'flow', 'baselineEpoch', 'measurementContext', 'disclosurePolicyVersion', 'bodyAvailability', 'bodyUnavailableReason', 'bodyPurgedAt', 'currentEligibility', 'evidenceStatus'],
  learnResponseBodies: [],
  learnResponseEvidenceLinks: ['submissionId', 'evidenceStatus', 'invalidatedAt'],
  learnResponseIntegrityEvents: ['submissionId', 'sequence', 'kind', 'effectiveAt', 'policyVersion'],
  learnResponseCommandReceipts: ['commandVersion', 'expiresAt'],
  learnScoringExecutions: ['submissionId', 'assessmentOpportunityId', 'outcome', 'committedAt', 'authoritativeAttemptId', 'evidenceStatus'],
  learnMeasurementReportFacts: ['learningVoidId', 'sequence', 'epoch', 'factVersion', 'occurredAt'],
  learnMeasurementSourceWatermarks: ['sequence', 'sourceVersion', 'historyCoverage', 'updatedAt'],
  learnMeasurementReportRuns: ['reportVersion', 'queryVersion', 'cutoff', 'status', 'sourceCoverage', 'extractionStartedAt', 'extractionEndedAt'],
  learnMeasurementReportRows: ['sequence', 'sourceVersion', 'rowKind', 'invalidatedAt'],
  learnMeasurementReportCells: ['reportVersion', 'sequence', 'metric', 'horizonDays', 'weighting', 'status'],
  learnMeasurementReportViewerGrants: [],
} as const satisfies Record<LearnMeasurementCollection, readonly string[]>

function projectResponseMetadata(row: Doc<'learnResponses'>) {
  const assistance = row.assistanceSnapshot
  return {
    assistance: {
      policyVersion: assistance.policyVersion, state: assistance.state,
      substantiveHintUsedAt: assistance.substantiveHintUsedAt, answerRevealedAt: assistance.answerRevealedAt,
      priorExposure: assistance.priorExposure, outsideHelp: assistance.outsideHelp,
      pasteObserved: assistance.pasteObserved, focusLossObserved: assistance.focusLossObserved,
      instrumentationVersion: assistance.instrumentationVersion, instrumentationProvenance: assistance.instrumentationProvenance,
    },
    validity: {
      policyVersion: row.validitySnapshot.policyVersion, status: row.validitySnapshot.status,
      measurementEligible: row.validitySnapshot.measurementEligible, masteryEligible: row.validitySnapshot.masteryEligible,
      exclusionReasons: row.validitySnapshot.exclusionReasons,
    },
  }
}

async function bodyIsAvailable(ctx: QueryCtx, userId: string, body: Doc<'learnResponseBodies'>) {
  const response = await ctx.db.get(body.submissionId)
  if (!response || response.userId !== userId || response.bodyAvailability !== 'available'
    || response.evidenceStatus !== 'available' || body.payloadDigest !== response.payloadDigest
    || body.payloadBytes > LEARN_MEASUREMENT_STORAGE_LIMITS.maxResponseBytes) return false
  if (response.scopeKind === 'v2') {
    if (!('learningVoidId' in body) || body.learningVoidId !== response.learningVoidId) return false
    const aggregate = await ctx.db.get(response.learningVoidId)
    if (!aggregate || aggregate.userId !== userId) return false
  }
  else {
    if (!('threadId' in body) || body.threadId !== response.threadId) return false
    const aggregate = await ctx.db.get(response.threadId)
    if (!aggregate || aggregate.userId !== userId || aggregate.deletionStartedAt !== undefined) return false
  }
  const links = await ctx.db.query('learnResponseEvidenceLinks')
    .withIndex('by_userId_and_submissionId', q => q.eq('userId', userId).eq('submissionId', response._id))
    .take(LEARN_MEASUREMENT_STORAGE_LIMITS.maxSourceDependencies + 1)
  if (links.length > LEARN_MEASUREMENT_STORAGE_LIMITS.maxSourceDependencies) return false
  for (const link of links) {
    if (link.evidenceStatus !== 'available' || link.invalidatedAt !== undefined) return false
    const dependency = link.dependency
    if (dependency.kind === 'snapshot') {
      const source = await ctx.db.get(dependency.sourceSnapshotId)
      if (!source || source.userId !== userId || (source.effectiveStatus ?? source.status) !== 'user_accepted'
        || source.evidencePurgedAt !== undefined || source.revision !== dependency.sourceSnapshotRevision
        || (source.recordRevision ?? 1) !== dependency.sourceRecordRevision) return false
    }
    else if (dependency.kind === 'document') {
      const source = await ctx.db.get(dependency.documentId)
      if (!source || source.userId !== userId || source.status !== 'success' || source.sourceRevision !== dependency.sourceRevision) return false
    }
    else {
      const source = await ctx.db.get(dependency.folderId)
      if (!source || source.userId !== userId) return false
    }
  }
  return true
}

function projectBody(payload: Doc<'learnResponseBodies'>['payload']) {
  switch (payload.kind) {
    case 'text': return { kind: payload.kind, text: payload.text }
    case 'keyed': return { kind: payload.kind, keys: payload.keys }
    case 'numeric': return { kind: payload.kind, value: payload.value, unit: payload.unit }
    case 'ordered': return { kind: payload.kind, entries: payload.entries }
    case 'source_comparison': return { kind: payload.kind, comparison: payload.comparison }
  }
}

export async function exportMeasurementPage(
  ctx: QueryCtx, userId: string, collection: LearnMeasurementCollection,
  paginationOpts: { cursor: string | null, numItems: number },
) {
  const result = await ctx.db.query(collection)
    .withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts)
  const page: ExportRow[] = []
  for (const row of result.page) {
    // Grant provisioning is operational access data, not a personal report.
    if (collection === 'learnMeasurementReportViewerGrants') continue
    const projected: ExportRow = { _id: row._id, _creationTime: row._creationTime, createdAt: row.createdAt }
    const record = row as unknown as Record<string, unknown>
    for (const field of metadataFields[collection]) if (record[field] !== undefined) projected[field] = record[field]
    if (collection === 'learnResponses') Object.assign(projected, projectResponseMetadata(row as Doc<'learnResponses'>))
    if (collection === 'learnResponseCommandReceipts') {
      const receipt = row as Doc<'learnResponseCommandReceipts'>
      if (receipt.result.kind === 'terminalized') projected.result = {
        kind: receipt.result.kind, target: receipt.result.target, revision: receipt.result.revision,
        reasonCode: receipt.result.reasonCode, terminalizedAt: receipt.result.terminalizedAt,
      }
    }
    if (collection === 'learnResponseBodies') {
      const body = row as Doc<'learnResponseBodies'>
      projected.submissionId = body.submissionId
      if (await bodyIsAvailable(ctx, userId, body)) {
        projected.bodyAvailability = 'available'
        projected.payload = projectBody(body.payload)
      }
      else {
        projected.bodyAvailability = 'unavailable'
        projected.bodyUnavailableReason = 'evidence_unavailable'
      }
    }
    page.push(projected)
  }
  return { ...result, page }
}
