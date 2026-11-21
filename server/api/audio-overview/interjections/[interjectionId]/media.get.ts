import { getAudioOverviewWorkerToken } from '../../../../utils/audio-overview-interjection-worker'
import { teachingDeliveryValue, needsTeachingDelivery } from '../../../../utils/teaching-delivery'
import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'
import { makeConvexClient } from '../../../../utils/convex-client'
import { privateAudioResponse } from '../../../../utils/audio-overview-media'

export default defineEventHandler(async (event) => {
  const interjectionId = getRouterParam(event, 'interjectionId')?.trim()
  if (!interjectionId) throw createError({ statusCode: 400, message: 'Interjection ID is required' })
  const client = makeConvexClient(event)
  if (!client) throw createError({ statusCode: 401, message: 'Authentication required' })
  const input = { ...{ interjectionId: interjectionId as Id<'audioOverviewInterjectionsV2'> }, idempotencyKey: `audio_media_${crypto.randomUUID()}` }
  const media = teachingDeliveryValue(await client.mutation(api.audioOverviewInterjectionsV2.resolveMediaForOwnerPreparation, input))
  if (!media) throw createError({ statusCode: 404, message: 'Interjection media not found' })
  return await privateAudioResponse(event, media, async () => {
    if (!needsTeachingDelivery()) return
    if (!teachingDeliveryValue(await client.mutation(api.audioOverviewInterjectionsV2.resolveMediaForOwnerDelivery, { ...input, orchestrationToken: getAudioOverviewWorkerToken(event) }))) {
      throw createError({ statusCode: 409, message: 'Audio media is unavailable' })
    }
  })
})
