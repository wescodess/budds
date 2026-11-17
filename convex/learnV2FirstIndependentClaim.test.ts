/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import { v, type Infer } from 'convex/values'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { mutation } from './_generated/server'
import schema from './schema'
import { requireAuth } from './lib/auth'
import { appendLearnMeasurementFact } from './lib/learnV2MeasurementFacts'
import { reportFactFields } from './lib/learnV2MeasurementStorage'
import { masteryScopeKey } from './lib/learnV2MasteryScope'
import { privacyDigest } from './lib/learnV2ResponsePrivacy'
import { authorizeExport } from '../tests/fixtures/learn-v2-personal-export'
import { seedMeasurementStorage } from '../tests/fixtures/learn-v2-measurement-storage'
import { deriveLearnScorerConfiguration } from '../shared/learn-v2-measurement'
import { LEARN_MEASUREMENT_CAPABILITIES } from '../shared/learn-v2-measurement-storage-manifest'
import { LEARN_V2_ASSISTANCE_POLICY_VERSION, LEARN_V2_VALIDITY_POLICY_VERSION } from '../shared/learn-v2-responses'
import { learnAssessmentPurposeSchema } from '../shared/learn-v2-delayed-check'
import { LEARN_V2_FIRST_INDEPENDENT_CLAIM_VERSION, learnReportIndependentClaimV2Schema, learnReportFirstSlotLinkSchema, learnReportFactPayloadSchema,
  learnReportFactSchema, learnReportInputSnapshotSchema, resolveLearnReportFirstSlotV2, type LearnReportLinkedFirstSlot,
  type LearnReportIndependentClaimV2, reconcileLearnReportSourceRows, deriveLearnReportComputationKeys } from '../shared/learn-v2-measurement-report'

const OWNER = { tokenIdentifier: 'https://claim.example|owner', subject: 'owner' }
const FOREIGN = { tokenIdentifier: 'https://foreign.example|owner', subject: 'owner' }
const NOW = Date.parse('2027-03-07T17:00:00Z')
const HASH = 'a'.repeat(64)
const modules = import.meta.glob('./**/*.ts')
const appendArgs = v.object({ learningVoidId: v.id('learningVoids'), epoch: v.string(), occurredAt: v.number(), fact: reportFactFields.fact })
const append = mutation({ args: appendArgs, returns: v.number(), handler: async (ctx, args) =>
  await appendLearnMeasurementFact(ctx, await requireAuth(ctx), { ...args, fact: learnReportFactPayloadSchema.parse(args.fact) }) })
const appendRef = makeFunctionReference<'mutation', Infer<typeof appendArgs>, number>('firstClaimFixture:append')

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW) })
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs() })

