import { v } from 'convex/values'
import { query, mutation, internalMutation } from './_generated/server'
import { getOptionalAuthUserId, requireAuth } from './lib/auth'
import { computeSM2 } from './lib/sm2'
import { updateStreakForActivity } from './learnProfile'
import { getTodayInTimezone } from './lib/dates'

function getTomorrowDate(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}

function getTodayDate(): string {
  return new Date().toISOString().slice(0, 10)
}

export const extractFromSection = internalMutation({
  args: {
    userId: v.string(),
    courseId: v.id('courses'),
    sectionId: v.id('courseSections'),
  },
  handler: async (ctx, args) => {
    const section = await ctx.db.get(args.sectionId)
    if (!section) return 0

    const flashcardBlock = section.contentBlocks.find((b) => b.type === 'flashcard' && b.entityId)
    if (!flashcardBlock || !flashcardBlock.entityId) return 0

    const roomId = ctx.db.normalizeId('flashcardRooms', flashcardBlock.entityId)
    if (!roomId) return 0

    const cards = await ctx.db
      .query('flashcardRoomCards')
      .withIndex('by_roomId', (q) => q.eq('roomId', roomId))
      .take(200)

    const tomorrow = getTomorrowDate()
    const now = Date.now()
    let count = 0

    for (const card of cards) {
      const existing = await ctx.db
        .query('reviewItems')
        .withIndex('by_flashcardRoomCardId', (q) => q.eq('flashcardRoomCardId', card._id))
        .take(1)

      if (existing.length > 0) continue

      await ctx.db.insert('reviewItems', {
        userId: args.userId,
        courseId: args.courseId,
        sectionId: args.sectionId,
        flashcardRoomCardId: card._id,
        prompt: card.term,
        answer: card.definition,
        easeFactor: 2.5,
        interval: 1,
        repetitions: 0,
        nextReviewDate: tomorrow,
        flagged: card.flagged === true,
        createdAt: now,
      })
      count++
    }

    return count
  },
})

export const listDueForUser = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireAuth(ctx)
    const today = getTodayDate()

    const items = await ctx.db
      .query('reviewItems')
      .withIndex('by_userId_and_nextReviewDate', (q) =>
        q.eq('userId', userId).lte('nextReviewDate', today),
      )
      .take(200)

    return items.filter((item) => !item.flagged)
  },
})

export const getReviewBacklogCount = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getOptionalAuthUserId(ctx)
    if (!userId) return null
    const today = getTodayDate()

    const items = await ctx.db
      .query('reviewItems')
      .withIndex('by_userId_and_nextReviewDate', (q) =>
        q.eq('userId', userId).lte('nextReviewDate', today),
      )
      .take(500)

    const dueCount = items.filter((item) => !item.flagged).length

    const profile = await ctx.db
      .query('learnProfile')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .unique()
    const dailyCap = profile?.dailyReviewCap ?? 50

    return { dueCount, dailyCap }
  },
})

export const listDueWithContext = query({
  args: {
    mode: v.optional(v.union(v.literal('full'), v.literal('quick'))),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const today = getTodayDate()

    const profile = await ctx.db
      .query('learnProfile')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .unique()
    const dailyCap = profile?.dailyReviewCap ?? 50
    const cap = args.mode === 'quick' ? Math.min(10, dailyCap) : dailyCap

    const items = await ctx.db
      .query('reviewItems')
      .withIndex('by_userId_and_nextReviewDate', (q) =>
        q.eq('userId', userId).lte('nextReviewDate', today),
      )
      .take(200)

    const dueItems = items.filter((item) => !item.flagged).slice(0, cap)

    const courseCache = new Map<string, string>()
    const sectionCache = new Map<string, { title: string; order: number }>()

    const enriched = []
    for (const item of dueItems) {
      let courseTitle = courseCache.get(item.courseId)
      if (!courseTitle) {
        const course = await ctx.db.get(item.courseId)
        courseTitle = course?.title ?? 'Unknown Course'
        courseCache.set(item.courseId, courseTitle)
      }

      let sectionData = sectionCache.get(item.sectionId)
      if (!sectionData) {
        const section = await ctx.db.get(item.sectionId)
        sectionData = {
          title: section?.title ?? 'Unknown Section',
          order: section?.order ?? 0,
        }
        sectionCache.set(item.sectionId, sectionData)
      }

      enriched.push({
        ...item,
        courseTitle,
        sectionTitle: sectionData.title,
        sectionOrder: sectionData.order,
      })
    }

    return enriched
  },
})

