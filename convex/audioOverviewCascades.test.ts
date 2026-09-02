/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'
import type { Id } from './_generated/dataModel'

const modules = import.meta.glob('./**/*.ts')

const USER = {
  tokenIdentifier: 'https://auth.example.com|audio_cascade',
  name: 'Audio Owner',
  email: 'audio@example.com',
}

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

async function seedOwnedAudio(
  t: ReturnType<typeof convexTest>,
  folderId: Id<'folders'>,
  courseScoped = false,
) {
  const overviewStorageId = await t.run(ctx =>
    ctx.storage.store(new Blob(['overview'], { type: 'audio/mpeg' })),
  )
  const interjectionStorageId = await t.run(ctx =>
    ctx.storage.store(new Blob(['interjection'], { type: 'audio/mpeg' })),
  )
  const result = await t.run(async (ctx) => {
    const overviewClaimId = await ctx.db.insert('audioOverviewUploadClaims', {
      userId: USER.tokenIdentifier,
      nonce: 'overview-claim',
      storageId: overviewStorageId,
      consumedAt: Date.now(),
      expiresAt: Number.MAX_SAFE_INTEGER,
    })
    const interjectionClaimId = await ctx.db.insert('audioOverviewUploadClaims', {
      userId: USER.tokenIdentifier,
      nonce: 'interjection-claim',
      storageId: interjectionStorageId,
      consumedAt: Date.now(),
      expiresAt: Number.MAX_SAFE_INTEGER,
    })
    const overviewId = await ctx.db.insert('audioOverviews', {
      userId: USER.tokenIdentifier,
      folderId,
      title: 'Published audio',
      status: 'ready',
      turns: [{
        speaker: 'host_a',
        text: 'Hello',
        audioFileId: overviewStorageId,
        durationMs: 1000,
      }],
      voiceProfile: { hostA: 'asteria', hostB: 'orion' },
      totalDurationMs: 1000,
      shareToken: 'a'.repeat(32),
      publishedAt: Date.now(),
      courseScoped,
    })
    const interjectionId = await ctx.db.insert('audioOverviewInterjections', {
      audioOverviewId: overviewId,
      userId: USER.tokenIdentifier,
      insertedAfterTurnIndex: 0,
      question: 'Why?',
      answerTurns: [{
        speaker: 'host_b',
        text: 'Because.',
        audioFileId: interjectionStorageId,
        durationMs: 700,
      }],
    })
    return { overviewId, interjectionId, overviewClaimId, interjectionClaimId }
  })
  return { ...result, overviewStorageId, interjectionStorageId }
}

async function finishAudioDeletion(
  t: ReturnType<typeof convexTest>,
  overviewId: Id<'audioOverviews'>,
) {
  const args = { overviewId, userId: USER.tokenIdentifier }
  await t.mutation(internal.audioOverviews.deleteOverviewBatch, args)
  await t.mutation(internal.audioOverviews.deleteOverviewBatch, args)
}

async function scheduledNames(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const jobs = await ctx.db.system.query('_scheduled_functions').collect()
    return jobs.map((job: any) => job.name.replace('.', ':'))
  })
}