async function fixture() {
  const t = convexTest(schema, { ...modules, './firstClaimFixture.ts': async () => ({ append }) })
  const owner = t.withIdentity(OWNER)
  const f = await t.run(ctx => seedMeasurementStorage(ctx, OWNER.tokenIdentifier))
  const basisAttemptId = await t.run(ctx => ctx.db.insert('masteryAttempts', { userId: OWNER.tokenIdentifier,
    blueprintRevisionId: f.scope.blueprintRevisionId, objectiveId: f.scope.objectiveId, attemptedAt: NOW, acceptedAt: NOW,
    idempotencyKey: 'first-independent-basis', kind: 'independent_application', serverScorePercent: 80,
    masteryStateBefore: 'guided', masteryStateAfter: 'independent', masteryTransitionVersion: 'learn-v2.mastery-transition.v1', masteryRecordRevision: 2,
    attemptTimezone: 'America/Toronto', attemptLocalDate: '2027-03-07',
    assistanceSnapshot: { ...f.assistanceSnapshot, policyVersion: LEARN_V2_ASSISTANCE_POLICY_VERSION },
    validitySnapshot: { ...f.validitySnapshot, policyVersion: LEARN_V2_VALIDITY_POLICY_VERSION, measurementEligible: false, masteryEligible: true } }))
  const stratum = { epoch: 'fixture-epoch', baselineSha: 'a'.repeat(40), cohortVersion: 'cohort.v1',
    flow: 'v2_today' as const, entryPoint: 'retained_check', depth: 'working' as const }
  await t.run(ctx => ctx.db.patch(f.rows.learnMeasurementAssignments, { entryPoint: stratum.entryPoint }))
  const claimKey = await privacyDigest(['learn-v2.first-independent.v1', await masteryScopeKey(OWNER.tokenIdentifier, f.scope.blueprintRevisionId, f.scope.objectiveId), stratum.epoch])
  const claim = learnReportIndependentClaimV2Schema.parse({ kind: 'independent_claim_v2', version: LEARN_V2_FIRST_INDEPENDENT_CLAIM_VERSION,
    claimKey, claimSequence: 1, basisAttemptId, masteryRecordRevision: 2, firstIndependentAt: NOW,
    firstIndependentLocalDate: '2027-03-07', firstIndependentTimezone: 'America/Toronto', transitionVersion: 'learn-v2.mastery-transition.v1',
    claimFactSequence: 2, blueprintRevisionId: f.scope.blueprintRevisionId, objectiveId: f.scope.objectiveId, stratum,
    policyPins: { assistancePolicyVersion: LEARN_V2_ASSISTANCE_POLICY_VERSION, validityPolicyVersion: LEARN_V2_VALIDITY_POLICY_VERSION,
      thresholdVersion: 'learn-v2.mastery-threshold.v1', thresholdPercent: 80 }, firstSlot: { kind: 'unresolved', reason: 'no_qualifying_delayed_slot' } })
  const clock = { protocolVersion: 'protocol.fixture', schedulingPolicyVersion: 'schedule.v1', anchorKind: 'first_independent',
    anchorEventId: basisAttemptId, anchorAt: NOW, horizonDays: 7 as const, timezone: 'America/Toronto', dueLocalDate: '2027-03-14',
    dueAt: Date.parse('2027-03-14T16:00:00Z'), openAt: Date.parse('2027-03-14T05:00:00Z'), closeAt: Date.parse('2027-03-15T04:00:00Z') }
  const makeSlot = async (kind: 'retained_transfer' | 'measurement_delayed' = 'retained_transfer', slotClock: LearnReportLinkedFirstSlot['clock'] = clock) => {
    const id = await t.run(async ctx => {
      const row = (await ctx.db.get(f.rows.learnAssessmentOpportunities))!
      const { _id: _id, _creationTime: _creationTime, submissionId: _submission, deliveryGrantId: _grant,
        assignmentId: _assignment, ...fields } = row
      return await ctx.db.insert('learnAssessmentOpportunities', { ...fields, createdAt: NOW,
        delayedCheckId: `first-${slotClock.horizonDays}-${slotClock.openAt}`, phase: 'ready',
        purpose: kind === 'retained_transfer' ? { kind, basisAttemptId, clock: slotClock }
          : { kind, assignmentId: f.rows.learnMeasurementAssignments, horizonDays: slotClock.horizonDays, clock: slotClock },
        ...(kind === 'measurement_delayed' ? { assignmentId: f.rows.learnMeasurementAssignments, horizonDays: slotClock.horizonDays } : {}),
        assessmentPins: kind === 'measurement_delayed' ? row.assessmentPins : { kind: 'session_application', caseId: f.itemPins.caseId,
          promptDigest: HASH, rubricVersion: 'rubric.v1', rubricDigest: HASH, supportManifestDigest: HASH },
        openAt: slotClock.openAt, closeAt: slotClock.closeAt, dueAt: slotClock.dueAt })
    })
    const slot: LearnReportLinkedFirstSlot = { kind: 'linked', firstCheckOpportunityId: id, checkSequence: 1, linkedAt: Date.now(), clock: slotClock,
      stratum: { ...stratum, familyId: kind === 'measurement_delayed' ? f.itemPins.familyId : null,
        familyRevision: kind === 'measurement_delayed' ? 1 : null,
        familyValidationStatus: kind === 'measurement_delayed' ? 'provisional_equivalent' : 'unknown',
        equivalenceVersion: kind === 'measurement_delayed' ? f.itemPins.equivalenceVersion : null,
        responseKind: 'bounded_rubric', scorerConfiguration: await deriveLearnScorerConfiguration(f.scoringBinding) } }
    return slot
  }
  const write = (fact: Infer<typeof appendArgs>['fact'], occurredAt = Date.now()) => owner.mutation(appendRef, { learningVoidId: f.learningVoidId, epoch: stratum.epoch, occurredAt, fact })
  const link = (slot: LearnReportLinkedFirstSlot) => learnReportFirstSlotLinkSchema.parse({ kind: 'first_slot_link', version: LEARN_V2_FIRST_INDEPENDENT_CLAIM_VERSION,
    claimKey, claimSequence: 1, claimFactSequence: 2, slot })
  const facts = () => t.run(ctx => ctx.db.query('learnMeasurementReportFacts').withIndex('by_userId_and_sequence', q => q.eq('userId', OWNER.tokenIdentifier)).take(8))
  return { t, owner, f, basisAttemptId, claim, clock, makeSlot, write, link, facts }
}
function envelope(row: Doc<'learnMeasurementReportFacts'>) {
  return { factVersion: row.factVersion, sequence: row.sequence, epoch: row.epoch, occurredAt: row.occurredAt, fact: row.fact }
}
function claimBasis(claim: LearnReportIndependentClaimV2) {
  const { kind: _kind, version: _version, blueprintRevisionId: _blueprint, objectiveId: _objective,
    policyPins: _policy, firstSlot: _slot, stratum: _stratum, ...basis } = claim
  return basis
}
function legacyClaim(f: Awaited<ReturnType<typeof fixture>>, slot: LearnReportLinkedFirstSlot, overrides: {
  claimKey?: string, claimSequence?: number, basisAttemptId?: Id<'masteryAttempts'>,
} = {}) {
  return { kind: 'independent_claim' as const, ...claimBasis(f.claim), ...overrides,
    firstCheckOpportunityId: slot.firstCheckOpportunityId, checkSequence: 1, stratum: slot.stratum }
}
function reportClaim(f: Awaited<ReturnType<typeof fixture>>, input: unknown, clock: LearnReportLinkedFirstSlot['clock']) {
  const fact = learnReportFactPayloadSchema.parse(input)
  if (fact.kind === 'independent_claim') {
    const { kind: _kind, firstCheckOpportunityId, checkSequence, stratum, ...claim } = fact
    return learnReportInputSnapshotSchema.parse({ kind: 'first_check_claim', ...f.f.reportKeys, claim, stratum,
      firstCheckOpportunityId, checkSequence, clock, stateAtEligibility: 'independent', stateAtAcceptance: null,
      acceptance: null, result: null, unresolvedReason: 'missing_delayed' })
  }
  if (fact.kind !== 'independent_claim_v2') throw new Error('Expected claim fact')
  return learnReportInputSnapshotSchema.parse({ kind: 'first_check_claim_v2', version: fact.version, ...f.f.reportKeys,
    claim: claimBasis(fact), stratum: fact.stratum, policyPins: fact.policyPins,
    firstSlot: fact.firstSlot.kind === 'unresolved' ? fact.firstSlot : { ...fact.firstSlot, stateAtEligibility: 'independent',
      stateAtAcceptance: null, acceptance: null, result: null, unresolvedReason: 'missing_delayed' } })
}
async function anotherBasis(f: Awaited<ReturnType<typeof fixture>>, overrides: Partial<Pick<Doc<'masteryAttempts'>,
  'userId' | 'blueprintRevisionId' | 'objectiveId'>> = {}) {
  return await f.t.run(async ctx => {
    const { _id: _id, _creationTime: _creationTime, ...fields } = (await ctx.db.get(f.basisAttemptId))!
    return await ctx.db.insert('masteryAttempts', { ...fields, ...overrides, idempotencyKey: 'another-basis' })
  })
}
function reconcileClaimFacts(f: Awaited<ReturnType<typeof fixture>>, claims: unknown[]) {
  const watermark = { kind: 'owner_watermark' as const, learnerKey: f.f.reportKeys.learnerKey, sequence: 4,
    dueWorkThrough: NOW, historyCoverage: 'unknown' as const, legacyIndependentAudit: { unknownCount: null, sourceCoverage: 'unknown' as const } }
  return reconcileLearnReportSourceRows([watermark.learnerKey], [watermark, ...claims.map(fact => reportClaim(f, fact, f.clock))])
}
async function storeUnresolvedReportClaim(f: Awaited<ReturnType<typeof fixture>>) {
  const snapshot = learnReportInputSnapshotSchema.parse({ kind: 'first_check_claim_v2', version: f.claim.version, ...f.f.reportKeys,
    claim: claimBasis(f.claim), stratum: f.claim.stratum, policyPins: f.claim.policyPins, firstSlot: f.claim.firstSlot })
  await f.t.run(ctx => ctx.db.patch(f.f.rows.learnMeasurementReportRows, { rowKind: 'first_check_claim_v2', sourceWatermark: 2,
    assignmentId: undefined, horizonDays: undefined, snapshot,
    facts: { disposition: 'reconciliation_required', coldScorePercent: null, delayedScorePercent: null, claimKey: f.claim.claimKey,
      claimSequence: 1, checkSequence: null, admitted: false, matured: false, valid: false } }))
  return snapshot
}

