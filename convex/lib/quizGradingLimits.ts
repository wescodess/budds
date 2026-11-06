import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'

// Public consume rejects this namespace, including identities/routes crafted to
// collide with it. Global buckets contain no learner identity or content.
export const INTERNAL_RATE_LIMIT_PREFIX = 'internal:quiz-grading:'
const DAY_MS = 86_400_000
const MINUTE_MS = 60_000
const ADMISSION_LIMIT = 3
const USER_DISPATCH_LIMIT = 25
const SHARED_DISPATCH_LIMIT = 50

type Kind = 'admission' | 'dispatch-user' | 'dispatch-shared' | 'cooldown'
function key(kind: Kind, userId = '') {
  return `${INTERNAL_RATE_LIMIT_PREFIX}${kind}${userId ? `:${JSON.stringify(userId)}` : ''}`
}
async function bucket(ctx: MutationCtx, kind: Kind, userId = '') {
  return ctx.db.query('rateLimitBuckets').withIndex('by_key', q => q.eq('key', key(kind, userId))).unique()
}
async function increment(ctx: MutationCtx, kind: Kind, userId: string, row: Doc<'rateLimitBuckets'> | null, duration: number) {
  const now = Date.now()
  if (row && row.expiresAt > now) {
    await ctx.db.patch(row._id, { count: row.count + 1 })
    return
  }
  const windowStartedAt = duration === DAY_MS ? Math.floor(now / DAY_MS) * DAY_MS : now
  const value = { key: key(kind, userId), userId, route: `quiz-grading/${kind}`, count: 1, windowStartedAt, expiresAt: windowStartedAt + duration }
  if (row) await ctx.db.replace(row._id, value)
  else await ctx.db.insert('rateLimitBuckets', value)
}
function blockedUntil(row: Doc<'rateLimitBuckets'> | null, limit: number) {
  return row && row.expiresAt > Date.now() && row.count >= limit ? row.expiresAt : 0
}

export async function quizGradingAdmissionRetryAt(ctx: MutationCtx, userId: string) {
  return blockedUntil(await bucket(ctx, 'admission', userId), ADMISSION_LIMIT)
}
export async function admitQuizGradingAttempt(ctx: MutationCtx, attemptId: Id<'quizAttempts'>, userId: string) {
  const attempt = await ctx.db.get(attemptId)
  if (!attempt || attempt.userId !== userId) throw new Error('Attempt not found')
  if (attempt.gradingAdmittedAt !== undefined) return 0
  const existing = await bucket(ctx, 'admission', userId)
  const retryAt = blockedUntil(existing, ADMISSION_LIMIT)
  if (retryAt) return retryAt
  await increment(ctx, 'admission', userId, existing, MINUTE_MS)
  await ctx.db.patch(attemptId, { gradingAdmittedAt: Date.now() })
  return 0
}
export async function quizGradingCooldownUntil(ctx: MutationCtx) {
  const existing = await bucket(ctx, 'cooldown')
  return Math.max(0, existing?.expiresAt ?? 0)
}
export async function extendQuizGradingCooldown(ctx: MutationCtx, notBefore: number) {
  const existing = await bucket(ctx, 'cooldown')
  if ((existing?.expiresAt ?? 0) >= notBefore) return
  const value = { key: key('cooldown'), userId: '', route: 'quiz-grading/cooldown', count: 0, windowStartedAt: Date.now(), expiresAt: notBefore }
  if (existing) await ctx.db.replace(existing._id, value)
  else await ctx.db.insert('rateLimitBuckets', value)
}
export async function quizGradingBudgetRetryAt(ctx: MutationCtx, userId: string) {
  const learner = await bucket(ctx, 'dispatch-user', userId)
  const shared = await bucket(ctx, 'dispatch-shared')
  return Math.max(blockedUntil(learner, USER_DISPATCH_LIMIT), blockedUntil(shared, SHARED_DISPATCH_LIMIT))
}
// The caller validates the complete, undispatched claim in this transaction.
export async function reserveQuizGradingDispatch(ctx: MutationCtx, userId: string) {
  const learner = await bucket(ctx, 'dispatch-user', userId)
  const shared = await bucket(ctx, 'dispatch-shared')
  const retryAt = Math.max(blockedUntil(learner, USER_DISPATCH_LIMIT), blockedUntil(shared, SHARED_DISPATCH_LIMIT))
  if (retryAt) return retryAt
  await increment(ctx, 'dispatch-user', userId, learner, DAY_MS)
  await increment(ctx, 'dispatch-shared', '', shared, DAY_MS)
  return 0
}
