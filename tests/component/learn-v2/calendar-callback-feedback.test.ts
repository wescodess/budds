import { describe, expect, it } from 'vitest'
import { getLearnV2CalendarCallbackFeedback } from '~/utils/learn-v2-calendar-callback'

describe('Learn V2 calendar callback feedback', () => {
  it('maps known callback failures to a safe accessible message and preserves unrelated query values', () => {
    expect(getLearnV2CalendarCallbackFeedback({ calendar_error: 'invalid_state', keep: 'filter' })).toEqual({
      error: 'We could not verify the Google Calendar connection. Please try again.',
      cleanedQuery: { calendar_error: undefined, calendar_connected: undefined, keep: 'filter' },
    })
  })

  it('does not surface raw provider errors and acknowledges a successful connection', () => {
    expect(getLearnV2CalendarCallbackFeedback({ calendar_error: 'provider-detail-that-must-not-reach-the-ui' })).toEqual({
      error: 'Google Calendar could not be connected. Please try again.',
      cleanedQuery: { calendar_error: undefined, calendar_connected: undefined },
    })
    expect(getLearnV2CalendarCallbackFeedback({ calendar_connected: 'true', page: '2' })).toEqual({
      message: 'Google Calendar connected. You can add a future session when you choose.',
      cleanedQuery: { calendar_error: undefined, calendar_connected: undefined, page: '2' },
    })
  })

  it('does nothing when no calendar callback values are present', () => {
    expect(getLearnV2CalendarCallbackFeedback({ keep: 'filter' })).toBeNull()
  })
})
