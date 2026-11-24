/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { getDocumentSize, v } from 'convex/values'
import { makeFunctionReference, type FunctionArgs } from 'convex/server'
import { internalAction, internalMutation } from './_generated/server'
import * as reportFunctions from './learnV2MeasurementReports'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'
import { LEARN_REPORT_APPROVALS, reportControl } from './lib/learnV2MeasurementReportAccess'
import * as source from './lib/learnV2MeasurementReportSource'
import * as reportAudit from './lib/learnV2MeasurementReportAudit'
import { appendLearnMeasurementFact, writeLearnMeasurementEnrollmentFact } from './lib/learnV2MeasurementFacts'
import {
  LEARN_V2_MEASUREMENT_REPORT_VERSION as version, LEARN_V2_MEASUREMENT_REPORT_QUERY_VERSION as queryVersion,
  buildLearningMeasurementReport, buildPublishedLearningMeasurementReport, type LearnPublishedReportMetric,
} from '../shared/learn-v2-measurement-report'
import { REPORT_NOW, REPORT_START, REPORT_END, seedReportSource, seedOrdinaryReportClaim, seedReportClaimLink } from '../tests/fixtures/learn-v2-measurement-report-source'
import { sealedMeasurementReportInput } from '../tests/fixtures/learn-v2-measurement-report-run'
import { STORAGE_CANARIES } from '../tests/fixtures/learn-v2-measurement-storage'
import type { LearnV2ReportCells } from './lib/learnV2PublicContract'
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
const originalSealReport = makeFunctionReference<'mutation', FunctionArgs<typeof internal.learnV2MeasurementReports.sealReport>, null>('measurementReportRecoveryOriginals:sealReport')
beforeEach(() => { capabilities.reports = true; capabilities.maxInputBytes = 64 * 1024 * 1024; capabilities.maxEpisodes = 10_000; LEARN_REPORT_APPROVALS.splice(0); vi.useFakeTimers(); vi.setSystemTime(REPORT_NOW) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); LEARN_REPORT_APPROVALS.splice(0) })
async function fixture(count = 5, mode: 'scored' | 'missing' | 'unscored' = 'scored', overrides: Partial<typeof reportFunctions> = {}, transactionLimits = false) {
  const t = convexTest({ schema, transactionLimits, modules: { ...modules,
    './learnV2MeasurementReports.ts': async () => ({ ...reportFunctions, ...overrides }),
    './measurementReportRecoveryOriginals.ts': async () => ({ sealReport: reportFunctions.sealReport }),
  } })
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
    return viewer.mutation(api.learnV2MeasurementReports.readReportManifest, { version, reportRunId })
  }
  return { t, sources, viewer, grantId, request, begin, complete }
}
async function allCells(f: Awaited<ReturnType<typeof fixture>>, reportRunId: Id<'learnMeasurementReportRuns'>) {
  const cells: LearnPublishedReportMetric[] = []
  let cursor: string | null = null
  for (let pageIndex = 0; pageIndex < 100; pageIndex++) {
    const page: LearnV2ReportCells = await f.viewer.mutation(api.learnV2MeasurementReports.readReportCells, { version, reportRunId, cursor })
    if ('status' in page) throw new Error(JSON.stringify(page))
    cells.push(...page.cells)
    if (page.isDone) return cells
    cursor = page.cursor
  }
  throw new Error('stuck fixture cursor')
}
// Recomputes the unpublished cells from the sealed rows and proves the server released exactly their published form.
async function computedCells(f: Awaited<ReturnType<typeof fixture>>, reportRunId: Id<'learnMeasurementReportRuns'>) {
  const input = await sealedMeasurementReportInput(f.t, reportRunId)
  const published = await buildPublishedLearningMeasurementReport(input)
  expect(await allCells(f, reportRunId)).toEqual(published.pages.flatMap(page => page.cells))
  return (await buildLearningMeasurementReport(input)).pages.flatMap(page => page.cells)
}

