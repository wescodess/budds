/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'
import { LEARN_REPORT_APPROVALS, reportControl } from './lib/learnV2MeasurementReportAccess'
import * as source from './lib/learnV2MeasurementReportSource'
import { appendLearnMeasurementFact, writeLearnMeasurementEnrollmentFact } from './lib/learnV2MeasurementFacts'
import { LEARN_V2_MEASUREMENT_REPORT_VERSION as version, LEARN_V2_MEASUREMENT_REPORT_QUERY_VERSION as queryVersion } from '../shared/learn-v2-measurement-report'
import { REPORT_NOW, REPORT_START, REPORT_END, seedReportSource, seedOrdinaryReportClaim } from '../tests/fixtures/learn-v2-measurement-report-source'
import { STORAGE_CANARIES } from '../tests/fixtures/learn-v2-measurement-storage'
import type { LearnV2ReportCells } from './lib/learnV2PublicContract'
import type { LearnReportMetric } from '../shared/learn-v2-measurement-report'
import type { Id } from './_generated/dataModel'

const capabilities = vi.hoisted(() => ({ reports: true, maxInputBytes: 64 * 1024 * 1024, maxEpisodes: 10_000 }))
vi.mock('../shared/learn-v2-measurement-storage-manifest', async importOriginal => {
  const original = await importOriginal<typeof import('../shared/learn-v2-measurement-storage-manifest')>()
  return { ...original, LEARN_MEASUREMENT_STORAGE_LIMITS: { ...original.LEARN_MEASUREMENT_STORAGE_LIMITS, get maxReportInputBytes() { return capabilities.maxInputBytes }, get maxReportEpisodes() { return capabilities.maxEpisodes } }, LEARN_MEASUREMENT_CAPABILITIES: { ...original.LEARN_MEASUREMENT_CAPABILITIES, get reports() { return capabilities.reports } } }
})
const VIEWER = { tokenIdentifier: 'https://report.example|project-owner', subject: 'project-owner' }
const FOREIGN = { tokenIdentifier: 'https://elsewhere.example|project-owner', subject: 'project-owner' }
const OWNER = 'https://learner.example|learner-1'
const modules = import.meta.glob('./**/*.ts')
beforeEach(() => { capabilities.reports = true; capabilities.maxInputBytes = 64 * 1024 * 1024; capabilities.maxEpisodes = 10_000; LEARN_REPORT_APPROVALS.splice(0); vi.useFakeTimers(); vi.setSystemTime(REPORT_NOW) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); LEARN_REPORT_APPROVALS.splice(0) })
async function fixture(count = 1, mode: 'scored' | 'missing' | 'unscored' = 'scored') {
  const t = convexTest(schema, modules)
  const sources: Awaited<ReturnType<typeof seedReportSource>>[] = []
  for (let index = 0; index < count; index++) sources.push(await t.run(ctx => seedReportSource(ctx, index === 0 ? OWNER : `https://learner.example|learner-${index + 1}`, mode)))
  if (count > 8) await t.run(async ctx => {
    const id = sources[8]!.rows.learnMeasurementAssignments
    await ctx.db.patch(id, { entryPoint: 'today.alternate' })
    await writeLearnMeasurementEnrollmentFact(ctx, sources[8]!.base.userId, (await ctx.db.get(id))!)
  })
  LEARN_REPORT_APPROVALS.push({ tokenIdentifier: VIEWER.tokenIdentifier, principalBindingVersion: 'binding.fixture', grantVersion: 'grant.v1',
    cohortVersion: 'cohort.v1', epoch: 'fixture-epoch', protocolVersion: 'protocol.fixture', baselineSha: 'a'.repeat(40),
    frozenAt: REPORT_START - 1, owners: sources.map(value => value.base.userId), replacementPolicy: { kind: 'secondary_only' } })
  const grantId = await t.run(ctx => ctx.db.insert('learnMeasurementReportViewerGrants', { userId: VIEWER.tokenIdentifier,
    storageVersion: 'learn-v2.measurement-storage.v1', createdAt: REPORT_NOW, cohortVersion: 'cohort.v1', epoch: 'fixture-epoch',
    principalBindingVersion: 'binding.fixture', grantVersion: 'grant.v1', status: 'active', grantedAt: REPORT_NOW - 1000, expiresAt: REPORT_NOW + 10 * 86_400_000 }))
  const viewer = t.withIdentity(VIEWER)
  const request = { version: queryVersion, viewerGrantId: grantId, idempotencyKey: 'report-fixture-command-0001',
    enrollmentStartAt: REPORT_START, enrollmentEndAt: REPORT_END, cutoff: REPORT_NOW }
  const begin = async () => {
    const result = await viewer.mutation(api.learnV2MeasurementReports.requestReport, request)
    if (result.status !== 'requested') throw new Error(JSON.stringify(result))
    return result.reportRunId
  }
  const complete = async (reportRunId: Id<'learnMeasurementReportRuns'>) => {
    for (let index = 0; index < Math.ceil(count / 8); index++) await t.mutation(internal.learnV2MeasurementReports.pinReportOwners, { reportRunId })
    for (let batch = 0; batch < count * 8; batch++) {
      const run = (await t.run(ctx => ctx.db.get(reportRunId)))!
      if (run.status !== 'building' || reportControl(run).phase !== 'extracting') break
      await t.action(internal.learnV2MeasurementReports.buildReportBatch, { reportRunId })
    }
    await t.action(internal.learnV2MeasurementReports.finalizeReport, { reportRunId })
    return viewer.query(api.learnV2MeasurementReports.getReport, { version, reportRunId })
  }
  return { t, sources, viewer, grantId, request, begin, complete }
}
async function allCells(f: Awaited<ReturnType<typeof fixture>>, reportRunId: Id<'learnMeasurementReportRuns'>) {
  const cells: LearnReportMetric[] = []
  let cursor: string | null = null
  for (let pageIndex = 0; pageIndex < 100; pageIndex++) {
    const page: LearnV2ReportCells = await f.viewer.query(api.learnV2MeasurementReports.getReportCells, { version, reportRunId, cursor })
    if ('status' in page) throw new Error(JSON.stringify(page))
    cells.push(...page.cells)
    if (page.isDone) return cells
    cursor = page.cursor
  }
  throw new Error('stuck fixture cursor')
}

