import { deriveMastery } from './learn-v2-mastery'

export type ContractIndex = {
  name: string
  fields: string[]
}

export type RetentionClassName =
  | 'stable_aggregate'
  | 'immutable_revision'
  | 'ordered_child'
  | 'evidence_identity'
  | 'protected_evidence'
  | 'attempt_ledger'
  | 'derived_projection'
  | 'operational_job'
  | 'provider_projection'
  | 'quota_ledger'

export type ContractTable = {
  name: string
  purpose: string
  ownerField: 'userId'
  parentField?: string
  queryMode: 'bounded'
  retentionClass: RetentionClassName
  indexes: ContractIndex[]
}

export type LearningVoidState = 'draft' | 'sourcing' | 'source_review' | 'map_review' | 'calibration' | 'plan_review' | 'scheduled' | 'active' | 'completed' | 'paused' | 'needs_attention' | 'failed' | 'archived'
export type BlueprintRevisionState = 'draft' | 'source_review' | 'map_review' | 'accepted' | 'active' | 'superseded'
export type SourceState = 'candidate' | 'fetched' | 'evaluated' | 'user_accepted' | 'rejected' | 'unavailable'
export type StudySessionState = 'planned' | 'ready' | 'in_progress' | 'completed' | 'missed' | 'cancelled' | 'blocked' | 'generation_failed' | 'needs_reschedule'
export type LearnJobState = 'queued' | 'leased' | 'running' | 'awaiting_approval' | 'blocked' | 'succeeded' | 'failed' | 'cancelled'
export type SearchReservationState = 'reserved' | 'consumed' | 'released'
export type MasteryState = 'unseen' | 'learning' | 'guided' | 'independent' | 'retained' | 'needs_review' | 'blocked' | 'provisionally_known'
export type ForbiddenQueryDatum = 'folder_excerpt' | 'private_filename' | 'private_url' | 'person_name' | 'email_address' | 'account_identifier' | 'unpublished_note' | 'secret' | 'token'
export type NetworkTargetClass = 'public' | 'private' | 'loopback' | 'link_local' | 'metadata_service' | 'reserved'
export type AllowedSourceMime = 'text/html' | 'text/plain' | 'application/pdf'

type LearnV2StateMap = {
  learningVoid: LearningVoidState
  blueprintRevision: BlueprintRevisionState
  source: SourceState
  studySession: StudySessionState
  learnJob: LearnJobState
  searchReservation: SearchReservationState
}

export type LearnV2StateMachineName = keyof LearnV2StateMap

type ContractTransition<State extends string> = {
  from: State
  to: State
  guard?: string
}

type ContractStateMachine<State extends string> = {
  states: State[]
  terminalStates: State[]
  authority: 'server'
  requiresExpectedRevision: true
  requiresIdempotencyKey: true
  transitions: Array<ContractTransition<State>>
}

type RetentionContract = {
  export: 'full' | 'redacted' | 'metadata_only'
  accountDeletion: 'delete' | 'provider_cleanup_then_delete'
  folderDeletion: 'cascade' | 'detach' | 'evidence_tombstone' | 'provider_cleanup_then_delete'
  folderMove: 'preserve_identity_revalidate_access' | 'preserve_revision_revalidate_access' | 'preserve_history_revalidate_access' | 'recompute_after_access_check' | 'cancel_if_scope_unauthorized' | 'reconcile_if_scope_unauthorized' | 'preserve_ledger_rebind_void_scope'
  sourceDeletion: 'not_applicable' | 'delete' | 'preserve' | 'evidence_tombstone'
}

export type LearnV2Contract = {
  version: 'learn-v2.contract.v1'
  canonicalSpec: string
  vocabulary: Array<{ term: string, code: string, definition: string }>
  isolation: {
    storage: 'additive'
    dualWrite: false
    inferMasteryFromV1: false
    inferEvidenceAcceptanceFromV1: false
    preserveV1OnUpgrade: true
    upgradeCopies: string[]
    upgradeNeverCopies: string[]
  }
  stateMachines: { [Name in LearnV2StateMachineName]: ContractStateMachine<LearnV2StateMap[Name]> }
  persistence: {
    tables: ContractTable[]
    retentionClasses: Record<RetentionClassName, RetentionContract>
    sharedBoundaries: Array<{
      name: 'calendarConnections'
      existing: true
      reuse: 'encrypted_credentials_consent_and_disconnect'
      isolation: 'explicit_v2_reconsent_and_no_v1_calendar_event_reuse'
    }>
  }
  runtime: {
    authoritativeState: 'convex'
    externalIo: Array<'convex_action' | 'nitro_server_route' | 'cloudflare_worker'>
    pureDecisionModules: string[]
    humanWaitKeepsJobOpen: boolean
    jobs: {
      leaseRequired: true
      checkpointRequired: true
      boundedRetries: true
      terminalReasonRequired: true
      externalCallsInsideMutation: false
    }
  }
  evidence: {
    acceptedSupportRequiredForPublication: true
    atomicClaimSupportRequired: true
    snippetsAreEvidence: false
    modelMemoryIsEvidence: false
    unknownRightsMayPersistExcerpt: false
    conflictsBlockAffectedObjectives: true
    acceptedSnapshotsAreImmutable: true
    deletionCitationStatus: 'evidence_unavailable'
    deletionPreservesAttemptLedger: true
  }
  mastery: {
    authority: 'server'
    ledger: 'append_only'
    states: MasteryState[]
    calibrationProvisionalThresholdPercent: number
    independentThresholdPercent: number
    retainedMinimumCalendarDays: number
    disqualifiersForIndependent: string[]
    confidenceCanRaiseMastery: false
    calibrationCanAwardRetained: false
    clientScoreIsAuthoritative: false
    failedCheckState: 'needs_review'
  }
  scheduling: {
    calculation: 'pure_versioned'
    timezoneInput: 'iana_with_local_wall_clock_availability'
    placedInstantStorage: 'utc_with_plan_timezone_and_offset'
    defaultSessionMinutes: number
    minimumSessionMinutes: number
    maximumSessionMinutes: number
    bufferPercent: number
    datedPlanFinalBufferPercent: number
    retainedReviewMinimumCalendarDays: number
    reflowScope: 'future_incomplete_only'
    reflowPriority: string[]
    externalEditPolicy: 'propose_then_validate'
    minimizeChangedSessionsFirst: true
  }
  quota: {
    provider: 'tavily_free'
    timezone: 'UTC'
    costCeilingUsd: 0
    allowsOverage: false
    monthlySearchLimit: number
    dailyProductSearchLimit: number
    dailyUserSearchLimit: number
    broadSearchLimitPerLearningVoid: number
    resultsPerRequestLimit: number
    failClosed: true
    paidFallback: boolean
    killSwitchRequired: true
    reservationStates: SearchReservationState[]
    ambiguousOutcome: 'remain_reserved_until_reconciled'
    logsMayContainQueryOrResultPayload: false
  }
  threats: {
    externalQueryForbiddenData: ForbiddenQueryDatum[]
    sourceTextTrust: 'untrusted_data'
    allowedScheme: 'https'
    blockedNetworkTargets: Array<Exclude<NetworkTargetClass, 'public'>>
    redirectDnsRevalidationRequired: true
    boundedResources: string[]
    allowedMimeFamilies: AllowedSourceMime[]
    forwardsUserCookiesOrCredentials: false
    bypassesAccessControls: false
    obeysSourceInstructions: false
    originalPublisherFetchRequiredForEvidence: true
  }
}

