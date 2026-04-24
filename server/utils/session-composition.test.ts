import { describe, expect, test } from 'vitest'
import {
  determineSessionType,
  buildEventTitle,
  buildEventDescription,
  getScheduledHourInTimezone,
} from './session-composition'

describe('determineSessionType', () => {
  test('commute-length slots (<=15 min) return audio-only regardless of time', () => {
    expect(determineSessionType({
      scheduledHour: 9,
      slotMinutes: 15,
      hasDueReviews: true,
      hasNewContent: true,
    })).toBe('audio-only')

    expect(determineSessionType({
      scheduledHour: 20,
      slotMinutes: 10,
      hasDueReviews: false,
      hasNewContent: true,
    })).toBe('audio-only')

    expect(determineSessionType({
      scheduledHour: 14,
      slotMinutes: 5,
      hasDueReviews: true,
      hasNewContent: false,
    })).toBe('audio-only')
  })

  test('morning events (before 12:00) favor new content', () => {
    expect(determineSessionType({
      scheduledHour: 8,
      slotMinutes: 25,
      hasDueReviews: true,
      hasNewContent: true,
    })).toBe('new-content')
  })

  test('morning events fall back to review when no new content', () => {
    expect(determineSessionType({
      scheduledHour: 10,
      slotMinutes: 25,
      hasDueReviews: true,
      hasNewContent: false,
    })).toBe('review')
  })

  test('morning events return new-content when no reviews and no new content', () => {
    expect(determineSessionType({
      scheduledHour: 11,
      slotMinutes: 25,
      hasDueReviews: false,
      hasNewContent: false,
    })).toBe('new-content')
  })

  test('evening events (12:00+) favor review', () => {
    expect(determineSessionType({
      scheduledHour: 18,
      slotMinutes: 25,
      hasDueReviews: true,
      hasNewContent: true,
    })).toBe('review')
  })

  test('evening events fall back to new-content when no reviews', () => {
    expect(determineSessionType({
      scheduledHour: 14,
      slotMinutes: 25,
      hasDueReviews: false,
      hasNewContent: true,
    })).toBe('new-content')
  })

  test('evening events return review when no reviews and no new content', () => {
    expect(determineSessionType({
      scheduledHour: 20,
      slotMinutes: 25,
      hasDueReviews: false,
      hasNewContent: false,
    })).toBe('review')
  })

  test('boundary: exactly 12:00 counts as evening', () => {
    expect(determineSessionType({
      scheduledHour: 12,
      slotMinutes: 25,
      hasDueReviews: true,
      hasNewContent: true,
    })).toBe('review')
  })

  test('boundary: 16 minutes does not trigger audio-only', () => {
    expect(determineSessionType({
      scheduledHour: 9,
      slotMinutes: 16,
      hasDueReviews: true,
      hasNewContent: true,
    })).toBe('new-content')
  })
})

describe('buildEventTitle', () => {
  test('builds correct title for new-content', () => {
    expect(buildEventTitle('Organic Chemistry', 'new-content'))
      .toBe('[Budds] Organic Chemistry - New Content')
  })

  test('builds correct title for review', () => {
    expect(buildEventTitle('React Hooks', 'review'))
      .toBe('[Budds] React Hooks - Review')
  })

  test('builds correct title for audio-only', () => {
    expect(buildEventTitle('AWS Solutions', 'audio-only'))
      .toBe('[Budds] AWS Solutions - Audio Only')
  })
})

describe('buildEventDescription', () => {
  test('includes session type, course name, and deep link', () => {
    const desc = buildEventDescription({
      courseName: 'Organic Chemistry',
      sessionType: 'new-content',
      slotMinutes: 25,
      deepLink: 'https://app.budds.com/app/learn/abc123',
    })
    expect(desc).toContain('25 min new content session')
    expect(desc).toContain('Course: Organic Chemistry')
    expect(desc).toContain('https://app.budds.com/app/learn/abc123')
  })

  test('review session description', () => {
    const desc = buildEventDescription({
      courseName: 'React',
      sessionType: 'review',
      slotMinutes: 15,
      deepLink: '',
    })
    expect(desc).toContain('15 min review session')
    expect(desc).toContain('Course: React')
  })
})

describe('getScheduledHourInTimezone', () => {
  test('returns UTC hour for UTC timezone', () => {
    const date = new Date('2026-04-23T14:30:00Z')
    expect(getScheduledHourInTimezone(date.getTime(), 'UTC')).toBe(14)
  })

  test('returns adjusted hour for different timezone', () => {
    const date = new Date('2026-04-23T14:30:00Z')
    const hour = getScheduledHourInTimezone(date.getTime(), 'America/New_York')
    expect(hour).toBe(10)
  })

  test('handles invalid timezone gracefully', () => {
    const date = new Date('2026-04-23T14:30:00Z')
    const hour = getScheduledHourInTimezone(date.getTime(), 'Invalid/Timezone')
    expect(typeof hour).toBe('number')
  })
})
