/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test, vi } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'
import { enrollProducer, protectProducerArtifact } from '../tests/fixtures/learn-v2-producer-lineage'
import { prepareAndRegisterInstructionalArtifacts, normalizedInstructionalCaseFingerprints } from './lib/learnV2ArtifactLineage'
import { LEARN_ARTIFACT_CASE_IDENTITY_VERSION } from '../shared/learn-v2-artifact-lineage'
import type { Id } from './_generated/dataModel'

const modules = import.meta.glob('./**/*.ts')

const USER_A = {
  tokenIdentifier: 'https://auth.example.com|interject_a',
  name: 'Alice',
  email: 'alice@example.com',
}
const USER_B = {
  tokenIdentifier: 'https://auth.example.com|interject_b',
  name: 'Bob',
  email: 'bob@example.com',
}

async function storeBlob(t: ReturnType<typeof convexTest>, bytes = new Uint8Array([0xff, 0xfb, 0x90, 0x00])) {
  return await t.run(async (ctx) =>
    ctx.storage.store(new Blob([bytes], { type: 'audio/mpeg' })),
  )
}

const VOICE = { hostA: 'asteria', hostB: 'orion' } as const

async function claimedBlob(t: ReturnType<typeof convexTest>, identity = USER_A) {
  const audioFileId = await storeBlob(t)
  const uploadClaimId = await t.run(ctx => ctx.db.insert('audioOverviewUploadClaims', {
    userId: identity.tokenIdentifier,
    nonce: `historical-${crypto.randomUUID()}`,
    expiresAt: Number.MAX_SAFE_INTEGER,
    storageId: audioFileId,
    consumedAt: Date.now(),
  }))
  return { audioFileId, uploadClaimId }
}

async function sampleTurns(t: ReturnType<typeof convexTest>, identity = USER_A) {
  const a = await claimedBlob(t, identity)
  const b = await claimedBlob(t, identity)
  const c = await claimedBlob(t, identity)
  return [
    { speaker: 'host_a' as const, text: 'Turn 1.', ...a, durationMs: 1000 },
    { speaker: 'host_b' as const, text: 'Turn 2.', ...b, durationMs: 1200 },
    { speaker: 'host_a' as const, text: 'Turn 3.', ...c, durationMs: 900 },
  ]
}

async function bindClaimsToTask(
  t: ReturnType<typeof convexTest>,
  turns: Array<{ uploadClaimId: Id<'audioOverviewUploadClaims'> }>,
  taskId: Id<'tasks'>,
) {
  await t.run(async (ctx) => {
    for (const turn of turns) {
      await ctx.db.patch(turn.uploadClaimId, { taskId, consumedAt: undefined })
    }
  })
}

async function createReadyOverview(t: ReturnType<typeof convexTest>, user: typeof USER_A) {
  const asUser = t.withIdentity(user)
  const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Bio' })
  const turns = await sampleTurns(t, user)
  const persistedTurns = turns.map(({ uploadClaimId: _claimId, ...turn }) => turn)
  const overviewId = await t.run(ctx => ctx.db.insert('audioOverviews', {
    userId: user.tokenIdentifier,
    folderId,
    title: 'Parent overview',
    status: 'ready',
    turns: persistedTurns,
    voiceProfile: VOICE,
    totalDurationMs: persistedTurns.reduce((sum, turn) => sum + turn.durationMs, 0),
  }))
  return { asUser, folderId, overviewId }
}

async function sampleAnswerTurns(t: ReturnType<typeof convexTest>) {
  const a = await claimedBlob(t)
  const b = await claimedBlob(t)
  const c = await claimedBlob(t)
  return [
    { speaker: 'host_a' as const, text: 'Great question — here is the context.', ...a, durationMs: 2500 },
    { speaker: 'host_b' as const, text: 'So that means what exactly?', ...b, durationMs: 1800 },
    { speaker: 'host_a' as const, text: 'Concretely, it means this.', ...c, durationMs: 2200 },
  ]
}

async function reserveInterjectionTask(
  t: ReturnType<typeof convexTest>,
  folderId: Id<'folders'>,
) {
  return await t.run(ctx => ctx.db.insert('tasks', {
    userId: USER_A.tokenIdentifier,
    folderId,
    type: 'audio-overview-generation',
    status: 'running',
    title: 'Historical interjection fixture',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    audioOverviewRequest: {
      scope: { mode: 'folder' },
      documents: [],
      preferences: { lengthMinutes: 5, complexity: 'beginner' },
      voiceProfile: VOICE,
      quotaDate: '2026-09-03',
    },
  }))
}

