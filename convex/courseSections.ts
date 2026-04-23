import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { Doc } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'

async function requireAuth(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) throw new Error('Unauthenticated')
  return identity.tokenIdentifier
}

export const listByCourse = query({
  args: { courseId: v.id('courses') },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const course = await ctx.db.get(args.courseId)
    if (!course || course.userId !== userId) return []

    return await ctx.db
      .query('courseSections')
      .withIndex('by_courseId_and_order', (q) => q.eq('courseId', args.courseId))
      .take(100)
  },
})

export const updateTitle = mutation({
  args: {
    sectionId: v.id('courseSections'),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const section = await ctx.db.get(args.sectionId)
    if (!section || section.userId !== userId) throw new Error('Section not found')

    const trimmed = args.title.trim().slice(0, 200) || 'Untitled Section'
    await ctx.db.patch(args.sectionId, { title: trimmed })

    const course = await ctx.db.get(section.courseId)
    if (course) {
      const updated = course.outlineSections.map((s) =>
        s.order === section.order ? { ...s, title: trimmed } : s,
      )
      await ctx.db.patch(section.courseId, {
        outlineSections: updated,
        updatedAt: Date.now(),
      })
    }
  },
})

export const updateKnowledgeType = mutation({
  args: {
    sectionId: v.id('courseSections'),
    knowledgeType: v.union(
      v.literal('factual'),
      v.literal('conceptual'),
      v.literal('procedural'),
      v.literal('mixed'),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const section = await ctx.db.get(args.sectionId)
    if (!section || section.userId !== userId) throw new Error('Section not found')

    await ctx.db.patch(args.sectionId, { knowledgeType: args.knowledgeType })

    const course = await ctx.db.get(section.courseId)
    if (course) {
      const updated = course.outlineSections.map((s) =>
        s.order === section.order ? { ...s, knowledgeType: args.knowledgeType } : s,
      )
      await ctx.db.patch(section.courseId, {
        outlineSections: updated,
        updatedAt: Date.now(),
      })
    }
  },
})

export const remove = mutation({
  args: { sectionId: v.id('courseSections') },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const section = await ctx.db.get(args.sectionId)
    if (!section || section.userId !== userId) throw new Error('Section not found')

    const removedOrder = section.order
    await ctx.db.delete(args.sectionId)

    const siblings = await ctx.db
      .query('courseSections')
      .withIndex('by_courseId_and_order', (q) => q.eq('courseId', section.courseId))
      .collect()

    for (const sibling of siblings) {
      if (sibling.order > removedOrder) {
        await ctx.db.patch(sibling._id, { order: sibling.order - 1 })
      }
    }

    const course = await ctx.db.get(section.courseId)
    if (course) {
      const filtered = course.outlineSections
        .filter((s) => s.order !== removedOrder)
        .map((s, i) => ({ ...s, order: i }))

      await ctx.db.patch(section.courseId, {
        outlineSections: filtered,
        totalSectionCount: filtered.length,
        updatedAt: Date.now(),
      })
    }
  },
})

export const create = mutation({
  args: {
    courseId: v.id('courses'),
    title: v.optional(v.string()),
    knowledgeType: v.optional(
      v.union(
        v.literal('factual'),
        v.literal('conceptual'),
        v.literal('procedural'),
        v.literal('mixed'),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const course = await ctx.db.get(args.courseId)
    if (!course || course.userId !== userId) throw new Error('Course not found')

    const title = (args.title ?? 'New Section').trim().slice(0, 200) || 'New Section'
    const knowledgeType = args.knowledgeType ?? 'mixed'
    const order = course.totalSectionCount

    const sectionId = await ctx.db.insert('courseSections', {
      courseId: args.courseId,
      userId,
      order,
      title,
      knowledgeType,
      status: 'locked',
      contentBlocks: [],
      masteryLevel: 'new',
    })

    const newOutline = [
      ...course.outlineSections,
      { title, description: '', knowledgeType, order },
    ]

    await ctx.db.patch(args.courseId, {
      outlineSections: newOutline,
      totalSectionCount: order + 1,
      updatedAt: Date.now(),
    })

    return sectionId
  },
})

export const updateOrder = mutation({
  args: {
    courseId: v.id('courses'),
    sectionIds: v.array(v.id('courseSections')),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const course = await ctx.db.get(args.courseId)
    if (!course || course.userId !== userId) throw new Error('Course not found')

    const oldSections = await ctx.db
      .query('courseSections')
      .withIndex('by_courseId_and_order', (q) => q.eq('courseId', args.courseId))
      .take(100)

    const descByOrder = new Map<number, string>()
    for (const o of course.outlineSections) {
      descByOrder.set(o.order, o.description)
    }

    const orderBySectionId = new Map<string, number>()
    for (const s of oldSections) {
      orderBySectionId.set(s._id as string, s.order)
    }

    const reorderedOutline: typeof course.outlineSections = []

    for (let i = 0; i < args.sectionIds.length; i++) {
      const sectionId = args.sectionIds[i]!
      const section = await ctx.db.get(sectionId) as Doc<'courseSections'> | null
      if (!section || section.userId !== userId || section.courseId !== args.courseId) {
        throw new Error('Section not found')
      }
      await ctx.db.patch(sectionId, { order: i })

      const oldOrder = orderBySectionId.get(sectionId as string)
      reorderedOutline.push({
        title: section.title,
        description: oldOrder !== undefined ? (descByOrder.get(oldOrder) ?? '') : '',
        knowledgeType: section.knowledgeType,
        order: i,
      })
    }

    await ctx.db.patch(args.courseId, {
      outlineSections: reorderedOutline,
      updatedAt: Date.now(),
    })
  },
})
