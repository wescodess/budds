/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test, vi } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')

const USER_A = {
  tokenIdentifier: 'https://auth.example.com|user_audio_a',
  name: 'Alice',
  email: 'alice@example.com',
}
const USER_B = {
  tokenIdentifier: 'https://auth.example.com|user_audio_b',
  name: 'Bob',
  email: 'bob@example.com',
}

async function storeAudioBlob(t: ReturnType<typeof convexTest>, bytes = new Uint8Array([0xff, 0xfb, 0x90, 0x00])) {
  return await t.run(async (ctx) =>
    ctx.storage.store(new Blob([bytes], { type: 'audio/mpeg' })),
  )
}

async function claimedAudioBlob(
  t: ReturnType<typeof convexTest>,
  identity = USER_A,
) {
  const bytes = new Uint8Array([0xff, 0xfb, 0x90, 0x00])
  const audioFileId = await storeAudioBlob(t, bytes)
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
  const fileA = await claimedAudioBlob(t, identity)
  const fileB = await claimedAudioBlob(t, identity)
  const fileC = await claimedAudioBlob(t, identity)
  return [
    { speaker: 'host_a' as const, text: 'Welcome to the overview.', ...fileA, durationMs: 3200, sourceIndex: 0 },
    { speaker: 'host_b' as const, text: 'Great to be here — what is this about?', ...fileB, durationMs: 2800, sourceIndex: 1 },
    { speaker: 'host_a' as const, text: 'Cellular respiration, mostly.', ...fileC, durationMs: 2100, sourceIndex: 0 },
  ]
}

async function bindClaimsToTask(
  t: ReturnType<typeof convexTest>,
  turns: Array<{ uploadClaimId: any }>,
  taskId: any,
) {
  await t.run(async (ctx) => {
    for (const turn of turns) {
      await ctx.db.patch(turn.uploadClaimId, { taskId, consumedAt: undefined })
    }
  })
}

const VOICE = { hostA: 'asteria' as const, hostB: 'orion' as const }

async function createWithTurns(
  t: ReturnType<typeof convexTest>,
  asUser: ReturnType<ReturnType<typeof convexTest>['withIdentity']>,
  args: Omit<Parameters<typeof asUser.mutation>[1], 'taskId'> & { folderId: any },
) {
  void asUser
  const ownerId = (await t.run(ctx => ctx.db.get(args.folderId)))!.userId
  const raw = args as any
  const turns = raw.turns.map(({ uploadClaimId: _uploadClaimId, ...turn }: any) => turn)
  const overviewId = await t.run(ctx => ctx.db.insert('audioOverviews', {
    userId: ownerId,
    folderId: args.folderId,
    title: raw.title,
    status: 'ready',
    model: raw.model,
    turns,
    voiceProfile: raw.voiceProfile ?? VOICE,
    preferences: raw.preferences,
    totalDurationMs: turns.reduce((sum: number, turn: { durationMs: number }) => sum + turn.durationMs, 0),
    sourceDocumentIds: raw.sourceDocumentIds,
    scopeDocIds: raw.scopeDocIds,
    courseScoped: raw.courseScoped,
  }))
  return { overviewId }
}

