import { v } from 'convex/values'
import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx } from './_generated/server'
import { internalAction, internalMutation, mutation } from './_generated/server'
import { internal } from './_generated/api'
import { requireAuth } from './lib/auth'
import { isRubricAssessment } from './lib/quizAnswerAssessment'
import { getQuizGradingAnswer, getQuizGradingAttempt, getQuizGradingRows, quizGradingInput, quizGradingInputDigest, recomputeQuizGradingScore, scheduleQuizGrading } from './lib/quizGrading'
import { admitQuizGradingAttempt, extendQuizGradingCooldown, quizGradingAdmissionRetryAt, quizGradingBudgetRetryAt, quizGradingCooldownUntil, reserveQuizGradingDispatch } from './lib/quizGradingLimits'
import { quizCriterionResultValidator, scoreQuizCriteria } from '../shared/quiz-grading'
import { gradeQuizAnswers, QUIZ_GRADER_POLICY, QUIZ_GRADING_BATCH_SIZE, QUIZ_GRADING_FEEDBACK_LIMIT, QUIZ_GRADING_MAX_RETRY_DELAY_MS, QUIZ_GRADING_MAX_REQUEST_BYTES, quizGradingRequestBytes, type QuizGradingFailure, type QuizGradingInput } from '../server/utils/quiz-grading'

const LEASE_MS = 2 * 60_000
const MAX_ATTEMPTS = 3
const MAX_MANUAL_RETRIES = 2
const failureReason = v.union(v.literal('timeout'), v.literal('over_budget'), v.literal('unconfigured'), v.literal('malformed'), v.literal('unavailable'), v.literal('oversized_evidence'))
const claimFields = { claimId: undefined, claimedAt: undefined, leaseExpiresAt: undefined }
const revision = `${QUIZ_GRADER_POLICY.model}@${QUIZ_GRADER_POLICY.upstreamProvider}:${QUIZ_GRADER_POLICY.promptVersion}`
const batchClaim = { attemptId: v.id('quizAttempts'), claimId: v.string() }
const claimItems = v.array(v.object({ assessmentId: v.id('quizAnswerAssessments'), inputDigest: v.string() }))
type ClaimedBatch = { claimId: string, items: { assessmentId: Id<'quizAnswerAssessments'>, inputDigest: string }[] }

async function continueGrading(ctx: MutationCtx, attemptId: Id<'quizAttempts'>) {
  await recomputeQuizGradingScore(ctx, attemptId)
  const rows = await getQuizGradingRows(ctx, attemptId)
  if (rows.some(row => row.status === 'pending' && row.claimId)) return
  const waiting = rows.filter(row => row.status === 'pending')
  if (waiting.length > 0) {
    const attempt = await ctx.db.get(attemptId)
    const due = Math.max(Date.now(), attempt?.gradingNotBefore ?? 0, await quizGradingCooldownUntil(ctx), Math.min(...waiting.map(row => row.nextAttemptAt ?? 0)))
    await scheduleQuizGrading(ctx, attemptId, due)
  }
}

function retryDelay(row: Doc<'quizAnswerAssessments'>, retryAfterMs = 0) {
  return Math.min(QUIZ_GRADING_MAX_RETRY_DELAY_MS, Math.max(15_000 * 2 ** Math.max(0, (row.attemptCount ?? 1) - 1), retryAfterMs))
}

async function backoffAttempt(ctx: MutationCtx, attempt: Doc<'quizAttempts'>, dueAt: number, shared = false) {
  await ctx.db.patch(attempt._id, { gradingNotBefore: Math.max(attempt.gradingNotBefore ?? 0, dueAt) })
  if (shared) await extendQuizGradingCooldown(ctx, dueAt)
}

async function matchesClaim(ctx: MutationCtx, row: Doc<'quizAnswerAssessments'> | null, attempt: Doc<'quizAttempts'>, claimId: string, inputDigest: string) {
  if (!row || row.status !== 'pending' || row.claimId !== claimId || row.inputDigest !== inputDigest
    || (row.leaseExpiresAt ?? 0) <= Date.now() || !await getQuizGradingAnswer(ctx, row, attempt)) return false
  try { return await quizGradingInputDigest(row) === inputDigest }
  catch { return false }
}

