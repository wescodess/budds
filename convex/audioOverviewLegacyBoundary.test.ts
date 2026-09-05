/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')

const USER = {
  tokenIdentifier: 'https://auth.example.com|legacy_boundary_owner',
  name: 'Legacy Boundary Owner',
}
const DISABLED = /Legacy Audio Overview generation is disabled/i

async function setupActiveV2Task() {
  const t = convexTest(schema, modules)
  const asUser = t.withIdentity(USER)
  await asUser.mutation(api.users.upsertUser, {})
  const folderId = await asUser.mutation(api.folders.createFolder, { name: 'V2 audio' })
  const documentId = await t.run(ctx => ctx.db.insert('documents', {
    userId: USER.tokenIdentifier,
    folderId,
    filename: 'source.txt',
    status: 'success',
    fileSize: 6,
    contentHash: 'a'.repeat(64),
    sourceRevision: `sha256:${'a'.repeat(64)}`,
  }))
  const now = Date.now()
  const taskId = await t.run(ctx => ctx.db.insert('tasks', {
    userId: USER.tokenIdentifier,
    folderId,
    type: 'audio-overview-generation',
    status: 'running',
    title: 'Generating audio overview…',
    progress: 'Synthesizing…',
    createdAt: now,
    updatedAt: now,
    audioOverviewRequest: {
      scope: { mode: 'explicit', documentIds: [documentId] },
      documents: [{
        documentId,
        folderId,
        filename: 'source.txt',
        fileSize: 6,
        contentHash: 'a'.repeat(64),
        sourceRevision: `sha256:${'a'.repeat(64)}`,
      }],
      preferences: { lengthMinutes: 5, complexity: 'beginner' },
      voiceProfile: { hostA: 'asteria', hostB: 'orion' },
      quotaDate: '2026-09-03',
    },
  }))
  const jobId = await t.run(ctx => ctx.db.insert('audioOverviewJobs', {
    userId: USER.tokenIdentifier,
    taskId,
    folderId,
    idempotencyKey: 'legacy_boundary_v2_job',
    capabilityHash: 'h'.repeat(43),
    status: 'running',
    stage: 'synthesizing',
    completedTurns: 0,
    createdAt: now,
    updatedAt: now,
  }))
  const audioFileId = await t.run(ctx => ctx.storage.store(
    new Blob([new Uint8Array([0xff, 0xfb, 0x90, 0x00])], { type: 'audio/mpeg' }),
  ))
  const claimId = await t.run(ctx => ctx.db.insert('audioOverviewUploadClaims', {
    userId: USER.tokenIdentifier,
    taskId,
    nonce: 'historical-claim',
    expiresAt: now + 60_000,
    storageId: audioFileId,
  }))
  return { t, asUser, folderId, documentId, taskId, jobId, claimId, audioFileId }
}

