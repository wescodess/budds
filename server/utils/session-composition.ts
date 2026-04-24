export type SessionType = 'new-content' | 'review' | 'audio-only'

export interface SessionCompositionInput {
  scheduledHour: number
  slotMinutes: number
  hasDueReviews: boolean
  hasNewContent: boolean
}

export function determineSessionType(input: SessionCompositionInput): SessionType {
  if (input.slotMinutes <= 15) {
    return 'audio-only'
  }

  if (input.scheduledHour < 12) {
    return input.hasNewContent ? 'new-content' : (input.hasDueReviews ? 'review' : 'new-content')
  }

  return input.hasDueReviews ? 'review' : (input.hasNewContent ? 'new-content' : 'review')
}

export function buildEventTitle(courseName: string, sessionType: SessionType): string {
  const typeLabel = sessionType === 'new-content'
    ? 'New Content'
    : sessionType === 'review'
      ? 'Review'
      : 'Audio Only'
  return `[Budds] ${courseName} - ${typeLabel}`
}

export function buildEventDescription(opts: {
  courseName: string
  sessionType: SessionType
  slotMinutes: number
  deepLink: string
}): string {
  const lines = [
    `${opts.slotMinutes} min ${opts.sessionType === 'new-content' ? 'new content' : opts.sessionType === 'review' ? 'review' : 'audio-only'} session`,
    `Course: ${opts.courseName}`,
    '',
    opts.deepLink,
  ]
  return lines.join('\n')
}

export function getScheduledHourInTimezone(scheduledAt: number, timezone: string): number {
  try {
    const date = new Date(scheduledAt)
    const formatter = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      hour12: false,
      timeZone: timezone,
    })
    return parseInt(formatter.format(date), 10)
  } catch {
    return new Date(scheduledAt).getUTCHours()
  }
}
