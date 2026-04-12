import { v } from 'convex/values'
import { internalMutation, internalAction, type MutationCtx } from './_generated/server'
import { internal } from './_generated/api'
import type { Doc } from './_generated/dataModel'

const MAX_ATTEMPTS = 10
const BASE_BACKOFF_MS = 30_000
const MAX_BACKOFF_MS = 3_600_000

export function backoffMs(attempts: number): number {
  const capped = Math.min(attempts, 20)
  return Math.min(BASE_BACKOFF_MS * Math.pow(2, capped), MAX_BACKOFF_MS)
}

export const deleteAccountCascade = internalMutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Unauthenticated')

    const userId = identity.tokenIdentifier

    const documents = await ctx.db
      .query('documents')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .collect()

    let enqueuedAiSearchPerDoc = 0

    for (const doc of documents) {
      if (doc.r2Key) {
        await ctx.db.insert('pendingCleanup', {
          userId,
          documentId: String(doc._id),
          r2Key: doc.r2Key,
          kind: 'r2',
          attempts: 0,
        })
      }
      if (doc.status === 'success' || doc.status === 'indexing') {
        await ctx.db.insert('pendingCleanup', {
          userId,
          documentId: String(doc._id),
          kind: 'ai-search',
          attempts: 0,
        })
        enqueuedAiSearchPerDoc++
      }
      try {
        await ctx.storage.delete(doc.fileId)
      } catch {
        // best-effort; storage may already be gone
      }
    }

    await ctx.db.insert('pendingCleanup', {
      userId,
      documentId: '__user_bulk__',
      kind: 'ai-search',
      attempts: 0,
    })

    await deleteAllMessagesForUser(ctx, userId)
    await deleteAllConversationsForUser(ctx, userId)
    await deleteAllDocumentsForUser(ctx, userId)
    await deleteAllFoldersForUser(ctx, userId)

    const userRow = await ctx.db
      .query('users')
      .withIndex('by_tokenIdentifier', (q) => q.eq('tokenIdentifier', userId))
      .unique()
    if (userRow) {
      await ctx.db.delete(userRow._id)
    }

    await ctx.scheduler.runAfter(0, internal.accountDeletion.drainPendingCleanup, { userId })

    return {
      documentsRemoved: documents.length,
      aiSearchRowsEnqueued: enqueuedAiSearchPerDoc + 1,
    }
  },
})

async function deleteAllMessagesForUser(ctx: MutationCtx, userId: string) {
  while (true) {
    const batch = await ctx.db
      .query('messages')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .take(500)
    if (batch.length === 0) break
    for (const row of batch) await ctx.db.delete(row._id)
    if (batch.length < 500) break
  }
}

async function deleteAllConversationsForUser(ctx: MutationCtx, userId: string) {
  while (true) {
    const batch = await ctx.db
      .query('conversations')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .take(500)
    if (batch.length === 0) break
    for (const row of batch) await ctx.db.delete(row._id)
    if (batch.length < 500) break
  }
}

async function deleteAllDocumentsForUser(ctx: MutationCtx, userId: string) {
  while (true) {
    const batch = await ctx.db
      .query('documents')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .take(500)
    if (batch.length === 0) break
    for (const row of batch) await ctx.db.delete(row._id)
    if (batch.length < 500) break
  }
}

async function deleteAllFoldersForUser(ctx: MutationCtx, userId: string) {
  while (true) {
    const batch = await ctx.db
      .query('folders')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .take(500)
    if (batch.length === 0) break
    for (const row of batch) await ctx.db.delete(row._id)
    if (batch.length < 500) break
  }
}

export const listPendingCleanupForUser = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('pendingCleanup')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .collect()
  },
})

export const removePendingCleanup = internalMutation({
  args: { id: v.id('pendingCleanup') },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id)
    if (row) await ctx.db.delete(args.id)
  },
})

export const recordRetry = internalMutation({
  args: {
    id: v.id('pendingCleanup'),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id)
    if (!row) return
    await ctx.db.patch(args.id, {
      attempts: row.attempts + 1,
      lastAttemptAt: Date.now(),
      lastError: args.error.slice(0, 500),
    })
  },
})

type PendingCleanupRow = Doc<'pendingCleanup'>

export const drainPendingCleanup = internalAction({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const rows = (await ctx.runMutation(
      internal.accountDeletion.listPendingCleanupForUser,
      { userId: args.userId },
    )) as PendingCleanupRow[]

    if (rows.length === 0) return

    let anyRescheduled = false
    let nextAttempts = MAX_ATTEMPTS

    for (const row of rows) {
      if (row.attempts >= MAX_ATTEMPTS) continue

      const outcome = await ctx.runAction(
        internal.documentActions.performCleanupAttempt,
        {
          kind: row.kind,
          userId: row.userId,
          documentId: row.documentId,
          r2Key: row.r2Key,
        },
      )

      if (outcome.ok) {
        await ctx.runMutation(internal.accountDeletion.removePendingCleanup, { id: row._id })
      } else {
        await ctx.runMutation(internal.accountDeletion.recordRetry, {
          id: row._id,
          error: outcome.error,
        })
        anyRescheduled = true
        if (row.attempts + 1 < nextAttempts) nextAttempts = row.attempts + 1
      }
    }

    if (anyRescheduled) {
      await ctx.scheduler.runAfter(backoffMs(nextAttempts), internal.accountDeletion.drainPendingCleanup, {
        userId: args.userId,
      })
    }
  },
})

export type CleanupAttemptResult =
  | { ok: true }
  | { ok: false; error: string }
