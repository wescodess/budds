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
import { LEARN_MEASUREMENT_CAPABILITIES, LEARN_MEASUREMENT_STORAGE_VERSION } from '../shared/learn-v2-measurement-storage-manifest'
import { LEARN_V2_ASSISTANCE_POLICY_VERSION, LEARN_V2_VALIDITY_POLICY_VERSION } from '../shared/learn-v2-responses'
import { learnAssessmentPurposeSchema } from '../shared/learn-v2-delayed-check'
import { LEARN_V2_FIRST_INDEPENDENT_CLAIM_VERSION, LEARN_V2_MEASUREMENT_REPORT_SOURCE_VERSION, learnReportIndependentClaimV2Schema, learnReportFirstSlotLinkSchema, learnReportFactPayloadSchema,
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
type Fixture = Awaited<ReturnType<typeof fixture>>
type ReportKeys = Fixture['f']['reportKeys']
function readCounts() { return { factQueries: 0, queries: 0, documents: 0, gets: 0, indexes: Array<string>() } }
async function writeMeasured(f: Fixture, fact: Infer<typeof appendArgs>['fact'], counts = readCounts()) {
  return await f.t.run(async ctx => {
    function measuredQuery(target: object): object {
      return new Proxy(target, { get(target, property) {
        const value: unknown = Reflect.get(target, property)
        if (typeof value !== 'function') return value
        return (...args: unknown[]) => {
          if (property === 'withIndex') counts.indexes.push(String(args[0]))
          const result: unknown = Reflect.apply(value, target, args)
          if (['first', 'unique', 'take'].includes(String(property))) return Promise.resolve(result).then(rows => {
            counts.documents += Array.isArray(rows) ? rows.length : rows ? 1 : 0
            return rows
          })
          return result && typeof result === 'object' ? measuredQuery(result) : result
        }
      } })
    }
    const db = new Proxy(ctx.db, { get(target, property) {
      const value: unknown = Reflect.get(target, property)
      if (typeof value !== 'function') return value
      if (property === 'get') return async (...args: unknown[]) => {
        counts.gets++
        const row: unknown = await Reflect.apply(value, target, args)
        if (row) counts.documents++
        return row
      }
      if (property !== 'query') return value.bind(target)
      return (...args: unknown[]) => {
        counts.queries++
        if (args[0] === 'learnMeasurementReportFacts') counts.factQueries++
        return measuredQuery(Reflect.apply(value, target, args))
      }
    } })
    const sequence = await appendLearnMeasurementFact({ ...ctx, db }, OWNER.tokenIdentifier,
      { learningVoidId: f.f.learningVoidId, epoch: f.claim.stratum.epoch, occurredAt: NOW, fact: learnReportFactPayloadSchema.parse(fact) })
    const { indexes: _indexes, ...reads } = counts
    return { sequence, ...reads }
  })
}
function legacyClaim(f: Fixture, slot: LearnReportLinkedFirstSlot, overrides: {
  claimKey?: string, claimSequence?: number, basisAttemptId?: Id<'masteryAttempts'>, epoch?: string,
} = {}) {
  const { epoch, ...identity } = overrides
  return { kind: 'independent_claim' as const, ...claimBasis(f.claim), ...identity,
    firstCheckOpportunityId: slot.firstCheckOpportunityId, checkSequence: 1, stratum: { ...slot.stratum, epoch: epoch ?? slot.stratum.epoch } }
}
async function seedLegacyClaim(f: Fixture, fact: ReturnType<typeof legacyClaim>, userId = OWNER.tokenIdentifier, learningVoidId = f.f.learningVoidId) {
  return await f.t.run(async ctx => {
    const watermark = (await ctx.db.query('learnMeasurementSourceWatermarks').withIndex('by_userId', q => q.eq('userId', userId)).unique())!
    const sequence = watermark.sequence + 1
    await ctx.db.insert('learnMeasurementReportFacts', { userId, storageVersion: LEARN_MEASUREMENT_STORAGE_VERSION, createdAt: NOW,
      learningVoidId, sequence, epoch: f.claim.stratum.epoch, factVersion: LEARN_V2_MEASUREMENT_REPORT_SOURCE_VERSION, occurredAt: NOW,
      fact: { ...fact, claimFactSequence: sequence } })
    await ctx.db.patch(watermark._id, { sequence, updatedAt: NOW })
    return { ...fact, claimFactSequence: sequence }
  })
}
async function seedLegacyInventory(f: Fixture, count: number, epoch = f.claim.stratum.epoch) {
  const slot = await f.makeSlot()
  await f.t.run(async ctx => {
    const { _id: _voidId, _creationTime: _voidTime, ...voidFields } = (await ctx.db.get(f.f.learningVoidId))!
    const { _id: _blueprintId, _creationTime: _blueprintTime, ...blueprintFields } = (await ctx.db.get(f.claim.blueprintRevisionId))!
    const { _id: _basisId, _creationTime: _basisTime, ...basisFields } = (await ctx.db.get(f.basisAttemptId))!
    const { _id: _slotId, _creationTime: _slotTime, ...slotFields } = (await ctx.db.get(slot.firstCheckOpportunityId))!
    const watermark = (await ctx.db.query('learnMeasurementSourceWatermarks').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).unique())!
    let learningVoidId = f.f.learningVoidId
    let blueprintRevisionId = f.claim.blueprintRevisionId
    for (let index = 0; index < count; index++) {
      if (index % 15 === 0) {
        learningVoidId = await ctx.db.insert('learningVoids', voidFields)
        blueprintRevisionId = await ctx.db.insert('learnBlueprintRevisions', { ...blueprintFields, learningVoidId })
        await ctx.db.patch(learningVoidId, { activeBlueprintRevisionId: blueprintRevisionId })
      }
      const objectiveId = await ctx.db.insert('learnObjectives', { userId: OWNER.tokenIdentifier, blueprintRevisionId,
        order: index % 15, title: `Legacy capability ${index}` })
      const basisAttemptId = await ctx.db.insert('masteryAttempts', { ...basisFields, blueprintRevisionId, objectiveId, idempotencyKey: `legacy-basis-${index}` })
      const firstCheckOpportunityId = await ctx.db.insert('learnAssessmentOpportunities', { ...slotFields, learningVoidId, blueprintRevisionId, objectiveId,
        delayedCheckId: `legacy-slot-${index}`, purpose: { kind: 'retained_transfer', basisAttemptId, clock: { ...slot.clock, anchorEventId: basisAttemptId } } })
      const sequence = watermark.sequence + index + 1
      await ctx.db.insert('learnMeasurementReportFacts', { userId: OWNER.tokenIdentifier, learningVoidId,
        storageVersion: LEARN_MEASUREMENT_STORAGE_VERSION, createdAt: NOW, occurredAt: NOW,
        factVersion: LEARN_V2_MEASUREMENT_REPORT_SOURCE_VERSION, sequence, epoch,
        fact: { ...legacyClaim(f, { ...slot, firstCheckOpportunityId }, { claimKey: `legacy-${index}`, basisAttemptId, epoch }), claimFactSequence: sequence } })
    }
    await ctx.db.patch(watermark._id, { sequence: watermark.sequence + count, updatedAt: NOW })
  })
  return slot
}
function reportClaim(f: Fixture, input: unknown, clock: LearnReportLinkedFirstSlot['clock'], keys: ReportKeys = f.f.reportKeys) {
  const fact = learnReportFactPayloadSchema.parse(input)
  if (fact.kind === 'independent_claim') {
    const { kind: _kind, firstCheckOpportunityId, checkSequence, stratum, ...claim } = fact
    return learnReportInputSnapshotSchema.parse({ kind: 'first_check_claim', ...keys, claim, stratum,
      firstCheckOpportunityId, checkSequence, clock, stateAtEligibility: 'independent', stateAtAcceptance: null,
      acceptance: null, result: null, unresolvedReason: 'missing_delayed' })
  }
  if (fact.kind !== 'independent_claim_v2') throw new Error('Expected claim fact')
  return learnReportInputSnapshotSchema.parse({ kind: 'first_check_claim_v2', version: fact.version, ...keys,
    claim: claimBasis(fact), stratum: fact.stratum, policyPins: fact.policyPins,
    firstSlot: fact.firstSlot.kind === 'unresolved' ? fact.firstSlot : { ...fact.firstSlot, stateAtEligibility: 'independent',
      stateAtAcceptance: null, acceptance: null, result: null, unresolvedReason: 'missing_delayed' } })
}
async function anotherBasis(f: Fixture, overrides: Partial<Pick<Doc<'masteryAttempts'>,
  'userId' | 'blueprintRevisionId' | 'objectiveId'>> = {}) {
  return await f.t.run(async ctx => {
    const { _id: _id, _creationTime: _creationTime, ...fields } = (await ctx.db.get(f.basisAttemptId))!
    return await ctx.db.insert('masteryAttempts', { ...fields, ...overrides, idempotencyKey: 'another-basis' })
  })
}
function reconcileClaimFacts(f: Fixture, claims: (unknown | [unknown, ReportKeys])[]) {
  const watermark = { kind: 'owner_watermark' as const, learnerKey: f.f.reportKeys.learnerKey, sequence: 4,
    dueWorkThrough: NOW, historyCoverage: 'unknown' as const, legacyIndependentAudit: { unknownCount: null, sourceCoverage: 'unknown' as const } }
  return reconcileLearnReportSourceRows([watermark.learnerKey], [watermark,
    ...claims.map(claim => Array.isArray(claim) ? reportClaim(f, claim[0], f.clock, claim[1]) : reportClaim(f, claim, f.clock))])
}
async function anotherCapability(f: Fixture, title = 'Another capability') {
  const objectiveId = await f.t.run(ctx => ctx.db.insert('learnObjectives', { userId: OWNER.tokenIdentifier,
    blueprintRevisionId: f.claim.blueprintRevisionId, order: 1, title }))
  const basisAttemptId = await anotherBasis(f, { objectiveId })
  const slot = await f.makeSlot('retained_transfer', { ...f.clock, openAt: f.clock.openAt + 1_000, anchorEventId: basisAttemptId })
  await f.t.run(ctx => ctx.db.patch(slot.firstCheckOpportunityId, { objectiveId,
    purpose: { kind: 'retained_transfer', basisAttemptId, clock: slot.clock } }))
  const claimKey = await privacyDigest(['learn-v2.first-independent.v1',
    await masteryScopeKey(OWNER.tokenIdentifier, f.claim.blueprintRevisionId, objectiveId), f.claim.stratum.epoch])
  const keys = await deriveLearnReportComputationKeys({ reportRunId: f.f.rows.learnMeasurementReportRuns,
    ownerTokenIdentifier: OWNER.tokenIdentifier, blueprintRevisionId: f.claim.blueprintRevisionId, objectiveId })
  const claim = (claimFactSequence: number) => learnReportIndependentClaimV2Schema.parse({ ...f.claim, claimKey, basisAttemptId, objectiveId, claimFactSequence })
  return { objectiveId, basisAttemptId, slot, claimKey, keys, claim }
}
function claimRows(rows: Doc<'learnMeasurementReportFacts'>[]) {
  return rows.filter(row => row.fact.kind === 'independent_claim' || row.fact.kind === 'independent_claim_v2')
}
async function expectUnchanged(f: Fixture, before: Doc<'learnMeasurementReportFacts'>[]) {
  expect(await f.facts()).toEqual(before)
  expect(await f.t.run(ctx => ctx.db.query('learnMeasurementSourceWatermarks')
    .withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).unique())).toMatchObject({ sequence: before.length })
}
async function seedLegacyHistory(f: Fixture) {
  const other = await anotherCapability(f, 'Legacy capability')
  return await seedLegacyClaim(f, legacyClaim(f, other.slot, { claimKey: 'legacy-claim', basisAttemptId: other.basisAttemptId }))
}
async function storeUnresolvedReportClaim(f: Fixture) {
  const snapshot = learnReportInputSnapshotSchema.parse({ kind: 'first_check_claim_v2', version: f.claim.version, ...f.f.reportKeys,
    claim: claimBasis(f.claim), stratum: f.claim.stratum, policyPins: f.claim.policyPins, firstSlot: f.claim.firstSlot })
  await f.t.run(ctx => ctx.db.patch(f.f.rows.learnMeasurementReportRows, { rowKind: 'first_check_claim_v2', sourceWatermark: 2,
    assignmentId: undefined, horizonDays: undefined, snapshot,
    facts: { disposition: 'reconciliation_required', coldScorePercent: null, delayedScorePercent: null, claimKey: f.claim.claimKey,
      claimSequence: 1, checkSequence: null, admitted: false, matured: false, valid: false } }))
  return snapshot
}

