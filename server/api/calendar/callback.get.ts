import { api } from '../../../convex/_generated/api'
import { makeConvexClient } from '../../utils/convex-client'
import { GOOGLE_TOKEN_URL } from '../../utils/google-constants'
const GOOGLE_CALENDAR_SETTINGS_URL = 'https://www.googleapis.com/calendar/v3/users/me/settings/timezone'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const query = getQuery(event)
  const { code, state, error } = query as Record<string, string>

  const siteUrl = config.public.siteUrl || config.siteUrl

  if (error) {
    return sendRedirect(event, `${siteUrl}/app/learn?calendar_error=${encodeURIComponent(error)}`)
  }

  const storedState = getCookie(event, 'calendar_oauth_state')
  deleteCookie(event, 'calendar_oauth_state', { path: '/' })

  if (!state || !storedState || state !== storedState) {
    return sendRedirect(event, `${siteUrl}/app/learn?calendar_error=invalid_state`)
  }

  if (!code) {
    return sendRedirect(event, `${siteUrl}/app/learn?calendar_error=no_code`)
  }

  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return sendRedirect(event, `${siteUrl}/app/learn?calendar_error=not_configured`)
  }

  const redirectUri = `${siteUrl}/api/calendar/callback`

  const tokenResponse = await $fetch<{
    access_token: string
    refresh_token?: string
    expires_in: number
    token_type: string
  }>(GOOGLE_TOKEN_URL, {
    method: 'POST',
    body: {
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    },
  }).catch((err) => {
    console.error('[calendar/callback] Token exchange failed:', err)
    return null
  })

  if (!tokenResponse || !tokenResponse.access_token) {
    return sendRedirect(event, `${siteUrl}/app/learn?calendar_error=token_exchange_failed`)
  }

  let timezone = 'UTC'
  try {
    const tzResponse = await $fetch<{ value: string }>(GOOGLE_CALENDAR_SETTINGS_URL, {
      headers: { Authorization: `Bearer ${tokenResponse.access_token}` },
    })
    if (tzResponse?.value) timezone = tzResponse.value
  } catch (err) {
    console.error('[calendar/callback] Timezone detection failed, defaulting to UTC:', err)
  }

  const convexClient = makeConvexClient(event)
  if (!convexClient) {
    return sendRedirect(event, `${siteUrl}/app/learn?calendar_error=auth_required`)
  }

  try {
    const accessTokenEncoded = Buffer.from(tokenResponse.access_token).toString('base64')
    const refreshTokenEncoded = tokenResponse.refresh_token
      ? Buffer.from(tokenResponse.refresh_token).toString('base64')
      : ''

    await convexClient.mutation(api.calendarConnections.upsertConnection, {
      provider: 'google',
      accessToken: accessTokenEncoded,
      refreshToken: refreshTokenEncoded,
      expiresAt: Date.now() + tokenResponse.expires_in * 1000,
      timezone,
    })
  } catch (err) {
    console.error('[calendar/callback] Failed to store connection:', err)
    return sendRedirect(event, `${siteUrl}/app/learn?calendar_error=storage_failed`)
  }

  return sendRedirect(event, `${siteUrl}/app/learn?calendar_connected=true`)
})
