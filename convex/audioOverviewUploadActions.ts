'use node'

import { v } from 'convex/values'
import { internal } from './_generated/api'
import { action } from './_generated/server'

function hasMarker(tail: Uint8Array, marker: Uint8Array): boolean {
  return tail.byteLength === marker.byteLength
    && tail.every((byte, index) => byte === marker[index])
}

export async function readBlobTail(blob: Blob, byteLength: number): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(-byteLength).arrayBuffer())
}

export const completeVerified = action({
  args: {
    claimId: v.id('audioOverviewUploadClaims'),
    storageId: v.id('_storage'),
  },
  handler: async (ctx, args): Promise<null> => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Unauthenticated')
    const userId = identity.tokenIdentifier
    const completion: { alreadyComplete: true } | { alreadyComplete: false, nonce: string }
      = await ctx.runQuery(internal.audioOverviewUploads.getCompletionContext, { ...args, userId })
    if (completion.alreadyComplete) return null

    const marker = new TextEncoder().encode(`\nBUDDS_UPLOAD_CLAIM:${completion.nonce}\n`)
    const blob = await ctx.storage.get(args.storageId)
    if (!blob) throw new Error('Unable to verify uploaded audio')
    const tail = await readBlobTail(blob, marker.byteLength)
    if (!hasMarker(tail, marker)) throw new Error('Storage blob is not bound to this upload claim')

    await ctx.runMutation(internal.audioOverviewUploads.finalize, { ...args, userId })
    return null
  },
})

export const abortVerified = action({
  args: {
    claimId: v.id('audioOverviewUploadClaims'),
    storageId: v.id('_storage'),
  },
  handler: async (ctx, args): Promise<null> => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Unauthenticated')
    const userId = identity.tokenIdentifier
    const abortContext: { nonce: string }
      = await ctx.runQuery(internal.audioOverviewUploads.getAbortContext, { ...args, userId })

    const marker = new TextEncoder().encode(`\nBUDDS_UPLOAD_CLAIM:${abortContext.nonce}\n`)
    const blob = await ctx.storage.get(args.storageId)
    if (!blob) throw new Error('Unable to verify uploaded audio')
    const tail = await readBlobTail(blob, marker.byteLength)
    if (!hasMarker(tail, marker)) throw new Error('Storage blob is not bound to this upload claim')

    await ctx.runMutation(internal.audioOverviewUploads.reserveVerifiedAbort, { ...args, userId })
    await ctx.storage.delete(args.storageId)
    await ctx.runMutation(internal.audioOverviewUploads.finishVerifiedAbort, { ...args, userId })
    return null
  },
})