test.each(['none', 'v2', 'v2_linked', 'v2_link'] as const)('rejects every new legacy claim append: prior %s', async prior => {
  const f = await fixture()
  const slot = await f.makeSlot()
  if (prior === 'v2' || prior === 'v2_link') await f.write(f.claim)
  if (prior === 'v2_linked') await f.write({ ...f.claim, firstSlot: slot })
  if (prior === 'v2_link') await f.write(f.link(slot))
  const before = await f.facts()
  const linked = { ...f.claim, firstSlot: slot }
  for (const legacy of [
    legacyClaim(f, slot),
    legacyClaim(f, slot, { claimKey: 'alias-claim', basisAttemptId: await anotherBasis(f) }),
    legacyClaim(f, slot, { claimKey: 'alias-claim', claimSequence: 2 }),
  ]) {
    if (prior !== 'none') expect(reconcileClaimFacts(f, [prior === 'v2' ? f.claim : linked, legacy]).status).toBe('incomplete')
    await expect(f.write(legacy)).rejects.toThrow('legacy Independent claims are read-only')
    await expectUnchanged(f, before)
  }
  expect(reconcileClaimFacts(f, claimRows(before).map(row => prior === 'v2_link' ? linked : row.fact)))
    .toEqual({ status: 'complete', reasonCodes: [] })
})

