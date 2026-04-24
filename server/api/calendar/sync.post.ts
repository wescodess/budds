import { ConvexHttpClient } from 'convex/browser'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { readConfiguredRuntimeValue } from '../../utils/runtime-config'
import { refreshGoogleAccessToken } from '../../utils/calendar-tokens'
import { createGoogleCalendarEvent } from '../../utils/google-calendar'
import {
  determineSessionType,
  buildEventTitle,
  buildEventDescription,
  getScheduledHourInTimezone,
} from '../../utils/session-composition'

const DAY_MAP: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }

function makeConvexClient(event: any): ConvexHttpClient | null {
  const token = event.context.convexToken as string | undefined
  const runtimeConfig = useRuntimeConfig(event)
  const convexUrl = readConfiguredRuntimeValue(
    runtimeConfig.public?.convex?.url,
    'NUXT_PUBLIC_CONVEX_URL',
    'CONVEX_URL',
  )
  if (!token || !convexUrl) return null
  const client = new ConvexHttpClient(convexUrl)
  client.setAuth(token)
  return client
}

export default defineEventHandler(async (event) => {
  getConvexTokenIdentifier(event)

  const convexClient = makeConvexClient(event)
  if (!convexClient) {
    throw createError({ statusCode: 401, message: 'Authentication required' })
  }

  const connection = await convexClient.query(api.calendarConnections.getByUser, {})
  if (!connection || connection.status !== 'connected') {
    throw createError({ statusCode: 400, message: 'No active calendar connection' })
  }

  if (!connection.preferences) {
    throw createError({ statusCode: 400, message: 'Calendar preferences not set' })
  }

  let tokens = await convexClient.query(api.calendarConnections.getMyTokens, {})
  if (!tokens) {
    throw createError({ statusCode: 400, message: 'Calendar tokens not available' })
  }

  if (tokens.expiresAt < Date.now() + 60_000) {
    const refreshed = await refreshGoogleAccessToken(tokens.refreshToken)
    if (!refreshed) {
      throw createError({ statusCode: 401, message: 'Failed to refresh calendar token' })
    }
    await convexClient.mutation(api.calendarConnections.refreshMyTokens, {
      accessToken: refreshed.accessToken,
      expiresAt: refreshed.expiresAt,
    })
    tokens = { ...tokens, accessToken: refreshed.accessToken, expiresAt: refreshed.expiresAt }
  }

  const courses = await convexClient.query(api.courses.listByUser, {}) as Array<{
    _id: Id<'courses'>
    title: string
    status: string
    completedSectionCount: number
    totalSectionCount: number
  }>

  const activeCourses = courses.filter(c => c.status === 'ready' && c.completedSectionCount < c.totalSectionCount)
  if (activeCourses.length === 0) {
    return { created: 0, message: 'No active courses to schedule' }
  }

  const existingEvents = await convexClient.query(api.calendarEvents.listScheduled, {})
  const existingCourseIds = new Set(existingEvents.map(e => e.courseId))

  const dueReviewItems = await convexClient.query(api.reviewItems.listDueForUser, {})
  const hasDueReviews = dueReviewItems.length > 0

  const prefs = connection.preferences
  const timezone = connection.timezone
  const now = Date.now()
  const createdEvents: Array<{ courseId: string, eventId: string, sessionType: string }> = []

  const preferredDayNumbers = new Set(prefs.preferredDays.map(d => DAY_MAP[d] ?? -1))

  const runtimeConfig = useRuntimeConfig(event)
  const siteUrl = runtimeConfig.public?.siteUrl || runtimeConfig.siteUrl || ''

  for (const course of activeCourses) {
    if (existingCourseIds.has(course._id)) continue

    const startDate = findNextPreferredSlot(now, timezone, prefs.morningStart, preferredDayNumbers)
    if (!startDate) continue

    const scheduledHour = getScheduledHourInTimezone(startDate.getTime(), timezone)

    const hasNewContent = course.completedSectionCount < course.totalSectionCount

    const sessionType = determineSessionType({
      scheduledHour,
      slotMinutes: prefs.sessionMinutes,
      hasDueReviews,
      hasNewContent,
    })

    const title = buildEventTitle(course.title, sessionType)
    const deepLink = siteUrl ? `${siteUrl}/app/learn/${course._id}` : ''
    const description = buildEventDescription({
      courseName: course.title,
      sessionType,
      slotMinutes: prefs.sessionMinutes,
      deepLink,
    })

    const endDate = new Date(startDate.getTime() + prefs.sessionMinutes * 60_000)

    try {
      const googleEvent = await createGoogleCalendarEvent({
        accessToken: tokens.accessToken,
        title,
        description,
        startTime: startDate,
        endTime: endDate,
        timezone,
      })

      await convexClient.mutation(api.calendarEvents.createEvent, {
        calendarConnectionId: connection._id,
        calendarEventId: googleEvent.id,
        courseId: course._id,
        scheduledAt: startDate.getTime(),
        sessionType,
        description,
      })

      createdEvents.push({
        courseId: course._id,
        eventId: googleEvent.id,
        sessionType,
      })
    } catch (err) {
      console.error(`[calendar/sync] Failed to create event for course ${course._id}:`, err)
    }
  }

  return { created: createdEvents.length, events: createdEvents }
})

function findNextPreferredSlot(
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

function getTimezoneOffsetMs(timezone: string, date: Date): number {
  try {
    const utcStr = date.toLocaleString('en-US', { timeZone: 'UTC' })
    const tzStr = date.toLocaleString('en-US', { timeZone: timezone })
    return new Date(tzStr).getTime() - new Date(utcStr).getTime()
  } catch {
    return 0
  }
}
