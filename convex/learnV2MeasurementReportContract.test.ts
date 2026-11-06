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
  validateLearnMeasurementReportCells, type LearnReportMetric,
  type learnReportInputSnapshotSchema, type learnReportAssignmentSnapshotSchema, type learnReportResultSnapshotSchema,
} from '../shared/learn-v2-measurement-report'
import type { z } from 'zod'
import { seedMeasurementStorage } from '../tests/fixtures/learn-v2-measurement-storage'
import { partialMeasurementReportCell } from '../tests/fixtures/learn-v2-measurement-report'

const modules = import.meta.glob('./**/*.ts')

test('stored, public and exported cells have exactly the same frozen fields', () => {
  expectTypeOf<Infer<typeof learnReportMetricValidator>>().toEqualTypeOf<LearnReportMetric>()
  expectTypeOf<Pick<Doc<'learnMeasurementReportCells'>, keyof LearnReportMetric>>().toEqualTypeOf<LearnReportMetric>()
  expectTypeOf<Infer<typeof learnReportInputSnapshotValidator>>().toEqualTypeOf<z.infer<typeof learnReportInputSnapshotSchema>>()
  expectTypeOf<Doc<'learnMeasurementReportRows'>['snapshot']>().toEqualTypeOf<z.infer<typeof learnReportInputSnapshotSchema>>()
  expectTypeOf<Infer<typeof learnReportAssignmentSnapshotValidator>>().toEqualTypeOf<z.infer<typeof learnReportAssignmentSnapshotSchema>>()
  expectTypeOf<Infer<typeof learnReportResultSnapshotValidator>>().toEqualTypeOf<z.infer<typeof learnReportResultSnapshotSchema>>()
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
