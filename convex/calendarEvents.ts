import { v } from 'convex/values'
import { internalMutation, internalQuery, mutation, query } from './_generated/server'
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
