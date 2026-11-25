/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { makeFunctionReference, queryGeneric } from 'convex/server'
import type { Infer } from 'convex/values'
import { expect, expectTypeOf, test } from 'vitest'
import type { Doc } from './_generated/dataModel'
import schema from './schema'
import { reportCellsValidator, aggregateExportValidator } from './lib/learnV2PublicContract'
import type { learnReportMetricValidator, learnReportComputationMetricValidator, learnReportInputSnapshotValidator, learnReportAssignmentSnapshotValidator, learnReportResultSnapshotValidator } from './lib/learnV2MeasurementReportContract'
import {
  LEARN_V2_MEASUREMENT_REPORT_VERSION, LEARN_V2_MEASUREMENT_REPORT_QUERY_VERSION, LEARN_V2_MEASUREMENT_REPORT_SOURCE_VERSION,
  validateLearnPublishedMeasurementReportCells, learnReportInputSnapshotSchema, LEARN_REPORT_PUBLICATION_POLICY_VERSION,
  type LearnReportMetric, type LearnPublishedReportMetric,
  type learnReportAssignmentSnapshotSchema, type learnReportResultSnapshotSchema,
  LEARN_V2_FIRST_INDEPENDENT_CLAIM_VERSION, learnReportFactPayloadSchema, learnPublishedReportMetricSchema,
  type learnReportIndependentClaimV2Schema,
} from '../shared/learn-v2-measurement-report'
import type { z } from 'zod'
import { seedMeasurementStorage } from '../tests/fixtures/learn-v2-measurement-storage'
import { partialMeasurementReportCell, measurementReportIdentityFixture, measurementReportNonAdmittedFixture, measurementReportSourceFixture } from '../tests/fixtures/learn-v2-measurement-report'

const modules = import.meta.glob('./**/*.ts')

test('stored, public and exported cells have exactly the same frozen fields', () => {
  expectTypeOf<Infer<typeof learnReportComputationMetricValidator>>().toEqualTypeOf<LearnReportMetric>()
  expectTypeOf<Infer<typeof learnReportMetricValidator>>().toEqualTypeOf<LearnPublishedReportMetric>()
  expectTypeOf<Pick<Doc<'learnMeasurementReportCells'>, keyof LearnReportMetric>>().toEqualTypeOf<Pick<LearnPublishedReportMetric, keyof LearnReportMetric>>()
  expectTypeOf<Infer<typeof learnReportInputSnapshotValidator>>().toEqualTypeOf<z.infer<typeof learnReportInputSnapshotSchema>>()
  expectTypeOf<Doc<'learnMeasurementReportRows'>['snapshot']>().toEqualTypeOf<z.infer<typeof learnReportInputSnapshotSchema>>()
  expectTypeOf<Infer<typeof learnReportAssignmentSnapshotValidator>>().toEqualTypeOf<z.infer<typeof learnReportAssignmentSnapshotSchema>>()
  expectTypeOf<Infer<typeof learnReportResultSnapshotValidator>>().toEqualTypeOf<z.infer<typeof learnReportResultSnapshotSchema>>()
  expectTypeOf<Extract<Doc<'learnMeasurementReportFacts'>['fact'], { kind: 'independent_claim_v2' }>['stratum']>()
    .toEqualTypeOf<z.infer<typeof learnReportIndependentClaimV2Schema>['stratum']>()
})