test.each(['legacy_first', 'v2_first'] as const)('concurrent legacy and v2 appends persist only the v2 claim: %s', async order => {
  const f = await fixture()
  const legacy = legacyClaim(f, await f.makeSlot(), { claimKey: 'alias-claim', basisAttemptId: await anotherBasis(f) })
  const writes = order === 'legacy_first' ? [f.write(legacy), f.write(f.claim)] : [f.write(f.claim), f.write(legacy)]
  const results = await Promise.allSettled(writes)
  const [legacyResult, claimResult] = order === 'legacy_first' ? results : [results[1], results[0]]
  expect(claimResult).toMatchObject({ status: 'fulfilled', value: 2 })
  expect(legacyResult?.status === 'rejected' && String(legacyResult.reason)).toContain('read-only')
  expect(claimRows(await f.facts()).map(row => row.fact)).toEqual([f.claim])
})

test.each((['identical', 'later_attainment'] as const).flatMap(second => (['sequential', 'concurrent'] as const).map(order => ({ second, order }))))(
  'keeps one primary claim per owner, capability and epoch: $second / $order', async ({ second, order }) => {
    const f = await fixture()
    const candidate = second === 'identical' ? f.claim : { ...f.claim, basisAttemptId: await anotherBasis(f) }
    expect(reconcileClaimFacts(f, [f.claim, { ...candidate, claimFactSequence: 3 }]).reasonCodes).toContain('conflicting_source_row')
    if (order === 'sequential') {
      await f.write(f.claim)
      const before = await f.facts()
      await expect(f.write({ ...candidate, claimFactSequence: 3 })).rejects.toThrow('already recorded: conflicting_source_row')
      await expectUnchanged(f, before)
    }
    else {
      const results = await Promise.allSettled([f.write(f.claim), f.write(candidate)])
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
      const rejected = results.find(result => result.status === 'rejected')
      expect(rejected?.status === 'rejected' && String(rejected.reason)).toContain('already recorded')
    }
    const claims = claimRows(await f.facts())
    expect(claims).toHaveLength(1)
    expect(reconcileClaimFacts(f, claims.map(row => row.fact))).toEqual({ status: 'complete', reasonCodes: [] })
  },
)

