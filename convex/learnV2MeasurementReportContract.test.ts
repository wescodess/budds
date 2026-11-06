/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { makeFunctionReference, queryGeneric } from 'convex/server'
import type { Infer } from 'convex/values'
import { expect, expectTypeOf, test } from 'vitest'
import type { Doc } from './_generated/dataModel'
import schema from './schema'
import { reportCellsValidator, aggregateExportValidator } from './lib/learnV2PublicContract'
import type { learnReportMetricValidator, learnReportInputSnapshotValidator, learnReportAssignmentSnapshotValidator, learnReportResultSnapshotValidator } from './lib/learnV2MeasurementReportContract'
import {
  LEARN_V2_MEASUREMENT_REPORT_VERSION, LEARN_V2_MEASUREMENT_REPORT_QUERY_VERSION, LEARN_V2_MEASUREMENT_REPORT_SOURCE_VERSION,
  validateLearnMeasurementReportCells, learnReportInputSnapshotSchema, type LearnReportMetric,
  type learnReportAssignmentSnapshotSchema, type learnReportResultSnapshotSchema,
} from '../shared/learn-v2-measurement-report'
import type { z } from 'zod'
import { seedMeasurementStorage } from '../tests/fixtures/learn-v2-measurement-storage'
import { partialMeasurementReportCell, measurementReportIdentityFixture } from '../tests/fixtures/learn-v2-measurement-report'

const modules = import.meta.glob('./**/*.ts')

test('stored, public and exported cells have exactly the same frozen fields', () => {
  expectTypeOf<Infer<typeof learnReportMetricValidator>>().toEqualTypeOf<LearnReportMetric>()
  expectTypeOf<Pick<Doc<'learnMeasurementReportCells'>, keyof LearnReportMetric>>().toEqualTypeOf<LearnReportMetric>()
  expectTypeOf<Infer<typeof learnReportInputSnapshotValidator>>().toEqualTypeOf<z.infer<typeof learnReportInputSnapshotSchema>>()
  expectTypeOf<Doc<'learnMeasurementReportRows'>['snapshot']>().toEqualTypeOf<z.infer<typeof learnReportInputSnapshotSchema>>()
  expectTypeOf<Infer<typeof learnReportAssignmentSnapshotValidator>>().toEqualTypeOf<z.infer<typeof learnReportAssignmentSnapshotSchema>>()
  expectTypeOf<Infer<typeof learnReportResultSnapshotValidator>>().toEqualTypeOf<z.infer<typeof learnReportResultSnapshotSchema>>()
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
  const cell = partialMeasurementReportCell()
  page = { version: LEARN_V2_MEASUREMENT_REPORT_VERSION, reportRunId: f.rows.learnMeasurementReportRuns, cells: [cell], cursor: null, isDone: true }
  const digest = `sha256:${'a'.repeat(64)}`
  exported = { version: LEARN_V2_MEASUREMENT_REPORT_VERSION, status: 'aggregate_page', manifest: {
    reportRunId: f.rows.learnMeasurementReportRuns,
    query: { version: LEARN_V2_MEASUREMENT_REPORT_QUERY_VERSION, cohortVersion: 'cohort.v1', epoch: 'epoch.v1', protocolVersion: 'protocol.v1', enrollmentStartAt: 0, enrollmentEndAt: 1, cutoff: 2 },
    provenance: { kind: 'aggregate_snapshot', sourceVersion: LEARN_V2_MEASUREMENT_REPORT_SOURCE_VERSION, queryVersion: LEARN_V2_MEASUREMENT_REPORT_QUERY_VERSION,
      adapterVersion: 'adapter.v1', codeVersion: 'code.v1', rosterDigest: digest, inputDigest: digest, cutoff: 2,
      extractionStartedAt: 2, extractionEndedAt: 3, sourceCoverage: 'complete', episodeCount: 3, inputBytes: 1024, bootstrapSeed: digest, bootstrapReplicates: 10000 },
  }, page }
  const readPage = makeFunctionReference<'query'>('reportContractFixture:page')
  const readExport = makeFunctionReference<'query'>('reportContractFixture:exported')
  expect(validateLearnMeasurementReportCells(await t.query(readPage, {}))).toEqual(page)
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
  Reflect.set(cell.sourceAccounting, 'learnerRows', [{ response: 'private-payload-canary' }])
  await expect(t.query(readPage, {})).rejects.toThrow()
  await expect(t.query(readExport, {})).rejects.toThrow()
})
