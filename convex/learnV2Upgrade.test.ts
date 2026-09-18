/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const OWNER = { tokenIdentifier: 'https://auth.example.com|upgrade-owner', name: 'Upgrade owner' }
const OTHER = { tokenIdentifier: 'https://auth.example.com|upgrade-other', name: 'Upgrade other' }

async function setup() {
  const t = convexTest(schema, modules)
  const owner = t.withIdentity(OWNER)
  await owner.mutation(api.users.upsertUser, {})
  const courseFolderId = await owner.mutation(api.folders.createFolder, { name: 'Legacy course folder' })
  const currentDocumentFolderId = await owner.mutation(api.folders.createFolder, { name: 'Current document folder' })
  const staleSourceFolderId = await owner.mutation(api.folders.createFolder, { name: 'Stale V1 source folder' })
  const documentId = await t.run(ctx => ctx.db.insert('documents', {
    userId: OWNER.tokenIdentifier, folderId: currentDocumentFolderId, filename: 'selected.pdf',
    status: 'success', fileSize: 12,
  }))
  const courseId = await t.run(async ctx => {
    const id = await ctx.db.insert('courses', {
      userId: OWNER.tokenIdentifier, folderId: courseFolderId, title: '  Legacy title  ', status: 'ready',
      sourceType: 'folder', sourceConfidence: { docCount: 1, webPercent: 0 }, pace: 'steady',
      outlineSections: [{ title: 'Already learned', description: 'must stay V1', knowledgeType: 'factual', order: 1 }],
      completedSectionCount: 1, totalSectionCount: 1, webSearchEnabled: true, createdAt: 1, updatedAt: 2,
    })
    await ctx.db.insert('courseSourceDocs', { courseId: id, documentId, folderId: staleSourceFolderId, userId: OWNER.tokenIdentifier })
    const sectionId = await ctx.db.insert('courseSections', {
      courseId: id, userId: OWNER.tokenIdentifier, order: 1, title: 'Already learned', knowledgeType: 'factual',
      status: 'completed', contentBlocks: [], masteryLevel: 'mastered', completedAt: 2,
    })
    await ctx.db.insert('reviewItems', {
      userId: OWNER.tokenIdentifier, courseId: id, sectionId, prompt: 'V1 prompt', answer: 'V1 answer',
      easeFactor: 2.5, interval: 3, repetitions: 2, nextReviewDate: '2026-09-18', flagged: false, createdAt: 2,
    })
    const calendarConnectionId = await ctx.db.insert('calendarConnections', {
      userId: OWNER.tokenIdentifier, provider: 'google', accessToken: 'test-access', refreshToken: 'test-refresh',
      expiresAt: 3, timezone: 'America/Toronto', status: 'connected', connectedAt: 2,
    })
    await ctx.db.insert('calendarEvents', {
      userId: OWNER.tokenIdentifier, calendarConnectionId, calendarEventId: 'v1-calendar-event', courseId: id,
      scheduledAt: 4, sessionType: 'review', status: 'scheduled', description: 'V1 calendar row',
    })
    return id
  })
  return { t, owner, courseId, courseFolderId, currentDocumentFolderId, documentId }
}

async function enable(t: ReturnType<typeof convexTest>) {
  process.env.LEARN_V2_ENABLED = 'true'
  await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: OWNER.tokenIdentifier, enabled: true })
}