describe('legacy Audio Overview write boundary', () => {
  test('[P1] direct v1 request fails without reserving quota or creating a task', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER)
    await asUser.mutation(api.users.upsertUser, {})
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Legacy request' })
    const documentId = await t.run(ctx => ctx.db.insert('documents', {
      userId: USER.tokenIdentifier,
      folderId,
      filename: 'ready.txt',
      status: 'success',
      fileSize: 5,
      contentHash: 'a'.repeat(64),
      sourceRevision: `sha256:${'a'.repeat(64)}`,
    }))

    await expect(asUser.mutation(api.tasks.requestAudioOverview, {
      folderId,
      scope: { mode: 'explicit', documentIds: [documentId] },
      preferences: { lengthMinutes: 5, complexity: 'beginner' },
      voiceProfile: { hostA: 'asteria', hostB: 'orion' },
    })).rejects.toThrow(DISABLED)

    expect(await t.run(ctx => ctx.db.query('tasks').collect())).toEqual([])
    expect((await asUser.query(api.users.getDailyQuota, {}))?.used).toBe(0)
  })

  test('[P1] v1 claim and upload mutations cannot mutate an active v2 task or storage', async () => {
    const { t, asUser, taskId, claimId, audioFileId } = await setupActiveV2Task()
    const before = await t.run(async ctx => ({
      task: await ctx.db.get(taskId),
      claim: await ctx.db.get(claimId),
    }))

    await expect(asUser.mutation(api.tasks.claimAudioOverviewGeneration, { taskId }))
      .rejects.toThrow(DISABLED)
    await expect(asUser.mutation(api.audioOverviewUploads.prepare, { taskId }))
      .rejects.toThrow(DISABLED)
    await expect(asUser.mutation(api.audioOverviewUploads.begin, {
      claimId,
      expectedSha256: 'a'.repeat(64),
      expectedSize: 4,
    })).rejects.toThrow(DISABLED)
    await expect(asUser.mutation(api.audioOverviewUploads.discard, { claimIds: [claimId] }))
      .rejects.toThrow(DISABLED)

    const after = await t.run(async ctx => ({
      task: await ctx.db.get(taskId),
      claim: await ctx.db.get(claimId),
      claims: await ctx.db.query('audioOverviewUploadClaims').collect(),
    }))
    expect(after.task).toEqual(before.task)
    expect(after.claim).toEqual(before.claim)
    expect(after.claims).toHaveLength(1)
    expect(await t.run(ctx => ctx.storage.getUrl(audioFileId))).not.toBeNull()
  })

  test('[P1] v1 publishers fail before overview, task, claim, or storage writes', async () => {
    const { t, asUser, folderId, documentId, taskId, claimId, audioFileId }
      = await setupActiveV2Task()
    const turn = {
      speaker: 'host_a' as const,
      text: 'A historical v1 turn.',
      audioFileId,
      uploadClaimId: claimId,
      durationMs: 1_000,
      sourceIndex: 0,
    }
    const common = {
      folderId,
      taskId,
      title: 'Blocked legacy publication',
      turns: [turn],
      voiceProfile: { hostA: 'asteria', hostB: 'orion' },
      preferences: { lengthMinutes: 5, complexity: 'beginner' as const },
      sourceDocumentIds: [documentId],
    }
    const before = await t.run(async ctx => ({
      task: await ctx.db.get(taskId),
      claim: await ctx.db.get(claimId),
    }))

    await expect(asUser.mutation(api.audioOverviews.createWithTurns, common))
      .rejects.toThrow(DISABLED)
    await expect(asUser.mutation(api.audioOverviews.createCourseScopedOverview, common))
      .rejects.toThrow(DISABLED)

    expect(await t.run(ctx => ctx.db.query('audioOverviews').collect())).toEqual([])
    expect(await t.run(ctx => ctx.db.get(taskId))).toEqual(before.task)
    expect(await t.run(ctx => ctx.db.get(claimId))).toEqual(before.claim)
    expect(await t.run(ctx => ctx.storage.getUrl(audioFileId))).not.toBeNull()
  })

  test('[P1] obsolete v1 job writers and upload actions cannot mutate v2 job state', async () => {
    const { t, asUser, documentId, taskId, jobId, claimId, audioFileId }
      = await setupActiveV2Task()
    const capability = 'c'.repeat(43)
    const before = await t.run(async ctx => ({
      task: await ctx.db.get(taskId),
      job: await ctx.db.get(jobId),
      claim: await ctx.db.get(claimId),
    }))
    const expectDisabled = async (operation: Promise<unknown>) => {
      await expect(operation).rejects.toThrow(DISABLED)
    }

    await expectDisabled(asUser.mutation(api.audioOverviewJobs.commitScript, {
      jobId,
      capability,
      title: 'Blocked v1 script',
      model: 'google/gemini-2.5-flash',
      ttsEngine: 'dia',
      sourceDocumentIds: [documentId],
      turns: [{ speaker: 'host_a', text: 'Do not persist this.' }],
    }))
    await expectDisabled(asUser.mutation(api.audioOverviewJobs.beginTurnSynthesis, {
      jobId, capability, turnOrder: 0,
    }))
    await expectDisabled(asUser.mutation(api.audioOverviewJobs.releaseTurnSynthesis, {
      jobId, capability, turnOrder: 0, attemptId: 'attempt',
    }))
    await expectDisabled(asUser.mutation(api.audioOverviewJobs.prepareTurnUpload, {
      jobId, capability, turnOrder: 0,
    }))
    await expectDisabled(asUser.mutation(api.audioOverviewJobs.beginTurnUpload, {
      jobId,
      capability,
      turnOrder: 0,
      claimId,
      expectedSha256: 'a'.repeat(64),
      expectedSize: 4,
    }))
    await expectDisabled(asUser.mutation(api.audioOverviewJobs.commitAlignment, {
      jobId, capability, turnOrder: 0, wordTimings: [],
    }))
    await expectDisabled(asUser.mutation(api.audioOverviewJobs.finalize, { jobId, capability }))
    await expectDisabled(asUser.action(api.audioOverviewJobUploadActions.completeVerified, {
      jobId,
      capability,
      turnOrder: 0,
      claimId,
      storageId: audioFileId,
      durationMs: 1_000,
    }))
    await expectDisabled(asUser.action(api.audioOverviewJobUploadActions.abortVerified, {
      jobId, capability, turnOrder: 0, claimId, storageId: audioFileId,
    }))

    const after = await t.run(async ctx => ({
      task: await ctx.db.get(taskId),
      job: await ctx.db.get(jobId),
      claim: await ctx.db.get(claimId),
      turns: await ctx.db.query('audioOverviewJobTurns').collect(),
      overviews: await ctx.db.query('audioOverviews').collect(),
    }))
    expect(after.task).toEqual(before.task)
    expect(after.job).toEqual(before.job)
    expect(after.claim).toEqual(before.claim)
    expect(after.turns).toEqual([])
    expect(after.overviews).toEqual([])
    expect(await t.run(ctx => ctx.storage.getUrl(audioFileId))).not.toBeNull()
  })

  test('[P1] disabled v1 writes still require authentication', async () => {
    const { t, folderId, taskId, claimId, audioFileId } = await setupActiveV2Task()
    await expect(t.mutation(api.tasks.claimAudioOverviewGeneration, { taskId }))
      .rejects.toThrow(/Unauthenticated/i)
    await expect(t.mutation(api.audioOverviewUploads.discard, { claimIds: [claimId] }))
      .rejects.toThrow(/Unauthenticated/i)
    await expect(t.mutation(api.audioOverviews.createWithTurns, {
      folderId,
      taskId,
      title: 'Unauthenticated',
      turns: [{
        speaker: 'host_a',
        text: 'No access.',
        audioFileId,
        uploadClaimId: claimId,
        durationMs: 100,
      }],
      voiceProfile: { hostA: 'asteria', hostB: 'orion' },
    })).rejects.toThrow(/Unauthenticated/i)
  })
})