const index = (...fields: string[]): ContractIndex => ({
  name: `by_${fields.join('_and_')}`,
  fields,
})

const table = (
  name: string,
  purpose: string,
  retentionClass: RetentionClassName,
  indexes: ContractIndex[],
  parentField?: string,
): ContractTable => ({
  name,
  purpose,
  ownerField: 'userId',
  parentField,
  queryMode: 'bounded',
  retentionClass,
  indexes: [index('userId'), ...indexes],
})

const machine = <State extends string>(
  states: State[],
  terminalStates: State[],
  transitions: Array<ContractTransition<State>>,
): ContractStateMachine<State> => ({
  states,
  terminalStates,
  authority: 'server',
  requiresExpectedRevision: true,
  requiresIdempotencyKey: true,
  transitions,
})

export const LEARN_V2_CONTRACT: LearnV2Contract = {
  version: 'learn-v2.contract.v1',
  canonicalSpec: 'https://github.com/wescodess/budds/issues/180',
  vocabulary: [
    { term: 'Learning Void', code: 'learning_void', definition: 'The owner and folder-scoped V2 learning aggregate.' },
    { term: 'Blueprint', code: 'blueprint', definition: 'The stable identity for a Learning Void learning map.' },
    { term: 'Blueprint Revision', code: 'blueprint_revision', definition: 'An immutable accepted or historical version of the learning map and evidence contract.' },
    { term: 'Capability Objective', code: 'objective', definition: 'A bounded, assessable learner capability with prerequisites and evidence coverage.' },
    { term: 'Source Snapshot', code: 'source_snapshot', definition: 'A revision-identified capture of an authorized folder document or fetched source.' },
    { term: 'Claim Support', code: 'claim_support', definition: 'Atomic claim-to-excerpt or locator support with an entailment and conflict decision.' },
    { term: 'Mastery Attempt', code: 'mastery_attempt', definition: 'An append-only server-scored calibration, application, transfer, or delayed-check event.' },
    { term: 'Mastery Record', code: 'mastery_record', definition: 'A derived per-objective state and next-review projection.' },
    { term: 'Study Plan Revision', code: 'study_plan_revision', definition: 'An immutable feasibility, availability, and scheduling decision set.' },
    { term: 'Study Session', code: 'study_session', definition: 'One scheduled mastery loop with exactly one primary objective.' },
    { term: 'Search Reservation', code: 'search_reservation', definition: 'A transactional claim on zero-paid-search provider credits.' },
    { term: 'Learn Job', code: 'learn_job', definition: 'A typed, leased, checkpointed, bounded machine-owned continuation.' },
  ],
  isolation: {
    storage: 'additive',
    dualWrite: false,
    inferMasteryFromV1: false,
    inferEvidenceAcceptanceFromV1: false,
    preserveV1OnUpgrade: true,
    upgradeCopies: ['title', 'source_identities', 'compatible_preferences'],
    upgradeNeverCopies: ['source_acceptance', 'blueprint_approval', 'attempts', 'mastery', 'scheduled_sessions'],
  },
  stateMachines: {
    learningVoid: machine(
      ['draft', 'sourcing', 'source_review', 'map_review', 'calibration', 'plan_review', 'scheduled', 'active', 'completed', 'paused', 'needs_attention', 'failed', 'archived'],
      ['completed', 'archived'],
      [
        { from: 'draft', to: 'sourcing' },
        { from: 'sourcing', to: 'source_review' },
        { from: 'source_review', to: 'sourcing', guard: 'source_revision_requested' },
        { from: 'source_review', to: 'map_review' },
        { from: 'map_review', to: 'source_review', guard: 'evidence_contract_changed' },
        { from: 'map_review', to: 'calibration' },
        { from: 'calibration', to: 'map_review', guard: 'blueprint_revision_requested' },
        { from: 'calibration', to: 'plan_review' },
        { from: 'plan_review', to: 'calibration', guard: 'calibration_revision_requested' },
        { from: 'plan_review', to: 'scheduled' },
        { from: 'scheduled', to: 'active' },
        { from: 'active', to: 'completed' },
        { from: 'scheduled', to: 'paused' },
        { from: 'active', to: 'paused' },
        { from: 'paused', to: 'scheduled', guard: 'resume_state_is_scheduled' },
        { from: 'paused', to: 'active', guard: 'resume_state_is_active' },
        { from: 'sourcing', to: 'needs_attention' },
        { from: 'scheduled', to: 'needs_attention' },
        { from: 'active', to: 'needs_attention' },
        { from: 'needs_attention', to: 'sourcing', guard: 'attention_resolved_at_sourcing' },
        { from: 'needs_attention', to: 'scheduled', guard: 'attention_resolved_at_schedule' },
        { from: 'needs_attention', to: 'active', guard: 'attention_resolved_while_active' },
        { from: 'sourcing', to: 'failed' },
        { from: 'failed', to: 'sourcing', guard: 'explicit_retry' },
        { from: 'draft', to: 'archived' },
        { from: 'source_review', to: 'archived' },
        { from: 'map_review', to: 'archived' },
        { from: 'plan_review', to: 'archived' },
        { from: 'scheduled', to: 'archived' },
        { from: 'active', to: 'archived' },
        { from: 'paused', to: 'archived' },
        { from: 'needs_attention', to: 'archived' },
        { from: 'failed', to: 'archived' },
      ],
    ),
    blueprintRevision: machine(
      ['draft', 'source_review', 'map_review', 'accepted', 'active', 'superseded'],
      ['superseded'],
      [
        { from: 'draft', to: 'source_review' },
        { from: 'source_review', to: 'draft', guard: 'source_contract_changed' },
        { from: 'source_review', to: 'map_review' },
        { from: 'map_review', to: 'source_review', guard: 'source_contract_changed' },
        { from: 'map_review', to: 'accepted' },
        { from: 'accepted', to: 'active' },
        { from: 'accepted', to: 'superseded' },
        { from: 'active', to: 'superseded', guard: 'replacement_revision_activated' },
      ],
    ),
    source: machine(
      ['candidate', 'fetched', 'evaluated', 'user_accepted', 'rejected', 'unavailable'],
      ['user_accepted', 'rejected', 'unavailable'],
      [
        { from: 'candidate', to: 'fetched' },
        { from: 'candidate', to: 'unavailable' },
        { from: 'fetched', to: 'evaluated' },
        { from: 'fetched', to: 'unavailable' },
        { from: 'evaluated', to: 'user_accepted' },
        { from: 'evaluated', to: 'rejected' },
        { from: 'evaluated', to: 'unavailable' },
      ],
    ),
    studySession: machine(
      ['planned', 'ready', 'in_progress', 'completed', 'missed', 'cancelled', 'blocked', 'generation_failed', 'needs_reschedule'],
      ['completed', 'missed', 'cancelled'],
      [
        { from: 'planned', to: 'ready' },
        { from: 'planned', to: 'blocked' },
        { from: 'planned', to: 'generation_failed' },
        { from: 'planned', to: 'needs_reschedule' },
        { from: 'planned', to: 'missed', guard: 'scheduled_end_passed_without_start' },
        { from: 'planned', to: 'cancelled' },
        { from: 'ready', to: 'in_progress' },
        { from: 'ready', to: 'needs_reschedule' },
        { from: 'ready', to: 'missed', guard: 'scheduled_end_passed_without_start' },
        { from: 'ready', to: 'cancelled' },
        { from: 'in_progress', to: 'completed' },
        { from: 'in_progress', to: 'missed' },
        { from: 'in_progress', to: 'cancelled' },
        { from: 'blocked', to: 'planned', guard: 'prerequisite_or_evidence_restored' },
        { from: 'generation_failed', to: 'planned', guard: 'explicit_retry' },
        { from: 'needs_reschedule', to: 'planned', guard: 'replacement_slot_selected' },
      ],
    ),
    learnJob: machine(
      ['queued', 'leased', 'running', 'awaiting_approval', 'blocked', 'succeeded', 'failed', 'cancelled'],
      ['awaiting_approval', 'blocked', 'succeeded', 'failed', 'cancelled'],
      [
        { from: 'queued', to: 'leased' },
        { from: 'leased', to: 'running' },
        { from: 'leased', to: 'queued', guard: 'lease_expired_before_work' },
        { from: 'running', to: 'awaiting_approval' },
        { from: 'running', to: 'blocked' },
        { from: 'running', to: 'succeeded' },
        { from: 'running', to: 'failed' },
        { from: 'queued', to: 'cancelled' },
        { from: 'leased', to: 'cancelled' },
        { from: 'running', to: 'cancelled' },
      ],
    ),
    searchReservation: machine(
      ['reserved', 'consumed', 'released'],
      ['consumed', 'released'],
      [
        { from: 'reserved', to: 'consumed', guard: 'provider_success_or_reconciled_usage' },
        { from: 'reserved', to: 'released', guard: 'cancelled_or_terminal_pre_request_failure' },
      ],
    ),
  },
  persistence: {
    retentionClasses: {
      stable_aggregate: { export: 'full', accountDeletion: 'delete', folderDeletion: 'cascade', folderMove: 'preserve_identity_revalidate_access', sourceDeletion: 'not_applicable' },
      immutable_revision: { export: 'full', accountDeletion: 'delete', folderDeletion: 'cascade', folderMove: 'preserve_revision_revalidate_access', sourceDeletion: 'preserve' },
      ordered_child: { export: 'full', accountDeletion: 'delete', folderDeletion: 'cascade', folderMove: 'preserve_revision_revalidate_access', sourceDeletion: 'preserve' },
      evidence_identity: { export: 'metadata_only', accountDeletion: 'delete', folderDeletion: 'evidence_tombstone', folderMove: 'preserve_identity_revalidate_access', sourceDeletion: 'evidence_tombstone' },
      protected_evidence: { export: 'redacted', accountDeletion: 'delete', folderDeletion: 'evidence_tombstone', folderMove: 'preserve_revision_revalidate_access', sourceDeletion: 'evidence_tombstone' },
      attempt_ledger: { export: 'full', accountDeletion: 'delete', folderDeletion: 'cascade', folderMove: 'preserve_history_revalidate_access', sourceDeletion: 'preserve' },
      derived_projection: { export: 'full', accountDeletion: 'delete', folderDeletion: 'cascade', folderMove: 'recompute_after_access_check', sourceDeletion: 'preserve' },
      operational_job: { export: 'redacted', accountDeletion: 'delete', folderDeletion: 'cascade', folderMove: 'cancel_if_scope_unauthorized', sourceDeletion: 'not_applicable' },
      provider_projection: { export: 'redacted', accountDeletion: 'provider_cleanup_then_delete', folderDeletion: 'provider_cleanup_then_delete', folderMove: 'reconcile_if_scope_unauthorized', sourceDeletion: 'not_applicable' },
      quota_ledger: { export: 'metadata_only', accountDeletion: 'delete', folderDeletion: 'detach', folderMove: 'preserve_ledger_rebind_void_scope', sourceDeletion: 'not_applicable' },
    },
    sharedBoundaries: [{
      name: 'calendarConnections',
      existing: true,
      reuse: 'encrypted_credentials_consent_and_disconnect',
      isolation: 'explicit_v2_reconsent_and_no_v1_calendar_event_reuse',
    }],
    tables: [
      table('learningVoids', 'Stable owner and folder-scoped V2 aggregate.', 'stable_aggregate', [index('userId', 'folderId'), index('userId', 'status')]),
      table('learnBlueprints', 'Stable blueprint identity for a Learning Void.', 'stable_aggregate', [index('userId', 'learningVoidId')], 'learningVoidId'),
      table('learnBlueprintRevisions', 'Immutable blueprint revision metadata.', 'immutable_revision', [index('userId', 'blueprintId', 'revision'), index('userId', 'learningVoidId', 'status')], 'blueprintId'),
      table('learnMilestones', 'Ordered milestone nodes for one blueprint revision.', 'ordered_child', [index('userId', 'blueprintRevisionId', 'order')], 'blueprintRevisionId'),
      table('learnObjectives', 'Ordered capability objectives and assessment contracts.', 'ordered_child', [index('userId', 'blueprintRevisionId', 'order'), index('userId', 'milestoneId', 'order')], 'blueprintRevisionId'),
      table('learnObjectivePrerequisites', 'Normalized prerequisite DAG edges.', 'ordered_child', [index('userId', 'blueprintRevisionId', 'objectiveId'), index('userId', 'prerequisiteObjectiveId')], 'blueprintRevisionId'),
      table('learnSourceIdentities', 'Stable document or canonical URL source identity.', 'evidence_identity', [index('userId', 'learningVoidId'), index('userId', 'origin', 'externalKey')], 'learningVoidId'),
      table('learnSourceSnapshots', 'Immutable fetched or folder-source revision identity.', 'evidence_identity', [index('userId', 'sourceIdentityId', 'revision'), index('userId', 'learningVoidId', 'status'), index('userId', 'blueprintRevisionId', 'effectiveStatus')], 'sourceIdentityId'),
      table('learnFolderSourceManifests', 'Immutable authorized folder-source capture with explicit coverage state.', 'immutable_revision', [index('userId', 'idempotencyKey'), index('userId', 'learningVoidId'), index('userId', 'blueprintRevisionId')], 'learningVoidId'),
      table('learnFolderSourceManifestFolders', 'Normalized durable folder traversal checkpoints with captured identity and revision.', 'ordered_child', [index('userId', 'manifestId', 'folderId'), index('userId', 'manifestId', 'stage', 'order'), index('userId', 'folderId', 'evidencePurgedAt')], 'manifestId'),
      table('learnFolderSourceManifestEntries', 'Normalized frozen documents linked to canonical source snapshots.', 'ordered_child', [index('userId', 'manifestId', 'order'), index('userId', 'manifestId', 'documentId'), index('userId', 'sourceIdentityId', 'evidencePurgedAt')], 'manifestId'),
      table('learnSourceExcerpts', 'Bounded permitted excerpts or stable locators.', 'protected_evidence', [index('userId', 'sourceSnapshotId')], 'sourceSnapshotId'),
      table('learnObjectiveSources', 'Normalized objective coverage decisions.', 'evidence_identity', [index('userId', 'objectiveId', 'sourceSnapshotId')], 'objectiveId'),
      table('learnClaimSupports', 'Atomic claim-to-evidence entailment and conflict records.', 'protected_evidence', [index('userId', 'sessionContentClaimId'), index('userId', 'sourceExcerptId')], 'sessionContentClaimId'),
      table('masteryAttempts', 'Append-only server-scored attempt ledger.', 'attempt_ledger', [index('userId', 'blueprintRevisionId'), index('userId', 'blueprintRevisionId', 'kind'), index('userId', 'blueprintRevisionId', 'objectiveId', 'attemptedAt'), index('userId', 'objectiveId', 'attemptedAt'), index('userId', 'idempotencyKey')], 'objectiveId'),
      table('masteryRecords', 'Derived objective mastery and scheduling-priority projection.', 'derived_projection', [index('userId', 'scopeKey'), index('userId', 'blueprintRevisionId'), index('userId', 'blueprintRevisionId', 'objectiveId'), index('userId', 'objectiveId'), index('userId', 'nextReviewAt')], 'objectiveId'),
      table('studyPlans', 'Stable study-plan identity for a Learning Void.', 'stable_aggregate', [index('userId', 'learningVoidId')], 'learningVoidId'),
      table('studyPlanRevisions', 'Immutable feasibility, availability, and schedule decisions.', 'immutable_revision', [index('userId', 'studyPlanId', 'revision'), index('userId', 'studyPlanId', 'feasibility', 'revision'), index('userId', 'learningVoidId', 'status')], 'studyPlanId'),
      table('learnPlanCommandReceipts', 'Owner-scoped idempotent study-plan command receipt.', 'operational_job', [index('userId', 'idempotencyKey'), index('userId', 'learningVoidId')], 'learningVoidId'),
      table('learnPlanAuditEvents', 'Pinned structured reasons for preview, acceptance, expiry, and reflow decisions.', 'attempt_ledger', [index('userId', 'learningVoidId'), index('userId', 'studyPlanRevisionId')], 'learningVoidId'),
      table('studySessions', 'Placed session shell with exactly one primary objective.', 'ordered_child', [index('userId', 'studyPlanRevisionId', 'scheduledStartAt'), index('userId', 'status', 'scheduledStartAt')], 'studyPlanRevisionId'),
      table('studySessionRetrievalObjectives', 'Bounded normalized retrieval-objective links.', 'ordered_child', [index('userId', 'studySessionId', 'order')], 'studySessionId'),
      table('sessionContent', 'Versioned generated session content and rubric metadata.', 'immutable_revision', [index('userId', 'studySessionId', 'revision'), index('userId', 'status')], 'studySessionId'),
      table('sessionContentBlocks', 'Ordered normalized session content blocks.', 'ordered_child', [index('userId', 'sessionContentId', 'order')], 'sessionContentId'),
      table('sessionContentClaims', 'Normalized factual claims requiring support records.', 'ordered_child', [index('userId', 'sessionContentId', 'order')], 'sessionContentId'),
      table('calendarProjections', 'Idempotent Study Session to provider-event projection ledger.', 'provider_projection', [index('userId', 'studySessionId'), index('userId', 'provider', 'externalEventId')], 'studySessionId'),
      table('reminderPolicies', 'Owner-scoped channel, offset, quiet-hour, and timezone policy.', 'stable_aggregate', [index('userId', 'learningVoidId')], 'learningVoidId'),
      table('searchQuotaBuckets', 'UTC product, user, and Learning Void allowance counters and reconciliation status.', 'quota_ledger', [index('provider', 'scopeKind', 'scopeKey', 'periodKey'), index('userId', 'provider', 'periodKey'), index('userId', 'learningVoidId', 'periodKey'), index('provider', 'reconciliationStatus', 'periodKey')]),
      table('searchReservations', 'Transactional provider-credit reservations and outcomes.', 'quota_ledger', [index('userId', 'idempotencyKeyHash'), index('userId', 'learningVoidId'), index('provider', 'status', 'dispatchState', 'expiresAt'), index('provider', 'reconciliationRequired', 'updatedAt')]),
      table('learnJobs', 'Typed, leased, checkpointed, bounded V2 jobs.', 'operational_job', [index('userId', 'idempotencyKey'), index('userId', 'status', 'leaseExpiresAt'), index('type', 'status', 'leaseExpiresAt'), index('userId', 'learningVoidId', 'type'), index('userId', 'blueprintRevisionId', 'type', 'status')], 'learningVoidId'),
    ],
  },
  runtime: {
    authoritativeState: 'convex',
    externalIo: ['convex_action', 'nitro_server_route', 'cloudflare_worker'],
    pureDecisionModules: ['mastery_projection', 'schedule_feasibility', 'query_redaction', 'fetch_admission', 'blueprint_candidate_validation'],
    humanWaitKeepsJobOpen: false,
    jobs: {
      leaseRequired: true,
      checkpointRequired: true,
      boundedRetries: true,
      terminalReasonRequired: true,
      externalCallsInsideMutation: false,
    },
  },
  evidence: {
    acceptedSupportRequiredForPublication: true,
    atomicClaimSupportRequired: true,
    snippetsAreEvidence: false,
    modelMemoryIsEvidence: false,
    unknownRightsMayPersistExcerpt: false,
    conflictsBlockAffectedObjectives: true,
    acceptedSnapshotsAreImmutable: true,
    deletionCitationStatus: 'evidence_unavailable',
    deletionPreservesAttemptLedger: true,
  },
  mastery: {
    authority: 'server',
    ledger: 'append_only',
    states: ['unseen', 'learning', 'guided', 'independent', 'retained', 'needs_review', 'blocked', 'provisionally_known'],
    calibrationProvisionalThresholdPercent: 80,
    independentThresholdPercent: 80,
    retainedMinimumCalendarDays: 7,
    disqualifiersForIndependent: ['answer_reveal', 'substantive_hint'],
    confidenceCanRaiseMastery: false,
    calibrationCanAwardRetained: false,
    clientScoreIsAuthoritative: false,
    failedCheckState: 'needs_review',
  },
  scheduling: {
    calculation: 'pure_versioned',
    timezoneInput: 'iana_with_local_wall_clock_availability',
    placedInstantStorage: 'utc_with_plan_timezone_and_offset',
    defaultSessionMinutes: 25,
    minimumSessionMinutes: 15,
    maximumSessionMinutes: 60,
    bufferPercent: 15,
    datedPlanFinalBufferPercent: 10,
    retainedReviewMinimumCalendarDays: 7,
    reflowScope: 'future_incomplete_only',
    reflowPriority: ['overdue_retained_review', 'prerequisite_remediation', 'due_review', 'new_learning', 'optional_enrichment'],
    externalEditPolicy: 'propose_then_validate',
    minimizeChangedSessionsFirst: true,
  },
  quota: {
    provider: 'tavily_free',
    timezone: 'UTC',
    costCeilingUsd: 0,
    allowsOverage: false,
    monthlySearchLimit: 800,
    dailyProductSearchLimit: 25,
    dailyUserSearchLimit: 4,
    broadSearchLimitPerLearningVoid: 2,
    resultsPerRequestLimit: 8,
    failClosed: true,
    paidFallback: false,
    killSwitchRequired: true,
    reservationStates: ['reserved', 'consumed', 'released'],
    ambiguousOutcome: 'remain_reserved_until_reconciled',
    logsMayContainQueryOrResultPayload: false,
  },
  threats: {
    externalQueryForbiddenData: ['folder_excerpt', 'private_filename', 'private_url', 'person_name', 'email_address', 'account_identifier', 'unpublished_note', 'secret', 'token'],
    sourceTextTrust: 'untrusted_data',
    allowedScheme: 'https',
    blockedNetworkTargets: ['private', 'loopback', 'link_local', 'metadata_service', 'reserved'],
    redirectDnsRevalidationRequired: true,
    boundedResources: ['redirects', 'time', 'bytes', 'decompression', 'concurrency'],
    allowedMimeFamilies: ['text/html', 'text/plain', 'application/pdf'],
    forwardsUserCookiesOrCredentials: false,
    bypassesAccessControls: false,
    obeysSourceInstructions: false,
    originalPublisherFetchRequiredForEvidence: true,
  },
}

