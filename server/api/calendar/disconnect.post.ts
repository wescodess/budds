import { api } from '../../../convex/_generated/api'
import { refreshGoogleAccessToken } from '../../utils/calendar-tokens'
import { deleteGoogleCalendarEvent } from '../../utils/google-calendar'
import { makeConvexClient } from '../../utils/convex-client'
import { requireRateLimit } from '../../utils/rate-limit'

export default defineEventHandler(async (event) => {
  requireRateLimit(event, 3)
  getConvexTokenIdentifier(event)

  const convexClient = makeConvexClient(event)
  if (!convexClient) {
    throw createError({ statusCode: 401, message: 'Authentication required' })
  }

  const connection = await convexClient.query(api.calendarConnections.getByUser, {})
  if (!connection || connection.status !== 'connected') {
    throw createError({ statusCode: 400, message: 'No active calendar connection' })
  }

  let tokens = await convexClient.query(api.calendarConnections.getMyTokens, {})
  if (!tokens) {
    throw createError({ statusCode: 400, message: 'Calendar tokens not available' })
  }

  if (tokens.expiresAt < Date.now() + 60_000) {
    const refreshed = await refreshGoogleAccessToken(tokens.refreshToken)
    if (refreshed) {
      await convexClient.mutation(api.calendarConnections.refreshMyTokens, {
        accessToken: refreshed.accessToken,
        expiresAt: refreshed.expiresAt,
      })
      tokens = { ...tokens, accessToken: refreshed.accessToken, expiresAt: refreshed.expiresAt }
    }
  }

  const events = await convexClient.query(api.calendarEvents.listByUser, {})

  let deletedFromGoogle = 0
  let failedFromGoogle = 0

  for (const calEvent of events) {
    if (!calEvent.calendarEventId) continue
    try {
      await deleteGoogleCalendarEvent(tokens.accessToken, calEvent.calendarEventId)
      deletedFromGoogle++
    } catch (err) {
      console.error(`[calendar/disconnect] Failed to delete Google event ${calEvent.calendarEventId}:`, err)
      failedFromGoogle++
    }
  }

  await convexClient.mutation(api.calendarConnections.disconnect, {})

  return {
    disconnected: true,
    googleEventsDeleted: deletedFromGoogle,
    googleEventsFailed: failedFromGoogle,
  }
})
