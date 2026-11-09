export const LEARN_MEASUREMENT_STORAGE_VERSION = 'learn-v2.measurement-storage.v1' as const
export const LEARN_MEASUREMENT_STORAGE_LIMITS = {
  pageSize: 8, maxSourceDependencies: 64, rejectionRetentionDays: 90,
  maxResponseCodeUnits: 12_000, maxResponseBytes: 48 * 1024, maxEnvelopeBytes: 64 * 1024,
  maxDiagnosticBytes: 12_000, maxReportPageBytes: 256 * 1024,
  maxReportEnrollmentDays: 90, maxReportEpisodes: 10_000, maxReportInputBytes: 64 * 1024 * 1024,
  minFamilyMembers: 2, maxFamilyMembers: 6, maxClaims: 32, maxSupportsPerClaim: 8, maxRubricCriteria: 8,
} as const

// These are storage capabilities, not runtime switches or admission authority.
export const LEARN_MEASUREMENT_CAPABILITIES = {
  enrollment: false, delivery: false, responses: false, scoring: false, reports: false,
} as const

type Entry = {
  table: string
  parentField?: string
  parentIndex?: string
  retention: 'artifact_lineage' | 'owner_inventory' | 'assessment_bank' | 'response_history' | 'response_body' | 'response_receipt' | 'report_source' | 'report_snapshot' | 'viewer_grant'
  export: 'metadata_only' | 'owner_response' | 'withheld'
  voidDeletion: 'delete' | 'detach' | 'preserve'
  threadDeletion: 'delete_standalone' | 'detach' | 'preserve'
  indexes: readonly (readonly string[])[]
}

