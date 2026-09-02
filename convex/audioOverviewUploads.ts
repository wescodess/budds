import { v } from 'convex/values'
import { internal } from './_generated/api'
import { internalMutation, internalQuery, mutation } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx } from './_generated/server'
import { requireAuth } from './lib/auth'

const CLAIM_TTL_MS = 75 * 60 * 1000
const ABORT_RECONCILIATION_MS = 24 * 60 * 60 * 1000
const MAX_AUDIO_BYTES = 50 * 1024 * 1024
const MAX_CLAIMS_PER_TASK = 50
const MAX_AUDIO_BYTES_PER_TASK = 60 * 1024 * 1024
const SHA256_PATTERN = /^[0-9a-f]{64}$/i

function normalizeSha256(value: string): string {
  if (!SHA256_PATTERN.test(value)) throw new Error('Invalid audio checksum')
  return value.toLowerCase()
}

function storageSha256AsHex(value: string): string {
  if (SHA256_PATTERN.test(value)) return value.toLowerCase()
  try {
    return Array.from(atob(value), byte => byte.charCodeAt(0).toString(16).padStart(2, '0')).join('')
  }
  catch {
    return value
  }
}

export const prepare = mutation({
  args: { taskId: v.id('tasks') },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const task = await ctx.db.get(args.taskId)
    if (
      !task
      || task.userId !== userId
      || task.type !== 'audio-overview-generation'
      || task.status !== 'running'
      || !task.audioOverviewRequest
    ) {
      throw new Error('Running audio overview task required')
    }
    const existingClaims = await ctx.db
      .query('audioOverviewUploadClaims')
      .withIndex('by_taskId', q => q.eq('taskId', task._id))
      .take(MAX_CLAIMS_PER_TASK)
    if (existingClaims.length >= MAX_CLAIMS_PER_TASK) {
      throw new Error('Audio upload claim limit reached')
    }
    const nonce = crypto.randomUUID()
    const claimId = await ctx.db.insert('audioOverviewUploadClaims', {
      userId,
      taskId: task._id,
      nonce,
      expiresAt: Date.now() + CLAIM_TTL_MS,
    })
    return { claimId, nonce }
  },
})

export const begin = mutation({
  args: {
    claimId: v.id('audioOverviewUploadClaims'),
    expectedSha256: v.string(),
    expectedSize: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const claim = await ctx.db.get(args.claimId)
    if (!claim || claim.userId !== userId) throw new Error('Upload claim not found')
    if (claim.begunAt || claim.storageId || claim.expiresAt < Date.now()) {
      throw new Error('Upload claim is not available')
    }
    const task = claim.taskId ? await ctx.db.get(claim.taskId) : null
    if (
      !task
      || task.userId !== userId
      || task.type !== 'audio-overview-generation'
      || task.status !== 'running'
      || !task.audioOverviewRequest
    ) {
      throw new Error('Running audio overview task required')
    }

    const expectedSha256 = normalizeSha256(args.expectedSha256)
    if (!Number.isInteger(args.expectedSize) || args.expectedSize <= 0 || args.expectedSize > MAX_AUDIO_BYTES) {
      throw new Error('Invalid audio size')
    }
    const taskClaims = await ctx.db
      .query('audioOverviewUploadClaims')
      .withIndex('by_taskId', q => q.eq('taskId', task._id))
      .take(MAX_CLAIMS_PER_TASK)
    const allocatedBytes = taskClaims.reduce((total, item) => total + (item.expectedSize ?? 0), 0)
    if (allocatedBytes + args.expectedSize > MAX_AUDIO_BYTES_PER_TASK) {
      throw new Error('Audio upload byte limit reached')
    }

    const begunAt = Date.now()
    await ctx.db.patch(claim._id, {
      expectedSha256,
      expectedSize: args.expectedSize,
      begunAt,
      expiresAt: begunAt + CLAIM_TTL_MS,
    })
    const uploadUrl = await ctx.storage.generateUploadUrl()
    return { uploadUrl }
  },
})

async function finalizeUploadClaim(
  ctx: MutationCtx,
  args: {
    claimId: Id<'audioOverviewUploadClaims'>
    storageId: Id<'_storage'>
    userId: string
  },
): Promise<null> {
  const claim = await ctx.db.get(args.claimId)
  if (!claim || claim.userId !== args.userId) throw new Error('Upload claim not found')
  if (claim.storageId) {
    if (claim.storageId === args.storageId) return null
    throw new Error('Upload claim is already complete')
  }
  if (claim.abortingStorageId) throw new Error('Upload claim is being discarded')
  if (claim.expiresAt < Date.now()) throw new Error('Upload claim expired')
  if (!claim.begunAt || !claim.expectedSha256 || !claim.expectedSize) {
    throw new Error('Upload claim has not begun')
  }

  const metadata = await ctx.db.system.get('_storage', args.storageId)
  if (!metadata) throw new Error('Storage blob does not exist')
  if (storageSha256AsHex(metadata.sha256) !== claim.expectedSha256 || metadata.size !== claim.expectedSize) {
    throw new Error('Storage blob does not match upload claim')
  }
  if (metadata.contentType && !metadata.contentType.startsWith('audio/')) {
    throw new Error('Storage blob is not audio')
  }

  const existingOwner = await ctx.db
    .query('audioOverviewUploadClaims')
    .withIndex('by_storageId', q => q.eq('storageId', args.storageId))
    .unique()
  if (existingOwner) throw new Error('Storage blob is already claimed')

  await ctx.db.patch(claim._id, { storageId: args.storageId })
  return null
}

