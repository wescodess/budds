import { describe, expect, it } from 'vitest'
import {
  LEARN_V2_FIRST_INDEPENDENT_CLAIM_VERSION, LEARN_V2_MEASUREMENT_REPORT_SOURCE_VERSION,
  learnReportFactPayloadSchema, learnReportFactSchema, learnReportIndependentClaimV2Schema,
  learnReportFirstSlotLinkSchema, learnReportLinkedFirstSlotSchema, resolveLearnReportFirstSlotV2,
  learnReportInputSnapshotSchema, validateLearnReportSourcePage, reconcileLearnReportSourceRows, reconcileLearnReportFirstClaims,
} from './learn-v2-measurement-report'
import { measurementReportIdentityFixture } from '../tests/fixtures/learn-v2-measurement-report'

const NOW = Date.parse('2027-03-07T17:00:00Z')
function fixture() {
  const stratum = { epoch: 'epoch.v1', baselineSha: 'b'.repeat(40), cohortVersion: 'cohort.v1',
    flow: 'v2_today', entryPoint: 'retained_check', depth: 'working' }
  const claim = learnReportIndependentClaimV2Schema.parse({ kind: 'independent_claim_v2', version: LEARN_V2_FIRST_INDEPENDENT_CLAIM_VERSION,
    claimKey: 'first-independent', claimSequence: 1, basisAttemptId: 'basis', masteryRecordRevision: 2,
    firstIndependentAt: NOW, firstIndependentLocalDate: '2027-03-07', firstIndependentTimezone: 'America/Toronto',
    transitionVersion: 'learn-v2.mastery-transition.v1', claimFactSequence: 1, blueprintRevisionId: 'blueprint', objectiveId: 'objective', stratum,
    policyPins: { assistancePolicyVersion: 'learn-v2.assistance.session-wide.v1', validityPolicyVersion: 'learn-v2.assessment-validity.v1',
      thresholdVersion: 'learn-v2.mastery-threshold.v1', thresholdPercent: 80 }, firstSlot: { kind: 'unresolved', reason: 'no_qualifying_delayed_slot' } })
  const slot = learnReportLinkedFirstSlotSchema.parse({ kind: 'linked', firstCheckOpportunityId: 'firstSlot', checkSequence: 1, linkedAt: NOW,
    clock: { protocolVersion: 'protocol.v1', schedulingPolicyVersion: 'schedule.v1', anchorKind: 'first_independent', anchorEventId: 'basis',
      anchorAt: NOW, horizonDays: 7, timezone: 'America/Toronto', dueLocalDate: '2027-03-14',
      dueAt: Date.parse('2027-03-14T16:00:00Z'), openAt: Date.parse('2027-03-14T05:00:00Z'), closeAt: Date.parse('2027-03-15T04:00:00Z') },
    stratum: { ...stratum, familyId: null, familyRevision: null, familyValidationStatus: 'unknown', equivalenceVersion: null,
      responseKind: 'bounded_rubric', scorerConfiguration: { scoringKind: 'model', configurationDigest: 'a'.repeat(64), scorerVersion: 'learn-v2.mastery-scorer.v1' } } })
  const link = learnReportFirstSlotLinkSchema.parse({ kind: 'first_slot_link', version: LEARN_V2_FIRST_INDEPENDENT_CLAIM_VERSION,
    claimKey: claim.claimKey, claimSequence: 1, claimFactSequence: 1, slot })
  const envelope = { factVersion: LEARN_V2_MEASUREMENT_REPORT_SOURCE_VERSION, epoch: stratum.epoch, occurredAt: NOW }
  return { claim, slot, link, claimFact: { ...envelope, sequence: 1, fact: claim }, linkFact: { ...envelope, sequence: 2, fact: link } }
}

