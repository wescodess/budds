import { v } from 'convex/values'
import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'
import { mutation, query, internalAction, internalMutation, internalQuery } from './_generated/server'
import { internal } from './_generated/api'
import {
  aggregateExportValidator, parsePublicLearnRequest, reportCellsValidator, reportPageArgs, reportPageSchema,
  reportReferenceArgs, reportReferenceSchema, reportValidator, requestReportArgs, requestReportSchema, requestReportValidator,
  type LearnV2AggregateExport, type LearnV2Report, type LearnV2ReportCells, type LearnV2ReportRequest,
} from './lib/learnV2PublicContract'
import {
  LEARN_V2_MEASUREMENT_REPORT_VERSION as version, LEARN_V2_MEASUREMENT_REPORT_SOURCE_VERSION as sourceVersion,
  LEARN_V2_MEASUREMENT_REPORT_QUERY_VERSION as queryVersion, deriveLearnReportLearnerKey,
  buildPublishedLearningMeasurementReport, fingerprintLearnReportInput, reconcileLearnReportSourceRows,
  learnReportInputSnapshotSchema, learnPublishedReportMetricSchema, validateLearnPublishedMeasurementReportCells, publishLearnReportProvenance, type LearnReportInputSnapshot,
} from '../shared/learn-v2-measurement-report'
import { learnSerializedBytes } from '../shared/learn-v2-responses'
import { LEARN_MEASUREMENT_CAPABILITIES, LEARN_MEASUREMENT_STORAGE_LIMITS as limits, LEARN_MEASUREMENT_STORAGE_VERSION as storageVersion } from '../shared/learn-v2-measurement-storage-manifest'
import {
  approvedReportGrant, approvalDigest, reportControl, reportControlSchema,
  requireReportGrant, requireReportRun, reportRevocationReason, REPORT_ADAPTER_VERSION, REPORT_CODE_VERSION, REPORT_MAX_OWNERS,
  type ReportControl,
} from './lib/learnV2MeasurementReportAccess'
import { requireOwnedReport, requireOwnedReportGrant } from './lib/learnV2PublicAccess'
import { readLearnReportFactPage, normalizeLearnReportInventory } from './lib/learnV2MeasurementReportSource'
import { learnReportInputSnapshotValidator, learnReportMetricValidator } from './lib/learnV2MeasurementReportContract'
import { reportRunFields } from './lib/learnV2MeasurementStorage'
import { readLearnMeasurementWatermarkSnapshot } from './lib/learnV2MeasurementFacts'
import { hasAccountDeletionTombstone } from './lib/accountDeletionTombstone'
import { privacyDigest } from './lib/learnV2ResponsePrivacy'

import { deniedReportAccess, reportAccessError, writeReportAccessAudit, REPORT_ACCESS_AUDIT_BATCH, REPORT_ACCESS_AUDIT_RETENTION_MS, type ReportAccessAction } from './lib/learnV2MeasurementReportAudit'