describe('audioOverviewInterjections.create', () => {
  test('[P0] rejects unauthenticated callers', async () => {
    const t = convexTest(schema, modules)
    const { asUser: _asUser, folderId, overviewId } = await createReadyOverview(t, USER_A)
    const taskId = await reserveInterjectionTask(t, folderId)
    const answerTurns = await sampleAnswerTurns(t)
    await expect(
      t.mutation(api.audioOverviewInterjections.create, {
        audioOverviewId: overviewId,
        taskId,
        insertedAfterTurnIndex: 1,
        question: 'What is ATP?',
        answerTurns,
      }),
    ).rejects.toThrow(/Unauthenticated/)
  })

  test('[P0] rejects callers who do not own the overview', async () => {
    const t = convexTest(schema, modules)
    const { asUser: _asUser, folderId, overviewId } = await createReadyOverview(t, USER_A)
    const taskId = await reserveInterjectionTask(t, folderId)
    const answerTurns = await sampleAnswerTurns(t)
    const asB = t.withIdentity(USER_B)
    await expect(
      asB.mutation(api.audioOverviewInterjections.create, {
        audioOverviewId: overviewId,
        taskId,
        insertedAfterTurnIndex: 1,
        question: 'Steal ATP?',
        answerTurns,
      }),
    ).rejects.toThrow(/not found/)
  })

  test('[P0] rejects when overview is not status=ready', async () => {
    const t = convexTest(schema, modules)
    const { asUser, folderId, overviewId } = await createReadyOverview(t, USER_A)
    const taskId = await reserveInterjectionTask(t, folderId)
    const answerTurns = await sampleAnswerTurns(t)
    await t.run(async (ctx) => { await ctx.db.patch(overviewId, { status: 'generating' }) })
    await expect(
      asUser.mutation(api.audioOverviewInterjections.create, {
        audioOverviewId: overviewId,
        taskId,
        insertedAfterTurnIndex: 1,
        question: 'What is ATP?',
        answerTurns,
      }),
    ).rejects.toThrow(/not ready/)
  })

  test('[P0] rejects empty answerTurns', async () => {
    const t = convexTest(schema, modules)
    const { asUser, folderId, overviewId } = await createReadyOverview(t, USER_A)
    const taskId = await reserveInterjectionTask(t, folderId)
    await expect(
      asUser.mutation(api.audioOverviewInterjections.create, {
        audioOverviewId: overviewId,
        taskId,
        insertedAfterTurnIndex: 1,
        question: 'What is ATP?',
        answerTurns: [],
      }),
    ).rejects.toThrow(/at least one/)
  })

  test('[P0] rejects empty/whitespace question', async () => {
    const t = convexTest(schema, modules)
    const { asUser, folderId, overviewId } = await createReadyOverview(t, USER_A)
    const taskId = await reserveInterjectionTask(t, folderId)
    const answerTurns = await sampleAnswerTurns(t)
    await expect(
      asUser.mutation(api.audioOverviewInterjections.create, {
        audioOverviewId: overviewId,
        taskId,
        insertedAfterTurnIndex: 1,
        question: '   ',
        answerTurns,
      }),
    ).rejects.toThrow(/Question is required/)
  })

  test('[P0] clamps insertedAfterTurnIndex into valid range', async () => {
    const t = convexTest(schema, modules)
    const { asUser, folderId, overviewId } = await createReadyOverview(t, USER_A)
    const answerTurns = await sampleAnswerTurns(t)
    const highTaskId = await reserveInterjectionTask(t, folderId)
    await bindClaimsToTask(t, answerTurns, highTaskId)

    const { interjectionId: highId } = await asUser.mutation(api.audioOverviewInterjections.create, {
      audioOverviewId: overviewId,
      taskId: highTaskId,
      insertedAfterTurnIndex: 999,
      question: 'High index',
      answerTurns,
    })
    const high = await t.run(async (ctx) => ctx.db.get(highId))
    expect(high!.insertedAfterTurnIndex).toBe(3)

    const lowAnswerTurns = await sampleAnswerTurns(t)
    const lowTaskId = await reserveInterjectionTask(t, folderId)
    await bindClaimsToTask(t, lowAnswerTurns, lowTaskId)
    const { interjectionId: lowId } = await asUser.mutation(api.audioOverviewInterjections.create, {
      audioOverviewId: overviewId,
      taskId: lowTaskId,
      insertedAfterTurnIndex: -5,
      question: 'Low index',
      answerTurns: lowAnswerTurns,
    })
    const low = await t.run(async (ctx) => ctx.db.get(lowId))
    expect(low!.insertedAfterTurnIndex).toBe(0)
  })

  test('[P0] persists question truncated to 500 chars', async () => {
    const t = convexTest(schema, modules)
    const { asUser, folderId, overviewId } = await createReadyOverview(t, USER_A)
    const taskId = await reserveInterjectionTask(t, folderId)
    const answerTurns = await sampleAnswerTurns(t)
    await bindClaimsToTask(t, answerTurns, taskId)
    const long = 'a'.repeat(900)
    const { interjectionId } = await asUser.mutation(api.audioOverviewInterjections.create, {
      audioOverviewId: overviewId,
      taskId,
      insertedAfterTurnIndex: 1,
      question: long,
      answerTurns,
    })
    const row = await t.run(async (ctx) => ctx.db.get(interjectionId))
    expect(row!.question.length).toBe(500)
  })

  test('[P0] stores answerTurns with full shape', async () => {
    const t = convexTest(schema, modules)
    const { asUser, folderId, overviewId } = await createReadyOverview(t, USER_A)
    const taskId = await reserveInterjectionTask(t, folderId)
    const answerTurns = await sampleAnswerTurns(t)
    await bindClaimsToTask(t, answerTurns, taskId)
    const { interjectionId } = await asUser.mutation(api.audioOverviewInterjections.create, {
      audioOverviewId: overviewId,
      taskId,
      insertedAfterTurnIndex: 1,
      question: 'Inner query',
      answerTurns,
    })
    const row = await t.run(async (ctx) => ctx.db.get(interjectionId))
    expect(row!.answerTurns.length).toBe(3)
    expect(row!.answerTurns[0]!.speaker).toBe('host_a')
    expect(row!.answerTurns[0]!.durationMs).toBe(2500)
  })
})

