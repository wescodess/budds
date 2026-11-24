import { v } from 'convex/values'
import { makeFunctionReference } from 'convex/server'
import { internalMutation, type MutationCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { materializeLearnMeasurementAssignment, materializeLearnMeasurementDueBatch, extendLearnDueWorkCoverage } from './lib/learnV2MeasurementDueWork'
import { learnDueWorkEnabled, learnDueWorkBackoff, LEARN_DUE_WORK_LEASE_MS, LEARN_DUE_WORK_MAX_ATTEMPTS } from './lib/learnV2DueWorkQueue'
import { getFrozenLearnMeasurementProtocol } from './lib/learnV2MeasurementAssignment'
import { writeMeasurementOpportunityFact } from './lib/learnV2Measurement'
import { finalizeLearnDelayedCheckSession } from './lib/learnV2DelayedDelivery'
import { hasAccountDeletionTombstone } from './lib/accountDeletionTombstone'
import { LEARN_SYSTEM_DUE_WORK_LATE } from '../shared/learn-v2-delayed-check'

export { LEARN_DUE_WORK_LEASE_MS } from './lib/learnV2DueWorkQueue'
export const LEARN_DUE_WORK_PAGE_SIZE = 16
type Chain = { leaseId: string, target: number }
type SweepResult = { status: 'disabled' | 'busy' | 'stale' | 'scheduled' | 'complete', visited: number, scheduledLearners: number, continued: boolean }
const step = makeFunctionReference<'mutation', Chain, SweepResult>('learnV2MeasurementDueWork:continueDelayedCheckSweep')
const ownerWork = makeFunctionReference<'mutation', { userId: string, workId: Id<'learnMeasurementDueWork'>, generation: number }>('learnV2MeasurementDueWork:processDelayedCheckWork')
const continuation = makeFunctionReference<'mutation', { userId: string, cursor?: string, through: number, expectedSequence?: number, coverageComplete?: boolean, fromCron?: boolean }>('learnV2MeasurementDueWork:materializeDelayedCheckEligibility')
const sweepResult = v.object({ status: v.union(v.literal('disabled'), v.literal('busy'), v.literal('stale'), v.literal('scheduled'), v.literal('complete')),
  visited: v.number(), scheduledLearners: v.number(), continued: v.boolean() })
const idle = (status: SweepResult['status']): SweepResult => ({ status, visited: 0, scheduledLearners: 0, continued: false })
const readCursor = (ctx: MutationCtx) => ctx.db.query('learnMeasurementDueWorkCursors').withIndex('by_key', q => q.eq('key', 'delayed_checks')).unique()
const dueRange = (ctx: MutationCtx, state: 'scheduled' | 'pending', target: number) => ctx.db.query('learnMeasurementDueWork')
  .withIndex('by_state_and_nextAttemptAt', q => q.eq('state', state).lte('nextAttemptAt', target))

async function resumeDrain(ctx: MutationCtx) {
  const now = Date.now()
  if (await dueRange(ctx, 'pending', now).first() === null && await dueRange(ctx, 'scheduled', now).first() === null) return
  const cursor = await readCursor(ctx)
  if (cursor?.leaseId && cursor.leaseExpiresAt > now) return
  const leaseId = crypto.randomUUID()
  const lease = { leaseId, leaseExpiresAt: now + LEARN_DUE_WORK_LEASE_MS, updatedAt: now }
  if (cursor) await ctx.db.patch(cursor._id, lease)
  else await ctx.db.insert('learnMeasurementDueWorkCursors', { key: 'delayed_checks', through: null, ...lease })
  await ctx.scheduler.runAfter(0, step, { leaseId, target: now })
}

async function exhaustWork(ctx: MutationCtx, work: Doc<'learnMeasurementDueWork'>) {
  await ctx.db.patch(work._id, { state: 'terminal', reasonCode: 'retries_exhausted', updatedAt: Date.now() })
  const assignment = work.assignmentId ? await ctx.db.get(work.assignmentId) : null
  if (!assignment || assignment.userId !== work.userId || assignment.status !== 'admitted') return
  const rows = work.assessmentOpportunityId ? [await ctx.db.get(work.assessmentOpportunityId)]
    : await ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId_and_assignmentId_and_horizonDays', q =>
      q.eq('userId', work.userId).eq('assignmentId', assignment._id)).take(9)
  if (rows.length > 8) throw new Error('Learn due-work opportunity inventory exceeds its bound')
  for (const row of rows) {
    if (!row || row.userId !== work.userId || row.assignmentId !== assignment._id || row.purpose.kind !== 'measurement_delayed'
      || row.submissionId || !['preparing', 'ready', 'test_open'].includes(row.phase)) continue
    const patch = { phase: 'abandoned' as const, operationalEligibility: 'blocked' as const, reasonCode: LEARN_SYSTEM_DUE_WORK_LATE, revision: row.revision + 1 }
    await ctx.db.patch(row._id, patch)
    await finalizeLearnDelayedCheckSession(ctx, work.userId, { ...row, ...patch })
    await writeMeasurementOpportunityFact(ctx, assignment, (await ctx.db.get(row._id))!)
  }
}