describe('bounded real-table report snapshots', () => {
  test('seals multiple bounded source/cell pages and preserves independent negative-gain arithmetic', async () => {
    const fetch = vi.fn(() => { throw new Error('No model or network work is authorized') })
    vi.stubGlobal('fetch', fetch)
    const f = await fixture(9)
    const runId = await f.begin()
    expect(await f.complete(runId)).toMatchObject({ status: 'sealed', provenance: { sourceCoverage: 'complete', episodeCount: 9 } })
    const run = (await f.t.run(ctx => ctx.db.get(runId)))!
    expect(reportControl(run).sourcePages.slice(0, 2).map(page => page.count)).toEqual([8, 1])
    expect(reportControl(run).sourcePages.every(page => page.count <= 8)).toBe(true)
    const cells = await allCells(f, runId)
    expect(reportControl(run).cellPages.length).toBeGreaterThan(1)
    // Every fixture pair goes 60 -> 40: an eight-owner stratum has 8*(-20)/8 = -20.
    const cell = cells.find(value => value.metric === 'verified_learning_gain.v1' && value.horizonDays === 7 && value.stratum.startingBand === 'all' && value.weighting === 'capability_episode')!
    expect(cell).toMatchObject({ observedValue: -20, allEligibleValue: -20, missingOutcomeBounds: { lower: -20, upper: -20 }, counts: { considered: 9, comparablePairs: 8 } })
    expect(cells.every(value => JSON.stringify(value.legacyIndependentAudit) === JSON.stringify(cells[0]!.legacyIndependentAudit))).toBe(true)
    const exported = await f.viewer.query(api.learnV2MeasurementReports.exportAggregateReport, { version, reportRunId: runId, cursor: null })
    const serialized = JSON.stringify(exported)
    for (const secret of [...Object.values(STORAGE_CANARIES), VIEWER.tokenIdentifier, OWNER, 'learnerKey', 'capabilityKey', 'submissionId', 'frozenConfiguration']) expect(serialized).not.toContain(secret)
    expect(exported).toMatchObject({ status: 'aggregate_page', manifest: { provenance: { cutoff: REPORT_NOW } } })
    expect(fetch).not.toHaveBeenCalled()
  })

  test.each(['missing', 'unscored'] as const)('retains %s outcomes without dropping admissions or imputing gains', async mode => {
    const f = await fixture(1, mode)
    const runId = await f.begin()
    expect(await f.complete(runId)).toMatchObject({ status: 'sealed' })
    const cell = (await allCells(f, runId)).find(value => value.horizonDays === 7 && value.stratum.startingBand === 'all' && value.weighting === 'capability_episode')!
    // Missing both endpoints gives [-100,100]; cold=60 and missing delayed gives [-60,40].
    expect(cell.observedValue).toBeNull()
    expect(cell.allEligibleValue).toBeNull()
    expect(cell.missingOutcomeBounds).toEqual(mode === 'missing' ? { lower: -100, upper: 100 } : { lower: -60, upper: 40 })
    expect(cell.counts).toMatchObject({ considered: 1, maturedEpisodes: 1, acceptedSubmissions: mode === 'missing' ? 0 : 1 })
  })

  test('enumerates an ordinary blocked first claim without an assignment or thread and preserves unknown state', async () => {
    const f = await fixture()
    await f.t.run(ctx => seedOrdinaryReportClaim(ctx, f.sources[0]!, false))
    const runId = await f.begin()
    expect(await f.complete(runId)).toMatchObject({ status: 'sealed' })
    const cells = (await allCells(f, runId)).filter(value => value.metric === 'false_mastery_next_delayed.v1')
    expect(cells.length).toBeGreaterThan(0)
    expect(cells[0]).toMatchObject({ populationState: 'unknown', allEligibleValue: null, counts: { maturedClaims: 1, checkedClaims: 0 } })
    const rows = await f.t.run(ctx => ctx.db.query('learnMeasurementReportRows').withIndex('by_reportRunId_and_sequence', q => q.eq('reportRunId', runId)).take(8))
    expect(rows.find(row => row.rowKind === 'first_check_claim')?.snapshot).toMatchObject({ stateAtEligibility: 'unknown', acceptance: null, stateAtAcceptance: null })
  })

  test('coalesces request/build replay and excludes concurrent post-watermark changes', async () => {
    const f = await fixture()
    const [runId, repeated] = await Promise.all([f.begin(), f.begin()])
    expect(repeated).toBe(runId)
    await f.t.mutation(internal.learnV2MeasurementReports.pinReportOwners, { reportRunId: runId })
    const sourceOwner = f.sources[0]!
    await f.t.run(async ctx => {
      const fact = await ctx.db.get(sourceOwner.rows.learnMeasurementReportFacts)
      expect(fact).toBeNull()
      const assignment = (await ctx.db.get(sourceOwner.rows.learnMeasurementAssignments))!
      const enrollment = (await ctx.db.query('learnMeasurementReportFacts').withIndex('by_userId_and_fact_assignmentId', q => q.eq('userId', OWNER).eq('fact.assignmentId', assignment._id)).first())!
      if (enrollment.fact.kind !== 'enrollment') throw new Error('Missing enrollment')
      await appendLearnMeasurementFact(ctx, OWNER, { epoch: 'fixture-epoch', learningVoidId: sourceOwner.learningVoidId, occurredAt: REPORT_NOW + 1,
        fact: { ...enrollment.fact, recordRevision: 2, snapshot: { ...enrollment.fact.snapshot, anchorAt: null } } })
    })
    await Promise.all([f.t.action(internal.learnV2MeasurementReports.buildReportBatch, { reportRunId: runId }), f.t.action(internal.learnV2MeasurementReports.buildReportBatch, { reportRunId: runId })])
    await f.complete(runId)
    const before = await allCells(f, runId)
    expect(before.some(cell => cell.allEligibleValue === -20)).toBe(true)
    await f.t.action(internal.learnV2MeasurementReports.finalizeReport, { reportRunId: runId })
    expect(await allCells(f, runId)).toEqual(before)
    expect(await f.begin()).toBe(runId)
  })

  test('missing source pages cannot seal', async () => {
    const f = await fixture()
    const runId = await f.begin()
    await f.t.mutation(internal.learnV2MeasurementReports.pinReportOwners, { reportRunId: runId })
    await f.t.action(internal.learnV2MeasurementReports.buildReportBatch, { reportRunId: runId })
    await f.t.action(internal.learnV2MeasurementReports.buildReportBatch, { reportRunId: runId })
    await f.t.run(async ctx => { const row = await ctx.db.query('learnMeasurementReportRows').withIndex('by_reportRunId_and_sequence', q => q.eq('reportRunId', runId).eq('sequence', 2)).unique(); await ctx.db.delete(row!._id) })
    await f.t.action(internal.learnV2MeasurementReports.finalizeReport, { reportRunId: runId })
    expect(await f.viewer.query(api.learnV2MeasurementReports.getReport, { version, reportRunId: runId })).toMatchObject({ status: 'failed', reasonCodes: ['source_manifest_mismatch'] })
  })

  test('oversized source records fail incomplete instead of silently truncating', async () => {
    const f = await fixture()
    const runId = await f.begin()
    await f.t.mutation(internal.learnV2MeasurementReports.pinReportOwners, { reportRunId: runId })
    capabilities.maxInputBytes = 1
    await f.t.action(internal.learnV2MeasurementReports.buildReportBatch, { reportRunId: runId })
    expect(await f.viewer.query(api.learnV2MeasurementReports.getReport, { version, reportRunId: runId })).toMatchObject({ status: 'failed', reasonCodes: ['source_input_overflow'] })
  })
})