const unavailable = (status: 'disabled' | 'unavailable' | 'building' | 'failed' | 'stale', reason: string) => ({ version, status, reasonCodes: status === 'disabled' ? [reason, 'protocol_not_frozen'] : [reason] })
const runArgs = { reportRunId: v.id('learnMeasurementReportRuns') }
const REPORT_PROGRESS_LEASE_MS = 15 * 60 * 1000
const sourceRow = v.object({ userId: v.string(), sourceWatermark: v.number(), snapshot: learnReportInputSnapshotValidator })
const runValidator = v.object({ ...reportRunFields, _id: v.id('learnMeasurementReportRuns'), _creationTime: v.number() })
const controlJson = (value: ReportControl) => {
  const parsed = reportControlSchema.parse(value)
  learnSerializedBytes(parsed, 768 * 1024)
  return JSON.stringify(parsed)
}
function runQueryValue(run: Doc<'learnMeasurementReportRuns'>) {
  return { version: queryVersion, cohortVersion: run.cohortVersion, epoch: run.epoch, protocolVersion: run.protocolVersion,
    enrollmentStartAt: run.enrollmentStartAt, enrollmentEndAt: run.enrollmentEndAt, cutoff: run.cutoff }
}
function provenance(run: Doc<'learnMeasurementReportRuns'>) {
  const control = reportControl(run)
  return { kind: 'aggregate_snapshot' as const, sourceVersion, queryVersion, adapterVersion: run.adapterVersion, codeVersion: run.codeVersion,
    rosterDigest: run.rosterDigest, inputDigest: run.inputDigest!, cutoff: run.cutoff, extractionStartedAt: run.extractionStartedAt,
    extractionEndedAt: run.extractionEndedAt!, sourceCoverage: run.sourceCoverage, episodeCount: control.episodeCount,
    inputBytes: run.inputBytes, bootstrapSeed: run.bootstrapSeed, bootstrapReplicates: 10000 as const }
}
async function internalRun(ctx: QueryCtx | MutationCtx, id: Id<'learnMeasurementReportRuns'>) {
  const run = await ctx.db.get(id)
  if (!run || await hasAccountDeletionTombstone(ctx, run.userId)) throw new Error('Learn access denied')
  const grants = await ctx.db.query('learnMeasurementReportViewerGrants')
    .withIndex('by_userId_and_cohortVersion_and_epoch', q => q.eq('userId', run.userId).eq('cohortVersion', run.cohortVersion).eq('epoch', run.epoch)).take(8)
  for (const grant of grants) {
    try {
      const approval = approvedReportGrant(grant, run.userId)
      if (run.protocolVersion !== approval.protocolVersion || run.baselineSha !== approval.baselineSha
        || reportControl(run).scopeDigest !== await approvalDigest(approval)) continue
      return { run, approval }
    } catch { /* Revoked or mismatched grants convey no authority. */ }
  }
  throw new Error('Learn access denied')
}
async function scheduleReportStep(ctx: MutationCtx, reportRunId: Id<'learnMeasurementReportRuns'>, phase: 'pinning' | 'extracting' | 'computing'): Promise<void> {
  const step = phase === 'pinning' ? internal.learnV2MeasurementReports.pinReportOwners
    : phase === 'extracting' ? internal.learnV2MeasurementReports.buildReportBatch : internal.learnV2MeasurementReports.finalizeReport
  const continuationId = await ctx.scheduler.runAfter(0, step, { reportRunId })
  await ctx.db.patch(reportRunId, { continuationId, progressDeadlineAt: Date.now() + REPORT_PROGRESS_LEASE_MS })
}
type ReportAccessResult = LearnV2ReportRequest | LearnV2Report | LearnV2ReportCells | LearnV2AggregateExport
async function auditedAccess<T extends ReportAccessResult>(ctx: MutationCtx, action: ReportAccessAction,
  access: () => Promise<{ userId: string, reportRunId: Id<'learnMeasurementReportRuns'> | null, result: T }>): Promise<T> {
  let completed: { userId: string, reportRunId: Id<'learnMeasurementReportRuns'> | null, result: T }
  try { completed = await access() }
  catch (error) { deniedReportAccess(); throw reportAccessError(error) }
  const { result } = completed
  const reportRunId = 'reportRunId' in result ? result.reportRunId : 'manifest' in result ? result.manifest.reportRunId : completed.reportRunId
  try { await writeReportAccessAudit(ctx, completed.userId, reportRunId, action, 'status' in result ? result.status : 'read') }
  catch { console.info({ status: 'failed' }); throw new Error('Report audit unavailable') }
  return result
}
async function requestWithAudit(ctx: MutationCtx, args: ReturnType<typeof requestReportSchema.parse>, authenticated: boolean, action: 'request' | 'refresh'): Promise<LearnV2ReportRequest> {
  if (!LEARN_MEASUREMENT_CAPABILITIES.reports) return begin(ctx, parsePublicLearnRequest(requestReportSchema, args), authenticated)
  return auditedAccess(ctx, action, async () => {
    const request = parsePublicLearnRequest(requestReportSchema, args)
    const result = await begin(ctx, request, authenticated)
    const grant = await ctx.db.get(request.viewerGrantId)
    if (!grant) throw new Error('Learn access denied')
    return { userId: grant.userId, reportRunId: null, result }
  })
}
async function begin(ctx: MutationCtx, request: ReturnType<typeof requestReportSchema.parse>, authenticated: boolean): Promise<LearnV2ReportRequest> {
  let grant: Doc<'learnMeasurementReportViewerGrants'>
  if (authenticated) grant = (await requireReportGrant(ctx, request.viewerGrantId)).grant
  else {
    const stored = await ctx.db.get(request.viewerGrantId)
    if (!stored || await hasAccountDeletionTombstone(ctx, stored.userId)) throw new Error('Learn access denied')
    approvedReportGrant(stored, stored.userId)
    grant = stored
  }
  if (!LEARN_MEASUREMENT_CAPABILITIES.reports) return unavailable('disabled', 'disabled')
  const approval = approvedReportGrant(grant, grant.userId)
  if (approval.owners.length > REPORT_MAX_OWNERS) return unavailable('unavailable', 'roster_capacity_exceeded')
  if (request.cutoff > Date.now() || approval.frozenAt > request.enrollmentStartAt) return unavailable('unavailable', 'protocol_not_frozen')
  const { idempotencyKey: _key, ...queryRequest } = request
  const requestDigest = await privacyDigest(queryRequest)
  const requestKey = await privacyDigest([grant.userId, request.idempotencyKey])
  const candidates = await ctx.db.query('learnMeasurementReportRuns')
    .withIndex('by_userId_and_epoch_and_cutoff', q => q.eq('userId', grant.userId).eq('epoch', approval.epoch).eq('cutoff', request.cutoff)).take(8)
  if (candidates.length === 8) return unavailable('unavailable', 'refresh_inventory_overflow')
  for (const candidate of candidates) {
    const control = reportControl(candidate)
    if (candidate.codeVersion !== REPORT_CODE_VERSION || control.scopeDigest !== await approvalDigest(approval)) continue
    if (control.requestKeys.includes(requestKey) && control.requestDigest !== requestDigest) return unavailable('unavailable', 'idempotency_conflict')
    if (candidate.status !== 'failed' && candidate.status !== 'stale' && control.requestDigest === requestDigest
      && (control.requestKeys.includes(requestKey) || candidate.status === 'building')) {
      if (candidate.status === 'building') {
        const continuation = candidate.continuationId ? await ctx.db.system.get('_scheduled_functions', candidate.continuationId) : null
        const reason = !continuation || (continuation.state.kind !== 'pending' && continuation.state.kind !== 'inProgress') ? 'continuation_lost'
          : candidate.progressDeadlineAt === undefined || candidate.progressDeadlineAt <= Date.now() ? 'progress_deadline_exceeded' : null
        if (reason) { await recordReportFailure(ctx, candidate._id, reason); continue }
      }
      if (!control.requestKeys.includes(requestKey)) {
        if (control.requestKeys.length === 64) return unavailable('unavailable', 'refresh_inventory_overflow')
        control.requestKeys.push(requestKey)
        await ctx.db.patch(candidate._id, { cursor: controlJson(control) })
      }
      return { version, status: 'requested', reportRunId: candidate._id }
    }
  }
  const now = Date.now()
  const rosterDigest = await privacyDigest([...approval.owners].sort())
  const reportRunId = await ctx.db.insert('learnMeasurementReportRuns', { userId: grant.userId, storageVersion, createdAt: now,
    cohortVersion: approval.cohortVersion, epoch: approval.epoch, protocolVersion: approval.protocolVersion, baselineSha: approval.baselineSha,
    reportVersion: version, queryVersion, adapterVersion: REPORT_ADAPTER_VERSION, codeVersion: REPORT_CODE_VERSION,
    rosterDigest, cutoff: request.cutoff, enrollmentStartAt: request.enrollmentStartAt, enrollmentEndAt: request.enrollmentEndAt,
    status: 'building', extractionStartedAt: now, sourceCoverage: 'unknown', rowCount: 0, inputBytes: 0,
    bootstrapSeed: await privacyDigest([requestDigest, now]), bootstrapReplicates: 10000,
    cursor: controlJson({ version: 'learn-v2.report-build.v1', scopeDigest: await approvalDigest(approval), requestDigest, requestKeys: [requestKey],
      phase: 'pinning', pinnedOwners: 0, sourcePages: [], cellPages: [], episodeCount: 0, claimCount: 0, ownerIndex: 0, afterSequence: 0, scannedBytes: 0, emittedBytes: 0 }) })
  await scheduleReportStep(ctx, reportRunId, 'pinning')
  return { version, status: 'requested', reportRunId }
}
export const requestReport = mutation({
  args: requestReportArgs, returns: requestReportValidator,
  handler: async (ctx, args): Promise<LearnV2ReportRequest> => {
    if (!LEARN_MEASUREMENT_CAPABILITIES.reports) {
      const request = parsePublicLearnRequest(requestReportSchema, args)
      await requireOwnedReportGrant(ctx, request.viewerGrantId)
      return unavailable('disabled', 'disabled')
    }
    return requestWithAudit(ctx, args, true, 'request')
  },
})
export const beginReportSnapshot = internalMutation({
  args: requestReportArgs, returns: requestReportValidator,
  handler: async (ctx, args): Promise<LearnV2ReportRequest> => requestWithAudit(ctx, args, false, 'request'),
})