export type EvidenceContractInput = {
  sourceStatus: SourceState
  supportOrigin: 'original_source' | 'search_snippet' | 'model_memory'
  entailment: 'entailed' | 'not_entailed' | 'not_evaluated'
  conflictStatus: 'clear' | 'unresolved'
  rightsStatus: 'permitted' | 'unknown' | 'prohibited'
  sourceDeleted: boolean
}

export type EvidenceContractResult = {
  publishable: boolean
  persistExcerpt: boolean
  citationStatus: 'available' | 'locator_only' | 'unavailable' | 'evidence_unavailable'
  preserveCompletedAttempt: boolean
}

export type MasteryContractInput = {
  priorState: MasteryState
  attemptKind: 'calibration' | 'guided_application' | 'independent_application' | 'transfer' | 'delayed_transfer'
  serverScorePercent: number | null
  clientScorePercent?: number
  daysSinceIndependent: number | null
  usedSubstantiveHint: boolean
  revealedAnswer: boolean
}

export type SchedulingContractInput =
  | { kind: 'prerequisite_order', prerequisiteEndsAt: string, dependantStartsAt: string }
  | { kind: 'dst_gap', selectedInstant: string, firstValidInstantInsideWindow: string, adjustmentDisclosed: boolean }
  | { kind: 'dst_repeat', selectedOffset: string, earlierOffset: string, adjustmentDisclosed: boolean }
  | { kind: 'feasibility', requiredMinutesWithReviews: number, usableMinutesAfterBuffer: number, alternativeCodes: string[] }
  | { kind: 'reflow', now: string, sessions: Array<{ id: string, status: StudySessionState, startsAt: string, moveRequested: boolean }> }
  | { kind: 'external_edit', preservesPlanRules: boolean }
  | { kind: 'buffer', unallocatedPercent: number, hasBufferInFinalTenPercent: boolean }

