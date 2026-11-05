import { v } from 'convex/values'
import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx } from './_generated/server'
import { internalAction, internalMutation, mutation } from './_generated/server'
import { internal } from './_generated/api'
import { requireAuth } from './lib/auth'
import { isRubricAssessment } from './lib/quizAnswerAssessment'
import { getQuizGradingAnswer, getQuizGradingAttempt, getQuizGradingRows, quizGradingInput, quizGradingInputDigest, recomputeQuizGradingScore, scheduleQuizGrading } from './lib/quizGrading'
import { quizCriterionResultValidator, scoreQuizCriteria } from '../shared/quiz-grading'
import { gradeQuizAnswers, QUIZ_GRADER_POLICY, QUIZ_GRADING_BATCH_SIZE, QUIZ_GRADING_FEEDBACK_LIMIT, QUIZ_GRADING_MAX_RETRY_DELAY_MS, type QuizGradingFailure, type QuizGradingInput } from '../server/utils/quiz-grading'

const LEASE_MS = 2 * 60_000
const MAX_ATTEMPTS = 3
const MAX_MANUAL_RETRIES = 2
const failureReason = v.union(v.literal('timeout'), v.literal('over_budget'), v.literal('unconfigured'), v.literal('malformed'), v.literal('unavailable'))
const claimFields = { claimId: undefined, claimedAt: undefined, leaseExpiresAt: undefined }
const revision = `${QUIZ_GRADER_POLICY.model}@${QUIZ_GRADER_POLICY.upstreamProvider}:${QUIZ_GRADER_POLICY.promptVersion}`
const batchClaim = { attemptId: v.id('quizAttempts'), claimId: v.string() }
type ClaimedBatch = { claimId: string, items: { input: QuizGradingInput, inputDigest: string }[] }

async function continueGrading(ctx: MutationCtx, attemptId: Id<'quizAttempts'>) {
  await recomputeQuizGradingScore(ctx, attemptId)
  const rows = await getQuizGradingRows(ctx, attemptId)
  const waiting = rows.filter(row => row.status === 'pending' && !row.claimId)
  if (waiting.length > 0) {
    const due = Math.min(...waiting.map(row => row.nextAttemptAt ?? 0))
    await ctx.scheduler.runAfter(Math.max(0, due - Date.now()), internal.quizGrading.gradeAttempt, { attemptId })
  }
}

async function matchesClaim(ctx: MutationCtx, row: Doc<'quizAnswerAssessments'> | null, attempt: Doc<'quizAttempts'>, claimId: string, inputDigest: string) {
  if (!row || row.status !== 'pending' || row.claimId !== claimId || row.inputDigest !== inputDigest
    || (row.leaseExpiresAt ?? 0) <= Date.now() || !await getQuizGradingAnswer(ctx, row, attempt)) return false
  try { return await quizGradingInputDigest(row) === inputDigest }
  catch { return false }
}

async function recordFailure(ctx: MutationCtx, row: Doc<'quizAnswerAssessments'>, failure: Omit<QuizGradingFailure, 'status'>) {
  const retryable = failure.retryable && (row.attemptCount ?? 0) < MAX_ATTEMPTS
  const delay = Math.min(QUIZ_GRADING_MAX_RETRY_DELAY_MS, Math.max(15_000 * 2 ** Math.max(0, (row.attemptCount ?? 1) - 1), failure.retryAfterMs ?? 0))
  await ctx.db.patch(row._id, {
    ...claimFields, inputDigest: undefined, dispatchedAt: undefined,
    status: retryable ? 'pending' : 'unavailable', unavailableReason: failure.reason, retryable,
    nextAttemptAt: retryable ? Date.now() + delay : undefined, completedAt: retryable ? undefined : Date.now(),
  })
}

export const claimBatch = internalMutation({
  args: { attemptId: v.id('quizAttempts') },
  handler: async (ctx, { attemptId }): Promise<ClaimedBatch | null> => {
    const scope = await getQuizGradingAttempt(ctx, attemptId)
    if (!scope) return null
    const rows = await getQuizGradingRows(ctx, attemptId)
    if (rows.some(row => row.status === 'pending' && row.claimId)) return null
    const ready = rows.filter(row => row.status === 'pending' && (row.nextAttemptAt ?? 0) <= Date.now()).slice(0, QUIZ_GRADING_BATCH_SIZE)
    const claimId = crypto.randomUUID()
    const items: ClaimedBatch['items'] = []
    const assessmentIds: Id<'quizAnswerAssessments'>[] = []
    let failed = 0
    for (const row of ready) {
      if (!await getQuizGradingAnswer(ctx, row, scope.attempt)) continue
      if ((row.attemptCount ?? 0) >= MAX_ATTEMPTS) {
        await recordFailure(ctx, row, { reason: 'unavailable', retryable: false })
        failed++
        continue
      }
      let input: QuizGradingInput
      let inputDigest: string
      try { input = quizGradingInput(row); inputDigest = await quizGradingInputDigest(row) }
      catch {
        await recordFailure(ctx, row, { reason: 'malformed', retryable: false })
        failed++
        continue
      }
      await ctx.db.patch(row._id, {
        claimId, inputDigest, claimedAt: Date.now(), leaseExpiresAt: Date.now() + LEASE_MS,
        attemptCount: (row.attemptCount ?? 0) + 1, dispatchedAt: undefined,
      })
      items.push({ input, inputDigest })
      assessmentIds.push(row._id)
    }
    if (items.length === 0) {
      if (failed > 0) await continueGrading(ctx, attemptId)
      return null
    }
    if (failed > 0) await recomputeQuizGradingScore(ctx, attemptId)
    await ctx.scheduler.runAfter(LEASE_MS, internal.quizGrading.recoverBatch, { attemptId, claimId, assessmentIds })
    return { claimId, items }
  },
})

