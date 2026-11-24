import { teachingDeliveryValue, needsTeachingDelivery } from '../../utils/teaching-delivery'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { makeConvexClient } from '../../utils/convex-client'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const sectionId = query.sectionId as string
  if (!sectionId) {
    throw createError({ statusCode: 400, statusMessage: 'sectionId is required' })
  }

  const client = makeConvexClient(event)
  if (!client) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const payload = needsTeachingDelivery() ? teachingDeliveryValue(await client.mutation(api.courseSections.getOfflineCachePayloadDelivery, {
    sectionId: sectionId as Id<'courseSections'>, idempotencyKey: `section_cache_${crypto.randomUUID()}`,
  })) : await client.query(api.courseSections.getOfflineCachePayload, { sectionId: sectionId as Id<'courseSections'> })

  return payload
})
