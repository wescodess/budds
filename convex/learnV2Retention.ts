import { v } from 'convex/values'
import { internalMutation, type MutationCtx } from './_generated/server'
import { internal } from './_generated/api'
import type { Doc, Id, TableNames } from './_generated/dataModel'
import {
  incrementRecordRevision,
  sanitizePublicSourceLocator,
  tombstonedSourceExternalKey,
} from './lib/learnV2SourceSanitization'
import { releaseSearchReservationClaims } from './learnV2Search'

// This deliberately stays below the account-deletion batch. Folder deletion
// only has live lifecycle producers today; later producers must add their
// child-before-parent rows here in the ticket that introduces them.
const BATCH_SIZE = 8

async function removeRows<TableName extends TableNames>(ctx: MutationCtx, rows: Doc<TableName>[]) {
  for (const row of rows) await ctx.db.delete(row._id)
  return rows.length
}

async function deleteVoidFoundation(ctx: MutationCtx, userId: string, learningVoidId: Id<'learningVoids'>) {
  const reservations = await ctx.db.query('searchReservations')
    .withIndex('by_userId_and_learningVoidId', q => q
      .eq('userId', userId)
      .eq('learningVoidId', learningVoidId))
    .take(BATCH_SIZE)
  for (const reservation of reservations) {
    const now = Date.now()
    if (reservation.status === 'reserved' && reservation.dispatchState === 'not_started') {
      await releaseSearchReservationClaims(ctx, reservation, now)
      await ctx.db.patch(reservation._id, {
        learningVoidId: undefined,
        status: 'released',
        outcomeCode: 'void_deleted_before_dispatch',
        settledAt: now,
        updatedAt: now,
        revision: reservation.revision + 1,
      })
    }
    else {
      await ctx.db.patch(reservation._id, {
        learningVoidId: undefined,
        updatedAt: now,
      })
    }
  }
  if (reservations.length > 0) return true

  const voidBuckets = await ctx.db.query('searchQuotaBuckets')
    .withIndex('by_userId_and_learningVoidId_and_periodKey', q => q
      .eq('userId', userId)
      .eq('learningVoidId', learningVoidId))
    .take(BATCH_SIZE)
  for (const bucket of voidBuckets) {
    await ctx.db.patch(bucket._id, {
      learningVoidId: undefined,
      revision: bucket.revision + 1,
      updatedAt: Date.now(),
    })
  }
  if (voidBuckets.length > 0) return true

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
  const sourceReceipts = await ctx.db.query('learnSourceCommandReceipts')
    .withIndex('by_userId_and_learningVoidId', q => q.eq('userId', userId).eq('learningVoidId', learningVoidId)).take(BATCH_SIZE)
  if (await removeRows(ctx, sourceReceipts)) return true
  const leases = await ctx.db.query('learnSourceFetchLeases')
    .withIndex('by_userId_and_learningVoidId', q => q.eq('userId', userId).eq('learningVoidId', learningVoidId)).take(BATCH_SIZE)
  if (await removeRows(ctx, leases)) return true
  // Rolling admission history is owner-scoped, not resource-owned. Preserve
  // unexpired events when a source, document, folder, or Void is deleted so
  // resource recreation cannot reset the owner's rate limit. Admission cleanup
  // removes expired rows; account deletion remains the only eager owner purge.
  const snapshots = await ctx.db.query('learnSourceSnapshots')
    .withIndex('by_userId_and_learningVoidId_and_status', q => q.eq('userId', userId).eq('learningVoidId', learningVoidId)).take(BATCH_SIZE)
  for (const snapshot of snapshots) {
    const objectiveSources = await ctx.db.query('learnObjectiveSources')
      .withIndex('by_userId_and_sourceSnapshotId', q => q.eq('userId', userId).eq('sourceSnapshotId', snapshot._id)).take(BATCH_SIZE)
    if (await removeRows(ctx, objectiveSources)) return true
    const excerpts = await ctx.db.query('learnSourceExcerpts')
      .withIndex('by_userId_and_sourceSnapshotId', q => q.eq('userId', userId).eq('sourceSnapshotId', snapshot._id)).take(BATCH_SIZE)
    for (const excerpt of excerpts) {
      const supports = await ctx.db.query('learnClaimSupports')
        .withIndex('by_userId_and_sourceExcerptId', q => q.eq('userId', userId).eq('sourceExcerptId', excerpt._id)).take(BATCH_SIZE)
      if (await removeRows(ctx, supports)) return true
      await ctx.db.delete(excerpt._id)
      return true
    }
    await ctx.db.delete(snapshot._id)
    return true
  }
  const identities = await ctx.db.query('learnSourceIdentities')
    .withIndex('by_userId_and_learningVoidId', q => q.eq('userId', userId).eq('learningVoidId', learningVoidId)).take(BATCH_SIZE)
  if (await removeRows(ctx, identities)) return true

  // Generation jobs are Void-owned operational children. Remove them before
  // Blueprint/Void parents so a deleted folder cannot leave a queued worker or
  // retain its revision and candidate digests indefinitely.
  const jobs = await ctx.db.query('learnJobs')
    .withIndex('by_userId_and_learningVoidId_and_type', q => q
      .eq('userId', userId).eq('learningVoidId', learningVoidId))
    .take(BATCH_SIZE)
  if (await removeRows(ctx, jobs)) return true

  const plans = await ctx.db.query('studyPlans')
    .withIndex('by_userId_and_learningVoidId', q => q.eq('userId', userId).eq('learningVoidId', learningVoidId)).take(BATCH_SIZE)
  for (const plan of plans) {
    const planRevisions = await ctx.db.query('studyPlanRevisions')
      .withIndex('by_userId_and_studyPlanId_and_revision', q => q.eq('userId', userId).eq('studyPlanId', plan._id)).take(BATCH_SIZE)
    for (const planRevision of planRevisions) {
      const sessions = await ctx.db.query('studySessions')
        .withIndex('by_userId_and_studyPlanRevisionId_and_scheduledStartAt', q => q.eq('userId', userId).eq('studyPlanRevisionId', planRevision._id)).take(BATCH_SIZE)
      for (const session of sessions) {
        const retrievalObjectives = await ctx.db.query('studySessionRetrievalObjectives')
          .withIndex('by_userId_and_studySessionId_and_order', q => q.eq('userId', userId).eq('studySessionId', session._id)).take(BATCH_SIZE)
        if (await removeRows(ctx, retrievalObjectives)) return true
        const projections = await ctx.db.query('calendarProjections')
          .withIndex('by_userId_and_studySessionId', q => q.eq('userId', userId).eq('studySessionId', session._id)).take(BATCH_SIZE)
        if (await removeRows(ctx, projections)) return true
        const contents = await ctx.db.query('sessionContent')
          .withIndex('by_userId_and_studySessionId_and_revision', q => q.eq('userId', userId).eq('studySessionId', session._id)).take(BATCH_SIZE)
        for (const content of contents) {
          const blocks = await ctx.db.query('sessionContentBlocks')
            .withIndex('by_userId_and_sessionContentId_and_order', q => q.eq('userId', userId).eq('sessionContentId', content._id)).take(BATCH_SIZE)
          if (await removeRows(ctx, blocks)) return true
          const claims = await ctx.db.query('sessionContentClaims')
            .withIndex('by_userId_and_sessionContentId_and_order', q => q.eq('userId', userId).eq('sessionContentId', content._id)).take(BATCH_SIZE)
          for (const claim of claims) {
            const supports = await ctx.db.query('learnClaimSupports')
              .withIndex('by_userId_and_sessionContentClaimId', q => q.eq('userId', userId).eq('sessionContentClaimId', claim._id)).take(BATCH_SIZE)
            if (await removeRows(ctx, supports)) return true
            await ctx.db.delete(claim._id)
            return true
          }
          await ctx.db.delete(content._id)
          return true
        }
        await ctx.db.delete(session._id)
        return true
      }
      await ctx.db.delete(planRevision._id)
      return true
    }
    await ctx.db.delete(plan._id)
    return true
  }

  const blueprintRevisions = await ctx.db.query('learnBlueprintRevisions')
    .withIndex('by_userId_and_learningVoidId', q => q.eq('userId', userId).eq('learningVoidId', learningVoidId)).take(BATCH_SIZE)
  for (const revision of blueprintRevisions) {
    const prerequisites = await ctx.db.query('learnObjectivePrerequisites')
      .withIndex('by_userId_and_blueprintRevisionId_and_objectiveId', q => q.eq('userId', userId).eq('blueprintRevisionId', revision._id)).take(BATCH_SIZE)
    if (await removeRows(ctx, prerequisites)) return true
    const milestones = await ctx.db.query('learnMilestones')
      .withIndex('by_userId_and_blueprintRevisionId_and_order', q => q.eq('userId', userId).eq('blueprintRevisionId', revision._id)).take(BATCH_SIZE)
    if (await removeRows(ctx, milestones)) return true
    const objectives = await ctx.db.query('learnObjectives')
      .withIndex('by_userId_and_blueprintRevisionId_and_order', q => q.eq('userId', userId).eq('blueprintRevisionId', revision._id)).take(BATCH_SIZE)
    for (const objective of objectives) {
      const objectiveSources = await ctx.db.query('learnObjectiveSources')
        .withIndex('by_userId_and_objectiveId_and_sourceSnapshotId', q => q.eq('userId', userId).eq('objectiveId', objective._id)).take(BATCH_SIZE)
      if (await removeRows(ctx, objectiveSources)) return true
      const attempts = await ctx.db.query('masteryAttempts')
        .withIndex('by_userId_and_objectiveId_and_attemptedAt', q => q.eq('userId', userId).eq('objectiveId', objective._id)).take(BATCH_SIZE)
      if (await removeRows(ctx, attempts)) return true
      const records = await ctx.db.query('masteryRecords')
        .withIndex('by_userId_and_objectiveId', q => q.eq('userId', userId).eq('objectiveId', objective._id)).take(BATCH_SIZE)
      if (await removeRows(ctx, records)) return true
      await ctx.db.delete(objective._id)
      return true
    }
    await ctx.db.delete(revision._id)
    return true
  }
  const receipts = await ctx.db.query('learnLifecycleReceipts')
    .withIndex('by_userId_and_learningVoidId', q => q.eq('userId', userId).eq('learningVoidId', learningVoidId)).take(BATCH_SIZE)
  if (await removeRows(ctx, receipts)) return true
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
  const locator = sanitizePublicSourceLocator(excerpt.locator) ?? 'source-unavailable'
  await ctx.db.patch(excerpt._id, { locator, excerpt: undefined, privateLocator: undefined, evidencePurgedAt: Date.now() })
  return false
}

