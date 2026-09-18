import crypto from 'node:crypto'

export const LEARN_V2_GOOGLE_CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events.owned',
  'https://www.googleapis.com/auth/calendar.events.freebusy',
  'openid',
] as const

export const LEARN_V2_REQUIRED_GOOGLE_CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events.owned',
  'https://www.googleapis.com/auth/calendar.events.freebusy',
] as const

const STATE_VERSION = 'v1'
const STATE_INTENT = 'learn-v2-google-calendar'
const STATE_TTL_MS = 10 * 60 * 1000

export function createLearnV2CalendarOAuthState(now: number, signingKey: string): {
  state: string
  cookieValue: string
} {
  const state = crypto.randomBytes(32).toString('hex')
  const issuedAt = String(now)
  const payload = `${STATE_VERSION}.${STATE_INTENT}.${issuedAt}.${state}`
  const signature = crypto.createHmac('sha256', signingKey).update(payload).digest('base64url')
  return { state, cookieValue: `${payload}.${signature}` }
}

export function verifyLearnV2CalendarOAuthState(input: {
  state: string | undefined
  cookieValue: string | undefined
  now: number
  signingKey: string
}): boolean {
  if (!input.state || !input.cookieValue) return false
  const [version, intent, issuedAtRaw, storedState, signature, ...extra] = input.cookieValue.split('.')
  if (version !== STATE_VERSION || intent !== STATE_INTENT || !issuedAtRaw || !storedState || !signature || extra.length > 0) return false
  if (!/^[a-f0-9]{64}$/.test(input.state) || !/^[a-f0-9]{64}$/.test(storedState) || !/^[a-zA-Z0-9_-]{43}$/.test(signature)) return false

  const issuedAt = Number(issuedAtRaw)
  if (!Number.isSafeInteger(issuedAt) || issuedAt > input.now || input.now - issuedAt > STATE_TTL_MS) return false

  const payload = `${version}.${intent}.${issuedAtRaw}.${storedState}`
  const expectedSignature = crypto.createHmac('sha256', input.signingKey).update(payload).digest('base64url')
  const signaturesMatch = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))
  const statesMatch = crypto.timingSafeEqual(Buffer.from(input.state), Buffer.from(storedState))
  return signaturesMatch && statesMatch
}

export function createLearnV2GoogleAuthorizationUrl(input: {
  clientId: string
  redirectUri: string
  state: string
}): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: 'code',
    scope: LEARN_V2_GOOGLE_CALENDAR_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state: input.state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

export function parseLearnV2GoogleGrantedScopes(scope: string | undefined): string[] | null {
  if (!scope) return null
  const granted = [...new Set(scope.split(/\s+/).filter(Boolean))]
  return LEARN_V2_REQUIRED_GOOGLE_CALENDAR_SCOPES.every(required => granted.includes(required))
    ? granted
    : null
}