describe('bounded real-table report snapshots', () => {
  test('rejects 601 owners before creating a run or scheduling work, but accepts 600', async () => {
    const f = await fixture()
    const approval = LEARN_REPORT_APPROVALS[0]!
    const owners = Array.from({ length: 601 }, (_, index) => `https://learner.example|capacity-${index}`)
    approval.owners = owners
    expect(await f.viewer.mutation(api.learnV2MeasurementReports.requestReport, f.request))
      .toMatchObject({ status: 'unavailable', reasonCodes: ['roster_capacity_exceeded'] })
    expect(await f.t.run(ctx => ctx.db.query('learnMeasurementReportRuns').take(1))).toEqual([])
    expect(await f.t.run(ctx => ctx.db.query('learnMeasurementReportRows').take(1))).toEqual([])
    expect(await f.t.run(ctx => ctx.db.system.query('_scheduled_functions').take(1))).toEqual([])
    approval.owners = owners.slice(0, 600)
    expect(await f.viewer.mutation(api.learnV2MeasurementReports.requestReport, f.request)).toMatchObject({ status: 'requested' })
  })

  test.each([0, 1])('normalizes a linked claim without the opportunity back-reference at sequence %i as unresolved', async checkSequence => {
    const f = await fixture()
    const claim = await f.t.run(ctx => seedOrdinaryReportClaim(ctx, f.sources[0]!))
    await f.t.run(ctx => ctx.db.patch(claim.firstCheckOpportunityId, { firstCheckClaim: undefined, checkSequence }))
    const runId = await f.begin()
    expect(await f.complete(runId)).toMatchObject({ status: 'sealed' })
    const cells = (await computedCells(f, runId)).filter(cell => cell.metric === 'false_mastery_next_delayed.v1'
      && cell.stratum.startingBand === 'all' && cell.weighting === 'capability_episode')
    expect(cells).toHaveLength(1)
    expect(cells[0]).toMatchObject({ horizonDays: null, counts: { maturedClaims: 1, checkedClaims: 0 },
      missingOutcomeBounds: { lower: 0, upper: 1 } })
    expect(cells[0]!.reasonCodes).toContain('first_slot_claim_missing')
    expect(reportControl((await f.t.run(ctx => ctx.db.get(runId)))!).claimCount).toBe(1)
  })

  test('still rejects conflicting opportunity and linked claim identities', async () => {
    const f = await fixture()
    const claim = await f.t.run(ctx => seedOrdinaryReportClaim(ctx, f.sources[0]!))
    await f.t.run(ctx => ctx.db.patch(claim.firstCheckOpportunityId, { firstCheckClaim: { ...claim.claim, claimKey: 'conflicting-claim' } }))
    const runId = await f.begin()
    expect(await f.complete(runId)).toMatchObject({ status: 'failed', reasonCodes: ['conflicting_first_slot'] })
    expect(reportControl((await f.t.run(ctx => ctx.db.get(runId)))!).cellPages).toEqual([])
  })

  test('seals multiple bounded source/cell pages and preserves independent negative-gain arithmetic', async () => {
    const fetch = vi.fn(() => { throw new Error('No model or network work is authorized') })
    vi.stubGlobal('fetch', fetch)
    const f = await fixture(9)
    const runId = await f.begin()
    expect(await f.complete(runId)).toMatchObject({ status: 'sealed', provenance: { sourceCoverage: 'complete', episodeCount: null, inputBytes: null } })
    const run = (await f.t.run(ctx => ctx.db.get(runId)))!
    expect(reportControl(run).sourcePages.slice(0, 2).map(page => page.count)).toEqual([8, 1])
    expect(reportControl(run).sourcePages.every(page => page.count <= 8)).toBe(true)
    const cells = await allCells(f, runId)
    expect(reportControl(run).cellPages.length).toBeGreaterThan(1)
    // Every fixture pair goes 60 -> 40: an eight-owner stratum has 8*(-20)/8 = -20.
    const cell = cells.find(value => value.metric === 'verified_learning_gain.v1' && value.horizonDays === 7 && value.stratum.startingBand === 'all' && value.weighting === 'capability_episode')!
    expect(cell).toMatchObject({ observedValue: -20, allEligibleValue: -20, missingOutcomeBounds: { lower: -20, upper: -20 }, counts: { considered: 8, comparablePairs: 8 } })
    expect(new Set(cells.flatMap(value => value.legacyIndependentAudit ? [JSON.stringify(value.legacyIndependentAudit)] : [])).size).toBe(1)
    expect(cells.some(value => value.stratum.entryPoint === 'today.alternate')).toBe(false)
    expect(cells).toHaveLength(20)
    const exported = await f.viewer.mutation(api.learnV2MeasurementReports.exportReportPage, { version, reportRunId: runId, cursor: null })
    const serialized = JSON.stringify(exported)
    for (const secret of [...Object.values(STORAGE_CANARIES), VIEWER.tokenIdentifier, OWNER, 'learnerKey', 'capabilityKey', 'submissionId', 'frozenConfiguration']) expect(serialized).not.toContain(secret)
    expect(exported).toMatchObject({ status: 'aggregate_page', manifest: { provenance: { cutoff: REPORT_NOW } } })
    expect(fetch).not.toHaveBeenCalled()
  })

  test.each(['missing', 'unscored'] as const)('retains %s outcomes without dropping admissions or imputing gains', async mode => {
    const f = await fixture(5, mode)
    const runId = await f.begin()
    expect(await f.complete(runId)).toMatchObject({ status: 'sealed' })
    const cell = (await computedCells(f, runId)).find(value => value.horizonDays === 7 && value.stratum.startingBand === 'all' && value.weighting === 'capability_episode')!
    // Missing both endpoints gives [-100,100]; cold=60 and missing delayed gives [-60,40].
    expect(cell.observedValue).toBeNull()
    expect(cell.allEligibleValue).toBeNull()
    expect(cell.missingOutcomeBounds).toEqual(mode === 'missing' ? { lower: -100, upper: 100 } : { lower: -60, upper: 40 })
    expect(cell.counts).toMatchObject({ considered: 5, maturedEpisodes: 5, acceptedSubmissions: mode === 'missing' ? 0 : 5 })
  })

  test('a singleton cohort reads exactly like an empty one, withholding its cold score from cells and the owner export', async () => {
    const f = await fixture(1, 'unscored')
    const runId = await f.begin()
    const empty = { status: 'failed', reasonCodes: ['no_eligible_population'] }
    expect(await f.complete(runId)).toMatchObject(empty)
    expect(await f.t.run(ctx => ctx.db.query('learnMeasurementReportCells').withIndex('by_reportRunId_and_sequence', q => q.eq('reportRunId', runId)).take(1))).toEqual([])
    const exported = await f.viewer.mutation(api.learnV2MeasurementReports.exportReportPage, { version, reportRunId: runId, cursor: null })
    expect(exported).toMatchObject(empty)
    expect(JSON.stringify(exported)).not.toMatch(/"(lower|upper)":/)
  })

  test('withholds a sealed run from an earlier publication policy and rebuilds instead of reusing it', async () => {
    const f = await fixture()
    const runId = await f.begin()
    await f.complete(runId)
    await f.t.run(ctx => ctx.db.patch(runId, { codeVersion: 'learn-v2.report-code.c6.2.v5' }))
    const stale = { status: 'stale', reasonCodes: ['report_policy_changed'] }
    expect(await f.viewer.mutation(api.learnV2MeasurementReports.readReportManifest, { version, reportRunId: runId })).toMatchObject(stale)
    expect(await f.viewer.mutation(api.learnV2MeasurementReports.readReportCells, { version, reportRunId: runId, cursor: null })).toMatchObject(stale)
    expect(await f.viewer.mutation(api.learnV2MeasurementReports.exportReportPage, { version, reportRunId: runId, cursor: null })).toMatchObject(stale)
    const rebuilt = await f.begin()
    expect(rebuilt).not.toBe(runId)
    expect(await f.complete(rebuilt)).toMatchObject({ status: 'sealed', provenance: { publicationPolicyVersion: 'learn-v2.report-publication.minimum-five-learners.v3' } })
  })

  test('enumerates an ordinary blocked first claim without an assignment or thread and preserves unknown state', async () => {
    const f = await fixture()
    await f.t.run(ctx => seedOrdinaryReportClaim(ctx, f.sources[0]!, false))
    const runId = await f.begin()
    expect(await f.complete(runId)).toMatchObject({ status: 'sealed' })
    const cells = (await computedCells(f, runId)).filter(value => value.metric === 'false_mastery_next_delayed.v1')
    expect(cells.length).toBeGreaterThan(0)
    expect(cells[0]).toMatchObject({ populationState: 'unknown', allEligibleValue: null, counts: { maturedClaims: 1, checkedClaims: 0 } })
    const rows = await f.t.run(ctx => ctx.db.query('learnMeasurementReportRows').withIndex('by_reportRunId_and_sequence', q => q.eq('reportRunId', runId)).take(8))
    expect(rows.find(row => row.rowKind === 'first_check_claim_v2')?.snapshot).toMatchObject({ firstSlot: { stateAtEligibility: 'unknown', acceptance: null, stateAtAcceptance: null } })
  })

  test.each(['unresolved', 'late'] as const)('seals one %s v2 claim, retaining its reason and deletion scope', async slotState => {
    const f = await fixture()
    const claim = await f.t.run(ctx => seedOrdinaryReportClaim(ctx, f.sources[0]!, true, slotState))
    const runId = await f.begin()
    expect(await f.complete(runId)).toMatchObject({ status: 'sealed' })
    const cells = (await computedCells(f, runId)).filter(value => value.metric === 'false_mastery_next_delayed.v1'
      && value.stratum.startingBand === 'all' && value.weighting === 'capability_episode')
    expect(cells).toHaveLength(1)
    expect(cells[0]).toMatchObject({ counts: { maturedClaims: 1, checkedClaims: 0 }, allEligibleValue: null })
    expect(cells[0]!.reasonCodes).toContain(slotState === 'unresolved' ? 'no_qualifying_delayed_slot' : 'abandoned')
    expect(cells[0]!.horizonDays).toBe(slotState === 'unresolved' ? null : 7)
    const run = (await f.t.run(ctx => ctx.db.get(runId)))!
    expect(reportControl(run).claimCount).toBe(1)
    const rows = await f.t.run(ctx => ctx.db.query('learnMeasurementReportRows').withIndex('by_reportRunId_and_sequence', q => q.eq('reportRunId', runId)).take(8))
    const saved = rows.filter(row => row.rowKind === 'first_check_claim_v2')
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ learningVoidId: f.sources[0]!.learningVoidId, facts: { claimKey: claim.claim.claimKey, claimSequence: 1 } })
    const serialized = JSON.stringify(await f.viewer.mutation(api.learnV2MeasurementReports.exportReportPage, { version, reportRunId: runId, cursor: null }))
    for (const secret of [...Object.values(STORAGE_CANARIES), OWNER, claim.claim.claimKey, claim.claim.basisAttemptId, claim.firstCheckOpportunityId]) expect(serialized).not.toContain(secret)
  })

  test.each(['watermark', 'cutoff'] as const)('a post-%s link cannot replace the pinned unresolved claim', async boundary => {
    const f = await fixture()
    const claim = await f.t.run(ctx => seedOrdinaryReportClaim(ctx, f.sources[0]!, true, 'unresolved'))
    const runId = await f.begin()
    if (boundary === 'watermark') await f.t.mutation(internal.learnV2MeasurementReports.pinReportOwners, { reportRunId: runId })
    await f.t.run(ctx => seedReportClaimLink(ctx, f.sources[0]!, claim, REPORT_NOW + (boundary === 'cutoff' ? 1 : -1)))
    expect(await f.complete(runId)).toMatchObject({ status: 'sealed' })
    const cell = (await computedCells(f, runId)).find(value => value.metric === 'false_mastery_next_delayed.v1'
      && value.stratum.startingBand === 'all' && value.weighting === 'capability_episode')!
    expect(cell).toMatchObject({ horizonDays: null, counts: { maturedClaims: 1, checkedClaims: 0 } })
    expect(cell.reasonCodes).toContain('no_qualifying_delayed_slot')
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
    expect((await computedCells(f, runId)).some(cell => cell.allEligibleValue === -20)).toBe(true)
    await f.t.action(internal.learnV2MeasurementReports.finalizeReport, { reportRunId: runId })
    expect(await allCells(f, runId)).toEqual(before)
    expect(await f.begin()).toBe(runId)
  })

  test('missing source pages cannot seal', async () => {
    const f = await fixture(1)
    const runId = await f.begin()
    await f.t.mutation(internal.learnV2MeasurementReports.pinReportOwners, { reportRunId: runId })
    await f.t.action(internal.learnV2MeasurementReports.buildReportBatch, { reportRunId: runId })
    await f.t.action(internal.learnV2MeasurementReports.buildReportBatch, { reportRunId: runId })
    await f.t.run(async ctx => { const row = await ctx.db.query('learnMeasurementReportRows').withIndex('by_reportRunId_and_sequence', q => q.eq('reportRunId', runId).eq('sequence', 2)).unique(); await ctx.db.delete(row!._id) })
    await f.t.action(internal.learnV2MeasurementReports.finalizeReport, { reportRunId: runId })
    expect(await f.viewer.mutation(api.learnV2MeasurementReports.readReportManifest, { version, reportRunId: runId })).toMatchObject({ status: 'failed', reasonCodes: ['source_manifest_mismatch'] })
  })

  test('oversized source records fail incomplete instead of silently truncating', async () => {
    const f = await fixture()
    const runId = await f.begin()
    await f.t.mutation(internal.learnV2MeasurementReports.pinReportOwners, { reportRunId: runId })
    capabilities.maxInputBytes = 1
    await f.t.action(internal.learnV2MeasurementReports.buildReportBatch, { reportRunId: runId })
    expect(await f.viewer.mutation(api.learnV2MeasurementReports.readReportManifest, { version, reportRunId: runId })).toMatchObject({ status: 'failed', reasonCodes: ['source_input_overflow'] })
  })
})

