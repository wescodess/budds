import { LEARN_MEASUREMENT_CAPABILITIES } from '../shared/learn-v2-measurement-storage-manifest'
import { v } from 'convex/values'
import { query } from './_generated/server'
import { requireAuth } from './lib/auth'

export const listByCourse = query({
  args: { courseId: v.id('courses') },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)

    const course = await ctx.db.get(args.courseId)
    if (!course || course.userId !== userId) return []

    const sources = ctx.db
      .query('courseSourceDocs')
      .withIndex('by_courseId', (q) => q.eq('courseId', args.courseId))
    const rows = LEARN_MEASUREMENT_CAPABILITIES.responses ? await sources.take(65) : await sources.collect()
    if (LEARN_MEASUREMENT_CAPABILITIES.responses && rows.length > 64) throw new Error('Teaching input is unavailable')
    return rows
  },
})