describe('first Independent claim v2', () => {
  it('preserves an unresolved ordinary V2 claim without inventing assessment or scorer pins', () => {
    const { claim, claimFact } = fixture()
    expect(learnReportFactSchema.parse(claimFact)).toEqual(claimFact)
    expect(resolveLearnReportFirstSlotV2(claimFact)).toEqual(claim)
    expect(claim.firstSlot).toEqual({ kind: 'unresolved', reason: 'no_qualifying_delayed_slot' })
    expect(claim.stratum).not.toHaveProperty('familyId')
    expect(claim.stratum).not.toHaveProperty('scorerConfiguration')
  })

  it('requires an explicit unresolved reason, complete anchor and policy pins', () => {
    const { claim } = fixture()
    for (const field of ['firstIndependentAt', 'firstIndependentLocalDate', 'firstIndependentTimezone', 'basisAttemptId', 'masteryRecordRevision', 'policyPins']) {
      const missing = { ...claim }
      Reflect.deleteProperty(missing, field)
      expect(learnReportFactPayloadSchema.safeParse(missing).success, field).toBe(false)
    }
    for (const firstSlot of [{ kind: 'unresolved' }, { kind: 'unresolved', reason: '' }, { kind: 'unresolved', reason: 'private prose' }, null]) {
      expect(learnReportFactPayloadSchema.safeParse({ ...claim, firstSlot }).success).toBe(false)
    }
    expect(learnReportFactPayloadSchema.safeParse({ ...claim, firstIndependentLocalDate: '2027-03-08' }).success).toBe(false)
    expect(learnReportFactPayloadSchema.safeParse({ ...claim, claimSequence: 2 }).success).toBe(false)
    expect(learnReportFactPayloadSchema.safeParse({ ...claim, version: 'learn-v2.first-independent-claim.v1' }).success).toBe(false)
    expect(learnReportFactPayloadSchema.safeParse({ ...claim, policyPins: { ...claim.policyPins, thresholdPercent: 79 } }).success).toBe(false)
  })

  it('parses legacy claims unchanged and supports both initial and appended links', () => {
    const { claim, slot, link, claimFact, linkFact } = fixture()
    const { kind: _kind, version: _version, blueprintRevisionId: _blueprint, objectiveId: _objective,
      policyPins: _policy, firstSlot: _firstSlot, stratum: _stratum, ...basis } = claim
    const legacy = { ...basis, kind: 'independent_claim', firstCheckOpportunityId: slot.firstCheckOpportunityId, checkSequence: 1, stratum: slot.stratum }
    expect(learnReportFactPayloadSchema.parse(legacy)).toEqual(legacy)
    expect(learnReportFactPayloadSchema.parse(link)).toEqual(link)
    expect(resolveLearnReportFirstSlotV2(claimFact, linkFact).firstSlot).toEqual(slot)
    expect(resolveLearnReportFirstSlotV2({ ...claimFact, fact: { ...claim, firstSlot: slot } }).firstSlot).toEqual(slot)
    expect(() => resolveLearnReportFirstSlotV2({ ...claimFact, fact: { ...claim, firstSlot: slot } }, linkFact)).toThrow()
    expect(claimFact.fact.firstSlot.kind).toBe('unresolved')
  })

  it('applies seven local calendar days across DST instead of 168 hours', () => {
    const { claimFact, linkFact, slot } = fixture()
    expect(slot.clock.dueAt - NOW).toBe(167 * 3_600_000)
    expect(resolveLearnReportFirstSlotV2(claimFact, linkFact).firstSlot.kind).toBe('linked')
    const early = { ...slot, clock: { ...slot.clock, openAt: slot.clock.openAt - 1 } }
    expect(() => resolveLearnReportFirstSlotV2(claimFact, { ...linkFact, fact: { ...linkFact.fact, slot: early } })).toThrow()
  })

  it.each([0, 1, 86_400_000])('accepts an honest late link at closeAt plus %s without moving the original clock', offset => {
    const { claim, slot, claimFact, linkFact } = fixture()
    const linkedAt = slot.clock.closeAt + offset
    const late = { ...slot, linkedAt }
    const appended = resolveLearnReportFirstSlotV2(claimFact, { ...linkFact, occurredAt: linkedAt, fact: { ...linkFact.fact, slot: late } })
    const initial = resolveLearnReportFirstSlotV2({ ...claimFact, occurredAt: linkedAt, fact: { ...claim, firstSlot: late } })
    expect(appended.firstSlot).toEqual(late)
    expect(initial.firstSlot).toEqual(late)
    expect(appended.firstSlot.kind === 'linked' && appended.firstSlot.clock).toEqual(slot.clock)
  })

  it.each(['claimKey', 'claimSequence', 'claimFactSequence', 'epoch', 'sequence', 'occurredAt', 'stratum'] as const)(
    'rejects a link with conflicting %s', field => {
      const { claimFact, linkFact } = fixture()
      const candidate = structuredClone(linkFact)
      if (field === 'claimKey') candidate.fact.claimKey = 'another-claim'
      if (field === 'claimSequence') Reflect.set(candidate.fact, field, 2)
      if (field === 'claimFactSequence') candidate.fact.claimFactSequence = 2
      if (field === 'epoch') candidate.epoch = 'epoch.v2'
      if (field === 'sequence') candidate.sequence = 1
      if (field === 'occurredAt') candidate.occurredAt++
      if (field === 'stratum') candidate.fact.slot.stratum.flow = 'v2_canvas'
      expect(() => resolveLearnReportFirstSlotV2(claimFact, candidate)).toThrow()
    },
  )
})

