import { describe, expect, test } from 'vitest'
import {
  createLearnV2CalendarOAuthState,
  createLearnV2GoogleAuthorizationUrl,
  LEARN_V2_GOOGLE_CALENDAR_SCOPES,
  parseLearnV2GoogleGrantedScopes,
  verifyLearnV2CalendarOAuthState,
} from './learn-v2-calendar-oauth'

const signingKey = 'test-state-signing-key'
const now = 1_700_000_000_000

describe('Learn V2 Google Calendar OAuth state', () => {
  test('cryptographically binds a one-time state to the V2 Google intent', () => {
    const created = createLearnV2CalendarOAuthState(now, signingKey)

    expect(verifyLearnV2CalendarOAuthState({ ...created, now: now + 1, signingKey })).toBe(true)
  })

  test.each([
    ['wrong state', (value: ReturnType<typeof createLearnV2CalendarOAuthState>) => ({ ...value, state: 'a'.repeat(64) })],
    ['malformed state', (value: ReturnType<typeof createLearnV2CalendarOAuthState>) => ({ ...value, state: 'short' })],
    ['tampered intent', (value: ReturnType<typeof createLearnV2CalendarOAuthState>) => ({ ...value, cookieValue: value.cookieValue.replace('learn-v2-google-calendar', 'v1-calendar') })],
    ['stale state', (value: ReturnType<typeof createLearnV2CalendarOAuthState>) => ({ ...value, now: now + 600_001 })],
  ])('rejects %s', (_label, alter) => {
    const created = createLearnV2CalendarOAuthState(now, signingKey)
    const input = alter(created)
    expect(verifyLearnV2CalendarOAuthState({ ...input, now: input.now ?? now + 1, signingKey })).toBe(false)
  })

  test('requests only the V2 projection scopes and forces re-consent', () => {
    const url = new URL(createLearnV2GoogleAuthorizationUrl({
      clientId: 'client-id', redirectUri: 'https://budds.test/api/learn-v2/calendar/callback', state: 'state',
    }))
    expect(url.searchParams.get('scope')?.split(' ')).toEqual(LEARN_V2_GOOGLE_CALENDAR_SCOPES)
    expect(url.searchParams.get('prompt')).toBe('consent')
    expect(url.searchParams.get('access_type')).toBe('offline')
  })

  test('persists only scopes returned by Google and fails closed on partial grants', () => {
    expect(parseLearnV2GoogleGrantedScopes([
      'openid',
      'https://www.googleapis.com/auth/calendar.events.owned',
      'https://www.googleapis.com/auth/calendar.events.freebusy',
    ].join(' '))).toEqual([
      'openid',
      'https://www.googleapis.com/auth/calendar.events.owned',
      'https://www.googleapis.com/auth/calendar.events.freebusy',
    ])
    expect(parseLearnV2GoogleGrantedScopes('openid https://www.googleapis.com/auth/calendar.events.owned')).toBeNull()
  })
})