describe('viewer grants and current revocation', () => {
  test('direct request, manifest, page and export reject foreign and different-issuer principals', async () => {
    const f = await fixture()
    const runId = await f.begin()
    await f.complete(runId)
    for (const client of [f.t, f.t.withIdentity(FOREIGN), f.t.withIdentity({ tokenIdentifier: 'https://report.example|stranger', subject: 'stranger' })]) {
      await expect(client.mutation(api.learnV2MeasurementReports.requestReport, f.request)).rejects.toThrow()
      await expect(client.query(api.learnV2MeasurementReports.getReport, { version, reportRunId: runId })).rejects.toThrow()
      await expect(client.query(api.learnV2MeasurementReports.getReportCells, { version, reportRunId: runId, cursor: null })).rejects.toThrow()
      await expect(client.query(api.learnV2MeasurementReports.exportAggregateReport, { version, reportRunId: runId, cursor: null })).rejects.toThrow()
    }
    const foreignId = await f.t.run(async ctx => {
      const { _id: _id, _creationTime: _time, ...fields } = (await ctx.db.get(runId))!
      return ctx.db.insert('learnMeasurementReportRuns', { ...fields, userId: FOREIGN.tokenIdentifier })
    })
    const missingId = await f.t.run(async ctx => {
      const { _id: _id, _creationTime: _time, ...fields } = (await ctx.db.get(runId))!
      const id = await ctx.db.insert('learnMeasurementReportRuns', fields)
      await ctx.db.delete(id)
      return id
    })
    for (const reportRunId of [foreignId, missingId]) await expect(f.viewer.query(api.learnV2MeasurementReports.getReport, { version, reportRunId })).rejects.toThrow('Learn access denied')
  })

  test.each(['revoked', 'expired', 'binding', 'grantVersion', 'cohort', 'epoch', 'unapproved'] as const)('rechecks %s grant on every RPC and export', async change => {
    const f = await fixture()
    const runId = await f.begin()
    await f.complete(runId)
    if (change === 'unapproved') LEARN_REPORT_APPROVALS.splice(0)
    else await f.t.run(ctx => ctx.db.patch(f.grantId, change === 'revoked' ? { status: 'revoked', revokedAt: REPORT_NOW }
      : change === 'expired' ? { expiresAt: REPORT_NOW } : change === 'binding' ? { principalBindingVersion: 'forged' }
        : change === 'grantVersion' ? { grantVersion: 'forged' } : change === 'cohort' ? { cohortVersion: 'foreign.cohort' } : { epoch: 'foreign.epoch' }))
    await expect(f.viewer.mutation(api.learnV2MeasurementReports.requestReport, f.request)).rejects.toThrow('Learn access denied')
    await expect(f.viewer.query(api.learnV2MeasurementReports.getReport, { version, reportRunId: runId })).rejects.toThrow('Learn access denied')
    await expect(f.viewer.query(api.learnV2MeasurementReports.getReportCells, { version, reportRunId: runId, cursor: null })).rejects.toThrow('Learn access denied')
    await expect(f.viewer.query(api.learnV2MeasurementReports.exportAggregateReport, { version, reportRunId: runId, cursor: null })).rejects.toThrow('Learn access denied')
  })

  test.each(['active', 'complete'] as const)('a %s requester deletion tombstone denies stale JWT replay', async status => {
    const f = await fixture()
    const runId = await f.begin()
    await f.complete(runId)
    await f.t.run(ctx => ctx.db.insert('accountDeletionJobs', { userId: VIEWER.tokenIdentifier, status, phase: 'learnV2', startedAt: REPORT_NOW, updatedAt: REPORT_NOW }))
    await expect(f.viewer.query(api.learnV2MeasurementReports.exportAggregateReport, { version, reportRunId: runId, cursor: null })).rejects.toThrow('deletion')
  })

  test('a source-owner tombstone immediately withholds cached aggregates before bounded deletion drains', async () => {
    const f = await fixture()
    const runId = await f.begin()
    await f.complete(runId)
    await f.t.run(ctx => ctx.db.insert('accountDeletionJobs', { userId: OWNER, status: 'active', phase: 'learnV2', startedAt: REPORT_NOW, updatedAt: REPORT_NOW }))
    expect(await f.viewer.query(api.learnV2MeasurementReports.getReportCells, { version, reportRunId: runId, cursor: null })).toMatchObject({ status: 'stale', reasonCodes: ['source_invalidated'] })
    expect(await f.viewer.query(api.learnV2MeasurementReports.exportAggregateReport, { version, reportRunId: runId, cursor: null })).toMatchObject({ status: 'stale' })
  })

  test('source purge immediately revokes reads even before all cached runs have been marked stale', async () => {
    const f = await fixture()
    const runId = await f.begin()
    await f.complete(runId)
    await f.t.mutation(internal.learnV2Retention.purgeSourceEvidence, { userId: OWNER, sourceIdentityId: f.sources[0]!.sourceIdentityId })
    expect(await f.viewer.query(api.learnV2MeasurementReports.getReport, { version, reportRunId: runId })).toMatchObject({ status: 'stale' })
    expect(await f.viewer.query(api.learnV2MeasurementReports.exportAggregateReport, { version, reportRunId: runId, cursor: null })).toMatchObject({ status: 'stale' })
  })

  test('a later integrity fact revokes the old snapshot and a new run rebuilds permitted scalar evidence', async () => {
    const f = await fixture()
    const runId = await f.begin()
    await f.complete(runId)
    const inputDigest = (await f.t.run(ctx => ctx.db.get(runId)))!.inputDigest
    const owner = f.sources[0]!
    await f.t.run(async ctx => {
      const eventId = await ctx.db.insert('learnResponseIntegrityEvents', { ...owner.base, learningVoidId: owner.learningVoidId,
        submissionId: owner.outcomes[1]!.submissionId, sequence: 1, sourceFactSequence: 8, kind: 'evidence_unavailable',
        reasonCode: 'source_invalidated', policyVersion: 'integrity.v1', effectiveAt: REPORT_NOW })
      await ctx.db.patch(owner.outcomes[1]!.submissionId, { currentEligibility: 'excluded', evidenceStatus: 'evidence_unavailable' })
      await appendLearnMeasurementFact(ctx, OWNER, { epoch: 'fixture-epoch', learningVoidId: owner.learningVoidId, occurredAt: REPORT_NOW,
        fact: { kind: 'integrity', submissionId: owner.outcomes[1]!.submissionId, integrityEventId: eventId,
          currentEligibility: 'excluded', evidenceAvailable: false, bodyAvailability: 'available' } })
    })
    expect(await f.viewer.query(api.learnV2MeasurementReports.getReport, { version, reportRunId: runId })).toMatchObject({ status: 'stale' })
    vi.setSystemTime(REPORT_NOW + 1000)
    await f.t.run(ctx => ctx.db.patch(owner.watermarkId, { dueWorkThrough: REPORT_NOW + 1000 }))
    const next = await f.viewer.mutation(api.learnV2MeasurementReports.requestReport, { ...f.request, cutoff: REPORT_NOW + 1000 })
    if (next.status !== 'requested') throw new Error('Expected refresh')
    expect(next.reportRunId).not.toBe(runId)
    expect(await f.complete(next.reportRunId)).toMatchObject({ status: 'sealed' })
    expect((await f.t.run(ctx => ctx.db.get(next.reportRunId)))!.inputDigest).not.toBe(inputDigest)
    const cell = (await allCells(f, next.reportRunId)).find(value => value.horizonDays === 7 && value.stratum.startingBand === 'all' && value.weighting === 'capability_episode')!
    expect(cell).toMatchObject({ observedValue: null, allEligibleValue: null, missingOutcomeBounds: { lower: -60, upper: 40 } })
  })

  test('refresh creates a new run and exposes the dated last-completed manifest while building', async () => {
    const f = await fixture()
    const first = await f.begin()
    await f.complete(first)
    vi.setSystemTime(REPORT_NOW + 86_400_000)
    const next = await f.t.mutation(internal.learnV2MeasurementReports.dailyRefresh, f.request)
    if (next.status !== 'requested') throw new Error('Expected refresh')
    expect(next.reportRunId).not.toBe(first)
    expect(await f.viewer.query(api.learnV2MeasurementReports.getReport, { version, reportRunId: next.reportRunId })).toMatchObject({
      status: 'sealed', reportRunId: first, query: { cutoff: REPORT_NOW }, provenance: { extractionEndedAt: REPORT_NOW },
    })
    const jobs = await f.t.run(ctx => ctx.db.system.query('_scheduled_functions').collect())
    expect(jobs.some(job => job.name === 'learnV2MeasurementReports:dailyRefresh' && job.scheduledTime > REPORT_NOW + 86_400_000)).toBe(true)
  })
})