describe('normalized first Independent claims', () => {
  function normalizedFixture() {
    const f = fixture()
    const { kind: _kind, version, blueprintRevisionId: _blueprint, objectiveId: _objective,
      policyPins, firstSlot, stratum, ...claim } = f.claim
    const learnerKey = `sha256:${'c'.repeat(64)}`
    const capabilityKey = `sha256:${'d'.repeat(64)}`
    const row = { kind: 'first_check_claim_v2' as const, version, learnerKey, capabilityKey, claim, stratum, policyPins, firstSlot }
    const watermark = { kind: 'owner_watermark' as const, learnerKey, sequence: 2, dueWorkThrough: NOW, historyCoverage: 'unknown' as const,
      legacyIndependentAudit: { unknownCount: null, sourceCoverage: 'unknown' as const } }
    return { ...f, row, watermark }
  }

  it('admits unresolved claims into source pages and reconciliation without fabricated slot pins', () => {
    const { row, watermark } = normalizedFixture()
    const page = validateLearnReportSourcePage({ version: LEARN_V2_MEASUREMENT_REPORT_SOURCE_VERSION, reportRunId: 'run',
      sequence: 0, sourceWatermark: 2, rows: [watermark, row], cursor: null, isDone: true })
    expect(page.rows[1]).toEqual(row)
    expect(reconcileLearnReportSourceRows([row.learnerKey], page.rows)).toEqual({ status: 'complete', reasonCodes: [] })
    expect(row.firstSlot).toEqual({ kind: 'unresolved', reason: 'no_qualifying_delayed_slot' })
    for (const field of ['clock', 'firstCheckOpportunityId', 'scorerConfiguration']) expect(row.firstSlot).not.toHaveProperty(field)
    expect(row.stratum).not.toHaveProperty('familyId')
  })

  it('carries the linked slot, eligibility state and outcome through the same normalized variant', () => {
    const { row, watermark, slot } = normalizedFixture()
    const linked = { ...row, firstSlot: { ...slot, stateAtEligibility: 'independent', stateAtAcceptance: null,
      acceptance: null, result: null, unresolvedReason: 'missing_delayed' } }
    const parsed = learnReportInputSnapshotSchema.parse(linked)
    expect(parsed).toEqual(linked)
    expect(reconcileLearnReportSourceRows([row.learnerKey], [watermark, parsed])).toEqual({ status: 'complete', reasonCodes: [] })
    expect(learnReportInputSnapshotSchema.safeParse({ ...linked, firstSlot: { ...linked.firstSlot, clock: undefined } }).success).toBe(false)
    expect(learnReportInputSnapshotSchema.safeParse({ ...linked, firstSlot: { ...linked.firstSlot, stateAtAcceptance: 'independent' } }).success).toBe(false)
    expect(learnReportInputSnapshotSchema.safeParse({ ...linked, firstSlot: { ...linked.firstSlot, stratum: { ...slot.stratum, flow: 'v2_canvas' } } }).success).toBe(false)
  })

  it('reconciles linked outcomes against the episode inventory instead of omitting the versioned claim', async () => {
    const { claim, episode, watermark, delayed } = await measurementReportIdentityFixture()
    const { epoch, baselineSha, cohortVersion, flow, entryPoint, depth } = claim.stratum
    const row = learnReportInputSnapshotSchema.parse({ kind: 'first_check_claim_v2', version: LEARN_V2_FIRST_INDEPENDENT_CLAIM_VERSION,
      learnerKey: claim.learnerKey, capabilityKey: claim.capabilityKey, claim: claim.claim,
      stratum: { epoch, baselineSha, cohortVersion, flow, entryPoint, depth }, policyPins: fixture().claim.policyPins,
      firstSlot: { kind: 'linked', firstCheckOpportunityId: claim.firstCheckOpportunityId, checkSequence: 1,
        linkedAt: claim.claim.firstIndependentAt, clock: claim.clock, stratum: claim.stratum,
        stateAtEligibility: claim.stateAtEligibility, stateAtAcceptance: claim.stateAtAcceptance, acceptance: claim.acceptance,
        result: delayed, unresolvedReason: null } })
    expect(reconcileLearnReportSourceRows([claim.learnerKey], [watermark, episode, row])).toEqual({ status: 'complete', reasonCodes: [] })
    if (row.kind !== 'first_check_claim_v2' || row.firstSlot.kind !== 'linked' || row.firstSlot.result === null) throw new Error('Expected linked result')
    row.firstSlot.result.scorePercent++
    expect(reconcileLearnReportSourceRows([claim.learnerKey], [watermark, episode, row]).reasonCodes).toContain('conflicting_outcome_snapshot')
  })

  it('rejects missing unresolved reasons and fabricated outcomes on an unresolved slot', () => {
    const { row } = normalizedFixture()
    expect(learnReportInputSnapshotSchema.safeParse({ ...row, firstSlot: { kind: 'unresolved' } }).success).toBe(false)
    expect(learnReportInputSnapshotSchema.safeParse({ ...row, firstSlot: { ...row.firstSlot, acceptance: null } }).success).toBe(false)
  })

  it('reconciles distinct unresolved claims without sharing a null opportunity identity', () => {
    const { row, watermark } = normalizedFixture()
    const second = { ...row, capabilityKey: `sha256:${'e'.repeat(64)}`, claim: { ...row.claim, claimKey: 'another-claim', basisAttemptId: 'another-basis' } }
    const rows = [watermark, row, second].map(value => learnReportInputSnapshotSchema.parse(value))
    expect(reconcileLearnReportSourceRows([row.learnerKey], rows)).toEqual({ status: 'complete', reasonCodes: [] })
  })

  it.each([
    { name: 'identical copy', change: {}, reasons: ['duplicate_claim_key', 'duplicate_source_row', 'reused_claim_basis_attempt', 'reused_first_check_opportunity'] },
    { name: 'same scope only', change: { claimKey: 'alias', basisAttemptId: 'alias-basis', firstCheckOpportunityId: 'alias-slot' }, reasons: ['conflicting_source_row'] },
    { name: 'same key in another capability', change: { capabilityKey: `sha256:${'e'.repeat(64)}`, basisAttemptId: 'alias-basis', firstCheckOpportunityId: 'alias-slot' }, reasons: ['duplicate_claim_key'] },
    { name: 'same basis in another epoch', change: { epoch: 'epoch.v2', claimKey: 'alias', firstCheckOpportunityId: 'alias-slot' }, reasons: ['reused_claim_basis_attempt'] },
    { name: 'same slot in another capability', change: { capabilityKey: `sha256:${'e'.repeat(64)}`, claimKey: 'alias', basisAttemptId: 'alias-basis' }, reasons: ['reused_first_check_opportunity'] },
    { name: 'distinct claims', change: { capabilityKey: `sha256:${'e'.repeat(64)}`, claimKey: 'alias', basisAttemptId: 'alias-basis', firstCheckOpportunityId: 'alias-slot' }, reasons: [] },
  ])('reconciles legacy claim pairs exactly as before: $name', ({ change, reasons }) => {
    const { row, watermark, slot } = normalizedFixture()
    const legacy = (value: Partial<Record<'capabilityKey' | 'claimKey' | 'basisAttemptId' | 'firstCheckOpportunityId' | 'epoch', string>> = {}) => ({
      kind: 'first_check_claim', learnerKey: row.learnerKey, capabilityKey: value.capabilityKey ?? row.capabilityKey,
      claim: { ...row.claim, claimKey: value.claimKey ?? row.claim.claimKey, basisAttemptId: value.basisAttemptId ?? row.claim.basisAttemptId },
      stratum: { ...slot.stratum, epoch: value.epoch ?? slot.stratum.epoch }, firstCheckOpportunityId: value.firstCheckOpportunityId ?? slot.firstCheckOpportunityId,
      checkSequence: 1, clock: slot.clock, stateAtEligibility: 'independent', stateAtAcceptance: null, acceptance: null, result: null, unresolvedReason: 'missing_delayed' })
    const rows = [watermark, legacy(), legacy(change)].map(value => learnReportInputSnapshotSchema.parse(value))
    expect(reconcileLearnReportSourceRows([row.learnerKey], rows)).toEqual({ status: reasons.length ? 'incomplete' : 'complete', reasonCodes: reasons })
  })

  it('applies the same first-claim rules that persistence checks before append', () => {
    const claim = { owner: 'owner', capability: 'capability', epoch: 'epoch.v1', snapshot: 'first', claimKey: 'key', basisAttemptId: 'basis', firstCheckOpportunityId: null }
    expect([...reconcileLearnReportFirstClaims([claim, { ...claim, snapshot: 'second', claimKey: 'other', basisAttemptId: 'other' }])]).toEqual(['conflicting_source_row'])
    expect([...reconcileLearnReportFirstClaims([claim, { ...claim, epoch: 'epoch.v2', snapshot: 'second', claimKey: 'other', basisAttemptId: 'other' }])]).toEqual([])
    expect([...reconcileLearnReportFirstClaims([{ ...claim, firstCheckOpportunityId: 'slot' },
      { ...claim, capability: 'other', snapshot: 'second', claimKey: 'other', basisAttemptId: 'other', firstCheckOpportunityId: 'slot' }])]).toEqual(['reused_first_check_opportunity'])
  })

  it('rejects a legacy and versioned normalized copy of the same claim', () => {
    const { row, watermark, slot } = normalizedFixture()
    const legacy = { kind: 'first_check_claim', learnerKey: row.learnerKey, capabilityKey: row.capabilityKey, claim: row.claim,
      stratum: slot.stratum, firstCheckOpportunityId: slot.firstCheckOpportunityId, checkSequence: 1, clock: slot.clock,
      stateAtEligibility: 'independent', stateAtAcceptance: null, acceptance: null, result: null, unresolvedReason: 'missing_delayed' }
    const rows = [watermark, row, legacy].map(value => learnReportInputSnapshotSchema.parse(value))
    expect(reconcileLearnReportSourceRows([row.learnerKey], rows).reasonCodes).toContain('duplicate_claim_key')
  })
})
