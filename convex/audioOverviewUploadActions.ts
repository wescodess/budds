'use node'

import { v } from 'convex/values'
import { action } from './_generated/server'
import { rejectLegacyAudioOverviewWrite } from './lib/audioOverviewLegacyBoundary'
import { requireAuth } from './lib/auth'

export async function readBlobTail(blob: Blob, byteLength: number): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(-byteLength).arrayBuffer())
}

export const completeVerified = action({
  args: {
    claimId: v.id('audioOverviewUploadClaims'),
    storageId: v.id('_storage'),
  },
  handler: async (ctx): Promise<never> => {
    await requireAuth(ctx)
    rejectLegacyAudioOverviewWrite()
  },
})

export const abortVerified = action({
  args: {
    claimId: v.id('audioOverviewUploadClaims'),
    storageId: v.id('_storage'),
  },
  handler: async (ctx): Promise<never> => {
    await requireAuth(ctx)
    rejectLegacyAudioOverviewWrite()
  },
})
