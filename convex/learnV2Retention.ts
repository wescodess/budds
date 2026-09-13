import { v } from 'convex/values'
import { internalMutation, type MutationCtx } from './_generated/server'
import { internal } from './_generated/api'
import type { Doc, Id, TableNames } from './_generated/dataModel'

// This deliberately stays below the account-deletion batch. Folder deletion
// only has live lifecycle producers today; later producers must add their
// child-before-parent rows here in the ticket that introduces them.
const BATCH_SIZE = 8

async function removeRows<TableName extends TableNames>(ctx: MutationCtx, rows: Doc<TableName>[]) {
  for (const row of rows) await ctx.db.delete(row._id)
  return rows.length
}

async function deleteVoidFoundation(ctx: MutationCtx, userId: string, learningVoidId: Id<'learningVoids'>) {
  const manifests = await ctx.db.query('learnFolderSourceManifests')
    .withIndex('by_userId_and_learningVoidId', q => q.eq('userId', userId).eq('learningVoidId', learningVoidId)).take(BATCH_SIZE)
  for (const manifest of manifests) {
    const entries = await ctx.db.query('learnFolderSourceManifestEntries')
      .withIndex('by_userId_and_manifestId_and_order', q => q.eq('userId', userId).eq('manifestId', manifest._id)).take(BATCH_SIZE)
    if (await removeRows(ctx, entries)) return true
    const folders = await ctx.db.query('learnFolderSourceManifestFolders')
      .withIndex('by_userId_and_manifestId_and_order', q => q.eq('userId', userId).eq('manifestId', manifest._id)).take(BATCH_SIZE)
    if (await removeRows(ctx, folders)) return true
    await ctx.db.delete(manifest._id)
    return true
  }
  const snapshots = await ctx.db.query('learnSourceSnapshots')
    .withIndex('by_userId_and_learningVoidId_and_status', q => q.eq('userId', userId).eq('learningVoidId', learningVoidId)).take(BATCH_SIZE)
  if (await removeRows(ctx, snapshots)) return true
  const identities = await ctx.db.query('learnSourceIdentities')
    .withIndex('by_userId_and_learningVoidId', q => q.eq('userId', userId).eq('learningVoidId', learningVoidId)).take(BATCH_SIZE)
  if (await removeRows(ctx, identities)) return true
  const receipts = await ctx.db.query('learnLifecycleReceipts')
    .withIndex('by_userId_and_learningVoidId', q => q.eq('userId', userId).eq('learningVoidId', learningVoidId)).take(BATCH_SIZE)
  if (await removeRows(ctx, receipts)) return true
  const revisions = await ctx.db.query('learnBlueprintRevisions')
    .withIndex('by_userId_and_learningVoidId', q => q.eq('userId', userId).eq('learningVoidId', learningVoidId)).take(BATCH_SIZE)
  if (await removeRows(ctx, revisions)) return true
  const blueprints = await ctx.db.query('learnBlueprints')
    .withIndex('by_userId_and_learningVoidId', q => q.eq('userId', userId).eq('learningVoidId', learningVoidId)).take(BATCH_SIZE)
  if (await removeRows(ctx, blueprints)) return true
  await ctx.db.delete(learningVoidId)
  return true
}

export const deleteFolderFoundation = internalMutation({
  args: { userId: v.string(), folderId: v.id('folders') },
  handler: async (ctx, args) => {
    const voids = await ctx.db.query('learningVoids')
      .withIndex('by_userId_and_folderId', q => q.eq('userId', args.userId).eq('folderId', args.folderId)).take(BATCH_SIZE)
    for (const learningVoid of voids) {
      if (learningVoid.userId !== args.userId) throw new Error('Learning Void cleanup ownership mismatch')
      await deleteVoidFoundation(ctx, args.userId, learningVoid._id)
      await ctx.scheduler.runAfter(0, internal.learnV2Retention.deleteFolderFoundation, args)
      return { deleted: 1, hasMore: true }
    }
    return { deleted: 0, hasMore: false }
  },
})

async function purgeExcerpt(ctx: MutationCtx, excerpt: Doc<'learnSourceExcerpts'>) {
  const supportsWithoutStatus = await ctx.db.query('learnClaimSupports')
    .withIndex('by_userId_and_sourceExcerptId_and_evidenceStatus', q => q
      .eq('userId', excerpt.userId).eq('sourceExcerptId', excerpt._id).eq('evidenceStatus', undefined))
    .take(BATCH_SIZE)
  const availableSupports = supportsWithoutStatus.length === BATCH_SIZE
    ? []
    : await ctx.db.query('learnClaimSupports')
      .withIndex('by_userId_and_sourceExcerptId_and_evidenceStatus', q => q
        .eq('userId', excerpt.userId).eq('sourceExcerptId', excerpt._id).eq('evidenceStatus', 'evidence_available'))
      .take(BATCH_SIZE - supportsWithoutStatus.length)
  const supports = [...supportsWithoutStatus, ...availableSupports]
  for (const support of supports) await ctx.db.patch(support._id, { evidenceStatus: 'evidence_unavailable' })
  if (supports.length === BATCH_SIZE) return true
  await ctx.db.patch(excerpt._id, { excerpt: undefined, privateLocator: undefined, evidencePurgedAt: Date.now() })
  return false
}