async function recordFailure(ctx: MutationCtx, row: Doc<'quizAnswerAssessments'>, failure: Omit<QuizGradingFailure, 'status'>) {
  const retryable = failure.retryable && (row.attemptCount ?? 0) < MAX_ATTEMPTS
  const delay = retryDelay(row, failure.retryAfterMs)
  await ctx.db.patch(row._id, {
    ...claimFields, inputDigest: undefined, dispatchedAt: undefined,
    status: retryable ? 'pending' : 'unavailable', unavailableReason: failure.reason, retryable,
    nextAttemptAt: retryable ? Date.now() + delay : undefined, completedAt: retryable ? undefined : Date.now(),
  })
}

async function claimQuizBatch(ctx: MutationCtx, attemptId: Id<'quizAttempts'>): Promise<ClaimedBatch | null> {
  const scope = await getQuizGradingAttempt(ctx, attemptId)
  if (!scope) return null
  const rows = await getQuizGradingRows(ctx, attemptId)
  if (rows.some(row => row.status === 'pending' && row.claimId)) return null
  const notBefore = Math.max(scope.attempt.gradingNotBefore ?? 0, await quizGradingCooldownUntil(ctx))
  if (notBefore > Date.now()) {
    await scheduleQuizGrading(ctx, attemptId, notBefore)
    return null
  }
  const ready = rows.filter(row => row.status === 'pending' && (row.nextAttemptAt ?? 0) <= Date.now())
  const claimId = crypto.randomUUID()
  const items: ClaimedBatch['items'] = []
  const inputs: QuizGradingInput[] = []
  let failed = 0
  for (const row of ready) {
    if (items.length === QUIZ_GRADING_BATCH_SIZE) break
    if (!await getQuizGradingAnswer(ctx, row, scope.attempt)) continue
    if ((row.attemptCount ?? 0) >= MAX_ATTEMPTS) {
      await recordFailure(ctx, row, { reason: 'unavailable', retryable: false })
      failed++
      continue
    }
    let input: QuizGradingInput
    let inputDigest: string
    try {
      input = quizGradingInput(row)
      if (quizGradingRequestBytes([input]) > QUIZ_GRADING_MAX_REQUEST_BYTES) {
        await recordFailure(ctx, row, { reason: 'oversized_evidence', retryable: false })
        failed++
        continue
      }
      if (quizGradingRequestBytes([...inputs, input]) > QUIZ_GRADING_MAX_REQUEST_BYTES) continue
      inputDigest = await quizGradingInputDigest(row)
    }
    catch {
      await recordFailure(ctx, row, { reason: 'malformed', retryable: false })
      failed++
      continue
    }
    await ctx.db.patch(row._id, {
      claimId, inputDigest, claimedAt: Date.now(), leaseExpiresAt: Date.now() + LEASE_MS,
      attemptCount: (row.attemptCount ?? 0) + 1, dispatchedAt: undefined,
    })
    inputs.push(input)
    items.push({ assessmentId: row._id, inputDigest })
  }
  if (items.length === 0) {
    if (failed > 0 || ready.length === 0) await continueGrading(ctx, attemptId)
    return null
  }
  if (failed > 0) await recomputeQuizGradingScore(ctx, attemptId)
  // This transaction establishes recovery before any provider action can run.
  await ctx.scheduler.runAfter(LEASE_MS, internal.quizGrading.recoverBatch, { attemptId, claimId, assessmentIds: items.map(item => item.assessmentId) })
  return { claimId, items }
}

// Internal reservation boundary; recovery is atomic even without dispatch.
export const claimBatch = internalMutation({
  args: { attemptId: v.id('quizAttempts') },
  handler: (ctx, { attemptId }): Promise<ClaimedBatch | null> => claimQuizBatch(ctx, attemptId),
})

