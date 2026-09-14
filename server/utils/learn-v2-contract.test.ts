import { describe, expect, test } from 'vitest'
import {
  evaluateEvidenceContract,
  evaluateMasteryContract,
  evaluateQuotaContract,
  evaluateSchedulingContract,
  evaluateThreatContract,
  isLearnV2TransitionAllowed,
  LEARN_V2_CONTRACT,
  validateLearnV2Contract,
} from '../../shared/learn-v2-contract'
import { LEARN_V2_CONTRACT_FIXTURES } from '../../tests/fixtures/learn-v2-contract'

describe('Learn Anything V2 executable contract', () => {
  test('publishes one internally consistent contract', () => {
    expect(validateLearnV2Contract(LEARN_V2_CONTRACT)).toEqual([])
    expect(LEARN_V2_CONTRACT.version).toBe('learn-v2.contract.v1')
    expect(LEARN_V2_CONTRACT.canonicalSpec).toBe('https://github.com/wescodess/budds/issues/180')
  })

  test('keeps V2 additive and rejects legacy authority', () => {
    expect(LEARN_V2_CONTRACT.isolation).toMatchObject({
      storage: 'additive',
      dualWrite: false,
      inferMasteryFromV1: false,
      inferEvidenceAcceptanceFromV1: false,
      preserveV1OnUpgrade: true,
    })
    expect(LEARN_V2_CONTRACT.vocabulary.map(entry => entry.term)).toEqual(expect.arrayContaining([
      'Learning Void',
      'Blueprint Revision',
      'Source Snapshot',
      'Claim Support',
      'Mastery Attempt',
      'Study Plan Revision',
      'Search Reservation',
      'Learn Job',
    ]))
  })

  test('defines server-authorized, revision-checked lifecycle machines', () => {
    for (const machine of Object.values(LEARN_V2_CONTRACT.stateMachines)) {
      expect(machine.authority).toBe('server')
      expect(machine.requiresExpectedRevision).toBe(true)
      expect(machine.requiresIdempotencyKey).toBe(true)
      for (const transition of machine.transitions) {
        expect(machine.states).toContain(transition.from)
        expect(machine.states).toContain(transition.to)
      }
    }

    expect(LEARN_V2_CONTRACT.stateMachines.learningVoid.transitions).toContainEqual({
      from: 'draft',
      to: 'sourcing',
    })
    expect(LEARN_V2_CONTRACT.stateMachines.blueprintRevision.transitions).not.toContainEqual({
      from: 'active',
      to: 'draft',
    })
    expect(isLearnV2TransitionAllowed('studySession', 'planned', 'missed')).toBe(false)
    expect(isLearnV2TransitionAllowed('studySession', 'planned', 'missed', 'scheduled_end_passed_without_start')).toBe(true)
    expect(isLearnV2TransitionAllowed('studySession', 'ready', 'missed', 'scheduled_end_passed_without_start')).toBe(true)
    expect(isLearnV2TransitionAllowed('learnJob', 'leased', 'queued')).toBe(false)
    expect(isLearnV2TransitionAllowed('learnJob', 'leased', 'queued', 'lease_expired_before_work')).toBe(true)
    expect(isLearnV2TransitionAllowed('studySession', 'completed', 'planned')).toBe(false)
  })

  test('proposes normalized tables with bounded owner indexes and lifecycle coverage', () => {
    const tables = LEARN_V2_CONTRACT.persistence.tables
    expect(tables.map(table => table.name)).toEqual(expect.arrayContaining([
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
    ]))

    for (const table of tables) {
      expect(table.indexes).toContainEqual({ name: 'by_userId', fields: ['userId'] })
      expect(table.queryMode).toBe('bounded')
      expect(LEARN_V2_CONTRACT.persistence.retentionClasses[table.retentionClass]).toBeDefined()
    }
    for (const retention of Object.values(LEARN_V2_CONTRACT.persistence.retentionClasses)) {
      expect(retention.folderMove).toBeTruthy()
    }
    expect(tables.map(table => table.name)).not.toContain('calendarConnections')
    expect(LEARN_V2_CONTRACT.persistence.sharedBoundaries).toContainEqual({
      name: 'calendarConnections',
      existing: true,
      reuse: 'encrypted_credentials_consent_and_disconnect',
      isolation: 'explicit_v2_reconsent_and_no_v1_calendar_event_reuse',
    })
  })

  test('assigns authoritative state to Convex and external I/O to bounded runtimes', () => {
    expect(LEARN_V2_CONTRACT.runtime.authoritativeState).toBe('convex')
    expect(LEARN_V2_CONTRACT.runtime.externalIo).toEqual(['convex_action', 'nitro_server_route', 'cloudflare_worker'])
    expect(LEARN_V2_CONTRACT.runtime.humanWaitKeepsJobOpen).toBe(false)
    expect(LEARN_V2_CONTRACT.runtime.jobs).toMatchObject({
      leaseRequired: true,
      checkpointRequired: true,
      boundedRetries: true,
      terminalReasonRequired: true,
    })
  })

  test('makes evidence publication and deletion outcomes executable fixtures', () => {
    expect(LEARN_V2_CONTRACT.evidence).toMatchObject({
      acceptedSupportRequiredForPublication: true,
      snippetsAreEvidence: false,
      unknownRightsMayPersistExcerpt: false,
      deletionCitationStatus: 'evidence_unavailable',
      deletionPreservesAttemptLedger: true,
    })
    expect(LEARN_V2_CONTRACT_FIXTURES.evidence.map(fixture => fixture.id)).toEqual([
      'accepted-atomic-support',
      'search-snippet-is-discovery-only',
      'unknown-retention-rights',
      'conflicting-support',
      'deleted-source',
    ])
    for (const fixture of LEARN_V2_CONTRACT_FIXTURES.evidence) {
      expect(evaluateEvidenceContract(fixture.input), fixture.id).toEqual(fixture.expected)
    }
  })

  test('locks mastery to server-scored, append-only attempts', () => {
    expect(LEARN_V2_CONTRACT.mastery).toMatchObject({
      authority: 'server',
      ledger: 'append_only',
      calibrationProvisionalThresholdPercent: 80,
      independentThresholdPercent: 80,
      retainedMinimumCalendarDays: 7,
      confidenceCanRaiseMastery: false,
      calibrationCanAwardRetained: false,
    })
    expect(LEARN_V2_CONTRACT.mastery.disqualifiersForIndependent).toEqual([
      'answer_reveal',
      'substantive_hint',
    ])
    expect(LEARN_V2_CONTRACT_FIXTURES.mastery.map(fixture => fixture.id)).toEqual([
      'calibration-is-provisional-only',
      'failed-calibration-starts-learning',
      'assisted-calibration-starts-learning',
      'unassisted-independent-pass',
      'hint-caps-at-guided',
      'answer-reveal-caps-at-guided',
      'retained-too-early',
      'eligible-retained-transfer',
      'failed-independent-check',
      'client-score-is-non-authoritative',
    ])
    for (const fixture of LEARN_V2_CONTRACT_FIXTURES.mastery) {
      expect(evaluateMasteryContract(fixture.input), fixture.id).toBe(fixture.expected)
    }
  })

  test('defines deterministic scheduling fixtures without implementing the engine early', () => {
    expect(LEARN_V2_CONTRACT.scheduling).toMatchObject({
      calculation: 'pure_versioned',
      defaultSessionMinutes: 25,
      minimumSessionMinutes: 15,
      maximumSessionMinutes: 60,
      bufferPercent: 15,
      retainedReviewMinimumCalendarDays: 7,
      reflowScope: 'future_incomplete_only',
    })
    expect(LEARN_V2_CONTRACT.scheduling.reflowPriority).toEqual([
      'overdue_retained_review',
      'prerequisite_remediation',
      'due_review',
      'new_learning',
      'optional_enrichment',
    ])
    expect(LEARN_V2_CONTRACT_FIXTURES.scheduling.map(fixture => fixture.id)).toEqual([
      'prerequisites-before-dependants',
      'nonexistent-dst-time',
      'repeated-dst-time',
      'infeasible-target-with-alternatives',
      'missed-session-future-only-reflow',
      'external-edit-requires-review',
      'dated-plan-reserves-capacity',
    ])
    for (const fixture of LEARN_V2_CONTRACT_FIXTURES.scheduling) {
      expect(evaluateSchedulingContract(fixture.input), fixture.id).toEqual(fixture.expected)
    }
  })

  test('locks public search to transactional zero-paid reservations', () => {
    expect(LEARN_V2_CONTRACT.quota).toMatchObject({
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
    })
    expect(LEARN_V2_CONTRACT_FIXTURES.quota.map(fixture => fixture.id)).toEqual([
      'successful-search',
      'terminal-pre-request-failure',
      'ambiguous-provider-outcome',
      'ledger-unavailable',
      'ledger-unavailable-preserves-reservation',
      'free-capacity-exhausted',
      'idempotent-retry',
    ])
    for (const fixture of LEARN_V2_CONTRACT_FIXTURES.quota) {
      expect(evaluateQuotaContract(fixture.input), fixture.id).toEqual(fixture.expected)
    }
  })

  test('makes fetch, privacy, and poisoned-source threat boundaries reviewable', () => {
    expect(LEARN_V2_CONTRACT.threats.externalQueryForbiddenData).toEqual(expect.arrayContaining([
      'folder_excerpt',
      'private_filename',
      'private_url',
      'person_name',
      'email_address',
      'account_identifier',
      'unpublished_note',
      'secret',
      'token',
    ]))
    expect(LEARN_V2_CONTRACT.threats.sourceTextTrust).toBe('untrusted_data')
    expect(LEARN_V2_CONTRACT_FIXTURES.threats.map(fixture => fixture.id)).toEqual([
      'https-public-source',
      'plain-http',
      'loopback-ipv4',
      'unique-local-ipv6',
      'redirect-to-metadata-service',
      'dns-rebinding',
      'empty-dns-resolution',
      'unsupported-mime',
      'decompression-limit',
      'private-query-redaction',
      'source-prompt-injection',
    ])
    for (const fixture of LEARN_V2_CONTRACT_FIXTURES.threats) {
      expect(evaluateThreatContract(fixture.input), fixture.id).toEqual(fixture.expected)
    }
  })

  test('reports safety-critical contract drift', () => {
    const changed = structuredClone(LEARN_V2_CONTRACT)
    changed.mastery.independentThresholdPercent = 70
    changed.quota.paidFallback = true
    changed.persistence.tables[0]!.indexes = []
    changed.runtime.humanWaitKeepsJobOpen = true
    delete (changed.stateMachines as Partial<typeof changed.stateMachines>).source

    expect(validateLearnV2Contract(changed)).toEqual(expect.arrayContaining([
      'mastery.independentThresholdPercent must be 80',
      'quota.paidFallback must be false',
      'persistence.learningVoids must define by_userId',
      'runtime.humanWaitKeepsJobOpen must be false',
      'stateMachines.source must be defined',
    ]))
  })

  test('rejects omission of unpublished notes from the public-query threat boundary', () => {
    const changed = structuredClone(LEARN_V2_CONTRACT)
    changed.threats.externalQueryForbiddenData = changed.threats.externalQueryForbiddenData
      .filter(item => item !== 'unpublished_note')

    expect(validateLearnV2Contract(changed)).toContain(
      'threats.externalQueryForbiddenData must include unpublished_note',
    )
  })
})
