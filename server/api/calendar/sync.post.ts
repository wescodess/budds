import { api } from '../../../convex/_generated/api'
import { makeConvexClient } from '../../utils/convex-client'
import { requireRateLimit } from '../../utils/rate-limit'

export default defineEventHandler(async (event) => {
  await requireRateLimit(event, 3, 'calendar.sync')
  getConvexTokenIdentifier(event)

  const convexClient = makeConvexClient(event)
  if (!convexClient) {
    throw createError({ statusCode: 401, message: 'Authentication required' })
  }

  try {
    return await convexClient.action(api.calendarEvents.syncCalendar, {})
  }
  catch (error) {
    console.error('[calendar/sync] Server-side sync failed:', error)
    throw createError({ statusCode: 502, message: 'Calendar sync failed; please retry' })
  }
})
