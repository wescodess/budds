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

const DAY_MAP: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }

function getTimezoneOffsetMs(timezone: string, date: Date): number {
  try {
    const utcStr = date.toLocaleString('en-US', { timeZone: 'UTC' })
    const tzStr = date.toLocaleString('en-US', { timeZone: timezone })
    return new Date(tzStr).getTime() - new Date(utcStr).getTime()
  } catch {
    return 0
  }
}

export function findNextPreferredSlot(
  now: number,
  timezone: string,
  morningStart: string,
  preferredDays: Set<number>,
): Date | null {
  const [startHour, startMinute] = morningStart.split(':').map(Number)

  for (let dayOffset = 1; dayOffset <= 14; dayOffset++) {
    const candidate = new Date(now + dayOffset * 86_400_000)

    try {
      const dayFormatter = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: timezone })
      const dayStr = dayFormatter.format(candidate).toLowerCase()
      const dayNum = DAY_MAP[dayStr]
      if (dayNum === undefined || !preferredDays.has(dayNum)) continue
    } catch {
      continue
    }

    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        timeZone: timezone,
      }).formatToParts(candidate)

      const year = parseInt(parts.find(p => p.type === 'year')!.value, 10)
      const month = parseInt(parts.find(p => p.type === 'month')!.value, 10) - 1
      const day = parseInt(parts.find(p => p.type === 'day')!.value, 10)

      const tzDate = new Date(Date.UTC(year, month, day, startHour!, startMinute!))
      const offsetMs = getTimezoneOffsetMs(timezone, tzDate)
      const slotDate = new Date(tzDate.getTime() - offsetMs)

      if (slotDate.getTime() > now) return slotDate
    } catch {
      continue
    }
  }

  return null
}

export function preferredDayNumbersFromStrings(days: string[]): Set<number> {
  return new Set(days.map(d => DAY_MAP[d] ?? -1))
}