async function writeSources(ctx: MutationCtx, run: Doc<'learnMeasurementReportRuns'>, sequence: number,
  rows: { userId: string, sourceWatermark: number, snapshot: LearnReportInputSnapshot }[]) {
  if (!rows.length || rows.length > 8) throw new Error('source_page_overflow')
  const snapshots = rows.map(row => learnReportInputSnapshotSchema.parse(row.snapshot))
  learnSerializedBytes(snapshots, limits.maxReportPageBytes)
  const digest = await privacyDigest(rows)
  const control = reportControl(run)
  const previous = control.sourcePages.find(page => page.sequence === sequence)
  if (previous) {
    if (previous.count !== rows.length || previous.digest !== digest) throw new Error('conflicting_source_page')
    return
  }
  if (sequence !== run.rowCount + 1 || sequence + rows.length - 1 > 40_000) throw new Error('missing_source_page')
  for (const [index, row] of rows.entries()) {
    const snapshot = snapshots[index]!
    const claim = snapshot.kind === 'first_check_claim' || snapshot.kind === 'first_check_claim_v2' ? snapshot : null
    const slotId = claim?.kind === 'first_check_claim' ? claim.firstCheckOpportunityId
      : claim?.firstSlot.kind === 'linked' ? claim.firstSlot.firstCheckOpportunityId : null
    const claimSlot = slotId ? await ctx.db.get(slotId) : null
    if (slotId && (!claimSlot || claimSlot.userId !== row.userId)) throw new Error('source_invalidated')
    let learningVoidId = claimSlot?.learningVoidId
    if (claim && !slotId) {
      const basis = await ctx.db.get(claim.claim.basisAttemptId)
      const blueprint = basis?.blueprintRevisionId ? await ctx.db.get(basis.blueprintRevisionId) : null
      if (!basis || !blueprint || basis.userId !== row.userId || blueprint.userId !== row.userId) throw new Error('source_invalidated')
      learningVoidId = blueprint.learningVoidId
    }
    await ctx.db.insert('learnMeasurementReportRows', { userId: row.userId, storageVersion, createdAt: Date.now(),
      reportRunId: run._id, sequence: sequence + index, sourceWatermark: row.sourceWatermark, sourceVersion, rowKind: snapshot.kind, snapshot,
      ...(snapshot.kind === 'episode' ? { learningVoidId: snapshot.learningVoidId, assignmentId: snapshot.assignmentId, horizonDays: snapshot.horizonDays }
        : learningVoidId ? { learningVoidId } : {}),
      facts: { disposition: snapshot.kind === 'episode' ? snapshot.disposition : snapshot.kind, coldScorePercent: snapshot.kind === 'episode' ? snapshot.cold?.scorePercent ?? null : null,
        delayedScorePercent: snapshot.kind === 'episode' ? snapshot.delayed?.scorePercent ?? null : null,
        claimKey: claim?.claim.claimKey ?? null,
        claimSequence: claim?.claim.claimSequence ?? null,
        checkSequence: claim?.kind === 'first_check_claim' ? claim.checkSequence : claim?.firstSlot.kind === 'linked' ? claim.firstSlot.checkSequence : null,
        admitted: snapshot.kind === 'episode' && snapshot.assignment.status === 'admitted', matured: false, valid: false } })
  }
  control.sourcePages.push({ sequence, count: rows.length, digest })
  await ctx.db.patch(run._id, { rowCount: run.rowCount + rows.length, cursor: controlJson(control), progressDeadlineAt: Date.now() + REPORT_PROGRESS_LEASE_MS })
}
async function recordReportFailure(ctx: MutationCtx, reportRunId: Id<'learnMeasurementReportRuns'>, reason: string, stale = false) {
  const reasonCode = reason === 'Learn access denied' ? 'report_access_revoked'
    : /^[a-z][a-z0-9_]{0,80}$/.test(reason) ? reason : 'source_incomplete'
  const run = await ctx.db.get(reportRunId)
  if (run?.status === 'building') await ctx.db.patch(run._id, { status: stale ? 'stale' : 'failed', sourceCoverage: 'unknown', reasonCode })
  return { status: 'failed' as const, reasonCode }
}
export const pinReportOwners = internalMutation({
  args: runArgs, returns: v.union(v.null(), v.object({ status: v.literal('failed'), reasonCode: v.string() })), handler: async (ctx, args) => {
    if (!LEARN_MEASUREMENT_CAPABILITIES.reports) return null
    try {
      const { run, approval } = await internalRun(ctx, args.reportRunId)
      if (run.status !== 'building') return null
      const control = reportControl(run)
      if (control.phase !== 'pinning') return null
      const owners = [...approval.owners].sort()
      const rows = []
      for (const userId of owners.slice(control.pinnedOwners, control.pinnedOwners + 8)) {
        if (await hasAccountDeletionTombstone(ctx, userId)) throw new Error('source_invalidated')
        const watermark = await ctx.db.query('learnMeasurementSourceWatermarks').withIndex('by_userId', q => q.eq('userId', userId)).unique()
        if (!watermark) throw new Error('missing_owner_watermark')
        rows.push({ userId, sourceWatermark: watermark.sequence, snapshot: await readLearnMeasurementWatermarkSnapshot(ctx, userId, run._id) })
      }
      await writeSources(ctx, run, run.rowCount + 1, rows)
      const updated = (await ctx.db.get(run._id))!
      const next = reportControl(updated)
      next.pinnedOwners += rows.length
      if (next.pinnedOwners === owners.length) next.phase = 'extracting'
      await ctx.db.patch(run._id, { cursor: controlJson(next) })
      await scheduleReportStep(ctx, run._id, next.phase === 'pinning' ? 'pinning' : 'extracting')
      return null
    } catch (error) {
      return recordReportFailure(ctx, args.reportRunId, error instanceof Error ? error.message : 'source_incomplete')
    }
  },
})
export const readBuildState = internalQuery({
  args: runArgs, returns: runValidator,
  handler: async (ctx, args): Promise<Doc<'learnMeasurementReportRuns'>> => (await internalRun(ctx, args.reportRunId)).run,
})
export const readSourcePage = internalQuery({
  args: { ...runArgs, after: v.number(), count: v.optional(v.number()) }, returns: v.array(sourceRow), handler: async (ctx, args) => {
    const { run } = await internalRun(ctx, args.reportRunId)
    if (!Number.isSafeInteger(args.after) || args.after < 0 || (args.count !== undefined && (!Number.isInteger(args.count) || args.count < 1 || args.count > 8))) throw new Error('invalid_source_page')
    const rows = await ctx.db.query('learnMeasurementReportRows')
      .withIndex('by_reportRunId_and_sequence', q => q.eq('reportRunId', run._id).gt('sequence', args.after)).take(args.count ?? 8)
    learnSerializedBytes(rows.map(row => row.snapshot), limits.maxReportPageBytes)
    if (rows.some(row => row.invalidatedAt !== undefined)) throw new Error('source_invalidated')
    return rows.map(row => ({ userId: row.userId, sourceWatermark: row.sourceWatermark, snapshot: row.snapshot }))
  },
})
const ownerPinArgs = { ...runArgs, ownerIndex: v.number() }
async function ownerPin(ctx: QueryCtx, args: { reportRunId: Id<'learnMeasurementReportRuns'>, ownerIndex: number }) {
  const { run, approval } = await internalRun(ctx, args.reportRunId)
  const owner = [...approval.owners].sort()[args.ownerIndex]
  if (!Number.isInteger(args.ownerIndex) || !owner || await hasAccountDeletionTombstone(ctx, owner)) throw new Error('source_invalidated')
  const pin = await ctx.db.query('learnMeasurementReportRows')
    .withIndex('by_reportRunId_and_sequence', q => q.eq('reportRunId', run._id).eq('sequence', args.ownerIndex + 1)).unique()
  if (!pin || pin.userId !== owner || pin.rowKind !== 'owner_watermark' || pin.invalidatedAt !== undefined) throw new Error('missing_owner_watermark')
  return { run, approval, owner, pin }
}
export const readInventoryPage = internalQuery({
  args: { ...ownerPinArgs, after: v.number() },
  returns: v.object({ records: v.array(v.object({ id: v.id('learnMeasurementReportFacts'), sequence: v.number(), inScope: v.boolean() })), isDone: v.boolean(), bytes: v.number() }),
  handler: async (ctx, args) => {
    const { run, owner, pin } = await ownerPin(ctx, args)
    return readLearnReportFactPage(ctx, owner, run.epoch, args.after, pin.sourceWatermark)
  },
})
export const readInventoryRecord = internalQuery({
  args: { ...ownerPinArgs, factId: v.id('learnMeasurementReportFacts') }, returns: v.array(sourceRow),
  handler: async (ctx, args) => {
    const { run, approval, owner, pin } = await ownerPin(ctx, args)
    const watermark = pin.snapshot.kind === 'owner_watermark' ? pin.snapshot : null
    const coverage = watermark?.historyCoverage === 'complete' && watermark.dueWorkThrough !== null && watermark.dueWorkThrough >= run.cutoff ? 'complete' : 'unknown'
    return (await normalizeLearnReportInventory(ctx, run, approval, owner, pin.sourceWatermark, coverage, args.factId))
      .map(snapshot => ({ userId: owner, sourceWatermark: pin.sourceWatermark, snapshot }))
  },
})
export const saveSourcePage = internalMutation({
  args: { ...runArgs, sequence: v.number(), rows: v.array(sourceRow) }, returns: v.null(), handler: async (ctx, args) => {
    const { run, approval } = await internalRun(ctx, args.reportRunId)
    if (run.status !== 'building' || reportControl(run).phase !== 'extracting') return null
    for (const row of args.rows) {
      if (!approval.owners.includes(row.userId) || row.snapshot.kind === 'owner_watermark') throw new Error('invalid_source_owner')
      const index = [...approval.owners].sort().indexOf(row.userId)
      const pin = await ctx.db.query('learnMeasurementReportRows').withIndex('by_reportRunId_and_sequence', q => q.eq('reportRunId', run._id).eq('sequence', index + 1)).unique()
      if (!pin || pin.sourceWatermark !== row.sourceWatermark || row.snapshot.learnerKey !== await deriveLearnReportLearnerKey(run._id, row.userId)) throw new Error('invalid_source_owner')
    }
    await writeSources(ctx, run, args.sequence, args.rows)
    return null
  },
})
export const failReport = internalMutation({
  args: { ...runArgs, reason: v.string(), stale: v.optional(v.boolean()) }, returns: v.null(), handler: async (ctx, args) => {
    await recordReportFailure(ctx, args.reportRunId, args.reason, args.stale)
    return null
  },
})
export const commitBuildBatch = internalMutation({
  args: { ...runArgs, ownerIndex: v.number(), after: v.number(), next: v.number(), isDone: v.boolean(), bytes: v.number(), sequence: v.number(), rows: v.array(sourceRow) },
  returns: v.null(), handler: async (ctx, args) => {
    const { run, approval } = await internalRun(ctx, args.reportRunId)
    if (run.status !== 'building') return null
    const control = reportControl(run)
    if (control.ownerIndex !== args.ownerIndex || control.afterSequence !== args.after) {
      if (args.rows.length) await writeSources(ctx, run, args.sequence, args.rows)
      return null
    }
    if (control.phase !== 'extracting' || args.rows.length > 8 || (!args.isDone && args.next <= args.after)) throw new Error('stuck_source_cursor')
    if (args.rows.some(row => row.userId !== [...approval.owners].sort()[args.ownerIndex])) throw new Error('invalid_source_owner')
    control.scannedBytes += args.bytes
    control.emittedBytes += args.rows.reduce((sum, row) => sum + learnSerializedBytes(row.snapshot, limits.maxReportPageBytes), 0)
    control.episodeCount += new Set(args.rows.flatMap(row => row.snapshot.kind === 'episode' ? [row.snapshot.assignmentId] : [])).size
    control.claimCount += args.rows.filter(row => row.snapshot.kind === 'first_check_claim' || row.snapshot.kind === 'first_check_claim_v2').length
    if (control.scannedBytes > limits.maxReportInputBytes || control.emittedBytes > limits.maxReportInputBytes
      || control.episodeCount > limits.maxReportEpisodes || control.claimCount > limits.maxReportEpisodes) throw new Error('source_input_overflow')
    if (args.rows.length) await writeSources(ctx, run, args.sequence, args.rows)
    const updated = (await ctx.db.get(run._id))!
    control.sourcePages = reportControl(updated).sourcePages
    if (args.isDone) { control.ownerIndex++; control.afterSequence = 0 }
    else control.afterSequence = args.next
    if (control.ownerIndex === control.pinnedOwners) control.phase = 'computing'
    await ctx.db.patch(run._id, { cursor: controlJson(control), ...(control.phase === 'computing' ? { extractionEndedAt: Date.now() } : {}) })
    await scheduleReportStep(ctx, run._id, control.phase === 'computing' ? 'computing' : 'extracting')
    return null
  },
})
export const buildReportBatch = internalAction({
  args: runArgs, returns: v.null(), handler: async (ctx, args) => {
    if (!LEARN_MEASUREMENT_CAPABILITIES.reports) return null
    try {
      const run: Doc<'learnMeasurementReportRuns'> = await ctx.runQuery(internal.learnV2MeasurementReports.readBuildState, args)
      const control = reportControl(run)
      if (run.status !== 'building' || control.phase !== 'extracting') return null
      const page: { records: { id: Id<'learnMeasurementReportFacts'>, sequence: number, inScope: boolean }[], isDone: boolean, bytes: number } =
        await ctx.runQuery(internal.learnV2MeasurementReports.readInventoryPage, { ...args, ownerIndex: control.ownerIndex, after: control.afterSequence })
      const rows: { userId: string, sourceWatermark: number, snapshot: LearnReportInputSnapshot }[] = []
      for (const record of page.records) if (record.inScope) rows.push(...await ctx.runQuery(internal.learnV2MeasurementReports.readInventoryRecord, {
        ...args, ownerIndex: control.ownerIndex, factId: record.id,
      }))
      await ctx.runMutation(internal.learnV2MeasurementReports.commitBuildBatch, { ...args, ownerIndex: control.ownerIndex, after: control.afterSequence,
        next: page.records.at(-1)?.sequence ?? control.afterSequence, isDone: page.isDone, bytes: page.bytes, sequence: run.rowCount + 1, rows })
    } catch (error) {
      await ctx.runMutation(internal.learnV2MeasurementReports.failReport, { ...args, reason: error instanceof Error ? error.message : 'source_incomplete' })
    }
    return null
  },
})

