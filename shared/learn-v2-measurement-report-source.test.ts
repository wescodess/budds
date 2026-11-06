import { describe, expect, it, vi } from 'vitest'
import {
  LEARN_V2_MEASUREMENT_REPORT_SOURCE_VERSION, LEARN_V2_MEASUREMENT_REPORT_VERSION, LEARN_V2_MEASUREMENT_REPORT_QUERY_VERSION,
  deriveLearnReportComputationKeys, deriveLearnReportLearnerKey, learnReportAssignmentSnapshotSchema,
  learnReportEpisodeSnapshotSchema, learnReportFirstClaimSnapshotSchema, learnReportMetricSchema, learnReportProvenanceSchema,
  reconcileLearnReportSourceRows, validateLearnReportSourcePage, validateLearnMeasurementReportCells,
} from './learn-v2-measurement-report'
import { emptyMeasurementReportCell, measurementReportIdentityFixture, measurementReportSourceFixture } from '../tests/fixtures/learn-v2-measurement-report'

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
      const reasonCodes = row.kind === 'first_check_claim'
        ? ['duplicate_claim_key', 'duplicate_source_row', 'reused_claim_basis_attempt', 'reused_first_check_opportunity'] : ['duplicate_source_row']
      expect(reconcileLearnReportSourceRows(roster, [watermark, episode, claim, row])).toEqual({ status: 'incomplete', reasonCodes })
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

  it('rejects the same original delayed outcome in both the 7- and 30-day episodes', async () => {
    const { episode, day30, watermark } = await measurementReportIdentityFixture()
    const reused = { ...day30, originalOpportunityId: episode.originalOpportunityId, delayedAcceptance: episode.delayedAcceptance, delayed: episode.delayed }
    expect(reconcileLearnReportSourceRows([watermark.learnerKey], [watermark, episode, reused])).toEqual({
      status: 'incomplete', reasonCodes: ['reused_outcome_identity'],
    })
  })

  it.each(['horizon', 'assignment'] as const)('owns every delayed and replacement identity within one episode across %s rows', async scope => {
    const { episode, day30, otherAssignment, watermark } = await measurementReportIdentityFixture()
    const other = scope === 'horizon' ? day30 : otherAssignment
    const slots = [
      { opportunity: 'originalOpportunityId', acceptance: 'delayedAcceptance', result: 'delayed' },
      { opportunity: 'replacementOpportunityId', acceptance: 'replacementAcceptance', result: 'replacement' },
    ] as const
    expect(reconcileLearnReportSourceRows([watermark.learnerKey], [watermark, episode, other]).status).toBe('complete')
    for (const source of slots) {
      for (const target of slots) {
        for (const identity of ['opportunity', 'submissionId', 'attemptId', 'executionId'] as const) {
          const row = structuredClone(other)
          if (identity === 'opportunity') row[target.opportunity] = episode[source.opportunity]
          else if (identity === 'submissionId') {
            row[target.acceptance]!.submissionId = episode[source.acceptance]!.submissionId
            row[target.result]!.submissionId = episode[source.result]!.submissionId
          }
          else if (identity === 'attemptId') row[target.result]!.attemptId = episode[source.result]!.attemptId
          else row[target.result]!.executionId = episode[source.result]!.executionId
          for (const rows of [[watermark, episode, row], [row, episode, watermark]]) {
            const reconciled = reconcileLearnReportSourceRows([watermark.learnerKey], rows)
            expect(reconciled.status, `${source.result}/${target.result}/${identity}`).toBe('incomplete')
            expect(reconciled.reasonCodes, `${source.result}/${target.result}/${identity}`).toContain('reused_outcome_identity')
          }
        }
      }
    }
  })

  it.each(['opportunity', 'submissionId', 'attemptId', 'executionId'] as const)('owns a cold %s within one assignment', async identity => {
    const { episode, otherAssignment, watermark } = await measurementReportIdentityFixture()
    const row = structuredClone(otherAssignment)
    if (identity === 'opportunity') row.coldOpportunityId = episode.coldOpportunityId
    else if (identity === 'submissionId') {
      row.coldAcceptance!.submissionId = episode.coldAcceptance!.submissionId
      row.cold!.submissionId = episode.cold!.submissionId
    }
    else if (identity === 'attemptId') row.cold!.attemptId = episode.cold!.attemptId
    else row.cold!.executionId = episode.cold!.executionId
    expect(reconcileLearnReportSourceRows([watermark.learnerKey], [watermark, episode, row]).reasonCodes).toContain('reused_outcome_identity')
  })

  it('rejects even identical cold snapshots under another assignment', async () => {
    const { episode, otherAssignment, watermark } = await measurementReportIdentityFixture()
    const row = { ...otherAssignment, coldOpportunityId: episode.coldOpportunityId, coldAcceptance: episode.coldAcceptance, cold: episode.cold }
    expect(reconcileLearnReportSourceRows([watermark.learnerKey], [watermark, episode, row])).toEqual({
      status: 'incomplete', reasonCodes: ['reused_outcome_identity'],
    })
  })

  it.each([false, true])('allows identical cold snapshots across horizons, scored=%s', async scored => {
    const { episode, day30, watermark } = await measurementReportIdentityFixture()
    const rows = [watermark, { ...episode, cold: scored ? episode.cold : null }, { ...day30, cold: scored ? day30.cold : null }]
    expect(reconcileLearnReportSourceRows([watermark.learnerKey], rows)).toEqual({ status: 'complete', reasonCodes: [] })
  })

  it.each(['opportunity', 'acceptance', 'result', 'unscored'] as const)('rejects conflicting cross-horizon cold %s snapshots', async changed => {
    const { episode, day30, watermark } = await measurementReportIdentityFixture()
    const row = structuredClone(day30)
    if (changed === 'opportunity') row.coldOpportunityId = 'anotherColdOpportunity' as typeof row.coldOpportunityId
    if (changed === 'acceptance') {
      row.coldAcceptance!.acceptedAt += 1
      row.cold!.acceptedAt += 1
    }
    if (changed === 'result') row.cold!.scorePercent = 100
    if (changed === 'unscored') row.cold = null
    expect(reconcileLearnReportSourceRows([watermark.learnerKey], [watermark, episode, row])).toEqual({
      status: 'incomplete', reasonCodes: ['conflicting_assignment_snapshot', 'conflicting_outcome_snapshot'],
    })
  })

  it('rejects an episode score of 40 and first-check claim score of 100 for the same outcome', async () => {
    const { episode, claim, delayed, watermark } = await measurementReportIdentityFixture()
    const conflicting = { ...claim, result: { ...delayed, scorePercent: 100 } }
    for (const rows of [[watermark, episode, conflicting], [conflicting, episode, watermark]]) {
      expect(reconcileLearnReportSourceRows([watermark.learnerKey], rows)).toEqual({
        status: 'incomplete', reasonCodes: ['conflicting_outcome_snapshot'],
      })
    }
  })

  it.each(['submissionId', 'attemptId', 'executionId'] as const)('reconciles shared %s snapshots independently of the opportunity identity', async identity => {
    const { episode, claim, delayed, watermark } = await measurementReportIdentityFixture()
    const result = { ...delayed, submissionId: 'claimSubmission', attemptId: 'claimAttempt', executionId: 'claimExecution', scorePercent: 100 }
    result[identity] = delayed[identity]
    const row = learnReportFirstClaimSnapshotSchema.parse({ ...claim, firstCheckOpportunityId: 'claimOpportunity', result,
      acceptance: { submissionId: result.submissionId, acceptedAt: result.acceptedAt } })
    expect(reconcileLearnReportSourceRows([watermark.learnerKey], [watermark, episode, row])).toEqual({
      status: 'incomplete', reasonCodes: ['conflicting_outcome_snapshot'],
    })
  })

  it.each(['unanswered', 'unscored', 'scored'] as const)('allows a first check to share the original delayed slot with identical %s snapshots', async state => {
    const { episode, claim, watermark } = await measurementReportIdentityFixture()
    const acceptance = state === 'unanswered' ? null : episode.delayedAcceptance
    const result = state === 'scored' ? episode.delayed : null
    const shared = { ...claim, acceptance, result, stateAtAcceptance: acceptance ? claim.stateAtAcceptance : null }
    const rows = [watermark, { ...episode, delayedAcceptance: acceptance, delayed: result }, shared]
    const saved = structuredClone(rows)
    for (const order of [rows, [...rows].reverse()]) {
      expect(reconcileLearnReportSourceRows([watermark.learnerKey], order)).toEqual({ status: 'complete', reasonCodes: [] })
    }
    expect(rows).toEqual(saved)
  })

  it.each(['acceptance', 'submission', 'unanswered', 'unscored'] as const)('requires a shared first opportunity to agree on its %s snapshot', async changed => {
    const { episode, claim, delayed, watermark } = await measurementReportIdentityFixture()
    const row = learnReportFirstClaimSnapshotSchema.parse({ ...claim, result: delayed })
    if (changed === 'acceptance') {
      row.acceptance!.acceptedAt += 1
      row.result!.acceptedAt += 1
    }
    if (changed === 'submission') {
      row.acceptance!.submissionId = 'anotherSubmission' as typeof delayed.submissionId
      row.result!.submissionId = row.acceptance!.submissionId
      row.result!.attemptId = 'anotherAttempt' as typeof delayed.attemptId
      row.result!.executionId = 'anotherExecution' as typeof delayed.executionId
    }
    if (changed === 'unscored' || changed === 'unanswered') row.result = null
    if (changed === 'unanswered') { row.acceptance = null; row.stateAtAcceptance = null }
    expect(reconcileLearnReportSourceRows([watermark.learnerKey], [watermark, episode, row])).toEqual({
      status: 'incomplete', reasonCodes: ['conflicting_outcome_snapshot'],
    })
  })

  it('rejects a claim repeated under a key derived for another capability', async () => {
    const { claim, watermark } = await measurementReportSourceFixture()
    const keys = await deriveLearnReportComputationKeys({ reportRunId: 'run1', ownerTokenIdentifier: 'https://fixture.example|owner',
      blueprintRevisionId: 'blueprint1', objectiveId: 'objective2' })
    expect(keys.capabilityKey).not.toBe(claim.capabilityKey)
    expect(reconcileLearnReportSourceRows([watermark.learnerKey], [watermark, claim, { ...claim, ...keys }])).toEqual({
      status: 'incomplete', reasonCodes: ['duplicate_claim_key', 'reused_claim_basis_attempt', 'reused_first_check_opportunity'],
    })
  })

  it.each(['claimKey', 'basisAttemptId', 'firstCheckOpportunityId'] as const)('enforces run-wide %s uniqueness independently of capability, owner and epoch', async identity => {
    const { claim, watermark } = await measurementReportSourceFixture()
    const reason = { claimKey: 'duplicate_claim_key', basisAttemptId: 'reused_claim_basis_attempt', firstCheckOpportunityId: 'reused_first_check_opportunity' }[identity]
    for (const ownerTokenIdentifier of ['https://fixture.example|owner', 'https://fixture.example|other-owner']) {
      const keys = await deriveLearnReportComputationKeys({ reportRunId: 'run1', ownerTokenIdentifier, blueprintRevisionId: 'blueprint1', objectiveId: 'objective2' })
      const row = learnReportFirstClaimSnapshotSchema.parse({ ...claim, ...keys, stratum: { ...claim.stratum, epoch: 'epoch.v2' },
        claim: { ...claim.claim, claimKey: 'anotherClaim', basisAttemptId: 'anotherBasisAttempt' },
        firstCheckOpportunityId: 'anotherFirstOpportunity', acceptance: null, stateAtAcceptance: null })
      const roster = [...new Set([watermark.learnerKey, keys.learnerKey])]
      const rows = roster.map(learnerKey => ({ ...watermark, learnerKey }))
      expect(reconcileLearnReportSourceRows(roster, [...rows, claim, row])).toEqual({ status: 'complete', reasonCodes: [] })
      if (identity === 'firstCheckOpportunityId') {
        row.firstCheckOpportunityId = claim.firstCheckOpportunityId
        row.acceptance = claim.acceptance
        row.stateAtAcceptance = claim.stateAtAcceptance
      }
      else if (identity === 'claimKey') row.claim.claimKey = claim.claim.claimKey
      else row.claim.basisAttemptId = claim.claim.basisAttemptId
      for (const order of [[...rows, claim, row], [...rows, row, claim]]) {
        expect(reconcileLearnReportSourceRows(roster, order)).toEqual({ status: 'incomplete', reasonCodes: [reason] })
      }
    }
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
