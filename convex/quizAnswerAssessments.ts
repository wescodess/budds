import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { requireAuth } from './lib/auth'

const labelValidator = v.union(
  v.literal('fully_correct'),
  v.literal('partially_correct'),
  v.literal('incorrect'),
  v.literal('uncertain'),
)
const reasonValidator = v.union(
  v.literal('disabled'),
  v.literal('unconfigured'),
  v.literal('timeout'),
  v.literal('unavailable'),
  v.literal('malformed'),
  v.literal('over_budget'),
)
const probabilitiesValidator = v.object({
  fullyCorrect: v.number(),
  partiallyCorrect: v.number(),
  incorrect: v.number(),
  uncertain: v.number(),
})
const CLAIM_LEASE_MS = 5 * 60 * 1000

function requireEvaluatorSecret(secret: string) {
  const expected = process.env.QUIZ_ASSESSMENT_WRITE_SECRET
  if (!expected || expected.length < 32 || secret !== expected) throw new Error('Assessment write not authorized')
}

function requireProbability(value: number) {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('Invalid assessment probability')
}

export const listPendingForAttempt = query({
  args: { attemptId: v.id('quizAttempts') },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const attempt = await ctx.db.get(args.attemptId)
    if (!attempt || attempt.userId !== userId) throw new Error('Attempt not found')
    if (attempt.status !== 'completed') return []
    const rows = await ctx.db
      .query('quizAnswerAssessments')
      .withIndex('by_userId_and_attemptId', q => q.eq('userId', userId).eq('attemptId', args.attemptId))
      .collect()
    const staleBefore = Date.now() - CLAIM_LEASE_MS
    return rows.filter(row => row.status === 'pending' && (row.inputDigest === undefined || (row.claimedAt ?? 0) < staleBefore)).map(row => ({
      assessmentId: row._id,
      kind: row.kind,
      questionSnapshot: row.questionSnapshot,
      learnerAnswerSnapshot: row.learnerAnswerSnapshot,
      rubricVersion: row.rubricVersion,
      rubricSnapshot: row.rubricSnapshot,
    }))
  },
})

export const claimBatch = mutation({
  args: {
    attemptId: v.id('quizAttempts'),
    assessmentIds: v.array(v.id('quizAnswerAssessments')),
    inputDigest: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const attempt = await ctx.db.get(args.attemptId)
    if (!attempt || attempt.userId !== userId || attempt.status !== 'completed') throw new Error('Attempt not found')
    if (!/^[a-f0-9]{64}$/.test(args.inputDigest) || args.assessmentIds.length < 1 || args.assessmentIds.length > 8) throw new Error('Invalid assessment claim')
    const claimable = []
    const now = Date.now()
    const staleBefore = now - CLAIM_LEASE_MS
    for (const assessmentId of args.assessmentIds) {
      const row = await ctx.db.get(assessmentId)
      const hasActiveClaim = row?.inputDigest !== undefined && (row.claimedAt ?? 0) >= staleBefore
      if (!row || row.userId !== userId || row.attemptId !== args.attemptId || row.status !== 'pending' || hasActiveClaim) return []
      claimable.push(assessmentId)
    }
    for (const assessmentId of claimable) await ctx.db.patch(assessmentId, { inputDigest: args.inputDigest, claimedAt: now })
    return claimable
  },
})

export const recordAvailable = mutation({
  args: {
    attemptId: v.id('quizAttempts'),
    evaluatorSecret: v.string(),
    provider: v.string(),
    modelRevision: v.string(),
    results: v.array(v.object({
      assessmentId: v.id('quizAnswerAssessments'),
      inputDigest: v.string(),
      label: labelValidator,
      confidence: v.number(),
      probabilities: v.optional(probabilitiesValidator),
    })),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    requireEvaluatorSecret(args.evaluatorSecret)
    if (args.results.length < 1 || args.results.length > 8) throw new Error('Invalid assessment result')
    for (const result of args.results) {
      requireProbability(result.confidence)
      for (const probability of Object.values(result.probabilities ?? {})) {
        requireProbability(probability)
      }
      if (result.probabilities) {
        const values = Object.values(result.probabilities)
        if (Math.abs(values.reduce((sum, value) => sum + value, 0) - 1) > 0.001) throw new Error('Invalid assessment probability')
        const selected = result.label === 'fully_correct' ? result.probabilities.fullyCorrect
          : result.label === 'partially_correct' ? result.probabilities.partiallyCorrect
            : result.label === 'incorrect' ? result.probabilities.incorrect : result.probabilities.uncertain
        if (selected < Math.max(...values)) throw new Error('Invalid assessment probability')
      }
      const row = await ctx.db.get(result.assessmentId)
      if (!row || row.userId !== userId || row.attemptId !== args.attemptId || row.status !== 'pending' || row.inputDigest !== result.inputDigest) throw new Error('Assessment not found')
      await ctx.db.patch(result.assessmentId, {
        status: 'available',
        label: result.label,
        confidence: result.confidence,
        probabilities: result.probabilities,
        provider: args.provider,
        modelRevision: args.modelRevision,
        completedAt: Date.now(),
      })
    }
    return null
  },
})

export const recordUnavailable = mutation({
  args: {
    attemptId: v.id('quizAttempts'),
    evaluatorSecret: v.string(),
    assessmentIds: v.array(v.id('quizAnswerAssessments')),
    inputDigest: v.string(),
    reason: reasonValidator,
    retryable: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    requireEvaluatorSecret(args.evaluatorSecret)
    if (args.assessmentIds.length < 1 || args.assessmentIds.length > 8) throw new Error('Invalid assessment result')
    for (const assessmentId of args.assessmentIds) {
      const row = await ctx.db.get(assessmentId)
      if (!row || row.userId !== userId || row.attemptId !== args.attemptId || row.status !== 'pending' || row.inputDigest !== args.inputDigest) throw new Error('Assessment not found')
      await ctx.db.patch(assessmentId, {
        status: 'unavailable',
        unavailableReason: args.reason,
        retryable: args.retryable,
        completedAt: Date.now(),
      })
    }
    return null
  },
})