const legacyVariants = [
  { name: 'same capability, different key and basis', reason: 'conflicting_source_row' },
  { name: 'another capability, same key', reason: 'duplicate_claim_key' },
  { name: 'another capability, same key at a higher sequence', reason: 'duplicate_claim_key' },
  { name: 'another capability, same basis', reason: 'reused_claim_basis_attempt' },
  { name: 'same first opportunity', reason: 'reused_first_check_opportunity' },
] as const
test.each(legacyVariants.flatMap(variant => (['claim', 'link'] as const)
  .filter(mode => mode === 'claim' || variant.reason === 'reused_first_check_opportunity').map(mode => ({ ...variant, mode }))))(
  'rejects a v2 append that reconciliation would reject beside an existing legacy row: $name / $mode', async ({ name, reason, mode }) => {
    const f = await fixture()
    const slot = await f.makeSlot()
    const other = await anotherCapability(f)
    if (mode === 'link') await f.write(f.claim)
    const legacy = await seedLegacyClaim(f, name.startsWith('same capability')
      ? legacyClaim(f, await f.makeSlot('retained_transfer', { ...f.clock, openAt: f.clock.openAt + 2_000 }),
        { claimKey: 'alias-claim', basisAttemptId: await anotherBasis(f) })
      : name.startsWith('another capability, same key') ? legacyClaim(f, other.slot, { basisAttemptId: other.basisAttemptId,
        claimSequence: name.endsWith('sequence') ? Number.MAX_SAFE_INTEGER : 1 })
        : name.startsWith('another capability, same basis') ? legacyClaim(f, other.slot, { claimKey: 'alias-claim' })
          : legacyClaim(f, slot, { claimKey: 'alias-claim', basisAttemptId: other.basisAttemptId, epoch: 'legacy-epoch' }))
    const legacyKeys = name.startsWith('another') ? other.keys : f.f.reportKeys
    const linked = { ...f.claim, firstSlot: slot }
    const candidate = reason === 'reused_first_check_opportunity' ? linked : f.claim
    expect(reconcileClaimFacts(f, [[legacy, legacyKeys], candidate]).reasonCodes).toContain(reason)
    const before = await f.facts()
    await expect(f.write(mode === 'link' ? { ...f.link(slot), claimFactSequence: 3 } : { ...candidate, claimFactSequence: 3 }))
      .rejects.toThrow('legacy first-Independent claims must be reconciled before new claims')
    await expectUnchanged(f, before)
  },
)