export const markDispatched = internalMutation({
  args: { ...batchClaim, items: claimItems },
  handler: async (ctx, args): Promise<QuizGradingInput[] | null> => {
    const scope = await getQuizGradingAttempt(ctx, args.attemptId)
    if (!scope || args.items.length < 1 || args.items.length > QUIZ_GRADING_BATCH_SIZE || new Set(args.items.map(item => item.assessmentId)).size !== args.items.length) return null
    const rows = []
    for (const item of args.items) {
      const row = await ctx.db.get(item.assessmentId)
      if (!await matchesClaim(ctx, row, scope.attempt, args.claimId, item.inputDigest) || row!.dispatchedAt !== undefined) return null
      rows.push(row!)
    }
    const allRows = await getQuizGradingRows(ctx, args.attemptId)
    if (allRows.filter(row => row.status === 'pending' && row.claimId === args.claimId).length !== rows.length) return null
    const notBefore = Math.max(scope.attempt.gradingNotBefore ?? 0, await quizGradingCooldownUntil(ctx))
    if (notBefore > Date.now()) {
      for (const row of rows) await ctx.db.patch(row._id, {
        ...claimFields, inputDigest: undefined, dispatchedAt: undefined,
        attemptCount: Math.max(0, (row.attemptCount ?? 1) - 1), nextAttemptAt: notBefore,
      })
      await continueGrading(ctx, args.attemptId)
      return null
    }
    const admissionRetryAt = await admitQuizGradingAttempt(ctx, args.attemptId, scope.attempt.userId)
    const retryAt = admissionRetryAt || await reserveQuizGradingDispatch(ctx, scope.attempt.userId)
    if (retryAt) {
      // Untried rows also settle so the learner can choose self-assessment.
      for (const row of allRows.filter(row => row.status === 'pending')) await ctx.db.patch(row._id, {
        ...claimFields, inputDigest: undefined, dispatchedAt: undefined,
        attemptCount: row.claimId === args.claimId ? Math.max(0, (row.attemptCount ?? 1) - 1) : row.attemptCount,
        status: 'unavailable', unavailableReason: 'over_budget', retryable: true,
        nextAttemptAt: retryAt, completedAt: Date.now(),
      })
      await recomputeQuizGradingScore(ctx, args.attemptId)
      return null
    }
    const inputs = rows.map(quizGradingInput)
    for (const row of rows) await ctx.db.patch(row._id, {
      dispatchedAt: Date.now(),
      ...(row.manualRetryPending ? { manualRetryCount: (row.manualRetryCount ?? 0) + 1, manualRetryPending: undefined } : {}),
    })
    return inputs
  },
})

export const commitBatch = internalMutation({
  args: {
    ...batchClaim,
    results: v.array(v.object({ assessmentId: v.id('quizAnswerAssessments'), inputDigest: v.string(), criterionResults: v.array(quizCriterionResultValidator), feedback: v.string() })),
  },
  handler: async (ctx, args) => {
    const scope = await getQuizGradingAttempt(ctx, args.attemptId)
    if (!scope || args.results.length < 1 || args.results.length > QUIZ_GRADING_BATCH_SIZE || new Set(args.results.map(result => result.assessmentId)).size !== args.results.length) return 0
    let committed = 0
    for (const result of args.results) {
      const row = await ctx.db.get(result.assessmentId)
      if (!await matchesClaim(ctx, row, scope.attempt, args.claimId, result.inputDigest) || row!.dispatchedAt === undefined) continue
      const grade = scoreQuizCriteria(row!.criteriaSnapshot ?? [], result.criterionResults)
      const feedback = result.feedback.trim().slice(0, QUIZ_GRADING_FEEDBACK_LIMIT)
      if (!feedback) continue
      await ctx.db.patch(row!._id, {
        ...claimFields, ...grade, status: 'available', gradeSource: 'model', feedback, criterionResults: result.criterionResults,
        provider: QUIZ_GRADER_POLICY.upstreamProvider, modelRevision: revision, completedAt: Date.now(),
        nextAttemptAt: undefined, unavailableReason: undefined, retryable: undefined,
      })
      await ctx.db.patch(row!.attemptAnswerId, { isCorrect: grade.credit === 1 })
      committed++
    }
    if (committed > 0) await continueGrading(ctx, args.attemptId)
    return committed
  },
})