describe('legacy course V1 to V2 upgrade', () => {
  test('is rollout-gated before it reads or changes legacy state', async () => {
    const previous = process.env.LEARN_V2_ENABLED
    try {
      delete process.env.LEARN_V2_ENABLED
      const { owner, courseId } = await setup()
      await expect(owner.mutation(api.learnV2Upgrade.upgradeLegacyCourse, { legacyCourseId: courseId, idempotencyKey: 'upgrade-1' }))
        .rejects.toThrow(/Learn V2 access denied/)
    } finally {
      if (previous === undefined) delete process.env.LEARN_V2_ENABLED
      else process.env.LEARN_V2_ENABLED = previous
    }
  })

  test('creates one replay-safe draft with provenance and current owned source identities without inferring learning state', async () => {
    const previous = process.env.LEARN_V2_ENABLED
    try {
      const { t, owner, courseId, currentDocumentFolderId, documentId } = await setup()
      await enable(t)
      const legacyBefore = await t.run(async ctx => ({
        course: await ctx.db.get(courseId),
        sources: await ctx.db.query('courseSourceDocs').withIndex('by_courseId', q => q.eq('courseId', courseId)).collect(),
        sections: await ctx.db.query('courseSections').withIndex('by_courseId', q => q.eq('courseId', courseId)).collect(),
        reviews: await ctx.db.query('reviewItems').withIndex('by_courseId', q => q.eq('courseId', courseId)).collect(),
        calendar: await ctx.db.query('calendarEvents').withIndex('by_courseId', q => q.eq('courseId', courseId)).collect(),
      }))

      const args = { legacyCourseId: courseId, idempotencyKey: 'upgrade-1' }
      const first = await owner.mutation(api.learnV2Upgrade.upgradeLegacyCourse, args)
      const replay = await owner.mutation(api.learnV2Upgrade.upgradeLegacyCourse, args)
      expect(replay).toEqual(first)
      expect(first).toMatchObject({ status: 'draft', revision: 1 })

      const upgraded = await t.run(async ctx => ({
        learningVoid: await ctx.db.get(first!._id),
        selectedDocument: await ctx.db.get(documentId),
        identities: await ctx.db.query('learnSourceIdentities').withIndex('by_userId_and_learningVoidId', q => q.eq('userId', OWNER.tokenIdentifier).eq('learningVoidId', first!._id)).collect(),
        snapshots: await ctx.db.query('learnSourceSnapshots').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).collect(),
        blueprints: await ctx.db.query('learnBlueprints').withIndex('by_userId_and_learningVoidId', q => q.eq('userId', OWNER.tokenIdentifier).eq('learningVoidId', first!._id)).collect(),
        attempts: await ctx.db.query('masteryAttempts').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).collect(),
        records: await ctx.db.query('masteryRecords').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).collect(),
        plans: await ctx.db.query('studyPlans').withIndex('by_userId_and_learningVoidId', q => q.eq('userId', OWNER.tokenIdentifier).eq('learningVoidId', first!._id)).collect(),
        jobs: await ctx.db.query('learnJobs').withIndex('by_userId_and_learningVoidId_and_type', q => q.eq('userId', OWNER.tokenIdentifier).eq('learningVoidId', first!._id).eq('type', 'blueprint')).collect(),
        calendarProjections: await ctx.db.query('calendarProjections').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).collect(),
      }))
      expect(upgraded.learningVoid).toMatchObject({ title: 'Legacy title', status: 'draft', revision: 1, legacyCourseId: courseId, legacySourcePolicy: 'folder_plus_web' })
      expect(upgraded.identities).toMatchObject([{ origin: 'folder_document', folderDocumentId: documentId, externalKey: `document:${documentId}`, title: 'selected.pdf' }])
      expect(upgraded.identities).toHaveLength(1)
      expect(upgraded.selectedDocument?.folderId).toBe(currentDocumentFolderId)
      expect(upgraded.snapshots).toEqual([])
      expect(upgraded.blueprints).toEqual([])
      expect(upgraded.attempts).toEqual([])
      expect(upgraded.records).toEqual([])
      expect(upgraded.plans).toEqual([])
      expect(upgraded.jobs).toEqual([])
      expect(upgraded.calendarProjections).toEqual([])
      expect(await t.run(async ctx => ({
        course: await ctx.db.get(courseId),
        sources: await ctx.db.query('courseSourceDocs').withIndex('by_courseId', q => q.eq('courseId', courseId)).collect(),
        sections: await ctx.db.query('courseSections').withIndex('by_courseId', q => q.eq('courseId', courseId)).collect(),
        reviews: await ctx.db.query('reviewItems').withIndex('by_courseId', q => q.eq('courseId', courseId)).collect(),
        calendar: await ctx.db.query('calendarEvents').withIndex('by_courseId', q => q.eq('courseId', courseId)).collect(),
      }))).toEqual(legacyBefore)
      await expect(owner.mutation(api.learnV2Upgrade.upgradeLegacyCourse, { legacyCourseId: courseId, idempotencyKey: 'other-key' })).rejects.toThrow(/already been upgraded/)
      await expect(owner.mutation(api.learnV2Upgrade.upgradeLegacyCourse, { legacyCourseId: courseId, idempotencyKey: 'x'.repeat(129) })).rejects.toThrow(/Idempotency key/)
    } finally {
      if (previous === undefined) delete process.env.LEARN_V2_ENABLED
      else process.env.LEARN_V2_ENABLED = previous
    }
  })

  test('rejects cross-owner and invalid selected sources atomically', async () => {
    const previous = process.env.LEARN_V2_ENABLED
    try {
      const { t, owner, courseId } = await setup()
      await enable(t)
      await t.withIdentity(OTHER).mutation(api.users.upsertUser, {})
      await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: OTHER.tokenIdentifier, enabled: true })
      await expect(t.withIdentity(OTHER).mutation(api.learnV2Upgrade.upgradeLegacyCourse, { legacyCourseId: courseId, idempotencyKey: 'other' })).rejects.toThrow(/not found/)
      await t.run(async ctx => {
        const source = await ctx.db.query('courseSourceDocs').withIndex('by_courseId', q => q.eq('courseId', courseId)).first()
        if (!source?.documentId) throw new Error('fixture missing source')
        await ctx.db.delete(source.documentId)
      })
      await expect(owner.mutation(api.learnV2Upgrade.upgradeLegacyCourse, { legacyCourseId: courseId, idempotencyKey: 'missing-document' })).rejects.toThrow(/Document not found/)
      expect(await t.run(ctx => ctx.db.query('learningVoids').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).collect())).toEqual([])
    } finally {
      if (previous === undefined) delete process.env.LEARN_V2_ENABLED
      else process.env.LEARN_V2_ENABLED = previous
    }
  })

  test('rejects more than 100 selected source rows without a partial upgrade', async () => {
    const previous = process.env.LEARN_V2_ENABLED
    try {
      const { t, owner, courseId, documentId } = await setup()
      await enable(t)
      await t.run(async ctx => {
        for (let i = 0; i < 100; i += 1) {
          await ctx.db.insert('courseSourceDocs', { courseId, documentId, userId: OWNER.tokenIdentifier })
        }
      })
      await expect(owner.mutation(api.learnV2Upgrade.upgradeLegacyCourse, { legacyCourseId: courseId, idempotencyKey: 'too-many' })).rejects.toThrow(/too many source rows/)
      expect(await t.run(ctx => ctx.db.query('learningVoids').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).collect())).toEqual([])
    } finally {
      if (previous === undefined) delete process.env.LEARN_V2_ENABLED
      else process.env.LEARN_V2_ENABLED = previous
    }
  })
})