// Source writers must invoke this internal continuation atomically with their
// source/access deletion command. It makes evidence unavailable without
// deleting mastery attempts or their historical outcome.
export const purgeSourceEvidence = internalMutation({
  args: { userId: v.string(), sourceIdentityId: v.id('learnSourceIdentities') },
  handler: async (ctx, args) => {
    const identity = await ctx.db.get(args.sourceIdentityId)
    if (!identity) return { pending: false }
    if (identity.userId !== args.userId) throw new Error('Source cleanup ownership mismatch')
    const entries = await ctx.db.query('learnFolderSourceManifestEntries')
      .withIndex('by_userId_and_sourceIdentityId_and_evidencePurgedAt', q => q
        .eq('userId', args.userId).eq('sourceIdentityId', args.sourceIdentityId).eq('evidencePurgedAt', undefined))
      .take(BATCH_SIZE)
    for (const entry of entries) {
      if (entry.availability === 'available') {
        const manifest = await ctx.db.get(entry.manifestId)
        if (manifest) {
          const availableCount = Math.max(0, manifest.availableCount - 1)
          const unavailableCount = manifest.unavailableCount + 1
          await ctx.db.patch(manifest._id, {
            availableCount,
            unavailableCount,
            coverage: availableCount === 0 ? 'gap' : 'partial',
            recordRevision: manifest.recordRevision + 1,
          })
        }
      }
      await ctx.db.patch(entry._id, {
        documentId: undefined,
        folderId: undefined,
        availability: 'unavailable',
        unavailableReason: 'source_deleted',
        evidencePurgedAt: Date.now(),
      })
    }
    if (entries.length > 0) {
      await ctx.scheduler.runAfter(0, internal.learnV2Retention.purgeSourceEvidence, args)
      return { pending: true }
    }
    const snapshots = await ctx.db.query('learnSourceSnapshots')
      .withIndex('by_userId_and_sourceIdentityId_and_evidencePurgedAt', q => q
        .eq('userId', args.userId).eq('sourceIdentityId', args.sourceIdentityId).eq('evidencePurgedAt', undefined))
      .take(BATCH_SIZE)
    for (const snapshot of snapshots) {
      const excerpts = await ctx.db.query('learnSourceExcerpts')
        .withIndex('by_userId_and_sourceSnapshotId_and_evidencePurgedAt', q => q
          .eq('userId', args.userId).eq('sourceSnapshotId', snapshot._id).eq('evidencePurgedAt', undefined))
        .take(BATCH_SIZE)
      for (const excerpt of excerpts) {
        if (await purgeExcerpt(ctx, excerpt)) {
          await ctx.scheduler.runAfter(0, internal.learnV2Retention.purgeSourceEvidence, args)
          return { pending: true }
        }
      }
      if (excerpts.length === BATCH_SIZE) {
        await ctx.scheduler.runAfter(0, internal.learnV2Retention.purgeSourceEvidence, args)
        return { pending: true }
      }
      await ctx.db.patch(snapshot._id, {
        status: 'unavailable',
        objectKey: undefined,
        folderId: undefined,
        filename: undefined,
        evidencePurgedAt: Date.now(),
      })
      await ctx.scheduler.runAfter(0, internal.learnV2Retention.purgeSourceEvidence, args)
      return { pending: true }
    }
    return { pending: false }
  },
})

export const purgeFolderDocumentSources = internalMutation({
  args: { userId: v.string(), documentId: v.id('documents') },
  handler: async (ctx, args) => {
    const identities = await ctx.db.query('learnSourceIdentities')
      .withIndex('by_userId_and_folderDocumentId', q => q
        .eq('userId', args.userId).eq('folderDocumentId', args.documentId))
      .take(BATCH_SIZE)
    for (const identity of identities) {
      await ctx.db.patch(identity._id, {
        externalKey: `deleted:${identity._id}`,
        folderDocumentId: undefined,
        title: undefined,
      })
      await ctx.scheduler.runAfter(0, internal.learnV2Retention.purgeSourceEvidence, {
        userId: args.userId,
        sourceIdentityId: identity._id,
      })
    }
    if (identities.length === BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.learnV2Retention.purgeFolderDocumentSources, args)
      return { pending: true }
    }
    return { pending: identities.length > 0 }
  },
})

export const purgeFolderManifestFolder = internalMutation({
  args: { userId: v.string(), folderId: v.id('folders') },
  handler: async (ctx, args) => {
    const folders = await ctx.db.query('learnFolderSourceManifestFolders')
      .withIndex('by_userId_and_folderId_and_evidencePurgedAt', q => q
        .eq('userId', args.userId).eq('folderId', args.folderId).eq('evidencePurgedAt', undefined))
      .take(BATCH_SIZE)
    for (const folder of folders) {
      await ctx.db.patch(folder._id, {
        folderId: undefined,
        parentFolderId: undefined,
        name: undefined,
        evidencePurgedAt: Date.now(),
      })
    }
    if (folders.length === BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.learnV2Retention.purgeFolderManifestFolder, args)
      return { pending: true }
    }
    return { pending: folders.length > 0 }
  },
})