test.each(([
  { envelopeEpoch: 'fixture-epoch', stratumEpoch: 'fixture-epoch' },
  { envelopeEpoch: 'previous-epoch', stratumEpoch: 'fixture-epoch' },
  { envelopeEpoch: 'fixture-epoch', stratumEpoch: 'previous-epoch' },
  { envelopeEpoch: 'previous-epoch', stratumEpoch: 'previous-epoch' },
] as const).flatMap(epochs => (['unresolved', 'linked', 'link'] as const).map(mode => ({ ...epochs, mode }))))(
  'refuses owner legacy rows without reading their sources: $envelopeEpoch / $stratumEpoch / $mode', async ({ envelopeEpoch, stratumEpoch, mode }) => {
    const f = await fixture()
    const slot = await f.makeSlot()
    if (mode === 'link') await f.write(f.claim)
    const other = await anotherCapability(f)
    const legacy = await seedLegacyClaim(f, legacyClaim(f, other.slot, { claimKey: 'legacy-claim', basisAttemptId: other.basisAttemptId, epoch: stratumEpoch }))
    await f.t.run(async ctx => {
      const row = (await ctx.db.query('learnMeasurementReportFacts').withIndex('by_fact_claimKey', q => q.eq('fact.claimKey', legacy.claimKey)).unique())!
      await ctx.db.patch(row._id, { epoch: envelopeEpoch })
      await ctx.db.patch(other.slot.firstCheckOpportunityId, { eligibilityPolicyVersion: 'x'.repeat(300 * 1024) })
      await ctx.db.delete(other.basisAttemptId)
    })
    const before = await f.facts()
    const reads = readCounts()
    await expect(writeMeasured(f, mode === 'link' ? f.link(slot)
      : { ...f.claim, claimFactSequence: before.length + 1, ...(mode === 'linked' ? { firstSlot: slot } : {}) }, reads))
      .rejects.toThrow('legacy first-Independent claims must be reconciled before new claims')
    expect(reads).toEqual({ factQueries: 1, queries: 2, documents: 2, gets: 0, indexes: ['by_userId', 'by_userId_and_fact_kind'] })
    await expectUnchanged(f, before)
  },
)

test('claim-key uniqueness matches cross-owner reconciliation', async () => {
  const f = await fixture()
  const slot = await f.makeSlot()
  const foreign = await f.t.run(ctx => seedMeasurementStorage(ctx, FOREIGN.tokenIdentifier))
  const foreignBasis = await anotherBasis(f, { userId: FOREIGN.tokenIdentifier,
    blueprintRevisionId: foreign.scope.blueprintRevisionId, objectiveId: foreign.scope.objectiveId })
  await seedLegacyClaim(f, legacyClaim(f, { ...slot, firstCheckOpportunityId: foreign.rows.learnAssessmentOpportunities }, { basisAttemptId: foreignBasis }),
    FOREIGN.tokenIdentifier, foreign.learningVoidId)
  await expect(f.write(f.claim)).rejects.toThrow('already recorded: duplicate_claim_key')
  expect(claimRows(await f.facts())).toEqual([])
})

test.each([0, 4_100])('keeps append reads constant with %d historical attempts', async attempts => {
  const f = await fixture()
  await f.t.run(async ctx => {
    const { _id: _id, _creationTime: _time, ...fields } = (await ctx.db.get(f.basisAttemptId))!
    for (let index = 0; index < attempts; index++) await ctx.db.insert('masteryAttempts', { ...fields,
      attemptedAt: NOW - (index + 1) * 86_400_000, acceptedAt: NOW - (index + 1) * 86_400_000, idempotencyKey: `history-${index}` })
  })
  expect(await writeMeasured(f, f.claim)).toEqual({ sequence: 2, factQueries: 4, queries: 5, documents: 5, gets: 4 })
  expect(await writeMeasured(f, f.link(await f.makeSlot()))).toEqual({ sequence: 3, factQueries: 8, queries: 12, documents: 7, gets: 2 })
}, 30_000)

test('bounds reads for an initially linked claim', async () => {
  const f = await fixture()
  expect(await writeMeasured(f, { ...f.claim, firstSlot: await f.makeSlot() }))
    .toEqual({ sequence: 2, factQueries: 7, queries: 11, documents: 6, gets: 5 })
})

test.each([1, 65])('refuses an owner with %d frozen legacy rows from the start with one fact read', async count => {
  const f = await fixture()
  const slot = await seedLegacyInventory(f, count, 'previous-epoch')
  for (const firstSlot of [f.claim.firstSlot, slot]) {
    const reads = readCounts()
    await expect(writeMeasured(f, { ...f.claim, claimFactSequence: count + 2, firstSlot }, reads))
      .rejects.toThrow('legacy first-Independent claims must be reconciled before new claims')
    expect(reads).toMatchObject({ factQueries: 1, queries: 2, documents: 2, gets: 0 })
  }
  expect(await f.t.run(ctx => ctx.db.query('learnMeasurementSourceWatermarks').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).unique()))
    .toMatchObject({ sequence: count + 1 })
})

