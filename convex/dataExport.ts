import { v } from 'convex/values'
import { query } from './_generated/server'
import type { Doc } from './_generated/dataModel'

export const collectUserData = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Unauthenticated')

    const userId = identity.tokenIdentifier

    const userRow = await ctx.db
      .query('users')
      .withIndex('by_tokenIdentifier', (q) => q.eq('tokenIdentifier', userId))
      .unique()

    const folders = await ctx.db
      .query('folders')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .collect()

    const documents = await ctx.db
      .query('documents')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .collect()

    const conversations = await ctx.db
      .query('conversations')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .collect()

    const messages = await ctx.db
      .query('messages')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .collect()

    const quizzes = await ctx.db
      .query('quizzes')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .collect()

    const quizQuestions = await ctx.db
      .query('quizQuestions')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .collect()

    const quizAttempts = await ctx.db
      .query('quizAttempts')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .collect()

    const flashcardSets = await ctx.db
      .query('flashcardSets')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .collect()

    const flashcards = await ctx.db
      .query('flashcards')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .collect()

    const flashcardRooms = await ctx.db
      .query('flashcardRooms')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .collect()

    const flashcardRoomCards = await ctx.db
      .query('flashcardRoomCards')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .collect()

    const flashcardRoomVersions = await ctx.db
      .query('flashcardRoomVersions')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .collect()

    const flashcardVersionCards = await ctx.db
      .query('flashcardVersionCards')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .collect()

    const courses = await ctx.db
      .query('courses')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .collect()

    const courseSections = await ctx.db
      .query('courseSections')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .collect()

    const courseSourceDocs: Doc<'courseSourceDocs'>[] = []
    for (const course of courses) {
      const docs = await ctx.db
        .query('courseSourceDocs')
        .withIndex('by_courseId', (q) => q.eq('courseId', course._id))
        .collect()
      courseSourceDocs.push(...docs)
    }

    const learnProfile = await ctx.db
      .query('learnProfile')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .collect()

    return {
      userId,
      user: userRow
        ? {
            _id: userRow._id,
            _creationTime: userRow._creationTime,
            tokenIdentifier: userRow.tokenIdentifier,
            name: userRow.name,
            email: userRow.email,
            avatarUrl: userRow.avatarUrl,
          }
        : null,
      folders,
      documents,
      conversations,
      messages,
      quizzes,
      quizQuestions,
      quizAttempts,
      flashcardSets,
      flashcards,
      flashcardRooms,
      flashcardRoomCards,
      flashcardRoomVersions,
      flashcardVersionCards,
      courses,
      courseSections,
      courseSourceDocs,
      learnProfile,
    }
  },
})

export const getDocumentDownloadUrl = query({
  args: { documentId: v.id('documents') },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Unauthenticated')

    const userId = identity.tokenIdentifier
    const doc = await ctx.db.get(args.documentId)
    if (!doc || doc.userId !== userId) return null

    const url = doc.fileId ? await ctx.storage.getUrl(doc.fileId) : null
    return { url, filename: doc.filename }
  },
})
