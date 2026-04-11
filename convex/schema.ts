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
    updatedAt: v.optional(v.number()),
  })
    .index('by_userId', ['userId'])
    .index('by_userId_and_parentId', ['userId', 'parentId']),

  documents: defineTable({
    userId: v.string(),
    folderId: v.id('folders'),
    filename: v.string(),
    fileId: v.id('_storage'),
    status: v.union(v.literal('processing'), v.literal('success'), v.literal('failed')),
    fileSize: v.number(),
    failureReason: v.optional(v.string()),
  })
    .index('by_userId', ['userId'])
    .index('by_folderId', ['folderId'])
    .index('by_userId_and_folderId', ['userId', 'folderId'])
    .index('by_status', ['status']),
})
