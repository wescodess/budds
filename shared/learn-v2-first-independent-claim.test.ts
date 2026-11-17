import { describe, expect, it } from 'vitest'
import {
  LEARN_V2_FIRST_INDEPENDENT_CLAIM_VERSION, LEARN_V2_MEASUREMENT_REPORT_SOURCE_VERSION,
  learnReportFactPayloadSchema, learnReportFactSchema, learnReportIndependentClaimV2Schema,
  learnReportFirstSlotLinkSchema, learnReportLinkedFirstSlotSchema, resolveLearnReportFirstSlotV2,
} from './learn-v2-measurement-report'

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

  it.each(['claimKey', 'claimSequence', 'claimFactSequence', 'epoch', 'sequence', 'occurredAt', 'stratum', 'closed_window'] as const)(
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
      if (field === 'closed_window') {
        candidate.occurredAt = candidate.fact.slot.linkedAt = candidate.fact.slot.clock.closeAt
      }
      expect(() => resolveLearnReportFirstSlotV2(claimFact, candidate)).toThrow()
    },
  )
})
