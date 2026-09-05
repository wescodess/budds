import { ConvexHttpClient } from 'convex/browser'
import { api } from '../../../../../convex/_generated/api'
import { privateAudioResponse } from '../../../../utils/audio-overview-media'
import { readConfiguredRuntimeValue } from '../../../../utils/runtime-config'

export default defineEventHandler(async (event) => {
  const token = getRouterParam(event, 'token')?.trim()
  if (!token) throw createError({ statusCode: 404, message: 'Audio media not found' })
  const config = useRuntimeConfig(event)
  const convexUrl = readConfiguredRuntimeValue(config.public?.convex?.url, 'NUXT_PUBLIC_CONVEX_URL', 'CONVEX_URL')
  if (!convexUrl) throw createError({ statusCode: 503, message: 'Audio media is unavailable' })
  const client = new ConvexHttpClient(convexUrl)
  const media = await client.query(api.audioOverviewV2.resolveMediaByShareToken, { token })
  if (!media) throw createError({ statusCode: 404, message: 'Audio media not found' })
  return await privateAudioResponse(event, media)
})
