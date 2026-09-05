/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test, vi } from 'vitest'
import { api } from './_generated/api'
import { readBlobTail } from './audioOverviewUploadActions'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const USER = { tokenIdentifier: 'https://auth.example.com|legacy_upload_owner', name: 'Owner' }
const DISABLED = /Legacy Audio Overview generation is disabled/i

async function setupHistoricalUpload() {
  const t = convexTest(schema, modules)
  const asUser = t.withIdentity(USER)
  const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Historical audio' })
  const taskId = await t.run(ctx => ctx.db.insert('tasks', {
    userId: USER.tokenIdentifier,
    folderId,
    type: 'audio-overview-generation',
    status: 'running',
    title: 'Historical task',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }))
  const storageId = await t.run(ctx => ctx.storage.store(
    new Blob([new Uint8Array([0xff, 0xfb, 0x90, 0x00])], { type: 'audio/mpeg' }),
  ))
  const claimId = await t.run(ctx => ctx.db.insert('audioOverviewUploadClaims', {
    userId: USER.tokenIdentifier,
    taskId,
    nonce: 'historical-claim',
    expiresAt: Number.MAX_SAFE_INTEGER,
    storageId,
  }))
  return { t, asUser, taskId, claimId, storageId }
}

describe('legacy audio overview uploads', () => {
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

  test('[P1] all public v1 upload writers reject before claim or storage mutation', async () => {
    const { t, asUser, taskId, claimId, storageId } = await setupHistoricalUpload()
    const before = await t.run(ctx => ctx.db.get(claimId))

    await expect(asUser.mutation(api.audioOverviewUploads.prepare, { taskId })).rejects.toThrow(DISABLED)
    await expect(asUser.mutation(api.audioOverviewUploads.begin, {
      claimId,
      expectedSha256: 'a'.repeat(64),
      expectedSize: 4,
    })).rejects.toThrow(DISABLED)
    await expect(asUser.mutation(api.audioOverviewUploads.discard, { claimIds: [claimId] }))
      .rejects.toThrow(DISABLED)
    await expect(asUser.action(api.audioOverviewUploadActions.completeVerified, { claimId, storageId }))
      .rejects.toThrow(DISABLED)
    await expect(asUser.action(api.audioOverviewUploadActions.abortVerified, { claimId, storageId }))
      .rejects.toThrow(DISABLED)

    expect(await t.run(ctx => ctx.db.get(claimId))).toEqual(before)
    expect(await t.run(ctx => ctx.storage.getUrl(storageId))).not.toBeNull()
  })

  test('[P1] disabled upload writers retain their authentication boundary', async () => {
    const { t, taskId, claimId, storageId } = await setupHistoricalUpload()

    await expect(t.mutation(api.audioOverviewUploads.prepare, { taskId })).rejects.toThrow(/Unauthenticated/i)
    await expect(t.action(api.audioOverviewUploadActions.completeVerified, { claimId, storageId }))
      .rejects.toThrow(/Unauthenticated/i)
  })
})
