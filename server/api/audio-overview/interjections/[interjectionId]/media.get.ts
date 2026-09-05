import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'
import { makeConvexClient } from '../../../../utils/convex-client'
import { privateAudioResponse } from '../../../../utils/audio-overview-media'

export default defineEventHandler(async (event) => {
  const interjectionId = getRouterParam(event, 'interjectionId')?.trim()
  if (!interjectionId) throw createError({ statusCode: 400, message: 'Interjection ID is required' })
  const client = makeConvexClient(event)
  if (!client) throw createError({ statusCode: 401, message: 'Authentication required' })
  const media = await client.query(api.audioOverviewInterjectionsV2.resolveMediaForOwner, {
    interjectionId: interjectionId as Id<'audioOverviewInterjectionsV2'>,
  })
  if (!media) throw createError({ statusCode: 404, message: 'Interjection media not found' })
  return await privateAudioResponse(event, media)
})
