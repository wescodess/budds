import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  users: defineTable({
    tokenIdentifier: v.string(),
    name: v.string(),
    email: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
  }).index('by_tokenIdentifier', ['tokenIdentifier']),

  folders: defineTable({
    userId: v.string(),
    name: v.string(),
    parentId: v.optional(v.id('folders')),
    documentCount: v.number(),
  })
    .index('by_userId', ['userId'])
    .index('by_userId_and_parentId', ['userId', 'parentId']),
})