describe('snapshot failure controls', () => {
  test('rejects nine-record pages and conflicting duplicate pages', async () => {
    const f = await fixture()
    const runId = await f.begin()
    await f.t.mutation(internal.learnV2MeasurementReports.pinReportOwners, { reportRunId: runId })
    const page = await f.t.query(internal.learnV2MeasurementReports.readInventoryRecord, { reportRunId: runId, ownerIndex: 0, factId: (await f.t.run(ctx => ctx.db.query('learnMeasurementReportFacts').withIndex('by_userId_and_fact_assignmentId', q => q.eq('userId', OWNER).eq('fact.assignmentId', f.sources[0]!.rows.learnMeasurementAssignments)).first()))!._id })
    await expect(f.t.mutation(internal.learnV2MeasurementReports.saveSourcePage, { reportRunId: runId, sequence: 2, rows: Array(9).fill(page[0]) })).rejects.toThrow('source_page_overflow')
    await f.t.mutation(internal.learnV2MeasurementReports.saveSourcePage, { reportRunId: runId, sequence: 2, rows: page })
    const row = page[0]!
    if (row.snapshot.kind !== 'episode') throw new Error('Expected episode')
    await expect(f.t.mutation(internal.learnV2MeasurementReports.saveSourcePage, { reportRunId: runId, sequence: 2,
      rows: [{ ...row, snapshot: { ...row.snapshot, operationalEligibility: 'blocked' } }] })).rejects.toThrow('conflicting_source_page')
  })

  test('a real table-backed history overflow fails incomplete', async () => {
    const f = await fixture()
    await f.t.run(async ctx => {
      const opportunity = (await ctx.db.get(f.sources[0]!.delayedId))!
      for (let index = 0; index < 8; index++) await appendLearnMeasurementFact(ctx, OWNER, { epoch: 'fixture-epoch',
        learningVoidId: opportunity.learningVoidId, occurredAt: REPORT_NOW, fact: { kind: 'opportunity', assessmentOpportunityId: opportunity._id,
          recordRevision: index + 2, status: 'blocked', dueAt: opportunity.dueAt!, closeAt: opportunity.closeAt, clock: f.sources[0]!.clock, originalSlot: true } })
    })
    const runId = await f.begin()
    expect(await f.complete(runId)).toMatchObject({ status: 'failed', reasonCodes: ['opportunity_history_overflow'] })
  })

  test('missing watermarks, stuck cursors, and cell corruption cannot become complete reports', async () => {
    const f = await fixture()
    await f.t.run(ctx => ctx.db.delete(f.sources[0]!.watermarkId))
    const missing = await f.begin()
    expect(await f.complete(missing)).toMatchObject({ status: 'failed', reasonCodes: ['missing_owner_watermark'] })
    const g = await fixture()
    const stuck = await g.begin()
    await g.t.mutation(internal.learnV2MeasurementReports.pinReportOwners, { reportRunId: stuck })
    const spy = vi.spyOn(source, 'readLearnReportFactPage').mockResolvedValueOnce({ records: [], isDone: false, bytes: 0 })
    await g.t.action(internal.learnV2MeasurementReports.buildReportBatch, { reportRunId: stuck })
    expect(await g.viewer.query(api.learnV2MeasurementReports.getReport, { version, reportRunId: stuck })).toMatchObject({ status: 'failed', reasonCodes: ['stuck_source_cursor'] })
    spy.mockRestore()
    const h = await fixture()
    const runId = await h.begin()
    await h.complete(runId)
    await h.t.run(async ctx => { const cell = await ctx.db.query('learnMeasurementReportCells').withIndex('by_reportRunId_and_sequence', q => q.eq('reportRunId', runId)).first(); await ctx.db.delete(cell!._id) })
    expect(await h.viewer.query(api.learnV2MeasurementReports.exportAggregateReport, { version, reportRunId: runId, cursor: null })).toMatchObject({ status: 'failed', reasonCodes: ['cell_manifest_mismatch'] })
  })

  test('default-off report commands do not schedule work or invoke a model', async () => {
    const f = await fixture()
    capabilities.reports = false
    expect(await f.viewer.mutation(api.learnV2MeasurementReports.requestReport, f.request)).toMatchObject({ status: 'disabled' })
    expect(await f.t.run(ctx => ctx.db.query('learnMeasurementReportRuns').take(8))).toEqual([])
    expect(await f.t.run(ctx => ctx.db.system.query('_scheduled_functions').collect())).toEqual([])
  })
})