describe('viewer grants and current revocation', () => {
  test('direct request, manifest, page and export reject foreign and different-issuer principals', async () => {
    const f = await fixture()
    const runId = await f.begin()
    await f.complete(runId)
    for (const client of [f.t, f.t.withIdentity(FOREIGN), f.t.withIdentity({ tokenIdentifier: 'https://report.example|stranger', subject: 'stranger' })]) {
      await expect(client.mutation(api.learnV2MeasurementReports.requestReport, f.request)).rejects.toThrow()
      await expect(client.mutation(api.learnV2MeasurementReports.readReportManifest, { version, reportRunId: runId })).rejects.toThrow()
      await expect(client.mutation(api.learnV2MeasurementReports.readReportCells, { version, reportRunId: runId, cursor: null })).rejects.toThrow()
      await expect(client.mutation(api.learnV2MeasurementReports.exportReportPage, { version, reportRunId: runId, cursor: null })).rejects.toThrow()
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
    for (const reportRunId of [foreignId, missingId]) await expect(f.viewer.mutation(api.learnV2MeasurementReports.readReportManifest, { version, reportRunId })).rejects.toThrow('Learn access denied')
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
    await expect(f.viewer.mutation(api.learnV2MeasurementReports.readReportManifest, { version, reportRunId: runId })).rejects.toThrow('Learn access denied')
    await expect(f.viewer.mutation(api.learnV2MeasurementReports.readReportCells, { version, reportRunId: runId, cursor: null })).rejects.toThrow('Learn access denied')
    await expect(f.viewer.mutation(api.learnV2MeasurementReports.exportReportPage, { version, reportRunId: runId, cursor: null })).rejects.toThrow('Learn access denied')
  })

  test.each(['active', 'complete'] as const)('a %s requester deletion tombstone denies stale JWT replay', async status => {
    const f = await fixture()
    const runId = await f.begin()
    await f.complete(runId)
    await f.t.run(ctx => ctx.db.insert('accountDeletionJobs', { userId: VIEWER.tokenIdentifier, status, phase: 'learnV2', startedAt: REPORT_NOW, updatedAt: REPORT_NOW }))
    await expect(f.viewer.mutation(api.learnV2MeasurementReports.exportReportPage, { version, reportRunId: runId, cursor: null })).rejects.toThrow('deletion')
  })

  test('a source-owner tombstone immediately withholds cached aggregates before bounded deletion drains', async () => {
    const f = await fixture()
    const runId = await f.begin()
    await f.complete(runId)
    await f.t.run(ctx => ctx.db.insert('accountDeletionJobs', { userId: OWNER, status: 'active', phase: 'learnV2', startedAt: REPORT_NOW, updatedAt: REPORT_NOW }))
    expect(await f.viewer.mutation(api.learnV2MeasurementReports.readReportCells, { version, reportRunId: runId, cursor: null })).toMatchObject({ status: 'stale', reasonCodes: ['source_invalidated'] })
    expect(await f.viewer.mutation(api.learnV2MeasurementReports.exportReportPage, { version, reportRunId: runId, cursor: null })).toMatchObject({ status: 'stale' })
  })

  test('source purge immediately revokes reads even before all cached runs have been marked stale', async () => {
    const f = await fixture()
    const runId = await f.begin()
    await f.complete(runId)
    await f.t.mutation(internal.learnV2Retention.purgeSourceEvidence, { userId: OWNER, sourceIdentityId: f.sources[0]!.sourceIdentityId })
    expect(await f.viewer.mutation(api.learnV2MeasurementReports.readReportManifest, { version, reportRunId: runId })).toMatchObject({ status: 'stale' })
    expect(await f.viewer.mutation(api.learnV2MeasurementReports.exportReportPage, { version, reportRunId: runId, cursor: null })).toMatchObject({ status: 'stale' })
  })

  test('large post-watermark score history in another epoch leaves audited reads sealed until an integrity change', async () => {
    const f = await fixture(5, 'scored', {}, true)
    const runId = await f.begin()
    expect(await f.complete(runId)).toMatchObject({ status: 'sealed' })
    const owner = f.sources[0]!
    const score = await f.t.run(ctx => ctx.db.query('learnMeasurementReportFacts')
      .withIndex('by_userId_and_fact_kind', q => q.eq('userId', OWNER).eq('fact.kind', 'score')).first())
    if (!score) throw new Error('Missing score fixture')
    expect(getDocumentSize(score) * 12_000).toBeGreaterThan(16_777_216)
    const { _id, _creationTime, ...record } = score
    const watermark = (await f.t.run(ctx => ctx.db.get(owner.watermarkId)))!
    for (let offset = 0; offset < 12_000; offset += 200) await f.t.run(async ctx => {
      for (let index = 0; index < 200; index++) await ctx.db.insert('learnMeasurementReportFacts', {
        ...record, epoch: 'another-epoch', sequence: watermark.sequence + offset + index + 1,
      })
    })
    await f.t.run(ctx => ctx.db.patch(owner.watermarkId, { sequence: watermark.sequence + 12_000 }))
    expect(await f.viewer.mutation(api.learnV2MeasurementReports.readReportManifest, { version, reportRunId: runId })).toMatchObject({ status: 'sealed' })
    const page = await f.viewer.mutation(api.learnV2MeasurementReports.readReportCells, { version, reportRunId: runId, cursor: null })
    expect(page).toMatchObject({ reportRunId: runId, cells: expect.any(Array) })
    expect(page).not.toHaveProperty('status')
    for (const read of [api.learnV2MeasurementReports.exportReportPage, api.learnV2MeasurementReports.downloadReportPage]) {
      expect(await f.viewer.mutation(read, { version, reportRunId: runId, cursor: null })).toMatchObject({ status: 'aggregate_page' })
    }
    await f.t.run(async ctx => {
      const integrityEventId = await ctx.db.insert('learnResponseIntegrityEvents', { ...owner.base, learningVoidId: owner.learningVoidId,
        submissionId: owner.outcomes[1]!.submissionId, sequence: 1, sourceFactSequence: watermark.sequence + 12_001,
        kind: 'evidence_unavailable', reasonCode: 'source_invalidated', policyVersion: 'integrity.v1', effectiveAt: REPORT_NOW })
      await appendLearnMeasurementFact(ctx, OWNER, { epoch: 'another-epoch', learningVoidId: owner.learningVoidId, occurredAt: REPORT_NOW,
        fact: { kind: 'integrity', submissionId: owner.outcomes[1]!.submissionId, integrityEventId,
          currentEligibility: 'excluded', evidenceAvailable: false, bodyAvailability: 'available' } })
    })
    const stale = { status: 'stale', reasonCodes: ['source_invalidated'] }
    expect(await f.viewer.mutation(api.learnV2MeasurementReports.readReportManifest, { version, reportRunId: runId })).toMatchObject(stale)
    for (const read of [api.learnV2MeasurementReports.readReportCells, api.learnV2MeasurementReports.exportReportPage, api.learnV2MeasurementReports.downloadReportPage]) {
      expect(await f.viewer.mutation(read, { version, reportRunId: runId, cursor: null })).toMatchObject(stale)
    }
  }, 120_000)

  test('revocation byte budget exhaustion returns incomplete without throwing under transaction limits', async () => {
    const f = await fixture(9, 'scored', {}, true)
    const runId = await f.begin()
    expect(await f.complete(runId)).toMatchObject({ status: 'sealed' })
    const pins = await f.t.run(ctx => ctx.db.query('learnMeasurementReportRows')
      .withIndex('by_reportRunId_and_sequence', q => q.eq('reportRunId', runId)).take(9))
    for (const pin of pins) await f.t.run(ctx => ctx.db.patch(pin._id, { snapshot: { ...pin.snapshot, learnerKey: 'x'.repeat(900 * 1024) } }))
    const incomplete = { status: 'stale', reasonCodes: ['source_validation_incomplete'] }
    expect(await f.viewer.mutation(api.learnV2MeasurementReports.readReportManifest, { version, reportRunId: runId })).toMatchObject(incomplete)
    for (const read of [api.learnV2MeasurementReports.readReportCells, api.learnV2MeasurementReports.exportReportPage, api.learnV2MeasurementReports.downloadReportPage]) {
      expect(await f.viewer.mutation(read, { version, reportRunId: runId, cursor: null })).toMatchObject(incomplete)
    }
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
    expect(await f.viewer.mutation(api.learnV2MeasurementReports.readReportManifest, { version, reportRunId: runId })).toMatchObject({ status: 'stale' })
    vi.setSystemTime(REPORT_NOW + 1000)
    await f.t.run(async ctx => { for (const source of f.sources) await ctx.db.patch(source.watermarkId, { dueWorkThrough: REPORT_NOW + 1000 }) })
    const next = await f.viewer.mutation(api.learnV2MeasurementReports.requestReport, { ...f.request, cutoff: REPORT_NOW + 1000 })
    if (next.status !== 'requested') throw new Error('Expected refresh')
    expect(next.reportRunId).not.toBe(runId)
    expect(await f.complete(next.reportRunId)).toMatchObject({ status: 'sealed' })
    expect((await f.t.run(ctx => ctx.db.get(next.reportRunId)))!.inputDigest).not.toBe(inputDigest)
    const cell = (await computedCells(f, next.reportRunId)).find(value => value.horizonDays === 7 && value.stratum.startingBand === 'all' && value.weighting === 'capability_episode')!
    // Four pairs go 60 -> 40; the excluded delayed score leaves cold 60, so bounds are (4*-20 - 60)/5 and (4*-20 + 40)/5.
    expect(cell).toMatchObject({ observedValue: -20, allEligibleValue: null, missingOutcomeBounds: { lower: -28, upper: -8 }, counts: { comparablePairs: 4 } })
  })

  test('refresh creates a new run and exposes the dated last-completed manifest while building', async () => {
    const f = await fixture()
    const first = await f.begin()
    await f.complete(first)
    vi.setSystemTime(REPORT_NOW + 86_400_000)
    const next = await f.t.mutation(internal.learnV2MeasurementReports.dailyRefresh, f.request)
    if (next.status !== 'requested') throw new Error('Expected refresh')
    expect(next.reportRunId).not.toBe(first)
    expect(await f.viewer.mutation(api.learnV2MeasurementReports.readReportManifest, { version, reportRunId: next.reportRunId })).toMatchObject({
      status: 'sealed', reportRunId: first, query: { cutoff: REPORT_NOW }, provenance: { extractionEndedAt: REPORT_NOW },
    })
    expect((await reportAudits(f)).at(-1)).toMatchObject({ action: 'manifest', reportRunId: first })
    const jobs = await f.t.run(ctx => ctx.db.system.query('_scheduled_functions').collect())
    expect(jobs.some(job => job.name === 'learnV2MeasurementReports:dailyRefresh' && job.scheduledTime > REPORT_NOW + 86_400_000)).toBe(true)
  })
})

async function continuation(f: Awaited<ReturnType<typeof fixture>>, reportRunId: Id<'learnMeasurementReportRuns'>) {
  const run = (await f.t.run(ctx => ctx.db.get(reportRunId)))!
  if (!run.continuationId) throw new Error('Missing persisted report continuation')
  const job = await f.t.run(ctx => ctx.db.system.get('_scheduled_functions', run.continuationId!))
  return { run, job }
}

describe('report continuation recovery', () => {
  test.each(['success', 'failed', 'canceled'] as const)('recovers a building run whose current continuation is %s', async state => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const f = await fixture(1, 'scored', { finalizeReport: internalAction({
      args: { reportRunId: v.id('learnMeasurementReportRuns') }, returns: v.null(),
      handler: async () => { if (state === 'failed') throw new Error('report_worker_interrupted'); return null },
    }) })
    const reportRunId = await f.begin()
    if (state === 'canceled') {
      const current = await continuation(f, reportRunId)
      await f.t.run(ctx => ctx.scheduler.cancel(current.run.continuationId!))
    } else await f.t.finishAllScheduledFunctions(() => vi.runAllTimers())
    const before = await continuation(f, reportRunId)
    expect(before.run.status).toBe('building')
    expect(before.job?.state.kind).toBe(state)
    expect(errors).toHaveBeenCalledTimes(state === 'failed' ? 1 : 0)
    const replacement = await f.begin()
    expect(replacement).not.toBe(reportRunId)
    expect(await f.viewer.mutation(api.learnV2MeasurementReports.readReportManifest, { version, reportRunId })).toMatchObject({ status: 'failed', reasonCodes: ['continuation_lost'] })
    expect((await continuation(f, replacement)).job).toMatchObject({ name: 'learnV2MeasurementReports:pinReportOwners', state: { kind: 'pending' } })
    expect(await f.begin()).toBe(replacement)
  })

  test('recovers when the failure-recording RPC itself fails', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const f = await fixture(1, 'scored', { failReport: internalMutation({
      args: { reportRunId: v.id('learnMeasurementReportRuns'), reason: v.string(), stale: v.optional(v.boolean()) }, returns: v.null(),
      handler: async () => { throw new Error('failure_recorder_unavailable') },
    }) })
    vi.spyOn(source, 'readLearnReportFactPage').mockRejectedValueOnce(new Error('source_read_interrupted'))
    const reportRunId = await f.begin()
    await f.t.finishAllScheduledFunctions(() => vi.runAllTimers())
    const before = await continuation(f, reportRunId)
    expect(before.run.status).toBe('building')
    expect(before.job).toMatchObject({ name: 'learnV2MeasurementReports:buildReportBatch', state: { kind: 'failed' } })
    expect(errors).toHaveBeenCalledOnce()
    expect(await f.begin()).not.toBe(reportRunId)
    expect(await f.viewer.mutation(api.learnV2MeasurementReports.readReportManifest, { version, reportRunId })).toMatchObject({ status: 'failed', reasonCodes: ['continuation_lost'] })
  })

  test.each(['pending', 'inProgress'] as const)('expires a progress lease with a %s job without letting requests renew it', async state => {
    let started: () => void = () => {}
    let release: () => void = () => {}
    const running = new Promise<void>(resolve => { started = resolve })
    const gate = new Promise<void>(resolve => { release = resolve })
    const f = await fixture(1, 'scored', state === 'pending' ? {} : { buildReportBatch: internalAction({
      args: { reportRunId: v.id('learnMeasurementReportRuns') }, returns: v.null(),
      handler: async () => { started(); await gate; return null },
    }) })
    const reportRunId = await f.begin()
    await f.t.mutation(internal.learnV2MeasurementReports.pinReportOwners, { reportRunId })
    if (state === 'inProgress') { vi.runOnlyPendingTimers(); await running }
    const before = await continuation(f, reportRunId)
    expect(before.job?.state.kind).toBe(state)
    expect(before.run.progressDeadlineAt).toBe(REPORT_NOW + 15 * 60 * 1000)
    vi.setSystemTime(before.run.progressDeadlineAt! - 1)
    expect(await f.begin()).toBe(reportRunId)
    expect((await continuation(f, reportRunId)).run.progressDeadlineAt).toBe(before.run.progressDeadlineAt)
    vi.setSystemTime(before.run.progressDeadlineAt!)
    const replacement = await f.begin()
    expect(replacement).not.toBe(reportRunId)
    if (state === 'inProgress') { release(); await f.t.finishInProgressScheduledFunctions() }
    expect(await f.viewer.mutation(api.learnV2MeasurementReports.readReportManifest, { version, reportRunId })).toMatchObject({ status: 'failed', reasonCodes: ['progress_deadline_exceeded'] })
    expect((await continuation(f, replacement)).job?.state.kind).toBe('pending')
  })

  test('ignores a late valid seal after recovery and keeps the original terminal reason', async () => {
    let allowSeal = false
    const f = await fixture(5, 'scored', { sealReport: internalMutation({
      args: { reportRunId: v.id('learnMeasurementReportRuns'), cellCount: v.number(), inputDigest: v.string() }, returns: v.null(),
      handler: async (ctx, args) => allowSeal ? ctx.runMutation(originalSealReport, args) : null,
    }) })
    const reportRunId = await f.begin()
    await f.t.finishAllScheduledFunctions(() => vi.runAllTimers())
    const before = await continuation(f, reportRunId)
    expect(before.job?.state.kind).toBe('success')
    expect(before.run.status).toBe('building')
    const seal = { reportRunId, inputDigest: before.run.inputDigest!, cellCount: reportControl(before.run).cellPages.reduce((sum, page) => sum + page.count, 0) }
    expect(seal.cellCount).toBeGreaterThan(0)
    expect(await f.begin()).not.toBe(reportRunId)
    allowSeal = true
    await f.t.mutation(internal.learnV2MeasurementReports.sealReport, seal)
    await f.t.action(internal.learnV2MeasurementReports.finalizeReport, { reportRunId })
    await f.t.mutation(internal.learnV2MeasurementReports.failReport, { reportRunId, reason: 'late_worker_failure', stale: true })
    expect(await f.viewer.mutation(api.learnV2MeasurementReports.readReportManifest, { version, reportRunId })).toMatchObject({ status: 'failed', reasonCodes: ['continuation_lost'] })
  })

  test('tracks new steps, renews only on progress, and preserves a normally sealed run', async () => {
    const f = await fixture()
    const reportRunId = await f.begin()
    const initial = await continuation(f, reportRunId)
    expect(initial.job).toMatchObject({ name: 'learnV2MeasurementReports:pinReportOwners', state: { kind: 'pending' } })
    vi.setSystemTime(REPORT_NOW + 14 * 60 * 1000)
    await f.t.mutation(internal.learnV2MeasurementReports.pinReportOwners, { reportRunId })
    const progressed = await continuation(f, reportRunId)
    expect(progressed.run.continuationId).not.toBe(initial.run.continuationId)
    expect(progressed.job).toMatchObject({ name: 'learnV2MeasurementReports:buildReportBatch', state: { kind: 'pending' } })
    expect(progressed.run.progressDeadlineAt).toBe(Date.now() + 15 * 60 * 1000)
    vi.setSystemTime(initial.run.progressDeadlineAt! + 1)
    expect(await f.begin()).toBe(reportRunId)
    await f.t.finishAllScheduledFunctions(() => vi.runAllTimers())
    const sealed = await continuation(f, reportRunId)
    expect(sealed.run.status).toBe('sealed')
    expect(sealed.job).toMatchObject({ name: 'learnV2MeasurementReports:finalizeReport', state: { kind: 'success' } })
    await f.t.mutation(internal.learnV2MeasurementReports.failReport, { reportRunId, reason: 'late_worker_failure' })
    expect(await f.begin()).toBe(reportRunId)
    expect(await f.viewer.mutation(api.learnV2MeasurementReports.readReportManifest, { version, reportRunId })).toMatchObject({ status: 'sealed' })
  })

  test('rebuilds a legacy building run without persisted continuation metadata', async () => {
    const f = await fixture()
    const reportRunId = await f.begin()
    await f.t.run(ctx => ctx.db.patch(reportRunId, { continuationId: undefined, progressDeadlineAt: undefined }))
    expect(await f.begin()).not.toBe(reportRunId)
    expect(await f.viewer.mutation(api.learnV2MeasurementReports.readReportManifest, { version, reportRunId })).toMatchObject({ status: 'failed', reasonCodes: ['continuation_lost'] })
  })
})

