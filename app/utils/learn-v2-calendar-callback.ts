import type { LocationQuery, LocationQueryRaw } from 'vue-router'

export type CalendarCallbackFeedback = {
  error?: string
  message?: string
  cleanedQuery: LocationQueryRaw
}

export function getLearnV2CalendarCallbackFeedback(query: LocationQuery): CalendarCallbackFeedback | null {
  const callbackError = Array.isArray(query.calendar_error) ? query.calendar_error[0] : query.calendar_error
  const connected = Array.isArray(query.calendar_connected) ? query.calendar_connected[0] : query.calendar_connected
  if (!callbackError && !connected) return null

  const cleanedQuery = { ...query, calendar_error: undefined, calendar_connected: undefined }
  if (callbackError) {
    const error = {
      invalid_state: 'We could not verify the Google Calendar connection. Please try again.',
      insufficient_scope: 'Google Calendar needs updated permission to check availability. Update access and try again.',
      access_denied: 'Google Calendar connection was cancelled. Your in-app study plan is still available.',
      no_code: 'Google Calendar did not return the authorization needed to connect. Please try again.',
      not_configured: 'Google Calendar is not configured right now. Your in-app study plan is still available.',
      token_exchange_failed: 'Google Calendar could not be connected. Please try again.',
      storage_failed: 'Google Calendar could not be saved. Please try again.',
    }[typeof callbackError === 'string' ? callbackError : ''] ?? 'Google Calendar could not be connected. Please try again.'
    return { error, cleanedQuery }
  }

  return { message: 'Google Calendar connected. You can add a future session when you choose.', cleanedQuery }
}