async function runSweepStep(ctx: MutationCtx, chain: Chain): Promise<SweepResult> {
  const cursor = await readCursor(ctx)
  if (!cursor || cursor.leaseId !== chain.leaseId) return idle('stale')
  const rows = [...await dueRange(ctx, 'pending', chain.target).take(LEARN_DUE_WORK_PAGE_SIZE),
    ...await dueRange(ctx, 'scheduled', chain.target).take(LEARN_DUE_WORK_PAGE_SIZE)]
    .sort((a, b) => a.nextAttemptAt - b.nextAttemptAt || a._creationTime - b._creationTime || a._id.localeCompare(b._id)).slice(0, LEARN_DUE_WORK_PAGE_SIZE)
  let scheduledLearners = 0
  for (const work of rows) {
    if (work.attempts >= LEARN_DUE_WORK_MAX_ATTEMPTS) { await exhaustWork(ctx, work); continue }
    const generation = work.generation + 1
    const scheduledFunctionId = await ctx.scheduler.runAfter(0, ownerWork, { userId: work.userId, workId: work._id, generation })
    await ctx.db.patch(work._id, { state: 'pending', attempts: work.attempts + 1, generation, scheduledFunctionId,
      nextAttemptAt: Date.now() + Math.max(LEARN_DUE_WORK_LEASE_MS, learnDueWorkBackoff(work.attempts + 1)), updatedAt: Date.now() })
    scheduledLearners++
  }
  const continued = await dueRange(ctx, 'pending', chain.target).first() !== null || await dueRange(ctx, 'scheduled', chain.target).first() !== null
  if (continued) {
    const leaseId = crypto.randomUUID()
    await ctx.db.patch(cursor._id, { leaseId, leaseExpiresAt: Date.now() + LEARN_DUE_WORK_LEASE_MS, updatedAt: Date.now() })
    await ctx.scheduler.runAfter(0, step, { ...chain, leaseId })
  } else await ctx.db.patch(cursor._id, { through: chain.target, leaseId: null, leaseExpiresAt: 0, updatedAt: Date.now() })
  return rows.length ? { status: 'scheduled', visited: rows.length, scheduledLearners, continued } : idle('complete')
}

export const sweepDelayedCheckEligibility = internalMutation({
  args: {}, returns: sweepResult,
  handler: async (ctx): Promise<SweepResult> => {
    if (!learnDueWorkEnabled()) return idle('disabled')
    const now = Date.now()
    const cursor = await readCursor(ctx)
    if (cursor?.leaseId && cursor.leaseExpiresAt > now) return idle('busy')
    const leaseId = crypto.randomUUID()
    const lease = { leaseId, leaseExpiresAt: now + LEARN_DUE_WORK_LEASE_MS, updatedAt: now }
    if (cursor) await ctx.db.patch(cursor._id, lease)
    else await ctx.db.insert('learnMeasurementDueWorkCursors', { key: 'delayed_checks', through: null, ...lease })
    return runSweepStep(ctx, { leaseId, target: now })
  },
})

export const continueDelayedCheckSweep = internalMutation({
  args: { leaseId: v.string(), target: v.number() }, returns: sweepResult,
  handler: async (ctx, chain): Promise<SweepResult> => {
    if (!learnDueWorkEnabled()) return idle('disabled')
    return runSweepStep(ctx, chain)
  },
})