export const listBySection = query({
  args: { sectionId: v.id('courseSections') },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)

    const section = await ctx.db.get(args.sectionId)
    if (!section || section.userId !== userId) return []

    return await ctx.db
      .query('reviewItems')
      .withIndex('by_sectionId', (q) => q.eq('sectionId', args.sectionId))
      .take(200)
  },
})

export const completeReviewSession = mutation({
  args: {
    itemsReviewed: v.number(),
    itemsCorrect: v.number(),
    durationMs: v.number(),
    mode: v.optional(v.union(v.literal('full'), v.literal('quick'))),
    idempotencyKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    if (args.idempotencyKey) {
      const existing = await ctx.db
        .query('reviewSessions')
        .withIndex('by_userId_and_idempotencyKey', q =>
          q.eq('userId', userId).eq('idempotencyKey', args.idempotencyKey),
        )
        .unique()
      if (existing) {
        const currentProfile = await ctx.db
          .query('learnProfile')
          .withIndex('by_userId', q => q.eq('userId', userId))
          .unique()
        return {
          streakCurrent: currentProfile?.streakCurrent ?? 0,
          streakLastDate: currentProfile?.streakLastDate,
        }
      }
    }

    const profile = await ctx.db
      .query('learnProfile')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .unique()

    const todayStr = getTodayInTimezone(profile?.timezone)

    await ctx.db.insert('reviewSessions', {
      userId,
      date: todayStr,
      itemsReviewed: args.itemsReviewed,
      itemsCorrect: args.itemsCorrect,
      durationMs: args.durationMs,
      mode: args.mode,
      idempotencyKey: args.idempotencyKey,
      completedAt: Date.now(),
    })

    const streakResult = await updateStreakForActivity(ctx, userId)

    return {
      streakCurrent: streakResult.streakCurrent,
      streakLastDate: streakResult.streakLastDate,
    }
  },
})

export const submitReview = mutation({
  args: {
    reviewItemId: v.id('reviewItems'),
    quality: v.number(),
    idempotencyKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const { reviewItemId, quality } = args

    if (![0, 3, 4, 5].includes(quality)) {
      throw new Error(`Invalid quality rating: ${quality}. Must be 0, 3, 4, or 5.`)
    }

    const item = await ctx.db.get(reviewItemId)
    if (!item) throw new Error('Review item not found')
    if (item.userId !== userId) throw new Error('Not authorized')
    if (item.flagged) throw new Error('Cannot review a flagged item')
    if (args.idempotencyKey && item.lastReviewIdempotencyKey === args.idempotencyKey) {
      return {
        easeFactor: item.easeFactor,
        interval: item.interval,
        repetitions: item.repetitions,
        nextReviewDate: item.nextReviewDate,
      }
    }

    const profile = await ctx.db
      .query('learnProfile')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .unique()

    const todayStr = getTodayInTimezone(profile?.timezone)

    const result = computeSM2(
      {
        easeFactor: item.easeFactor,
        interval: item.interval,
        repetitions: item.repetitions,
      },
      quality,
      todayStr,
    )

    await ctx.db.patch(reviewItemId, {
      easeFactor: result.easeFactor,
      interval: result.interval,
      repetitions: result.repetitions,
      nextReviewDate: result.nextReviewDate,
      lastReviewQuality: quality,
      lastReviewedAt: Date.now(),
      lastReviewIdempotencyKey: args.idempotencyKey,
    })

    await updateStreakForActivity(ctx, userId)

    return result
  },
})
