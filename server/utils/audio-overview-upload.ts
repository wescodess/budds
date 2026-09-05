import type { ConvexHttpClient } from 'convex/browser'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer)
  return Array.from(
    new Uint8Array(digest),
    byte => byte.toString(16).padStart(2, '0'),
  ).join('')
}

function bindAudioToClaim(bytes: Uint8Array, nonce: string): Uint8Array {
  const marker = new TextEncoder().encode(`\nBUDDS_UPLOAD_CLAIM:${nonce}\n`)
  const bound = new Uint8Array(bytes.byteLength + marker.byteLength)
  bound.set(bytes)
  bound.set(marker, bytes.byteLength)
  return bound
}

export async function uploadAudioOverviewBytes(
  client: ConvexHttpClient,
  taskId: Id<'tasks'>,
  bytes: Uint8Array,
  activeClaimIds: Array<Id<'audioOverviewUploadClaims'>>,
): Promise<{
    audioFileId: Id<'_storage'>
    uploadClaimId: Id<'audioOverviewUploadClaims'>
  }> {
  const { claimId, nonce } = await client.mutation(api.audioOverviewUploads.prepare, { taskId })
  activeClaimIds.push(claimId)
  const boundBytes = bindAudioToClaim(bytes, nonce)
  const { uploadUrl } = await client.mutation(api.audioOverviewUploads.begin, {
    claimId,
    expectedSha256: await sha256Hex(boundBytes),
    expectedSize: boundBytes.byteLength,
  })

  const response = await fetch(uploadUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'audio/mpeg' },
    body: Uint8Array.from(boundBytes).buffer,
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw createError({
      statusCode: 502,
      message: `Failed to upload audio: ${response.status} ${detail || response.statusText}`,
    })
  }

  const result = await response.json() as { storageId?: string }
  if (!result.storageId) {
    throw createError({ statusCode: 502, message: 'Upload returned no storageId' })
  }

  const audioFileId = result.storageId as Id<'_storage'>
  let completionError: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await client.action(api.audioOverviewUploadActions.completeVerified, {
        claimId,
        storageId: audioFileId,
      })
      completionError = undefined
      break
    }
    catch (error) {
      completionError = error
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)))
    }
  }
  if (completionError) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await client.action(api.audioOverviewUploadActions.abortVerified, {
          claimId,
          storageId: audioFileId,
        })
        const claimIndex = activeClaimIds.indexOf(claimId)
        if (claimIndex >= 0) activeClaimIds.splice(claimIndex, 1)
        break
      }
      catch {
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)))
      }
    }
    throw completionError
  }
  return { audioFileId, uploadClaimId: claimId }
}
