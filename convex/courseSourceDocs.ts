import { v } from 'convex/values'
import { query } from './_generated/server'
import { requireAuth } from './lib/auth'

export const listByCourse = query({
  args: { courseId: v.id('courses') },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)

    const course = await ctx.db.get(args.courseId)
    if (!course || course.userId !== userId) return []

    return await ctx.db
      .query('courseSourceDocs')
      .withIndex('by_courseId', (q) => q.eq('courseId', args.courseId))
      .collect()
  },
})