test('links an early claim after more than 256 primary claims across capabilities and Voids', async () => {
  const f = await fixture()
  await f.write(f.claim)
  let learningVoidId = f.f.learningVoidId
  let blueprintRevisionId = f.claim.blueprintRevisionId
  const claims: (unknown | [unknown, ReportKeys])[] = [f.claim]
  const voids = new Set([learningVoidId])
  for (let index = 1; index < 257; index++) {
    const scope = await f.t.run(async ctx => {
      if (index % 15 === 0) {
        const { _id: _voidId, _creationTime: _voidTime, ...voidFields } = (await ctx.db.get(f.f.learningVoidId))!
        learningVoidId = await ctx.db.insert('learningVoids', voidFields)
        const { _id: _blueprintId, _creationTime: _blueprintTime, ...blueprintFields } = (await ctx.db.get(f.claim.blueprintRevisionId))!
        blueprintRevisionId = await ctx.db.insert('learnBlueprintRevisions', { ...blueprintFields, learningVoidId })
        await ctx.db.patch(learningVoidId, { activeBlueprintRevisionId: blueprintRevisionId })
      }
      const objectiveId = await ctx.db.insert('learnObjectives', { userId: OWNER.tokenIdentifier, blueprintRevisionId,
        order: index % 15, title: `Capability ${index}` })
      const { _id: _basisId, _creationTime: _basisTime, ...basisFields } = (await ctx.db.get(f.basisAttemptId))!
      const basisAttemptId = await ctx.db.insert('masteryAttempts', { ...basisFields, blueprintRevisionId, objectiveId,
        idempotencyKey: `capacity-basis-${index}` })
      return { objectiveId, blueprintRevisionId, learningVoidId, basisAttemptId }
    })
    voids.add(scope.learningVoidId)
    const claimKey = await privacyDigest(['learn-v2.first-independent.v1',
      await masteryScopeKey(OWNER.tokenIdentifier, scope.blueprintRevisionId, scope.objectiveId), f.claim.stratum.epoch])
    const claim = learnReportIndependentClaimV2Schema.parse({ ...f.claim, blueprintRevisionId: scope.blueprintRevisionId,
      objectiveId: scope.objectiveId, basisAttemptId: scope.basisAttemptId, claimKey, claimFactSequence: index + 2 })
    expect(await f.owner.mutation(appendRef, { learningVoidId: scope.learningVoidId, epoch: claim.stratum.epoch, occurredAt: NOW, fact: claim })).toBe(index + 2)
    claims.push([claim, await deriveLearnReportComputationKeys({ reportRunId: f.f.rows.learnMeasurementReportRuns,
      ownerTokenIdentifier: OWNER.tokenIdentifier, blueprintRevisionId: scope.blueprintRevisionId, objectiveId: scope.objectiveId })])
  }
  expect(voids.size).toBe(18)
  expect(reconcileClaimFacts(f, claims)).toEqual({ status: 'complete', reasonCodes: [] })
  const slot = await f.makeSlot()
  expect(await f.write(f.link(slot))).toBe(259)
  const saved = await f.t.run(ctx => ctx.db.query('learnMeasurementReportFacts')
    .withIndex('by_userId_and_fact_claimKey_and_fact_claimSequence', q => q.eq('userId', OWNER.tokenIdentifier)
      .eq('fact.claimKey', f.claim.claimKey).eq('fact.claimSequence', 1)).take(3))
  expect(saved.map(row => row.fact.kind)).toEqual(['independent_claim_v2', 'first_slot_link'])
  expect(resolveLearnReportFirstSlotV2(envelope(saved[0]!), envelope(saved[1]!)).firstSlot).toEqual(slot)
  claims[0] = { ...f.claim, firstSlot: slot }
  expect(reconcileClaimFacts(f, claims)).toEqual({ status: 'complete', reasonCodes: [] })
}, 30_000)

