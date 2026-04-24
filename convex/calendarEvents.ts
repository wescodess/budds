import { v } from 'convex/values'
import { internalAction, internalMutation, internalQuery, mutation, query } from './_generated/server'
import { internal } from './_generated/api'
import { requireAuth } from './lib/auth'

const sessionTypeValidator = v.union(
  v.literal('new-content'),
  v.literal('review'),
  v.literal('audio-only'),
)

const statusValidator = v.union(
  v.literal('scheduled'),
  v.literal('completed'),
  v.literal('missed'),
  v.literal('rescheduled'),
)

export const listByUser = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireAuth(ctx)
    return await ctx.db
      .query('calendarEvents')
      .withIndex('by_userId', q => q.eq('userId', userId))
      .take(200)
  },
})

export const listByCourse = query({
  args: { courseId: v.id('courses') },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const events = await ctx.db
      .query('calendarEvents')
      .withIndex('by_courseId', q => q.eq('courseId', args.courseId))
      .take(100)
    return events.filter(e => e.userId === userId)
  },
})

export const listScheduled = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireAuth(ctx)
    const events = await ctx.db
      .query('calendarEvents')
      .withIndex('by_userId_and_status', q => q.eq('userId', userId).eq('status', 'scheduled'))
      .take(100)
    return events
  },
})

export const create = internalMutation({
  args: {
    userId: v.string(),
    calendarConnectionId: v.id('calendarConnections'),
    calendarEventId: v.string(),
    courseId: v.id('courses'),
    scheduledAt: v.number(),
    sessionType: sessionTypeValidator,
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert('calendarEvents', {
      userId: args.userId,
      calendarConnectionId: args.calendarConnectionId,
      calendarEventId: args.calendarEventId,
      courseId: args.courseId,
      scheduledAt: args.scheduledAt,
      sessionType: args.sessionType,
      status: 'scheduled',
      description: args.description,
    })
  },
})

export const createEvent = mutation({
  args: {
    calendarConnectionId: v.id('calendarConnections'),
    calendarEventId: v.string(),
    courseId: v.id('courses'),
    scheduledAt: v.number(),
    sessionType: sessionTypeValidator,
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    return await ctx.db.insert('calendarEvents', {
      userId,
      calendarConnectionId: args.calendarConnectionId,
      calendarEventId: args.calendarEventId,
      courseId: args.courseId,
      scheduledAt: args.scheduledAt,
      sessionType: args.sessionType,
      status: 'scheduled',
      description: args.description,
    })
  },
})

export const updateStatus = mutation({
  args: {
    eventId: v.id('calendarEvents'),
    status: statusValidator,
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const event = await ctx.db.get(args.eventId)
    if (!event || event.userId !== userId) throw new Error('Event not found')
    await ctx.db.patch(args.eventId, { status: args.status })
  },
})

export const deleteByCourse = internalMutation({
  args: { courseId: v.id('courses') },
  handler: async (ctx, args) => {
    const events = await ctx.db
      .query('calendarEvents')
      .withIndex('by_courseId', q => q.eq('courseId', args.courseId))
      .take(500)
    for (const event of events) {
      await ctx.db.delete(event._id)
    }
  },
})

export const deleteByUser = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const events = await ctx.db
      .query('calendarEvents')
      .withIndex('by_userId', q => q.eq('userId', args.userId))
      .take(500)
    for (const event of events) {
      await ctx.db.delete(event._id)
    }
  },
})

export const getScheduledByUser = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('calendarEvents')
      .withIndex('by_userId_and_status', q => q.eq('userId', args.userId).eq('status', 'scheduled'))
      .take(200)
  },
})

export const checkAndMarkMissed = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now()
    const scheduled = await ctx.db
      .query('calendarEvents')
      .withIndex('by_userId_and_status', q => q.eq('userId', args.userId).eq('status', 'scheduled'))
      .take(200)

    const missed: Array<{
      eventId: typeof scheduled[0]['_id']
      courseId: typeof scheduled[0]['courseId']
      calendarConnectionId: typeof scheduled[0]['calendarConnectionId']
      sessionType: typeof scheduled[0]['sessionType']
    }> = []

    for (const event of scheduled) {
      if (event.scheduledAt < now) {
        await ctx.db.patch(event._id, { status: 'missed' })
        missed.push({
          eventId: event._id,
          courseId: event.courseId,
          calendarConnectionId: event.calendarConnectionId,
          sessionType: event.sessionType,
        })
      }
    }

    return missed
  },
})

export const createRescheduled = internalMutation({
  args: {
    userId: v.string(),
    calendarConnectionId: v.id('calendarConnections'),
    calendarEventId: v.string(),
    courseId: v.id('courses'),
    scheduledAt: v.number(),
    sessionType: sessionTypeValidator,
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert('calendarEvents', {
      userId: args.userId,
      calendarConnectionId: args.calendarConnectionId,
      calendarEventId: args.calendarEventId,
      courseId: args.courseId,
      scheduledAt: args.scheduledAt,
      sessionType: args.sessionType,
      status: 'rescheduled',
      description: args.description,
    })
  },
})

