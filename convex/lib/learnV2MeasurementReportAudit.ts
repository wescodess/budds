import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import { LEARN_MEASUREMENT_CAPABILITIES } from '../../shared/learn-v2-measurement-storage-manifest'

export const REPORT_ACCESS_AUDIT_LIMIT = 128
export const REPORT_ACCESS_AUDIT_RETENTION_MS = 30 * 86_400_000
export const REPORT_ACCESS_AUDIT_BATCH = 8
export type ReportAccessAction = Doc<'learnMeasurementReportAccessAudits'>['action']
export type ReportAccessStatus = Doc<'learnMeasurementReportAccessAudits'>['status']

export function deniedReportAccess() {
  console.info({ status: 'denied' })
}
export function reportAccessError(error: unknown) {
  const message = error instanceof Error && ['Learn access denied', 'Unauthenticated', 'Account deletion is in progress', 'Invalid Learn request'].includes(error.message)
    ? error.message : 'Learn access denied'
  return new Error(message)
}
export async function writeReportAccessAudit(ctx: MutationCtx, userId: string, reportRunId: Id<'learnMeasurementReportRuns'> | null, action: ReportAccessAction, status: ReportAccessStatus) {
  if (!LEARN_MEASUREMENT_CAPABILITIES.reports) return
  const createdAt = Date.now()
  const id = await ctx.db.insert('learnMeasurementReportAccessAudits', { userId, reportRunId, action, status, createdAt })
  const recent = await ctx.db.query('learnMeasurementReportAccessAudits')
    .withIndex('by_userId_and_createdAt', q => q.eq('userId', userId)).order('desc').take(REPORT_ACCESS_AUDIT_LIMIT + 1)
  const obsolete = recent.filter(row => row._id !== id).filter((row, index) => index >= REPORT_ACCESS_AUDIT_LIMIT - 1 || row.createdAt < createdAt - REPORT_ACCESS_AUDIT_RETENTION_MS)
  for (const row of obsolete.slice(0, REPORT_ACCESS_AUDIT_BATCH)) await ctx.db.delete(row._id)
}