test.each(['opportunity', 'missing_opportunity'] as const)('finds same-capability legacy claims beyond unrelated %s history', async source => {
  const f = await fixture()
  await f.t.run(async ctx => {
    if (source === 'opportunity') {
      const { _id: _id, _creationTime: _time, ...fields } = (await ctx.db.get(f.f.rows.learnAssessmentOpportunities))!
      for (let index = 0; index < 260; index++) await ctx.db.insert('learnAssessmentOpportunities', { ...fields, delayedCheckId: `history-${index}` })
    }
    else {
      const { _id: _id, _creationTime: _time, ...fields } = (await ctx.db.get(f.basisAttemptId))!
      for (let index = 0; index < 260; index++) await ctx.db.insert('masteryAttempts', { ...fields, idempotencyKey: `history-${index}` })
    }
  })
  const slot = await f.makeSlot()
  const legacy = await seedLegacyClaim(f, legacyClaim(f, slot, { claimKey: 'legacy-alias', basisAttemptId: await anotherBasis(f) }))
  if (source === 'missing_opportunity') await f.t.run(ctx => ctx.db.delete(slot.firstCheckOpportunityId))
  expect(reconcileClaimFacts(f, [legacy, f.claim]).reasonCodes).toContain('conflicting_source_row')
  const before = await f.facts()
  await expect(f.write({ ...f.claim, claimFactSequence: 3 })).rejects.toThrow('legacy first-Independent claims must be reconciled before new claims')
  await expectUnchanged(f, before)
})

test.each((['embedded', 'link'] as const).flatMap(saved => (['claim', 'link'] as const).map(mode => ({ saved, mode }))))(
  'rejects reuse of a previous epoch\'s v2 opportunity: $saved / $mode', async ({ saved, mode }) => {
    const f = await fixture()
    const slot = await f.makeSlot()
    const previous = learnReportIndependentClaimV2Schema.parse({ ...f.claim, claimKey: 'previous-epoch-claim',
      basisAttemptId: await anotherBasis(f), stratum: { ...f.claim.stratum, epoch: 'previous-epoch' } })
    const previousSlot = { ...slot, stratum: { ...slot.stratum, epoch: previous.stratum.epoch } }
    const linked = { ...previous, firstSlot: previousSlot }
    await f.t.run(async ctx => {
      const watermark = (await ctx.db.query('learnMeasurementSourceWatermarks').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).unique())!
      const base = { userId: OWNER.tokenIdentifier, learningVoidId: f.f.learningVoidId, createdAt: NOW, occurredAt: NOW,
        epoch: previous.stratum.epoch, storageVersion: LEARN_MEASUREMENT_STORAGE_VERSION, factVersion: LEARN_V2_MEASUREMENT_REPORT_SOURCE_VERSION }
      await ctx.db.insert('learnMeasurementReportFacts', { ...base, sequence: 2, fact: saved === 'embedded' ? linked : previous })
      if (saved === 'link') await ctx.db.insert('learnMeasurementReportFacts', { ...base, sequence: 3,
        fact: { ...f.link(previousSlot), claimKey: previous.claimKey } })
      await ctx.db.patch(watermark._id, { sequence: saved === 'embedded' ? 2 : 3 })
    })
    expect(reconcileClaimFacts(f, [linked, { ...f.claim, firstSlot: slot }]).reasonCodes).toContain('reused_first_check_opportunity')
    const claimFactSequence = saved === 'embedded' ? 3 : 4
    if (mode === 'link') await f.write({ ...f.claim, claimFactSequence })
    const before = await f.facts()
    await expect(f.write(mode === 'claim' ? { ...f.claim, claimFactSequence, firstSlot: slot }
      : { ...f.link(slot), claimFactSequence })).rejects.toThrow('already recorded: reused_first_check_opportunity')
    await expectUnchanged(f, before)
  },
)

test.each(['claim', 'link'] as const)('fails closed on corrupt duplicate identities before appending a %s', async mode => {
  const f = await fixture()
  const slot = await f.makeSlot()
  if (mode === 'link') await f.write(f.claim)
  for (let index = 0; index < 3; index++) await seedLegacyClaim(f, legacyClaim(f, slot, { claimKey: `corrupt-${index}` }))
  const before = await f.facts()
  expect(reconcileClaimFacts(f, claimRows(before).map(row => row.fact)).status).toBe('incomplete')
  await expect(f.write(mode === 'claim' ? { ...f.claim, claimFactSequence: before.length + 1 } : f.link(slot)))
    .rejects.toThrow('legacy first-Independent claims must be reconciled before new claims')
  await expectUnchanged(f, before)
})