test('the registered scheduled pipeline completes without a model call', async () => {
  const f = await fixture()
  const runId = await f.begin()
  await f.t.finishAllScheduledFunctions(vi.runAllTimers)
  expect(await f.viewer.query(api.learnV2MeasurementReports.getReport, { version, reportRunId: runId })).toMatchObject({ status: 'sealed' })
})

test('population overflow is checked against the configured ceiling before a page is committed', async () => {
  const f = await fixture()
  capabilities.maxEpisodes = 0
  const runId = await f.begin()
  expect(await f.complete(runId)).toMatchObject({ status: 'failed', reasonCodes: ['source_input_overflow'] })
  expect(await f.t.run(ctx => ctx.db.query('learnMeasurementReportRows').withIndex('by_reportRunId_and_sequence', q => q.eq('reportRunId', runId)).take(8))).toHaveLength(1)
})

test('a fresh command at the same cutoff creates a new snapshot after a completed run', async () => {
  const f = await fixture()
  const first = await f.begin()
  await f.complete(first)
  const requested = await f.viewer.mutation(api.learnV2MeasurementReports.requestReport, { ...f.request, idempotencyKey: f.request.idempotencyKey + '_new' })
  expect(requested).toMatchObject({ status: 'requested' })
  if (requested.status !== 'requested') throw new Error('Expected refresh')
  expect(requested.reportRunId).not.toBe(first)
})

