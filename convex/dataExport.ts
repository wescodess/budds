import { paginationOptsValidator } from 'convex/server'
import { v } from 'convex/values'
import { query } from './_generated/server'
import { requireAuth } from './lib/auth'

// A single Convex document can approach 1 MiB. Keep pages comfortably below
// the 16 MiB transaction and return-value ceilings even at the per-row limit.
const MAX_EXPORT_PAGE_SIZE = 8

const exportCollectionValidator = v.union(
  v.literal('folders'),
  v.literal('documents'),
  v.literal('conversations'),
  v.literal('messages'),
  v.literal('quizzes'),
  v.literal('quizQuestions'),
  v.literal('quizAttempts'),
  v.literal('flashcardSets'),
  v.literal('flashcards'),
  v.literal('flashcardRooms'),
  v.literal('flashcardRoomCards'),
  v.literal('flashcardRoomVersions'),
  v.literal('flashcardVersionCards'),
  v.literal('courses'),
  v.literal('courseSections'),
  v.literal('learnProfile'),
  v.literal('tasks'),
  v.literal('reviewItems'),
  v.literal('reviewSessions'),
  v.literal('calendarConnections'),
  v.literal('calendarEvents'),
  v.literal('audioOverviewJobs'),
  v.literal('audioOverviewSourceManifests'),
  v.literal('audioOverviewSourceManifestEntries'),
  v.literal('audioOverviewOutlines'),
  v.literal('audioOverviewLearningObjectives'),
  v.literal('audioOverviewOutlineSources'),
  v.literal('audioOverviewClaimLedgers'),
  v.literal('audioOverviewClaims'),
  v.literal('audioOverviewClaimSources'),
  v.literal('audioOverviewEpisodes'),
  v.literal('audioOverviewScenes'),
  v.literal('audioOverviewUtterances'),
  v.literal('audioOverviewUtteranceSources'),
  v.literal('audioOverviewUtteranceClaims'),
  v.literal('audioOverviewAudioArtifacts'),
  v.literal('audioOverviewSceneQualityGates'),
  v.literal('audioOverviewAlignments'),
  v.literal('audioOverviewAlignmentSegments'),
  v.literal('audioOverviewJobTurns'),
  v.literal('audioOverviews'),
  v.literal('audioOverviewInterjections'),
  v.literal('audioOverviewInterjectionsV2'),
  v.literal('audioOverviewInterjectionUtterances'),
  v.literal('audioOverviewInterjectionSources'),
  v.literal('learningVoids'), v.literal('learnBlueprints'), v.literal('learnBlueprintRevisions'), v.literal('learnMilestones'), v.literal('learnObjectives'), v.literal('learnObjectivePrerequisites'), v.literal('learnSourceIdentities'), v.literal('learnSourceSnapshots'), v.literal('learnFolderSourceManifests'), v.literal('learnFolderSourceManifestFolders'), v.literal('learnFolderSourceManifestEntries'), v.literal('learnSourceExcerpts'), v.literal('learnObjectiveSources'), v.literal('learnClaimSupports'), v.literal('masteryAttempts'), v.literal('masteryRecords'), v.literal('studyPlans'), v.literal('studyPlanRevisions'), v.literal('studySessions'), v.literal('studySessionRetrievalObjectives'), v.literal('sessionContent'), v.literal('sessionContentBlocks'), v.literal('sessionContentClaims'), v.literal('calendarProjections'), v.literal('reminderPolicies'), v.literal('searchQuotaBuckets'), v.literal('searchReservations'), v.literal('learnJobs'), v.literal('learnLifecycleReceipts'),
)

function boundedPaginationOpts(paginationOpts: { numItems: number, cursor: string | null }) {
  return {
    cursor: paginationOpts.cursor,
    numItems: Math.min(MAX_EXPORT_PAGE_SIZE, Math.max(1, Math.floor(paginationOpts.numItems))),
  }
}