export type SchedulingContractResult = {
  decision: 'accepted' | 'rejected' | 'adjusted' | 'feasible' | 'infeasible' | 'reflowed' | 'proposed'
  reason: 'prerequisites_ordered' | 'prerequisite_violation' | 'dst_gap_adjusted' | 'dst_gap_invalid' | 'dst_repeat_adjusted' | 'dst_repeat_invalid' | 'capacity_available' | 'insufficient_capacity' | 'future_incomplete_only' | 'external_edit_valid' | 'external_edit_requires_review' | 'buffer_reserved' | 'buffer_missing'
  changedSessionIds?: string[]
  preservedSessionIds?: string[]
  alternativeCodes?: string[]
}

export type QuotaContractInput = {
  currentState: SearchReservationState | null
  event: 'provider_success' | 'terminal_pre_request_failure' | 'ambiguous_provider_outcome' | 'ledger_unavailable' | 'capacity_exhausted' | 'idempotent_retry'
}

export type QuotaContractResult = {
  finalState: SearchReservationState | null
  providerCalled: boolean
  paidProviderCalled: false
  reconciliationRequired: boolean
  creditsConsumedAgain: boolean
  failClosed: boolean
}

export type ThreatContractInput = {
  lane: 'source_fetch' | 'external_query'
  scheme: 'https' | 'http'
  networkTargets: readonly NetworkTargetClass[]
  redirectDnsRevalidated: boolean
  mime: AllowedSourceMime | 'application/zip'
  withinResourceLimits: boolean
  forbiddenQueryData: readonly ForbiddenQueryDatum[]
  sourceContainsInstructions: boolean
}

