/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test, vi } from 'vitest'
import { api } from './_generated/api'
import { readBlobTail } from './audioOverviewUploadActions'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')

const USER_A = { tokenIdentifier: 'https://auth.example.com|upload_a', name: 'Alice' }
const USER_B = { tokenIdentifier: 'https://auth.example.com|upload_b', name: 'Bob' }
const BYTES = new Uint8Array([0xff, 0xfb, 0x90, 0x00])

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

function bindAudio(bytes: Uint8Array, nonce: string): Uint8Array {
  const marker = new TextEncoder().encode(`\nBUDDS_UPLOAD_CLAIM:${nonce}\n`)
  const bound = new Uint8Array(bytes.byteLength + marker.byteLength)
  bound.set(bytes)
  bound.set(marker, bytes.byteLength)
  return bound
}

async function beginClaim(
  asUser: ReturnType<ReturnType<typeof convexTest>['withIdentity']>,
  taskId: any,
  bytes = BYTES,
) {
  const { claimId, nonce } = await asUser.mutation(api.audioOverviewUploads.prepare, { taskId })
  const boundBytes = bindAudio(bytes, nonce)
  await asUser.mutation(api.audioOverviewUploads.begin, {
    claimId,
    expectedSha256: await sha256Hex(boundBytes),
    expectedSize: boundBytes.byteLength,
  })
  return { claimId, nonce, boundBytes }
}

async function runningAudioTask(
  t: ReturnType<typeof convexTest>,
  asUser: ReturnType<ReturnType<typeof convexTest>['withIdentity']>,
) {
  await asUser.mutation(api.users.upsertUser, {})
  const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Audio uploads' })
  await t.run(async (ctx) => {
    const folder = await ctx.db.get(folderId)
    await ctx.db.insert('documents', {
      userId: folder!.userId,
      folderId,
      filename: 'ready.txt',
      status: 'success',
      fileSize: 5,
    })
  })
  const { taskId } = await asUser.mutation(api.tasks.requestAudioOverview, {
    folderId,
    scope: { mode: 'folder' },
    preferences: { lengthMinutes: 5, complexity: 'beginner' },
    voiceProfile: { hostA: 'asteria', hostB: 'orion' },
  })
  await asUser.mutation(api.tasks.claimAudioOverviewGeneration, { taskId })
  return taskId
}

