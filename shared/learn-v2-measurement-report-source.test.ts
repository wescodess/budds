import { describe, expect, it, vi } from 'vitest'
import {
  LEARN_V2_MEASUREMENT_REPORT_SOURCE_VERSION, LEARN_V2_MEASUREMENT_REPORT_VERSION, LEARN_V2_MEASUREMENT_REPORT_QUERY_VERSION,
  deriveLearnReportComputationKeys, deriveLearnReportLearnerKey, learnReportAssignmentSnapshotSchema,
  learnReportEpisodeSnapshotSchema, learnReportFirstClaimSnapshotSchema, learnReportMetricSchema, learnReportProvenanceSchema,
  reconcileLearnReportSourceRows, validateLearnReportSourcePage, validateLearnMeasurementReportCells,
} from './learn-v2-measurement-report'
import { emptyMeasurementReportCell, measurementReportSourceFixture } from '../tests/fixtures/learn-v2-measurement-report'

describe('report source v3 computation contract', () => {
  it('changes only the source version and rejects prior envelopes', async () => {
    expect(LEARN_V2_MEASUREMENT_REPORT_SOURCE_VERSION).toBe('learn-v2.measurement-report-source.v3')
    expect(LEARN_V2_MEASUREMENT_REPORT_VERSION).toBe('learn-v2.measurement-report.v3')
    expect(LEARN_V2_MEASUREMENT_REPORT_QUERY_VERSION).toBe('learn-v2.measurement-report-query.v1')
    const { episode, claim, watermark } = await measurementReportSourceFixture()
    const page = { version: LEARN_V2_MEASUREMENT_REPORT_SOURCE_VERSION, reportRunId: 'run1', sequence: 0, sourceWatermark: 1,
      rows: [watermark, episode, claim], cursor: null, isDone: true }
    expect(validateLearnReportSourcePage(page).rows).toEqual(page.rows)
    for (const version of ['learn-v2.measurement-report-source.v1', 'learn-v2.measurement-report-source.v2']) {
      expect(() => validateLearnReportSourcePage({ ...page, version })).toThrow()
    }
    for (const row of page.rows) {
      const { learnerKey: _learner, ...withoutLearner } = row
      expect(() => validateLearnReportSourcePage({ ...page, rows: [withoutLearner] })).toThrow()
      if (row.kind !== 'owner_watermark') {
        const { capabilityKey: _capability, ...withoutCapability } = row
        expect(() => validateLearnReportSourcePage({ ...page, rows: [withoutCapability] })).toThrow()
      }
      expect(() => validateLearnReportSourcePage({ ...page, rows: [{ ...row, learnerKey: 'raw-owner' }] })).toThrow()
    }
    expect(watermark).not.toHaveProperty('capabilityKey')
    expect(() => validateLearnReportSourcePage({ ...page, rows: [{ ...watermark, capabilityKey: null }] })).toThrow()
  })

  it('derives stable keys from the run, full owner identity and settled mastery scope', async () => {
    const input = { reportRunId: 'run1', ownerTokenIdentifier: 'https://fixture.example|owner', blueprintRevisionId: 'blueprint1', objectiveId: 'objective1' }
    const keys = await deriveLearnReportComputationKeys(input)
    expect(keys).toEqual({ learnerKey: 'sha256:f9c68df6787fb689637017ad62f83359127b3362db96523068f99b1a5d2bbec1',
      capabilityKey: 'sha256:ba6b909fcee98a8d6e04c403b8e955a20ef8a9906f61222985295c8eca48968f' })
    expect(await deriveLearnReportComputationKeys(input)).toEqual(keys)
    expect(await deriveLearnReportLearnerKey(input.reportRunId, input.ownerTokenIdentifier)).toBe(keys.learnerKey)
    const otherCapability = await deriveLearnReportComputationKeys({ ...input, objectiveId: 'objective2' })
    expect(otherCapability.learnerKey).toBe(keys.learnerKey)
    expect(otherCapability.capabilityKey).not.toBe(keys.capabilityKey)
    for (const change of [{ reportRunId: 'run2' }, { ownerTokenIdentifier: 'https://other-issuer.example|owner' }]) {
      const other = await deriveLearnReportComputationKeys({ ...input, ...change })
      expect(other.learnerKey).not.toBe(keys.learnerKey)
      expect(other.capabilityKey).not.toBe(keys.capabilityKey)
    }
  })

  it.each(['keyed', 'numeric', 'ordered', 'bounded_rubric'])('stratifies unanswered %s episodes from frozen assignment pins', async responseKind => {
    const { episode } = await measurementReportSourceFixture()
    const unanswered = learnReportEpisodeSnapshotSchema.parse({ ...episode, coldAcceptance: null, delayedAcceptance: null,
      assignment: { ...episode.assignment, responseKind }, disposition: 'missing_cold' })
    expect(unanswered.assignment.responseKind).toBe(responseKind)
    expect(unanswered.assignment.scorerConfiguration).toEqual(episode.assignment.scorerConfiguration)
    expect(unanswered.cold).toBeNull()
    expect(unanswered.delayed).toBeNull()
  })

  it('permits absent strata only before protocol freeze and never derives a starting band from absence', async () => {
    const { episode } = await measurementReportSourceFixture()
    expect(learnReportAssignmentSnapshotSchema.safeParse({ ...episode.assignment, responseKind: null, scorerConfiguration: null }).success).toBe(false)
    expect(learnReportAssignmentSnapshotSchema.safeParse({ ...episode.assignment, responseKind: null }).success).toBe(false)
    expect(learnReportAssignmentSnapshotSchema.safeParse({ ...episode.assignment, scorerConfiguration: null }).success).toBe(false)
    const unfrozen = { ...episode, assignment: { ...episode.assignment, protocolVersion: null, responseKind: null, scorerConfiguration: null }, replacementPolicy: null }
    expect(learnReportEpisodeSnapshotSchema.parse(unfrozen).assignment.scorerConfiguration).toBeNull()
    expect(episode.assignment).not.toHaveProperty('startingBand')
  })

  it.each(['flow', 'entryPoint', 'epoch', 'baselineSha', 'cohortVersion', 'depth', 'familyId', 'familyRevision',
    'familyValidationStatus', 'equivalenceVersion', 'responseKind', 'scorerConfiguration'])('requires the first-slot frozen %s without an outcome', async field => {
    const { claim } = await measurementReportSourceFixture()
    expect(learnReportFirstClaimSnapshotSchema.parse(claim).result).toBeNull()
    const stratum = { ...claim.stratum }
    Reflect.deleteProperty(stratum, field)
    expect(learnReportFirstClaimSnapshotSchema.safeParse({ ...claim, stratum }).success).toBe(false)
  })

  it('keeps ordinary V2 first checks without a measurement family and retains acceptance before any result', async () => {
    const { claim } = await measurementReportSourceFixture()
    const ordinary = learnReportFirstClaimSnapshotSchema.parse({ ...claim, stratum: { ...claim.stratum,
      familyId: null, familyRevision: null, familyValidationStatus: 'unknown', equivalenceVersion: null } })
    expect(ordinary.acceptance).toEqual(claim.acceptance)
    expect(ordinary.result).toBeNull()
    expect(learnReportFirstClaimSnapshotSchema.parse({ ...ordinary, acceptance: null, stateAtAcceptance: null, unresolvedReason: 'missing_delayed' }).acceptance).toBeNull()
    expect(learnReportFirstClaimSnapshotSchema.safeParse({ ...ordinary, stateAtAcceptance: null }).success).toBe(false)
  })

  it.each(['cold', 'delayed', 'replacement', 'claim'] as const)('requires the accepted submission and server time for every %s result', async endpoint => {
    const { episode, claim, cold, delayed } = await measurementReportSourceFixture()
    if (endpoint === 'claim') {
      const scored = { ...claim, result: delayed }
      expect(learnReportFirstClaimSnapshotSchema.parse(scored).result).toEqual(delayed)
      for (const acceptance of [null, { ...claim.acceptance, submissionId: 'differentSubmission' }, { ...claim.acceptance, acceptedAt: delayed.acceptedAt + 1 }]) {
        expect(learnReportFirstClaimSnapshotSchema.safeParse({ ...scored, acceptance }).success).toBe(false)
      }
      return
    }
    const result = endpoint === 'cold' ? cold : delayed
    const acceptanceKey = endpoint === 'cold' ? 'coldAcceptance' : endpoint === 'delayed' ? 'delayedAcceptance' : 'replacementAcceptance'
    const scored = endpoint === 'replacement'
      ? { ...episode, delayedAcceptance: null, replacementOpportunityId: 'replacementOpportunity1', replacementAcceptance: episode.delayedAcceptance, replacement: result }
      : { ...episode, [endpoint]: result }
    expect(learnReportEpisodeSnapshotSchema.parse(scored)[endpoint]).toEqual(result)
    for (const acceptance of [null, { submissionId: 'differentSubmission', acceptedAt: result.acceptedAt }, { submissionId: result.submissionId, acceptedAt: result.acceptedAt + 1 }]) {
      expect(learnReportEpisodeSnapshotSchema.safeParse({ ...scored, [acceptanceKey]: acceptance }).success).toBe(false)
    }
  })

  it('retains assisted and invalid accepted responses and late score commits without changing performance time', async () => {
    const { episode, cold, delayed, claim } = await measurementReportSourceFixture()
    const invalid = { ...delayed, assistanceState: 'assisted', validityStatus: 'excluded', exclusionReasons: ['assisted'], measurementEligible: false }
    const scored = learnReportEpisodeSnapshotSchema.parse({ ...episode, cold, delayed: invalid, disposition: 'assisted_contaminated' })
    expect(scored.delayedAcceptance).toEqual(episode.delayedAcceptance)
    expect(scored.delayed!.scoreCommittedAt).toBeGreaterThan(episode.clock!.closeAt)
    expect(scored.delayed!.acceptedAt).toBeLessThan(episode.clock!.closeAt)
    expect(learnReportFirstClaimSnapshotSchema.parse({ ...claim, result: invalid }).acceptance).toEqual(claim.acceptance)
    expect(learnReportEpisodeSnapshotSchema.parse(episode).delayedAcceptance).not.toBeNull()
    expect(learnReportEpisodeSnapshotSchema.parse(episode).delayed).toBeNull()
  })

  it('retains a linked secondary replacement and validates any predeclared protocol pin', async () => {
    const { episode, cold, delayed } = await measurementReportSourceFixture()
    const replacementAcceptance = { submissionId: 'replacementSubmission1', acceptedAt: delayed.acceptedAt + 1 }
    const replacement = { ...delayed, ...replacementAcceptance, attemptId: 'replacementAttempt1', executionId: 'replacementExecution1',
      scorePercent: 100, caseId: 'caseD', itemId: 'itemD', formLabel: 'D' }
    const linked = { ...episode, cold, delayed, replacementOpportunityId: 'replacementOpportunity1', replacementAcceptance, replacement }
    const parsed = learnReportEpisodeSnapshotSchema.parse(linked)
    expect(parsed.delayed!.scorePercent).toBe(40)
    expect(parsed.replacement!.scorePercent).toBe(100)
    expect(parsed.replacementPolicy).toEqual({ kind: 'secondary_only' })
    expect(learnReportEpisodeSnapshotSchema.parse({ ...linked, replacement: null }).replacementAcceptance).toEqual(replacementAcceptance)
    const predeclared = { kind: 'predeclared', protocolVersion: 'protocol.v1', ruleVersion: 'replacement.v1', ruleDigest: 'b'.repeat(64) }
    expect(learnReportEpisodeSnapshotSchema.parse({ ...linked, replacementPolicy: predeclared }).replacementPolicy).toEqual(predeclared)
    for (const change of [
      { replacementOpportunityId: null }, { originalOpportunityId: null }, { replacementOpportunityId: episode.originalOpportunityId },
      { replacementPolicy: null }, { replacementPolicy: { kind: 'predeclared', protocolVersion: 'protocol.v1' } },
      { replacementPolicy: { ...predeclared, protocolVersion: 'another.protocol' } }, { replacement: cold },
      { replacementAcceptance: episode.delayedAcceptance, replacement: delayed },
    ]) expect(learnReportEpisodeSnapshotSchema.safeParse({ ...linked, ...change }).success).toBe(false)
  })

  it('rejects endpoint kind, horizon and opportunity mismatches', async () => {
    const { episode, cold, delayed, claim } = await measurementReportSourceFixture()
    for (const change of [{ cold: delayed }, { delayed: cold }, { horizonDays: 30 }, { coldOpportunityId: null },
      { originalOpportunityId: null }, { coldOpportunityId: episode.originalOpportunityId }]) {
      expect(learnReportEpisodeSnapshotSchema.safeParse({ ...episode, ...change }).success).toBe(false)
    }
    expect(learnReportFirstClaimSnapshotSchema.safeParse({ ...claim, result: cold }).success).toBe(false)
  })

  it('reconciles the full roster, including owners with no episode and missing watermarks', async () => {
    const { episode, claim, watermark } = await measurementReportSourceFixture()
    const absentOwner = await deriveLearnReportLearnerKey('run1', 'another-owner')
    const roster = [watermark.learnerKey, absentOwner]
    expect(reconcileLearnReportSourceRows(roster, [episode, claim, watermark])).toEqual({ status: 'incomplete', reasonCodes: ['missing_owner_watermark'] })
    expect(reconcileLearnReportSourceRows(roster, [episode, claim, watermark, { ...watermark, learnerKey: absentOwner }])).toEqual({ status: 'complete', reasonCodes: [] })
    expect(reconcileLearnReportSourceRows([], [watermark])).toEqual({ status: 'incomplete', reasonCodes: ['owner_outside_roster'] })
    expect(reconcileLearnReportSourceRows([watermark.learnerKey, watermark.learnerKey], [watermark]).status).toBe('incomplete')
  })

  it('marks duplicates and conflicts across source pages incomplete instead of discarding them', async () => {
    const { episode, claim, watermark, delayed } = await measurementReportSourceFixture()
    const roster = [watermark.learnerKey]
    for (const row of [watermark, episode, claim]) {
      expect(reconcileLearnReportSourceRows(roster, [watermark, episode, claim, row])).toEqual({ status: 'incomplete', reasonCodes: ['duplicate_source_row'] })
    }
    for (const row of [{ ...watermark, sequence: 2 }, { ...episode, delayed }, { ...episode, capabilityKey: `sha256:${'b'.repeat(64)}` },
      { ...claim, claim: { ...claim.claim, claimKey: 'laterClaim', claimSequence: 2 } }]) {
      expect(reconcileLearnReportSourceRows(roster, [watermark, episode, claim, row]).reasonCodes).toContain('conflicting_source_row')
    }
    const day30 = { ...episode, horizonDays: 30 as const, clock: { ...episode.clock!, horizonDays: 30 as const },
      originalOpportunityId: 'day30Opportunity' as typeof episode.originalOpportunityId, delayedAcceptance: null }
    expect(reconcileLearnReportSourceRows(roster, [watermark, episode, claim, day30])).toEqual({ status: 'complete', reasonCodes: [] })
  })

  it('rejects varying capability keys within a run and conflicting assignment pins across horizons', async () => {
    const { episode, watermark } = await measurementReportSourceFixture()
    const otherEpisode = learnReportEpisodeSnapshotSchema.parse({ ...episode, assignmentId: 'assignment2',
      capabilityKey: `sha256:${'b'.repeat(64)}` })
    expect(reconcileLearnReportSourceRows([watermark.learnerKey], [watermark, episode, otherEpisode]).reasonCodes).toContain('conflicting_capability_key')
    const day30 = learnReportEpisodeSnapshotSchema.parse({ ...episode, horizonDays: 30, clock: null,
      assignment: { ...episode.assignment, depth: 'advanced' } })
    expect(reconcileLearnReportSourceRows([watermark.learnerKey], [watermark, episode, day30]).reasonCodes).toContain('conflicting_assignment_snapshot')
  })

  it('keeps computation keys out of cells, safe manifests, validation logs and reconciliation diagnostics', async () => {
    const spies = [vi.spyOn(console, 'log'), vi.spyOn(console, 'info'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')]
    try {
      const { episode, watermark, keys } = await measurementReportSourceFixture()
      const cell = emptyMeasurementReportCell()
      const page = { version: LEARN_V2_MEASUREMENT_REPORT_VERSION, reportRunId: 'run1', cells: [cell], cursor: null, isDone: true }
      const provenance = { kind: 'aggregate_snapshot', sourceVersion: LEARN_V2_MEASUREMENT_REPORT_SOURCE_VERSION,
        queryVersion: LEARN_V2_MEASUREMENT_REPORT_QUERY_VERSION, adapterVersion: 'adapter.v1', codeVersion: 'code.v1',
        rosterDigest: 'a'.repeat(64), inputDigest: 'b'.repeat(64), cutoff: 2, extractionStartedAt: 2, extractionEndedAt: 3,
        sourceCoverage: 'complete', episodeCount: 1, inputBytes: 1024, bootstrapSeed: 'c'.repeat(64), bootstrapReplicates: 10000 }
      for (const [name, key] of Object.entries(keys)) {
        expect(() => learnReportMetricSchema.parse({ ...cell, [name]: key })).toThrow()
        expect(() => learnReportMetricSchema.parse({ ...cell, stratum: { ...cell.stratum, [name]: key } })).toThrow()
        expect(() => validateLearnMeasurementReportCells({ ...page, [name]: key })).toThrow()
        expect(() => learnReportProvenanceSchema.parse({ ...provenance, [name]: key })).toThrow()
      }
      const diagnostics = reconcileLearnReportSourceRows([watermark.learnerKey], [episode, episode])
      const outputs = JSON.stringify([validateLearnMeasurementReportCells(page), learnReportProvenanceSchema.parse(provenance), diagnostics])
      for (const key of Object.values(keys)) expect(outputs).not.toContain(key)
      for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    }
    finally { for (const spy of spies) spy.mockRestore() }
  })
})