export type ThreatContractResult = {
  admitted: boolean
  obeySourceInstructions: false
}

type ContractFixture<Input, Result> = {
  id: string
  input: Input
  expected: Result
}

export type LearnV2ContractFixtures = {
  evidence: Array<ContractFixture<EvidenceContractInput, EvidenceContractResult>>
  mastery: Array<ContractFixture<MasteryContractInput, MasteryState>>
  scheduling: Array<ContractFixture<SchedulingContractInput, SchedulingContractResult>>
  quota: Array<ContractFixture<QuotaContractInput, QuotaContractResult>>
  threats: Array<ContractFixture<ThreatContractInput, ThreatContractResult>>
}

export function isLearnV2TransitionAllowed<Name extends LearnV2StateMachineName>(
  machineName: Name,
  from: LearnV2StateMap[Name],
  to: LearnV2StateMap[Name],
  satisfiedGuard?: string,
): boolean {
  const transitions = LEARN_V2_CONTRACT.stateMachines[machineName].transitions as Array<ContractTransition<string>>
  return transitions.some(transition => transition.from === from
    && transition.to === to
    && (transition.guard === undefined || transition.guard === satisfiedGuard))
}

export function evaluateEvidenceContract(input: EvidenceContractInput): EvidenceContractResult {
  if (input.sourceDeleted) {
    return {
      publishable: false,
      persistExcerpt: false,
      citationStatus: 'evidence_unavailable',
      preserveCompletedAttempt: true,
    }
  }

  const isOriginal = input.supportOrigin === 'original_source'
  const sourceAccepted = input.sourceStatus === 'user_accepted'
  const supportAccepted = input.entailment === 'entailed' && input.conflictStatus === 'clear'
  const rightsPermitReference = input.rightsStatus !== 'prohibited'

  return {
    publishable: isOriginal && sourceAccepted && supportAccepted && rightsPermitReference,
    persistExcerpt: isOriginal && input.rightsStatus === 'permitted',
    citationStatus: !isOriginal || !sourceAccepted || !rightsPermitReference
      ? 'unavailable'
      : input.rightsStatus === 'unknown' ? 'locator_only' : 'available',
    preserveCompletedAttempt: false,
  }
}

