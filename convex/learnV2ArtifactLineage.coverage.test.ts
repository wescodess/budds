import { describe, expect, test } from 'vitest'
import schema from './schema'

// Every producer field must be deliberately classified. A newly added field
// fails this guard until its content or exclusion policy is recorded here.
// Projected includes identity, joins, membership and ordering, not just text.
const coverage = {
  sessionContentBlocks: {
    projected: ['_id', 'userId', 'sessionContentId', 'order', 'kind', 'content', 'claimOrdersJson'],
    excluded: {
      _creationTime: 'Database timestamp is not content; actual returned index ordering is pinned.',
    },
  },
  sessionContent: {
    projected: ['_id', 'userId', 'studySessionId', 'studyPlanRevisionId', 'blueprintRevisionId', 'objectiveId', 'revision', 'inputDigest', 'candidateDigest', 'assessmentRubricSnapshot', 'generatorVersion', 'assessmentOpportunityId', 'assessmentPurpose'],
    excluded: {
      _creationTime: 'Database timestamp is not content; actual returned index ordering is pinned.',
      status: 'Lifecycle admission is checked separately; it is not teaching content.',
      providerModel: 'Provider diagnostics are not teaching content.',
      providerRequestId: 'Provider diagnostics are not teaching content.',
      createdAt: 'Creation time is operational; returned content ordering is pinned separately.',
      publishedAt: 'Publication time is operational, not content.',
    },
  },
  sessionContentClaims: {
    projected: ['_id', 'userId', 'sessionContentId', 'order', 'claim', 'verifierVersion', 'confidence'],
    excluded: {
      _creationTime: 'Database timestamp is not content; actual returned index ordering is pinned.',
    },
  },
  learnClaimSupports: {
    projected: ['_id', 'userId', 'sessionContentClaimId', 'sourceSnapshotId', 'entailment', 'verifierVersion', 'confidence', 'conflictStatus'],
    excluded: {
      _creationTime: 'Database timestamp is not content; actual returned index ordering is pinned.',
      sourceExcerptId: 'The consumer returns snapshot identity, not excerpt identity; source access is checked by the manifest.',
      evidenceStatus: 'Current evidence availability is checked separately from the immutable pin.',
    },
  },
  documents: {
    projected: ['_id', 'userId', 'fileId', 'fileSize', 'r2Key', 'sourceType', 'sourceUrl', 'mimeType', 'contentHash', 'sourceRevision'],
    excluded: {
      _creationTime: 'Database timestamp is not content; actual returned index ordering is pinned.',
      folderId: 'Access is checked by liveFolder; a document move preserves content and history.',
      filename: 'Organizational filename; backing revision, hash and object identify content.',
      status: 'Lifecycle admission is checked separately; it is not teaching content.',
      failureReason: 'Failure diagnostics are separate from current lifecycle admission.',
      indexJobId: 'Index attempt identity does not change backing content.',
      taskId: 'Workflow parent; current artifact/source access is checked separately.',
    },
  },
  quizQuestions: {
    projected: ['_id', 'quizId', 'userId', 'order', 'question', 'type', 'options', 'correctAnswer', 'gradingCriteria', 'explanation', 'sourceDocumentId', 'sourceChunkContent', 'correctedAnswer', 'correctedExplanation'],
    excluded: {
      _creationTime: 'Database timestamp is not content; actual returned index ordering is pinned.',
      sourceFilename: 'Display filename; the source document identity and chunk content are pinned.',
      flagged: 'Moderation marker; any corrected content is pinned separately.',
      flaggedAt: 'Moderation timestamp, not content.',
    },
  },
  courseSections: {
    projected: ['_id', 'courseId', 'userId', 'order', 'title', 'knowledgeType', 'contentBlocks'],
    excluded: {
      _creationTime: 'Database timestamp is not content; actual returned index ordering is pinned.',
      status: 'Lifecycle admission is checked separately; it is not teaching content.',
      failureNotice: 'Failure diagnostics are separate from current lifecycle admission.',
      practiceScore: 'Learner progress does not change teaching content.',
      masteryLevel: 'Learner progress does not change teaching content.',
      consecutiveReviewPasses: 'Learner progress does not change teaching content.',
      reviewHistory: 'Learner progress does not change teaching content.',
      completedAt: 'Completion time is operational, not content.',
      offlineAvailable: 'Cache availability does not change teaching content.',
      taskId: 'Workflow parent; current artifact/source access is checked separately.',
    },
  },
  flashcardRoomVersions: {
    projected: ['_id', 'roomId', 'userId', 'prompt'],
    excluded: {
      _creationTime: 'Database timestamp is not content; actual returned index ordering is pinned.',
      title: 'Room/version label is organizational; the version prompt and retained cards are pinned.',
      origin: 'Editor/generator metadata, not original disclosure lineage.',
      requestedCardCount: 'Requested count is operational; actual card membership is pinned.',
      cardCount: 'Denormalized counter; actual card membership is pinned.',
      model: 'Generation diagnostics are not teaching content.',
      createdAt: 'Creation time is operational; returned content ordering is pinned separately.',
    },
  },
  flashcardVersionCards: {
    projected: ['_id', 'versionId', 'roomId', 'userId', 'displayOrder', 'term', 'definition', 'metadata', 'sourceDocumentId', 'sourceChunkContent'],
    excluded: {
      _creationTime: 'Database timestamp is not content; actual returned index ordering is pinned.',
      sourceFilename: 'Display filename; the source document identity and chunk content are pinned.',
      updatedAt: 'Update time does not change teaching content.',
    },
  },
  flashcardRoomCards: {
    projected: ['_id', 'roomId', 'userId', 'displayOrder', 'term', 'definition', 'metadata', 'sourceDocumentId', 'sourceChunkContent', 'correctedDefinition'],
    excluded: {
      _creationTime: 'Database timestamp is not content; actual returned index ordering is pinned.',
      sourceFilename: 'Display filename; the source document identity and chunk content are pinned.',
      updatedAt: 'Update time does not change teaching content.',
      flagged: 'Moderation marker; any corrected content is pinned separately.',
      flaggedAt: 'Moderation timestamp, not content.',
    },
  },
  audioOverviews: {
    projected: ['_id', 'userId', 'folderId', 'roomId', 'episodeId', 'finalArtifactId', 'title', 'turns', 'voiceProfile', 'hostNames', 'preferences', 'totalDurationMs', 'sourceDocumentIds', 'scopeDocIds', 'courseScoped'],
    excluded: {
      _creationTime: 'Database timestamp is not content; actual returned index ordering is pinned.',
      taskId: 'Workflow parent; current artifact/source access is checked separately.',
      status: 'Lifecycle admission is checked separately; it is not teaching content.',
      failureReason: 'Failure diagnostics are separate from current lifecycle admission.',
      model: 'Generation diagnostics are not teaching content.',
      shareToken: 'Sharing state does not change teaching content.',
      publishedAt: 'Publication time is operational, not content.',
    },
  },
  learningThreadArtifacts: {
    projected: ['_id', 'userId', 'threadId', 'activityId', 'artifactKind', 'revision', 'title', 'summary', 'r2ObjectKey'],
    excluded: {
      _creationTime: 'Database timestamp is not content; actual returned index ordering is pinned.',
      status: 'Lifecycle admission is checked separately; it is not teaching content.',
      createdAt: 'Creation time is operational; returned content ordering is pinned separately.',
      updatedAt: 'Update time does not change teaching content.',
    },
  },
  learnMeasurementItems: {
    projected: ['_id', 'userId', 'learningVoidId', 'blueprintRevisionId', 'objectiveId', 'blueprintRecordRevision', 'assessmentContractVersion', 'assessmentContractDigest', 'depth', 'familyId', 'familyRevision', 'itemKey', 'revision', 'caseId', 'formLabel', 'reserve', 'prompt', 'declaredStimulus', 'promptDigest', 'responseSpec', 'scoringSpecId', 'scoringSpecRevision', 'scoringSpecDigest', 'generatorVersion', 'generationJobId', 'inputDigest', 'supportManifestDigest', 'publicationValidationId'],
    excluded: {
      _creationTime: 'Database timestamp is not content; actual returned index ordering is pinned.',
      storageVersion: 'Storage format marker, not teaching content.',
      createdAt: 'Creation time is operational; returned content ordering is pinned separately.',
      evidenceStatus: 'Current evidence availability is checked separately from the immutable pin.',
      invalidatedAt: 'Revocation marker is checked separately from the immutable pin.',
      catalogRevision: 'Publication guard snapshot; current catalogue admission is checked separately.',
      status: 'Lifecycle admission is checked separately; it is not teaching content.',
    },
  },
  learnMeasurementFamilies: {
    projected: ['_id', 'userId', 'learningVoidId', 'blueprintRevisionId', 'objectiveId', 'blueprintRecordRevision', 'assessmentContractVersion', 'assessmentContractDigest', 'depth', 'familyKey', 'revision', 'recordRevision', 'equivalenceVersion', 'equivalenceDescriptor', 'coreFormCount', 'totalFormCount', 'validationId', 'validationArtifactDigest'],
    excluded: {
      _creationTime: 'Database timestamp is not content; actual returned index ordering is pinned.',
      storageVersion: 'Storage format marker, not teaching content.',
      createdAt: 'Creation time is operational; returned content ordering is pinned separately.',
      evidenceStatus: 'Current evidence availability is checked separately from the immutable pin.',
      invalidatedAt: 'Revocation marker is checked separately from the immutable pin.',
      status: 'Lifecycle admission is checked separately; it is not teaching content.',
      reasonCode: 'Lifecycle diagnostics are separate from immutable content.',
    },
  },
  learnMeasurementScoringSpecs: {
    projected: ['_id', 'userId', 'learningVoidId', 'blueprintRevisionId', 'objectiveId', 'blueprintRecordRevision', 'assessmentContractVersion', 'assessmentContractDigest', 'depth', 'itemId', 'revision', 'digest', 'payload', 'referenceSolution', 'derivation', 'scoringBinding'],
    excluded: {
      _creationTime: 'Database timestamp is not content; actual returned index ordering is pinned.',
      storageVersion: 'Storage format marker, not teaching content.',
      createdAt: 'Creation time is operational; returned content ordering is pinned separately.',
      evidenceStatus: 'Current evidence availability is checked separately from the immutable pin.',
      invalidatedAt: 'Revocation marker is checked separately from the immutable pin.',
    },
  },
  audioOverviewEpisodes: {
    projected: ['_id', 'title', 'hostAVoice', 'hostBVoice', 'hostAName', 'hostBName', 'requestedLengthMinutes', 'complexity', 'sourceManifestId', 'outlineId', 'claimLedgerId', 'finalArtifactId', 'alignmentId'],
    excluded: {
      _creationTime: 'Database timestamp is not content; actual returned index ordering is pinned.',
      jobId: 'Workflow parent, absent from the teaching projection.',
      taskId: 'Workflow parent; current artifact/source access is checked separately.',
      userId: 'Ownership is checked separately; only resolved teaching fields are projected.',
      folderId: 'Access is checked by liveFolder; a document move preserves content and history.',
      roomId: 'Audio scope is checked separately; V2 playback identity is the episode.',
      schemaVersion: 'The V2 playback projection emits the canonical schema version 2.',
      model: 'Generation diagnostics are not teaching content.',
      audioProfileId: 'Renderer diagnostics; the actual returned voices are pinned.',
      audioProfileVersion: 'Renderer diagnostics; the actual returned voices are pinned.',
      renderer: 'Renderer diagnostics; the final media identity and checksum are pinned.',
      status: 'Lifecycle admission is checked separately; it is not teaching content.',
      sceneCount: 'Denormalized count; actual ordered scenes are pinned.',
      utteranceCount: 'Denormalized count; actual ordered utterances are pinned.',
      totalDurationMs: 'Playback returns the final media duration, which is pinned.',
      compatibilityOverviewId: 'The authoritative cross-pointer is checked by readAudioMedia.',
      failureReason: 'Failure diagnostics are separate from current lifecycle admission.',
      createdAt: 'Creation time is operational; returned content ordering is pinned separately.',
      updatedAt: 'Update time does not change teaching content.',
      publishedAt: 'Publication time is operational, not content.',
    },
  },
  audioOverviewAudioArtifacts: {
    projected: ['_id', 'storageProvider', 'objectKey', 'checksumSha256', 'byteLength', 'contentType', 'container', 'sampleRateHz', 'channelCount', 'bitsPerSample', 'durationMs'],
    excluded: {
      _creationTime: 'Database timestamp is not content; actual returned index ordering is pinned.',
      episodeId: 'Parent query scope; resolved playback membership is pinned.',
      sceneId: 'Scene association is not exposed by the word-timing projection.',
      interjectionId: 'This projection is for final episode media, never an interjection.',
      jobId: 'Workflow parent, absent from the teaching projection.',
      userId: 'Ownership is checked separately; only resolved teaching fields are projected.',
      kind: 'Final-media kind is enforced by readAudioMedia, separately from content.',
      status: 'Lifecycle admission is checked separately; it is not teaching content.',
      etag: 'Provider cache metadata; content checksum and object identity are pinned.',
      rendererRequestId: 'Renderer diagnostics, not teaching content.',
      createdAt: 'Creation time is operational; returned content ordering is pinned separately.',
      publishedAt: 'Publication time is operational, not content.',
    },
  },
  audioOverviewSourceManifests: {
    projected: ['revision', 'contentHash'],
    excluded: {
      _id: 'Internal join identity is not emitted for this row; resolved membership and teaching content are pinned.',
      _creationTime: 'Database timestamp is not content; actual returned index ordering is pinned.',
      jobId: 'Workflow parent, absent from the teaching projection.',
      taskId: 'Workflow parent; current artifact/source access is checked separately.',
      userId: 'Ownership is checked separately; only resolved teaching fields are projected.',
      folderId: 'Access is checked by liveFolder; a document move preserves content and history.',
      schemaVersion: 'The V2 playback projection emits the canonical schema version 2.',
      planFingerprint: 'Generation idempotency pin; resolved source manifest revision and hash are pinned.',
      entryCount: 'Denormalized count; actual ordered source entries are pinned.',
      frozenAt: 'Freeze time is operational; the immutable source revision and hash are pinned.',
    },
  },
  audioOverviewSourceManifestEntries: {
    projected: ['_id', 'order', 'sourceId', 'documentId', 'revision', 'contentHash', 'displayReference'],
    excluded: {
      _creationTime: 'Database timestamp is not content; actual returned index ordering is pinned.',
      manifestId: 'Parent query scope; ordered manifest membership is pinned.',
      jobId: 'Workflow parent, absent from the teaching projection.',
      userId: 'Ownership is checked separately; only resolved teaching fields are projected.',
      objectKey: 'Private source locator, absent from the playback teaching projection.',
      createdAt: 'Creation time is operational; returned content ordering is pinned separately.',
    },
  },
  audioOverviewOutlines: {
    projected: ['narrativeArc'],
    excluded: {
      _id: 'Internal join identity is not emitted for this row; resolved membership and teaching content are pinned.',
      _creationTime: 'Database timestamp is not content; actual returned index ordering is pinned.',
      jobId: 'Workflow parent, absent from the teaching projection.',
      taskId: 'Workflow parent; current artifact/source access is checked separately.',
      userId: 'Ownership is checked separately; only resolved teaching fields are projected.',
      learningObjectiveCount: 'Denormalized count; actual ordered objectives are pinned.',
      createdAt: 'Creation time is operational; returned content ordering is pinned separately.',
    },
  },
  audioOverviewLearningObjectives: {
    projected: ['order', 'text'],
    excluded: {
      _id: 'Internal join identity is not emitted for this row; resolved membership and teaching content are pinned.',
      _creationTime: 'Database timestamp is not content; actual returned index ordering is pinned.',
      outlineId: 'Parent query scope; ordered objectives and resolved sources are pinned.',
      jobId: 'Workflow parent, absent from the teaching projection.',
      userId: 'Ownership is checked separately; only resolved teaching fields are projected.',
      createdAt: 'Creation time is operational; returned content ordering is pinned separately.',
    },
  },
  audioOverviewOutlineSources: {
    projected: ['manifestEntryId', 'order'],
    excluded: {
      _id: 'Internal join identity is not emitted for this row; resolved membership and teaching content are pinned.',
      _creationTime: 'Database timestamp is not content; actual returned index ordering is pinned.',
      outlineId: 'Parent query scope; ordered objectives and resolved sources are pinned.',
      jobId: 'Workflow parent, absent from the teaching projection.',
      userId: 'Ownership is checked separately; only resolved teaching fields are projected.',
      createdAt: 'Creation time is operational; returned content ordering is pinned separately.',
    },
  },
  audioOverviewClaims: {
    projected: ['_id', 'claimId', 'text', 'status'],
    excluded: {
      _creationTime: 'Database timestamp is not content; actual returned index ordering is pinned.',
      ledgerId: 'Parent query scope; claim identity, body and resolved source joins are pinned.',
      jobId: 'Workflow parent, absent from the teaching projection.',
      userId: 'Ownership is checked separately; only resolved teaching fields are projected.',
      order: 'Index order is operational where the consumer resolves links by identity.',
      verificationVersion: 'Verification diagnostics, not the returned supported content.',
      verificationModel: 'Verification diagnostics, not the returned supported content.',
      entailmentDecision: 'Verification diagnostics; returned supported-claim membership is pinned.',
      entailmentReason: 'Verification diagnostics, not the returned supported content.',
      createdAt: 'Creation time is operational; returned content ordering is pinned separately.',
    },
  },
  audioOverviewClaimLedgers: {
    projected: [],
    excluded: {
      _id: 'Internal join identity is not emitted for this row; resolved membership and teaching content are pinned.',
      _creationTime: 'Database timestamp is not content; actual returned index ordering is pinned.',
      jobId: 'Workflow parent, absent from the teaching projection.',
      taskId: 'Workflow parent; current artifact/source access is checked separately.',
      userId: 'Ownership is checked separately; only resolved teaching fields are projected.',
      claimCount: 'Denormalized count; actual supported claims are pinned.',
      supportedClaimCount: 'Denormalized count; actual supported claims are pinned.',
      createdAt: 'Creation time is operational; returned content ordering is pinned separately.',
    },
  },
  audioOverviewClaimSources: {
    projected: ['claimRecordId', 'manifestEntryId'],
    excluded: {
      _id: 'Internal join identity is not emitted for this row; resolved membership and teaching content are pinned.',
      _creationTime: 'Database timestamp is not content; actual returned index ordering is pinned.',
      ledgerId: 'Parent query scope; resolved supported-claim/source joins are pinned.',
      jobId: 'Workflow parent, absent from the teaching projection.',
      userId: 'Ownership is checked separately; only resolved teaching fields are projected.',
      createdAt: 'Creation time is operational; returned content ordering is pinned separately.',
    },
  },
  audioOverviewScenes: {
    projected: ['_id', 'order', 'title', 'narrativePurpose', 'targetDurationMs', 'durationMs'],
    excluded: {
      _creationTime: 'Database timestamp is not content; actual returned index ordering is pinned.',
      episodeId: 'Parent query scope; resolved playback membership is pinned.',
      jobId: 'Workflow parent, absent from the teaching projection.',
      userId: 'Ownership is checked separately; only resolved teaching fields are projected.',
      status: 'Lifecycle admission is checked separately; it is not teaching content.',
      currentAttempt: 'Render retry state; returned scene content is pinned.',
      audioArtifactId: 'Scene rendering pointer; standalone playback uses the pinned final media.',
      updatedAt: 'Update time does not change teaching content.',
    },
  },
  audioOverviewUtterances: {
    projected: ['_id', 'sceneId', 'order', 'sceneOrder', 'speaker', 'text', 'emotionalIntent', 'deliveryIntent', 'pauseAfterMs'],
    excluded: {
      _creationTime: 'Database timestamp is not content; actual returned index ordering is pinned.',
      episodeId: 'Parent query scope; resolved playback membership is pinned.',
      jobId: 'Workflow parent, absent from the teaching projection.',
      userId: 'Ownership is checked separately; only resolved teaching fields are projected.',
      verificationUtteranceId: 'Verification identity, absent from playback; utterance content and joins are pinned.',
      verificationVersion: 'Verification diagnostics, not the returned supported content.',
      verificationModel: 'Verification diagnostics, not the returned supported content.',
      entailmentDecision: 'Verification diagnostics; returned supported-claim membership is pinned.',
      entailmentReason: 'Verification diagnostics, not the returned supported content.',
      createdAt: 'Creation time is operational; returned content ordering is pinned separately.',
    },
  },
  audioOverviewUtteranceSources: {
    projected: ['utteranceId', 'manifestEntryId'],
    excluded: {
      _id: 'Internal join identity is not emitted for this row; resolved membership and teaching content are pinned.',
      _creationTime: 'Database timestamp is not content; actual returned index ordering is pinned.',
      episodeId: 'Parent query scope; resolved playback membership is pinned.',
      jobId: 'Workflow parent, absent from the teaching projection.',
      userId: 'Ownership is checked separately; only resolved teaching fields are projected.',
      createdAt: 'Creation time is operational; returned content ordering is pinned separately.',
    },
  },
  audioOverviewUtteranceClaims: {
    projected: ['utteranceId', 'claimRecordId'],
    excluded: {
      _id: 'Internal join identity is not emitted for this row; resolved membership and teaching content are pinned.',
      _creationTime: 'Database timestamp is not content; actual returned index ordering is pinned.',
      episodeId: 'Parent query scope; resolved playback membership is pinned.',
      jobId: 'Workflow parent, absent from the teaching projection.',
      userId: 'Ownership is checked separately; only resolved teaching fields are projected.',
      createdAt: 'Creation time is operational; returned content ordering is pinned separately.',
    },
  },
  audioOverviewAlignments: {
    projected: ['status'],
    excluded: {
      _id: 'Internal join identity is not emitted for this row; resolved membership and teaching content are pinned.',
      _creationTime: 'Database timestamp is not content; actual returned index ordering is pinned.',
      episodeId: 'Parent query scope; resolved playback membership is pinned.',
      artifactId: 'Current alignment/media association is checked by readAudioPlayback.',
      jobId: 'Workflow parent, absent from the teaching projection.',
      userId: 'Ownership is checked separately; only resolved teaching fields are projected.',
      aligner: 'Alignment diagnostics, not returned word content or timing.',
      alignerVersion: 'Alignment diagnostics, not returned word content or timing.',
      segmentCount: 'Progress count; actual completed word timings are pinned.',
      error: 'Alignment failure diagnostics, not teaching content.',
      createdAt: 'Creation time is operational; returned content ordering is pinned separately.',
      updatedAt: 'Update time does not change teaching content.',
      completedAt: 'Completion time is operational, not content.',
    },
  },
  audioOverviewAlignmentSegments: {
    projected: ['utteranceId', 'wordIndex', 'word', 'startMs', 'endMs'],
    excluded: {
      _id: 'Internal join identity is not emitted for this row; resolved membership and teaching content are pinned.',
      _creationTime: 'Database timestamp is not content; actual returned index ordering is pinned.',
      alignmentId: 'Parent query scope; completed timings are pinned by utterance.',
      episodeId: 'Parent query scope; resolved playback membership is pinned.',
      sceneId: 'Scene association is not exposed by the word-timing projection.',
      jobId: 'Workflow parent, absent from the teaching projection.',
      userId: 'Ownership is checked separately; only resolved teaching fields are projected.',
      confidence: 'Alignment diagnostics are not returned word content or timing.',
      createdAt: 'Creation time is operational; returned content ordering is pinned separately.',
    },
  },
} as const