test.each(['v1_then_v2', 'v2_then_v1', 'v2_link_then_v1', 'v1_then_v1'] as const)('rejects mixed-version duplicate claims: %s', async order => {
  const f = await fixture()
  const slot = await f.makeSlot()
  const legacy = { kind: 'independent_claim' as const, ...claimBasis(f.claim), firstCheckOpportunityId: slot.firstCheckOpportunityId,
    checkSequence: 1, stratum: slot.stratum }
  await f.write(order.startsWith('v1_') ? legacy : f.claim)
  if (order === 'v2_link_then_v1') await f.write(f.link(slot))
  const before = await f.facts()
  const next = order === 'v1_then_v2' ? { ...f.claim, claimFactSequence: before.length + 1 } : { ...legacy, claimFactSequence: before.length + 1 }
  await expect(f.write(next)).rejects.toThrow('already recorded')
  expect(await f.facts()).toEqual(before)
  expect(await f.t.run(ctx => ctx.db.query('learnMeasurementSourceWatermarks').unique())).toMatchObject({ sequence: before.length })
})

test('competing legacy and v2 claims preserve one denominator authority', async () => {
  const f = await fixture()
  const slot = await f.makeSlot()
  const legacy = { kind: 'independent_claim' as const, ...claimBasis(f.claim), firstCheckOpportunityId: slot.firstCheckOpportunityId,
    checkSequence: 1, stratum: slot.stratum }
  const results = await Promise.allSettled([f.write(legacy), f.write(f.claim)])
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
  expect((await f.facts()).filter(row => row.fact.kind === 'independent_claim' || row.fact.kind === 'independent_claim_v2')).toHaveLength(1)
})

const identityVariants = [
  { name: 'same key and basis, another sequence', key: 'same', sequence: 2, basis: 'same', reason: 'duplicate_claim_key' },
  { name: 'alias key, same basis', key: 'alias', sequence: 1, basis: 'same', reason: 'reused_claim_basis_attempt' },
  { name: 'alias key and another sequence, same basis', key: 'alias', sequence: 2, basis: 'same', reason: 'reused_claim_basis_attempt' },
  { name: 'same key, different basis and sequence', key: 'same', sequence: 2, basis: 'different', reason: 'duplicate_claim_key' },
] as const
const claimWriteOrders = ['v2_first', 'legacy_first', 'v2_link_first', 'concurrent_v2_first', 'concurrent_legacy_first', 'concurrent_link_legacy'] as const
test.each(identityVariants.flatMap(variant => claimWriteOrders.map(order => ({ ...variant, order }))))(
  'enforces reconciliation identities: $name / $order', async ({ key, sequence, basis, reason, order }) => {
    const f = await fixture()
    const slot = await f.makeSlot()
    const legacy = legacyClaim(f, slot, { claimKey: key === 'same' ? f.claim.claimKey : 'alias-claim', claimSequence: sequence,
      basisAttemptId: basis === 'same' ? f.basisAttemptId : await anotherBasis(f) })
    expect(reconcileClaimFacts(f, [f.claim, legacy]).reasonCodes).toContain(reason)
    if (order === 'legacy_first') {
      await f.write(legacy)
      await expect(f.write({ ...f.claim, claimFactSequence: 3 })).rejects.toThrow('already recorded')
    }
    else if (order === 'v2_first' || order === 'v2_link_first') {
      await f.write(f.claim)
      if (order === 'v2_link_first') await f.write(f.link(slot))
      await expect(f.write(legacy)).rejects.toThrow('already recorded')
    }
    else {
      if (order === 'concurrent_link_legacy') await f.write(f.claim)
      const v2 = order === 'concurrent_link_legacy' ? f.link(slot) : f.claim
      const candidates = order === 'concurrent_legacy_first' ? [legacy, v2] : [v2, legacy]
      const results = await Promise.allSettled(candidates.map(fact => f.write(fact)))
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
      const rejected = results.find(result => result.status === 'rejected')
      expect(rejected?.status === 'rejected' && String(rejected.reason)).toContain('already recorded')
    }
    const claims = (await f.facts()).filter(row => row.fact.kind === 'independent_claim' || row.fact.kind === 'independent_claim_v2')
    expect(claims).toHaveLength(1)
    expect(reconcileClaimFacts(f, claims.map(row => row.fact))).toEqual({ status: 'complete', reasonCodes: [] })
  },
)

