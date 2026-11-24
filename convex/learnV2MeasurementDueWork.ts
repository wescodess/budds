import { v } from 'convex/values'
import { makeFunctionReference } from 'convex/server'
import { internalMutation } from './_generated/server'
import { materializeLearnMeasurementDueBatch } from './lib/learnV2MeasurementDueWork'
import { LEARN_MEASUREMENT_CAPABILITIES } from '../shared/learn-v2-measurement-storage-manifest'
import { getFrozenLearnMeasurementProtocol } from './lib/learnV2MeasurementAssignment'

const args = { userId: v.string(), cursor: v.optional(v.union(v.string(), v.null())), through: v.optional(v.number()), expectedSequence: v.optional(v.number()), coverageComplete: v.optional(v.boolean()), fromCron: v.optional(v.boolean()) }
const continuation = makeFunctionReference<'mutation', { userId: string, cursor?: string, through: number, expectedSequence?: number, coverageComplete?: boolean, fromCron?: boolean }>('learnV2MeasurementDueWork:materializeDelayedCheckEligibility')
const phases = ['preparing', 'ready', 'test_open', 'coverage'] as const
type SweepInput = { phase?: typeof phases[number], cursor?: string | null, through?: number }
const sweep = makeFunctionReference<'mutation', SweepInput>('learnV2MeasurementDueWork:sweepDelayedCheckEligibility')
export const LEARN_DUE_WORK_PAGE_SIZE = 16

function cronEnabled() {
  return LEARN_MEASUREMENT_CAPABILITIES.responses && LEARN_MEASUREMENT_CAPABILITIES.enrollment
    && LEARN_MEASUREMENT_CAPABILITIES.delivery && process.env.LEARN_V2_ENABLED === 'true' && getFrozenLearnMeasurementProtocol() !== null
}

export const sweepDelayedCheckEligibility = internalMutation({
  args: { phase: v.optional(v.union(...phases.map(phase => v.literal(phase)))), cursor: v.optional(v.union(v.string(), v.null())), through: v.optional(v.number()) },
  returns: v.object({ status: v.union(v.literal('disabled'), v.literal('scheduled')), visited: v.number(), scheduledLearners: v.number(), continued: v.boolean() }),
  handler: async (ctx, input: SweepInput) => {
    if (!cronEnabled()) return { status: 'disabled' as const, visited: 0, scheduledLearners: 0, continued: false }
    const through = input.through ?? Date.now()
    if (!Number.isSafeInteger(through) || through < 0 || through > Date.now()) throw new Error('Learn due-work cutoff is invalid')
    const phase = input.phase ?? 'preparing'
    const pagination = { cursor: input.cursor ?? null, numItems: LEARN_DUE_WORK_PAGE_SIZE }
    const page = phase === 'coverage'
      ? await ctx.db.query('learnMeasurementSourceWatermarks').withIndex('by_dueWorkThrough', q => q.lt('dueWorkThrough', through)).paginate(pagination)
      : await ctx.db.query('learnAssessmentOpportunities').withIndex('by_phase_and_openAt', q =>
        q.eq('phase', phase).lte('openAt', through)).paginate(pagination)
    const users = new Set(page.page.filter(row => !('purpose' in row) || ['measurement_delayed', 'retained_transfer'].includes(row.purpose.kind)).map(row => row.userId))
    for (const userId of users) await ctx.scheduler.runAfter(0, continuation, { userId, through, fromCron: true })
    const nextPhase = page.isDone ? phases[phases.indexOf(phase) + 1] : phase
    if (nextPhase) await ctx.scheduler.runAfter(0, sweep, { phase: nextPhase, cursor: page.isDone ? null : page.continueCursor, through })
    return { status: 'scheduled' as const, visited: page.page.length, scheduledLearners: users.size, continued: nextPhase !== undefined }
  },
})

export const materializeDelayedCheckEligibility = internalMutation({
  args,
  handler: async (ctx, input) => {
    if (input.fromCron && !cronEnabled())
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
