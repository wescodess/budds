import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import { quizGradingProvider, type QuizGradingProvider } from '../../server/utils/quiz-grading'

// Public consume rejects this namespace, including identities/routes crafted to
// collide with it. Global buckets contain no learner identity or content.
export const INTERNAL_RATE_LIMIT_PREFIX = 'internal:quiz-grading:'
const DAY_MS = 86_400_000
const MINUTE_MS = 60_000
const ADMISSION_LIMIT = 3
const USER_DISPATCH_LIMIT = 25
const SHARED_DISPATCH_LIMIT = 50
const GROQ_SHARED_DISPATCH_LIMIT = 24
const GROQ_USER_DISPATCH_LIMIT = 12
const GROQ_DISPATCH_INTERVAL_MS = 61_000

type RollingKind = 'groq-dispatch-user' | 'groq-dispatch-shared'
type Kind = 'admission' | 'dispatch-user' | 'dispatch-shared' | 'cooldown' | 'groq-cooldown' | 'groq-pacing' | `${RollingKind}-${number}`
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

// Fixed, indexed slots bound both reads and storage, and keep each reservation
// until its own 24-hour expiry. UTC midnight cannot refill either allowance.
async function rollingWindow(ctx: MutationCtx, kind: RollingKind, limit: number, userId = '') {
  const slots = await Promise.all(Array.from({ length: limit }, (_, index) => bucket(ctx, `${kind}-${index}`, userId)))
  const freeSlot = slots.findIndex(row => !row || row.expiresAt <= Date.now())
  return { kind, userId, slots, freeSlot, retryAt: freeSlot < 0 ? Math.min(...slots.map(row => row!.expiresAt)) : 0 }
}
async function reserveRollingSlot(ctx: MutationCtx, window: Awaited<ReturnType<typeof rollingWindow>>) {
  const { kind, userId, slots, freeSlot } = window
  if (freeSlot < 0) throw new Error('Quiz grading reservation unavailable')
  const value = {
    key: key(`${kind}-${freeSlot}`, userId), userId, route: `quiz-grading/${kind}`,
    count: 1, windowStartedAt: Date.now(), expiresAt: Date.now() + DAY_MS,
  }
  const existing = slots[freeSlot]
  if (existing) await ctx.db.replace(existing._id, value)
  else await ctx.db.insert('rateLimitBuckets', value)
}
async function groqWindows(ctx: MutationCtx, userId: string) {
  return Promise.all([
    rollingWindow(ctx, 'groq-dispatch-user', GROQ_USER_DISPATCH_LIMIT, userId),
    rollingWindow(ctx, 'groq-dispatch-shared', GROQ_SHARED_DISPATCH_LIMIT),
  ])
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
export async function quizGradingCooldownUntil(ctx: MutationCtx, provider = quizGradingProvider(), includePacing = true) {
  const existing = await bucket(ctx, provider === 'groq' ? 'groq-cooldown' : 'cooldown')
  const pacing = provider === 'groq' && includePacing ? await bucket(ctx, 'groq-pacing') : null
  const until = Math.max(0, existing?.expiresAt ?? 0, pacing?.expiresAt ?? 0)
  return until > Date.now() ? until : 0
}
export async function extendQuizGradingCooldown(ctx: MutationCtx, notBefore: number, provider: QuizGradingProvider | null = quizGradingProvider()) {
  const kind = provider === 'groq' ? 'groq-cooldown' : 'cooldown'
  const existing = await bucket(ctx, kind)
  if ((existing?.expiresAt ?? 0) >= notBefore) return
  const value = { key: key(kind), userId: '', route: `quiz-grading/${kind}`, count: 0, windowStartedAt: Date.now(), expiresAt: notBefore }
  if (existing) await ctx.db.replace(existing._id, value)
  else await ctx.db.insert('rateLimitBuckets', value)
}
export async function quizGradingBudgetRetryAt(ctx: MutationCtx, userId: string) {
  const learner = await bucket(ctx, 'dispatch-user', userId)
  const sharedRetryAt = quizGradingProvider() === 'groq'
    ? Math.max(...(await groqWindows(ctx, userId)).map(window => window.retryAt))
    : blockedUntil(await bucket(ctx, 'dispatch-shared'), SHARED_DISPATCH_LIMIT)
  return Math.max(blockedUntil(learner, USER_DISPATCH_LIMIT), sharedRetryAt)
}
// The caller validates the complete, undispatched claim in this transaction.
export async function reserveQuizGradingDispatch(ctx: MutationCtx, userId: string) {
  const learner = await bucket(ctx, 'dispatch-user', userId)
  const isGroq = quizGradingProvider() === 'groq'
  const windows = isGroq ? await groqWindows(ctx, userId) : []
  const shared = isGroq ? null : await bucket(ctx, 'dispatch-shared')
  const sharedRetryAt = isGroq ? Math.max(...windows.map(window => window.retryAt)) : blockedUntil(shared, SHARED_DISPATCH_LIMIT)
  const retryAt = Math.max(blockedUntil(learner, USER_DISPATCH_LIMIT), sharedRetryAt, await quizGradingCooldownUntil(ctx))
  if (retryAt) return retryAt
  await increment(ctx, 'dispatch-user', userId, learner, DAY_MS)
  if (isGroq) {
    for (const window of windows) await reserveRollingSlot(ctx, window)
    const pacing = await bucket(ctx, 'groq-pacing')
    const value = { key: key('groq-pacing'), userId: '', route: 'quiz-grading/groq-pacing', count: 0, windowStartedAt: Date.now(), expiresAt: Date.now() + GROQ_DISPATCH_INTERVAL_MS }
    if (pacing) await ctx.db.replace(pacing._id, value)
    else await ctx.db.insert('rateLimitBuckets', value)
  }
  else await increment(ctx, 'dispatch-shared', '', shared, DAY_MS)
  return 0
}
