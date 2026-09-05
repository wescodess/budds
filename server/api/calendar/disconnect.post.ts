import { api } from '../../../convex/_generated/api'
import { makeConvexClient } from '../../utils/convex-client'
import { requireRateLimit } from '../../utils/rate-limit'

export default defineEventHandler(async (event) => {
  await requireRateLimit(event, 3, 'calendar.disconnect')
  getConvexTokenIdentifier(event)

  const convexClient = makeConvexClient(event)
  if (!convexClient) {
    throw createError({ statusCode: 401, message: 'Authentication required' })
  }

  try {
    const connection = await convexClient.query(api.calendarConnections.getByUser, {})
    if (!connection) {
      return { disconnected: false, googleEventsDeleted: 0, googleEventsFailed: 0 }
    }
    return await convexClient.action(api.calendarEvents.disconnectCalendar, {})
  }
  catch (error) {
    console.error('[calendar/disconnect] Server-side disconnect failed:', error)
    throw createError({ statusCode: 502, message: 'Calendar disconnect failed; please retry' })
  }
})