test.each(['claim_key', 'basis_attempt'] as const)('enforces %s uniqueness for legacy claims at higher sequences', async identity => {
  const f = await fixture()
  const slot = await f.makeSlot()
  const first = legacyClaim(f, slot, { claimSequence: 2 })
  const second = legacyClaim(f, slot, { claimSequence: Number.MAX_SAFE_INTEGER,
    claimKey: identity === 'claim_key' ? first.claimKey : 'another-key',
    basisAttemptId: identity === 'basis_attempt' ? first.basisAttemptId : await anotherBasis(f) })
  await f.write(first)
  await expect(f.write(second)).rejects.toThrow('already recorded')
  expect(await f.facts()).toHaveLength(2)
})

test.each(['sequential', 'concurrent'] as const)('claim-key uniqueness matches cross-owner reconciliation: %s', async order => {
  const f = await fixture()
  const slot = await f.makeSlot()
  const foreign = await f.t.run(ctx => seedMeasurementStorage(ctx, FOREIGN.tokenIdentifier))
  const foreignBasis = await anotherBasis(f, { userId: FOREIGN.tokenIdentifier,
    blueprintRevisionId: foreign.scope.blueprintRevisionId, objectiveId: foreign.scope.objectiveId })
  const foreignSlotId = await f.t.run(async ctx => {
    const { _id: _id, _creationTime: _creationTime, ...fields } = (await ctx.db.get(slot.firstCheckOpportunityId))!
    return await ctx.db.insert('learnAssessmentOpportunities', { ...fields, ...foreign.base, ...foreign.scope,
      purpose: { kind: 'retained_transfer', basisAttemptId: foreignBasis, clock: { ...f.clock, anchorEventId: foreignBasis } },
      assessmentPins: { kind: 'session_application', caseId: foreign.itemPins.caseId, promptDigest: HASH,
        rubricVersion: 'rubric.v1', rubricDigest: HASH, supportManifestDigest: HASH } })
  })
  const foreignClaim = { ...legacyClaim(f, slot, { basisAttemptId: foreignBasis, claimSequence: 2 }), firstCheckOpportunityId: foreignSlotId }
  const writeForeign = () => f.t.withIdentity(FOREIGN).mutation(appendRef, { learningVoidId: foreign.learningVoidId,
    epoch: f.claim.stratum.epoch, occurredAt: NOW, fact: foreignClaim })
  if (order === 'sequential') {
    await f.write(f.claim)
    await expect(writeForeign()).rejects.toThrow('already recorded')
  }
  else {
    const results = await Promise.allSettled([f.write(f.claim), writeForeign()])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
  }
  const claims = await f.t.run(ctx => ctx.db.query('learnMeasurementReportFacts').take(8))
  expect(claims.filter(row => row.fact.kind === 'independent_claim' || row.fact.kind === 'independent_claim_v2')).toHaveLength(1)
})

test('permits independent claim and basis identities that reconcile without duplication', async () => {
  const f = await fixture()
  const firstSlot = await f.makeSlot()
  const secondSlot = await f.makeSlot('retained_transfer', { ...f.clock, openAt: f.clock.openAt + 1_000 })
  const objectiveId = await f.t.run(ctx => ctx.db.insert('learnObjectives', { userId: OWNER.tokenIdentifier,
    blueprintRevisionId: f.claim.blueprintRevisionId, order: 1, title: 'Another capability' }))
  const basisAttemptId = await anotherBasis(f, { objectiveId })
  secondSlot.clock = { ...secondSlot.clock, anchorEventId: basisAttemptId }
  await f.t.run(ctx => ctx.db.patch(secondSlot.firstCheckOpportunityId, { objectiveId,
    purpose: { kind: 'retained_transfer', basisAttemptId, clock: secondSlot.clock } }))
  const first = legacyClaim(f, firstSlot, { claimSequence: 2 })
  const second = legacyClaim(f, secondSlot, { claimKey: 'another-key', claimSequence: 3, basisAttemptId })
  const rows = [reportClaim(f, first, f.clock), reportClaim(f, second, secondSlot.clock)]
  Object.assign(rows[1]!, await deriveLearnReportComputationKeys({ reportRunId: f.f.rows.learnMeasurementReportRuns,
    ownerTokenIdentifier: OWNER.tokenIdentifier, blueprintRevisionId: f.claim.blueprintRevisionId, objectiveId }))
  const watermark = { kind: 'owner_watermark' as const, learnerKey: f.f.reportKeys.learnerKey, sequence: 3,
    dueWorkThrough: NOW, historyCoverage: 'unknown' as const, legacyIndependentAudit: { unknownCount: null, sourceCoverage: 'unknown' as const } }
  expect(reconcileLearnReportSourceRows([watermark.learnerKey], [watermark, ...rows])).toEqual({ status: 'complete', reasonCodes: [] })
  await f.write(first)
  await f.write(second)
  expect(await f.facts()).toHaveLength(3)
})