test.each(['purpose_horizon', 'opportunity_horizon', 'retained_horizon'] as const)(
  'rejects a slot without a canonical delayed purpose: %s', async mismatch => {
    const f = await fixture()
    await f.write(f.claim)
    const invalid = await f.makeSlot(mismatch === 'retained_horizon' ? 'retained_transfer' : 'measurement_delayed')
    const purpose = mismatch === 'purpose_horizon'
      ? { kind: 'measurement_delayed' as const, assignmentId: f.f.rows.learnMeasurementAssignments, horizonDays: 30 as const, clock: f.clock }
      : mismatch === 'retained_horizon' ? { kind: 'retained_transfer' as const, basisAttemptId: f.basisAttemptId, clock: f.clock }
        : { kind: 'measurement_delayed' as const, assignmentId: f.f.rows.learnMeasurementAssignments, horizonDays: 7 as const, clock: f.clock }
    expect(learnAssessmentPurposeSchema.safeParse(purpose).success).toBe(mismatch !== 'purpose_horizon')
    await f.t.run(ctx => ctx.db.patch(invalid.firstCheckOpportunityId, { purpose, horizonDays: mismatch === 'purpose_horizon' ? 7 : 30 }))
    await expect(f.write(f.link(invalid))).rejects.toThrow('not qualifying')
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
] as const).flatMap(pair => (['link', 'initial_claim'] as const).map(mode => ({ ...pair, mode }))))(
  'rejects incompatible slot pins: $purpose / $pins / $mode', async ({ purpose, pins, mode }) => {
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
    await expect(f.write(mode === 'initial_claim' ? { ...f.claim, firstSlot: invalid } : f.link(invalid))).rejects.toThrow('not qualifying')
    expect(await f.facts()).toEqual(before)
    expect(await f.t.run(ctx => ctx.db.query('learnMeasurementSourceWatermarks').unique())).toMatchObject({ sequence: before.length })
  },
)

test.each(['flow', 'entry_point', 'baseline', 'depth'] as const)('rejects a slot whose actual %s differs from the claim', async mismatch => {
  const f = await fixture()
  await f.write(f.claim)
  const slot = await f.makeSlot('measurement_delayed')
  await f.t.run(async ctx => {
    if (mismatch === 'flow') await ctx.db.patch(f.f.rows.learnMeasurementAssignments, { flow: 'v2_canvas' })
    if (mismatch === 'entry_point') await ctx.db.patch(f.f.rows.learnMeasurementAssignments, { entryPoint: 'another_entry' })
    if (mismatch === 'baseline') await ctx.db.patch(f.f.rows.learnMeasurementAssignments, { baselineSha: 'b'.repeat(40) })
    if (mismatch === 'depth') await ctx.db.patch(slot.firstCheckOpportunityId, { depth: 'advanced' })
  })
  const before = await f.facts()
  await expect(f.write(f.link(slot))).rejects.toThrow('not qualifying')
  expect(await f.facts()).toEqual(before)
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

test.each(['retained_transfer', 'measurement_delayed'] as const)('links an original %s slot once before any outcome', async kind => {
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

test.each(['too_early', 'replacement', 'cold', 'wrong_basis', 'wrong_scope', 'stratum', 'clock', 'claim_sequence', 'backdated'] as const)(
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

test('accepts a later qualifying slot until C5.3 (#434) selects the earliest one', async () => {
  const f = await fixture()
  await f.write(f.claim)
  const earliest = await f.makeSlot()
  const later = await f.makeSlot('retained_transfer', { ...earliest.clock, horizonDays: 30, dueLocalDate: '2027-04-06',
    dueAt: Date.parse('2027-04-06T16:00:00Z'), openAt: Date.parse('2027-04-06T04:00:00Z'), closeAt: Date.parse('2027-04-07T04:00:00Z') })
  expect(await f.write(f.link(later))).toBe(3)
  const rows = await f.facts()
  expect(resolveLearnReportFirstSlotV2(envelope(rows[1]!), envelope(rows[2]!)).firstSlot).toEqual(later)
  await expect(f.write(f.link(earliest))).rejects.toThrow('already linked')
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

test('owner export omits the new fact payloads and telemetry stays empty', async () => {
  const f = await fixture()
  await f.write(f.claim)
  await storeUnresolvedReportClaim(f)
  await f.write(f.link(await f.makeSlot()))
  const legacy = await seedLegacyHistory(f)
  const authorizationId = await authorizeExport(f.owner)
  const args = { authorizationId, collection: 'learnMeasurementReportFacts' as const, paginationOpts: { cursor: null, numItems: 8 } }
  const exported = await f.owner.query(api.dataExport.getUserDataPage, args)
  expect(exported.page).toHaveLength(4)
  for (const row of exported.page) expect(Object.keys(row).sort()).toEqual(['_creationTime', '_id', 'createdAt', 'epoch', 'factVersion', 'learningVoidId', 'occurredAt', 'sequence'].sort())
  expect(JSON.stringify(exported)).not.toContain(f.claim.claimKey)
  expect(JSON.stringify(exported)).not.toContain(f.basisAttemptId)
  expect(JSON.stringify(exported)).not.toContain(legacy.claimKey)
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
  await seedLegacyHistory(f)
  const before = (await f.facts()).slice(1)
  expect(before.map(row => row.fact.kind)).toEqual(['independent_claim_v2', 'first_slot_link', 'independent_claim'])
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
  await seedLegacyHistory(f)
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
