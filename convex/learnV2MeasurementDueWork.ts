import { v } from 'convex/values'
import { makeFunctionReference } from 'convex/server'
import { internalMutation, type MutationCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { materializeLearnMeasurementAssignment, materializeLearnMeasurementDueBatch, extendLearnDueWorkCoverage, processLearnMeasurementDueOpportunity } from './lib/learnV2MeasurementDueWork'
import { learnDueWorkEnabled, learnDueWorkBackoff, LEARN_DUE_WORK_LEASE_MS, LEARN_DUE_WORK_MAX_ATTEMPTS, LEARN_DUE_WORK_MAX_RECOVERY_ATTEMPTS } from './lib/learnV2DueWorkQueue'
import { getFrozenLearnMeasurementProtocol } from './lib/learnV2MeasurementAssignment'
import { hasAccountDeletionTombstone } from './lib/accountDeletionTombstone'

export { LEARN_DUE_WORK_LEASE_MS } from './lib/learnV2DueWorkQueue'
export const LEARN_DUE_WORK_PAGE_SIZE = 16
export const LEARN_DUE_WORK_IDLE_PASSES = 8
type Chain = { leaseId: string, target: number, idlePasses?: number }
type WorkArgs = { userId: string, workId: Id<'learnMeasurementDueWork'>, generation: number, recovering?: boolean }
type SweepResult = { status: 'disabled' | 'busy' | 'stale' | 'scheduled' | 'complete', visited: number, scheduledLearners: number, continued: boolean }
const workArgs = { userId: v.string(), workId: v.id('learnMeasurementDueWork'), generation: v.number(), recovering: v.optional(v.boolean()) }
const step = makeFunctionReference<'mutation', Chain, SweepResult>('learnV2MeasurementDueWork:continueDelayedCheckSweep')
const ownerWork = makeFunctionReference<'mutation', WorkArgs, null>('learnV2MeasurementDueWork:processDelayedCheckWork')
const applyWork = makeFunctionReference<'mutation', WorkArgs, null>('learnV2MeasurementDueWork:applyDelayedCheckWork')
const continuation = makeFunctionReference<'mutation', { userId: string, cursor?: string, through: number, expectedSequence?: number, coverageComplete?: boolean, fromCron?: boolean }>('learnV2MeasurementDueWork:materializeDelayedCheckEligibility')
const sweepResult = v.object({ status: v.union(v.literal('disabled'), v.literal('busy'), v.literal('stale'), v.literal('scheduled'), v.literal('complete')),
  visited: v.number(), scheduledLearners: v.number(), continued: v.boolean() })
const idle = (status: SweepResult['status']): SweepResult => ({ status, visited: 0, scheduledLearners: 0, continued: false })
const readCursor = (ctx: MutationCtx) => ctx.db.query('learnMeasurementDueWorkCursors').withIndex('by_key', q => q.eq('key', 'delayed_checks')).unique()
const dueRange = (ctx: MutationCtx, target: number) => ctx.db.query('learnMeasurementDueWork')
  .withIndex('by_nextAttemptAt', q => q.lte('nextAttemptAt', target))

async function runSweepStep(ctx: MutationCtx, chain: Chain): Promise<SweepResult> {
  const cursor = await readCursor(ctx)
  if (!cursor || cursor.leaseId !== chain.leaseId) return idle('stale')
  const rows = await dueRange(ctx, chain.target).take(LEARN_DUE_WORK_PAGE_SIZE)
  for (const work of rows) {
    const generation = work.generation + 1
    const recovering = work.state === 'parked' || work.state === 'terminal' || work.attempts >= LEARN_DUE_WORK_MAX_ATTEMPTS
    const scheduledFunctionId = await ctx.scheduler.runAfter(0, ownerWork, { userId: work.userId, workId: work._id, generation, recovering })
    await ctx.db.patch(work._id, { state: recovering ? 'parked' : 'pending', generation, scheduledFunctionId, inFlight: true,
      previousScheduledFunctionId: work.inFlight ? work.scheduledFunctionId : undefined,
      nextAttemptAt: Date.now() + LEARN_DUE_WORK_LEASE_MS, updatedAt: Date.now() })
  }
  const moreDue = await dueRange(ctx, chain.target).first() !== null
  const inFlight = await ctx.db.query('learnMeasurementDueWork').withIndex('by_inFlight', q => q.eq('inFlight', true)).first() !== null
  const idlePasses = rows.length ? 0 : (chain.idlePasses ?? 0) + 1
  const continued = moreDue || inFlight && idlePasses < LEARN_DUE_WORK_IDLE_PASSES
  if (continued) {
    const leaseId = crypto.randomUUID()
    await ctx.db.patch(cursor._id, { leaseId, leaseExpiresAt: Date.now() + LEARN_DUE_WORK_LEASE_MS, updatedAt: Date.now() })
    await ctx.scheduler.runAfter(0, step, { leaseId, target: Date.now(), idlePasses })
  } else await ctx.db.patch(cursor._id, { through: chain.target, leaseId: null, leaseExpiresAt: 0, updatedAt: Date.now() })
  return { status: rows.length ? 'scheduled' : continued ? 'busy' : 'complete', visited: rows.length, scheduledLearners: rows.length, continued }
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
  args: { leaseId: v.string(), target: v.number(), idlePasses: v.optional(v.number()) }, returns: sweepResult,
  handler: async (ctx, chain): Promise<SweepResult> => {
    if (!learnDueWorkEnabled()) return idle('disabled')
    return runSweepStep(ctx, chain)
  },
})