test.each((['purpose_horizon', 'opportunity_horizon', 'retained_horizon'] as const).flatMap(mismatch =>
  (['only_candidate', 'later_candidate'] as const).map(order => ({ mismatch, order }))))(
  'validates canonical candidate purpose: $mismatch / $order', async ({ mismatch, order }) => {
    const f = await fixture()
    await f.write(f.claim)
    const invalid = await f.makeSlot(mismatch === 'retained_horizon' ? 'retained_transfer' : 'measurement_delayed')
    const purpose = mismatch === 'purpose_horizon'
      ? { kind: 'measurement_delayed' as const, assignmentId: f.f.rows.learnMeasurementAssignments, horizonDays: 30 as const, clock: f.clock }
      : mismatch === 'retained_horizon' ? { kind: 'retained_transfer' as const, basisAttemptId: f.basisAttemptId, clock: f.clock }
        : { kind: 'measurement_delayed' as const, assignmentId: f.f.rows.learnMeasurementAssignments, horizonDays: 7 as const, clock: f.clock }
    expect(learnAssessmentPurposeSchema.safeParse(purpose).success).toBe(mismatch !== 'purpose_horizon')
    await f.t.run(ctx => ctx.db.patch(invalid.firstCheckOpportunityId, { purpose, horizonDays: mismatch === 'purpose_horizon' ? 7 : 30 }))
    if (order === 'only_candidate') await expect(f.write(f.link(invalid))).rejects.toThrow()
    else {
      const valid = await f.makeSlot('retained_transfer', { ...f.clock, openAt: f.clock.openAt + 1_000 })
      expect(await f.write(f.link(valid))).toBe(3)
    }
  },
)

test.each(['day_7', 'day_30', 'no_redundant_horizon'] as const)('accepts a canonical delayed purpose: %s', async kind => {
  const f = await fixture()
  await f.write(f.claim)
  const clock = kind === 'day_30' ? { ...f.clock, horizonDays: 30 as const, dueLocalDate: '2027-04-06',
    dueAt: Date.parse('2027-04-06T16:00:00Z'), openAt: Date.parse('2027-04-06T04:00:00Z'), closeAt: Date.parse('2027-04-07T04:00:00Z') } : f.clock
  const slot = await f.makeSlot('measurement_delayed', clock)
  if (kind === 'no_redundant_horizon') await f.t.run(ctx => ctx.db.patch(slot.firstCheckOpportunityId, { horizonDays: undefined }))
  const row = (await f.t.run(ctx => ctx.db.get(slot.firstCheckOpportunityId)))!
  expect(learnAssessmentPurposeSchema.parse(row.purpose)).toEqual(row.purpose)
  expect(await f.write(f.link(slot))).toBe(3)
})

test.each(([
  { purpose: 'measurement_delayed', pins: 'session_application' },
  { purpose: 'measurement_delayed', pins: 'calibration' },
  { purpose: 'retained_transfer', pins: 'measurement' },
] as const).flatMap(pair => (['link', 'initial_claim', 'later_candidate'] as const).map(mode => ({ ...pair, mode }))))(
  'rejects incompatible candidate pins: $purpose / $pins / $mode', async ({ purpose, pins, mode }) => {
    const f = await fixture()
    if (mode !== 'initial_claim') await f.write(f.claim)
    const invalid = await f.makeSlot(pins === 'measurement' ? 'measurement_delayed' : 'retained_transfer')
    await f.t.run(async ctx => {
      const row = (await ctx.db.get(invalid.firstCheckOpportunityId))!
      await ctx.db.patch(row._id, {
        purpose: purpose === 'measurement_delayed'
          ? { kind: purpose, assignmentId: f.f.rows.learnMeasurementAssignments, horizonDays: 7, clock: f.clock }
          : { kind: purpose, basisAttemptId: f.basisAttemptId, clock: f.clock },
        assignmentId: purpose === 'measurement_delayed' ? f.f.rows.learnMeasurementAssignments : undefined,
        horizonDays: 7,
        ...(pins === 'calibration' ? { assessmentPins: { kind: pins, caseId: f.f.itemPins.caseId, promptDigest: HASH,
          assessmentContractVersion: row.assessmentContractVersion, assessmentContractDigest: row.assessmentContractDigest,
          supportManifestDigest: HASH } } : {}),
      })
    })
    const before = await f.facts()
    if (mode === 'later_candidate') {
      const valid = await f.makeSlot('retained_transfer', { ...f.clock, openAt: f.clock.openAt + 1_000 })
      expect(await f.write(f.link(valid))).toBe(3)
      const rows = await f.facts()
      expect(resolveLearnReportFirstSlotV2(envelope(rows[1]!), envelope(rows[2]!)).firstSlot).toEqual(valid)
    }
    else {
      await expect(f.write(mode === 'initial_claim' ? { ...f.claim, firstSlot: invalid } : f.link(invalid))).rejects.toThrow('earliest first slot')
      expect(await f.facts()).toEqual(before)
      expect(await f.t.run(ctx => ctx.db.query('learnMeasurementSourceWatermarks').unique())).toMatchObject({ sequence: before.length })
    }
  },
)

