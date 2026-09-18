import { api } from '../../../../convex/_generated/api'
import { encryptCalendarToken } from '../../../../shared/calendar-token-encryption'
import { makeConvexClient } from '../../../utils/convex-client'
import { defineLearnV2Handler } from '../../../utils/learn-v2-access'
import { parseLearnV2GoogleGrantedScopes, verifyLearnV2CalendarOAuthState } from '../../../utils/learn-v2-calendar-oauth'
import { GOOGLE_TOKEN_URL } from '../../../utils/google-constants'
import { readConfiguredRuntimeValue } from '../../../utils/runtime-config'

const STATE_COOKIE = 'learn_v2_calendar_oauth_state'
const GOOGLE_CALENDAR_SETTINGS_URL = 'https://www.googleapis.com/calendar/v3/users/me/settings/timezone'

function redirectWithError(event: Parameters<typeof sendRedirect>[0], siteUrl: string, error: string) {
  return sendRedirect(event, `${siteUrl}/app/learn/today?calendar_error=${encodeURIComponent(error)}`)
}

export default defineLearnV2Handler(async (event) => {
  const config = useRuntimeConfig(event)
  const siteUrl = config.public.siteUrl || config.siteUrl
  if (!siteUrl || process.env.LEARN_V2_CALENDAR_ENABLED !== 'true') {
    throw createError({ statusCode: 404, message: 'Not found' })
  }

  const query = getQuery(event)
  const { code, state, error } = query as Record<string, string | undefined>
  const storedState = getCookie(event, STATE_COOKIE)
  deleteCookie(event, STATE_COOKIE, { path: '/' })

  const signingKey = readConfiguredRuntimeValue(
    config.calendarTokenEncryptionKey,
    'NUXT_CALENDAR_TOKEN_ENCRYPTION_KEY',
    'CALENDAR_TOKEN_ENCRYPTION_KEY',
  )
  if (!signingKey || !verifyLearnV2CalendarOAuthState({ state, cookieValue: storedState, now: Date.now(), signingKey })) {
    return redirectWithError(event, siteUrl, 'invalid_state')
  }
  if (error) return redirectWithError(event, siteUrl, error)
  if (!code) return redirectWithError(event, siteUrl, 'no_code')

  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) return redirectWithError(event, siteUrl, 'not_configured')

  const tokenResponse = await $fetch<{
    access_token: string
    refresh_token?: string
    expires_in: number
    scope?: string
  }>(GOOGLE_TOKEN_URL, {
    method: 'POST',
    body: {
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: `${siteUrl}/api/learn-v2/calendar/callback`,
      grant_type: 'authorization_code',
    },
  }).catch((caught: unknown) => {
    console.error('[learn-v2/calendar/callback] Token exchange failed:', caught)
    return null
  })
  if (!tokenResponse?.access_token) return redirectWithError(event, siteUrl, 'token_exchange_failed')
  const grantedScopes = parseLearnV2GoogleGrantedScopes(tokenResponse.scope)
  if (!grantedScopes) return redirectWithError(event, siteUrl, 'insufficient_scope')

  let timezone = 'UTC'
  try {
    const timezoneResult = await $fetch<{ value?: string }>(GOOGLE_CALENDAR_SETTINGS_URL, {
      headers: { Authorization: `Bearer ${tokenResponse.access_token}` },
    })
    if (timezoneResult.value) timezone = timezoneResult.value
  }
  catch (caught) {
    console.error('[learn-v2/calendar/callback] Timezone detection failed; defaulting to UTC:', caught)
  }

  const convexClient = makeConvexClient(event)
  if (!convexClient) return redirectWithError(event, siteUrl, 'auth_required')

  try {
    await convexClient.mutation(api.calendarConnections.upsertConnection, {
      provider: 'google',
      accessToken: await encryptCalendarToken(tokenResponse.access_token, signingKey),
      refreshToken: tokenResponse.refresh_token
        ? await encryptCalendarToken(tokenResponse.refresh_token, signingKey)
        : undefined,
      expiresAt: Date.now() + tokenResponse.expires_in * 1000,
      timezone,
      grantedScopes,
      learnV2ConsentVersion: 1,
    })
  }
  catch (caught) {
    console.error('[learn-v2/calendar/callback] Failed to store connection:', caught)
    return redirectWithError(event, siteUrl, 'storage_failed')
  }

  return sendRedirect(event, `${siteUrl}/app/learn/today?calendar_connected=true`)
})
