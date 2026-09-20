import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { requireAuth } from './lib/auth'
import manifest from '../workers/laya-evaluator/learningDecisionManifest.json'

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
  v.literal('unsupported_language'),
  v.literal('unknown_language'),
  v.literal('missing_evidence'),
  v.literal('oversized_evidence'),
)
const probabilitiesValidator = v.object({
  fullyCorrect: v.number(),
  partiallyCorrect: v.number(),
  incorrect: v.number(),
  uncertain: v.number(),
})
const CLAIM_LEASE_MS = manifest.retry.leaseMs
const MAX_ATTEMPTS = manifest.retry.maxAttempts
const MAX_BATCH = manifest.limits.semanticBatchSize
const PENDING_SCAN_LIMIT = 200

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
    const now = Date.now()
    const indexedRows = await ctx.db
      .query('quizAnswerAssessments')
      .withIndex('by_userId_and_attemptId_and_status_and_nextAttemptAt', q => q
        .eq('userId', userId).eq('attemptId', args.attemptId).eq('status', 'pending').lte('nextAttemptAt', now))
      .take(PENDING_SCAN_LIMIT)
    const legacyRows = await ctx.db
      .query('quizAnswerAssessments')
      .withIndex('by_userId_and_attemptId_and_status_and_nextAttemptAt', q => q
        .eq('userId', userId).eq('attemptId', args.attemptId).eq('status', 'pending').eq('nextAttemptAt', undefined))
      .take(PENDING_SCAN_LIMIT)
    const rows = [...indexedRows, ...legacyRows]
      .filter((row, index, all) => all.findIndex(candidate => candidate._id === row._id) === index)
    return rows.filter(row => row.inputDigest === undefined || (row.leaseExpiresAt ?? ((row.claimedAt ?? 0) + CLAIM_LEASE_MS)) <= now)
      .slice(0, MAX_BATCH).map(row => ({
      assessmentId: row._id,
      kind: row.kind,
      contractVersion: row.contractVersion ?? manifest.contractVersion,
      snapshotVersion: row.snapshotVersion ?? manifest.snapshotVersion,
      languageSnapshot: row.languageSnapshot ?? 'unknown',
      questionSnapshot: row.questionSnapshot,
      learnerAnswerSnapshot: row.learnerAnswerSnapshot,
      rubricVersion: row.rubricVersion,
      rubricSnapshot: row.rubricSnapshot,
      attemptCount: row.attemptCount ?? 0,
    }))
  },
})

export const claimBatch = mutation({
  args: {
    attemptId: v.id('quizAttempts'),
    assessmentIds: v.array(v.id('quizAnswerAssessments')),
    inputDigest: v.string(),
    claimId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const attempt = await ctx.db.get(args.attemptId)
    if (!attempt || attempt.userId !== userId || attempt.status !== 'completed') throw new Error('Attempt not found')
    if (!/^[a-f0-9]{64}$/.test(args.inputDigest) || args.claimId.length < 1 || args.claimId.length > 128
      || args.assessmentIds.length < 1 || args.assessmentIds.length > MAX_BATCH
      || new Set(args.assessmentIds.map(String)).size !== args.assessmentIds.length) throw new Error('Invalid assessment claim')
    const rows = []
    const now = Date.now()
    for (const assessmentId of args.assessmentIds) {
      const row = await ctx.db.get(assessmentId)
      const hasActiveClaim = row?.inputDigest !== undefined && (row.leaseExpiresAt ?? ((row.claimedAt ?? 0) + CLAIM_LEASE_MS)) > now
      if (!row || row.userId !== userId || row.attemptId !== args.attemptId || row.status !== 'pending'
        || hasActiveClaim || (row.nextAttemptAt ?? row.requestedAt) > now) return []
      rows.push(row)
    }
    const claimable = []
    for (const row of rows) {
      if ((row.attemptCount ?? 0) >= MAX_ATTEMPTS) {
        await ctx.db.patch(row._id, {
          status: 'unavailable',
          inputDigest: undefined,
          claimId: undefined,
          claimedAt: undefined,
          leaseExpiresAt: undefined,
          unavailableReason: row.unavailableReason ?? 'unavailable',
          retryable: false,
          nextAttemptAt: undefined,
          completedAt: now,
        })
        continue
      }
      await ctx.db.patch(row._id, {
        inputDigest: args.inputDigest,
        claimId: args.claimId,
        claimedAt: now,
        leaseExpiresAt: now + CLAIM_LEASE_MS,
        attemptCount: (row.attemptCount ?? 0) + 1,
      })
      claimable.push(row._id)
    }
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
      claimId: v.string(),
      label: labelValidator,
      confidence: v.number(),
      probabilities: v.optional(probabilitiesValidator),
    })),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    requireEvaluatorSecret(args.evaluatorSecret)
    if (args.results.length < 1 || args.results.length > MAX_BATCH) throw new Error('Invalid assessment result')
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
      if (!row || row.userId !== userId || row.attemptId !== args.attemptId || row.status !== 'pending'
        || row.inputDigest !== result.inputDigest || row.claimId !== result.claimId) throw new Error('Assessment not found')
      await ctx.db.patch(result.assessmentId, {
        status: 'available',
        label: result.label,
        confidence: result.confidence,
        probabilities: result.probabilities,
        provider: args.provider,
        modelRevision: args.modelRevision,
        claimId: undefined,
        claimedAt: undefined,
        leaseExpiresAt: undefined,
        unavailableReason: undefined,
        retryable: undefined,
        nextAttemptAt: undefined,
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
    claimId: v.string(),
    reason: reasonValidator,
    retryable: v.boolean(),
    retryAfterMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    requireEvaluatorSecret(args.evaluatorSecret)
    if (args.assessmentIds.length < 1 || args.assessmentIds.length > MAX_BATCH) throw new Error('Invalid assessment result')
    if (args.retryAfterMs !== undefined && (!Number.isFinite(args.retryAfterMs) || args.retryAfterMs < 0 || args.retryAfterMs > manifest.retry.retryAfterMaxMs)) throw new Error('Invalid retry delay')
    const now = Date.now()
    for (const assessmentId of args.assessmentIds) {
      const row = await ctx.db.get(assessmentId)
      if (!row || row.userId !== userId || row.attemptId !== args.attemptId || row.status !== 'pending'
        || row.inputDigest !== args.inputDigest || row.claimId !== args.claimId) throw new Error('Assessment not found')
      const attemptCount = row.attemptCount ?? 1
      const shouldRetry = args.retryable && attemptCount < MAX_ATTEMPTS
      if (shouldRetry) {
        const exponentialDelay = Math.min(manifest.retry.baseDelayMs * 2 ** Math.max(0, attemptCount - 1), manifest.retry.maxDelayMs)
        const delay = Math.min(Math.max(args.retryAfterMs ?? exponentialDelay, exponentialDelay), manifest.retry.maxDelayMs)
        await ctx.db.patch(assessmentId, {
          status: 'pending',
          inputDigest: undefined,
          claimId: undefined,
          claimedAt: undefined,
          leaseExpiresAt: undefined,
          unavailableReason: args.reason,
          retryable: true,
          nextAttemptAt: now + delay,
          completedAt: undefined,
        })
      }
      else {
        await ctx.db.patch(assessmentId, {
          status: 'unavailable',
          inputDigest: undefined,
          claimId: undefined,
          claimedAt: undefined,
          unavailableReason: args.reason,
          retryable: false,
          leaseExpiresAt: undefined,
          completedAt: now,
        })
      }
    }
    return null
  },
})