// Child-first order also defines bounded account deletion. Exposure and case
// identities survive aggregate deletion so deleting a Void cannot reset novelty.
export const LEARN_MEASUREMENT_STORAGE_MANIFEST = [
  { table: 'learnArtifactSourceLinks', parentField: 'lineageId', parentIndex: 'by_userId_and_lineageId', retention: 'artifact_lineage', export: 'metadata_only', voidDeletion: 'preserve', threadDeletion: 'preserve', indexes: [['userId', 'lineageId'], ['userId', 'dependency.sourceSnapshotId', 'invalidatedAt'], ['userId', 'dependency.sourceExcerptId', 'invalidatedAt'], ['userId', 'dependency.documentId', 'invalidatedAt'], ['userId', 'dependency.folderId', 'invalidatedAt']] },
  { table: 'learnArtifactCaseBindings', parentField: 'lineageId', parentIndex: 'by_userId_and_lineageId', retention: 'artifact_lineage', export: 'metadata_only', voidDeletion: 'preserve', threadDeletion: 'preserve', indexes: [['userId', 'lineageId'], ['userId', 'caseId']] },
  { table: 'learnArtifactLineageOrigins', parentField: 'lineageId', parentIndex: 'by_userId_and_lineageId', retention: 'artifact_lineage', export: 'metadata_only', voidDeletion: 'preserve', threadDeletion: 'preserve', indexes: [['userId', 'lineageId'], ['userId', 'originLineageId']] },
  { table: 'learnArtifactValidations', parentField: 'lineageId', parentIndex: 'by_userId_and_lineageId', retention: 'artifact_lineage', export: 'metadata_only', voidDeletion: 'preserve', threadDeletion: 'preserve', indexes: [['userId', 'lineageId']] },
  { table: 'learnArtifactLineages', retention: 'artifact_lineage', export: 'metadata_only', voidDeletion: 'preserve', threadDeletion: 'preserve', indexes: [['userId', 'artifact.kind', 'artifact.id', 'key', 'revision'], ['artifact.kind', 'artifact.id', 'key', 'revision', 'nextId'], ['artifact.kind', 'artifact.id', 'nextId']] },
  { table: 'learnMeasurementReportCells', parentField: 'reportRunId', parentIndex: 'by_userId_and_reportRunId_and_sequence', retention: 'report_snapshot', export: 'metadata_only', voidDeletion: 'preserve', threadDeletion: 'preserve', indexes: [['userId', 'reportRunId', 'sequence'], ['reportRunId', 'sequence'], ['userId', 'reportRunId', 'cellKey']] },
  { table: 'learnMeasurementReportRows', parentField: 'reportRunId', parentIndex: 'by_reportRunId_and_sequence', retention: 'report_snapshot', export: 'metadata_only', voidDeletion: 'delete', threadDeletion: 'preserve', indexes: [['reportRunId', 'sequence'], ['userId', 'reportRunId', 'sequence'], ['userId', 'learningVoidId'], ['userId', 'assignmentId', 'horizonDays'], ['userId', 'invalidatedAt']] },
  { table: 'learnMeasurementReportRuns', retention: 'report_snapshot', export: 'metadata_only', voidDeletion: 'preserve', threadDeletion: 'preserve', indexes: [['userId', 'status', 'createdAt'], ['userId', 'epoch', 'cutoff']] },
  { table: 'learnMeasurementReportViewerGrants', retention: 'viewer_grant', export: 'withheld', voidDeletion: 'preserve', threadDeletion: 'preserve', indexes: [['userId', 'cohortVersion', 'epoch'], ['expiresAt']] },
  { table: 'learnResponseBodies', parentField: 'submissionId', parentIndex: 'by_userId_and_submissionId', retention: 'response_body', export: 'owner_response', voidDeletion: 'delete', threadDeletion: 'delete_standalone', indexes: [['userId', 'submissionId'], ['userId', 'learningVoidId'], ['userId', 'threadId']] },
  { table: 'learnResponseEvidenceLinks', parentField: 'submissionId', parentIndex: 'by_userId_and_submissionId', retention: 'response_history', export: 'metadata_only', voidDeletion: 'delete', threadDeletion: 'delete_standalone', indexes: [['userId', 'submissionId'], ['userId', 'learningVoidId'], ['userId', 'threadId'], ['userId', 'dependency.sourceSnapshotId', 'invalidatedAt'], ['userId', 'dependency.documentId', 'invalidatedAt'], ['userId', 'dependency.folderId', 'invalidatedAt']] },
  { table: 'learnResponseIntegrityEvents', parentField: 'submissionId', parentIndex: 'by_userId_and_submissionId_and_sequence', retention: 'response_history', export: 'metadata_only', voidDeletion: 'delete', threadDeletion: 'delete_standalone', indexes: [['userId', 'submissionId', 'sequence'], ['userId', 'learningVoidId'], ['userId', 'threadId']] },
  { table: 'learnResponseCommandReceipts', retention: 'response_receipt', export: 'metadata_only', voidDeletion: 'delete', threadDeletion: 'delete_standalone', indexes: [['userId', 'idempotencyKeyHash'], ['userId', 'learningVoidId'], ['userId', 'threadId'], ['expiresAt']] },
  { table: 'learnScoringExecutions', parentField: 'submissionId', parentIndex: 'by_userId_and_submissionId', retention: 'assessment_bank', export: 'metadata_only', voidDeletion: 'delete', threadDeletion: 'preserve', indexes: [['userId', 'submissionId'], ['userId', 'assessmentOpportunityId'], ['userId', 'jobId', 'dispatchOrdinal'], ['userId', 'learningVoidId']] },
  { table: 'learnResponses', retention: 'response_history', export: 'metadata_only', voidDeletion: 'delete', threadDeletion: 'delete_standalone', indexes: [['userId', 'assessmentOpportunityId'], ['userId', 'responseSlotId'], ['userId', 'learningVoidId'], ['userId', 'contextPins.studySessionId'], ['userId', 'threadId']] },
  { table: 'learnResponseSlots', retention: 'response_history', export: 'metadata_only', voidDeletion: 'delete', threadDeletion: 'delete_standalone', indexes: [['userId', 'activityId'], ['userId', 'contextPins.canvas.activityId'], ['userId', 'learningVoidId'], ['userId', 'contextPins.studySessionId'], ['userId', 'threadId'], ['userId', 'slotKey']] },
  { table: 'learnAssessmentOpportunities', parentField: 'assignmentId', parentIndex: 'by_userId_and_assignmentId_and_horizonDays', retention: 'response_history', export: 'metadata_only', voidDeletion: 'delete', threadDeletion: 'preserve', indexes: [['userId', 'phase'], ['userId', 'contextPins.canvas.activityId'], ['userId', 'learningVoidId'], ['userId', 'contextPins.studySessionId'], ['userId', 'assignmentId', 'horizonDays'], ['userId', 'delayedCheckId'], ['userId', 'submissionId'], ['phase', 'dueAt'], ['userId', 'firstCheckClaim.claimKey', 'checkSequence']] },
  { table: 'learnMeasurementAssignments', retention: 'response_history', export: 'metadata_only', voidDeletion: 'delete', threadDeletion: 'preserve', indexes: [['userId', 'assignmentKey'], ['userId', 'learningVoidId'], ['userId', 'epoch', 'createdAt'], ['userId', 'blueprintRevisionId', 'objectiveId']] },
  { table: 'learnMeasurementSupports', parentField: 'claimId', parentIndex: 'by_userId_and_claimId', retention: 'assessment_bank', export: 'metadata_only', voidDeletion: 'delete', threadDeletion: 'preserve', indexes: [['userId', 'claimId'], ['userId', 'itemId'], ['userId', 'sourceSnapshotId', 'invalidatedAt'], ['userId', 'sourceExcerptId', 'invalidatedAt'], ['userId', 'learningVoidId']] },
  { table: 'learnMeasurementClaims', parentField: 'itemId', parentIndex: 'by_userId_and_itemId_and_order', retention: 'assessment_bank', export: 'metadata_only', voidDeletion: 'delete', threadDeletion: 'preserve', indexes: [['userId', 'itemId', 'order'], ['userId', 'scoringSpecId'], ['userId', 'learningVoidId']] },
  { table: 'learnMeasurementScoringSpecs', parentField: 'itemId', parentIndex: 'by_userId_and_itemId_and_revision', retention: 'assessment_bank', export: 'metadata_only', voidDeletion: 'delete', threadDeletion: 'preserve', indexes: [['userId', 'itemId', 'revision'], ['userId', 'learningVoidId']] },
  { table: 'learnMeasurementItems', parentField: 'familyId', parentIndex: 'by_userId_and_familyId_and_familyRevision_and_formLabel', retention: 'assessment_bank', export: 'metadata_only', voidDeletion: 'delete', threadDeletion: 'preserve', indexes: [['userId', 'familyId', 'familyRevision', 'formLabel'], ['userId', 'itemKey', 'revision'], ['userId', 'caseId'], ['userId', 'learningVoidId']] },
  { table: 'learnMeasurementFamilies', retention: 'assessment_bank', export: 'metadata_only', voidDeletion: 'delete', threadDeletion: 'preserve', indexes: [['userId', 'familyKey', 'revision'], ['userId', 'learningVoidId'], ['userId', 'blueprintRevisionId', 'objectiveId']] },
  { table: 'learnMeasurementValidations', retention: 'assessment_bank', export: 'metadata_only', voidDeletion: 'delete', threadDeletion: 'preserve', indexes: [['userId', 'subject.caseId'], ['userId', 'subject.itemId'], ['userId', 'subject.familyId'], ['userId', 'subject.scoringSpecId'], ['userId', 'learningVoidId']] },
  { table: 'learnMeasurementReportFacts', retention: 'report_source', export: 'metadata_only', voidDeletion: 'delete', threadDeletion: 'preserve', indexes: [['userId', 'sequence'], ['userId', 'epoch', 'sequence'], ['userId', 'learningVoidId'], ['userId', 'fact.assignmentId'], ['userId', 'fact.assessmentOpportunityId'], ['userId', 'fact.submissionId'], ['userId', 'fact.claimKey', 'fact.claimSequence']] },
  { table: 'learnMeasurementSourceWatermarks', retention: 'owner_inventory', export: 'metadata_only', voidDeletion: 'preserve', threadDeletion: 'preserve', indexes: [['userId', 'sequence']] },
  { table: 'learnAssessmentExposures', retention: 'owner_inventory', export: 'metadata_only', voidDeletion: 'detach', threadDeletion: 'detach', indexes: [['userId', 'caseId', 'serverTime'], ['userId', 'assessmentOpportunityId'], ['userId', 'deliveryReceiptHash'], ['userId', 'learningVoidId'], ['userId', 'threadId']] },
  { table: 'learnAssessmentCases', retention: 'owner_inventory', export: 'metadata_only', voidDeletion: 'preserve', threadDeletion: 'preserve', indexes: [['userId', 'caseKey'], ['userId', 'scenarioFingerprint'], ['userId', 'solutionFingerprint'], ['userId', 'usageClass'], ['userId', 'reservedAt'], ['userId', 'scenarioFingerprint', 'solutionFingerprint']] },
  { table: 'learnAssessmentCatalogs', retention: 'owner_inventory', export: 'metadata_only', voidDeletion: 'preserve', threadDeletion: 'preserve', indexes: [] },
] as const satisfies readonly Entry[]

