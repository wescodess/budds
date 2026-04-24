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

  const payload = await client.query(api.courseSections.getOfflineCachePayload, {
    sectionId: sectionId as Id<'courseSections'>,
  })

  return payload
})