describe('audioOverviewInterjections.listByOverview', () => {
  test('[P0] returns [] for unauthenticated callers', async () => {
    const t = convexTest(schema, modules)
    const { overviewId } = await createReadyOverview(t, USER_A)
    const result = await t.query(api.audioOverviewInterjections.listByOverview, { audioOverviewId: overviewId })
    expect(result).toEqual([])
  })

  test('[P0] returns [] for non-owners', async () => {
    const t = convexTest(schema, modules)
    const { overviewId } = await createReadyOverview(t, USER_A)
    const asB = t.withIdentity(USER_B)
    const result = await asB.query(api.audioOverviewInterjections.listByOverview, { audioOverviewId: overviewId })
    expect(result).toEqual([])
  })

  test('[P0] returns interjections in ascending insertion order', async () => {
    const t = convexTest(schema, modules)
    const { asUser, folderId, overviewId } = await createReadyOverview(t, USER_A)
    const answerTurns = await sampleAnswerTurns(t)

    const firstAnswerTurns = await sampleAnswerTurns(t)
    const firstTaskId = await reserveInterjectionTask(t, folderId)
    await bindClaimsToTask(t, firstAnswerTurns, firstTaskId)
    await asUser.mutation(api.audioOverviewInterjections.create, {
      audioOverviewId: overviewId,
      taskId: firstTaskId,
      insertedAfterTurnIndex: 0,
      question: 'Q1',
      answerTurns: firstAnswerTurns,
    })
    const secondTaskId = await reserveInterjectionTask(t, folderId)
    await bindClaimsToTask(t, answerTurns, secondTaskId)
    await asUser.mutation(api.audioOverviewInterjections.create, {
      audioOverviewId: overviewId,
      taskId: secondTaskId,
      insertedAfterTurnIndex: 2,
      question: 'Q2',
      answerTurns,
    })

    const list = await asUser.query(api.audioOverviewInterjections.listByOverview, { audioOverviewId: overviewId })
    expect(list.length).toBe(2)
    expect(list[0]!.question).toBe('Q1')
    expect(list[1]!.question).toBe('Q2')
  })
})

