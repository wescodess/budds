/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
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

async function storeBlob(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) =>
    ctx.storage.store(new Blob([new Uint8Array([0xff, 0xfb, 0x90, 0x00])], { type: 'audio/mpeg' })),
  )
}

const VOICE = { hostA: 'asteria', hostB: 'orion' }

async function sampleTurns(t: ReturnType<typeof convexTest>) {
  const a = await storeBlob(t)
  const b = await storeBlob(t)
  const c = await storeBlob(t)
  return [
    { speaker: 'host_a' as const, text: 'Turn 1.', audioFileId: a, durationMs: 1000 },
    { speaker: 'host_b' as const, text: 'Turn 2.', audioFileId: b, durationMs: 1200 },
    { speaker: 'host_a' as const, text: 'Turn 3.', audioFileId: c, durationMs: 900 },
  ]
}

async function createReadyOverview(t: ReturnType<typeof convexTest>, user: typeof USER_A) {
  const asUser = t.withIdentity(user)
  const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Bio' })
  const turns = await sampleTurns(t)
  const { overviewId } = await asUser.mutation(api.audioOverviews.createWithTurns, {
    folderId,
    title: 'Parent overview',
    turns,
    voiceProfile: VOICE,
  })
  return { asUser, folderId, overviewId }
}

async function sampleAnswerTurns(t: ReturnType<typeof convexTest>) {
  const a = await storeBlob(t)
  const b = await storeBlob(t)
  const c = await storeBlob(t)
  return [
    { speaker: 'host_a' as const, text: 'Great question — here is the context.', audioFileId: a, durationMs: 2500 },
    { speaker: 'host_b' as const, text: 'So that means what exactly?', audioFileId: b, durationMs: 1800 },
    { speaker: 'host_a' as const, text: 'Concretely, it means this.', audioFileId: c, durationMs: 2200 },
  ]
}

