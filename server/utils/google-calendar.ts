const GOOGLE_CALENDAR_EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'

export interface GoogleCalendarEvent {
  id: string
  htmlLink: string
}

export interface CreateEventParams {
  accessToken: string
  title: string
  description: string
  startTime: Date
  endTime: Date
  timezone: string
}

export async function createGoogleCalendarEvent(params: CreateEventParams): Promise<GoogleCalendarEvent> {
  const rawToken = Buffer.from(params.accessToken, 'base64').toString('utf-8')

  const body = {
    summary: params.title,
    description: params.description,
    start: {
      dateTime: params.startTime.toISOString(),
      timeZone: params.timezone,
    },
    end: {
      dateTime: params.endTime.toISOString(),
      timeZone: params.timezone,
    },
    reminders: {
      useDefault: false,
      overrides: [{ method: 'popup', minutes: 5 }],
    },
  }

  const response = await $fetch<GoogleCalendarEvent>(GOOGLE_CALENDAR_EVENTS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${rawToken}`,
      'Content-Type': 'application/json',
    },
    body,
  })

  return response
}

export async function deleteGoogleCalendarEvent(accessToken: string, eventId: string): Promise<void> {
  const rawToken = Buffer.from(accessToken, 'base64').toString('utf-8')

  await $fetch(`${GOOGLE_CALENDAR_EVENTS_URL}/${eventId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${rawToken}`,
    },
  }).catch((err) => {
    if (err?.response?.status !== 410) throw err
  })
}