export function evaluateMasteryContract(input: MasteryContractInput): MasteryState {
  if (input.serverScorePercent === null) return input.priorState
  const assisted = input.usedSubstantiveHint || input.revealedAnswer
  if (input.attemptKind === 'delayed_transfer') {
    const eligible = input.daysSinceIndependent !== null
      && input.daysSinceIndependent >= LEARN_V2_CONTRACT.mastery.retainedMinimumCalendarDays
      && (input.priorState === 'independent' || input.priorState === 'retained')
    if (!eligible) return input.priorState
  }
  return deriveMastery({
    scorePercent: input.serverScorePercent,
    assisted,
    kind: input.attemptKind === 'calibration'
      ? 'calibration'
      : input.attemptKind === 'guided_application'
        ? 'guided_application'
        : input.attemptKind === 'delayed_transfer'
          ? 'retained_transfer'
          : 'independent_application',
    previousState: input.priorState,
    firstIndependentLocalDate: input.attemptKind === 'delayed_transfer' ? '2000-01-01' : undefined,
    attemptLocalDate: input.attemptKind === 'delayed_transfer' ? '2000-01-08' : undefined,
  }).state
}

export function evaluateSchedulingContract(input: SchedulingContractInput): SchedulingContractResult {
  switch (input.kind) {
    case 'prerequisite_order':
      return input.prerequisiteEndsAt <= input.dependantStartsAt
        ? { decision: 'accepted', reason: 'prerequisites_ordered' }
        : { decision: 'rejected', reason: 'prerequisite_violation' }
    case 'dst_gap':
      return input.selectedInstant === input.firstValidInstantInsideWindow && input.adjustmentDisclosed
        ? { decision: 'adjusted', reason: 'dst_gap_adjusted' }
        : { decision: 'rejected', reason: 'dst_gap_invalid' }
    case 'dst_repeat':
      return input.selectedOffset === input.earlierOffset && input.adjustmentDisclosed
        ? { decision: 'adjusted', reason: 'dst_repeat_adjusted' }
        : { decision: 'rejected', reason: 'dst_repeat_invalid' }
    case 'feasibility':
      return input.requiredMinutesWithReviews <= input.usableMinutesAfterBuffer
        ? { decision: 'feasible', reason: 'capacity_available' }
        : { decision: 'infeasible', reason: 'insufficient_capacity', alternativeCodes: input.alternativeCodes }
    case 'reflow': {
      const movableStates: StudySessionState[] = ['planned', 'ready', 'needs_reschedule']
      const changedSessionIds = input.sessions
        .filter(session => session.moveRequested && session.startsAt > input.now && movableStates.includes(session.status))
        .map(session => session.id)
      return {
        decision: 'reflowed',
        reason: 'future_incomplete_only',
        changedSessionIds,
        preservedSessionIds: input.sessions.filter(session => !changedSessionIds.includes(session.id)).map(session => session.id),
      }
    }
    case 'external_edit':
      return input.preservesPlanRules
        ? { decision: 'accepted', reason: 'external_edit_valid' }
        : { decision: 'proposed', reason: 'external_edit_requires_review' }
    case 'buffer':
      return input.unallocatedPercent >= LEARN_V2_CONTRACT.scheduling.bufferPercent && input.hasBufferInFinalTenPercent
        ? { decision: 'accepted', reason: 'buffer_reserved' }
        : { decision: 'rejected', reason: 'buffer_missing' }
  }
}