function fieldNames(validator: object): string[] {
  if ('fields' in validator) return Object.keys(validator.fields as object)
  if ('members' in validator) return [...new Set((validator.members as object[]).flatMap(fieldNames))]
  throw new Error('Producer schema must have an explicit object/union field classification')
}

describe.each(Object.keys(coverage) as Array<keyof typeof coverage>)('B1 projection schema coverage: %s', table => {
  test('classifies every schema field exactly once, with a reason for every exclusion', () => {
    const classification = coverage[table]
    const names = [...classification.projected, ...Object.keys(classification.excluded)]
    expect(names.length).toBe(new Set(names).size)
    expect(names.sort()).toEqual([...fieldNames(schema.tables[table].validator), '_id', '_creationTime'].sort())
    for (const reason of Object.values(classification.excluded)) expect(reason.trim().length).toBeGreaterThan(15)
  })
})

// metadata is only partially projected. Classify its children too, so a new
// nested source field cannot silently escape the pin through the parent label.
describe.each(['flashcardVersionCards', 'flashcardRoomCards'] as const)('B1 partial metadata coverage: %s', table => {
  test('classifies the source projection and its explicit diagnostic/label exclusions', () => {
    const metadata = schema.tables[table].validator.fields.metadata
    expect(fieldNames(metadata).sort()).toEqual(['model', 'origin', 'source'])
    expect(fieldNames(metadata.fields.source).sort()).toEqual(['chunkContent', 'documentId', 'filename'])
    const excluded = { model: 'Generation diagnostics are not teaching content.', origin: 'Editor metadata is not original disclosure lineage.', filename: 'Organizational source label; source identity and chunk content are projected.' }
    for (const reason of Object.values(excluded)) expect(reason.length).toBeGreaterThan(15)
  })
})