test.each([undefined, 'today', 'canvas'] as const)('round-trips optional checkSurface=%s across stored C6 shapes and zod', async checkSurface => {
  const t = convexTest(schema, modules)
  const f = await t.run(ctx => seedMeasurementStorage(ctx, 'https://contract.example|owner'))
  const row = (await t.run(ctx => ctx.db.get(f.rows.learnMeasurementReportRows)))!
  const enrollment = (await t.run(ctx => ctx.db.get(f.rows.learnMeasurementReportFacts)))!
  const cell = (await t.run(ctx => ctx.db.get(f.rows.learnMeasurementReportCells)))!
  if (row.snapshot.kind !== 'episode' || enrollment.fact.kind !== 'enrollment') throw new Error('Missing report fixture')
  const surface = checkSurface === undefined ? {} : { checkSurface }
  const episode = { ...row.snapshot, assignment: { ...row.snapshot.assignment, ...surface } }
  const enrollmentFact = { ...enrollment.fact, snapshot: episode.assignment }
  const metric = { ...partialMeasurementReportCell(), publicationPolicyVersion: LEARN_REPORT_PUBLICATION_POLICY_VERSION,
    stratum: { ...cell.stratum, ...surface } }
  await t.run(async ctx => {
    await ctx.db.patch(row._id, { snapshot: episode })
    await ctx.db.patch(enrollment._id, { fact: enrollmentFact })
    await ctx.db.patch(cell._id, metric)
  })
  expect(learnReportInputSnapshotSchema.parse((await t.run(ctx => ctx.db.get(row._id)))!.snapshot)).toEqual(episode)
  expect(learnReportFactPayloadSchema.parse((await t.run(ctx => ctx.db.get(enrollment._id)))!.fact)).toEqual(enrollmentFact)
  expect(learnPublishedReportMetricSchema.parse(metric)).toEqual(metric)
  expect((await t.run(ctx => ctx.db.get(cell._id)))!.stratum).toEqual(metric.stratum)

  const source = await measurementReportSourceFixture()
  const basisAttemptId = await t.run(ctx => ctx.db.insert('masteryAttempts', { userId: f.base.userId,
    objectiveId: f.scope.objectiveId, blueprintRevisionId: f.scope.blueprintRevisionId, kind: 'independent_application',
    response: 'Synthetic storage shape control.', confidence: 3, attemptedAt: source.claim.claim.firstIndependentAt,
    serverScorePercent: 100, idempotencyKey: 'storage_surface_basis' }))
  const stratum = { epoch: 'epoch.v1', baselineSha: 'a'.repeat(40), cohortVersion: 'cohort.v1',
    flow: 'v2_today' as const, entryPoint: 'today', depth: 'working' as const, ...surface }
  const slot = { kind: 'linked' as const, firstCheckOpportunityId: f.rows.learnAssessmentOpportunities,
    checkSequence: 1 as const, linkedAt: source.claim.claim.firstIndependentAt, clock: { ...source.claim.clock, anchorEventId: basisAttemptId },
    stratum: { ...source.claim.stratum, ...stratum, familyId: f.rows.learnMeasurementFamilies } }
  const claim = { ...source.claim.claim, basisAttemptId, claimSequence: 1 as const }
  const fact = { ...claim, kind: 'independent_claim_v2' as const, version: LEARN_V2_FIRST_INDEPENDENT_CLAIM_VERSION,
    blueprintRevisionId: f.scope.blueprintRevisionId, objectiveId: f.scope.objectiveId, stratum,
    policyPins: { assistancePolicyVersion: 'assistance.v1', validityPolicyVersion: 'validity.v1', thresholdVersion: 'threshold.v1', thresholdPercent: 80 as const }, firstSlot: slot }
  for (const payload of [fact, { ...claim, kind: 'independent_claim' as const, firstCheckOpportunityId: slot.firstCheckOpportunityId,
    checkSequence: 1, stratum: slot.stratum }, { kind: 'first_slot_link' as const, version: fact.version,
    claimKey: claim.claimKey, claimSequence: 1 as const, claimFactSequence: 1, slot }]) {
    await t.run(ctx => ctx.db.patch(enrollment._id, { fact: payload }))
    expect(learnReportFactPayloadSchema.parse((await t.run(ctx => ctx.db.get(enrollment._id)))!.fact)).toEqual(payload)
  }
  const snapshot = { kind: 'first_check_claim_v2' as const, version: fact.version, ...f.reportKeys, claim, stratum, policyPins: fact.policyPins,
    firstSlot: { ...slot, stateAtEligibility: 'independent' as const, stateAtAcceptance: null, acceptance: null, result: null, unresolvedReason: null } }
  await t.run(ctx => ctx.db.patch(row._id, { rowKind: 'first_check_claim_v2', snapshot }))
  expect(learnReportInputSnapshotSchema.parse((await t.run(ctx => ctx.db.get(row._id)))!.snapshot)).toEqual(snapshot)
  const invalid = { ...fact, stratum: { ...stratum, checkSurface: 'email' } }
  expect(learnReportFactPayloadSchema.safeParse(invalid).success).toBe(false)
  await expect(t.run(ctx => ctx.db.patch(enrollment._id, { fact: invalid as never }))).rejects.toThrow()
})