describe('snapshot failure controls', () => {
  test.each(['pinning', 'extracting', 'computing'] as const)('owner deletion during %s terminates the run and retries allocate a new one', async phase => {
    const f = await fixture()
    const reportRunId = await f.begin()
    if (phase !== 'pinning') await f.t.mutation(internal.learnV2MeasurementReports.pinReportOwners, { reportRunId })
    if (phase === 'computing') {
      for (let batch = 0; batch < 40; batch++) {
        const run = (await f.t.run(ctx => ctx.db.get(reportRunId)))!
        if (reportControl(run).phase === 'computing') break
        await f.t.action(internal.learnV2MeasurementReports.buildReportBatch, { reportRunId })
      }
      expect(reportControl((await f.t.run(ctx => ctx.db.get(reportRunId)))!).phase).toBe('computing')
    }
    await f.t.run(ctx => ctx.db.insert('accountDeletionJobs', { userId: OWNER, status: 'active', phase: 'learnV2', startedAt: REPORT_NOW, updatedAt: REPORT_NOW }))
    if (phase === 'pinning') {
      expect(await f.t.mutation(internal.learnV2MeasurementReports.pinReportOwners, { reportRunId })).toEqual({ status: 'failed', reasonCode: 'source_invalidated' })
    } else if (phase === 'extracting') await f.t.action(internal.learnV2MeasurementReports.buildReportBatch, { reportRunId })
    else await f.t.action(internal.learnV2MeasurementReports.finalizeReport, { reportRunId })
    const manifest = await f.viewer.mutation(api.learnV2MeasurementReports.readReportManifest, { version, reportRunId })
    expect(['failed', 'stale']).toContain(manifest.status)
    expect(manifest).toMatchObject({ reasonCodes: ['source_invalidated'] })
    expect(await f.t.run(ctx => ctx.db.get(reportRunId))).toMatchObject({ status: manifest.status, sourceCoverage: 'unknown' })
    const retry = await f.begin()
    expect(retry).not.toBe(reportRunId)
    const fresh = await f.viewer.mutation(api.learnV2MeasurementReports.requestReport, { ...f.request, idempotencyKey: 'report-fixture-command-retry' })
    expect(fresh).toMatchObject({ status: 'requested', reportRunId: retry })
    const jobs = await f.t.run(ctx => ctx.db.system.query('_scheduled_functions').collect())
    expect(jobs.some(job => job.name === 'learnV2MeasurementReports:pinReportOwners' && job.args[0].reportRunId === retry)).toBe(true)
  })

  test('an expired grant during pinning records failure even though build authorization throws', async () => {
    const f = await fixture()
    const reportRunId = await f.begin()
    await f.t.run(ctx => ctx.db.patch(f.grantId, { expiresAt: REPORT_NOW }))
    expect(await f.t.mutation(internal.learnV2MeasurementReports.pinReportOwners, { reportRunId })).toEqual({ status: 'failed', reasonCode: 'report_access_revoked' })
    expect(await f.t.run(ctx => ctx.db.get(reportRunId))).toMatchObject({ status: 'failed', sourceCoverage: 'unknown', reasonCode: 'report_access_revoked' })
    await f.t.run(ctx => ctx.db.patch(f.grantId, { expiresAt: REPORT_NOW + 86_400_000 }))
    expect(await f.begin()).not.toBe(reportRunId)
  })

  test.each(['failed', 'stale'] as const)('a retry never reuses a %s run, including the original idempotency key', async status => {
    const f = await fixture()
    const reportRunId = await f.begin()
    await f.t.mutation(internal.learnV2MeasurementReports.failReport, { reportRunId, reason: 'source_invalidated', stale: status === 'stale' })
    const retry = await f.begin()
    expect(retry).not.toBe(reportRunId)
    await f.t.mutation(internal.learnV2MeasurementReports.failReport, { reportRunId, reason: 'late_build_failure' })
    expect(await f.viewer.mutation(api.learnV2MeasurementReports.readReportManifest, { version, reportRunId })).toMatchObject({ status, reasonCodes: ['source_invalidated'] })
    expect(await f.begin()).toBe(retry)
  })

  test('rejects nine-record pages and conflicting duplicate pages', async () => {
    const f = await fixture(1)
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
    expect(await g.viewer.mutation(api.learnV2MeasurementReports.readReportManifest, { version, reportRunId: stuck })).toMatchObject({ status: 'failed', reasonCodes: ['stuck_source_cursor'] })
    spy.mockRestore()
    const h = await fixture()
    const runId = await h.begin()
    await h.complete(runId)
    await h.t.run(async ctx => { const cell = await ctx.db.query('learnMeasurementReportCells').withIndex('by_reportRunId_and_sequence', q => q.eq('reportRunId', runId)).first(); await ctx.db.delete(cell!._id) })
    expect(await h.viewer.mutation(api.learnV2MeasurementReports.exportReportPage, { version, reportRunId: runId, cursor: null })).toMatchObject({ status: 'failed', reasonCodes: ['cell_manifest_mismatch'] })
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
  expect(await f.viewer.mutation(api.learnV2MeasurementReports.readReportManifest, { version, reportRunId: runId })).toMatchObject({ status: 'sealed' })
})

test('population overflow is checked against the configured ceiling before a page is committed', async () => {
  const f = await fixture(1)
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
  const f = await fixture(1)
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
  expect(await f.viewer.mutation(api.learnV2MeasurementReports.readReportManifest, { version, reportRunId: runId })).toMatchObject({ status: 'failed', reasonCodes: ['source_manifest_mismatch'] })
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
  expect(await f.viewer.mutation(api.learnV2MeasurementReports.readReportCells, { version, reportRunId: runId, cursor: null })).toMatchObject({ status: 'stale', reasonCodes: ['missing_owner_watermark'] })
})

test('a completed source purge rebuilds excluded outcomes without restoring private scorer evidence', async () => {
  const f = await fixture()
  const first = await f.begin()
  await f.complete(first)
  const owner = f.sources[0]!
  await f.t.mutation(internal.learnV2Retention.purgeSourceEvidence, { userId: OWNER, sourceIdentityId: owner.sourceIdentityId })
  await f.t.finishAllScheduledFunctions(vi.runAllTimers)
  vi.setSystemTime(REPORT_NOW + 1000)
  await f.t.run(async ctx => { for (const source of f.sources) await ctx.db.patch(source.watermarkId, { dueWorkThrough: REPORT_NOW + 1000 }) })
  const next = await f.viewer.mutation(api.learnV2MeasurementReports.requestReport, { ...f.request, cutoff: REPORT_NOW + 1000 })
  if (next.status !== 'requested') throw new Error('Expected refresh')
  expect(await f.complete(next.reportRunId)).toMatchObject({ status: 'sealed' })
  const cell = (await computedCells(f, next.reportRunId)).find(value => value.horizonDays === 7 && value.stratum.startingBand === 'all' && value.weighting === 'capability_episode')!
  expect(cell).toMatchObject({ observedValue: -20, allEligibleValue: null, sourceCoverage: 'complete', counts: { considered: 5, validColdScores: 4, validDelayedScores: 4, acceptedSubmissions: 5 } })
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
  await expect(f.viewer.mutation(api.learnV2MeasurementReports.readReportManifest, { version, reportRunId: runId })).rejects.toThrow('Learn access denied')
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
  expect(await f.viewer.mutation(api.learnV2MeasurementReports.readReportManifest, { version, reportRunId: runId })).toMatchObject({ status: 'failed', reasonCodes: ['source_input_overflow'] })
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
  expect(await f.viewer.mutation(api.learnV2MeasurementReports.readReportCells, { version, reportRunId: last, cursor: null })).toMatchObject({ status: 'stale', reasonCodes: ['source_invalidated'] })
})

test('an altered aggregate cell with the same page length fails its digest check', async () => {
  const f = await fixture()
  const runId = await f.begin()
  await f.complete(runId)
  await f.t.run(async ctx => {
    const cell = (await ctx.db.query('learnMeasurementReportCells').withIndex('by_reportRunId_and_sequence', q => q.eq('reportRunId', runId)).first())!
    await ctx.db.patch(cell._id, { stratum: { ...cell.stratum, entryPoint: 'fixture_corruption' } })
  })
  expect(await f.viewer.mutation(api.learnV2MeasurementReports.exportReportPage, { version, reportRunId: runId, cursor: null })).toMatchObject({ status: 'failed', reasonCodes: ['cell_manifest_mismatch'] })
})

test('a captured ordinary blocked first slot remains unresolved with its blocking disposition', async () => {
  const f = await fixture()
  await f.t.run(ctx => seedOrdinaryReportClaim(ctx, f.sources[0]!, true))
  const runId = await f.begin()
  await f.complete(runId)
  const cell = (await computedCells(f, runId)).find(value => value.metric === 'false_mastery_next_delayed.v1' && value.stratum.startingBand === 'all' && value.weighting === 'capability_episode')!
  expect(cell).toMatchObject({ populationState: 'known', counts: { maturedClaims: 1, checkedClaims: 0, dispositions: { access_provider_blocked: 1 } }, missingOutcomeBounds: { lower: 0, upper: 1 } })
})

test('an unanswered original slot retains its terminalization disposition', async () => {
  const f = await fixture(5, 'missing')
  await f.t.run(async ctx => {
    const id = f.sources[0]!.delayedId
    await appendLearnMeasurementFact(ctx, OWNER, { epoch: 'fixture-epoch', learningVoidId: f.sources[0]!.learningVoidId, occurredAt: REPORT_NOW,
      fact: { kind: 'opportunity', assessmentOpportunityId: id, recordRevision: 2, status: 'abandoned', dueAt: f.sources[0]!.clock.dueAt,
        closeAt: f.sources[0]!.clock.closeAt, clock: f.sources[0]!.clock, originalSlot: true } })
  })
  const runId = await f.begin()
  await f.complete(runId)
  const cell = (await computedCells(f, runId)).find(value => value.horizonDays === 7 && value.stratum.startingBand === 'all' && value.weighting === 'capability_episode')!
  expect(cell.counts.dispositions.abandoned).toBe(1)
})

async function reportAudits(f: Awaited<ReturnType<typeof fixture>>) {
  return f.t.run(ctx => ctx.db.query('learnMeasurementReportAccessAudits').withIndex('by_userId', q => q.eq('userId', VIEWER.tokenIdentifier)).take(129))
}

describe('report access audits', () => {
  test.each(['manifest', 'page', 'export', 'download'] as const)('records every %s page before releasing its closed result', async action => {
    const f = await fixture(9)
    const reportRunId = await f.begin()
    await f.complete(reportRunId)
    await f.t.run(async ctx => { for (const row of await ctx.db.query('learnMeasurementReportAccessAudits').take(129)) await ctx.db.delete(row._id) })
    let cursor: string | null = null
    let calls = 0
    for (let index = 0; index < 100; index++) {
      const reference = { version, reportRunId }
      calls++
      if (action === 'manifest') {
        expect(await f.viewer.mutation(api.learnV2MeasurementReports.readReportManifest, reference)).toMatchObject({ status: 'sealed' })
        break
      }
      const args: FunctionArgs<typeof api.learnV2MeasurementReports.readReportCells> = { ...reference, cursor }
      if (action === 'page') {
        const page: LearnV2ReportCells = await f.viewer.mutation(api.learnV2MeasurementReports.readReportCells, args)
        if ('status' in page) throw new Error('Expected audited cells')
        cursor = page.cursor
      } else {
        const result = action === 'export' ? await f.viewer.mutation(api.learnV2MeasurementReports.exportReportPage, args)
          : await f.viewer.mutation(api.learnV2MeasurementReports.downloadReportPage, args)
        if (result.status !== 'aggregate_page') throw new Error('Expected audited aggregate page')
        cursor = result.page.cursor
      }
      if (cursor === null) break
      if (index === 99) throw new Error('Audited pagination did not finish')
    }
    const rows = await reportAudits(f)
    expect(rows).toHaveLength(calls)
    if (action !== 'manifest') expect(calls).toBeGreaterThan(1)
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(['_creationTime', '_id', 'action', 'createdAt', 'reportRunId', 'status', 'userId'])
      expect(row).toMatchObject({ userId: VIEWER.tokenIdentifier, reportRunId, action, createdAt: REPORT_NOW,
        status: action === 'manifest' ? 'sealed' : action === 'page' ? 'read' : 'aggregate_page' })
      for (const secret of [...Object.values(STORAGE_CANARIES), OWNER, 'cohortVersion', 'inputDigest', 'rosterDigest', 'bootstrapSeed', 'cells']) expect(JSON.stringify(row)).not.toContain(secret)
    }
  })

  test('denied existing and missing references emit only a status and never a foreign reference or actor', async () => {
    const f = await fixture()
    const reportRunId = await f.begin()
    const references = await f.t.run(async ctx => {
      const { _id: _id, _creationTime: _time, ...fields } = (await ctx.db.get(reportRunId))!
      const foreign = await ctx.db.insert('learnMeasurementReportRuns', { ...fields, userId: FOREIGN.tokenIdentifier })
      const missing = await ctx.db.insert('learnMeasurementReportRuns', fields)
      await ctx.db.delete(missing)
      for (const row of await ctx.db.query('learnMeasurementReportAccessAudits').take(129)) await ctx.db.delete(row._id)
      return [foreign, missing]
    })
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})
    for (const id of references) {
      const reference = { version, reportRunId: id }
      const calls = [
        () => f.viewer.mutation(api.learnV2MeasurementReports.readReportManifest, reference),
        () => f.viewer.mutation(api.learnV2MeasurementReports.readReportCells, { ...reference, cursor: null }),
        () => f.viewer.mutation(api.learnV2MeasurementReports.exportReportPage, { ...reference, cursor: null }),
        () => f.viewer.mutation(api.learnV2MeasurementReports.downloadReportPage, { ...reference, cursor: null }),
        () => f.viewer.query(api.learnV2MeasurementReports.getReport, reference),
        () => f.viewer.query(api.learnV2MeasurementReports.getReportCells, { ...reference, cursor: null }),
        () => f.viewer.query(api.learnV2MeasurementReports.exportAggregateReport, { ...reference, cursor: null }),
      ]
      for (const call of calls) await expect(call()).rejects.toThrow('Learn access denied')
    }
    await expect(f.t.withIdentity(FOREIGN).mutation(api.learnV2MeasurementReports.requestReport, f.request)).rejects.toThrow('Learn access denied')
    await expect(f.t.mutation(api.learnV2MeasurementReports.downloadReportPage, { version, reportRunId, cursor: null })).rejects.toThrow('Unauthenticated')
    expect(log.mock.calls).toEqual(Array.from({ length: 16 }, () => [{ status: 'denied' }]))
    expect(await reportAudits(f)).toEqual([])
  })

  test('legacy query transports cannot bypass audited access while reports are enabled', async () => {
    const f = await fixture()
    const reportRunId = await f.begin()
    await f.complete(reportRunId)
    const before = await reportAudits(f)
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})
    const expected = { status: 'unavailable', reasonCodes: ['audited_access_required'] }
    expect(await f.viewer.query(api.learnV2MeasurementReports.getReport, { version, reportRunId })).toMatchObject(expected)
    expect(await f.viewer.query(api.learnV2MeasurementReports.getReportCells, { version, reportRunId, cursor: null })).toMatchObject(expected)
    expect(await f.viewer.query(api.learnV2MeasurementReports.exportAggregateReport, { version, reportRunId, cursor: null })).toMatchObject(expected)
    expect(log.mock.calls).toEqual(Array.from({ length: 3 }, () => [{ status: 'denied' }]))
    expect(await reportAudits(f)).toEqual(before)
  })

  test('an unavailable audit store fails closed without returning cells or logging a payload', async () => {
    const f = await fixture()
    const reportRunId = await f.begin()
    await f.complete(reportRunId)
    const before = await reportAudits(f)
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(reportAudit, 'writeReportAccessAudit').mockRejectedValueOnce(new Error('private-audit-error-canary'))
    await expect(f.viewer.mutation(api.learnV2MeasurementReports.exportReportPage, { version, reportRunId, cursor: null })).rejects.toThrow('Report audit unavailable')
    expect(log.mock.calls).toEqual([[{ status: 'failed' }]])
    expect(await reportAudits(f)).toEqual(before)
  })

  test('bounds each actor history and prunes expired audit rows in eight-row batches', async () => {
    const f = await fixture()
    const reportRunId = await f.begin()
    const other = await f.t.run(async ctx => {
      for (let index = 1; index < reportAudit.REPORT_ACCESS_AUDIT_LIMIT; index++) await ctx.db.insert('learnMeasurementReportAccessAudits', {
        userId: VIEWER.tokenIdentifier, reportRunId, action: 'manifest', status: 'building', createdAt: REPORT_NOW - index,
      })
      return ctx.db.insert('learnMeasurementReportAccessAudits', { userId: FOREIGN.tokenIdentifier, reportRunId: null,
        action: 'request', status: 'requested', createdAt: REPORT_NOW + reportAudit.REPORT_ACCESS_AUDIT_RETENTION_MS + 86_400_000 })
    })
    await f.viewer.mutation(api.learnV2MeasurementReports.readReportManifest, { version, reportRunId })
    expect(await reportAudits(f)).toHaveLength(reportAudit.REPORT_ACCESS_AUDIT_LIMIT)
    expect((await reportAudits(f)).some(row => row.action === 'manifest' && row.createdAt === REPORT_NOW)).toBe(true)
    await f.t.run(async ctx => { const run = (await ctx.db.get(reportRunId))!; await ctx.scheduler.cancel(run.continuationId!) })
    vi.setSystemTime(REPORT_NOW + reportAudit.REPORT_ACCESS_AUDIT_RETENTION_MS + 1)
    capabilities.reports = false
    await f.t.mutation(internal.learnV2MeasurementReports.purgeExpiredAccessAudits, {})
    expect(await reportAudits(f)).toHaveLength(reportAudit.REPORT_ACCESS_AUDIT_LIMIT - reportAudit.REPORT_ACCESS_AUDIT_BATCH)
    await f.t.finishAllScheduledFunctions(() => vi.runAllTimers())
    expect(await reportAudits(f)).toEqual([])
    expect(await f.t.run(ctx => ctx.db.get(other))).not.toBeNull()
  })

  test('actor account deletion drains audits even with reports off and cannot repopulate them', async () => {
    const f = await fixture()
    const reportRunId = await f.begin()
    await f.complete(reportRunId)
    const foreign = await f.t.run(ctx => ctx.db.insert('learnMeasurementReportAccessAudits', { userId: FOREIGN.tokenIdentifier, reportRunId: null,
      action: 'request', status: 'requested', createdAt: REPORT_NOW }))
    capabilities.reports = false
    await f.t.mutation(internal.accountDeletion.beginAccountDeletionForAuthUser, { userId: VIEWER.tokenIdentifier })
    await f.t.run(async ctx => {
      const job = (await ctx.db.query('accountDeletionJobs').withIndex('by_userId', q => q.eq('userId', VIEWER.tokenIdentifier)).unique())!
      await ctx.db.patch(job._id, { phase: 'learnV2' })
    })
    for (let batch = 0; batch < 5 && (await reportAudits(f)).length; batch++) await f.t.mutation(internal.accountDeletion.runDeletionBatch, { userId: VIEWER.tokenIdentifier })
    expect(await reportAudits(f)).toEqual([])
    expect(await f.t.run(ctx => ctx.db.get(foreign))).not.toBeNull()
    capabilities.reports = true
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})
    await expect(f.viewer.mutation(api.learnV2MeasurementReports.readReportManifest, { version, reportRunId })).rejects.toThrow('deletion')
    expect(log.mock.calls).toEqual([[{ status: 'denied' }]])
    expect(await reportAudits(f)).toEqual([])
  })

  test('capability-off access paths add no audit records or logs', async () => {
    const f = await fixture()
    const reportRunId = await f.begin()
    await f.t.run(async ctx => { for (const row of await ctx.db.query('learnMeasurementReportAccessAudits').take(129)) await ctx.db.delete(row._id) })
    capabilities.reports = false
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})
    const reference = { version, reportRunId }
    const page = { ...reference, cursor: null }
    const expected = { status: 'disabled', reasonCodes: ['disabled', 'protocol_not_frozen'] }
    expect(await f.viewer.mutation(api.learnV2MeasurementReports.requestReport, f.request)).toMatchObject(expected)
    expect(await f.viewer.query(api.learnV2MeasurementReports.getReport, reference)).toMatchObject(expected)
    expect(await f.viewer.query(api.learnV2MeasurementReports.getReportCells, page)).toMatchObject(expected)
    expect(await f.viewer.query(api.learnV2MeasurementReports.exportAggregateReport, page)).toMatchObject(expected)
    expect(await f.viewer.mutation(api.learnV2MeasurementReports.readReportManifest, reference)).toMatchObject(expected)
    expect(await f.viewer.mutation(api.learnV2MeasurementReports.readReportCells, page)).toMatchObject(expected)
    expect(await f.viewer.mutation(api.learnV2MeasurementReports.exportReportPage, page)).toMatchObject(expected)
    expect(await f.viewer.mutation(api.learnV2MeasurementReports.downloadReportPage, page)).toMatchObject(expected)
    await f.t.mutation(internal.learnV2MeasurementReports.purgeExpiredAccessAudits, {})
    expect(await reportAudits(f)).toEqual([])
    expect(log).not.toHaveBeenCalled()
  })

  test('records requests and scheduled refreshes with the closed payload-free fields', async () => {
    const f = await fixture()
    const reportRunId = await f.begin()
    expect(await f.t.mutation(internal.learnV2MeasurementReports.beginReportSnapshot, f.request)).toMatchObject({ status: 'requested', reportRunId })
    const refreshed = await f.t.mutation(internal.learnV2MeasurementReports.dailyRefresh, f.request)
    expect(refreshed).toMatchObject({ status: 'requested', reportRunId })
    const rows = await reportAudits(f)
    expect(rows).toHaveLength(3)
    expect(rows.map(row => row.action)).toEqual(['request', 'request', 'refresh'])
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(['_creationTime', '_id', 'action', 'createdAt', 'reportRunId', 'status', 'userId'])
      expect(row).toMatchObject({ userId: VIEWER.tokenIdentifier, reportRunId, status: 'requested', createdAt: REPORT_NOW })
      for (const secret of [...Object.values(STORAGE_CANARIES), OWNER, 'cohortVersion', 'inputDigest', 'rosterDigest', 'bootstrapSeed', 'cells']) expect(JSON.stringify(row)).not.toContain(secret)
    }
  })
})
