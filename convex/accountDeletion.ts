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

export async function enqueueDocumentCleanup(
  ctx: MutationCtx,
  args: {
    userId: string
    documentId: string
    status: Doc<'documents'>['status']
    r2Key?: string
  },
): Promise<{ r2Enqueued: boolean; aiSearchEnqueued: boolean }> {
  let r2Enqueued = false
  let aiSearchEnqueued = false

  if (args.r2Key) {
    await ctx.db.insert('pendingCleanup', {
      userId: args.userId,
      documentId: args.documentId,
      r2Key: args.r2Key,
      kind: 'r2',
      attempts: 0,
    })
    r2Enqueued = true
  }

  if (args.status === 'success' || args.status === 'indexing') {
    await ctx.db.insert('pendingCleanup', {
      userId: args.userId,
      documentId: args.documentId,
      kind: 'ai-search',
      attempts: 0,
    })
    aiSearchEnqueued = true
  }

  return { r2Enqueued, aiSearchEnqueued }
}

export const deleteCurrentUser = internalMutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Unauthenticated')
    return await deleteAccountCascadeImpl(ctx, identity.tokenIdentifier)
  },
})

export const deleteAccountCascade = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await deleteAccountCascadeImpl(ctx, args.userId)
  },
})

async function deleteAccountCascadeImpl(ctx: MutationCtx, userId: string) {
  const documents = await ctx.db
    .query('documents')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .collect()

  let enqueuedAiSearchPerDoc = 0

  for (const doc of documents) {
    const { aiSearchEnqueued } = await enqueueDocumentCleanup(ctx, {
      userId,
      documentId: String(doc._id),
      status: doc.status,
      r2Key: doc.r2Key,
    })
    if (aiSearchEnqueued) enqueuedAiSearchPerDoc++
    if (doc.fileId) {
      try {
        await ctx.storage.delete(doc.fileId)
      } catch {
        // best-effort
      }
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
  await deleteAllQuizAttemptsForUser(ctx, userId)
  await deleteAllQuizQuestionsForUser(ctx, userId)
  await deleteAllQuizzesForUser(ctx, userId)
  await deleteAllFlashcardsForUser(ctx, userId)
  await deleteAllFlashcardSetsForUser(ctx, userId)
  await deleteAllLearnProfilesForUser(ctx, userId)
  await deleteAllCourseSourceDocsForUser(ctx, userId)
  await deleteAllCourseSectionsForUser(ctx, userId)
  await deleteAllCoursesForUser(ctx, userId)
  await deleteAllFlashcardRoomCardsForUser(ctx, userId)
  await deleteAllFlashcardVersionCardsForUser(ctx, userId)
  await deleteAllFlashcardRoomVersionsForUser(ctx, userId)
  await deleteAllFlashcardRoomsForUser(ctx, userId)
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
}

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

async function deleteAllQuizAttemptsForUser(ctx: MutationCtx, userId: string) {
  while (true) {
    const batch = await ctx.db
      .query('quizAttempts')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .take(500)
    if (batch.length === 0) break
    for (const row of batch) await ctx.db.delete(row._id)
    if (batch.length < 500) break
  }
}

async function deleteAllQuizQuestionsForUser(ctx: MutationCtx, userId: string) {
  while (true) {
    const batch = await ctx.db
      .query('quizQuestions')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .take(500)
    if (batch.length === 0) break
    for (const row of batch) await ctx.db.delete(row._id)
    if (batch.length < 500) break
  }
}

async function deleteAllQuizzesForUser(ctx: MutationCtx, userId: string) {
  while (true) {
    const batch = await ctx.db
      .query('quizzes')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .take(500)
    if (batch.length === 0) break
    for (const row of batch) await ctx.db.delete(row._id)
    if (batch.length < 500) break
  }
}

async function deleteAllFlashcardsForUser(ctx: MutationCtx, userId: string) {
  while (true) {
    const batch = await ctx.db
      .query('flashcards')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .take(500)
    if (batch.length === 0) break
    for (const row of batch) await ctx.db.delete(row._id)
    if (batch.length < 500) break
  }
}

async function deleteAllFlashcardSetsForUser(ctx: MutationCtx, userId: string) {
  while (true) {
    const batch = await ctx.db
      .query('flashcardSets')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .take(500)
    if (batch.length === 0) break
    for (const row of batch) await ctx.db.delete(row._id)
    if (batch.length < 500) break
  }
}

async function deleteAllFlashcardRoomCardsForUser(ctx: MutationCtx, userId: string) {
  while (true) {
    const batch = await ctx.db
      .query('flashcardRoomCards')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .take(500)
    if (batch.length === 0) break
    for (const row of batch) await ctx.db.delete(row._id)
    if (batch.length < 500) break
  }
}

async function deleteAllFlashcardVersionCardsForUser(ctx: MutationCtx, userId: string) {
  while (true) {
    const batch = await ctx.db
      .query('flashcardVersionCards')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .take(500)
    if (batch.length === 0) break
    for (const row of batch) await ctx.db.delete(row._id)
    if (batch.length < 500) break
  }
}

async function deleteAllFlashcardRoomVersionsForUser(ctx: MutationCtx, userId: string) {
  while (true) {
    const batch = await ctx.db
      .query('flashcardRoomVersions')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .take(500)
    if (batch.length === 0) break
    for (const row of batch) await ctx.db.delete(row._id)
    if (batch.length < 500) break
  }
}

async function deleteAllFlashcardRoomsForUser(ctx: MutationCtx, userId: string) {
  while (true) {
    const batch = await ctx.db
      .query('flashcardRooms')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .take(500)
    if (batch.length === 0) break
    for (const row of batch) await ctx.db.delete(row._id)
    if (batch.length < 500) break
  }
}

async function deleteAllLearnProfilesForUser(ctx: MutationCtx, userId: string) {
  while (true) {
    const batch = await ctx.db
      .query('learnProfile')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .take(500)
    if (batch.length === 0) break
    for (const row of batch) await ctx.db.delete(row._id)
    if (batch.length < 500) break
  }
}

async function deleteAllCourseSourceDocsForUser(ctx: MutationCtx, userId: string) {
  const courses = await ctx.db
    .query('courses')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .collect()
  for (const course of courses) {
    while (true) {
      const batch = await ctx.db
        .query('courseSourceDocs')
        .withIndex('by_courseId', (q) => q.eq('courseId', course._id))
        .take(500)
      if (batch.length === 0) break
      for (const row of batch) await ctx.db.delete(row._id)
      if (batch.length < 500) break
    }
  }
}

async function deleteAllCourseSectionsForUser(ctx: MutationCtx, userId: string) {
  while (true) {
    const batch = await ctx.db
      .query('courseSections')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .take(500)
    if (batch.length === 0) break
    for (const row of batch) await ctx.db.delete(row._id)
    if (batch.length < 500) break
  }
}

async function deleteAllCoursesForUser(ctx: MutationCtx, userId: string) {
  while (true) {
    const batch = await ctx.db
      .query('courses')
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