test('a missing source fact is diagnosed from the owner sequence, including across other epochs', async () => {
  const f = await fixture()
  await f.t.run(async ctx => {
    const row = await ctx.db.query('learnMeasurementReportFacts').withIndex('by_userId_and_sequence', q => q.eq('userId', OWNER).eq('sequence', 2)).unique()
    await ctx.db.delete(row!._id)
  })
  const runId = await f.begin()
  expect(await f.complete(runId)).toMatchObject({ status: 'failed', reasonCodes: ['missing_source_fact'] })
})

test('changing a normalized source row without its manifest cannot seal', async () => {
  const f = await fixture()
  const runId = await f.begin()
  await f.t.mutation(internal.learnV2MeasurementReports.pinReportOwners, { reportRunId: runId })
  await f.t.action(internal.learnV2MeasurementReports.buildReportBatch, { reportRunId: runId })
  await f.t.action(internal.learnV2MeasurementReports.buildReportBatch, { reportRunId: runId })
  await f.t.run(async ctx => {
    const row = (await ctx.db.query('learnMeasurementReportRows').withIndex('by_reportRunId_and_sequence', q => q.eq('reportRunId', runId).eq('sequence', 2)).unique())!
    if (row.snapshot.kind !== 'episode') throw new Error('Expected episode')
    await ctx.db.patch(row._id, { snapshot: { ...row.snapshot, assignment: { ...row.snapshot.assignment, historyStatus: 'unknown' } } })
  })
  await f.t.action(internal.learnV2MeasurementReports.finalizeReport, { reportRunId: runId })
  expect(await f.viewer.query(api.learnV2MeasurementReports.getReport, { version, reportRunId: runId })).toMatchObject({ status: 'failed', reasonCodes: ['source_manifest_mismatch'] })
})

