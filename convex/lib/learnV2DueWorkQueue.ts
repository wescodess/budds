import type { Doc } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { LEARN_MEASUREMENT_CAPABILITIES, LEARN_MEASUREMENT_STORAGE_VERSION } from '../../shared/learn-v2-measurement-storage-manifest'
import { getFrozenLearnMeasurementProtocol } from './learnV2MeasurementAssignment'

export const LEARN_DUE_WORK_MAX_ATTEMPTS = 8
export const LEARN_DUE_WORK_MAX_RECOVERY_ATTEMPTS = 3
export const LEARN_DUE_WORK_LEASE_MS = 5 * 60_000
export const LEARN_DUE_WORK_HOUR_MS = 3_600_000
export const learnDueWorkBackoff = (attempts: number) => Math.min(60_000 * 2 ** Math.max(0, attempts - 1), LEARN_DUE_WORK_HOUR_MS)
export const learnDueWorkRecoveryBackoff = (recoveryAttempts: number) => Math.min(LEARN_DUE_WORK_HOUR_MS * 2 ** Math.max(0, recoveryAttempts - 1), 24 * LEARN_DUE_WORK_HOUR_MS)

export function learnDueWorkEnabled() {
  return LEARN_MEASUREMENT_CAPABILITIES.responses && LEARN_MEASUREMENT_CAPABILITIES.enrollment
    && LEARN_MEASUREMENT_CAPABILITIES.delivery && process.env.LEARN_V2_ENABLED === 'true' && getFrozenLearnMeasurementProtocol() !== null
}

const executingJob = Symbol('learnDueWorkExecutingJob')
export function learnDueWorkExecutionContext(ctx: MutationCtx, work: Doc<'learnMeasurementDueWork'>): MutationCtx {
  return new Proxy(ctx, { get: (target, property) => property === executingJob ? work.scheduledFunctionId : Reflect.get(target, property) })
}

async function openingWorkFaultedInWindow(ctx: QueryCtx | MutationCtx, work: Doc<'learnMeasurementDueWork'>, closeAt: number) {
  if (work.windowFaultAt !== undefined && work.windowFaultAt <= closeAt) return true
  for (const jobId of new Set([work.previousScheduledFunctionId, work.scheduledFunctionId])) {
    if (!jobId) continue
    const job = await ctx.db.system.get(jobId)
    if (!job || job.scheduledTime > closeAt) continue
    if (job.state.kind === 'failed' || jobId !== Reflect.get(ctx, executingJob)
      && ['pending', 'inProgress'].includes(job.state.kind)) return true
  }
  return false
}

type WorkInput = Pick<Doc<'learnMeasurementDueWork'>, 'userId' | 'key' | 'kind' | 'dueAt'>
  & Partial<Pick<Doc<'learnMeasurementDueWork'>, 'assignmentId' | 'assessmentOpportunityId' | 'learningVoidId'>>

export async function enqueueLearnDueWork(ctx: MutationCtx, input: WorkInput) {
  if (!learnDueWorkEnabled()) return
  const previous = await ctx.db.query('learnMeasurementDueWork').withIndex('by_userId_and_key', q =>
    q.eq('userId', input.userId).eq('key', input.key)).unique()
  if (previous) return
  const now = Date.now()
  await ctx.db.insert('learnMeasurementDueWork', { ...input, storageVersion: LEARN_MEASUREMENT_STORAGE_VERSION,
    createdAt: now, updatedAt: now, state: input.dueAt <= now ? 'pending' : 'scheduled', nextAttemptAt: input.dueAt, attempts: 0, generation: 0 })
}

export async function enqueueLearnOpportunityEdges(ctx: MutationCtx, row: Doc<'learnAssessmentOpportunities'>) {
  if (!learnDueWorkEnabled() || !row.assignmentId) return
  for (const kind of ['open', 'close'] as const) await enqueueLearnDueWork(ctx, {
    userId: row.userId, learningVoidId: row.learningVoidId, assignmentId: row.assignmentId,
    assessmentOpportunityId: row._id, key: `${row._id}:${kind}`, kind, dueAt: kind === 'open' ? row.openAt : row.closeAt,
  })
}

export async function retireLearnOpportunityDueWork(ctx: MutationCtx, row: Doc<'learnAssessmentOpportunities'>) {
  if (!learnDueWorkEnabled() || !row.submissionId && !['invalid', 'cancelled', 'abandoned', 'scored_pass', 'scored_fail'].includes(row.phase)) return false
  let faulted = false
  for (const kind of ['open', 'close'] as const) {
    const work = await ctx.db.query('learnMeasurementDueWork').withIndex('by_userId_and_key', q =>
      q.eq('userId', row.userId).eq('key', `${row._id}:${kind}`)).unique()
    if (work) {
      if (kind === 'open') faulted = await openingWorkFaultedInWindow(ctx, work, row.closeAt)
      await ctx.db.delete(work._id)
    }
  }
  return faulted
}

export async function retireLearnAssignmentFault(ctx: MutationCtx, assignment: Doc<'learnMeasurementAssignments'>) {
  if (!learnDueWorkEnabled()) return
  const work = await ctx.db.query('learnMeasurementDueWork').withIndex('by_userId_and_key', q =>
    q.eq('userId', assignment.userId).eq('key', `assignment:${assignment._id}`)).unique()
  if (work && ['parked', 'terminal'].includes(work.state)) await ctx.db.delete(work._id)
}

export async function retireLearnOwnerFault(ctx: MutationCtx, userId: string) {
  if (!learnDueWorkEnabled()) return
  const work = await ctx.db.query('learnMeasurementDueWork').withIndex('by_userId_and_key', q => q.eq('userId', userId).eq('key', 'owner')).unique()
  if (work && ['parked', 'terminal'].includes(work.state)) await ctx.db.delete(work._id)
}

export async function learnOpportunityFaultedInWindow(ctx: QueryCtx | MutationCtx, row: Doc<'learnAssessmentOpportunities'>) {
  if (!learnDueWorkEnabled()) return false
  const work = await ctx.db.query('learnMeasurementDueWork').withIndex('by_userId_and_key', q =>
    q.eq('userId', row.userId).eq('key', `${row._id}:open`)).unique()
  return work !== null && await openingWorkFaultedInWindow(ctx, work, row.closeAt)
}

export async function hasUnresolvedLearnDueWork(ctx: QueryCtx | MutationCtx, userId: string, cutoff: number) {
  if (!learnDueWorkEnabled() && !LEARN_MEASUREMENT_CAPABILITIES.reports) return false
  for (const state of ['pending', 'parked', 'terminal'] as const) {
    if (await ctx.db.query('learnMeasurementDueWork').withIndex('by_userId_and_state_and_dueAt', q =>
      q.eq('userId', userId).eq('state', state)).first()) return true
  }
  return await ctx.db.query('learnMeasurementDueWork').withIndex('by_userId_and_state_and_dueAt', q =>
    q.eq('userId', userId).eq('state', 'scheduled').lte('dueAt', cutoff)).first() !== null
}
