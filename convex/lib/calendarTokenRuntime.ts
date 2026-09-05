import type { ActionCtx } from '../_generated/server'
import type { Doc } from '../_generated/dataModel'
import { internal } from '../_generated/api'
import {
  decryptLegacyOrEncryptedCalendarToken,
  encryptCalendarToken,
} from '../../shared/calendar-token-encryption'

function getEncryptionKey(): string {
  const key = process.env.CALENDAR_TOKEN_ENCRYPTION_KEY
  if (!key) throw new Error('Calendar token encryption is not configured')
  return key
}

async function refreshGoogleToken(refreshToken: string): Promise<{ accessToken: string; expiresAt: number }> {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new Error('Google OAuth is not configured')

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  if (!response.ok) throw new Error(`Google token refresh failed with status ${response.status}`)
  const data = await response.json() as { access_token?: string; expires_in?: number }
  if (!data.access_token || !data.expires_in) throw new Error('Google token refresh returned an invalid response')
  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  }
}

export async function getCalendarAccessToken(
  ctx: ActionCtx,
  userId: string,
  connection: Doc<'calendarConnections'>,
): Promise<string> {
  const key = getEncryptionKey()
  const access = await decryptLegacyOrEncryptedCalendarToken(connection.accessToken, key)
  const refresh = connection.refreshToken
    ? await decryptLegacyOrEncryptedCalendarToken(connection.refreshToken, key)
    : null

  let accessToken = access.plaintext
  let expiresAt = connection.expiresAt
  if (expiresAt < Date.now() + 60_000) {
    if (!refresh?.plaintext) throw new Error('Calendar refresh token is unavailable; reconnect Google Calendar')
    const refreshed = await refreshGoogleToken(refresh.plaintext)
    accessToken = refreshed.accessToken
    expiresAt = refreshed.expiresAt
  }

  if (access.legacy || refresh?.legacy || accessToken !== access.plaintext) {
    await ctx.runMutation(internal.calendarConnections.updateTokens, {
      userId,
      calendarConnectionId: connection._id,
      expectedStatus: connection.status === 'disconnecting' ? 'disconnecting' : 'connected',
      accessToken: await encryptCalendarToken(accessToken, key),
      refreshToken: refresh?.plaintext
        ? await encryptCalendarToken(refresh.plaintext, key)
        : undefined,
      expiresAt,
    })
  }

  return accessToken
}