async function reserveCourseAudio(
  t: ReturnType<typeof convexTest>,
  asUser: ReturnType<ReturnType<typeof convexTest>['withIdentity']>,
  folderId: any,
) {
  void asUser
  const ownerId = (await t.run(ctx => ctx.db.get(folderId)))!.userId
  return await t.run(ctx => ctx.db.insert('tasks', {
    userId: ownerId,
    folderId,
    type: 'audio-overview-generation',
    status: 'running',
    title: 'Historical fixture task',
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

describe('audioOverviews.listByFolder', () => {
  test('[P0] returns only caller overviews for that folder', async () => {
    const t = convexTest(schema, modules)
    const asA = t.withIdentity(USER_A)
    const asB = t.withIdentity(USER_B)

    const folderA = await asA.mutation(api.folders.createFolder, { name: 'Bio' })
    const folderB = await asB.mutation(api.folders.createFolder, { name: 'Bio' })

    await createWithTurns(t, asA, {
      folderId: folderA,
      title: 'Alice',
      turns: await sampleTurns(t),
      voiceProfile: VOICE,
    })
    await createWithTurns(t, asB, {
      folderId: folderB,
      title: 'Bob',
      turns: await sampleTurns(t, USER_B),
      voiceProfile: VOICE,
    })

    const aList = await asA.query(api.audioOverviews.listByFolder, { folderId: folderA })
    expect(aList).toHaveLength(1)
    expect(aList[0]!.title).toBe('Alice')
    expect(aList[0]!.turnCount).toBe(3)

    const aInB = await asA.query(api.audioOverviews.listByFolder, { folderId: folderB })
    expect(aInB).toEqual([])
  })
})

describe('audioOverviews.getWithTurns', () => {
  test('[P0] returns null for other users', async () => {
    const t = convexTest(schema, modules)
    const asA = t.withIdentity(USER_A)
    const asB = t.withIdentity(USER_B)
    const folderA = await asA.mutation(api.folders.createFolder, { name: 'Bio' })

    const { overviewId } = await createWithTurns(t, asA, {
      folderId: folderA,
      title: 'Secret',
      turns: await sampleTurns(t),
      voiceProfile: VOICE,
    })

    expect(await asB.query(api.audioOverviews.getWithTurns, { id: overviewId })).toBeNull()
  })

  test('[P0] returns full overview + turns for the owner', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Bio' })

    const { overviewId } = await createWithTurns(t, asUser, {
      folderId,
      title: 'Deep',
      turns: await sampleTurns(t),
      voiceProfile: VOICE,
    })

    const full = await asUser.query(api.audioOverviews.getWithTurns, { id: overviewId })
    expect(full).not.toBeNull()
    expect(full!.turns).toHaveLength(3)
    expect(full!.turns[0]!.speaker).toBe('host_a')
    expect(full!.turns[1]!.speaker).toBe('host_b')
  })
})

describe('audioOverviews.getTurnUrls', () => {
  test('[P0] returns signed URLs in turn order for owner', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Bio' })

    const { overviewId } = await createWithTurns(t, asUser, {
      folderId,
      title: 'URLs',
      turns: await sampleTurns(t),
      voiceProfile: VOICE,
    })

    const urls = await asUser.query(api.audioOverviews.getTurnUrls, { id: overviewId })
    expect(urls).not.toBeNull()
    expect(urls!.length).toBe(3)
    for (const u of urls!) expect(typeof u).toBe('string')
  })

  test('[P0] returns null for foreign users', async () => {
    const t = convexTest(schema, modules)
    const asA = t.withIdentity(USER_A)
    const asB = t.withIdentity(USER_B)
    const folderA = await asA.mutation(api.folders.createFolder, { name: 'Bio' })

    const { overviewId } = await createWithTurns(t, asA, {
      folderId: folderA,
      title: 'Scoped',
      turns: await sampleTurns(t),
      voiceProfile: VOICE,
    })
    expect(await asB.query(api.audioOverviews.getTurnUrls, { id: overviewId })).toBeNull()
  })
})

describe('audioOverviews.deleteOverview', () => {
  test('[P0] rejects foreign callers', async () => {
    const t = convexTest(schema, modules)
    const asA = t.withIdentity(USER_A)
    const asB = t.withIdentity(USER_B)
    const folderA = await asA.mutation(api.folders.createFolder, { name: 'Bio' })

    const { overviewId } = await createWithTurns(t, asA, {
      folderId: folderA,
      title: 'Mine',
      turns: await sampleTurns(t),
      voiceProfile: VOICE,
    })

    await expect(
      asB.mutation(api.audioOverviews.deleteOverview, { id: overviewId }),
    ).rejects.toThrow(/Audio overview not found/)
  })

  test('[P0] removes row + all turn storage blobs for owner', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Bio' })
    const turns = await sampleTurns(t)

    const { overviewId } = await createWithTurns(t, asUser, {
      folderId,
      title: 'Doomed',
      turns,
      voiceProfile: VOICE,
    })
    const interjectionTurns = await sampleTurns(t)
    const interjectionTaskId = await reserveCourseAudio(t, asUser, folderId)
    await bindClaimsToTask(t, interjectionTurns, interjectionTaskId)
    const { interjectionId } = await asUser.mutation(api.audioOverviewInterjections.create, {
      audioOverviewId: overviewId,
      taskId: interjectionTaskId,
      insertedAfterTurnIndex: 1,
      question: 'A private follow-up',
      answerTurns: interjectionTurns,
    })

    vi.useFakeTimers()
    const result = await asUser.mutation(api.audioOverviews.deleteOverview, { id: overviewId })
    expect(result).toEqual({ scheduled: true })
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    vi.useRealTimers()

    const row = await t.run(async (ctx) => ctx.db.get(overviewId))
    expect(row).toBeNull()
    expect(await t.run(ctx => ctx.db.get(interjectionId))).toBeNull()
    for (const turn of [...turns, ...interjectionTurns]) {
      expect(await t.run(ctx => ctx.storage.getUrl(turn.audioFileId))).toBeNull()
    }
  })
})

async function createReadyOverview(t: ReturnType<typeof convexTest>, user: typeof USER_A) {
  const asUser = t.withIdentity(user)
  const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Bio' })
  const turns = await sampleTurns(t)
  const { overviewId } = await createWithTurns(t, asUser, {
    folderId,
    title: 'Photosynthesis — a conversation',
    turns,
    voiceProfile: VOICE,
  })
  return { asUser, folderId, overviewId }
}

describe('audioOverviews.publishOverview', () => {
  test('[P0] rejects unauthenticated callers', async () => {
    const t = convexTest(schema, modules)
    const { overviewId } = await createReadyOverview(t, USER_A)
    await expect(t.mutation(api.audioOverviews.publishOverview, { id: overviewId })).rejects.toThrow(/Unauthenticated/)
  })

  test('[P0] rejects callers who do not own the overview', async () => {
    const t = convexTest(schema, modules)
    const { overviewId } = await createReadyOverview(t, USER_A)
    const asB = t.withIdentity(USER_B)
    await expect(asB.mutation(api.audioOverviews.publishOverview, { id: overviewId })).rejects.toThrow(/not found/)
  })

  test('[P0] mints a 32-char hex token and persists publishedAt', async () => {
    const t = convexTest(schema, modules)
    const { asUser, overviewId } = await createReadyOverview(t, USER_A)
    const { token, publishedAt } = await asUser.mutation(api.audioOverviews.publishOverview, { id: overviewId })
    expect(token).toMatch(/^[0-9a-f]{32}$/)
    expect(publishedAt).toBeGreaterThan(0)

    const row = await t.run(async (ctx) => ctx.db.get(overviewId))
    expect(row?.shareToken).toBe(token)
    expect(row?.publishedAt).toBe(publishedAt)
  })

  test('[P0] is idempotent — re-publishing returns the existing token', async () => {
    const t = convexTest(schema, modules)
    const { asUser, overviewId } = await createReadyOverview(t, USER_A)
    const first = await asUser.mutation(api.audioOverviews.publishOverview, { id: overviewId })
    const second = await asUser.mutation(api.audioOverviews.publishOverview, { id: overviewId })
    expect(second.token).toBe(first.token)
    expect(second.publishedAt).toBe(first.publishedAt)
  })

  test('[P0] rejects publishing an overview that is not status=ready', async () => {
    const t = convexTest(schema, modules)
    const { asUser, overviewId } = await createReadyOverview(t, USER_A)
    await t.run(async (ctx) => {
      await ctx.db.patch(overviewId, { status: 'generating' })
    })
    await expect(asUser.mutation(api.audioOverviews.publishOverview, { id: overviewId })).rejects.toThrow(/not ready to share/)
  })
})

describe('audioOverviews.unpublishOverview', () => {
  test('[P0] rejects callers who do not own the overview', async () => {
    const t = convexTest(schema, modules)
    const { asUser: asA, overviewId } = await createReadyOverview(t, USER_A)
    await asA.mutation(api.audioOverviews.publishOverview, { id: overviewId })
    const asB = t.withIdentity(USER_B)
    await expect(asB.mutation(api.audioOverviews.unpublishOverview, { id: overviewId })).rejects.toThrow(/not found/)
  })

  test('[P0] clears shareToken and publishedAt for owner', async () => {
    const t = convexTest(schema, modules)
    const { asUser, overviewId } = await createReadyOverview(t, USER_A)
    await asUser.mutation(api.audioOverviews.publishOverview, { id: overviewId })
    await asUser.mutation(api.audioOverviews.unpublishOverview, { id: overviewId })
    const row = await t.run(async (ctx) => ctx.db.get(overviewId))
    expect(row?.shareToken).toBeUndefined()
    expect(row?.publishedAt).toBeUndefined()
  })
})

describe('audioOverviews.getByShareToken', () => {
  test('[P0] returns null on unknown token', async () => {
    const t = convexTest(schema, modules)
    const result = await t.query(api.audioOverviews.getByShareToken, { token: 'deadbeefdeadbeefdeadbeefdeadbeef' })
    expect(result).toBeNull()
  })

  test('[P0] returns null on tokens that fail the strict regex', async () => {
    const t = convexTest(schema, modules)
    expect(await t.query(api.audioOverviews.getByShareToken, { token: '' })).toBeNull()
    expect(await t.query(api.audioOverviews.getByShareToken, { token: 'abc' })).toBeNull()
    expect(await t.query(api.audioOverviews.getByShareToken, { token: 'A'.repeat(32) })).toBeNull()
    expect(await t.query(api.audioOverviews.getByShareToken, { token: '0'.repeat(33) })).toBeNull()
    expect(await t.query(api.audioOverviews.getByShareToken, { token: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' })).toBeNull()
  })

  test('[P0] returns the overview projection without auth given a valid token', async () => {
    const t = convexTest(schema, modules)
    const { asUser, overviewId } = await createReadyOverview(t, USER_A)
    const { token } = await asUser.mutation(api.audioOverviews.publishOverview, { id: overviewId })

    const result = await t.query(api.audioOverviews.getByShareToken, { token })
    expect(result).not.toBeNull()
    expect(result?.title).toBe('Photosynthesis — a conversation')
    expect(result?.turns.length).toBe(3)
    expect(result?.voiceProfile).toEqual(VOICE)
    expect(result?.totalDurationMs).toBeGreaterThan(0)
  })

  test('[P0] projection does NOT leak userId / folderId / taskId / model', async () => {
    const t = convexTest(schema, modules)
    const { asUser, overviewId } = await createReadyOverview(t, USER_A)
    const { token } = await asUser.mutation(api.audioOverviews.publishOverview, { id: overviewId })

    const result = await t.query(api.audioOverviews.getByShareToken, { token }) as Record<string, unknown> | null
    expect(result).not.toBeNull()
    expect(result).not.toHaveProperty('userId')
    expect(result).not.toHaveProperty('folderId')
    expect(result).not.toHaveProperty('taskId')
    expect(result).not.toHaveProperty('model')
    expect(result).not.toHaveProperty('_id')
    expect((result as { turns: Array<Record<string, unknown>> } | null)?.turns[0])
      .not.toHaveProperty('audioFileId')
  })

  test('[P0] projection includes sourceFilenames derived from sourceDocumentIds', async () => {
    const t = convexTest(schema, modules)
    const { asUser, overviewId } = await createReadyOverview(t, USER_A)
    const { token } = await asUser.mutation(api.audioOverviews.publishOverview, { id: overviewId })

    const result = await t.query(api.audioOverviews.getByShareToken, { token })
    expect(result).not.toBeNull()
    expect(Array.isArray(result!.sourceFilenames)).toBe(true)
  })

  test('[P0] stops returning the overview after unshare', async () => {
    const t = convexTest(schema, modules)
    const { asUser, overviewId } = await createReadyOverview(t, USER_A)
    const { token } = await asUser.mutation(api.audioOverviews.publishOverview, { id: overviewId })
    await asUser.mutation(api.audioOverviews.unpublishOverview, { id: overviewId })

    const result = await t.query(api.audioOverviews.getByShareToken, { token })
    expect(result).toBeNull()
  })
})

describe('audioOverviews.getCourseScopedOverview', () => {
  test('[P0] returns overview with turnUrls and sourceFilenames for owner', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Bio' })
    const turns = await sampleTurns(t)
    const { overviewId } = await createWithTurns(t, asUser, {
      folderId,
      title: 'Primer',
      turns,
      voiceProfile: VOICE,
      courseScoped: true,
    })

    const result = await asUser.query(api.audioOverviews.getCourseScopedOverview, { id: overviewId })
    expect(result).not.toBeNull()
    expect(result!.title).toBe('Primer')
    expect(result!.turns).toHaveLength(3)
    expect(result!.turnUrls).toHaveLength(3)
    for (const url of result!.turnUrls) expect(typeof url).toBe('string')
    expect(Array.isArray(result!.sourceFilenames)).toBe(true)
  })

  test('[P0] returns null for other users', async () => {
    const t = convexTest(schema, modules)
    const asA = t.withIdentity(USER_A)
    const asB = t.withIdentity(USER_B)
    const folderId = await asA.mutation(api.folders.createFolder, { name: 'Bio' })
    const turns = await sampleTurns(t)
    const { overviewId } = await createWithTurns(t, asA, {
      folderId,
      title: 'Private',
      turns,
      voiceProfile: VOICE,
      courseScoped: true,
    })

    expect(await asB.query(api.audioOverviews.getCourseScopedOverview, { id: overviewId })).toBeNull()
  })
})

describe('audioOverviews.getTurnUrlsByShareToken', () => {
  test('[P0] returns null for tokens failing the strict regex or without a matching overview', async () => {
    const t = convexTest(schema, modules)
    expect(await t.query(api.audioOverviews.getTurnUrlsByShareToken, { token: 'short' })).toBeNull()
    expect(await t.query(api.audioOverviews.getTurnUrlsByShareToken, { token: 'A'.repeat(32) })).toBeNull()
    expect(await t.query(api.audioOverviews.getTurnUrlsByShareToken, { token: 'a'.repeat(32) })).toBeNull()
  })

  test('[P0] returns an array of URLs (or nulls) for a valid token without auth', async () => {
    const t = convexTest(schema, modules)
    const { asUser, overviewId } = await createReadyOverview(t, USER_A)
    const { token } = await asUser.mutation(api.audioOverviews.publishOverview, { id: overviewId })

    const urls = await t.query(api.audioOverviews.getTurnUrlsByShareToken, { token })
    expect(Array.isArray(urls)).toBe(true)
    expect(urls?.length).toBe(3)
  })
})