async function waitForDomain(ctx: MutationCtx, work: Doc<'learnMeasurementDueWork'>, closeAt?: number, restartOwner = false) {
  const domainChecks = Math.min((work.domainChecks ?? 0) + 1, 7)
  await ctx.db.patch(work._id, { state: 'pending', inFlight: false, scheduledFunctionId: undefined, previousScheduledFunctionId: undefined,
    domainChecks, nextAttemptAt: Math.min(Date.now() + learnDueWorkBackoff(domainChecks), closeAt ?? Number.MAX_SAFE_INTEGER), updatedAt: Date.now(),
    ...(restartOwner ? { cursor: undefined, through: undefined, expectedSequence: undefined, coverageComplete: undefined } : {}) })
}

async function recordFault(ctx: MutationCtx, work: Doc<'learnMeasurementDueWork'>, recovering: boolean) {
  const attempts = recovering ? work.attempts : Math.min(work.attempts + 1, LEARN_DUE_WORK_MAX_ATTEMPTS)
  const recoveryAttempts = (work.recoveryAttempts ?? 0) + (recovering ? 1 : 0)
  const parked = recovering || attempts >= LEARN_DUE_WORK_MAX_ATTEMPTS
  const terminal = recoveryAttempts >= LEARN_DUE_WORK_MAX_RECOVERY_ATTEMPTS
  const row = work.assessmentOpportunityId ? await ctx.db.get(work.assessmentOpportunityId) : null
  const closeAt = row?.userId === work.userId ? row.closeAt : null
  const nextAttemptAt = terminal ? Number.MAX_SAFE_INTEGER : parked && !recovering
    ? closeAt === null ? Date.now() + 3_600_000 : Math.max(Date.now(), closeAt)
    : Date.now() + learnDueWorkBackoff(recovering ? recoveryAttempts : attempts)
  await ctx.db.patch(work._id, { state: terminal ? 'terminal' : parked ? 'parked' : 'pending', attempts, recoveryAttempts,
    inFlight: false, scheduledFunctionId: undefined, previousScheduledFunctionId: undefined, nextAttemptAt,
    reasonCode: parked ? 'retries_exhausted' : undefined, updatedAt: Date.now() })
}