describe('audioOverviewInterjections.deleteInterjection', () => {
  test('[P0] rejects non-owners', async () => {
    const t = convexTest(schema, modules)
    const { asUser, folderId, overviewId } = await createReadyOverview(t, USER_A)
    const taskId = await reserveInterjectionTask(t, folderId)
    const answerTurns = await sampleAnswerTurns(t)
    await bindClaimsToTask(t, answerTurns, taskId)
    const { interjectionId } = await asUser.mutation(api.audioOverviewInterjections.create, {
      audioOverviewId: overviewId,
      taskId,
      insertedAfterTurnIndex: 1,
      question: 'q',
      answerTurns,
    })
    const asB = t.withIdentity(USER_B)
    await expect(asB.mutation(api.audioOverviewInterjections.deleteInterjection, { id: interjectionId })).rejects.toThrow(/not found/)
  })

  test('[P0] schedules bounded deletion and releases upload ownership', async () => {
    const t = convexTest(schema, modules)
    const { asUser, folderId, overviewId } = await createReadyOverview(t, USER_A)
    const taskId = await reserveInterjectionTask(t, folderId)
    const answerTurns = await sampleAnswerTurns(t)
    await bindClaimsToTask(t, answerTurns, taskId)
    const { interjectionId } = await asUser.mutation(api.audioOverviewInterjections.create, {
      audioOverviewId: overviewId,
      taskId,
      insertedAfterTurnIndex: 1,
      question: 'q',
      answerTurns,
    })
    vi.useFakeTimers()
    const result = await asUser.mutation(api.audioOverviewInterjections.deleteInterjection, { id: interjectionId })
    expect(result).toEqual({ scheduled: true })
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    const row = await t.run(async (ctx) => ctx.db.get(interjectionId))
    expect(row).toBeNull()
    for (const turn of answerTurns) {
      expect(await t.run(ctx => ctx.db.get(turn.uploadClaimId))).toBeNull()
    }
    vi.useRealTimers()
  })
})


async function enrolledInterjection() {
  const t = convexTest(schema, modules)
  const f = await createReadyOverview(t, USER_A)
  await enrollProducer(t, USER_A.tokenIdentifier, [])
  await f.asUser.run(ctx => prepareAndRegisterInstructionalArtifacts(ctx, { artifacts: [{ artifact: { kind: 'audio_overview', id: f.overviewId }, key: 'whole', sources: [], origins: [] }] }))
  const taskId = await reserveInterjectionTask(t, f.folderId)
  const answerTurns = await sampleAnswerTurns(t)
  await bindClaimsToTask(t, answerTurns, taskId)
  const args = { audioOverviewId: f.overviewId, taskId, insertedAfterTurnIndex: 0, question: 'My independent question', answerTurns }
  return { t, ...f, args }
}