test.each(['flow', 'entry_point', 'baseline', 'depth'] as const)('selects the earliest slot using each candidate\'s actual %s', async mismatch => {
  const f = await fixture()
  await f.write(f.claim)
  const earlier = await f.makeSlot('measurement_delayed')
  await f.t.run(async ctx => {
    if (mismatch === 'flow') await ctx.db.patch(f.f.rows.learnMeasurementAssignments, { flow: 'v2_canvas' })
    if (mismatch === 'entry_point') await ctx.db.patch(f.f.rows.learnMeasurementAssignments, { entryPoint: 'another_entry' })
    if (mismatch === 'baseline') await ctx.db.patch(f.f.rows.learnMeasurementAssignments, { baselineSha: 'b'.repeat(40) })
    if (mismatch === 'depth') await ctx.db.patch(earlier.firstCheckOpportunityId, { depth: 'advanced' })
  })
  const first = await f.makeSlot('retained_transfer', { ...f.clock, openAt: f.clock.openAt + 1_000 })
  expect(await f.write(f.link(first))).toBe(3)
  const rows = await f.facts()
  expect(resolveLearnReportFirstSlotV2(envelope(rows[1]!), envelope(rows[2]!)).firstSlot).toEqual(first)
})

test('round-trips unresolved and linked claims through normalized report storage', async () => {
  const f = await fixture()
  await f.write(f.claim)
  const pending = await storeUnresolvedReportClaim(f)
  expect((await f.t.run(ctx => ctx.db.get(f.f.rows.learnMeasurementReportRows)))?.snapshot).toEqual(pending)
  const slot = await f.makeSlot()
  await f.write(f.link(slot))
  const linked = learnReportInputSnapshotSchema.parse({ ...pending, firstSlot: { ...slot, stateAtEligibility: 'independent',
    stateAtAcceptance: null, acceptance: null, result: null, unresolvedReason: 'missing_delayed' } })
  await f.t.run(ctx => ctx.db.patch(f.f.rows.learnMeasurementReportRows, { sourceWatermark: 3, horizonDays: 7, snapshot: linked }))
  expect((await f.t.run(ctx => ctx.db.get(f.f.rows.learnMeasurementReportRows)))?.snapshot).toEqual(linked)
})

test('records the ordinary first Independent basis without a delayed opportunity or cold pair, with all capabilities off', async () => {
  const f = await fixture()
  expect(Object.values(LEARN_MEASUREMENT_CAPABILITIES).every(value => value === false)).toBe(true)
  expect(await f.write(f.claim)).toBe(2)
  const rows = await f.facts()
  expect(resolveLearnReportFirstSlotV2(envelope(rows[1]!))).toEqual(f.claim)
  expect(await f.t.run(ctx => ctx.db.get(f.basisAttemptId))).toMatchObject({ acceptedAt: NOW, masteryStateAfter: 'independent' })
  expect(await f.t.run(ctx => ctx.db.query('learnActivityEvents').take(1))).toEqual([])
  await expect(f.write(f.claim)).rejects.toThrow('already recorded')
  await expect(f.write({ ...f.claim, claimKey: 'another-key', claimFactSequence: 3 })).rejects.toThrow('already recorded')
  expect(await f.facts()).toEqual(rows)
})

test.each(['retained_transfer', 'measurement_delayed'] as const)('links the earliest original %s slot once before any outcome', async kind => {
  const f = await fixture()
  await f.write(f.claim)
  vi.setSystemTime(NOW + 1_000)
  const slot = await f.makeSlot(kind)
  const before = (await f.facts())[1]!
  expect(await f.write(f.link(slot))).toBe(3)
  const rows = await f.facts()
  expect(rows[1]).toEqual(before)
  expect(learnReportFactSchema.parse(envelope(rows[2]!)).fact.kind).toBe('first_slot_link')
  expect(resolveLearnReportFirstSlotV2(envelope(rows[1]!), envelope(rows[2]!)).firstSlot).toEqual(slot)
  await expect(f.write(f.link(slot))).rejects.toThrow('already linked')
  expect(await f.facts()).toEqual(rows)
})

test('allows an initially linked claim and rejects a later link', async () => {
  const f = await fixture()
  const slot = await f.makeSlot()
  await f.write({ ...f.claim, firstSlot: slot })
  await expect(f.write(f.link(slot))).rejects.toThrow()
  expect((await f.facts())[1]?.fact).toEqual({ ...f.claim, firstSlot: slot })
})

test.each(['too_early', 'replacement', 'cold', 'wrong_basis', 'wrong_scope', 'later_slot', 'stratum', 'clock', 'claim_sequence', 'backdated'] as const)(
  'rejects a nonqualifying first-slot link: %s', async scenario => {
    const f = await fixture()
    await f.write(f.claim)
    const slot = await f.makeSlot()
    if (scenario === 'too_early') {
      slot.clock = { ...slot.clock, openAt: slot.clock.openAt - 1 }
      await f.t.run(ctx => ctx.db.patch(slot.firstCheckOpportunityId, { openAt: slot.clock.openAt, purpose: { kind: 'retained_transfer', basisAttemptId: f.basisAttemptId, clock: slot.clock } }))
    }
    if (scenario === 'replacement') await f.t.run(ctx => ctx.db.patch(slot.firstCheckOpportunityId, { originalSlot: false, replacesOpportunityId: f.f.rows.learnAssessmentOpportunities }))
    if (scenario === 'cold') await f.t.run(ctx => ctx.db.patch(slot.firstCheckOpportunityId, { purpose: { kind: 'measurement_cold', assignmentId: f.f.rows.learnMeasurementAssignments, protocolVersion: 'protocol.fixture' } }))
    if (scenario === 'wrong_basis') await f.t.run(async ctx => {
      const id = await ctx.db.insert('masteryAttempts', { userId: OWNER.tokenIdentifier, objectiveId: f.claim.objectiveId, attemptedAt: NOW, idempotencyKey: 'other' })
      await ctx.db.patch(slot.firstCheckOpportunityId, { purpose: { kind: 'retained_transfer', basisAttemptId: id, clock: slot.clock } })
    })
    if (scenario === 'wrong_scope') await f.t.run(ctx => ctx.db.patch(slot.firstCheckOpportunityId, { userId: FOREIGN.tokenIdentifier }))
    if (scenario === 'later_slot') Object.assign(slot, await f.makeSlot('retained_transfer', { ...slot.clock, openAt: slot.clock.openAt + 1_000 }))
    if (scenario === 'stratum') slot.stratum.scorerConfiguration.configurationDigest = 'b'.repeat(64)
    if (scenario === 'clock') slot.clock = { ...slot.clock, closeAt: slot.clock.closeAt + 1 }
    if (scenario === 'backdated') vi.setSystemTime(NOW + 1_000)
    const candidate = f.link(slot)
    if (scenario === 'claim_sequence') candidate.claimFactSequence = 1
    const before = await f.facts()
    await expect(f.write(candidate)).rejects.toThrow()
    expect(await f.facts()).toEqual(before)
    expect(await f.t.run(ctx => ctx.db.query('learnMeasurementSourceWatermarks').unique())).toMatchObject({ sequence: 2 })
  },
)

