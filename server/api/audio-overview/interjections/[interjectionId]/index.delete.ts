import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'
import { makeConvexClient } from '../../../../utils/convex-client'
import { requestInterjectionWorker } from '../../../../utils/audio-overview-interjection-worker'

export default defineEventHandler(async (event) => {
  const interjectionId = getRouterParam(event, 'interjectionId')?.trim()
  if (!interjectionId) throw createError({ statusCode: 400, message: 'Interjection ID is required' })
  const client = makeConvexClient(event)
  if (!client) throw createError({ statusCode: 401, message: 'Authentication required' })
  const id = interjectionId as Id<'audioOverviewInterjectionsV2'>
  const current = await client.query(api.audioOverviewInterjectionsV2.getForOwner, { interjectionId: id })
  if (!current) throw createError({ statusCode: 404, message: 'Interjection not found' })
  const result = await client.mutation(api.audioOverviewInterjectionsV2.cancelOrDelete, { interjectionId: id })
  if (current.status === 'reserved' || current.status === 'rendering') {
    await requestInterjectionWorker(event, 'DELETE', {
      jobId: String(current.jobId),
      interjectionId,
      idempotencyKey: current.idempotencyKey,
    }).catch(() => {})
  }
  setResponseStatus(event, result.status === 'deleting' ? 202 : 200)
  return { accepted: true, ...result }
})
