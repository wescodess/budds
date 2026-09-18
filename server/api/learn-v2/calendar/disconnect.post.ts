import { api } from '../../../../convex/_generated/api'
import { makeConvexClient } from '../../../utils/convex-client'
import { defineLearnV2Handler } from '../../../utils/learn-v2-access'
import { requireRateLimit } from '../../../utils/rate-limit'

export default defineLearnV2Handler(async (event) => {
  if (process.env.LEARN_V2_CALENDAR_ENABLED !== 'true') {
    throw createError({ statusCode: 404, message: 'Not found' })
  }

  await requireRateLimit(event, 3, 'learn-v2.calendar.disconnect')
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
  catch (caught) {
    console.error('[learn-v2/calendar/disconnect] Server-side disconnect failed:', caught)
    throw createError({ statusCode: 502, message: 'Calendar disconnect failed; please retry' })
  }
})