export const markDispatched = internalMutation({
  args: { ...batchClaim, items: v.array(v.object({ assessmentId: v.id('quizAnswerAssessments'), inputDigest: v.string() })) },
  handler: async (ctx, args) => {
    const scope = await getQuizGradingAttempt(ctx, args.attemptId)
    if (!scope || args.items.length < 1 || args.items.length > QUIZ_GRADING_BATCH_SIZE || new Set(args.items.map(item => item.assessmentId)).size !== args.items.length) return false
    const rows = []
    for (const item of args.items) {
      const row = await ctx.db.get(item.assessmentId)
      if (!await matchesClaim(ctx, row, scope.attempt, args.claimId, item.inputDigest) || row!.dispatchedAt !== undefined) return false
      rows.push(row!)
    }
    for (const row of rows) await ctx.db.patch(row._id, { dispatchedAt: Date.now() })
    return true
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
    for (const item of args.items) {
      const row = await ctx.db.get(item.assessmentId)
      if (!await matchesClaim(ctx, row, scope.attempt, args.claimId, item.inputDigest)) continue
      await recordFailure(ctx, row!, args)
      changed++
    }
    if (changed > 0) await continueGrading(ctx, args.attemptId)
    return changed
  },
})

export const recoverBatch = internalMutation({
  args: { ...batchClaim, assessmentIds: v.array(v.id('quizAnswerAssessments')) },
  handler: async (ctx, args) => {
    const scope = await getQuizGradingAttempt(ctx, args.attemptId)
    if (!scope || args.assessmentIds.length > QUIZ_GRADING_BATCH_SIZE) return 0
    let recovered = 0
    for (const id of args.assessmentIds) {
      const row = await ctx.db.get(id)
      if (!row || row.status !== 'pending' || row.claimId !== args.claimId || (row.leaseExpiresAt ?? Infinity) > Date.now()
        || !await getQuizGradingAnswer(ctx, row, scope.attempt)) continue
      await recordFailure(ctx, row, { reason: 'timeout', retryable: true })
      recovered++
    }
    if (recovered > 0) await continueGrading(ctx, args.attemptId)
    return recovered
  },
})

export const gradeAttempt = internalAction({
  args: { attemptId: v.id('quizAttempts') },
  handler: async (ctx, { attemptId }) => {
    const claim: ClaimedBatch | null = await ctx.runMutation(internal.quizGrading.claimBatch, { attemptId })
    if (!claim) return
    const items = claim.items.map(item => ({ assessmentId: item.input.id as Id<'quizAnswerAssessments'>, inputDigest: item.inputDigest }))
    const dispatched: boolean = await ctx.runMutation(internal.quizGrading.markDispatched, { attemptId, claimId: claim.claimId, items })
    if (!dispatched) return
    const outcome = await gradeQuizAnswers(claim.items.map(item => item.input))
    if (outcome.status === 'graded') {
      await ctx.runMutation(internal.quizGrading.commitBatch, {
        attemptId, claimId: claim.claimId,
        results: outcome.results.map(result => ({
          assessmentId: result.id as Id<'quizAnswerAssessments'>, inputDigest: items.find(item => item.assessmentId === result.id)!.inputDigest,
          criterionResults: result.criterionResults, feedback: result.feedback,
        })),
      })
    }
    else {
      const { status: _status, ...failure } = outcome
      await ctx.runMutation(internal.quizGrading.failBatch, { attemptId, claimId: claim.claimId, items, ...failure })
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
      ...claimFields, status: 'available', credit, label, gradeSource: 'self', selfAssessedAt: Date.now(),
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
    let retried = 0
    for (const row of rows) {
      if (row.status !== 'unavailable' || row.gradeSource === 'self' || (row.manualRetryCount ?? 0) >= MAX_MANUAL_RETRIES
        || !await getQuizGradingAnswer(ctx, row, scope.attempt)) continue
      await ctx.db.patch(row._id, {
        ...claimFields, inputDigest: undefined, dispatchedAt: undefined,
        status: 'pending', attemptCount: 0, manualRetryCount: (row.manualRetryCount ?? 0) + 1,
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
