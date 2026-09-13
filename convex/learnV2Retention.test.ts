/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { internal } from './_generated/api'

const modules = import.meta.glob('./**/*.ts')
const userId = 'https://auth.example.com|retention-owner'

describe('Learn V2 source retention seam', () => {
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
      const attemptId = await ctx.db.insert('masteryAttempts', { userId, objectiveId: (await ctx.db.get((await ctx.db.get(contentId))!.studySessionId))!.primaryObjectiveId, attemptedAt: 1, idempotencyKey: 'attempt', result: 'passed' })
      return { identityId, snapshotId, excerptId, supportIds, otherOwnerSupportId, attemptId }
    })
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
    }))
    expect(rows.snapshot).toMatchObject({ status: 'unavailable' })
    expect(rows.excerpt).toMatchObject({ locator: 'stable-section' })
    expect(rows.excerpt?.excerpt).toBeUndefined()
    expect(rows.excerpt?.privateLocator).toBeUndefined()
    expect(rows.supports).toHaveLength(9)
    expect(rows.supports.every(support => support?.evidenceStatus === 'evidence_unavailable')).toBe(true)
    expect(rows.otherOwnerSupport).toMatchObject({ evidenceStatus: 'evidence_available' })
    expect(rows.attempt).toMatchObject({ result: 'passed' })
  })
})