export const getExportMetadata = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireAuth(ctx)
    const userRow = await ctx.db
      .query('users')
      .withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', userId))
      .unique()

    return {
      userId,
      user: userRow
        ? {
            name: userRow.name,
            email: userRow.email,
          }
        : null,
    }
  },
})

export const getUserDataPage = query({
  args: {
    collection: exportCollectionValidator,
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const paginationOpts = boundedPaginationOpts(args.paginationOpts)

    switch (args.collection) {
      case 'folders':
        return await ctx.db.query('folders').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts)
      case 'documents':
        return await ctx.db.query('documents').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts)
      case 'conversations':
        return await ctx.db.query('conversations').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts)
      case 'messages':
        return await ctx.db.query('messages').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts)
      case 'quizzes':
        return await ctx.db.query('quizzes').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts)
      case 'quizQuestions':
        return await ctx.db.query('quizQuestions').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts)
      case 'quizAttempts':
        return await ctx.db.query('quizAttempts').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts)
      case 'flashcardSets':
        return await ctx.db.query('flashcardSets').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts)
      case 'flashcards':
        return await ctx.db.query('flashcards').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts)
      case 'flashcardRooms':
        return await ctx.db.query('flashcardRooms').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts)
      case 'flashcardRoomCards':
        return await ctx.db.query('flashcardRoomCards').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts)
      case 'flashcardRoomVersions':
        return await ctx.db.query('flashcardRoomVersions').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts)
      case 'flashcardVersionCards':
        return await ctx.db.query('flashcardVersionCards').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts)
      case 'courses':
        return await ctx.db.query('courses').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts)
      case 'courseSections':
        return await ctx.db.query('courseSections').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts)
      case 'learnProfile':
        return await ctx.db.query('learnProfile').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts)
      case 'tasks':
        return await ctx.db.query('tasks').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts)
      case 'reviewItems':
        return await ctx.db.query('reviewItems').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts)
      case 'reviewSessions':
        return await ctx.db.query('reviewSessions').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts)
      case 'calendarConnections': {
        const result = await ctx.db.query('calendarConnections').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts)
        return {
          ...result,
          page: result.page.map(({ accessToken: _accessToken, refreshToken: _refreshToken, ...connection }) => connection),
        }
      }
      case 'calendarEvents':
        return await ctx.db.query('calendarEvents').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts)
      case 'audioOverviewJobs':
        return await ctx.db.query('audioOverviewJobs').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts)
      case 'audioOverviewSourceManifests':
        return await ctx.db.query('audioOverviewSourceManifests').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts)
      case 'audioOverviewSourceManifestEntries':
        return await ctx.db.query('audioOverviewSourceManifestEntries').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts)
      case 'audioOverviewOutlines':
        return await ctx.db.query('audioOverviewOutlines').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts)
      case 'audioOverviewLearningObjectives':
        return await ctx.db.query('audioOverviewLearningObjectives').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts)
      case 'audioOverviewOutlineSources':
        return await ctx.db.query('audioOverviewOutlineSources').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts)
      case 'audioOverviewClaimLedgers':
        return await ctx.db.query('audioOverviewClaimLedgers').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts)
      case 'audioOverviewClaims':
        return await ctx.db.query('audioOverviewClaims').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts)
      case 'audioOverviewClaimSources':
        return await ctx.db.query('audioOverviewClaimSources').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts)
      case 'audioOverviewEpisodes':
        return await ctx.db.query('audioOverviewEpisodes').withIndex('by_userId_and_status', q => q.eq('userId', userId)).paginate(paginationOpts)
      case 'audioOverviewScenes':
        return await ctx.db.query('audioOverviewScenes').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts)
      case 'audioOverviewUtterances':
        return await ctx.db.query('audioOverviewUtterances').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts)
      case 'audioOverviewUtteranceSources':
        return await ctx.db.query('audioOverviewUtteranceSources').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts)
      case 'audioOverviewUtteranceClaims':
        return await ctx.db.query('audioOverviewUtteranceClaims').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts)
      case 'audioOverviewAudioArtifacts':
        return await ctx.db.query('audioOverviewAudioArtifacts').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts)
      case 'audioOverviewSceneQualityGates':
        return await ctx.db.query('audioOverviewSceneQualityGates').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts)
      case 'audioOverviewAlignments':
        return await ctx.db.query('audioOverviewAlignments').withIndex('by_userId_and_status', q => q.eq('userId', userId)).paginate(paginationOpts)
      case 'audioOverviewAlignmentSegments':
        return await ctx.db.query('audioOverviewAlignmentSegments').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts)
      case 'audioOverviewJobTurns':
        return await ctx.db.query('audioOverviewJobTurns').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts)
      case 'audioOverviews': {
        const result = await ctx.db.query('audioOverviews').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts)
        return {
          ...result,
          page: result.page.map(({ shareToken: _shareToken, ...overview }) => overview),
        }
      }
      case 'audioOverviewInterjections':
        return await ctx.db.query('audioOverviewInterjections').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts)
      case 'audioOverviewInterjectionsV2':
        return await ctx.db.query('audioOverviewInterjectionsV2').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts)
      case 'audioOverviewInterjectionUtterances':
        return await ctx.db.query('audioOverviewInterjectionUtterances').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts)
      case 'audioOverviewInterjectionSources':
        return await ctx.db.query('audioOverviewInterjectionSources').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts)
      // Retention-class redaction deliberately keeps protected evidence,
      // provider identifiers, quota details, and job internals out of export.
      case 'learningVoids': return await ctx.db.query('learningVoids').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts)
      case 'learnBlueprints': return await ctx.db.query('learnBlueprints').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts)
      case 'learnBlueprintRevisions': return await ctx.db.query('learnBlueprintRevisions').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts)
      case 'learnMilestones': return await ctx.db.query('learnMilestones').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts)
      case 'learnObjectives': return await ctx.db.query('learnObjectives').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts)
      case 'learnObjectivePrerequisites': return await ctx.db.query('learnObjectivePrerequisites').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts)
      case 'learnSourceIdentities': { const result = await ctx.db.query('learnSourceIdentities').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts); return { ...result, page: result.page.map(({ externalKey: _externalKey, folderDocumentId: _folderDocumentId, title, ...row }) => row.origin === 'folder_document' ? row : { ...row, title }) } }
      case 'learnSourceSnapshots': { const result = await ctx.db.query('learnSourceSnapshots').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts); return { ...result, page: result.page.map(({ sourceIdentityId: _sourceIdentityId, folderManifestId: _folderManifestId, objectKey: _objectKey, folderId: _folderId, filename: _filename, ...row }) => row) } }
      case 'learnFolderSourceManifests': { const result = await ctx.db.query('learnFolderSourceManifests').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts); return { ...result, page: result.page.map(({ idempotencyKey: _idempotencyKey, requestFingerprint: _requestFingerprint, explicitDocumentIds: _explicitDocumentIds, rootFolderId: _rootFolderId, ...row }) => row) } }
      case 'learnFolderSourceManifestFolders': { const result = await ctx.db.query('learnFolderSourceManifestFolders').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts); return { ...result, page: result.page.map(({ folderId: _folderId, parentFolderId: _parentFolderId, name: _name, childCursor: _childCursor, documentCursor: _documentCursor, ...row }) => row) } }
      case 'learnFolderSourceManifestEntries': { const result = await ctx.db.query('learnFolderSourceManifestEntries').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts); return { ...result, page: result.page.map(({ documentId: _documentId, folderId: _folderId, sourceIdentityId: _sourceIdentityId, sourceSnapshotId: _sourceSnapshotId, ...row }) => row) } }
      case 'learnSourceExcerpts': { const result = await ctx.db.query('learnSourceExcerpts').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts); return { ...result, page: result.page.map(({ sourceSnapshotId: _sourceSnapshotId, locator: _locator, privateLocator: _privateLocator, excerpt: _excerpt, ...row }) => row) } }
      case 'learnObjectiveSources': return await ctx.db.query('learnObjectiveSources').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts)
      case 'learnClaimSupports': { const result = await ctx.db.query('learnClaimSupports').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts); return { ...result, page: result.page.map(({ sessionContentClaimId: _claimId, sourceExcerptId: _excerptId, ...row }) => row) } }
      case 'masteryAttempts': return await ctx.db.query('masteryAttempts').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts)
      case 'masteryRecords': return await ctx.db.query('masteryRecords').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts)
      case 'studyPlans': return await ctx.db.query('studyPlans').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts)
      case 'studyPlanRevisions': return await ctx.db.query('studyPlanRevisions').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts)
      case 'studySessions': return await ctx.db.query('studySessions').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts)
      case 'studySessionRetrievalObjectives': return await ctx.db.query('studySessionRetrievalObjectives').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts)
      case 'sessionContent': return await ctx.db.query('sessionContent').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts)
      case 'sessionContentBlocks': return await ctx.db.query('sessionContentBlocks').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts)
      case 'sessionContentClaims': return await ctx.db.query('sessionContentClaims').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts)
      case 'calendarProjections': { const result = await ctx.db.query('calendarProjections').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts); return { ...result, page: result.page.map(({ provider: _provider, externalEventId: _event, ...row }) => row) } }
      case 'reminderPolicies': return await ctx.db.query('reminderPolicies').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts)
      case 'searchQuotaBuckets': { const result = await ctx.db.query('searchQuotaBuckets').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts); return { ...result, page: result.page.map(({ provider: _provider, scopeKey: _scopeKey, count: _count, ...row }) => row) } }
      case 'searchReservations': { const result = await ctx.db.query('searchReservations').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts); return { ...result, page: result.page.map(({ provider: _provider, idempotencyKey: _idempotencyKey, ...row }) => row) } }
      case 'learnJobs': { const result = await ctx.db.query('learnJobs').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts); return { ...result, page: result.page.map(({ idempotencyKey: _idempotencyKey, leaseExpiresAt: _leaseExpiresAt, checkpoint: _checkpoint, terminalReason: _terminalReason, ...row }) => row) } }
      case 'learnLifecycleReceipts': { const result = await ctx.db.query('learnLifecycleReceipts').withIndex('by_userId', q => q.eq('userId', userId)).paginate(paginationOpts); return { ...result, page: result.page.map(({ idempotencyKey: _idempotencyKey, requestFingerprint: _requestFingerprint, ...row }) => row) } }
    }
  },
})

export const getAttemptAnswersPage = query({
  args: {
    attemptId: v.id('quizAttempts'),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const attempt = await ctx.db.get('quizAttempts', args.attemptId)
    if (!attempt || attempt.userId !== userId) return null

    return await ctx.db
      .query('attemptAnswers')
      .withIndex('by_attemptId', q => q.eq('attemptId', args.attemptId))
      .paginate(boundedPaginationOpts(args.paginationOpts))
  },
})

export const getCourseSourceDocsPage = query({
  args: {
    courseId: v.id('courses'),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const course = await ctx.db.get('courses', args.courseId)
    if (!course || course.userId !== userId) return null

    return await ctx.db
      .query('courseSourceDocs')
      .withIndex('by_courseId', q => q.eq('courseId', args.courseId))
      .paginate(boundedPaginationOpts(args.paginationOpts))
  },
})

export const getDocumentDownloadUrl = query({
  args: { documentId: v.id('documents') },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)
    const doc = await ctx.db.get('documents', args.documentId)
    if (!doc || doc.userId !== userId) return null

    const url = doc.fileId ? await ctx.storage.getUrl(doc.fileId) : null
    return { url, filename: doc.filename }
  },
})
