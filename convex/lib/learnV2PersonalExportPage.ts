import { z } from 'zod'
import type { Doc } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'
import { privacyReadBudgetExhausted } from './learnV2PrivacyReadContext'

export const PERSONAL_RESPONSE_COLLECTIONS = ['masteryAttempts', 'learningThreadActivities', 'learnResponses', 'learnResponseBodies'] as const
type Collection = typeof PERSONAL_RESPONSE_COLLECTIONS[number]
const prefix = 'learn-v2.personal-content-page.v1:'
const continuation = z.object({
  owner: z.string(), collection: z.enum(PERSONAL_RESPONSE_COLLECTIONS),
  pending: z.array(z.string()).min(1).max(8), cursor: z.string(), done: z.boolean(),
}).strict()

// A native page is read once. If its projections exhaust the shared budget,
// resume the remaining IDs before advancing to that page's native cursor.
// Only identifiers are carried; every resumed row is read and authorized again.
export async function personalResponsePage<C extends Collection, R>(ctx: QueryCtx, userId: string, collection: C,
  options: { cursor: string | null, numItems: number }, project: (row: Doc<C>) => Promise<R>) {
  let rows: Doc<C>[]
  let cursor: string
  let done: boolean
  if (options.cursor?.startsWith(prefix)) {
    const parsed = continuation.parse(JSON.parse(options.cursor.slice(prefix.length)))
    if (parsed.owner !== userId || parsed.collection !== collection) throw new Error('Export continuation unavailable')
    rows = []
    for (const value of parsed.pending) {
      const id = ctx.db.normalizeId(collection, value)
      if (!id) throw new Error('Export continuation unavailable')
      const row = await ctx.db.get(collection, id)
      if (row && row.userId !== userId) throw new Error('Export continuation unavailable')
      if (row) rows.push(row)
    }
    cursor = parsed.cursor
    done = parsed.done
  }
  else {
    const result = await ctx.db.query(collection).withIndex('by_userId', q => q.eq('userId', userId as never)).paginate(options)
    rows = result.page
    cursor = result.continueCursor
    done = result.isDone
  }
  const page: R[] = []
  for (const row of rows.slice(0, options.numItems)) {
    const projected = await project(row)
    // Retry a later row with a fresh budget; a first-row denial must advance.
    if (privacyReadBudgetExhausted(ctx) && page.length > 0) break
    page.push(projected)
    if (privacyReadBudgetExhausted(ctx)) break
  }
  const pending = rows.slice(page.length).map(row => row._id)
  if (pending.length) return { page, isDone: false, continueCursor: prefix + JSON.stringify({ owner: userId, collection, pending, cursor, done }) }
  return { page, isDone: done, continueCursor: cursor }
}