describe('audioOverviewUploads', () => {
  test('[P2] upload proof verification reads only the nonce suffix', async () => {
    const suffix = new Uint8Array([7, 8, 9])
    const slicedArrayBuffer = vi.fn(async () => suffix.buffer)
    const wholeArrayBuffer = vi.fn(async () => { throw new Error('whole blob read') })
    const slice = vi.fn(() => ({ arrayBuffer: slicedArrayBuffer }))
    const blob = { arrayBuffer: wholeArrayBuffer, slice } as unknown as Blob

    await expect(readBlobTail(blob, suffix.byteLength)).resolves.toEqual(suffix)
    expect(slice).toHaveBeenCalledWith(-suffix.byteLength)
    expect(slicedArrayBuffer).toHaveBeenCalledOnce()
    expect(wholeArrayBuffer).not.toHaveBeenCalled()
  })

  test('[P1] upload claims remain valid longer than the one-hour upload URL window', async () => {
    const t = convexTest(schema, modules)
    const asA = t.withIdentity(USER_A)
    const taskId = await runningAudioTask(t, asA)
    const before = Date.now()
    const { claimId } = await asA.mutation(api.audioOverviewUploads.prepare, { taskId })
    const claim = await t.run(ctx => ctx.db.get(claimId))

    expect(claim!.expiresAt - before).toBeGreaterThan(60 * 60 * 1000)
  })

  test('[P0] rejects unauthenticated upload claims', async () => {
    const t = convexTest(schema, modules)
    const asA = t.withIdentity(USER_A)
    const taskId = await runningAudioTask(t, asA)
    await expect(t.mutation(api.audioOverviewUploads.prepare, { taskId })).rejects.toThrow(/Unauthenticated/)
  })

  test('[P0] refuses to attach a blob that existed before the owned claim', async () => {
    const t = convexTest(schema, modules)
    const asA = t.withIdentity(USER_A)
    const taskId = await runningAudioTask(t, asA)
    const storageId = await t.run(ctx => ctx.storage.store(new Blob([BYTES], { type: 'audio/mpeg' })))
    const { claimId } = await asA.mutation(api.audioOverviewUploads.prepare, { taskId })
    await asA.mutation(api.audioOverviewUploads.begin, {
      claimId,
      expectedSha256: await sha256Hex(BYTES),
      expectedSize: BYTES.byteLength,
    })

    await expect(asA.action(api.audioOverviewUploadActions.completeVerified, {
      claimId,
      storageId,
    })).rejects.toThrow(/not bound to this upload claim/i)
    expect(await t.run(ctx => ctx.storage.getUrl(storageId))).not.toBeNull()
  })

  test('[P1] requires a quota-backed running task and bounds task audio bytes', async () => {
    const t = convexTest(schema, modules)
    const asA = t.withIdentity(USER_A)
    const taskId = await runningAudioTask(t, asA)
    const first = await asA.mutation(api.audioOverviewUploads.prepare, { taskId })
    await asA.mutation(api.audioOverviewUploads.begin, {
      claimId: first.claimId,
      expectedSha256: '00'.repeat(32),
      expectedSize: 40 * 1024 * 1024,
    })
    const second = await asA.mutation(api.audioOverviewUploads.prepare, { taskId })
    await expect(asA.mutation(api.audioOverviewUploads.begin, {
      claimId: second.claimId,
      expectedSha256: '11'.repeat(32),
      expectedSize: 40 * 1024 * 1024,
    })).rejects.toThrow(/byte limit/i)

    await expect(asA.mutation(api.audioOverviewUploads.discard, {
      claimIds: Array.from({ length: 51 }, () => second.claimId),
    })).rejects.toThrow(/too many/i)
  })

  test('[P0] owner can clean a verified upload while a foreign caller cannot', async () => {
    const t = convexTest(schema, modules)
    const asA = t.withIdentity(USER_A)
    const asB = t.withIdentity(USER_B)
    const taskId = await runningAudioTask(t, asA)
    const { claimId, boundBytes } = await beginClaim(asA, taskId)
    const storageId = await t.run(ctx => ctx.storage.store(new Blob([Uint8Array.from(boundBytes).buffer], { type: 'audio/mpeg' })))
    await asA.action(api.audioOverviewUploadActions.completeVerified, { claimId, storageId })

    await expect(asB.mutation(api.audioOverviewUploads.discard, {
      claimIds: [claimId],
    })).rejects.toThrow(/Upload claim not found/)
    expect(await t.run(ctx => ctx.storage.getUrl(storageId))).not.toBeNull()

    const result = await asA.mutation(api.audioOverviewUploads.discard, {
      claimIds: [claimId],
    })
    expect(result.deletedBlobs).toBe(1)
    expect(await t.run(ctx => ctx.storage.getUrl(storageId))).toBeNull()
  })

  test('[P1] verified abort durably removes an uploaded blob after completion failure', async () => {
    const t = convexTest(schema, modules)
    const asA = t.withIdentity(USER_A)
    const taskId = await runningAudioTask(t, asA)
    const { claimId, boundBytes } = await beginClaim(asA, taskId)
    const storageId = await t.run(ctx => ctx.storage.store(
      new Blob([Uint8Array.from(boundBytes).buffer], { type: 'audio/mpeg' }),
    ))

    await asA.action(api.audioOverviewUploadActions.abortVerified, { claimId, storageId })

    expect(await t.run(ctx => ctx.storage.getUrl(storageId))).toBeNull()
    expect(await t.run(ctx => ctx.db.get(claimId))).toBeNull()
  })

  test('[P1] proof-bound abort remains available after claim expiry', async () => {
    const t = convexTest(schema, modules)
    const asA = t.withIdentity(USER_A)
    const taskId = await runningAudioTask(t, asA)
    const { claimId, boundBytes } = await beginClaim(asA, taskId)
    const storageId = await t.run(ctx => ctx.storage.store(
      new Blob([Uint8Array.from(boundBytes).buffer], { type: 'audio/mpeg' }),
    ))
    await t.run(ctx => ctx.db.patch(claimId, { expiresAt: Date.now() - 1 }))

    await asA.action(api.audioOverviewUploadActions.abortVerified, { claimId, storageId })

    expect(await t.run(ctx => ctx.storage.getUrl(storageId))).toBeNull()
    expect(await t.run(ctx => ctx.db.get(claimId))).toBeNull()
  })

  test('[P0] rejects content whose checksum or size differs from the claim', async () => {
    const t = convexTest(schema, modules)
    const asA = t.withIdentity(USER_A)
    const taskId = await runningAudioTask(t, asA)
    const { claimId, nonce } = await asA.mutation(api.audioOverviewUploads.prepare, { taskId })
    const boundBytes = bindAudio(BYTES, nonce)
    await asA.mutation(api.audioOverviewUploads.begin, {
      claimId,
      expectedSha256: await sha256Hex(boundBytes),
      expectedSize: boundBytes.byteLength + 1,
    })
    const storageId = await t.run(ctx => ctx.storage.store(new Blob([Uint8Array.from(boundBytes).buffer], { type: 'audio/mpeg' })))

    await expect(asA.action(api.audioOverviewUploadActions.completeVerified, {
      claimId,
      storageId,
    })).rejects.toThrow(/does not match upload claim/i)

    await asA.action(api.audioOverviewUploadActions.abortVerified, { claimId, storageId })
    expect(await t.run(ctx => ctx.storage.getUrl(storageId))).toBeNull()
  })

  test('[P0] same source bytes are claim-bound and cannot cross tenant ownership', async () => {
    const t = convexTest(schema, modules)
    const asA = t.withIdentity(USER_A)
    const asB = t.withIdentity(USER_B)
    const taskA = await runningAudioTask(t, asA)
    const taskB = await runningAudioTask(t, asB)
    const claimA = await beginClaim(asA, taskA)
    const claimB = await beginClaim(asB, taskB)
    expect(claimA.boundBytes).not.toEqual(claimB.boundBytes)

    const storageA = await t.run(ctx => ctx.storage.store(new Blob([Uint8Array.from(claimA.boundBytes).buffer], { type: 'audio/mpeg' })))
    await asA.action(api.audioOverviewUploadActions.completeVerified, { claimId: claimA.claimId, storageId: storageA })
    await expect(asB.action(api.audioOverviewUploadActions.completeVerified, {
      claimId: claimB.claimId,
      storageId: storageA,
    })).rejects.toThrow(/does not match upload claim/i)
  })

  test('[P0] one storage blob cannot be attached to duplicate claims', async () => {
    const t = convexTest(schema, modules)
    const asA = t.withIdentity(USER_A)
    const taskId = await runningAudioTask(t, asA)
    const first = await beginClaim(asA, taskId)
    const { claimId: duplicateId } = await asA.mutation(api.audioOverviewUploads.prepare, { taskId })
    await asA.mutation(api.audioOverviewUploads.begin, {
      claimId: duplicateId,
      expectedSha256: await sha256Hex(first.boundBytes),
      expectedSize: first.boundBytes.byteLength,
    })
    const storageId = await t.run(ctx => ctx.storage.store(new Blob([Uint8Array.from(first.boundBytes).buffer], { type: 'audio/mpeg' })))
    await asA.action(api.audioOverviewUploadActions.completeVerified, { claimId: first.claimId, storageId })
    await expect(asA.action(api.audioOverviewUploadActions.completeVerified, {
      claimId: duplicateId,
      storageId,
    })).rejects.toThrow(/already claimed/i)
  })
})
