import { getFunctionName, type FunctionReference } from 'convex/server'
import type { TestConvex } from 'convex-test'
import type schema from '../../convex/schema'
import type { MutationCtx } from '../../convex/_generated/server'
import type { Id } from '../../convex/_generated/dataModel'

// Ordinary content tests opt into real source rows; authority is never mocked.
export async function seedOrdinaryTeachingSource(ctx: Pick<MutationCtx, 'db'>, userId: string) {
  const documents = new Map<string, Id<'documents'>>()
  async function source(folderId: Id<'folders'>) {
    const cached = documents.get(folderId)
    if (cached) return cached
    const folder = await ctx.db.get(folderId)
    if (!folder || folder.userId !== userId) throw new Error('Fixture folder unavailable')
    const existing = await ctx.db.query('documents').withIndex('by_userId_and_folderId', q => q.eq('userId', userId).eq('folderId', folderId)).take(100)
    const doc = existing.find(row => row.filename === 'ordinary-teaching-fixture.txt' && row.status === 'success')
    const id = doc?._id ?? await ctx.db.insert('documents', { userId, folderId, filename: 'ordinary-teaching-fixture.txt', fileSize: 1, status: 'success' })
    documents.set(folderId, id)
    return id
  }
  const quizzes = await ctx.db.query('quizzes').withIndex('by_userId', q => q.eq('userId', userId)).take(1000)
  for (const quiz of quizzes) {
    const questions = await ctx.db.query('quizQuestions').withIndex('by_quizId', q => q.eq('quizId', quiz._id)).take(1000)
    for (const question of questions) if (!question.sourceDocumentId && !(await ctx.db.query('learnArtifactLineages').withIndex('by_artifact_kind_and_artifact_id_and_nextId', q => q.eq('artifact.kind', 'quiz_question').eq('artifact.id', question._id)).take(1)).length) await ctx.db.patch(question._id, { sourceDocumentId: await source(quiz.folderId) })
  }
  const courses = await ctx.db.query('courses').withIndex('by_userId', q => q.eq('userId', userId)).take(1000)
  for (const course of courses) {
    if (!course.folderId) continue
    const links = await ctx.db.query('courseSourceDocs').withIndex('by_courseId', q => q.eq('courseId', course._id)).take(1)
    if (!links.length) await ctx.db.insert('courseSourceDocs', { userId, courseId: course._id, folderId: course.folderId, documentId: await source(course.folderId) })
  }
  const rooms = await ctx.db.query('flashcardRooms').withIndex('by_userId', q => q.eq('userId', userId)).take(1000)
  for (const room of rooms) {
    if (room.activeVersionId && (await ctx.db.query('learnArtifactLineages').withIndex('by_artifact_kind_and_artifact_id_and_nextId', q => q.eq('artifact.kind', 'flashcard_version').eq('artifact.id', room.activeVersionId!)).take(1)).length) continue
    const cards = await ctx.db.query('flashcardRoomCards').withIndex('by_roomId', q => q.eq('roomId', room._id)).take(1000)
    for (const card of cards) if (!card.sourceDocumentId && !card.metadata?.source?.documentId) await ctx.db.patch(card._id, { sourceDocumentId: await source(room.folderId) })
    const versions = await ctx.db.query('flashcardRoomVersions').withIndex('by_roomId', q => q.eq('roomId', room._id)).take(1000)
    for (const version of versions) {
      const copies = await ctx.db.query('flashcardVersionCards').withIndex('by_versionId', q => q.eq('versionId', version._id)).take(1000)
      for (const copy of copies) if (!copy.sourceDocumentId && !copy.metadata?.source?.documentId) await ctx.db.patch(copy._id, { sourceDocumentId: await source(room.folderId) })
    }
  }
  const reviews = await ctx.db.query('reviewItems').withIndex('by_userId', q => q.eq('userId', userId)).take(1000)
  for (const review of reviews) {
    if (review.sourceVersionId) continue
    let card = review.flashcardRoomCardId ? await ctx.db.get(review.flashcardRoomCardId) : null
    let room = card && await ctx.db.get(card.roomId)
    if (!card || !room || room.userId !== userId || card.term !== review.prompt || card.definition !== review.answer) {
      const course = await ctx.db.get(review.courseId)
      if (!course?.folderId) continue
      const roomId = await ctx.db.insert('flashcardRooms', { userId, folderId: course.folderId, title: 'Review fixture', updatedAt: 1 })
      const cardId = await ctx.db.insert('flashcardRoomCards', { userId, roomId, displayOrder: 0, term: review.prompt, definition: review.answer, sourceDocumentId: await source(course.folderId) })
      await ctx.db.patch(review._id, { flashcardRoomCardId: cardId })
      card = (await ctx.db.get(cardId))!; room = (await ctx.db.get(roomId))!
    }
    const versionId = await ctx.db.insert('flashcardRoomVersions', { userId, roomId: room._id, title: 'Retained review fixture', origin: 'manual', cardCount: 1 })
    await ctx.db.insert('flashcardVersionCards', { userId, versionId, roomId: room._id, displayOrder: card.displayOrder, term: card.term, definition: card.definition, sourceDocumentId: card.sourceDocumentId ?? await source(room.folderId) })
    await ctx.db.patch(review._id, { sourceVersionId: versionId })
  }
  const overviews = await ctx.db.query('audioOverviews').withIndex('by_userId', q => q.eq('userId', userId)).take(1000)
  for (const overview of overviews) if (!overview.episodeId && !overview.sourceDocumentIds?.length && !overview.scopeDocIds?.length && !(await ctx.db.query('learnArtifactLineages').withIndex('by_artifact_kind_and_artifact_id_and_nextId', q => q.eq('artifact.kind', 'audio_overview').eq('artifact.id', overview._id)).take(1)).length) await ctx.db.patch(overview._id, { sourceDocumentIds: [await source(overview.folderId)] })
  const legacy = await ctx.db.query('flashcards').withIndex('by_userId', q => q.eq('userId', userId)).take(1000)
  for (const card of legacy) if (!card.sourceDocumentId) {
    const set = await ctx.db.get(card.setId)
    if (set) await ctx.db.patch(card._id, { sourceDocumentId: await source(set.folderId) })
  }
}

export function withOrdinaryTeachingSources(t: TestConvex<typeof schema>): TestConvex<typeof schema> {
  return new Proxy(t, { get(target, property) {
    if (property !== 'withIdentity') return Reflect.get(target, property)
    return (identity: Parameters<typeof t.withIdentity>[0]) => {
      const client = target.withIdentity(identity)
      return new Proxy(client, { get(current, method) {
        const operation: unknown = Reflect.get(current, method)
        if ((method !== 'query' && method !== 'mutation') || typeof operation !== 'function') return operation
        return async (...args: unknown[]) => {
          if (identity.tokenIdentifier && getFunctionName(args[0] as FunctionReference<'query' | 'mutation'>) !== 'quizzes:submitAnswer') await target.run(ctx => seedOrdinaryTeachingSource(ctx, identity.tokenIdentifier!))
          const result: unknown = await Reflect.apply(operation, current, args)
          if (identity.tokenIdentifier && getFunctionName(args[0] as FunctionReference<'query' | 'mutation'>) === 'quizzes:addQuestion') await target.run(ctx => seedOrdinaryTeachingSource(ctx, identity.tokenIdentifier!))
          return result
        }
      } })
    }
  } })
}