test('requires and round-trips assignment admission fields in report rows and enrollment facts', async () => {
  const t = convexTest(schema, modules)
  const f = await t.run(ctx => seedMeasurementStorage(ctx, 'https://contract.example|owner'))
  const row = await t.run(ctx => ctx.db.get(f.rows.learnMeasurementReportRows))
  const fact = await t.run(ctx => ctx.db.get(f.rows.learnMeasurementReportFacts))
  if (!row || row.snapshot.kind !== 'episode' || !fact || fact.fact.kind !== 'enrollment') throw new Error('Missing report fixture')
  const episodeSnapshot = row.snapshot
  const enrollmentFact = fact.fact
  expect(episodeSnapshot.assignment.status).toBe('admitted')
  expect(episodeSnapshot.assignment.protocolStatus).toBe('frozen')
  for (const field of ['status', 'protocolStatus'] as const) {
    for (const value of [undefined, 'unknown']) {
      const assignment = { ...episodeSnapshot.assignment }
      Reflect.set(assignment, field, value)
      if (value === undefined) Reflect.deleteProperty(assignment, field)
      await expect(t.run(ctx => ctx.db.patch(row._id, { snapshot: { ...episodeSnapshot, assignment } }))).rejects.toThrow()
      await expect(t.run(ctx => ctx.db.patch(fact._id, { fact: { ...enrollmentFact, snapshot: assignment } }))).rejects.toThrow()
    }
  }
  for (const status of ['considered', 'not_admitted'] as const) for (const protocolStatus of ['protocol_not_frozen', 'blocked'] as const) {
    const { episode } = await measurementReportNonAdmittedFixture(status, protocolStatus)
    const snapshot = learnReportInputSnapshotSchema.parse({ ...episodeSnapshot, ...episode, assignmentId: episodeSnapshot.assignmentId,
      learningVoidId: episodeSnapshot.learningVoidId, blueprintRevisionId: episodeSnapshot.blueprintRevisionId, objectiveId: episodeSnapshot.objectiveId })
    await t.run(ctx => ctx.db.patch(row._id, { snapshot }))
    await t.run(ctx => ctx.db.patch(fact._id, { fact: { ...enrollmentFact, status, snapshot: episode.assignment } }))
    expect((await t.run(ctx => ctx.db.get(row._id)))?.snapshot).toEqual(snapshot)
    const savedFact = await t.run(ctx => ctx.db.get(fact._id))
    expect(savedFact?.fact).toEqual({ ...enrollmentFact, status, snapshot: episode.assignment })
  }
})

test('round-trips null and linked replacement clocks through the Convex snapshot validator', async () => {
  const t = convexTest(schema, modules)
  const f = await t.run(ctx => seedMeasurementStorage(ctx, 'https://contract.example|owner'))
  const row = await t.run(ctx => ctx.db.get(f.rows.learnMeasurementReportRows))
  if (!row || row.snapshot.kind !== 'episode') throw new Error('Missing episode fixture')
  expect(learnReportInputSnapshotSchema.parse(row.snapshot)).toEqual(row.snapshot)
  expect(row.snapshot.replacementClock).toBeNull()
  const omitted = { ...row.snapshot }
  Reflect.deleteProperty(omitted, 'replacementClock')
  await expect(t.run(ctx => ctx.db.patch(row._id, { snapshot: omitted }))).rejects.toThrow()

  const { episode } = await measurementReportIdentityFixture()
  const snapshot = await t.run(async ctx => {
    const opportunity = await ctx.db.get(f.rows.learnAssessmentOpportunities)
    if (!opportunity) throw new Error('Missing opportunity fixture')
    const { _id: _opportunityId, _creationTime: _createdAt, ...fields } = opportunity
    const originalOpportunityId = await ctx.db.insert('learnAssessmentOpportunities', fields)
    const replacementOpportunityId = await ctx.db.insert('learnAssessmentOpportunities', fields)
    const snapshot = learnReportInputSnapshotSchema.parse({ ...row.snapshot, clock: episode.clock,
      originalOpportunityId, replacementOpportunityId, replacementClock: episode.replacementClock })
    await ctx.db.patch(row._id, { snapshot })
    return snapshot
  })
  expect((await t.run(ctx => ctx.db.get(row._id)))?.snapshot).toEqual(snapshot)
  if (snapshot.kind !== 'episode') throw new Error('Expected episode snapshot')
  expect(snapshot.replacementClock).not.toEqual(snapshot.clock)
  for (const field of Object.keys(snapshot.replacementClock!)) {
    const replacementClock = { ...snapshot.replacementClock! }
    Reflect.deleteProperty(replacementClock, field)
    await expect(t.run(ctx => ctx.db.patch(row._id, { snapshot: { ...snapshot, replacementClock } }))).rejects.toThrow()
  }
  expect((await t.run(ctx => ctx.db.get(row._id)))?.snapshot).toEqual(snapshot)
})