export const failBatch = internalMutation({
  args: {
    ...batchClaim, items: v.array(v.object({ assessmentId: v.id('quizAnswerAssessments'), inputDigest: v.string() })),
    reason: failureReason, retryable: v.boolean(), retryAfterMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const scope = await getQuizGradingAttempt(ctx, args.attemptId)
    if (!scope || args.items.length > QUIZ_GRADING_BATCH_SIZE) return 0
    let changed = 0
    let dueAt = 0
    for (const item of args.items) {
      const row = await ctx.db.get(item.assessmentId)
      if (!await matchesClaim(ctx, row, scope.attempt, args.claimId, item.inputDigest)) continue
      await recordFailure(ctx, row!, args)
      if (args.retryable) dueAt = Math.max(dueAt, Date.now() + retryDelay(row!, args.retryAfterMs))
      changed++
    }
    if (changed > 0) {
      if (dueAt) await backoffAttempt(ctx, scope.attempt, dueAt, args.reason === 'over_budget')
      await continueGrading(ctx, args.attemptId)
    }
    return changed
  },
})

export const recoverBatch = internalMutation({
  args: { ...batchClaim, assessmentIds: v.array(v.id('quizAnswerAssessments')) },
  handler: async (ctx, args) => {
    const scope = await getQuizGradingAttempt(ctx, args.attemptId)
    if (!scope || args.assessmentIds.length > QUIZ_GRADING_BATCH_SIZE) return 0
    let recovered = 0
    let dueAt = 0
    for (const id of args.assessmentIds) {
      const row = await ctx.db.get(id)
      if (!row || row.status !== 'pending' || row.claimId !== args.claimId || (row.leaseExpiresAt ?? Infinity) > Date.now()
        || !await getQuizGradingAnswer(ctx, row, scope.attempt)) continue
      await recordFailure(ctx, row, { reason: 'timeout', retryable: true })
      dueAt = Math.max(dueAt, Date.now() + retryDelay(row))
      recovered++
    }
    if (recovered > 0) {
      await backoffAttempt(ctx, scope.attempt, dueAt)
      await continueGrading(ctx, args.attemptId)
    }
    return recovered
  },
})

// Convex retries scheduled mutations on internal errors; a scheduled action
// alone cannot protect the interval before its first claim transaction.
export const gradeAttempt = internalMutation({
  args: { attemptId: v.id('quizAttempts'), scheduledFor: v.optional(v.number()) },
  handler: async (ctx, { attemptId, scheduledFor }): Promise<ClaimedBatch | null> => {
    const scope = await getQuizGradingAttempt(ctx, attemptId)
    if (!scope || (scheduledFor !== undefined && scope.attempt.gradingWakeAt !== scheduledFor)) return null
    if (scope.attempt.gradingWakeAt !== undefined && (scheduledFor !== undefined || scope.attempt.gradingWakeAt <= Date.now())) {
      await ctx.db.patch(attemptId, { gradingWakeAt: undefined })
    }
    const claim = await claimQuizBatch(ctx, attemptId)
    if (claim) await ctx.scheduler.runAfter(0, internal.quizGrading.dispatchBatch, { attemptId, ...claim })
    return claim
  },
})

export const dispatchBatch = internalAction({
  args: { ...batchClaim, items: claimItems },
  handler: async (ctx, { attemptId, claimId, items }) => {
    // Validate scope, full claim and canonical digests; reserve budget and
    // retrieve stored inputs atomically. Scheduled action arguments hold no bodies.
    const inputs: QuizGradingInput[] | null = await ctx.runMutation(internal.quizGrading.markDispatched, { attemptId, claimId, items })
    if (!inputs) return
    const outcome = await gradeQuizAnswers(inputs)
    if (outcome.status === 'graded') {
      await ctx.runMutation(internal.quizGrading.commitBatch, {
        attemptId, claimId,
        results: outcome.results.map(result => ({
          assessmentId: result.id as Id<'quizAnswerAssessments'>, inputDigest: items.find(item => item.assessmentId === result.id)!.inputDigest,
          criterionResults: result.criterionResults, feedback: result.feedback,
        })),
      })
    }
    else {
      const { status: _status, ...failure } = outcome
      await ctx.runMutation(internal.quizGrading.failBatch, { attemptId, claimId, items, ...failure })
    }
  },
})

