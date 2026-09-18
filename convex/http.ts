import { httpRouter } from 'convex/server'
import { httpAction } from './_generated/server'
import { internal } from './_generated/api'
import { authComponent, createAuth } from './auth'

const http = httpRouter()

authComponent.registerRoutes(http, createAuth)

// Google sends no event body. This endpoint intentionally consumes only the
// documented channel headers, records a replay-safe hint, and schedules the
// authoritative incremental pull. A lost or stale hint is therefore harmless.
http.route({
  path: '/learn-v2/calendar/webhook',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const header = (name: string) => request.headers.get(name) ?? ''
    const channelId = header('x-goog-channel-id')
    const resourceId = header('x-goog-resource-id')
    const token = header('x-goog-channel-token')
    const messageNumber = header('x-goog-message-number')
    const state = header('x-goog-resource-state')
    if (!channelId || !resourceId || !token || !messageNumber || !state) return new Response(null, { status: 401 })
    const accepted = await ctx.runMutation(internal.learnV2CalendarReconciliation.acceptWebhookHint, { channelId, resourceId, token, messageNumber, state })
    if (accepted) await ctx.scheduler.runAfter(0, internal.learnV2CalendarReconciliation.syncConnection, accepted)
    // Return 204 for stale/replayed channels so an obsolete overlapping watch
    // cannot become a retry amplifier or reveal account state.
    return new Response(null, { status: 204 })
  }),
})

export default http
