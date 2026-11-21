import { getAudioOverviewWorkerToken } from '../../../../utils/audio-overview-interjection-worker'
import { teachingDeliveryValue, needsTeachingDelivery } from '../../../../utils/teaching-delivery'
import { ConvexHttpClient } from 'convex/browser'
import { makeConvexClient } from '../../../../utils/convex-client'
import { api } from '../../../../../convex/_generated/api'
import { privateAudioResponse } from '../../../../utils/audio-overview-media'
import { readConfiguredRuntimeValue } from '../../../../utils/runtime-config'

export default defineEventHandler(async (event) => {
  const token = getRouterParam(event, 'token')?.trim()
  if (!token) throw createError({ statusCode: 404, message: 'Audio media not found' })
  const config = useRuntimeConfig(event)
  const convexUrl = readConfiguredRuntimeValue(config.public?.convex?.url, 'NUXT_PUBLIC_CONVEX_URL', 'CONVEX_URL')
  if (!convexUrl) throw createError({ statusCode: 503, message: 'Audio media is unavailable' })
  const client = makeConvexClient(event) ?? new ConvexHttpClient(convexUrl)
  const input = { ...{ token }, idempotencyKey: `audio_media_${crypto.randomUUID()}` }
  const media = needsTeachingDelivery()
    ? teachingDeliveryValue(await client.mutation(api.audioOverviewV2.resolveMediaByShareTokenPreparation, input))
    : await client.query(api.audioOverviewV2.resolveMediaByShareToken, { token })
  if (!media) throw createError({ statusCode: 404, message: 'Audio media not found' })
  return await privateAudioResponse(event, media, async () => {
    if (!needsTeachingDelivery()) return
    if (!teachingDeliveryValue(await client.mutation(api.audioOverviewV2.resolveMediaByShareTokenDelivery, { ...input, orchestrationToken: getAudioOverviewWorkerToken(event) }))) {
      throw createError({ statusCode: 409, message: 'Audio media is unavailable' })
    }
  })
})