export type LearnMeasurementCollection = typeof LEARN_MEASUREMENT_STORAGE_MANIFEST[number]['table']
export const LEARN_MEASUREMENT_COLLECTIONS = LEARN_MEASUREMENT_STORAGE_MANIFEST.map(entry => entry.table)
export function isLearnMeasurementCollection(value: string): value is LearnMeasurementCollection {
  return LEARN_MEASUREMENT_COLLECTIONS.some(table => table === value)
}

export const LEARN_MEASUREMENT_SOURCE_REGISTRATIONS = [
  { table: 'learnArtifactSourceLinks', field: 'dependency.sourceSnapshotId', index: 'by_userId_and_dependency_sourceSnapshotId_and_invalidatedAt' },
  { table: 'learnArtifactSourceLinks', field: 'dependency.sourceExcerptId', index: 'by_userId_and_dependency_sourceExcerptId_and_invalidatedAt' },
  { table: 'learnArtifactSourceLinks', field: 'dependency.documentId', index: 'by_userId_and_dependency_documentId_and_invalidatedAt' },
  { table: 'learnArtifactSourceLinks', field: 'dependency.folderId', index: 'by_userId_and_dependency_folderId_and_invalidatedAt' },
  { table: 'learnMeasurementSupports', field: 'sourceSnapshotId', index: 'by_userId_and_sourceSnapshotId_and_invalidatedAt' },
  { table: 'learnMeasurementSupports', field: 'sourceExcerptId', index: 'by_userId_and_sourceExcerptId_and_invalidatedAt' },
  { table: 'learnResponseEvidenceLinks', field: 'dependency.sourceSnapshotId', index: 'by_userId_and_dependency_sourceSnapshotId_and_invalidatedAt' },
  { table: 'learnResponseEvidenceLinks', field: 'dependency.documentId', index: 'by_userId_and_dependency_documentId_and_invalidatedAt' },
  { table: 'learnResponseEvidenceLinks', field: 'dependency.folderId', index: 'by_userId_and_dependency_folderId_and_invalidatedAt' },
] as const


export const LEARN_ARTIFACT_INTERJECTION_REGISTRATIONS = [
  { kind: 'audio_interjection', table: 'audioOverviewInterjections', parentField: 'audioOverviewId', sourceRecordField: 'taskId', key: 'whole', questionAuthority: 'owner', answerClassification: 'teaching' },
  { kind: 'audio_interjection_v2', table: 'audioOverviewInterjectionsV2', parentField: 'audioOverviewId', sourceRecordField: 'sourceManifestId', key: 'whole', questionAuthority: 'owner', answerClassification: 'teaching' },
] as const
