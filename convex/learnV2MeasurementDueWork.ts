import { v } from 'convex/values'
import { makeFunctionReference } from 'convex/server'
import { internalMutation, type MutationCtx } from './_generated/server'
import { learnDueWorkEnabled, materializeLearnMeasurementDueBatch } from './lib/learnV2MeasurementDueWork'

const args = { userId: v.string(), cursor: v.optional(v.union(v.string(), v.null())), through: v.optional(v.number()), expectedSequence: v.optional(v.number()), coverageComplete: v.optional(v.boolean()), fromCron: v.optional(v.boolean()) }
const continuation = makeFunctionReference<'mutation', { userId: string, cursor?: string, through: number, expectedSequence?: number, coverageComplete?: boolean, fromCron?: boolean }>('learnV2MeasurementDueWork:materializeDelayedCheckEligibility')
const edges = ['created', 'preparing_open', 'preparing_close', 'ready_close', 'test_open_close'] as const
type Edge = typeof edges[number]
type Chain = { leaseId: string, from: number | null, target: number, edge: Edge, cursor: string | null }
type SweepResult = { status: 'disabled' | 'busy' | 'stale' | 'scheduled' | 'complete', visited: number, scheduledLearners: number, continued: boolean }
const step = makeFunctionReference<'mutation', Chain, SweepResult>('learnV2MeasurementDueWork:continueDelayedCheckSweep')
export const LEARN_DUE_WORK_PAGE_SIZE = 16
export const LEARN_DUE_WORK_LEASE_MS = 5 * 60 * 1000
const CURSOR_KEY = 'delayed_checks'
const sweepResult = v.object({ status: v.union(v.literal('disabled'), v.literal('busy'), v.literal('stale'), v.literal('scheduled'), v.literal('complete')),
  visited: v.number(), scheduledLearners: v.number(), continued: v.boolean() })
const idle = (status: SweepResult['status']): SweepResult => ({ status, visited: 0, scheduledLearners: 0, continued: false })

function watermarkRange(ctx: MutationCtx, { from, target }: Chain) {
  return ctx.db.query('learnMeasurementSourceWatermarks').withIndex('by_createdAt', q =>
    from === null ? q.lte('createdAt', target) : q.gt('createdAt', from).lte('createdAt', target))
}
function opportunityRange(ctx: MutationCtx, { from, target }: Chain, edge: Exclude<Edge, 'created'>) {
  const phase = edge === 'preparing_open' || edge === 'preparing_close' ? 'preparing' : edge === 'ready_close' ? 'ready' : 'test_open'
  if (edge === 'preparing_open') return ctx.db.query('learnAssessmentOpportunities').withIndex('by_phase_and_openAt', q =>
    from === null ? q.eq('phase', phase).lte('openAt', target) : q.eq('phase', phase).gt('openAt', from).lte('openAt', target))
  return ctx.db.query('learnAssessmentOpportunities').withIndex('by_phase_and_closeAt', q =>
    from === null ? q.eq('phase', phase).lte('closeAt', target) : q.eq('phase', phase).gt('closeAt', from).lte('closeAt', target))
}
async function edgePending(ctx: MutationCtx, chain: Chain, edge: Edge) {
  return (edge === 'created' ? await watermarkRange(ctx, chain).first() : await opportunityRange(ctx, chain, edge).first()) !== null
}
async function edgePage(ctx: MutationCtx, chain: Chain, edge: Edge) {
  const pagination = { cursor: chain.cursor, numItems: LEARN_DUE_WORK_PAGE_SIZE }
  const page = edge === 'created' ? await watermarkRange(ctx, chain).paginate(pagination) : await opportunityRange(ctx, chain, edge).paginate(pagination)
  return { userIds: page.page.map(row => row.userId), isDone: page.isDone, continueCursor: page.continueCursor }
}
const readCursor = (ctx: MutationCtx) => ctx.db.query('learnMeasurementDueWorkCursors').withIndex('by_key', q => q.eq('key', CURSOR_KEY)).unique()

async function nextPendingEdge(ctx: MutationCtx, chain: Chain, edge: Edge | undefined) {
  while (edge && !await edgePending(ctx, chain, edge)) edge = edges[edges.indexOf(edge) + 1]
  return edge
}

// One chain visits each edge once per window: (last completed target, this target]. Every step rotates the
// lease token, so only the latest scheduled step can advance it.
async function runSweepStep(ctx: MutationCtx, chain: Chain): Promise<SweepResult> {
  const cursor = await readCursor(ctx)
  if (!cursor || cursor.leaseId !== chain.leaseId) return idle('stale')
  const complete = () => ctx.db.patch(cursor._id, { through: chain.target, leaseId: null, leaseExpiresAt: 0, updatedAt: Date.now() })
  const edge = chain.cursor === null ? await nextPendingEdge(ctx, chain, chain.edge) : chain.edge
  if (!edge) {
    await complete()
    return idle('complete')
  }
  const page = await edgePage(ctx, chain, edge)
  const users = new Set(page.userIds)
  for (const userId of users) await ctx.scheduler.runAfter(0, continuation, { userId, through: chain.target, fromCron: true })
  const next = page.isDone ? { edge: await nextPendingEdge(ctx, chain, edges[edges.indexOf(edge) + 1]), cursor: null } : { edge, cursor: page.continueCursor }
  if (next.edge) {
    const leaseId = crypto.randomUUID()
    await ctx.db.patch(cursor._id, { leaseId, leaseExpiresAt: Date.now() + LEARN_DUE_WORK_LEASE_MS, updatedAt: Date.now() })
    await ctx.scheduler.runAfter(0, step, { ...chain, leaseId, edge: next.edge, cursor: next.cursor })
  } else await complete()
  return { status: 'scheduled', visited: page.userIds.length, scheduledLearners: users.size, continued: next.edge !== undefined }
}

export const sweepDelayedCheckEligibility = internalMutation({
  args: {},
  returns: sweepResult,
  handler: async (ctx): Promise<SweepResult> => {
    if (!learnDueWorkEnabled()) return idle('disabled')
    const now = Date.now()
    const cursor = await readCursor(ctx)
    if (cursor?.leaseId && cursor.leaseExpiresAt > now) return idle('busy')
    const from = cursor?.through ?? null
    if (from !== null && from >= now) return idle('complete')
    const leaseId = crypto.randomUUID()
    const lease = { leaseId, leaseExpiresAt: now + LEARN_DUE_WORK_LEASE_MS, updatedAt: now }
    if (cursor) await ctx.db.patch(cursor._id, lease)
    else await ctx.db.insert('learnMeasurementDueWorkCursors', { key: CURSOR_KEY, through: null, ...lease })
    return runSweepStep(ctx, { leaseId, from, target: now, edge: edges[0], cursor: null })
  },
})

export const continueDelayedCheckSweep = internalMutation({
  args: { leaseId: v.string(), from: v.union(v.number(), v.null()), target: v.number(), edge: v.union(...edges.map(edge => v.literal(edge))), cursor: v.union(v.string(), v.null()) },
  returns: sweepResult,
  handler: async (ctx, chain): Promise<SweepResult> => {
    if (!learnDueWorkEnabled()) return idle('disabled')
    return runSweepStep(ctx, chain)
  },
})

export const materializeDelayedCheckEligibility = internalMutation({
  args,
  handler: async (ctx, input) => {
    if (input.fromCron && !learnDueWorkEnabled())
      return { status: 'disabled' as const, cursor: null, processed: 0, sequence: 0, complete: false }
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