// Source writers must invoke this internal continuation atomically with their
// source/access deletion command. It makes evidence unavailable without
// deleting mastery attempts or their historical outcome.
export const purgeSourceEvidence = internalMutation({
  args: {
    userId: v.string(),
    sourceIdentityId: v.id('learnSourceIdentities'),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.db.get(args.sourceIdentityId)
    // Snapshot ownership is the cleanup authority. A denormalized identity can
    // already be absent (or even point at a foreign row after damaged legacy
    // state); neither condition may strand this owner's protected descendants.
    if (identity?.userId === args.userId) {
      await ctx.db.patch(identity._id, {
        ...(identity.origin === 'user_url'
          ? { externalKey: await tombstonedSourceExternalKey(String(identity._id)) }
          : {}),
        canonicalUrl: undefined,
        publicLocator: undefined,
        privateLocator: undefined,
        tombstonedAt: Date.now(),
      })
    }
    const reason = args.reason === 'access_lost' || args.reason === 'policy_denied'
      ? args.reason
      : 'source_deleted'
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
            recordRevision: incrementRecordRevision(manifest.recordRevision),
          })
        }
      }
      await ctx.db.patch(entry._id, {
        documentId: undefined,
        folderId: undefined,
        availability: 'unavailable',
        unavailableReason: reason,
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
      const leases = await ctx.db.query('learnSourceFetchLeases')
        .withIndex('by_userId_and_sourceSnapshotId_and_expiresAt', q => q
          .eq('userId', args.userId).eq('sourceSnapshotId', snapshot._id))
        .take(BATCH_SIZE)
      if (await removeRows(ctx, leases)) {
        await ctx.scheduler.runAfter(0, internal.learnV2Retention.purgeSourceEvidence, args)
        return { pending: true }
      }
      // Owner rate history deliberately survives source tombstoning. Otherwise
      // deleting and re-registering the same URL would reset admission limits.
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
      const alreadyAuthoritativelyUnavailable = snapshot.effectiveStatus === 'unavailable'
        && snapshot.unavailableReason !== undefined
      const publicLocator = sanitizePublicSourceLocator(snapshot.publicLocator)
      await ctx.db.patch(snapshot._id, {
        status: ['user_accepted', 'rejected'].includes(snapshot.status) ? snapshot.status : 'unavailable',
        effectiveStatus: 'unavailable',
        unavailableReason: snapshot.unavailableReason ?? reason,
        publicLocator,
        // markUnavailable already advanced and sealed the authoritative
        // revision. Its scheduled byte purge must not make that receipt stale.
        ...(alreadyAuthoritativelyUnavailable
          ? {}
          : { recordRevision: incrementRecordRevision(snapshot.recordRevision), updatedAt: Date.now() }),
        objectKey: undefined,
        folderId: undefined,
        filename: undefined,
        privateLocator: undefined,
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
        canonicalUrl: undefined,
        publicLocator: undefined,
        privateLocator: undefined,
        folderDocumentId: undefined,
        title: undefined,
        tombstonedAt: Date.now(),
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

export const purgeFolderDocumentManifestHeaders = internalMutation({
  args: {
    userId: v.string(),
    documentId: v.id('documents'),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const page = await ctx.db.query('learnFolderSourceManifests')
      .withIndex('by_userId', q => q.eq('userId', args.userId))
      .paginate({ cursor: args.cursor ?? null, numItems: BATCH_SIZE })
    for (const manifest of page.page) {
      const explicitDocumentIds = manifest.explicitDocumentIds.filter(id => id !== args.documentId)
      if (explicitDocumentIds.length !== manifest.explicitDocumentIds.length) {
        await ctx.db.patch(manifest._id, manifest.status === 'capturing'
          ? {
              status: 'failed',
              coverage: manifest.coverage === 'empty' ? 'gap' : manifest.coverage,
              failureReason: 'Selected document was deleted during source capture',
              explicitDocumentIds: [],
              explicitDocumentCursor: 0,
              recordRevision: incrementRecordRevision(manifest.recordRevision),
            }
          : { explicitDocumentIds })
      }
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.learnV2Retention.purgeFolderDocumentManifestHeaders, {
        ...args,
        cursor: page.continueCursor,
      })
      return { pending: true }
    }
    return { pending: false }
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