export const getCompletionContext = internalQuery({
  args: {
    claimId: v.id('audioOverviewUploadClaims'),
    storageId: v.id('_storage'),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const claim = await ctx.db.get(args.claimId)
    if (!claim || claim.userId !== args.userId) throw new Error('Upload claim not found')
    if (claim.storageId) {
      if (claim.storageId === args.storageId) return { alreadyComplete: true as const }
      throw new Error('Upload claim is already complete')
    }
    if (claim.abortingStorageId) throw new Error('Upload claim is being discarded')
    if (claim.expiresAt < Date.now()) throw new Error('Upload claim expired')
    if (!claim.begunAt || !claim.expectedSha256 || !claim.expectedSize) {
      throw new Error('Upload claim has not begun')
    }

    const metadata = await ctx.db.system.get('_storage', args.storageId)
    if (!metadata) throw new Error('Storage blob does not exist')
    if (storageSha256AsHex(metadata.sha256) !== claim.expectedSha256 || metadata.size !== claim.expectedSize) {
      throw new Error('Storage blob does not match upload claim')
    }
    if (metadata.contentType && !metadata.contentType.startsWith('audio/')) {
      throw new Error('Storage blob is not audio')
    }
    const existingOwner = await ctx.db
      .query('audioOverviewUploadClaims')
      .withIndex('by_storageId', q => q.eq('storageId', args.storageId))
      .unique()
    if (existingOwner) throw new Error('Storage blob is already claimed')

    return {
      alreadyComplete: false as const,
      nonce: claim.nonce,
    }
  },
})

export const finalize = internalMutation({
  args: {
    claimId: v.id('audioOverviewUploadClaims'),
    storageId: v.id('_storage'),
    userId: v.string(),
  },
  handler: finalizeUploadClaim,
})

export const getAbortContext = internalQuery({
  args: {
    claimId: v.id('audioOverviewUploadClaims'),
    storageId: v.id('_storage'),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const claim = await ctx.db.get(args.claimId)
    if (
      !claim
      || claim.userId !== args.userId
      || claim.storageId
      || claim.abortingStorageId
      || claim.consumedAt
      || !claim.begunAt
    ) {
      throw new Error('Upload claim is not discardable')
    }
    const metadata = await ctx.db.system.get('_storage', args.storageId)
    if (!metadata) throw new Error('Storage blob does not exist')
    const existingOwner = await ctx.db
      .query('audioOverviewUploadClaims')
      .withIndex('by_storageId', q => q.eq('storageId', args.storageId))
      .unique()
    if (existingOwner) throw new Error('Storage blob is already claimed')
    return { nonce: claim.nonce }
  },
})

export const reserveVerifiedAbort = internalMutation({
  args: {
    claimId: v.id('audioOverviewUploadClaims'),
    storageId: v.id('_storage'),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const claim = await ctx.db.get(args.claimId)
    if (
      !claim
      || claim.userId !== args.userId
      || claim.storageId
      || claim.consumedAt
      || claim.abortingStorageId
    ) {
      throw new Error('Upload claim is not discardable')
    }
    await ctx.db.patch(claim._id, {
      abortingStorageId: args.storageId,
      expiresAt: Date.now(),
    })
  },
})

export const finishVerifiedAbort = internalMutation({
  args: {
    claimId: v.id('audioOverviewUploadClaims'),
    storageId: v.id('_storage'),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const claim = await ctx.db.get(args.claimId)
    if (
      claim
      && claim.userId === args.userId
      && claim.abortingStorageId === args.storageId
      && !claim.storageId
      && !claim.consumedAt
    ) {
      await ctx.db.delete(claim._id)
    }
  },
})