export const checkMissedSessions = internalAction({
  args: {},
  handler: async (ctx) => {
    const userIds = await ctx.runQuery(internal.calendarConnections.getAllConnectedUserIds, {})

    for (const userId of userIds) {
      const missed = await ctx.runMutation(internal.calendarEvents.checkAndMarkMissed, { userId })
      if (missed.length === 0) continue

      const connection = await ctx.runQuery(internal.calendarConnections.getConnectionByUser, { userId })
      if (!connection || !connection.preferences) continue

      const siteUrl = process.env.SITE_URL || process.env.NUXT_PUBLIC_SITE_URL || ''

      let accessToken = connection.accessToken
      let expiresAt = connection.expiresAt
      const refreshToken = connection.refreshToken

      if (expiresAt < Date.now() + 60_000) {
        const clientId = process.env.GOOGLE_CLIENT_ID
        const clientSecret = process.env.GOOGLE_CLIENT_SECRET

        if (!clientId || !clientSecret) {
          console.error(`[checkMissedSessions] Missing Google OAuth credentials, skipping user ${userId}`)
          continue
        }

        try {
          const rawRefresh = atob(refreshToken)
          const res = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id: clientId,
              client_secret: clientSecret,
              refresh_token: rawRefresh,
              grant_type: 'refresh_token',
            }),
          })
          if (!res.ok) {
            console.error(`[checkMissedSessions] Token refresh returned ${res.status} for ${userId}`)
            continue
          }
          const data = await res.json() as { access_token: string, expires_in: number }
          accessToken = btoa(data.access_token)
          expiresAt = Date.now() + data.expires_in * 1000
          await ctx.runMutation(internal.calendarConnections.updateTokens, {
            userId,
            accessToken,
            expiresAt,
          })
        } catch (err) {
          console.error(`[checkMissedSessions] Token refresh failed for ${userId}:`, err)
          continue
        }
      }

      const prefs = connection.preferences
      const timezone = connection.timezone
      const now = Date.now()

      const dayMap: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }
      const preferredDays = new Set(prefs.preferredDays.map((d: string) => dayMap[d] ?? -1))

      const bookedSlots = new Set<number>()

      for (const missedEvent of missed) {
        const [startHour, startMinute] = prefs.morningStart.split(':').map(Number)
        let nextSlot: Date | null = null

        for (let dayOffset = 1; dayOffset <= 14; dayOffset++) {
          const candidate = new Date(now + dayOffset * 86_400_000)
          try {
            const dayFormatter = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: timezone })
            const dayStr = dayFormatter.format(candidate).toLowerCase()
            const dayNum = dayMap[dayStr]
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
            const utcStr = tzDate.toLocaleString('en-US', { timeZone: 'UTC' })
            const tzStr = tzDate.toLocaleString('en-US', { timeZone: timezone })
            const offsetMs = new Date(tzStr).getTime() - new Date(utcStr).getTime()
            const slotDate = new Date(tzDate.getTime() - offsetMs)

            let candidate_ts = slotDate.getTime()
            if (candidate_ts > now) {
              while (bookedSlots.has(candidate_ts)) {
                candidate_ts += prefs.sessionMinutes * 60_000
              }
              nextSlot = new Date(candidate_ts)
              break
            }
          } catch {
            continue
          }
        }

        if (!nextSlot) continue
        bookedSlots.add(nextSlot.getTime())

        const endTime = new Date(nextSlot.getTime() + prefs.sessionMinutes * 60_000)

        const course = await ctx.runQuery(internal.courses.getById, { courseId: missedEvent.courseId })
        if (!course) continue
        const courseName = course.title

        const typeLabel = missedEvent.sessionType === 'new-content'
          ? 'New Content'
          : missedEvent.sessionType === 'review'
            ? 'Review'
            : 'Audio Only'

        const title = `[Budds] ${courseName} - ${typeLabel}`
        const deepLink = siteUrl ? `${siteUrl}/app/learn/${missedEvent.courseId}` : ''
        const description = [
          `${prefs.sessionMinutes} min ${missedEvent.sessionType === 'new-content' ? 'new content' : missedEvent.sessionType === 'review' ? 'review' : 'audio-only'} session (rescheduled)`,
          `Course: ${courseName}`,
          '',
          deepLink,
        ].join('\n')

        try {
          const rawToken = atob(accessToken)
          const calRes = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${rawToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              summary: title,
              description,
              start: { dateTime: nextSlot.toISOString(), timeZone: timezone },
              end: { dateTime: endTime.toISOString(), timeZone: timezone },
              reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 5 }] },
            }),
          })

          if (!calRes.ok) {
            console.error(`[checkMissedSessions] Google Calendar create failed:`, await calRes.text())
            continue
          }

          const googleEvent = await calRes.json() as { id: string }

          await ctx.runMutation(internal.calendarEvents.createRescheduled, {
            userId,
            calendarConnectionId: missedEvent.calendarConnectionId,
            calendarEventId: googleEvent.id,
            courseId: missedEvent.courseId,
            scheduledAt: nextSlot.getTime(),
            sessionType: missedEvent.sessionType,
            description,
          })
        } catch (err) {
          console.error(`[checkMissedSessions] Failed to reschedule event for course ${missedEvent.courseId}:`, err)
        }
      }
    }
  },
})
