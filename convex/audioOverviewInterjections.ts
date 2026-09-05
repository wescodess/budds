import { v } from 'convex/values'
import { internal } from './_generated/api'
import { internalMutation, mutation, query } from './_generated/server'
import type { Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'
import { getOptionalAuthUserId, requireAuth } from './lib/auth'
import {
  consumeVerifiedUploadClaims,
  releaseUploadOwnership,
  requireVerifiedUploadClaims,
} from './audioOverviewUploads'

const speakerValidator = v.union(v.literal('host_a'), v.literal('host_b'))

const answerTurnValidator = v.object({
  speaker: speakerValidator,
  text: v.string(),
  audioFileId: v.id('_storage'),
  uploadClaimId: v.id('audioOverviewUploadClaims'),
  durationMs: v.number(),
  sourceIndex: v.optional(v.number()),
  wordTimings: v.optional(v.array(
    v.object({
      word: v.string(),
      start: v.number(),
      end: v.number(),
    }),
  )),
})

async function requireOwnedOverview(
  ctx: QueryCtx | MutationCtx,
  overviewId: Id<'audioOverviews'>,
  userId: string,
) {
  const overview = await ctx.db.get(overviewId)
  if (!overview || overview.userId !== userId) throw new Error('Audio overview not found')
  return overview
}

export const create = mutation({
  args: {
    audioOverviewId: v.id('audioOverviews'),
    taskId: v.id('tasks'),
    insertedAfterTurnIndex: v.number(),
    question: v.string(),
    model: v.optional(v.string()),
    answerTurns: v.array(answerTurnValidator),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const overview = await requireOwnedOverview(ctx, args.audioOverviewId, userId)
    if (overview.status !== 'ready') throw new Error('Audio overview is not ready')

    if (args.answerTurns.length === 0) {
      throw new Error('Interjection requires at least one answer turn')
    }

    const trimmedQuestion = args.question.trim().slice(0, 500)
    if (!trimmedQuestion) throw new Error('Question is required')
    if (args.answerTurns.length === 0 || args.answerTurns.length > 4) {
      throw new Error('Interjection answer must contain 1 to 4 turns')
    }
    const task = await ctx.db.get(args.taskId)
    if (
      !task
      || task.userId !== userId
      || task.folderId !== overview.folderId
      || task.type !== 'audio-overview-generation'
      || task.status !== 'running'
      || !task.audioOverviewRequest
    ) {
      throw new Error('Reserved audio overview task not found')
    }
    const expectedScope = overview.scopeDocIds
    const reservedDocIds = task.audioOverviewRequest.documents.map(source => source.documentId)
    if (
      expectedScope?.length
        ? reservedDocIds.length !== expectedScope.length
          || expectedScope.some(id => !reservedDocIds.includes(id))
        : task.audioOverviewRequest.scope.mode !== 'folder'
    ) {
      throw new Error('Reserved audio overview scope does not match')
    }

    const claims = await requireVerifiedUploadClaims(ctx, userId, task._id, args.answerTurns)
    const persistedTurns = args.answerTurns.map(({ uploadClaimId: _claimId, ...turn }) => turn)

    const clampedAfterIndex = Math.max(
      0,
      Math.min(args.insertedAfterTurnIndex, overview.turns.length),
    )

    const interjectionId = await ctx.db.insert('audioOverviewInterjections', {
      audioOverviewId: args.audioOverviewId,
      userId,
      insertedAfterTurnIndex: clampedAfterIndex,
      question: trimmedQuestion,
      model: args.model,
      answerTurns: persistedTurns,
    })

    await consumeVerifiedUploadClaims(ctx, claims)
    const now = Date.now()
    await ctx.db.patch(task._id, {
      status: 'completed',
      result: { interjectionId, turnCount: persistedTurns.length },
      progress: 'Complete',
      updatedAt: now,
      completedAt: now,
    })

    return { interjectionId }
  },
})

export const listByOverview = query({
  args: { audioOverviewId: v.id('audioOverviews') },
  handler: async (ctx, args) => {
    const userId = await getOptionalAuthUserId(ctx)
    if (!userId) return []
    const overview = await ctx.db.get(args.audioOverviewId)
    if (!overview || overview.userId !== userId) return []

    const rows = await ctx.db
      .query('audioOverviewInterjections')
      .withIndex('by_audioOverview', (q) => q.eq('audioOverviewId', args.audioOverviewId))
      .order('asc')
      .collect()

    return rows
  },
})

export const getTurnUrls = query({
  args: { id: v.id('audioOverviewInterjections') },
  handler: async (ctx, args) => {
    const userId = await getOptionalAuthUserId(ctx)
    if (!userId) return null
    const row = await ctx.db.get(args.id)
    if (!row || row.userId !== userId) return null
    const urls: (string | null)[] = []
    for (const turn of row.answerTurns) {
      urls.push(await ctx.storage.getUrl(turn.audioFileId))
    }
    return urls
  },
})

export const deleteInterjection = mutation({
  args: { id: v.id('audioOverviewInterjections') },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const row = await ctx.db.get(args.id)
    if (!row || row.userId !== userId) throw new Error('Interjection not found')

    await ctx.scheduler.runAfter(0, internal.audioOverviewInterjections.deleteInterjectionBatch, {
      id: row._id,
      userId,
    })
    return { scheduled: true }
  },
})

export const deleteInterjectionBatch = internalMutation({
  args: {
    id: v.id('audioOverviewInterjections'),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id)
    if (!row || row.userId !== args.userId) return

    const batch = row.answerTurns.slice(0, 4)
    const failed: typeof batch = []
    for (const turn of batch) {
      let deletionSucceeded = false
      try {
        await ctx.storage.delete(turn.audioFileId)
        deletionSucceeded = true
      }
      catch {
        try {
          deletionSucceeded = (await ctx.storage.getUrl(turn.audioFileId)) === null
        }
        catch { /* retry below */ }
      }
      await releaseUploadOwnership(ctx, turn.audioFileId, deletionSucceeded)
      if (!deletionSucceeded) failed.push(turn)
    }

    const remaining = [...failed, ...row.answerTurns.slice(batch.length)]
    if (remaining.length === 0) {
      await ctx.db.delete(row._id)
      return
    }
    await ctx.db.patch(row._id, { answerTurns: remaining })
    await ctx.scheduler.runAfter(failed.length > 0 ? 60_000 : 0, internal.audioOverviewInterjections.deleteInterjectionBatch, args)
  },
})
