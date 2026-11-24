import type { TestConvex } from 'convex-test'
import type schema from '../../convex/schema'
import type { Id } from '../../convex/_generated/dataModel'
import { internal } from '../../convex/_generated/api'
import { reportControl } from '../../convex/lib/learnV2MeasurementReportAccess'
import { LEARN_V2_MEASUREMENT_REPORT_QUERY_VERSION, LEARN_V2_MEASUREMENT_REPORT_SOURCE_VERSION,
  type LearnReportInputSnapshot } from '../../shared/learn-v2-measurement-report'

export async function sealedMeasurementReportInput(t: TestConvex<typeof schema>, reportRunId: Id<'learnMeasurementReportRuns'>) {
  const run = await t.run(ctx => ctx.db.get(reportRunId))
  if (!run || run.status !== 'sealed' || !run.inputDigest || run.extractionEndedAt === undefined) throw new Error('Expected sealed report')
  const control = reportControl(run)
  const rows: LearnReportInputSnapshot[] = []
  while (rows.length < run.rowCount) {
    const page = await t.query(internal.learnV2MeasurementReports.readSourcePage, { reportRunId, after: rows.length })
    if (!page.length) throw new Error('Missing sealed report page')
    rows.push(...page.map(row => row.snapshot))
  }
  return { reportRunId, rows, roster: rows.slice(0, control.pinnedOwners).map(row => row.learnerKey),
    query: { version: LEARN_V2_MEASUREMENT_REPORT_QUERY_VERSION, cohortVersion: run.cohortVersion, epoch: run.epoch, protocolVersion: run.protocolVersion,
      enrollmentStartAt: run.enrollmentStartAt, enrollmentEndAt: run.enrollmentEndAt, cutoff: run.cutoff },
    provenance: { kind: 'aggregate_snapshot' as const, sourceVersion: LEARN_V2_MEASUREMENT_REPORT_SOURCE_VERSION,
      queryVersion: LEARN_V2_MEASUREMENT_REPORT_QUERY_VERSION, adapterVersion: run.adapterVersion, codeVersion: run.codeVersion,
      rosterDigest: run.rosterDigest, inputDigest: run.inputDigest, cutoff: run.cutoff, extractionStartedAt: run.extractionStartedAt,
      extractionEndedAt: run.extractionEndedAt, sourceCoverage: run.sourceCoverage, episodeCount: control.episodeCount,
      inputBytes: run.inputBytes, bootstrapSeed: run.bootstrapSeed, bootstrapReplicates: 10_000 as const } }
}
