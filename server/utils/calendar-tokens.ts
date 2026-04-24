import { GOOGLE_TOKEN_URL } from './google-constants'

export async function refreshGoogleAccessToken(refreshTokenBase64: string): Promise<{
  accessToken: string
  expiresAt: number
} | null> {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET

  if (!clientId || !clientSecret) return null

  const refreshToken = Buffer.from(refreshTokenBase64, 'base64').toString('utf-8')

  try {
    const response = await $fetch<{
      access_token: string
      expires_in: number
    }>(GOOGLE_TOKEN_URL, {
      method: 'POST',
      body: {
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      },
    })

    if (!response?.access_token) return null

    return {
      accessToken: Buffer.from(response.access_token).toString('base64'),
      expiresAt: Date.now() + response.expires_in * 1000,
    }
  } catch (err) {
    console.error('[calendar] Token refresh failed:', err)
    return null
  }
}