export const processDelayedCheckWork = internalMutation({
  args: { userId: v.string(), workId: v.id('learnMeasurementDueWork'), generation: v.number() },
  handler: async (ctx, input) => {
    if (!learnDueWorkEnabled()) return null
    const work = await ctx.db.get(input.workId)
    if (!work || work.userId !== input.userId || work.state !== 'pending' || work.generation !== input.generation) return null
    if (await hasAccountDeletionTombstone(ctx, work.userId)) { await ctx.db.delete(work._id); return null }
    const retry = async (restartOwner = false) => {
      if (work.attempts >= LEARN_DUE_WORK_MAX_ATTEMPTS) await exhaustWork(ctx, work)
      else await ctx.db.patch(work._id, { nextAttemptAt: Date.now() + learnDueWorkBackoff(work.attempts), scheduledFunctionId: undefined, updatedAt: Date.now(),
        ...(restartOwner ? { cursor: undefined, through: undefined, expectedSequence: undefined, coverageComplete: undefined } : {}) })
    }
    const catalog = await ctx.db.query('learnAssessmentCatalogs').withIndex('by_userId', q => q.eq('userId', work.userId)).take(2)
    if (catalog.length !== 1 || catalog[0]?.measurementCapability?.enabled !== true) { await retry(); return null }
    if (work.kind === 'owner') {
      const through = work.through ?? Date.now()
      const result = await materializeLearnMeasurementDueBatch(ctx, work.userId, { cursor: work.cursor ?? null, through,
        expectedSequence: work.expectedSequence, coverageComplete: work.coverageComplete })
      if (result.cursor) {
        const generation = work.generation + 1
        const scheduledFunctionId = await ctx.scheduler.runAfter(0, ownerWork, { userId: work.userId, workId: work._id, generation })
        await ctx.db.patch(work._id, { cursor: result.cursor, through, expectedSequence: result.sequence, coverageComplete: result.coverageComplete,
          generation, scheduledFunctionId, nextAttemptAt: Date.now() + Math.max(LEARN_DUE_WORK_LEASE_MS, learnDueWorkBackoff(work.attempts)), updatedAt: Date.now() })
        return null
      }
      if (!result.complete) { await retry(true); return null }
    } else {
      const assignment = work.assignmentId ? await ctx.db.get(work.assignmentId) : null
      if (assignment?.userId === work.userId && assignment.status === 'admitted') {
        const result = await materializeLearnMeasurementAssignment(ctx, assignment, getFrozenLearnMeasurementProtocol()!, Date.now())
        if (!['processed', 'anchor_not_started'].includes(result)) { await retry(); return null }
        const opportunity = work.assessmentOpportunityId ? await ctx.db.get(work.assessmentOpportunityId) : null
        if (opportunity && !opportunity.submissionId && ['preparing', 'ready', 'test_open'].includes(opportunity.phase)
          && opportunity.operationalEligibility === 'blocked' && Date.now() < opportunity.closeAt) { await retry(); return null }
      }
    }
    await ctx.db.delete(work._id)
    const watermark = await ctx.db.query('learnMeasurementSourceWatermarks').withIndex('by_userId', q => q.eq('userId', work.userId)).unique()
    if (watermark) await extendLearnDueWorkCoverage(ctx, watermark, Date.now())
    await resumeDrain(ctx)
    return null
  },
})

export const materializeDelayedCheckEligibility = internalMutation({
  args: { userId: v.string(), cursor: v.optional(v.union(v.string(), v.null())), through: v.optional(v.number()), expectedSequence: v.optional(v.number()), coverageComplete: v.optional(v.boolean()), fromCron: v.optional(v.boolean()) },
  handler: async (ctx, input) => {
    if (input.fromCron && !learnDueWorkEnabled()) return { status: 'disabled' as const, cursor: null, processed: 0, sequence: 0, complete: false }
    if (input.fromCron) {
      const catalog = await ctx.db.query('learnAssessmentCatalogs').withIndex('by_userId', q => q.eq('userId', input.userId)).take(2)
      if (catalog.length !== 1 || catalog[0]?.measurementCapability?.enabled !== true)
        return { status: 'disabled' as const, cursor: null, processed: 0, sequence: 0, complete: false }
    }
    const through = input.through ?? Date.now()
    const result = await materializeLearnMeasurementDueBatch(ctx, input.userId, { cursor: input.cursor ?? null, through, expectedSequence: input.expectedSequence, coverageComplete: input.coverageComplete })
    if (result.cursor) await ctx.scheduler.runAfter(0, continuation, { userId: input.userId, cursor: result.cursor, through, expectedSequence: result.sequence, coverageComplete: result.coverageComplete, ...(input.fromCron ? { fromCron: true } : {}) })
    return result
  },
})