export const prepareComputedReport = internalMutation({
  args: { ...runArgs, inputDigest: v.string(), rosterDigest: v.string(), bootstrapSeed: v.string(), inputBytes: v.number(), episodeCount: v.number(), sourceCoverage: v.union(v.literal('complete'), v.literal('unknown')) },
  returns: v.null(), handler: async (ctx, args) => {
    const { run } = await internalRun(ctx, args.reportRunId)
    if (run.status !== 'building') return null
    if (reportControl(run).phase !== 'computing') throw new Error('invalid_report_phase')
    if (run.inputDigest && run.inputDigest !== args.inputDigest) throw new Error('conflicting_input_digest')
    if (args.inputBytes > limits.maxReportInputBytes || args.episodeCount > limits.maxReportEpisodes) throw new Error('source_input_overflow')
    const control = reportControl(run)
    control.episodeCount = args.episodeCount
    await ctx.db.patch(run._id, { inputDigest: args.inputDigest, rosterDigest: args.rosterDigest, bootstrapSeed: args.bootstrapSeed,
      inputBytes: args.inputBytes, sourceCoverage: args.sourceCoverage, cursor: controlJson(control),
      ...(run.inputDigest === undefined ? { progressDeadlineAt: Date.now() + REPORT_PROGRESS_LEASE_MS } : {}) })
    return null
  },
})
export const saveCellPage = internalMutation({
  args: { ...runArgs, sequence: v.number(), cells: v.array(learnReportMetricValidator) }, returns: v.null(), handler: async (ctx, args) => {
    const { run } = await internalRun(ctx, args.reportRunId)
    if (run.status !== 'building' || reportControl(run).phase !== 'computing') return null
    validateLearnPublishedMeasurementReportCells({ version, reportRunId: run._id, cells: args.cells, cursor: null, isDone: true })
    if (!args.cells.length) throw new Error('empty_cell_page')
    const control = reportControl(run)
    const digest = await privacyDigest(args.cells)
    const previous = control.cellPages.find(page => page.sequence === args.sequence)
    if (previous) {
      if (previous.count !== args.cells.length || previous.digest !== digest) throw new Error('conflicting_cell_page')
      return null
    }
    if (args.sequence !== control.cellPages.reduce((sum, page) => sum + page.count, 0) + 1) throw new Error('missing_cell_page')
    for (const [index, cell] of args.cells.entries()) await ctx.db.insert('learnMeasurementReportCells', { userId: run.userId, storageVersion,
      createdAt: Date.now(), reportRunId: run._id, sequence: args.sequence + index, cellKey: String(args.sequence + index), reportVersion: version, ...cell })
    control.cellPages.push({ sequence: args.sequence, count: args.cells.length, digest })
    await ctx.db.patch(run._id, { cursor: controlJson(control), progressDeadlineAt: Date.now() + REPORT_PROGRESS_LEASE_MS })
    return null
  },
})
export const sealReport = internalMutation({
  args: { ...runArgs, cellCount: v.number(), inputDigest: v.string() }, returns: v.null(), handler: async (ctx, args) => {
    const { run, approval } = await internalRun(ctx, args.reportRunId)
    if (run.status !== 'building') return null
    const control = reportControl(run)
    if (control.phase !== 'computing' || run.inputDigest !== args.inputDigest
      || args.cellCount === 0 || control.cellPages.reduce((sum, page) => sum + page.count, 0) !== args.cellCount
      || control.sourcePages.reduce((sum, page) => sum + page.count, 0) !== run.rowCount) throw new Error('incomplete_report_manifest')
    const reason = await reportRevocationReason(ctx, run, approval)
    if (reason) { await ctx.db.patch(run._id, { status: 'stale', sourceCoverage: 'unknown', reasonCode: reason }); return null }
    control.phase = 'sealed'
    await ctx.db.patch(run._id, { status: 'sealed', cursor: controlJson(control) })
    return null
  },
})
export const finalizeReport = internalAction({
  args: runArgs, returns: v.null(), handler: async (ctx, args) => {
    if (!LEARN_MEASUREMENT_CAPABILITIES.reports) return null
    try {
      let run: Doc<'learnMeasurementReportRuns'> = await ctx.runQuery(internal.learnV2MeasurementReports.readBuildState, args)
      const control = reportControl(run)
      if (run.status !== 'building' || control.phase !== 'computing') return null
      const rows: LearnReportInputSnapshot[] = []
      let count = 0
      let bytes = 0
      for (const manifest of control.sourcePages) {
        if (manifest.sequence !== count + 1) throw new Error('missing_source_page')
        const page: { userId: string, sourceWatermark: number, snapshot: LearnReportInputSnapshot }[] = await ctx.runQuery(internal.learnV2MeasurementReports.readSourcePage, { ...args, after: count, count: manifest.count })
        if (page.length !== manifest.count || await privacyDigest(page) !== manifest.digest) throw new Error('source_manifest_mismatch')
        for (const row of page) {
          bytes += learnSerializedBytes(row.snapshot, limits.maxReportPageBytes)
          if (bytes > limits.maxReportInputBytes) throw new Error('source_input_overflow')
          rows.push(row.snapshot)
        }
        count += page.length
      }
      if (count !== run.rowCount) throw new Error('missing_source_page')
      const roster = rows.slice(0, control.pinnedOwners).map(row => {
        if (row.kind !== 'owner_watermark') throw new Error('missing_owner_watermark')
        return row.learnerKey
      })
      // Full reconciliation, fingerprinting and bootstrap belong in an action at 10,000 episodes / 64 MiB.
      const reconciliation = reconcileLearnReportSourceRows(roster, rows)
      if (reconciliation.status !== 'complete') throw new Error(reconciliation.reasonCodes[0] ?? 'source_incomplete')
      const fingerprint = await fingerprintLearnReportInput(roster, rows)
      const covered = rows.filter(row => row.kind === 'owner_watermark').every(row => row.historyCoverage === 'complete'
        && row.dueWorkThrough !== null && row.dueWorkThrough >= run.cutoff)
      await ctx.runMutation(internal.learnV2MeasurementReports.prepareComputedReport, { ...args, ...fingerprint, sourceCoverage: covered ? 'complete' : 'unknown' })
      run = await ctx.runQuery(internal.learnV2MeasurementReports.readBuildState, args)
      if (run.status !== 'building') return null
      const result = await buildPublishedLearningMeasurementReport({ reportRunId: run._id, query: runQueryValue(run), provenance: provenance(run), roster, rows })
      if (result.report.status !== 'sealed') throw new Error(result.report.reasonCodes[0] ?? 'computation_incomplete')
      let sequence = 1
      for (const page of result.pages) {
        await ctx.runMutation(internal.learnV2MeasurementReports.saveCellPage, { ...args, sequence, cells: page.cells })
        sequence += page.cells.length
      }
      await ctx.runMutation(internal.learnV2MeasurementReports.sealReport, { ...args, cellCount: sequence - 1, inputDigest: fingerprint.inputDigest })
    } catch (error) {
      await ctx.runMutation(internal.learnV2MeasurementReports.failReport, { ...args, reason: error instanceof Error ? error.message : 'source_incomplete' })
    }
    return null
  },
})