export async function requireVerifiedUploadClaims(
  ctx: MutationCtx,
  userId: string,
  taskId: Id<'tasks'>,
  turns: Array<{ audioFileId: Id<'_storage'>, uploadClaimId: Id<'audioOverviewUploadClaims'> }>,
): Promise<Doc<'audioOverviewUploadClaims'>[]> {
  const task = await ctx.db.get(taskId)
  if (
    !task
    || task.userId !== userId
    || task.type !== 'audio-overview-generation'
    || task.status !== 'running'
  ) {
    throw new Error('Running audio overview task required')
  }
  const seen = new Set<string>()
  const claims: Doc<'audioOverviewUploadClaims'>[] = []

  for (const turn of turns) {
    if (seen.has(turn.uploadClaimId)) throw new Error('Upload claim cannot be reused')
    seen.add(turn.uploadClaimId)
    const claim = await ctx.db.get(turn.uploadClaimId)
    if (
      !claim
      || claim.userId !== userId
      || claim.taskId !== taskId
      || claim.storageId !== turn.audioFileId
      || claim.consumedAt !== undefined
      || claim.expiresAt < Date.now()
    ) {
      throw new Error('Verified upload claim required')
    }
    claims.push(claim)
  }

  return claims
}

export async function consumeVerifiedUploadClaims(
  ctx: MutationCtx,
  claims: Doc<'audioOverviewUploadClaims'>[],
): Promise<void> {
  const consumedAt = Date.now()
  for (const claim of claims) {
    await ctx.db.patch(claim._id, {
      consumedAt,
      expiresAt: Number.MAX_SAFE_INTEGER,
    })
  }
}

export async function releaseUploadOwnership(
  ctx: MutationCtx,
  storageId: Id<'_storage'>,
  deletionSucceeded: boolean,
): Promise<void> {
  const claim = await ctx.db
    .query('audioOverviewUploadClaims')
    .withIndex('by_storageId', q => q.eq('storageId', storageId))
    .unique()
  if (!claim) return
  if (deletionSucceeded) {
    await ctx.db.delete(claim._id)
  }
  else {
    await ctx.db.patch(claim._id, {
      consumedAt: undefined,
      expiresAt: Date.now(),
    })
  }
}

export const discard = mutation({
  args: { claimIds: v.array(v.id('audioOverviewUploadClaims')) },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    if (args.claimIds.length > MAX_CLAIMS_PER_TASK) throw new Error('Too many upload claims')
    const claims: Doc<'audioOverviewUploadClaims'>[] = []
    for (const claimId of new Set(args.claimIds)) {
      const claim = await ctx.db.get(claimId)
      if (!claim || claim.userId !== userId) throw new Error('Upload claim not found')
      if (claim.consumedAt) throw new Error('Consumed upload claim cannot be discarded')
      claims.push(claim)
    }

    let deletedBlobs = 0
    for (const claim of claims) {
      const storageId = claim.storageId ?? claim.abortingStorageId
      if (storageId) {
        try {
          await ctx.storage.delete(storageId)
          deletedBlobs += 1
          await ctx.db.delete(claim._id)
        }
        catch {
          await ctx.db.patch(claim._id, { expiresAt: Date.now() })
        }
      }
      else {
        await ctx.db.delete(claim._id)
      }
    }
    return { deletedBlobs }
  },
})

export const cleanupExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const expired = await ctx.db
      .query('audioOverviewUploadClaims')
      .withIndex('by_expiresAt', q => q.lt('expiresAt', Date.now()))
      .take(25)

    for (const claim of expired) {
      const storageId = claim.storageId ?? claim.abortingStorageId
      if (!storageId) {
        if (claim.begunAt && claim.begunAt + ABORT_RECONCILIATION_MS > Date.now()) {
          await ctx.db.patch(claim._id, {
            expiresAt: claim.begunAt + ABORT_RECONCILIATION_MS,
          })
          continue
        }
        await ctx.db.delete(claim._id)
        continue
      }
      try {
        await ctx.storage.delete(storageId)
        await ctx.db.delete(claim._id)
      }
      catch {
        await ctx.db.patch(claim._id, { expiresAt: Date.now() + 60 * 60 * 1000 })
      }
    }

    if (expired.length === 25) {
      await ctx.scheduler.runAfter(0, internal.audioOverviewUploads.cleanupExpired, {})
    }
    return { processed: expired.length }
  },
})

export const cleanupUserClaims = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const batch = await ctx.db
      .query('audioOverviewUploadClaims')
      .withIndex('by_userId', q => q.eq('userId', args.userId))
      .take(25)

    for (const claim of batch) {
      const storageId = claim.storageId ?? claim.abortingStorageId
      if (!storageId) {
        await ctx.db.delete(claim._id)
        continue
      }
      try {
        await ctx.storage.delete(storageId)
        await ctx.db.delete(claim._id)
      }
      catch {
        await ctx.db.patch(claim._id, {
          userId: `deleted-account:${claim._id}`,
          consumedAt: undefined,
          expiresAt: Date.now() + 60 * 60 * 1000,
        })
      }
    }

    if (batch.length === 25) {
      await ctx.scheduler.runAfter(0, internal.audioOverviewUploads.cleanupUserClaims, args)
    }
    return { processed: batch.length }
  },
})
