import type { LearnV2ContractFixtures } from '../../shared/learn-v2-contract'

const safeSource = {
  lane: 'source_fetch',
  scheme: 'https',
  networkTargets: ['public'],
  redirectDnsRevalidated: true,
  mime: 'text/html',
  withinResourceLimits: true,
  forbiddenQueryData: [],
  sourceContainsInstructions: false,
} as const

export const LEARN_V2_CONTRACT_FIXTURES = {
  evidence: [
    {
      id: 'accepted-atomic-support',
      input: { sourceStatus: 'user_accepted', supportOrigin: 'original_source', entailment: 'entailed', conflictStatus: 'clear', rightsStatus: 'permitted', sourceDeleted: false },
      expected: { publishable: true, persistExcerpt: true, citationStatus: 'available', preserveCompletedAttempt: false },
    },
    {
      id: 'search-snippet-is-discovery-only',
      input: { sourceStatus: 'candidate', supportOrigin: 'search_snippet', entailment: 'not_evaluated', conflictStatus: 'clear', rightsStatus: 'unknown', sourceDeleted: false },
      expected: { publishable: false, persistExcerpt: false, citationStatus: 'unavailable', preserveCompletedAttempt: false },
    },
    {
      id: 'unknown-retention-rights',
      input: { sourceStatus: 'user_accepted', supportOrigin: 'original_source', entailment: 'entailed', conflictStatus: 'clear', rightsStatus: 'unknown', sourceDeleted: false },
      expected: { publishable: true, persistExcerpt: false, citationStatus: 'locator_only', preserveCompletedAttempt: false },
    },
    {
      id: 'conflicting-support',
      input: { sourceStatus: 'user_accepted', supportOrigin: 'original_source', entailment: 'entailed', conflictStatus: 'unresolved', rightsStatus: 'permitted', sourceDeleted: false },
      expected: { publishable: false, persistExcerpt: true, citationStatus: 'available', preserveCompletedAttempt: false },
    },
    {
      id: 'deleted-source',
      input: { sourceStatus: 'unavailable', supportOrigin: 'original_source', entailment: 'entailed', conflictStatus: 'clear', rightsStatus: 'prohibited', sourceDeleted: true },
      expected: { publishable: false, persistExcerpt: false, citationStatus: 'evidence_unavailable', preserveCompletedAttempt: true },
    },
  ],
  mastery: [
    {
      id: 'calibration-is-provisional-only',
      input: { priorState: 'unseen', attemptKind: 'calibration', serverScorePercent: 100, daysSinceIndependent: null, usedSubstantiveHint: false, revealedAnswer: false },
      expected: 'provisionally_known',
    },
    {
      id: 'failed-calibration-starts-learning',
      input: { priorState: 'unseen', attemptKind: 'calibration', serverScorePercent: 0, daysSinceIndependent: null, usedSubstantiveHint: false, revealedAnswer: false },
      expected: 'learning',
    },
    {
      id: 'assisted-calibration-starts-learning',
      input: { priorState: 'unseen', attemptKind: 'calibration', serverScorePercent: 100, daysSinceIndependent: null, usedSubstantiveHint: true, revealedAnswer: false },
      expected: 'learning',
    },
    {
      id: 'calibration-preserves-guided-mastery',
      input: { priorState: 'guided', attemptKind: 'calibration', serverScorePercent: 0, daysSinceIndependent: null, usedSubstantiveHint: false, revealedAnswer: false },
      expected: 'guided',
    },
    {
      id: 'unassisted-independent-pass',
      input: { priorState: 'learning', attemptKind: 'independent_application', serverScorePercent: 80, daysSinceIndependent: null, usedSubstantiveHint: false, revealedAnswer: false },
      expected: 'independent',
    },
    {
      id: 'hint-caps-at-guided',
      input: { priorState: 'learning', attemptKind: 'independent_application', serverScorePercent: 100, daysSinceIndependent: null, usedSubstantiveHint: true, revealedAnswer: false },
      expected: 'guided',
    },
    {
      id: 'answer-reveal-caps-at-guided',
      input: { priorState: 'learning', attemptKind: 'independent_application', serverScorePercent: 100, daysSinceIndependent: null, usedSubstantiveHint: false, revealedAnswer: true },
      expected: 'guided',
    },
    {
      id: 'retained-too-early',
      input: { priorState: 'independent', attemptKind: 'delayed_transfer', serverScorePercent: 100, daysSinceIndependent: 6, usedSubstantiveHint: false, revealedAnswer: false },
      expected: 'independent',
    },
    {
      id: 'eligible-retained-transfer',
      input: { priorState: 'independent', attemptKind: 'delayed_transfer', serverScorePercent: 80, daysSinceIndependent: 7, usedSubstantiveHint: false, revealedAnswer: false },
      expected: 'retained',
    },
    {
      id: 'failed-independent-check',
      input: { priorState: 'guided', attemptKind: 'independent_application', serverScorePercent: 79, daysSinceIndependent: null, usedSubstantiveHint: false, revealedAnswer: false },
      expected: 'needs_review',
    },
    {
      id: 'retained-ordinary-pass-is-preserved',
      input: { priorState: 'retained', attemptKind: 'independent_application', serverScorePercent: 100, daysSinceIndependent: 8, usedSubstantiveHint: false, revealedAnswer: false },
      expected: 'retained',
    },
    {
      id: 'retained-regresses-only-on-failed-delayed-check',
      input: { priorState: 'retained', attemptKind: 'delayed_transfer', serverScorePercent: 79, daysSinceIndependent: 8, usedSubstantiveHint: false, revealedAnswer: false },
      expected: 'needs_review',
    },
    {
      id: 'assisted-delayed-failure-is-not-an-eligible-retained-check',
      input: { priorState: 'retained', attemptKind: 'delayed_transfer', serverScorePercent: 79, daysSinceIndependent: 8, usedSubstantiveHint: true, revealedAnswer: false },
      expected: 'retained',
    },
    {
      id: 'client-score-is-non-authoritative',
      input: { priorState: 'learning', attemptKind: 'independent_application', serverScorePercent: null, clientScorePercent: 100, daysSinceIndependent: null, usedSubstantiveHint: false, revealedAnswer: false },
      expected: 'learning',
    },
  ],
  scheduling: [
    {
      id: 'prerequisites-before-dependants',
      input: { kind: 'prerequisite_order', prerequisiteEndsAt: '2026-09-14T14:25:00.000Z', dependantStartsAt: '2026-09-15T14:25:00.000Z' },
      expected: { decision: 'accepted', reason: 'prerequisites_ordered' },
    },
    {
      id: 'nonexistent-dst-time',
      input: { kind: 'dst_gap', selectedInstant: '2027-03-14T07:00:00.000Z', firstValidInstantInsideWindow: '2027-03-14T07:00:00.000Z', adjustmentDisclosed: true },
      expected: { decision: 'adjusted', reason: 'dst_gap_adjusted' },
    },
    {
      id: 'repeated-dst-time',
      input: { kind: 'dst_repeat', selectedOffset: '-04:00', earlierOffset: '-04:00', adjustmentDisclosed: true },
      expected: { decision: 'adjusted', reason: 'dst_repeat_adjusted' },
    },
    {
      id: 'infeasible-target-with-alternatives',
      input: { kind: 'feasibility', requiredMinutesWithReviews: 600, usableMinutesAfterBuffer: 400, alternativeCodes: ['extend_deadline', 'add_availability', 'reduce_depth'] },
      expected: { decision: 'infeasible', reason: 'insufficient_capacity', alternativeCodes: ['extend_deadline', 'add_availability', 'reduce_depth'] },
    },
    {
      id: 'missed-session-future-only-reflow',
      input: {
        kind: 'reflow',
        now: '2026-09-13T16:00:00.000Z',
        sessions: [
          { id: 'completed-past', status: 'completed', startsAt: '2026-09-10T14:00:00.000Z', moveRequested: true },
          { id: 'missed-past', status: 'missed', startsAt: '2026-09-12T14:00:00.000Z', moveRequested: false },
          { id: 'future-planned', status: 'planned', startsAt: '2026-09-14T14:00:00.000Z', moveRequested: true },
          { id: 'future-ready', status: 'ready', startsAt: '2026-09-15T14:00:00.000Z', moveRequested: true },
          { id: 'future-in-progress', status: 'in_progress', startsAt: '2026-09-16T14:00:00.000Z', moveRequested: true },
        ],
      },
      expected: {
        decision: 'reflowed',
        reason: 'future_incomplete_only',
        changedSessionIds: ['future-planned', 'future-ready'],
        preservedSessionIds: ['completed-past', 'missed-past', 'future-in-progress'],
      },
    },
    {
      id: 'external-edit-requires-review',
      input: { kind: 'external_edit', preservesPlanRules: false },
      expected: { decision: 'proposed', reason: 'external_edit_requires_review' },
    },
    {
      id: 'dated-plan-reserves-capacity',
      input: { kind: 'buffer', unallocatedPercent: 15, hasBufferInFinalTenPercent: true },
      expected: { decision: 'accepted', reason: 'buffer_reserved' },
    },
  ],
  quota: [
    {
      id: 'successful-search',
      input: { currentState: 'reserved', event: 'provider_success' },
      expected: { finalState: 'consumed', providerCalled: true, paidProviderCalled: false, reconciliationRequired: false, creditsConsumedAgain: false, failClosed: false },
    },
    {
      id: 'terminal-pre-request-failure',
      input: { currentState: 'reserved', event: 'terminal_pre_request_failure' },
      expected: { finalState: 'released', providerCalled: false, paidProviderCalled: false, reconciliationRequired: false, creditsConsumedAgain: false, failClosed: false },
    },
    {
      id: 'ambiguous-provider-outcome',
      input: { currentState: 'reserved', event: 'ambiguous_provider_outcome' },
      expected: { finalState: 'reserved', providerCalled: true, paidProviderCalled: false, reconciliationRequired: true, creditsConsumedAgain: false, failClosed: false },
    },
    {
      id: 'ledger-unavailable',
      input: { currentState: null, event: 'ledger_unavailable' },
      expected: { finalState: null, providerCalled: false, paidProviderCalled: false, reconciliationRequired: false, creditsConsumedAgain: false, failClosed: true },
    },
    {
      id: 'ledger-unavailable-preserves-reservation',
      input: { currentState: 'reserved', event: 'ledger_unavailable' },
      expected: { finalState: 'reserved', providerCalled: false, paidProviderCalled: false, reconciliationRequired: false, creditsConsumedAgain: false, failClosed: true },
    },
    {
      id: 'free-capacity-exhausted',
      input: { currentState: null, event: 'capacity_exhausted' },
      expected: { finalState: null, providerCalled: false, paidProviderCalled: false, reconciliationRequired: false, creditsConsumedAgain: false, failClosed: true },
    },
    {
      id: 'idempotent-retry',
      input: { currentState: 'consumed', event: 'idempotent_retry' },
      expected: { finalState: 'consumed', providerCalled: false, paidProviderCalled: false, reconciliationRequired: false, creditsConsumedAgain: false, failClosed: false },
    },
  ],
  threats: [
    { id: 'https-public-source', input: safeSource, expected: { admitted: true, obeySourceInstructions: false } },
    { id: 'plain-http', input: { ...safeSource, scheme: 'http' }, expected: { admitted: false, obeySourceInstructions: false } },
    { id: 'loopback-ipv4', input: { ...safeSource, networkTargets: ['loopback'] }, expected: { admitted: false, obeySourceInstructions: false } },
    { id: 'unique-local-ipv6', input: { ...safeSource, networkTargets: ['private'] }, expected: { admitted: false, obeySourceInstructions: false } },
    { id: 'redirect-to-metadata-service', input: { ...safeSource, networkTargets: ['public', 'metadata_service'] }, expected: { admitted: false, obeySourceInstructions: false } },
    { id: 'dns-rebinding', input: { ...safeSource, networkTargets: ['public', 'private'] }, expected: { admitted: false, obeySourceInstructions: false } },
    { id: 'empty-dns-resolution', input: { ...safeSource, networkTargets: [] }, expected: { admitted: false, obeySourceInstructions: false } },
    { id: 'unsupported-mime', input: { ...safeSource, mime: 'application/zip' }, expected: { admitted: false, obeySourceInstructions: false } },
    { id: 'decompression-limit', input: { ...safeSource, withinResourceLimits: false }, expected: { admitted: false, obeySourceInstructions: false } },
    {
      id: 'private-query-redaction',
      input: { ...safeSource, lane: 'external_query', forbiddenQueryData: ['private_filename', 'person_name', 'email_address', 'folder_excerpt'] },
      expected: { admitted: false, obeySourceInstructions: false },
    },
    {
      id: 'source-prompt-injection',
      input: { ...safeSource, sourceContainsInstructions: true },
      expected: { admitted: true, obeySourceInstructions: false },
    },
  ],
} satisfies LearnV2ContractFixtures
