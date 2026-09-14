/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'

const modules = import.meta.glob('./**/*.ts')
const userId = 'https://auth.example.com|retention-owner'

describe('Learn V2 source retention seam', () => {
  test('detaches search history and releases only an undispatched reservation before Void deletion', async () => {
    const t = convexTest(schema, modules)
    const ids = await t.run(async (ctx) => {
      const now = Date.now()
      const folderId = await ctx.db.insert('folders', { userId, name: 'Search retention', documentCount: 0 })
      const learningVoidId = await ctx.db.insert('learningVoids', { userId, folderId, title: 'Void', status: 'draft', revision: 1, createdAt: now, updatedAt: now })
      const blueprintId = await ctx.db.insert('learnBlueprints', { userId, learningVoidId, revision: 1, createdAt: now })
      const blueprintRevisionId = await ctx.db.insert('learnBlueprintRevisions', { userId, blueprintId, learningVoidId, revision: 1, recordRevision: 1, status: 'draft', createdAt: now, updatedAt: now })
      const hash = async (value: string) => {
        const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
        return `sha256:${[...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')}`
      }
      const ownerScopeKey = await hash(`owner:${userId}`)
      const voidScopeKey = await hash(`void:${String(learningVoidId)}`)
      const definitions = [
        { owner: '__learn_v2_search_product__', scopeKind: 'product_month' as const, scopeKey: 'global', periodKey: '2026-09', limit: 800 },
        { owner: '__learn_v2_search_product__', scopeKind: 'product_day' as const, scopeKey: 'global', periodKey: '2026-09-13', limit: 25 },
        { owner: userId, scopeKind: 'user_day' as const, scopeKey: ownerScopeKey, periodKey: '2026-09-13', limit: 4 },
        { owner: userId, scopeKind: 'learning_void_broad' as const, scopeKey: voidScopeKey, periodKey: 'lifetime', limit: 2, learningVoidId },
      ]
      const bucketIds: Id<'searchQuotaBuckets'>[] = []
      for (const definition of definitions) {
        bucketIds.push(await ctx.db.insert('searchQuotaBuckets', {
          userId: definition.owner,
          learningVoidId: definition.learningVoidId,
          provider: 'tavily_free',
          scopeKind: definition.scopeKind,
          scopeKey: definition.scopeKey,
          periodKey: definition.periodKey,
          limit: definition.limit,
          reservedCredits: 2,
          consumedCredits: 0,
          revision: 1,
          reconciliationStatus: 'matched',
          createdAt: now,
          updatedAt: now,
        }))
      }
      const reservation = async (suffix: string, dispatchState: 'not_started' | 'started') => ({
        userId,
        learningVoidId,
        blueprintRevisionId,
        expectedVoidRevision: 1,
        expectedBlueprintRecordRevision: 1,
        voidScopeKey,
        provider: 'tavily_free' as const,
        searchClass: 'broad' as const,
        status: 'reserved' as const,
        dispatchState,
        reconciliationRequired: dispatchState === 'started',
        productMonthBucketId: bucketIds[0]!,
        productDayBucketId: bucketIds[1]!,
        userDayBucketId: bucketIds[2]!,
        learningVoidBucketId: bucketIds[3]!,
        productMonthPeriodKey: '2026-09',
        productDayPeriodKey: '2026-09-13',
        userDayPeriodKey: '2026-09-13',
        learningVoidPeriodKey: 'lifetime' as const,
        expectedCredits: 1 as const,
        idempotencyKeyHash: `sha256:${suffix.repeat(64)}`,
        requestFingerprint: `sha256:${'c'.repeat(64)}`,
        queryDigest: `sha256:${'d'.repeat(64)}`,
        executionTokenHash: await hash('retention-execution-token'),
        providerUsageBeforeDispatch: dispatchState === 'started' ? 0 : undefined,
        revision: 1,
        createdAt: now,
        updatedAt: now,
        expiresAt: now + 60_000,
      })
      const undispatchedId = await ctx.db.insert('searchReservations', await reservation('1', 'not_started'))
      const dispatchedId = await ctx.db.insert('searchReservations', await reservation('2', 'started'))
      return { folderId, learningVoidId, bucketIds, undispatchedId, dispatchedId }
    })

    await t.mutation(internal.learnV2Retention.deleteFolderFoundation, { userId, folderId: ids.folderId })
    await t.mutation(internal.learnV2Retention.deleteFolderFoundation, { userId, folderId: ids.folderId })
    const retained = await t.run(async ctx => ({
      undispatched: await ctx.db.get(ids.undispatchedId),
      dispatched: await ctx.db.get(ids.dispatchedId),
      buckets: await Promise.all(ids.bucketIds.map(id => ctx.db.get(id))),
    }))
    expect(retained.undispatched).toMatchObject({ status: 'released', outcomeCode: 'void_deleted_before_dispatch' })
    expect(retained.undispatched?.learningVoidId).toBeUndefined()
    expect(retained.dispatched).toMatchObject({ status: 'reserved', dispatchState: 'started', reconciliationRequired: true, revision: 1 })
    expect(retained.dispatched?.learningVoidId).toBeUndefined()
    expect(retained.buckets.every(bucket => bucket?.reservedCredits === 1)).toBe(true)
    expect(retained.buckets[3]?.learningVoidId).toBeUndefined()
    await expect(t.mutation(internal.learnV2Search.consume, {
      tokenIdentifier: userId,
      reservationId: ids.dispatchedId,
      executionToken: 'retention-execution-token',
      expectedRevision: 1,
      providerRequestId: 'retention-settlement',
    })).resolves.toMatchObject({ status: 'consumed' })
  })

  test('purges every support status in bounded batches while preserving attempts', async () => {
    const t = convexTest(schema, modules)
    const ids = await t.run(async (ctx) => {
      const folderId = await ctx.db.insert('folders', { userId, name: 'Sources', documentCount: 0 })
      const learningVoidId = await ctx.db.insert('learningVoids', { userId, folderId, title: 'Void', status: 'draft', revision: 1, createdAt: 1, updatedAt: 1 })
      const identityId = await ctx.db.insert('learnSourceIdentities', { userId, learningVoidId, origin: 'folder_document', externalKey: 'document:1' })
      const snapshotId = await ctx.db.insert('learnSourceSnapshots', { userId, learningVoidId, sourceIdentityId: identityId, revision: 1, status: 'user_accepted', createdAt: 1 })
      const contentId = await ctx.db.insert('sessionContent', { userId, studySessionId: await ctx.db.insert('studySessions', { userId, studyPlanRevisionId: await ctx.db.insert('studyPlanRevisions', { userId, studyPlanId: await ctx.db.insert('studyPlans', { userId, learningVoidId, revision: 1, createdAt: 1 }), learningVoidId, revision: 1, status: 'draft', createdAt: 1 }), primaryObjectiveId: await ctx.db.insert('learnObjectives', { userId, blueprintRevisionId: await ctx.db.insert('learnBlueprintRevisions', { userId, blueprintId: await ctx.db.insert('learnBlueprints', { userId, learningVoidId, revision: 1, createdAt: 1 }), learningVoidId, revision: 1, recordRevision: 1, status: 'draft', createdAt: 1, updatedAt: 1 }), order: 1, title: 'Objective' }), status: 'planned', revision: 1, scheduledStartAt: 1 }), revision: 1, status: 'draft', createdAt: 1 })
      const claimId = await ctx.db.insert('sessionContentClaims', { userId, sessionContentId: contentId, order: 1, claim: 'Supported claim' })
      const excerptId = await ctx.db.insert('learnSourceExcerpts', { userId, sourceSnapshotId: snapshotId, locator: 'stable-section', privateLocator: 'https://private.example/secret', excerpt: 'protected text', rightsStatus: 'permitted' })
      const supportIds = []
      for (let index = 0; index < 9; index++) {
        supportIds.push(await ctx.db.insert('learnClaimSupports', {
          userId,
          sessionContentClaimId: claimId,
          sourceExcerptId: excerptId,
          entailment: 'entailed',
          conflictStatus: 'clear',
          ...(index % 2 === 0 ? {} : { evidenceStatus: 'evidence_available' as const }),
        }))
      }
      const otherOwnerSupportId = await ctx.db.insert('learnClaimSupports', {
        userId: 'https://auth.example.com|other-retention-owner',
        sessionContentClaimId: claimId,
        sourceExcerptId: excerptId,
        entailment: 'entailed',
        conflictStatus: 'clear',
        evidenceStatus: 'evidence_available',
      })
      const leaseId = await ctx.db.insert('learnSourceFetchLeases', {
        userId,
        learningVoidId,
        sourceSnapshotId: snapshotId,
        idempotencyKeyHash: `sha256:${'a'.repeat(64)}`,
        requestFingerprint: `sha256:${'b'.repeat(64)}`,
        leaseToken: 'active-source-lease',
        expiresAt: Date.now() + 60_000,
        createdAt: Date.now(),
      })
      const rateId = await ctx.db.insert('learnSourceFetchRateEvents', {
        userId,
        learningVoidId,
        sourceSnapshotId: snapshotId,
        createdAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      })
      const attemptId = await ctx.db.insert('masteryAttempts', { userId, objectiveId: (await ctx.db.get((await ctx.db.get(contentId))!.studySessionId))!.primaryObjectiveId, attemptedAt: 1, idempotencyKey: 'attempt', result: 'passed' })
      return { identityId, snapshotId, excerptId, supportIds, otherOwnerSupportId, attemptId, leaseId, rateId }
    })
    await t.mutation(internal.learnV2Retention.purgeSourceEvidence, { userId, sourceIdentityId: ids.identityId })
    await t.mutation(internal.learnV2Retention.purgeSourceEvidence, { userId, sourceIdentityId: ids.identityId })
    const afterFirstBatch = await t.run(async ctx => ({
      excerpt: await ctx.db.get(ids.excerptId),
      supports: await Promise.all(ids.supportIds.map(id => ctx.db.get(id))),
    }))
    expect(afterFirstBatch.excerpt?.excerpt).toBe('protected text')
    expect(afterFirstBatch.excerpt?.privateLocator).toBe('https://private.example/secret')
    expect(afterFirstBatch.supports.filter(support => support?.evidenceStatus === 'evidence_unavailable')).toHaveLength(8)
    for (let batch = 0; batch < 7; batch++) await t.mutation(internal.learnV2Retention.purgeSourceEvidence, { userId, sourceIdentityId: ids.identityId })
    const rows = await t.run(async ctx => ({
      snapshot: await ctx.db.get(ids.snapshotId),
      excerpt: await ctx.db.get(ids.excerptId),
      supports: await Promise.all(ids.supportIds.map(id => ctx.db.get(id))),
      otherOwnerSupport: await ctx.db.get(ids.otherOwnerSupportId),
      attempt: await ctx.db.get(ids.attemptId),
      lease: await ctx.db.get(ids.leaseId),
      rate: await ctx.db.get(ids.rateId),
    }))
    expect(rows.snapshot).toMatchObject({ status: 'user_accepted', effectiveStatus: 'unavailable' })
    expect(rows.excerpt).toMatchObject({ locator: 'stable-section' })
    expect(rows.excerpt?.excerpt).toBeUndefined()
    expect(rows.excerpt?.privateLocator).toBeUndefined()
    expect(rows.supports).toHaveLength(9)
    expect(rows.supports.every(support => support?.evidenceStatus === 'evidence_unavailable')).toBe(true)
    expect(rows.otherOwnerSupport).toMatchObject({ evidenceStatus: 'evidence_available' })
    expect(rows.attempt).toMatchObject({ result: 'passed' })
    expect(rows.lease).toBeNull()
    expect(rows.rate).not.toBeNull()
  })

  test.each(['missing', 'foreign', 'tombstoned'] as const)('purges owned descendants when the identity is %s', async (identityState) => {
    const t = convexTest(schema, modules)
    const ids = await t.run(async (ctx) => {
      const folderId = await ctx.db.insert('folders', { userId, name: 'Orphaned sources', documentCount: 0 })
      const learningVoidId = await ctx.db.insert('learningVoids', { userId, folderId, title: 'Void', status: 'draft', revision: 1, createdAt: 1, updatedAt: 1 })
      const identityId = await ctx.db.insert('learnSourceIdentities', {
        userId: identityState === 'foreign' ? 'https://auth.example.com|foreign-owner' : userId,
        learningVoidId,
        origin: 'user_url',
        externalKey: identityState === 'tombstoned'
          ? 'https://example.com/private/orphan?identity-token=secret'
          : `sha256:${'e'.repeat(64)}`,
        canonicalUrl: 'https://example.com/private/orphan?token=secret',
        publicLocator: 'https://example.com/private/orphan?token=secret',
        privateLocator: 'https://example.com/private/orphan?token=secret',
        ...(identityState === 'tombstoned' ? { tombstonedAt: 1 } : {}),
      })
      const snapshotId = await ctx.db.insert('learnSourceSnapshots', {
        userId,
        learningVoidId,
        sourceIdentityId: identityId,
        revision: 1,
        recordRevision: 1,
        status: 'user_accepted',
        effectiveStatus: 'user_accepted',
        privateLocator: 'https://example.com/private/orphan?token=secret',
        createdAt: 1,
      })
      const excerptId = await ctx.db.insert('learnSourceExcerpts', {
        userId,
        sourceSnapshotId: snapshotId,
        locator: 'https://example.com/private/orphan?token=secret',
        privateLocator: 'https://example.com/private/orphan?token=secret',
        excerpt: 'protected orphan text',
        rightsStatus: 'permitted',
      })
      const blueprintId = await ctx.db.insert('learnBlueprints', { userId, learningVoidId, revision: 1, createdAt: 1 })
      const blueprintRevisionId = await ctx.db.insert('learnBlueprintRevisions', { userId, blueprintId, learningVoidId, revision: 1, recordRevision: 1, status: 'draft', createdAt: 1, updatedAt: 1 })
      const objectiveId = await ctx.db.insert('learnObjectives', { userId, blueprintRevisionId, order: 1, title: 'Objective' })
      const planId = await ctx.db.insert('studyPlans', { userId, learningVoidId, revision: 1, createdAt: 1 })
      const planRevisionId = await ctx.db.insert('studyPlanRevisions', { userId, studyPlanId: planId, learningVoidId, revision: 1, status: 'draft', createdAt: 1 })
      const sessionId = await ctx.db.insert('studySessions', { userId, studyPlanRevisionId: planRevisionId, primaryObjectiveId: objectiveId, status: 'planned', revision: 1, scheduledStartAt: 1 })
      const contentId = await ctx.db.insert('sessionContent', { userId, studySessionId: sessionId, revision: 1, status: 'draft', createdAt: 1 })
      const claimId = await ctx.db.insert('sessionContentClaims', { userId, sessionContentId: contentId, order: 1, claim: 'Claim' })
      const supportId = await ctx.db.insert('learnClaimSupports', { userId, sessionContentClaimId: claimId, sourceExcerptId: excerptId, entailment: 'entailed', conflictStatus: 'clear', evidenceStatus: 'evidence_available' })
      if (identityState === 'missing') await ctx.db.delete(identityId)
      return { identityId, snapshotId, excerptId, supportId }
    })
    await t.mutation(internal.learnV2Retention.purgeSourceEvidence, {
      userId,
      sourceIdentityId: ids.identityId,
      reason: 'access_lost',
    })
    const rows = await t.run(async ctx => ({
      snapshot: await ctx.db.get(ids.snapshotId),
      excerpt: await ctx.db.get(ids.excerptId),
      support: await ctx.db.get(ids.supportId),
      identity: await ctx.db.get(ids.identityId),
    }))
    expect(rows.snapshot).toMatchObject({ effectiveStatus: 'unavailable', unavailableReason: 'access_lost' })
    expect(rows.snapshot!.privateLocator).toBeUndefined()
    expect(rows.excerpt!.excerpt).toBeUndefined()
    expect(rows.excerpt!.privateLocator).toBeUndefined()
    expect(rows.support).toMatchObject({ evidenceStatus: 'evidence_unavailable' })
    if (identityState === 'tombstoned') {
      expect(rows.identity!.externalKey).toMatch(/^sha256:[a-f0-9]{64}$/)
      expect(rows.identity!.externalKey).not.toContain('secret')
      expect(rows.identity!.canonicalUrl).toBeUndefined()
      expect(rows.identity!.publicLocator).toBeUndefined()
      expect(rows.identity!.privateLocator).toBeUndefined()
    }
  })

  test.each([
    ['https://example.com/private/path?token=secret', 'https://example.com/'],
    ['folder:deleted-root.pdf', 'folder:deleted-root.pdf'],
    ['https://example.com/%zz?token=secret', 'source-unavailable'],
    ['stable-section', 'stable-section'],
  ])('sanitizes purged locator %s', async (locator, expected) => {
    const t = convexTest(schema, modules)
    const ids = await t.run(async (ctx) => {
      const folderId = await ctx.db.insert('folders', { userId, name: 'Locator source', documentCount: 0 })
      const learningVoidId = await ctx.db.insert('learningVoids', { userId, folderId, title: 'Void', status: 'draft', revision: 1, createdAt: 1, updatedAt: 1 })
      const identityId = await ctx.db.insert('learnSourceIdentities', { userId, learningVoidId, origin: 'user_url', externalKey: `source:${expected}` })
      const snapshotId = await ctx.db.insert('learnSourceSnapshots', { userId, learningVoidId, sourceIdentityId: identityId, revision: 1, status: 'user_accepted', createdAt: 1 })
      const excerptId = await ctx.db.insert('learnSourceExcerpts', { userId, sourceSnapshotId: snapshotId, locator, excerpt: 'protected', rightsStatus: 'permitted' })
      return { identityId, excerptId }
    })
    await t.mutation(internal.learnV2Retention.purgeSourceEvidence, { userId, sourceIdentityId: ids.identityId })
    const excerpt = await t.run(ctx => ctx.db.get(ids.excerptId))
    expect(excerpt?.locator).toBe(expected)
  })
})
