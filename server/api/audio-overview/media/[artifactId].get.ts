import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'
import { makeConvexClient } from '../../../utils/convex-client'
import { privateAudioResponse } from '../../../utils/audio-overview-media'

export default defineEventHandler(async (event) => {
  const artifactId = getRouterParam(event, 'artifactId')?.trim()
  if (!artifactId) throw createError({ statusCode: 400, message: 'Audio artifact ID is required' })
  const client = makeConvexClient(event)
  if (!client) throw createError({ statusCode: 401, message: 'Authentication required' })
  const media = await client.query(api.audioOverviewV2.resolveMediaForOwner, {
    artifactId: artifactId as Id<'audioOverviewAudioArtifacts'>,
  })
  if (!media) throw createError({ statusCode: 404, message: 'Audio media not found' })
  return await privateAudioResponse(event, media)
})
