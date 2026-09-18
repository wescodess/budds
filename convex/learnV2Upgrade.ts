import { v } from 'convex/values'
import { mutation, type MutationCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { requireLearnV2MutationAccess } from './lib/learnV2Access'

const MAX_IDEMPOTENCY_KEY_LENGTH = 128
const MAX_LEGACY_SOURCE_ROWS = 100
const MAX_TITLE_LENGTH = 200

type LegacySourcePolicy = NonNullable<Doc<'learningVoids'>['legacySourcePolicy']>

function requestFingerprint(args: { legacyCourseId: Id<'courses'>, idempotencyKey: string }) {
  return JSON.stringify({ command: 'upgradeLegacyCourse.v1', legacyCourseId: args.legacyCourseId, idempotencyKey: args.idempotencyKey })
}

function assertIdempotencyKey(value: string) {
  if (value.trim().length === 0) throw new Error('Idempotency key must not be blank')
  if (value.length > MAX_IDEMPOTENCY_KEY_LENGTH) throw new Error(`Idempotency key must not exceed ${MAX_IDEMPOTENCY_KEY_LENGTH} characters`)
}

function outcome(learningVoidId: Id<'learningVoids'>) {
  return { _id: learningVoidId, status: 'draft' as const, revision: 1 }
}

function sourcePolicy(course: Doc<'courses'>): LegacySourcePolicy {
  if (course.sourceType === 'web-only') return 'web_only'
  return course.webSearchEnabled ? 'folder_plus_web' : 'folder_only'
}

async function replayOrReject(ctx: MutationCtx, userId: string, args: { legacyCourseId: Id<'courses'>, idempotencyKey: string }) {
  const existingForKey = await ctx.db.query('learningVoids')
    .withIndex('by_userId_and_legacyUpgradeIdempotencyKey', q => q.eq('userId', userId).eq('legacyUpgradeIdempotencyKey', args.idempotencyKey))
    .unique()
  if (!existingForKey) return null
  if (existingForKey.legacyUpgradeRequestFingerprint !== requestFingerprint(args)) {
    throw new Error('Idempotency key was already used for a different request')
  }
  if (existingForKey.legacyCourseId !== args.legacyCourseId) {
    throw new Error('Idempotency key was already used for a different request')
  }
  return outcome(existingForKey._id)
}

export const upgradeLegacyCourse = mutation({
  args: { legacyCourseId: v.id('courses'), idempotencyKey: v.string() },
  handler: async (ctx, args) => {
    assertIdempotencyKey(args.idempotencyKey)
    const userId = await requireLearnV2MutationAccess(ctx)
    const replay = await replayOrReject(ctx, userId, args)
    if (replay) return replay

    const course = await ctx.db.get(args.legacyCourseId)
    if (!course || course.userId !== userId) throw new Error('Legacy course not found')
    const folder = await ctx.db.get(course.folderId)
    if (!folder || folder.userId !== userId) throw new Error('Legacy course folder not found')
    const title = course.title.trim()
    if (title.length === 0 || title.length > MAX_TITLE_LENGTH) throw new Error('Legacy course title is invalid')

    const alreadyUpgraded = await ctx.db.query('learningVoids')
      .withIndex('by_userId_and_legacyCourseId', q => q.eq('userId', userId).eq('legacyCourseId', course._id))
      .unique()
    if (alreadyUpgraded) throw new Error('Legacy course has already been upgraded')

    const legacySources = await ctx.db.query('courseSourceDocs')
      .withIndex('by_courseId', q => q.eq('courseId', course._id))
      .take(MAX_LEGACY_SOURCE_ROWS + 1)
    if (legacySources.length > MAX_LEGACY_SOURCE_ROWS) throw new Error('Legacy course has too many source rows')

    const selectedDocuments: Array<Doc<'documents'>> = []
    const seenDocumentIds = new Set<string>()
    for (const source of legacySources) {
      if (source.userId !== userId || !source.documentId) throw new Error('Document not found')
      const document = await ctx.db.get(source.documentId)
      if (!document || document.userId !== userId) throw new Error('Document not found')
      const documentFolder = await ctx.db.get(document.folderId)
      if (!documentFolder || documentFolder.userId !== userId) throw new Error('Document folder not found')
      if (!seenDocumentIds.has(String(document._id))) {
        seenDocumentIds.add(String(document._id))
        selectedDocuments.push(document)
      }
    }

    const now = Date.now()
    const learningVoidId = await ctx.db.insert('learningVoids', {
      userId,
      folderId: course.folderId,
      title,
      status: 'draft',
      revision: 1,
      lastIdempotencyKey: args.idempotencyKey,
      legacyCourseId: course._id,
      legacyUpgradeIdempotencyKey: args.idempotencyKey,
      legacyUpgradeRequestFingerprint: requestFingerprint(args),
      legacySourcePolicy: sourcePolicy(course),
      createdAt: now,
      updatedAt: now,
    })
    for (const document of selectedDocuments) {
      await ctx.db.insert('learnSourceIdentities', {
        userId,
        learningVoidId,
        origin: 'folder_document',
        externalKey: `document:${document._id}`,
        folderDocumentId: document._id,
        title: document.filename,
      })
    }
    return outcome(learningVoidId)
  },
})