export function evaluateQuotaContract(input: QuotaContractInput): QuotaContractResult {
  if (input.event !== 'idempotent_retry' && input.event !== 'ledger_unavailable' && input.event !== 'capacity_exhausted' && input.currentState !== 'reserved') {
    return { finalState: input.currentState, providerCalled: false, paidProviderCalled: false, reconciliationRequired: false, creditsConsumedAgain: false, failClosed: true }
  }
  switch (input.event) {
    case 'provider_success':
      return { finalState: 'consumed', providerCalled: true, paidProviderCalled: false, reconciliationRequired: false, creditsConsumedAgain: false, failClosed: false }
    case 'terminal_pre_request_failure':
      return { finalState: 'released', providerCalled: false, paidProviderCalled: false, reconciliationRequired: false, creditsConsumedAgain: false, failClosed: false }
    case 'ambiguous_provider_outcome':
      return { finalState: 'reserved', providerCalled: true, paidProviderCalled: false, reconciliationRequired: true, creditsConsumedAgain: false, failClosed: false }
    case 'ledger_unavailable':
    case 'capacity_exhausted':
      return { finalState: input.currentState, providerCalled: false, paidProviderCalled: false, reconciliationRequired: false, creditsConsumedAgain: false, failClosed: true }
    case 'idempotent_retry':
      return { finalState: input.currentState, providerCalled: false, paidProviderCalled: false, reconciliationRequired: false, creditsConsumedAgain: false, failClosed: false }
  }
}

export function evaluateThreatContract(input: ThreatContractInput): ThreatContractResult {
  const queryIsSafe = input.lane !== 'external_query' || input.forbiddenQueryData.length === 0
  const networkIsSafe = input.networkTargets.length > 0 && input.networkTargets.every(target => target === 'public')
  const mimeIsSafe = LEARN_V2_CONTRACT.threats.allowedMimeFamilies.includes(input.mime as AllowedSourceMime)
  return {
    admitted: input.scheme === 'https'
      && queryIsSafe
      && networkIsSafe
      && input.redirectDnsRevalidated
      && mimeIsSafe
      && input.withinResourceLimits,
    obeySourceInstructions: false,
  }
}

const REQUIRED_TABLES = [
  'learningVoids',
  'learnBlueprintRevisions',
  'learnObjectivePrerequisites',
  'learnSourceSnapshots',
  'learnClaimSupports',
  'masteryAttempts',
  'masteryRecords',
  'studyPlanRevisions',
  'studySessions',
  'sessionContentClaims',
  'searchQuotaBuckets',
  'searchReservations',
  'learnJobs',
]

const REQUIRED_STATE_MACHINES: LearnV2StateMachineName[] = [
  'learningVoid',
  'blueprintRevision',
  'source',
  'studySession',
  'learnJob',
  'searchReservation',
]

const REQUIRED_FORBIDDEN_QUERY_DATA: ForbiddenQueryDatum[] = [
  'folder_excerpt',
  'private_filename',
  'private_url',
  'person_name',
  'email_address',
  'account_identifier',
  'unpublished_note',
  'secret',
  'token',
]

