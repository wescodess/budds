import { z } from 'zod'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { requireAuth } from './auth'
import { hasAccountDeletionTombstone } from './accountDeletionTombstone'
import { privacyDigest } from './learnV2ResponsePrivacy'
import type { learnReportReplacementPolicySchema } from '../../shared/learn-v2-measurement-report'

export type LearnReportApproval = {
  tokenIdentifier: string
  principalBindingVersion: string
  grantVersion: string
  cohortVersion: string
  epoch: string
  protocolVersion: string
  baselineSha: string
  frozenAt: number
  owners: readonly string[]
  replacementPolicy: z.infer<typeof learnReportReplacementPolicySchema>
}

// Server configuration only. No principal or collection scope is provisioned here.
export const LEARN_REPORT_APPROVALS: LearnReportApproval[] = []
export const REPORT_ADAPTER_VERSION = 'learn-v2.report-adapter.v1'
export const REPORT_CODE_VERSION = 'learn-v2.report-code.c6.2.v1'
const pageManifest = z.strictObject({ sequence: z.number().int().nonnegative(), count: z.number().int().min(1).max(8), digest: z.string() })
export const reportControlSchema = z.strictObject({
  version: z.literal('learn-v2.report-build.v1'), scopeDigest: z.string(), requestDigest: z.string(), requestKeys: z.array(z.string()).min(1).max(64),
  phase: z.enum(['pinning', 'extracting', 'computing', 'sealed']), pinnedOwners: z.number().int().min(0).max(10_000),
  sourcePages: z.array(pageManifest).max(5000), cellPages: z.array(pageManifest).max(10_000),
  episodeCount: z.number().int().min(0).max(10_000), claimCount: z.number().int().min(0).max(10_000),
  ownerIndex: z.number().int().min(0).max(10_000), afterSequence: z.number().int().nonnegative(),
  scannedBytes: z.number().int().nonnegative(), emittedBytes: z.number().int().nonnegative(),
})
export type ReportControl = z.infer<typeof reportControlSchema>
export function reportControl(run: Doc<'learnMeasurementReportRuns'>) {
  try { return reportControlSchema.parse(JSON.parse(run.cursor ?? '')) }
  catch { throw new Error('Learn report manifest unavailable') }
}
export async function approvalDigest(approval: LearnReportApproval) {
  return privacyDigest({ ...approval, owners: [...approval.owners].sort() })
}
function deny(): never { throw new Error('Learn access denied') }
export function approvedReportGrant(grant: Doc<'learnMeasurementReportViewerGrants'>, userId: string) {
  const now = Date.now()
  const approval = LEARN_REPORT_APPROVALS.find(value => value.tokenIdentifier === userId
    && value.cohortVersion === grant.cohortVersion && value.epoch === grant.epoch)
  if (!approval || grant.userId !== userId || grant.status !== 'active' || grant.revokedAt !== undefined
    || grant.grantedAt > now || grant.expiresAt <= now || approval.principalBindingVersion !== grant.principalBindingVersion
    || approval.grantVersion !== grant.grantVersion || !userId.includes('|') || !approval.owners.length
    || approval.owners.length > 10_000 || new Set(approval.owners).size !== approval.owners.length) deny()
  return approval
}
export async function requireReportGrant(ctx: QueryCtx | MutationCtx, grantId: Id<'learnMeasurementReportViewerGrants'>) {
  const userId = await requireAuth(ctx)
  const grant = await ctx.db.get(grantId)
  if (!grant) deny()
  const approval = approvedReportGrant(grant, userId)
  return { userId, grant, approval }
}
export async function requireReportRun(ctx: QueryCtx | MutationCtx, reportRunId: Id<'learnMeasurementReportRuns'>) {
  const userId = await requireAuth(ctx)
  const run = await ctx.db.get(reportRunId)
  if (!run || run.userId !== userId) deny()
  const grants = await ctx.db.query('learnMeasurementReportViewerGrants')
    .withIndex('by_userId_and_cohortVersion_and_epoch', q => q.eq('userId', userId).eq('cohortVersion', run.cohortVersion).eq('epoch', run.epoch)).take(8)
  for (const grant of grants) {
    try {
      const approval = approvedReportGrant(grant, userId)
      if (run.protocolVersion !== approval.protocolVersion || run.baselineSha !== approval.baselineSha
        || reportControl(run).scopeDigest !== await approvalDigest(approval)) deny()
      return { run, approval }
    } catch { /* Another active grant may still authorize this exact scope. */ }
  }
  return deny()
}

// This guard verifies current revocation; it never recomputes the frozen input.
export async function reportRevocationReason(ctx: QueryCtx | MutationCtx, run: Doc<'learnMeasurementReportRuns'>, approval: LearnReportApproval) {
  if (run.status === 'stale') return 'source_invalidated'
  let ranges = 0
  const owners = [...approval.owners].sort()
  for (let index = 0; index < owners.length; index++) {
    if ((ranges += 5) > 3000) return 'source_validation_incomplete'
    const owner = owners[index]!
    if (await hasAccountDeletionTombstone(ctx, owner)) return 'source_invalidated'
    const pin = await ctx.db.query('learnMeasurementReportRows')
      .withIndex('by_reportRunId_and_sequence', q => q.eq('reportRunId', run._id).eq('sequence', index + 1)).unique()
    const watermark = await ctx.db.query('learnMeasurementSourceWatermarks').withIndex('by_userId', q => q.eq('userId', owner)).unique()
    if (!watermark || !pin || watermark.sequence < pin.sourceWatermark) return 'missing_owner_watermark'
    if (pin.snapshot.kind === 'owner_watermark' && pin.snapshot.historyCoverage === 'complete' && watermark.historyCoverage !== 'complete') return 'source_invalidated'
    if (!pin || pin.userId !== owner || pin.rowKind !== 'owner_watermark' || pin.invalidatedAt !== undefined) return 'missing_owner_watermark'
    const lost = await ctx.db.query('learnMeasurementReportRows')
      .withIndex('by_userId_and_invalidatedAt', q => q.eq('userId', owner).gte('invalidatedAt', run.extractionStartedAt)).first()
    if (lost) return 'source_invalidated'
    let sequence = pin.sourceWatermark
    for (;;) {
      if (++ranges > 3000) return 'source_validation_incomplete'
      const changes = await ctx.db.query('learnMeasurementReportFacts')
        .withIndex('by_userId_and_sequence', q => q.eq('userId', owner).gt('sequence', sequence)).take(8)
      if (changes.some(row => row.fact.kind === 'integrity')) return 'source_invalidated'
      if (changes.length < 8) break
      const next = changes.at(-1)!.sequence
      if (next <= sequence) return 'source_validation_incomplete'
      sequence = next
    }
  }
  return null
}