test.each(['submission', 'execution', 'attempt', 'scored_phase', 'expired'] as const)('rejects linkage after %s even with stale opportunity projections', async outcome => {
  const f = await fixture()
  await f.write(f.claim)
  const slot = await f.makeSlot()
  await f.t.run(async ctx => {
    if (outcome === 'submission') await ctx.db.patch(f.f.rows.learnResponses, { assessmentOpportunityId: slot.firstCheckOpportunityId })
    if (outcome === 'execution') await ctx.db.patch(f.f.rows.learnScoringExecutions, { assessmentOpportunityId: slot.firstCheckOpportunityId })
    if (outcome === 'attempt') await ctx.db.patch(f.basisAttemptId, { assessmentOpportunityId: slot.firstCheckOpportunityId })
    if (outcome === 'scored_phase') await ctx.db.patch(slot.firstCheckOpportunityId, { phase: 'scored_fail' })
  })
  if (outcome === 'expired') vi.setSystemTime(slot.clock.closeAt)
  await expect(f.write(f.link(slot))).rejects.toThrow()
  expect((await f.facts()).map(row => row.fact.kind)).toEqual(['enrollment', 'independent_claim_v2'])
})

test('a missed first slot cannot be skipped for a later day-30 slot', async () => {
  const f = await fixture()
  await f.write(f.claim)
  const first = await f.makeSlot()
  vi.setSystemTime(first.clock.closeAt + 1)
  const later = await f.makeSlot('retained_transfer', { ...first.clock, horizonDays: 30, dueLocalDate: '2027-04-06',
    dueAt: Date.parse('2027-04-06T16:00:00Z'), openAt: Date.parse('2027-04-06T04:00:00Z'), closeAt: Date.parse('2027-04-07T04:00:00Z') })
  await expect(f.write(f.link(later))).rejects.toThrow('earliest first slot')
})

test('preserves the original link through failure and a later passing retry', async () => {
  const f = await fixture()
  await f.write(f.claim)
  const first = await f.makeSlot()
  await f.write(f.link(first))
  await f.t.run(ctx => ctx.db.patch(first.firstCheckOpportunityId, { phase: 'scored_fail' }))
  const later = await f.makeSlot('retained_transfer', { ...first.clock, horizonDays: 30, dueLocalDate: '2027-04-06',
    dueAt: Date.parse('2027-04-06T16:00:00Z'), openAt: Date.parse('2027-04-06T04:00:00Z'), closeAt: Date.parse('2027-04-07T04:00:00Z') })
  await f.t.run(ctx => ctx.db.patch(later.firstCheckOpportunityId, { phase: 'scored_pass' }))
  await expect(f.write(f.link(later))).rejects.toThrow('already linked')
  const rows = await f.facts()
  expect(resolveLearnReportFirstSlotV2(envelope(rows[1]!), envelope(rows[2]!)).firstSlot).toEqual(first)
})

test.each(['assisted', 'preserved', 'failed', 'invalid', 'wrong_anchor', 'wrong_revision'] as const)('rejects an invalid Independent basis: %s', async scenario => {
  const f = await fixture()
  await f.t.run(async ctx => {
    const basis = (await ctx.db.get(f.basisAttemptId))!
    if (scenario === 'assisted') await ctx.db.patch(basis._id, { assistanceSnapshot: { ...basis.assistanceSnapshot!, state: 'assisted' } })
    if (scenario === 'preserved') await ctx.db.patch(basis._id, { masteryStateBefore: 'independent' })
    if (scenario === 'failed') await ctx.db.patch(basis._id, { serverScorePercent: 79 })
    if (scenario === 'invalid') await ctx.db.patch(basis._id, { validitySnapshot: { ...basis.validitySnapshot!, masteryEligible: false } })
    if (scenario === 'wrong_anchor') await ctx.db.patch(basis._id, { acceptedAt: NOW - 1 })
    if (scenario === 'wrong_revision') await ctx.db.patch(basis._id, { masteryRecordRevision: 3 })
  })
  await expect(f.write(f.claim)).rejects.toThrow('basis is invalid')
  expect(await f.facts()).toHaveLength(1)
})

test('competing links produce one append and one watermark increment', async () => {
  const f = await fixture()
  await f.write(f.claim)
  const slot = await f.makeSlot()
  const results = await Promise.allSettled([f.write(f.link(slot)), f.write(f.link(slot))])
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
  expect((await f.facts()).filter(row => row.fact.kind === 'first_slot_link')).toHaveLength(1)
  expect(await f.t.run(ctx => ctx.db.query('learnMeasurementSourceWatermarks').unique())).toMatchObject({ sequence: 3 })
})