async function visibleRun(ctx: QueryCtx | MutationCtx, requestedId: Id<'learnMeasurementReportRuns'>) {
  const authorized = await requireReportRun(ctx, requestedId)
  if (!LEARN_MEASUREMENT_CAPABILITIES.reports) return { ...authorized, reason: 'disabled' }
  let { run } = authorized
  if (run.status === 'building') {
    const completed = await ctx.db.query('learnMeasurementReportRuns')
      .withIndex('by_userId_and_status_and_createdAt', q => q.eq('userId', run.userId).eq('status', 'sealed')).order('desc').take(8)
    const previous = completed.find(row => row.cohortVersion === run.cohortVersion && row.epoch === run.epoch
      && row.protocolVersion === run.protocolVersion && row.cutoff <= run.cutoff && row.enrollmentStartAt === run.enrollmentStartAt && row.enrollmentEndAt === run.enrollmentEndAt)
    if (previous) run = (await requireReportRun(ctx, previous._id)).run
  }
  const reason = run.status === 'sealed' ? await reportRevocationReason(ctx, run, authorized.approval) : null
  return { run, approval: authorized.approval, reason }
}
async function manifestFor(ctx: QueryCtx | MutationCtx, reportRunId: Id<'learnMeasurementReportRuns'>): Promise<LearnV2Report> {
  if (!LEARN_MEASUREMENT_CAPABILITIES.reports) { await requireOwnedReport(ctx, reportRunId); return unavailable('disabled', 'disabled') }
  const { run, reason } = await visibleRun(ctx, reportRunId)
  if (reason) return unavailable(reason === 'disabled' ? 'disabled' : 'stale', reason)
  if (run.status !== 'sealed') return unavailable(run.status, run.reasonCode ?? 'report_building')
  if (run.codeVersion !== REPORT_CODE_VERSION) return unavailable('stale', 'report_policy_changed')
  return { version, status: 'sealed', reportRunId: run._id, query: runQueryValue(run), provenance: publishLearnReportProvenance(provenance(run)) }
}
async function cellsFor(ctx: QueryCtx | MutationCtx, reportRunId: Id<'learnMeasurementReportRuns'>, cursor: string | null, resolved?: Extract<LearnV2Report, { status: 'sealed' }>): Promise<LearnV2ReportCells> {
  const manifest = resolved ?? await manifestFor(ctx, reportRunId)
  if (manifest.status !== 'sealed') return manifest
  const { run } = await requireReportRun(ctx, manifest.reportRunId)
  const after = cursor === null ? 0 : Number(cursor)
  if (!Number.isSafeInteger(after) || after < 0 || (cursor !== null && String(after) !== cursor)) throw new Error('Invalid Learn request')
  const control = reportControl(run)
  const total = control.cellPages.reduce((sum, page) => sum + page.count, 0)
  if (after > total || (after !== 0 && !control.cellPages.some(page => page.sequence + page.count - 1 === after))) throw new Error('Invalid Learn request')
  const next = control.cellPages.find(page => page.sequence === after + 1)
  if (!next) return { version, reportRunId: run._id, cells: [], cursor: null, isDone: true }
  const stored = await ctx.db.query('learnMeasurementReportCells')
    .withIndex('by_reportRunId_and_sequence', q => q.eq('reportRunId', run._id).gt('sequence', after)).take(next.count)
  const cells = stored.map(row => learnPublishedReportMetricSchema.parse(Object.fromEntries(Object.keys(learnPublishedReportMetricSchema.shape).map(key => [key, row[key as keyof typeof row]]))))
  if (stored.length !== next.count || stored.some((row, index) => row.sequence !== after + index + 1)
    || await privacyDigest(cells) !== next.digest) return unavailable('failed', 'cell_manifest_mismatch')
  return validateLearnPublishedMeasurementReportCells({ version, reportRunId: run._id, cells, cursor: after + cells.length < total ? String(after + cells.length) : null, isDone: after + cells.length === total })
}
async function legacyReportRead(ctx: QueryCtx, reference: () => Id<'learnMeasurementReportRuns'>) {
  try {
    await requireReportRun(ctx, reference())
    return unavailable('unavailable', 'audited_access_required')
  } catch (error) { throw reportAccessError(error) }
  finally { deniedReportAccess() }
}
async function exportFor(ctx: QueryCtx | MutationCtx, request: ReturnType<typeof reportPageSchema.parse>): Promise<LearnV2AggregateExport> {
  const manifest = await manifestFor(ctx, request.reportRunId)
  if (manifest.status !== 'sealed') return manifest
  const page = await cellsFor(ctx, manifest.reportRunId, request.cursor, manifest)
  if ('status' in page) return page
  return { version, status: 'aggregate_page', manifest: { reportRunId: manifest.reportRunId, query: manifest.query, provenance: manifest.provenance }, page }
}
export const getReport = query({
  args: reportReferenceArgs, returns: reportValidator, handler: async (ctx, args): Promise<LearnV2Report> => {
    if (LEARN_MEASUREMENT_CAPABILITIES.reports) return legacyReportRead(ctx, () => parsePublicLearnRequest(reportReferenceSchema, args).reportRunId)
    return manifestFor(ctx, parsePublicLearnRequest(reportReferenceSchema, args).reportRunId)
  },
})
export const getReportCells = query({
  args: reportPageArgs, returns: reportCellsValidator, handler: async (ctx, args): Promise<LearnV2ReportCells> => {
    if (LEARN_MEASUREMENT_CAPABILITIES.reports) return legacyReportRead(ctx, () => parsePublicLearnRequest(reportPageSchema, args).reportRunId)
    const request = parsePublicLearnRequest(reportPageSchema, args)
    return cellsFor(ctx, request.reportRunId, request.cursor)
  },
})
export const exportAggregateReport = query({
  args: reportPageArgs, returns: aggregateExportValidator, handler: async (ctx, args): Promise<LearnV2AggregateExport> => {
    if (LEARN_MEASUREMENT_CAPABILITIES.reports) return legacyReportRead(ctx, () => parsePublicLearnRequest(reportPageSchema, args).reportRunId)
    return exportFor(ctx, parsePublicLearnRequest(reportPageSchema, args))
  },
})
export const readReportManifest = mutation({
  args: reportReferenceArgs, returns: reportValidator, handler: async (ctx, args): Promise<LearnV2Report> => {
    if (!LEARN_MEASUREMENT_CAPABILITIES.reports) return manifestFor(ctx, parsePublicLearnRequest(reportReferenceSchema, args).reportRunId)
    return auditedAccess(ctx, 'manifest', async () => {
      const { reportRunId } = parsePublicLearnRequest(reportReferenceSchema, args)
      const { run } = await requireReportRun(ctx, reportRunId)
      return { userId: run.userId, reportRunId, result: await manifestFor(ctx, reportRunId) }
    })
  },
})
export const readReportCells = mutation({
  args: reportPageArgs, returns: reportCellsValidator, handler: async (ctx, args): Promise<LearnV2ReportCells> => {
    if (!LEARN_MEASUREMENT_CAPABILITIES.reports) {
      const request = parsePublicLearnRequest(reportPageSchema, args)
      return cellsFor(ctx, request.reportRunId, request.cursor)
    }
    return auditedAccess(ctx, 'page', async () => {
      const { reportRunId, cursor } = parsePublicLearnRequest(reportPageSchema, args)
      const { run } = await requireReportRun(ctx, reportRunId)
      return { userId: run.userId, reportRunId, result: await cellsFor(ctx, reportRunId, cursor) }
    })
  },
})
async function auditedExport(ctx: MutationCtx, args: ReturnType<typeof reportPageSchema.parse>, action: 'export' | 'download'): Promise<LearnV2AggregateExport> {
  if (!LEARN_MEASUREMENT_CAPABILITIES.reports) return exportFor(ctx, parsePublicLearnRequest(reportPageSchema, args))
  return auditedAccess(ctx, action, async () => {
    const request = parsePublicLearnRequest(reportPageSchema, args)
    const { run } = await requireReportRun(ctx, request.reportRunId)
    return { userId: run.userId, reportRunId: request.reportRunId, result: await exportFor(ctx, request) }
  })
}
export const exportReportPage = mutation({
  args: reportPageArgs, returns: aggregateExportValidator,
  handler: async (ctx, args): Promise<LearnV2AggregateExport> => auditedExport(ctx, args, 'export'),
})
export const downloadReportPage = mutation({
  args: reportPageArgs, returns: aggregateExportValidator,
  handler: async (ctx, args): Promise<LearnV2AggregateExport> => auditedExport(ctx, args, 'download'),
})
export const purgeExpiredAccessAudits = internalMutation({
  args: {}, returns: v.null(), handler: async (ctx) => {
    const rows = await ctx.db.query('learnMeasurementReportAccessAudits')
      .withIndex('by_createdAt', q => q.lt('createdAt', Date.now() - REPORT_ACCESS_AUDIT_RETENTION_MS)).take(REPORT_ACCESS_AUDIT_BATCH)
    for (const row of rows) await ctx.db.delete(row._id)
    if (rows.length === REPORT_ACCESS_AUDIT_BATCH) await ctx.scheduler.runAfter(0, internal.learnV2MeasurementReports.purgeExpiredAccessAudits, {})
    return null
  },
})
export const dailyRefresh = internalMutation({
  args: requestReportArgs, returns: requestReportValidator, handler: async (ctx, args): Promise<LearnV2ReportRequest> => {
    const result = await requestWithAudit(ctx, { ...args, cutoff: Date.now() }, false, 'refresh')
    if (result.status === 'requested') await ctx.scheduler.runAfter(86_400_000, internal.learnV2MeasurementReports.dailyRefresh, args)
    return result
  },
})
