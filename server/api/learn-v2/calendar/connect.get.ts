import { defineLearnV2Handler } from '../../../utils/learn-v2-access'
import {
  createLearnV2CalendarOAuthState,
  createLearnV2GoogleAuthorizationUrl,
} from '../../../utils/learn-v2-calendar-oauth'
import { readConfiguredRuntimeValue } from '../../../utils/runtime-config'

const STATE_COOKIE = 'learn_v2_calendar_oauth_state'

export default defineLearnV2Handler(async (event) => {
  if (process.env.LEARN_V2_CALENDAR_ENABLED !== 'true') {
    throw createError({ statusCode: 404, message: 'Not found' })
  }

  const config = useRuntimeConfig(event)
  const clientId = process.env.GOOGLE_CLIENT_ID
  const siteUrl = config.public.siteUrl || config.siteUrl
  const signingKey = readConfiguredRuntimeValue(
    config.calendarTokenEncryptionKey,
    'NUXT_CALENDAR_TOKEN_ENCRYPTION_KEY',
    'CALENDAR_TOKEN_ENCRYPTION_KEY',
  )

  if (!clientId || !siteUrl || !signingKey) {
    throw createError({ statusCode: 500, message: 'Google Calendar OAuth not configured' })
  }

  const { state, cookieValue } = createLearnV2CalendarOAuthState(Date.now(), signingKey)
  setCookie(event, STATE_COOKIE, cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  })

  return sendRedirect(event, createLearnV2GoogleAuthorizationUrl({
    clientId,
    redirectUri: `${siteUrl}/api/learn-v2/calendar/callback`,
    state,
  }))
})