test('refuses to select a first slot from a truncated opportunity inventory', async () => {
  const f = await fixture()
  await f.write(f.claim)
  const slot = await f.makeSlot()
  await f.t.run(async ctx => {
    const row = (await ctx.db.get(slot.firstCheckOpportunityId))!
    const { _id: _id, _creationTime: _creationTime, ...fields } = row
    for (let index = 0; index < 64; index++) await ctx.db.insert('learnAssessmentOpportunities', { ...fields, delayedCheckId: `overflow-${index}` })
  })
  await expect(f.write(f.link(slot))).rejects.toThrow('inventory exceeds its bound')
  expect(await f.facts()).toHaveLength(2)
})

test('owner export omits the new fact payloads and telemetry stays empty', async () => {
  const f = await fixture()
  await f.write(f.claim)
  await storeUnresolvedReportClaim(f)
  await f.write(f.link(await f.makeSlot()))
  const authorizationId = await authorizeExport(f.owner)
  const args = { authorizationId, collection: 'learnMeasurementReportFacts' as const, paginationOpts: { cursor: null, numItems: 8 } }
  const exported = await f.owner.query(api.dataExport.getUserDataPage, args)
  expect(exported.page).toHaveLength(3)
  for (const row of exported.page) expect(Object.keys(row).sort()).toEqual(['_creationTime', '_id', 'createdAt', 'epoch', 'factVersion', 'learningVoidId', 'occurredAt', 'sequence'].sort())
  expect(JSON.stringify(exported)).not.toContain(f.claim.claimKey)
  expect(JSON.stringify(exported)).not.toContain(f.basisAttemptId)
  const rows = await f.owner.query(api.dataExport.getUserDataPage, { ...args, collection: 'learnMeasurementReportRows' })
  expect(rows.page).toMatchObject([{ rowKind: 'first_check_claim_v2' }])
  expect(JSON.stringify(rows)).not.toContain(f.claim.claimKey)
  expect(rows.page[0]).not.toHaveProperty('snapshot')
  await expect(f.t.withIdentity(FOREIGN).query(api.dataExport.getUserDataPage, args)).rejects.toThrow()
  await expect(f.t.withIdentity(FOREIGN).mutation(appendRef, { learningVoidId: f.f.learningVoidId, epoch: f.claim.stratum.epoch, occurredAt: NOW, fact: f.claim })).rejects.toThrow('scope mismatch')
  expect(await f.t.run(ctx => ctx.db.query('learnActivityEvents').take(1))).toEqual([])
})

test.each(['source_deleted', 'access_lost'] as const)('%s purge retains scalar claim/link history and invalidates cached reports', async reason => {
  const f = await fixture()
  await f.write(f.claim)
  await storeUnresolvedReportClaim(f)
  await f.write(f.link(await f.makeSlot()))
  const before = (await f.facts()).slice(1)
  for (let batch = 0; batch < 20; batch++) {
    const result = await f.t.mutation(internal.learnV2Retention.purgeSourceEvidence, { userId: OWNER.tokenIdentifier, sourceIdentityId: f.f.sourceIdentityId, reason })
    if (!result.pending) break
    if (batch === 19) throw new Error('Source cleanup did not finish')
  }
  expect((await f.facts()).slice(1)).toEqual(before)
  expect(await f.t.run(ctx => ctx.db.get(f.f.rows.learnMeasurementReportRuns))).toMatchObject({ status: 'stale' })
  expect(await f.t.run(ctx => ctx.db.get(f.f.rows.learnMeasurementReportRows))).toMatchObject({ rowKind: 'first_check_claim_v2', invalidatedAt: NOW })
  expect(await f.t.run(ctx => ctx.db.get(f.f.rows.learnResponseBodies))).toBeNull()
  await f.t.finishInProgressScheduledFunctions()
})

test.each(['void', 'account'] as const)('%s deletion removes both fact copies and preserves another owner', async kind => {
  const f = await fixture()
  await f.write(f.claim)
  await storeUnresolvedReportClaim(f)
  await f.write(f.link(await f.makeSlot()))
  const foreign = await f.t.run(ctx => seedMeasurementStorage(ctx, FOREIGN.tokenIdentifier))
  if (kind === 'void') {
    for (let batch = 0; batch < 60; batch++) {
      const result = await f.t.mutation(internal.learnV2Retention.deleteFolderFoundation, { userId: OWNER.tokenIdentifier, folderId: f.f.folderId })
      if (!result.hasMore) break
      if (batch === 59) throw new Error('Void cleanup did not finish')
    }
  }
  else {
    await f.t.run(async ctx => {
      await ctx.db.patch(f.f.documentId, { status: 'processing' })
      await ctx.db.insert('accountDeletionJobs', { userId: OWNER.tokenIdentifier, status: 'active', phase: 'documents', startedAt: NOW, updatedAt: NOW })
    })
    for (let batch = 0; batch < 180; batch++) {
      await f.t.mutation(internal.accountDeletion.runDeletionBatch, { userId: OWNER.tokenIdentifier })
      const state = await f.t.query(internal.accountDeletion.getDeletionTombstone, { userId: OWNER.tokenIdentifier })
      if (state?.phase === 'complete') break
      if (batch === 179) throw new Error('Account deletion did not finish')
    }
  }
  expect(await f.facts()).toEqual([])
  expect(await f.t.run(ctx => ctx.db.get(f.f.rows.learnMeasurementReportRows))).toBeNull()
  expect(await f.t.run(ctx => ctx.db.get(foreign.rows.learnMeasurementReportFacts))).not.toBeNull()
  await f.t.finishInProgressScheduledFunctions()
})