describe('audio overview ownership cascades', () => {
  test('[P1] deleting a course uses claim-aware audio cleanup', async () => {
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Course folder' })
    const audio = await seedOwnedAudio(t, folderId, true)
    const courseId = await t.run(ctx => ctx.db.insert('courses', {
      userId: USER.tokenIdentifier,
      folderId,
      title: 'Course',
      status: 'ready',
      sourceType: 'web-only',
      sourceConfidence: { docCount: 0, webPercent: 100 },
      pace: 'steady',
      outlineSections: [],
      completedSectionCount: 1,
      totalSectionCount: 1,
      webSearchEnabled: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }))
    await t.run(ctx => ctx.db.insert('courseSections', {
      courseId,
      userId: USER.tokenIdentifier,
      order: 0,
      title: 'Audio section',
      knowledgeType: 'conceptual',
      status: 'ready',
      contentBlocks: [{
        type: 'audio',
        entityId: String(audio.overviewId),
        entityType: 'audio',
        order: 0,
      }],
      masteryLevel: 'new',
    }))

    await asUser.mutation(api.courses.deleteCourse, { id: courseId })

    const deleting = await t.run(ctx => ctx.db.get(audio.overviewId))
    expect(deleting === null || deleting.status === 'deleting').toBe(true)
    expect(deleting?.shareToken).toBeUndefined()
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    expect(await t.run(ctx => ctx.db.get(audio.overviewId))).toBeNull()
    expect(await t.run(ctx => ctx.storage.getUrl(audio.overviewStorageId))).toBeNull()
    expect(await t.run(ctx => ctx.storage.getUrl(audio.interjectionStorageId))).toBeNull()
    expect(await t.run(ctx => ctx.db.get(audio.overviewClaimId))).toBeNull()
    expect(await t.run(ctx => ctx.db.get(audio.interjectionClaimId))).toBeNull()
  })

  test('[P1] deleting a folder revokes its public audio and schedules bounded cleanup', async () => {
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Disposable' })
    const audio = await seedOwnedAudio(t, folderId)

    await asUser.mutation(api.folders.deleteFolder, { id: folderId })

    expect(await t.query(api.audioOverviews.getByShareToken, { token: 'a'.repeat(32) })).toBeNull()
    expect(await scheduledNames(t)).toContain('audioOverviews:deleteFolderOverviews')
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    expect(await t.run(ctx => ctx.db.get(audio.overviewId))).toBeNull()
    expect(await t.run(ctx => ctx.storage.getUrl(audio.overviewStorageId))).toBeNull()
    expect(await t.run(ctx => ctx.storage.getUrl(audio.interjectionStorageId))).toBeNull()
  })

  test('[P0] deleting a folder cancels active audio work before another upload can begin', async () => {
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER)
    await asUser.mutation(api.users.upsertUser, {})
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Active audio' })
    await t.run(ctx => ctx.db.insert('documents', {
      userId: USER.tokenIdentifier,
      folderId,
      filename: 'source.txt',
      status: 'success',
      fileSize: 10,
    }))
    const { taskId } = await asUser.mutation(api.tasks.requestAudioOverview, {
      folderId,
      scope: { mode: 'folder' },
      preferences: { lengthMinutes: 5, complexity: 'beginner' },
      voiceProfile: { hostA: 'asteria', hostB: 'orion' },
    })
    await asUser.mutation(api.tasks.claimAudioOverviewGeneration, { taskId })
    const { claimId } = await asUser.mutation(api.audioOverviewUploads.prepare, { taskId })

    await asUser.mutation(api.folders.deleteFolder, { id: folderId })

    expect((await t.run(ctx => ctx.db.get(taskId)))?.status).toBe('cancelled')
    await expect(asUser.mutation(api.audioOverviewUploads.begin, {
      claimId,
      expectedSha256: '00'.repeat(32),
      expectedSize: 4,
    })).rejects.toThrow(/running audio overview task required/i)
  })

  test('[P1] deleting a referenced source folder cancels a cross-folder explicit task', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER)
    await asUser.mutation(api.users.upsertUser, {})
    const taskFolderId = await asUser.mutation(api.folders.createFolder, { name: 'Audio destination' })
    const sourceFolderId = await asUser.mutation(api.folders.createFolder, { name: 'Referenced source' })
    const sourceId = await t.run(ctx => ctx.db.insert('documents', {
      userId: USER.tokenIdentifier,
      folderId: sourceFolderId,
      filename: 'referenced.txt',
      status: 'success',
      fileSize: 10,
    }))
    const { taskId } = await asUser.mutation(api.tasks.requestAudioOverview, {
      folderId: taskFolderId,
      scope: { mode: 'explicit', documentIds: [sourceId] },
      preferences: { lengthMinutes: 5, complexity: 'beginner' },
      voiceProfile: { hostA: 'asteria', hostB: 'orion' },
    })
    await asUser.mutation(api.tasks.claimAudioOverviewGeneration, { taskId })
    const { claimId } = await asUser.mutation(api.audioOverviewUploads.prepare, { taskId })

    await asUser.mutation(api.folders.deleteFolder, { id: sourceFolderId })

    expect((await t.run(ctx => ctx.db.get(taskId)))?.status).toBe('cancelled')
    await expect(asUser.mutation(api.audioOverviewUploads.begin, {
      claimId,
      expectedSha256: '00'.repeat(32),
      expectedSize: 4,
    })).rejects.toThrow(/running audio overview task required/i)
  })

  test('[P1] deleting an account schedules audio rows and orphan claims for cleanup', async () => {
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER)
    await asUser.mutation(api.users.upsertUser, {})
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Account audio' })
    const audio = await seedOwnedAudio(t, folderId)
    const orphanClaimId = await t.run(ctx => ctx.db.insert('audioOverviewUploadClaims', {
      userId: USER.tokenIdentifier,
      nonce: 'never-uploaded',
      expiresAt: Date.now() + 60_000,
    }))
    const taskId = await t.run(ctx => ctx.db.insert('tasks', {
      userId: USER.tokenIdentifier,
      folderId,
      type: 'audio-overview-generation',
      status: 'running',
      title: 'Still generating',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }))

    await asUser.mutation(internal.accountDeletion.deleteCurrentUser, {})

    expect(await t.query(api.audioOverviews.getByShareToken, { token: 'a'.repeat(32) })).toBeNull()
    const names = await scheduledNames(t)
    expect(names).toContain('audioOverviews:deleteUserOverviews')
    expect(names).toContain('audioOverviewUploads:cleanupUserClaims')
    expect(await t.run(ctx => ctx.db.get(taskId))).toBeNull()

    await t.mutation(internal.audioOverviews.deleteUserOverviews, {
      userId: USER.tokenIdentifier,
      cursor: null,
    })
    await finishAudioDeletion(t, audio.overviewId)
    await t.mutation(internal.audioOverviewUploads.cleanupUserClaims, { userId: USER.tokenIdentifier })
    expect(await t.run(ctx => ctx.db.get(orphanClaimId))).toBeNull()
    expect(await t.run(ctx => ctx.db.get(audio.overviewId))).toBeNull()
  })
})