describe('legacy Interjection producer and replay admission', () => {
  test('unenrolled publication rejects a changed frozen object before consuming claims', async () => {
    const t = convexTest(schema, modules)
    const f = await createReadyOverview(t, USER_A)
    const taskId = await reserveInterjectionTask(t, f.folderId)
    const answerTurns = await sampleAnswerTurns(t)
    await bindClaimsToTask(t, answerTurns, taskId)
    const documentId = await t.run(async ctx => {
      const id = await ctx.db.insert('documents', { userId: USER_A.tokenIdentifier, folderId: f.folderId, filename: 'owned.txt', status: 'success', fileSize: 1, r2Key: 'owned/replacement', contentHash: 'a'.repeat(64), sourceRevision: 'source.r1' })
      await ctx.db.patch(f.overviewId, { scopeDocIds: [id], sourceDocumentIds: [id] })
      const task = (await ctx.db.get(taskId))!
      await ctx.db.patch(taskId, { audioOverviewRequest: { ...task.audioOverviewRequest!, scope: { mode: 'explicit', documentIds: [id] }, documents: [{ documentId: id, folderId: f.folderId, filename: 'owned.txt', r2Key: 'owned/original', contentHash: 'a'.repeat(64), sourceRevision: 'source.r1' }] } })
      return id
    })
    const args = { audioOverviewId: f.overviewId, taskId, insertedAfterTurnIndex: 0, question: 'Own question', answerTurns }
    await expect(f.asUser.mutation(api.audioOverviewInterjections.create, args)).rejects.toThrow('Teaching input is unavailable')
    expect(await t.run(ctx => ctx.db.query('audioOverviewInterjections').withIndex('by_audioOverview', q => q.eq('audioOverviewId', f.overviewId)).take(1))).toEqual([])
    expect((await t.run(ctx => ctx.db.get(answerTurns[0]!.uploadClaimId)))?.consumedAt).toBeUndefined()
    await t.run(ctx => ctx.db.patch(documentId, { r2Key: 'owned/original' }))
    expect(await f.asUser.mutation(api.audioOverviewInterjections.create, args)).toHaveProperty('interjectionId')
    expect(await t.run(ctx => ctx.db.query('learnArtifactLineages').take(1))).toEqual([])
  })
  test('ordinary publication registers atomically and exact task replay writes no second receipt', async () => {
    const f = await enrolledInterjection()
    const result = await f.asUser.mutation(api.audioOverviewInterjections.create, f.args)
    const catalog = await f.t.run(ctx => ctx.db.query('learnAssessmentCatalogs').withIndex('by_userId', q => q.eq('userId', USER_A.tokenIdentifier)).unique())
    expect(await f.asUser.mutation(api.audioOverviewInterjections.create, f.args)).toEqual(result)
    expect(await f.t.run(ctx => ctx.db.query('learnAssessmentCatalogs').withIndex('by_userId', q => q.eq('userId', USER_A.tokenIdentifier)).unique())).toEqual(catalog)
    expect((await f.asUser.query(api.audioOverviewInterjections.listByOverview, { audioOverviewId: f.overviewId }))[0]).toMatchObject({ question: f.args.question, answerAvailability: 'available' })
    expect(await f.asUser.query(api.audioOverviewInterjections.getTurnUrls, { id: result.interjectionId })).toHaveLength(3)
  })
  test.each(['measurement', 'private_scoring', 'unknown'] as const)('%s parent or answer cannot pass through publication, text or media replay', async classification => {
    for (const parent of [false, true]) {
      const f = await enrolledInterjection()
      const result = await f.asUser.mutation(api.audioOverviewInterjections.create, f.args)
      await protectProducerArtifact(f.t, USER_A.tokenIdentifier, parent ? { kind: 'audio_overview', id: f.overviewId } : { kind: 'audio_interjection', id: result.interjectionId }, classification)
      const catalog = (await f.t.run(ctx => ctx.db.query('learnAssessmentCatalogs').withIndex('by_userId', q => q.eq('userId', USER_A.tokenIdentifier)).unique()))!
      await f.t.run(ctx => ctx.db.patch(catalog._id, { measurementCapability: { enabled: false } }))
      await expect(f.asUser.mutation(api.audioOverviewInterjections.create, f.args)).rejects.toThrow(/unavailable/)
      const rows = await f.asUser.query(api.audioOverviewInterjections.listByOverview, { audioOverviewId: f.overviewId })
      expect(rows[0]).toMatchObject({ question: f.args.question, answerTurns: [], answerAvailability: 'unavailable' })
      await expect(f.asUser.query(api.audioOverviewInterjections.getTurnUrls, { id: result.interjectionId })).rejects.toThrow(/unavailable/)
    }
  })
  test('a late reserved case rolls back answer publication and upload-claim consumption', async () => {
    const f = await enrolledInterjection()
    await f.t.run(async ctx => ctx.db.insert('learnAssessmentCases', { userId: USER_A.tokenIdentifier, storageVersion: 'learn-v2.measurement-storage.v1', createdAt: 1, caseKey: 'retired-interjection', usageClass: 'unknown', reservedAt: 0, identityPolicyVersion: LEARN_ARTIFACT_CASE_IDENTITY_VERSION, ...await normalizedInstructionalCaseFingerprints('Retired task', 'Retired answer') }))
    await expect(f.asUser.mutation(api.audioOverviewInterjections.create, f.args)).rejects.toThrow(/reservation check/)
    expect(await f.t.run(ctx => ctx.db.query('audioOverviewInterjections').withIndex('by_audioOverview', q => q.eq('audioOverviewId', f.overviewId)).take(1))).toEqual([])
    expect((await f.t.run(ctx => ctx.db.get(f.args.taskId)))?.status).toBe('running')
    expect((await f.t.run(ctx => ctx.db.get(f.args.answerTurns[0]!.uploadClaimId)))?.consumedAt).toBeUndefined()
  })
})