export const selfAssess = mutation({
  args: { attemptAnswerId: v.id('attemptAnswers'), verdict: v.union(v.literal('correct'), v.literal('partial'), v.literal('incorrect')) },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const answer = await ctx.db.get(args.attemptAnswerId)
    const scope = answer ? await getQuizGradingAttempt(ctx, answer.attemptId) : null
    if (!scope || scope.attempt.userId !== userId) throw new Error('Attempt not found')
    const row = await ctx.db.query('quizAnswerAssessments').withIndex('by_attemptAnswerId', q => q.eq('attemptAnswerId', args.attemptAnswerId)).unique()
    if (!row || !isRubricAssessment(row) || !await getQuizGradingAnswer(ctx, row, scope.attempt)) throw new Error('Grade not found')
    if (row.status === 'pending' || row.gradeSource === 'deterministic'
      || (row.status === 'available' && row.gradeSource !== 'model' && row.gradeSource !== 'self')) throw new Error('Grade cannot be self-assessed')
    const credit = args.verdict === 'correct' ? 1 : args.verdict === 'partial' ? 0.5 : 0
    const label = credit === 1 ? 'fully_correct' : credit === 0 ? 'incorrect' : 'partially_correct'
    await ctx.db.patch(row._id, {
      ...claimFields, status: 'available', credit, label, gradeSource: 'self', selfAssessedAt: Date.now(), manualRetryPending: undefined,
      nextAttemptAt: undefined, retryable: undefined, unavailableReason: undefined, completedAt: Date.now(),
    })
    await ctx.db.patch(args.attemptAnswerId, { isCorrect: credit === 1 })
    await recomputeQuizGradingScore(ctx, scope.attempt._id)
  },
})

export const requestGradingRetry = mutation({
  args: { attemptId: v.id('quizAttempts') },
  handler: async (ctx, { attemptId }) => {
    const userId = await requireAuth(ctx)
    const scope = await getQuizGradingAttempt(ctx, attemptId)
    if (!scope || scope.attempt.userId !== userId) throw new Error('Attempt not found')
    const rows = await getQuizGradingRows(ctx, attemptId)
    const candidates = []
    for (const row of rows) {
      if (row.status !== 'unavailable' || row.gradeSource === 'self' || (row.manualRetryCount ?? 0) >= MAX_MANUAL_RETRIES
        || row.unavailableReason === 'oversized_evidence' || !await getQuizGradingAnswer(ctx, row, scope.attempt)) continue
      try {
        if (quizGradingRequestBytes([quizGradingInput(row)]) > QUIZ_GRADING_MAX_REQUEST_BYTES) continue
      }
      catch { continue }
      candidates.push(row)
    }
    if (candidates.length === 0) return { retried: 0 }
    const retryAt = Math.max(scope.attempt.gradingNotBefore ?? 0, await quizGradingCooldownUntil(ctx),
      await quizGradingBudgetRetryAt(ctx, userId), scope.attempt.gradingAdmittedAt === undefined ? await quizGradingAdmissionRetryAt(ctx, userId) : 0)
    if (retryAt > Date.now()) return { retried: 0 }
    if (await admitQuizGradingAttempt(ctx, attemptId, userId)) return { retried: 0 }
    let retried = 0
    for (const row of candidates) {
      await ctx.db.patch(row._id, {
        ...claimFields, inputDigest: undefined, dispatchedAt: undefined,
        status: 'pending', attemptCount: 0,
        // Charge a manual cycle only when its first provider dispatch is reserved.
        manualRetryPending: row.manualRetryPending || (row.attemptCount ?? 0) > 0 ? true : undefined,
        nextAttemptAt: Date.now(), completedAt: undefined, unavailableReason: undefined, retryable: undefined,
      })
      retried++
    }
    if (retried > 0) {
      await recomputeQuizGradingScore(ctx, attemptId)
      await scheduleQuizGrading(ctx, attemptId)
    }
    return { retried }
  },
})
