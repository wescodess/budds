/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test, vi } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'
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