test('public page and aggregate-export return validation preserve all aggregate breakdowns and reject private additions', async () => {
  let page: Infer<typeof reportCellsValidator> = { version: LEARN_V2_MEASUREMENT_REPORT_VERSION, status: 'disabled', reasonCodes: ['disabled'] }
  let exported: Infer<typeof aggregateExportValidator> = page
  const t = convexTest(schema, { ...modules, './reportContractFixture.ts': async () => ({
    page: queryGeneric({ args: {}, returns: reportCellsValidator, handler: () => page }),
    exported: queryGeneric({ args: {}, returns: aggregateExportValidator, handler: () => exported }),
  }) })
  const f = await t.run(ctx => seedMeasurementStorage(ctx, 'https://contract.example|owner'))
  const cell: LearnPublishedReportMetric = { ...partialMeasurementReportCell(), publicationPolicyVersion: LEARN_REPORT_PUBLICATION_POLICY_VERSION }
  page = { version: LEARN_V2_MEASUREMENT_REPORT_VERSION, reportRunId: f.rows.learnMeasurementReportRuns, cells: [cell], cursor: null, isDone: true }
  const digest = `sha256:${'a'.repeat(64)}`
  exported = { version: LEARN_V2_MEASUREMENT_REPORT_VERSION, status: 'aggregate_page', manifest: {
    reportRunId: f.rows.learnMeasurementReportRuns,
    query: { version: LEARN_V2_MEASUREMENT_REPORT_QUERY_VERSION, cohortVersion: 'cohort.v1', epoch: 'epoch.v1', protocolVersion: 'protocol.v1', enrollmentStartAt: 0, enrollmentEndAt: 1, cutoff: 2 },
    provenance: { kind: 'aggregate_snapshot', sourceVersion: LEARN_V2_MEASUREMENT_REPORT_SOURCE_VERSION, queryVersion: LEARN_V2_MEASUREMENT_REPORT_QUERY_VERSION,
      adapterVersion: 'adapter.v1', codeVersion: 'code.v1', rosterDigest: digest, inputDigest: digest, cutoff: 2,
      extractionStartedAt: 2, extractionEndedAt: 3, sourceCoverage: 'complete', episodeCount: null, inputBytes: null, bootstrapSeed: digest, bootstrapReplicates: 10000,
      publicationPolicyVersion: LEARN_REPORT_PUBLICATION_POLICY_VERSION },
  }, page }
  const readPage = makeFunctionReference<'query'>('reportContractFixture:page')
  const readExport = makeFunctionReference<'query'>('reportContractFixture:exported')
  expect(validateLearnPublishedMeasurementReportCells(await t.query(readPage, {}))).toEqual(page)
  expect(await t.query(readExport, {})).toEqual(exported)
  for (const key of Object.values(f.reportKeys)) {
    expect(JSON.stringify(await t.query(readPage, {}))).not.toContain(key)
    expect(JSON.stringify(await t.query(readExport, {}))).not.toContain(key)
  }
  for (const [field, key] of Object.entries(f.reportKeys)) {
    Reflect.set(cell, field, key)
    await expect(t.query(readPage, {})).rejects.toThrow()
    await expect(t.query(readExport, {})).rejects.toThrow()
    Reflect.deleteProperty(cell, field)
    Reflect.set(cell.stratum, field, key)
    await expect(t.query(readPage, {})).rejects.toThrow()
    await expect(t.query(readExport, {})).rejects.toThrow()
    Reflect.deleteProperty(cell.stratum, field)
  }
  expect(cell.legacyIndependentAudit).toEqual({ unknownCount: 3, sourceCoverage: 'complete' })
  Reflect.deleteProperty(cell, 'legacyIndependentAudit')
  await expect(t.query(readPage, {})).rejects.toThrow()
  await expect(t.query(readExport, {})).rejects.toThrow()
  cell.legacyIndependentAudit = { unknownCount: 3, sourceCoverage: 'complete' }
  Reflect.set(cell.legacyIndependentAudit, 'learnerRows', [{ response: 'private-payload-canary' }])
  await expect(t.query(readPage, {})).rejects.toThrow()
  await expect(t.query(readExport, {})).rejects.toThrow()
  Reflect.deleteProperty(cell.legacyIndependentAudit, 'learnerRows')
  Reflect.set(cell.sourceAccounting!, 'learnerRows', [{ response: 'private-payload-canary' }])
  await expect(t.query(readPage, {})).rejects.toThrow()
  await expect(t.query(readExport, {})).rejects.toThrow()
})