describe('audioOverviewInterjections.create', () => {
  test('[P0] rejects unauthenticated callers', async () => {
    const t = convexTest(schema, modules)
    const { overviewId } = await createReadyOverview(t, USER_A)
    const answerTurns = await sampleAnswerTurns(t)
    await expect(
      t.mutation(api.audioOverviewInterjections.create, {
        audioOverviewId: overviewId,
        insertedAfterTurnIndex: 1,
        question: 'What is ATP?',
        answerTurns,
      }),
    ).rejects.toThrow(/Unauthenticated/)
  })

  test('[P0] rejects callers who do not own the overview', async () => {
    const t = convexTest(schema, modules)
    const { overviewId } = await createReadyOverview(t, USER_A)
    const answerTurns = await sampleAnswerTurns(t)
    const asB = t.withIdentity(USER_B)
    await expect(
      asB.mutation(api.audioOverviewInterjections.create, {
        audioOverviewId: overviewId,
        insertedAfterTurnIndex: 1,
        question: 'Steal ATP?',
        answerTurns,
      }),
    ).rejects.toThrow(/not found/)
  })

  test('[P0] rejects when overview is not status=ready', async () => {
    const t = convexTest(schema, modules)
    const { asUser, overviewId } = await createReadyOverview(t, USER_A)
    const answerTurns = await sampleAnswerTurns(t)
    await t.run(async (ctx) => { await ctx.db.patch(overviewId, { status: 'generating' }) })
    await expect(
      asUser.mutation(api.audioOverviewInterjections.create, {
        audioOverviewId: overviewId,
        insertedAfterTurnIndex: 1,
        question: 'What is ATP?',
        answerTurns,
      }),
    ).rejects.toThrow(/not ready/)
  })

  test('[P0] rejects empty answerTurns', async () => {
    const t = convexTest(schema, modules)
    const { asUser, overviewId } = await createReadyOverview(t, USER_A)
    await expect(
      asUser.mutation(api.audioOverviewInterjections.create, {
        audioOverviewId: overviewId,
        insertedAfterTurnIndex: 1,
        question: 'What is ATP?',
        answerTurns: [],
      }),
    ).rejects.toThrow(/at least one/)
  })

  test('[P0] rejects empty/whitespace question', async () => {
    const t = convexTest(schema, modules)
    const { asUser, overviewId } = await createReadyOverview(t, USER_A)
    const answerTurns = await sampleAnswerTurns(t)
    await expect(
      asUser.mutation(api.audioOverviewInterjections.create, {
        audioOverviewId: overviewId,
        insertedAfterTurnIndex: 1,
        question: '   ',
        answerTurns,
      }),
    ).rejects.toThrow(/Question is required/)
  })

  test('[P0] clamps insertedAfterTurnIndex into valid range', async () => {
    const t = convexTest(schema, modules)
    const { asUser, overviewId } = await createReadyOverview(t, USER_A)
    const answerTurns = await sampleAnswerTurns(t)

    const { interjectionId: highId } = await asUser.mutation(api.audioOverviewInterjections.create, {
      audioOverviewId: overviewId,
      insertedAfterTurnIndex: 999,
      question: 'High index',
      answerTurns,
    })
    const high = await t.run(async (ctx) => ctx.db.get(highId))
    expect(high!.insertedAfterTurnIndex).toBe(3)

    const { interjectionId: lowId } = await asUser.mutation(api.audioOverviewInterjections.create, {
      audioOverviewId: overviewId,
      insertedAfterTurnIndex: -5,
      question: 'Low index',
      answerTurns,
    })
    const low = await t.run(async (ctx) => ctx.db.get(lowId))
    expect(low!.insertedAfterTurnIndex).toBe(0)
  })

  test('[P0] persists question truncated to 500 chars', async () => {
    const t = convexTest(schema, modules)
    const { asUser, overviewId } = await createReadyOverview(t, USER_A)
    const answerTurns = await sampleAnswerTurns(t)
    const long = 'a'.repeat(900)
    const { interjectionId } = await asUser.mutation(api.audioOverviewInterjections.create, {
      audioOverviewId: overviewId,
      insertedAfterTurnIndex: 1,
      question: long,
      answerTurns,
    })
    const row = await t.run(async (ctx) => ctx.db.get(interjectionId))
    expect(row!.question.length).toBe(500)
  })

  test('[P0] stores answerTurns with full shape', async () => {
    const t = convexTest(schema, modules)
    const { asUser, overviewId } = await createReadyOverview(t, USER_A)
    const answerTurns = await sampleAnswerTurns(t)
    const { interjectionId } = await asUser.mutation(api.audioOverviewInterjections.create, {
      audioOverviewId: overviewId,
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
    const { asUser, overviewId } = await createReadyOverview(t, USER_A)
    const answerTurns = await sampleAnswerTurns(t)

    await asUser.mutation(api.audioOverviewInterjections.create, {
      audioOverviewId: overviewId,
      insertedAfterTurnIndex: 0,
      question: 'Q1',
      answerTurns,
    })
    await asUser.mutation(api.audioOverviewInterjections.create, {
      audioOverviewId: overviewId,
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
    const { asUser, overviewId } = await createReadyOverview(t, USER_A)
    const answerTurns = await sampleAnswerTurns(t)
    const { interjectionId } = await asUser.mutation(api.audioOverviewInterjections.create, {
      audioOverviewId: overviewId,
      insertedAfterTurnIndex: 1,
      question: 'q',
      answerTurns,
    })
    const asB = t.withIdentity(USER_B)
    await expect(asB.mutation(api.audioOverviewInterjections.deleteInterjection, { id: interjectionId })).rejects.toThrow(/not found/)
  })

  test('[P0] deletes the row and returns deletedTurns count for owner', async () => {
    const t = convexTest(schema, modules)
    const { asUser, overviewId } = await createReadyOverview(t, USER_A)
    const answerTurns = await sampleAnswerTurns(t)
    const { interjectionId } = await asUser.mutation(api.audioOverviewInterjections.create, {
      audioOverviewId: overviewId,
      insertedAfterTurnIndex: 1,
      question: 'q',
      answerTurns,
    })
    const result = await asUser.mutation(api.audioOverviewInterjections.deleteInterjection, { id: interjectionId })
    expect(result.deletedTurns).toBe(3)
    const row = await t.run(async (ctx) => ctx.db.get(interjectionId))
    expect(row).toBeNull()
  })
})