test.each(['digest', 'cell_count', 'empty_cells', 'source_count', 'phase'] as const)('sealing rejects an incomplete %s clause', async clause => {
  const f = await fixture()
  const runId = await f.begin()
  await f.complete(runId)
  const run = (await f.t.run(ctx => ctx.db.get(runId)))!
  const control = reportControl(run)
  const cellCount = control.cellPages.reduce((sum, page) => sum + page.count, 0)
  control.phase = clause === 'phase' ? 'extracting' : 'computing'
  if (clause === 'source_count') control.sourcePages.pop()
  if (clause === 'empty_cells') control.cellPages = []
  await f.t.run(ctx => ctx.db.patch(runId, { status: 'building', cursor: JSON.stringify(control) }))
  await expect(f.t.mutation(internal.learnV2MeasurementReports.sealReport, { reportRunId: runId,
    inputDigest: clause === 'digest' ? 'forged' : run.inputDigest!, cellCount: clause === 'cell_count' ? cellCount + 1 : clause === 'empty_cells' ? 0 : cellCount })).rejects.toThrow('incomplete_report_manifest')
})

test('a lost live watermark invalidates cached output and internal reads enforce their page bound', async () => {
  const f = await fixture()
  const runId = await f.begin()
  await f.complete(runId)
  await expect(f.t.query(internal.learnV2MeasurementReports.readSourcePage, { reportRunId: runId, after: 0, count: 9 })).rejects.toThrow('invalid_source_page')
  await f.t.run(ctx => ctx.db.delete(f.sources[0]!.watermarkId))
  expect(await f.viewer.query(api.learnV2MeasurementReports.getReportCells, { version, reportRunId: runId, cursor: null })).toMatchObject({ status: 'stale', reasonCodes: ['missing_owner_watermark'] })
})

test('a completed source purge rebuilds excluded outcomes without restoring private scorer evidence', async () => {
  const f = await fixture()
  const first = await f.begin()
  await f.complete(first)
  const owner = f.sources[0]!
  await f.t.mutation(internal.learnV2Retention.purgeSourceEvidence, { userId: OWNER, sourceIdentityId: owner.sourceIdentityId })
  await f.t.finishAllScheduledFunctions(vi.runAllTimers)
  vi.setSystemTime(REPORT_NOW + 1000)
  await f.t.run(ctx => ctx.db.patch(owner.watermarkId, { dueWorkThrough: REPORT_NOW + 1000 }))
  const next = await f.viewer.mutation(api.learnV2MeasurementReports.requestReport, { ...f.request, cutoff: REPORT_NOW + 1000 })
  if (next.status !== 'requested') throw new Error('Expected refresh')
  expect(await f.complete(next.reportRunId)).toMatchObject({ status: 'sealed' })
  const cell = (await allCells(f, next.reportRunId)).find(value => value.horizonDays === 7 && value.stratum.startingBand === 'all' && value.weighting === 'capability_episode')!
  expect(cell).toMatchObject({ observedValue: null, allEligibleValue: null, counts: { considered: 1, validColdScores: 0, validDelayedScores: 0, acceptedSubmissions: 1 } })
  expect(await f.t.run(ctx => ctx.db.get(owner.outcomes[0]!.executionId!))).toMatchObject({ evidenceStatus: 'evidence_unavailable' })
})

test('another approved principal still cannot use this viewer grant', async () => {
  const f = await fixture()
  LEARN_REPORT_APPROVALS.push({ ...LEARN_REPORT_APPROVALS[0]!, tokenIdentifier: FOREIGN.tokenIdentifier })
  await expect(f.t.withIdentity(FOREIGN).mutation(api.learnV2MeasurementReports.requestReport, f.request)).rejects.toThrow('Learn access denied')
})

