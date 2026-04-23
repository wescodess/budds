import crypto from 'node:crypto'

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const SCOPES = ['https://www.googleapis.com/auth/calendar.events', 'openid']

export default defineEventHandler(async (event) => {
  getConvexTokenIdentifier(event)

  const config = useRuntimeConfig(event)
  const clientId = process.env.GOOGLE_CLIENT_ID
  const siteUrl = config.public.siteUrl || config.siteUrl

  if (!clientId || !siteUrl) {
    throw createError({
      statusCode: 500,
      message: 'Google Calendar OAuth not configured',
    })
  }

  const state = crypto.randomBytes(32).toString('hex')
  setCookie(event, 'calendar_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  })

  const redirectUri = `${siteUrl}/api/calendar/callback`
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
  })

  return sendRedirect(event, `${GOOGLE_AUTH_URL}?${params.toString()}`)
})