export function validateLearnV2Contract(contract: LearnV2Contract): string[] {
  const violations: string[] = []

  if (contract.version !== 'learn-v2.contract.v1') violations.push('version must be learn-v2.contract.v1')
  if (contract.isolation.storage !== 'additive') violations.push('isolation.storage must be additive')
  if (contract.isolation.dualWrite) violations.push('isolation.dualWrite must be false')
  if (contract.isolation.inferMasteryFromV1) violations.push('isolation.inferMasteryFromV1 must be false')
  if (contract.isolation.inferEvidenceAcceptanceFromV1) violations.push('isolation.inferEvidenceAcceptanceFromV1 must be false')

  for (const requiredMachine of REQUIRED_STATE_MACHINES) {
    if (!contract.stateMachines[requiredMachine]) violations.push(`stateMachines.${requiredMachine} must be defined`)
  }
  for (const [name, stateMachine] of Object.entries(contract.stateMachines)) {
    const states = new Set(stateMachine.states)
    const terminalStates = new Set<string>(stateMachine.terminalStates)
    if (stateMachine.authority !== 'server') violations.push(`stateMachines.${name}.authority must be server`)
    if (!stateMachine.requiresExpectedRevision) violations.push(`stateMachines.${name}.requiresExpectedRevision must be true`)
    if (!stateMachine.requiresIdempotencyKey) violations.push(`stateMachines.${name}.requiresIdempotencyKey must be true`)
    for (const terminal of stateMachine.terminalStates) {
      if (!states.has(terminal)) violations.push(`stateMachines.${name} has unknown terminal state ${terminal}`)
    }
    for (const transition of stateMachine.transitions) {
      if (!states.has(transition.from)) violations.push(`stateMachines.${name} has unknown from state ${transition.from}`)
      if (!states.has(transition.to)) violations.push(`stateMachines.${name} has unknown to state ${transition.to}`)
      if (transition.from === transition.to) violations.push(`stateMachines.${name} has self transition ${transition.from}`)
      if (terminalStates.has(transition.from)) violations.push(`stateMachines.${name} terminal state ${transition.from} has an outgoing transition`)
    }
  }

  const tableNames = new Set(contract.persistence.tables.map(item => item.name))
  for (const requiredTable of REQUIRED_TABLES) {
    if (!tableNames.has(requiredTable)) violations.push(`persistence.${requiredTable} must be defined`)
  }
  for (const contractTable of contract.persistence.tables) {
    const ownerIndex = contractTable.indexes.find(item => item.name === 'by_userId' && item.fields.length === 1 && item.fields[0] === 'userId')
    if (!ownerIndex) violations.push(`persistence.${contractTable.name} must define by_userId`)
    if (contractTable.queryMode !== 'bounded') violations.push(`persistence.${contractTable.name}.queryMode must be bounded`)
    if (!contract.persistence.retentionClasses[contractTable.retentionClass]) violations.push(`persistence.${contractTable.name} has unknown retention class`)
    for (const contractIndex of contractTable.indexes) {
      const expectedName = `by_${contractIndex.fields.join('_and_')}`
      if (contractIndex.name !== expectedName) violations.push(`persistence.${contractTable.name}.${contractIndex.name} must be named ${expectedName}`)
    }
  }
  for (const [name, retention] of Object.entries(contract.persistence.retentionClasses)) {
    if (!retention.folderMove) violations.push(`persistence.retentionClasses.${name}.folderMove must be defined`)
  }
  if (tableNames.has('calendarConnections')) violations.push('persistence.calendarConnections must remain an explicit shared boundary')
  const sharedCalendar = contract.persistence.sharedBoundaries.find(item => item.name === 'calendarConnections')
  if (!sharedCalendar || sharedCalendar.isolation !== 'explicit_v2_reconsent_and_no_v1_calendar_event_reuse') {
    violations.push('persistence.sharedBoundaries must isolate calendarConnections from V1 calendar events')
  }

  if (contract.runtime.authoritativeState !== 'convex') violations.push('runtime.authoritativeState must be convex')
  if (contract.runtime.humanWaitKeepsJobOpen) violations.push('runtime.humanWaitKeepsJobOpen must be false')
  if (contract.runtime.jobs.externalCallsInsideMutation) violations.push('runtime.jobs.externalCallsInsideMutation must be false')
  if (!contract.runtime.jobs.leaseRequired) violations.push('runtime.jobs.leaseRequired must be true')
  if (!contract.runtime.jobs.checkpointRequired) violations.push('runtime.jobs.checkpointRequired must be true')
  if (!contract.runtime.jobs.boundedRetries) violations.push('runtime.jobs.boundedRetries must be true')
  if (!contract.runtime.jobs.terminalReasonRequired) violations.push('runtime.jobs.terminalReasonRequired must be true')

  if (!contract.evidence.acceptedSupportRequiredForPublication) violations.push('evidence.acceptedSupportRequiredForPublication must be true')
  if (contract.evidence.snippetsAreEvidence) violations.push('evidence.snippetsAreEvidence must be false')
  if (contract.evidence.modelMemoryIsEvidence) violations.push('evidence.modelMemoryIsEvidence must be false')
  if (contract.evidence.unknownRightsMayPersistExcerpt) violations.push('evidence.unknownRightsMayPersistExcerpt must be false')
  if (contract.evidence.deletionCitationStatus !== 'evidence_unavailable') violations.push('evidence.deletionCitationStatus must be evidence_unavailable')
  if (!contract.evidence.deletionPreservesAttemptLedger) violations.push('evidence.deletionPreservesAttemptLedger must be true')

  if (contract.mastery.authority !== 'server') violations.push('mastery.authority must be server')
  if (contract.mastery.ledger !== 'append_only') violations.push('mastery.ledger must be append_only')
  if (contract.mastery.calibrationProvisionalThresholdPercent !== 80) violations.push('mastery.calibrationProvisionalThresholdPercent must be 80')
  if (contract.mastery.independentThresholdPercent !== 80) violations.push('mastery.independentThresholdPercent must be 80')
  if (contract.mastery.retainedMinimumCalendarDays !== 7) violations.push('mastery.retainedMinimumCalendarDays must be 7')
  if (contract.mastery.confidenceCanRaiseMastery) violations.push('mastery.confidenceCanRaiseMastery must be false')
  if (contract.mastery.calibrationCanAwardRetained) violations.push('mastery.calibrationCanAwardRetained must be false')
  if (contract.mastery.clientScoreIsAuthoritative) violations.push('mastery.clientScoreIsAuthoritative must be false')

  if (contract.scheduling.calculation !== 'pure_versioned') violations.push('scheduling.calculation must be pure_versioned')
  if (contract.scheduling.bufferPercent !== 15) violations.push('scheduling.bufferPercent must be 15')
  if (contract.scheduling.retainedReviewMinimumCalendarDays !== 7) violations.push('scheduling.retainedReviewMinimumCalendarDays must be 7')
  if (contract.scheduling.reflowScope !== 'future_incomplete_only') violations.push('scheduling.reflowScope must be future_incomplete_only')
  if (contract.scheduling.externalEditPolicy !== 'propose_then_validate') violations.push('scheduling.externalEditPolicy must be propose_then_validate')

  if (contract.quota.timezone !== 'UTC') violations.push('quota.timezone must be UTC')
  if (contract.quota.costCeilingUsd !== 0) violations.push('quota.costCeilingUsd must be 0')
  if (contract.quota.allowsOverage) violations.push('quota.allowsOverage must be false')
  if (!contract.quota.failClosed) violations.push('quota.failClosed must be true')
  if (contract.quota.paidFallback) violations.push('quota.paidFallback must be false')
  if (!contract.quota.killSwitchRequired) violations.push('quota.killSwitchRequired must be true')
  if (contract.quota.logsMayContainQueryOrResultPayload) violations.push('quota.logsMayContainQueryOrResultPayload must be false')

  for (const item of REQUIRED_FORBIDDEN_QUERY_DATA) {
    if (!contract.threats.externalQueryForbiddenData.includes(item)) violations.push(`threats.externalQueryForbiddenData must include ${item}`)
  }
  if (contract.threats.sourceTextTrust !== 'untrusted_data') violations.push('threats.sourceTextTrust must be untrusted_data')
  if (contract.threats.allowedScheme !== 'https') violations.push('threats.allowedScheme must be https')
  if (!contract.threats.redirectDnsRevalidationRequired) violations.push('threats.redirectDnsRevalidationRequired must be true')
  if (contract.threats.forwardsUserCookiesOrCredentials) violations.push('threats.forwardsUserCookiesOrCredentials must be false')
  if (contract.threats.bypassesAccessControls) violations.push('threats.bypassesAccessControls must be false')
  if (contract.threats.obeysSourceInstructions) violations.push('threats.obeysSourceInstructions must be false')

  return violations
}