test('changing the approved roster cannot authorize a cached run under a different scope', async () => {
  const f = await fixture()
  const runId = await f.begin()
  await f.complete(runId)
  LEARN_REPORT_APPROVALS[0]!.owners = [FOREIGN.tokenIdentifier]
  await expect(f.viewer.query(api.learnV2MeasurementReports.getReport, { version, reportRunId: runId })).rejects.toThrow('Learn access denied')
})

test('raw source byte accounting is enforced even for pages without admissions', async () => {
  const f = await fixture()
  await f.t.run(async ctx => {
    const first = (await ctx.db.query('learnMeasurementReportFacts').withIndex('by_userId_and_sequence', q => q.eq('userId', OWNER).eq('sequence', 1)).unique())!
    await ctx.db.patch(first._id, { epoch: 'other.epoch' })
  })
  capabilities.maxInputBytes = 1
  const runId = await f.begin()
  await f.t.mutation(internal.learnV2MeasurementReports.pinReportOwners, { reportRunId: runId })
  await f.t.action(internal.learnV2MeasurementReports.buildReportBatch, { reportRunId: runId })
  expect(await f.viewer.query(api.learnV2MeasurementReports.getReport, { version, reportRunId: runId })).toMatchObject({ status: 'failed', reasonCodes: ['source_input_overflow'] })
})

test('invalidation is immediate for a cached run beyond the first eight cleanup rows', async () => {
  const f = await fixture()
  let last!: Id<'learnMeasurementReportRuns'>
  for (let index = 0; index < 9; index++) {
    const now = REPORT_NOW + index * 1000
    vi.setSystemTime(now)
    await f.t.run(ctx => ctx.db.patch(f.sources[0]!.watermarkId, { dueWorkThrough: now }))
    const next = await f.viewer.mutation(api.learnV2MeasurementReports.requestReport, { ...f.request, cutoff: now })
    if (next.status !== 'requested') throw new Error('Expected request')
    last = next.reportRunId
    expect(await f.complete(last)).toMatchObject({ status: 'sealed' })
  }
  await f.t.mutation(internal.learnV2Retention.purgeSourceEvidence, { userId: OWNER, sourceIdentityId: f.sources[0]!.sourceIdentityId })
  expect((await f.t.run(ctx => ctx.db.get(last)))!.status).toBe('sealed')
  expect(await f.viewer.query(api.learnV2MeasurementReports.getReportCells, { version, reportRunId: last, cursor: null })).toMatchObject({ status: 'stale', reasonCodes: ['source_invalidated'] })
})

test('an altered aggregate cell with the same page length fails its digest check', async () => {
  const f = await fixture()
  const runId = await f.begin()
  await f.complete(runId)
  await f.t.run(async ctx => {
    const cell = (await ctx.db.query('learnMeasurementReportCells').withIndex('by_reportRunId_and_sequence', q => q.eq('reportRunId', runId)).first())!
    await ctx.db.patch(cell._id, { reasonCodes: [...cell.reasonCodes, 'fixture_corruption'] })
  })
  expect(await f.viewer.query(api.learnV2MeasurementReports.exportAggregateReport, { version, reportRunId: runId, cursor: null })).toMatchObject({ status: 'failed', reasonCodes: ['cell_manifest_mismatch'] })
})

test('a captured ordinary blocked first slot remains unresolved with its blocking disposition', async () => {
  const f = await fixture()
  await f.t.run(ctx => seedOrdinaryReportClaim(ctx, f.sources[0]!, true))
  const runId = await f.begin()
  await f.complete(runId)
  const cell = (await allCells(f, runId)).find(value => value.metric === 'false_mastery_next_delayed.v1' && value.stratum.startingBand === 'all' && value.weighting === 'capability_episode')!
  expect(cell).toMatchObject({ populationState: 'known', counts: { maturedClaims: 1, checkedClaims: 0, dispositions: { access_provider_blocked: 1 } }, missingOutcomeBounds: { lower: 0, upper: 1 } })
})

test('an unanswered original slot retains its terminalization disposition', async () => {
  const f = await fixture(1, 'missing')
  await f.t.run(async ctx => {
    const id = f.sources[0]!.delayedId
    await appendLearnMeasurementFact(ctx, OWNER, { epoch: 'fixture-epoch', learningVoidId: f.sources[0]!.learningVoidId, occurredAt: REPORT_NOW,
      fact: { kind: 'opportunity', assessmentOpportunityId: id, recordRevision: 2, status: 'abandoned', dueAt: f.sources[0]!.clock.dueAt,
        closeAt: f.sources[0]!.clock.closeAt, clock: f.sources[0]!.clock, originalSlot: true } })
  })
  const runId = await f.begin()
  await f.complete(runId)
  const cell = (await allCells(f, runId)).find(value => value.horizonDays === 7 && value.stratum.startingBand === 'all' && value.weighting === 'capability_episode')!
  expect(cell.counts.dispositions.abandoned).toBe(1)
})