export const processDelayedCheckWork = internalMutation({
  args: workArgs, returns: v.null(),
  handler: async (ctx, input): Promise<null> => {
    if (!learnDueWorkEnabled()) return null
    const work = await ctx.db.get(input.workId)
    if (!work || work.userId !== input.userId || !work.inFlight || work.generation !== input.generation) return null
    if (work.previousScheduledFunctionId) {
      const previous = await ctx.db.system.get(work.previousScheduledFunctionId)
      if (previous?.state.kind === 'failed') {
        await recordFault(ctx, work, input.recovering === true)
        return null
      }
    }
    try { await ctx.runMutation(applyWork, input) }
    catch { await recordFault(ctx, work, input.recovering === true) }
    return null
  },
})

export const applyDelayedCheckWork = internalMutation({
  args: workArgs, returns: v.null(),
  handler: async (ctx, input): Promise<null> => {
    if (!learnDueWorkEnabled()) return null
    const work = await ctx.db.get(input.workId)
    if (!work || work.userId !== input.userId || !work.inFlight || work.generation !== input.generation) return null
    if (await hasAccountDeletionTombstone(ctx, work.userId)) { await ctx.db.delete(work._id); return null }
    if (work.kind === 'owner') {
      const through = work.through ?? Date.now()
      const result = await materializeLearnMeasurementDueBatch(ctx, work.userId, { cursor: work.cursor ?? null, through,
        expectedSequence: work.expectedSequence, coverageComplete: work.coverageComplete })
      if (result.cursor) {
        const generation = work.generation + 1
        const scheduledFunctionId = await ctx.scheduler.runAfter(0, ownerWork, { userId: work.userId, workId: work._id, generation, recovering: input.recovering })
        await ctx.db.patch(work._id, { cursor: result.cursor, through, expectedSequence: result.sequence, coverageComplete: result.coverageComplete,
          generation, scheduledFunctionId, previousScheduledFunctionId: undefined, nextAttemptAt: Date.now() + LEARN_DUE_WORK_LEASE_MS, updatedAt: Date.now() })
        return null
      }
      if (!result.complete) { await waitForDomain(ctx, work, undefined, true); return null }
    } else {
      const assignment = work.assignmentId ? await ctx.db.get(work.assignmentId) : null
      if (assignment && assignment.userId !== work.userId) throw new Error('Learn due-work assignment scope conflicts')
      if (assignment?.status === 'admitted') {
        const opportunity = work.assessmentOpportunityId ? await ctx.db.get(work.assessmentOpportunityId) : null
        if (opportunity && (opportunity.userId !== work.userId || opportunity.assignmentId !== assignment._id)) throw new Error('Learn due-work opportunity scope conflicts')
        if (input.recovering && opportunity && Date.now() < opportunity.closeAt && !opportunity.submissionId
          && ['preparing', 'ready', 'test_open'].includes(opportunity.phase)) {
          await ctx.db.patch(work._id, { state: 'parked', inFlight: false, scheduledFunctionId: undefined,
            nextAttemptAt: opportunity.closeAt, updatedAt: Date.now() })
          return null
        }
        if (opportunity?.purpose.kind === 'measurement_delayed') {
          await processLearnMeasurementDueOpportunity(ctx, assignment, getFrozenLearnMeasurementProtocol()!, opportunity, Date.now())
        } else {
          const result = await materializeLearnMeasurementAssignment(ctx, assignment, getFrozenLearnMeasurementProtocol()!, Date.now())
          if (!['processed', 'anchor_not_started'].includes(result)) { await waitForDomain(ctx, work); return null }
        }
        const current = opportunity ? await ctx.db.get(opportunity._id) : null
        if (current && !current.submissionId && ['preparing', 'ready', 'test_open'].includes(current.phase)
          && current.operationalEligibility === 'blocked' && Date.now() < current.closeAt) { await waitForDomain(ctx, work, current.closeAt); return null }
      }
    }
    if (await ctx.db.get(work._id)) await ctx.db.delete(work._id)
    const watermark = await ctx.db.query('learnMeasurementSourceWatermarks').withIndex('by_userId', q => q.eq('userId', work.userId)).unique()
    if (watermark) await extendLearnDueWorkCoverage(ctx, watermark, Date.now())
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
