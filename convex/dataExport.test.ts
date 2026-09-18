/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import { api } from './_generated/api'
import type { Id } from './_generated/dataModel'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')

const USER_A = {
  tokenIdentifier: 'https://auth.example.com|user_aaa',
  name: 'Alice',
  email: 'alice@example.com',
}

const USER_B = {
  tokenIdentifier: 'https://auth.example.com|user_bbb',
  name: 'Bob',
  email: 'bob@example.com',
}

async function seedUser(
  t: ReturnType<typeof convexTest>,
  identity: typeof USER_A,
) {
  const asUser = t.withIdentity(identity)
  const folderId = await asUser.mutation(api.folders.createFolder, { name: `Folder for ${identity.name}` })

  const storageId = await t.run(async (ctx) => {
    return await ctx.storage.store(new Blob(['pdf-bytes'], { type: 'application/pdf' }))
  })

  const docId = await t.run(async (ctx) => {
    return await ctx.db.insert('documents', {
      userId: identity.tokenIdentifier,
      folderId,
      filename: `${identity.name}-file.pdf`,
      fileId: storageId,
      status: 'success',
      fileSize: 1024,
    })
  })

  const convoId = await asUser.mutation(api.conversations.createConversation, {
    folderId,
    title: `${identity.name} convo`,
  })

  await asUser.mutation(api.messages.appendMessage, {
    conversationId: convoId,
    role: 'user',
    content: `Hi from ${identity.name}`,
  })

  return { folderId, docId, convoId, asUser }
}

const TEST_EXPORT_COLLECTIONS = [
  'folders',
  'documents',
  'conversations',
  'messages',
  'quizzes',
  'quizQuestions',
  'quizAttempts',
  'flashcardSets',
  'flashcards',
  'flashcardRooms',
  'flashcardRoomCards',
  'flashcardRoomVersions',
  'flashcardVersionCards',
  'tasks',
  'reviewItems',
  'reviewSessions',
  'calendarConnections',
  'calendarEvents',
  'audioOverviews',
  'audioOverviewJobs',
] as const

type TestClient = ReturnType<ReturnType<typeof convexTest>['withIdentity']>
type TestExportCollection = typeof TEST_EXPORT_COLLECTIONS[number]
type ExportRow = Record<string, unknown>
type ExportPage = {
  page: ExportRow[]
  isDone: boolean
  continueCursor: string
}
type TestUserDataExport = {
  userId: string
  user: { name: string, email?: string } | null
  attemptAnswers: ExportRow[]
} & Record<TestExportCollection, ExportRow[]>

async function readAllPages(
  asUser: TestClient,
  collection: TestExportCollection,
): Promise<ExportRow[]> {
  const rows: ExportRow[] = []
  let cursor: string | null = null

  while (true) {
    // An explicit structural type prevents TypeScript from recursively expanding
    // every collection-specific branch of this polymorphic FunctionReference.
    const result: ExportPage = await asUser.query(api.dataExport.getUserDataPage, {
      collection,
      paginationOpts: { cursor, numItems: 1 },
    })
    rows.push(...result.page)
    if (result.isDone) return rows
    cursor = result.continueCursor
  }
}

async function collectUserDataForTest(asUser: TestClient): Promise<TestUserDataExport> {
  const metadata = await asUser.query(api.dataExport.getExportMetadata, {})
  const collections = {} as Record<TestExportCollection, ExportRow[]>

  for (const collection of TEST_EXPORT_COLLECTIONS) {
    collections[collection] = await readAllPages(asUser, collection)
  }

  const attemptAnswers: ExportRow[] = []
  for (const attempt of collections.quizAttempts ?? []) {
    let cursor: string | null = null
    while (true) {
      const result: ExportPage | null = await asUser.query(api.dataExport.getAttemptAnswersPage, {
        attemptId: attempt._id as Id<'quizAttempts'>,
        paginationOpts: { cursor, numItems: 1 },
      })
      if (!result) break
      attemptAnswers.push(...result.page)
      if (result.isDone) break
      cursor = result.continueCursor
    }
  }

  return { ...metadata, ...collections, attemptAnswers }
}

describe('dataExport paginated queries', () => {
  test('exports calendar operational ledgers with strict redaction', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)
    const connectionId = await t.run(ctx => ctx.db.insert('calendarConnections', { userId: USER_A.tokenIdentifier, provider: 'google', accessToken: 'secret-access', refreshToken: 'secret-refresh', expiresAt: 1, timezone: 'UTC', status: 'connected', connectedAt: 1 }))
    await t.run(async ctx => {
      await ctx.db.insert('calendarWebhookReceipts', { userId: USER_A.tokenIdentifier, calendarConnectionId: connectionId, channelId: 'private-channel', messageNumber: '99999999999999999999', messageNumberOrder: '99999999999999999999', receivedAt: 2 })
      await ctx.db.insert('calendarWatchChannels', { userId: USER_A.tokenIdentifier, calendarConnectionId: connectionId, channelId: 'private-channel', resourceId: 'private-resource', tokenHash: 'private-hash', expiresAt: 3, status: 'current', createdAt: 2, updatedAt: 2 })
    })
    const receipt = (await asUser.query(api.dataExport.getUserDataPage, { collection: 'calendarWebhookReceipts', paginationOpts: { cursor: null, numItems: 10 } })).page[0]!
    const watch = (await asUser.query(api.dataExport.getUserDataPage, { collection: 'calendarWatchChannels', paginationOpts: { cursor: null, numItems: 10 } })).page[0]!
    expect(receipt).toMatchObject({ userId: USER_A.tokenIdentifier, receivedAt: 2 })
    expect(watch).toMatchObject({ userId: USER_A.tokenIdentifier, status: 'current', expiresAt: 3 })
    expect(JSON.stringify({ receipt, watch })).not.toContain('private-channel')
    expect(JSON.stringify({ receipt, watch })).not.toContain('private-resource')
    expect(JSON.stringify({ receipt, watch })).not.toContain('private-hash')
  })

  test('enumerates every V2 collection while the rollout gate is off and redacts retention-sensitive fields', async () => {
    const previous = process.env.LEARN_V2_ENABLED
    delete process.env.LEARN_V2_ENABLED
    try {
      const t = convexTest(schema, modules)
      const asUser = t.withIdentity(USER_A)
      const collections = ['learningVoids', 'learnBlueprints', 'learnBlueprintRevisions', 'learnMilestones', 'learnObjectives', 'learnObjectivePrerequisites', 'learnSourceIdentities', 'learnSourceSnapshots', 'learnSourceFetchLeases', 'learnSourceFetchRateEvents', 'learnMasteryScoringRateEvents', 'learnSourceCommandReceipts', 'learnFolderSourceManifests', 'learnFolderSourceManifestFolders', 'learnFolderSourceManifestEntries', 'learnSourceExcerpts', 'learnObjectiveSources', 'learnClaimSupports', 'masteryAttempts', 'masteryRecords', 'studyPlans', 'studyPlanRevisions', 'studySessions', 'studySessionRetrievalObjectives', 'sessionContent', 'sessionContentBlocks', 'sessionContentClaims', 'calendarProjections', 'reminderPolicies', 'searchQuotaBuckets', 'searchReservations', 'learnJobs', 'learnLifecycleReceipts', 'learnPlanCommandReceipts', 'learnPlanAuditEvents'] as const
      const storageId = await t.run(async ctx => await ctx.storage.store(new Blob(['private source'], { type: 'text/plain' })))
      const ids = await t.run(async (ctx) => {
        const folderId = await ctx.db.insert('folders', { userId: USER_A.tokenIdentifier, name: 'Export', documentCount: 0 })
        const docId = await ctx.db.insert('documents', { userId: USER_A.tokenIdentifier, folderId, filename: 'private-source.txt', fileId: storageId, status: 'success', fileSize: 14 })
        const voidId = await ctx.db.insert('learningVoids', { userId: USER_A.tokenIdentifier, folderId, title: 'Export void', status: 'draft', revision: 1, createdAt: 1, updatedAt: 1 })
        const blueprintId = await ctx.db.insert('learnBlueprints', { userId: USER_A.tokenIdentifier, learningVoidId: voidId, revision: 1, createdAt: 1 })
        const revisionId = await ctx.db.insert('learnBlueprintRevisions', { userId: USER_A.tokenIdentifier, blueprintId, learningVoidId: voidId, revision: 1, recordRevision: 1, status: 'draft', generationInputDigest: 'sha256:private-generation-input', generationRequestId: 'private-generation-request', createdAt: 1, updatedAt: 1 })
        const objectiveId = await ctx.db.insert('learnObjectives', { userId: USER_A.tokenIdentifier, blueprintRevisionId: revisionId, order: 1, title: 'Objective' })
        const planId = await ctx.db.insert('studyPlans', { userId: USER_A.tokenIdentifier, learningVoidId: voidId, revision: 1, createdAt: 1 })
        const planRevisionId = await ctx.db.insert('studyPlanRevisions', { userId: USER_A.tokenIdentifier, studyPlanId: planId, learningVoidId: voidId, revision: 1, status: 'draft', createdAt: 1 })
        const sessionId = await ctx.db.insert('studySessions', { userId: USER_A.tokenIdentifier, studyPlanRevisionId: planRevisionId, primaryObjectiveId: objectiveId, status: 'planned', revision: 1, scheduledStartAt: 1 })
        const sourceIdentityId = await ctx.db.insert('learnSourceIdentities', { userId: USER_A.tokenIdentifier, learningVoidId: voidId, origin: 'folder_document', externalKey: `document:${docId}?token=identity-secret`, canonicalUrl: 'https://user:password@example.com/capability/identity-secret?token=secret#fragment', publicLocator: 'https://example.com/capability/identity-secret?token=secret#fragment', privateLocator: 'https://example.com/capability/identity-secret?token=secret#fragment', folderDocumentId: docId, title: 'private-source.txt' })
        const manifestId = await ctx.db.insert('learnFolderSourceManifests', { userId: USER_A.tokenIdentifier, learningVoidId: voidId, blueprintRevisionId: revisionId, rootFolderId: folderId, expectedVoidRevision: 1, expectedBlueprintRecordRevision: 1, recordRevision: 2, status: 'frozen', coverage: 'complete', idempotencyKey: 'private-manifest-key', requestFingerprint: 'private-manifest-fingerprint', explicitDocumentIds: [docId], explicitDocumentCursor: 1, nextFolderOrder: 1, nextEntryOrder: 1, entryCount: 1, availableCount: 1, unavailableCount: 0, createdAt: 1, frozenAt: 2 })
        const folderRevision = `sha256:${'a'.repeat(64)}`
        const snapshotId = await ctx.db.insert('learnSourceSnapshots', { userId: USER_A.tokenIdentifier, sourceIdentityId, learningVoidId: voidId, blueprintRevisionId: revisionId, folderManifestId: manifestId, revision: 1, status: 'candidate', contentHash: 'b'.repeat(64), sourceRevision: `sha256:${'b'.repeat(64)}`, objectKey: 'private/object/key', folderId, folderRevision, filename: 'private-source.txt', publicLocator: 'https://example.com/capability/snapshot-secret?token=secret#fragment', privateLocator: 'https://example.com/capability/snapshot-secret?token=secret#fragment', createdAt: 1 })
        const manifestFolderId = await ctx.db.insert('learnFolderSourceManifestFolders', { userId: USER_A.tokenIdentifier, manifestId, folderId, name: 'Private folder', folderRevision, depth: 0, order: 0, stage: 'complete', documentCount: 1 })
        const manifestEntryId = await ctx.db.insert('learnFolderSourceManifestEntries', { userId: USER_A.tokenIdentifier, manifestId, order: 0, documentId: docId, folderId, folderRevision, sourceIdentityId, sourceSnapshotId: snapshotId, contentHash: 'b'.repeat(64), documentRevision: `sha256:${'b'.repeat(64)}`, availability: 'available' })
        return { voidId, revisionId, objectiveId, planRevisionId, sessionId, snapshotId, sourceIdentityId, manifestId, manifestFolderId, manifestEntryId }
      })
      await t.run(async ctx => {
        const contentId = await ctx.db.insert('sessionContent', { userId: USER_A.tokenIdentifier, studySessionId: ids.sessionId, revision: 1, status: 'draft', createdAt: 1 })
        const claimId = await ctx.db.insert('sessionContentClaims', { userId: USER_A.tokenIdentifier, sessionContentId: contentId, order: 1, claim: 'Claim' })
        const excerptId = await ctx.db.insert('learnSourceExcerpts', { userId: USER_A.tokenIdentifier, sourceSnapshotId: ids.snapshotId, locator: 'public', privateLocator: 'https://private.example/locator', excerpt: 'protected', rightsStatus: 'permitted' })
        await ctx.db.insert('learnSourceFetchLeases', { userId: USER_A.tokenIdentifier, learningVoidId: ids.voidId, sourceSnapshotId: ids.snapshotId, idempotencyKeyHash: 'sha256:private-fetch-key', requestFingerprint: 'private-fetch-fingerprint', leaseToken: 'private-lease-token', expiresAt: 2, createdAt: 1 })
        await ctx.db.insert('learnSourceFetchRateEvents', { userId: USER_A.tokenIdentifier, learningVoidId: ids.voidId, sourceSnapshotId: ids.snapshotId, createdAt: 1, expiresAt: 2 })
        await ctx.db.insert('learnSourceCommandReceipts', { userId: USER_A.tokenIdentifier, learningVoidId: ids.voidId, sourceSnapshotId: ids.snapshotId, idempotencyKeyHash: 'sha256:private-command-key', command: 'fetch_source', requestFingerprint: 'private-command-fingerprint', response: '{"private":"secret"}', createdAt: 1 })
        await ctx.db.insert('learnClaimSupports', { userId: USER_A.tokenIdentifier, sessionContentClaimId: claimId, sourceExcerptId: excerptId, entailment: 'entailed', conflictStatus: 'clear' })
        await ctx.db.insert('learnMilestones', { userId: USER_A.tokenIdentifier, blueprintRevisionId: ids.revisionId, order: 1, title: 'Milestone' })
        await ctx.db.insert('learnObjectivePrerequisites', { userId: USER_A.tokenIdentifier, blueprintRevisionId: ids.revisionId, objectiveId: ids.objectiveId, prerequisiteObjectiveId: ids.objectiveId })
        await ctx.db.insert('learnObjectiveSources', { userId: USER_A.tokenIdentifier, objectiveId: ids.objectiveId, sourceSnapshotId: ids.snapshotId, coverage: 'strong' })
        await ctx.db.insert('masteryAttempts', { userId: USER_A.tokenIdentifier, blueprintRevisionId: ids.revisionId, objectiveId: ids.objectiveId, studySessionId: ids.sessionId, sessionContentId: contentId, studyPlanRevisionId: ids.planRevisionId, attemptedAt: 1, idempotencyKey: 'private-attempt-key', requestFingerprint: 'private-attempt-fingerprint', response: 'private learner response', criterionResultsJson: '[{"private":true}]', misconceptionTagsJson: '["private-misconception"]', rubricSnapshot: '{"private":true}', scorerModel: 'private-provider-model', verifierVersionsJson: '["private-verifier"]', sourceSnapshotIdsJson: '["private-source"]' })
        await ctx.db.insert('masteryRecords', { userId: USER_A.tokenIdentifier, objectiveId: ids.objectiveId, state: 'learning' })
        await ctx.db.insert('studySessionRetrievalObjectives', { userId: USER_A.tokenIdentifier, studySessionId: ids.sessionId, objectiveId: ids.objectiveId, order: 1 })
        await ctx.db.insert('sessionContentBlocks', { userId: USER_A.tokenIdentifier, sessionContentId: contentId, order: 1, kind: 'prompt' })
        const calendarConnectionId = await ctx.db.insert('calendarConnections', {
          userId: USER_A.tokenIdentifier,
          provider: 'google',
          accessToken: 'private-access-token',
          refreshToken: 'private-refresh-token',
          expiresAt: 10,
          timezone: 'UTC',
          status: 'connected',
          connectedAt: 1,
        })
        await ctx.db.insert('calendarProjections', {
          userId: USER_A.tokenIdentifier,
          calendarConnectionId,
          studySessionId: ids.sessionId,
          studyPlanRevisionId: ids.planRevisionId,
          pinnedPlanRevision: 1,
          pinnedSessionRevision: 1,
          provider: 'google',
          externalEventId: 'private-provider-event-id',
          status: 'projected',
          privateMetadata: '{"private":"metadata"}',
          providerEtag: 'private-etag',
          providerVersion: 'private-version',
          providerCreateLeaseToken: 'private-provider-lease',
          providerCreateLeaseExpiresAt: 10,
          createdAt: 1,
          updatedAt: 1,
        })
        await ctx.db.insert('reminderPolicies', { userId: USER_A.tokenIdentifier, learningVoidId: ids.voidId, timezone: 'UTC', channel: 'local' })
        const bucketId = await ctx.db.insert('searchQuotaBuckets', { userId: USER_A.tokenIdentifier, learningVoidId: ids.voidId, provider: 'tavily_free', scopeKind: 'learning_void_broad', scopeKey: 'secret', periodKey: 'lifetime', limit: 2, providerUsageBaseline: 9, providerReportedUsageObservedAt: 10, reservedCredits: 1, consumedCredits: 0, revision: 1, reconciliationStatus: 'matched', createdAt: 1, updatedAt: 1 })
        await ctx.db.insert('searchReservations', { userId: USER_A.tokenIdentifier, learningVoidId: ids.voidId, blueprintRevisionId: ids.revisionId, expectedVoidRevision: 1, expectedBlueprintRecordRevision: 1, voidScopeKey: 'secret', provider: 'tavily_free', searchClass: 'broad', status: 'reserved', dispatchState: 'started', reconciliationRequired: true, productMonthBucketId: bucketId, productDayBucketId: bucketId, userDayBucketId: bucketId, learningVoidBucketId: bucketId, productMonthPeriodKey: '2026-01', productDayPeriodKey: '2026-01-01', userDayPeriodKey: '2026-01-01', learningVoidPeriodKey: 'lifetime', expectedCredits: 1, idempotencyKeyHash: 'sha256:private-key', requestFingerprint: 'sha256:private-fingerprint', queryDigest: 'sha256:private-query', executionTokenHash: 'sha256:private-token', reconciliationKeyHash: 'sha256:private-reconciliation-key', reconciliationRequestFingerprint: 'sha256:private-reconciliation-fingerprint', providerUsageBeforeDispatch: 17, ownerDeletedAt: 3, revision: 1, createdAt: 1, updatedAt: 1, expiresAt: 2, dispatchedAt: 2, outcomeCode: 'private-outcome' })
        const jobId = await ctx.db.insert('learnJobs', { userId: USER_A.tokenIdentifier, learningVoidId: ids.voidId, blueprintRevisionId: ids.revisionId, type: 'private', status: 'queued', revision: 1, idempotencyKey: 'j', requestFingerprint: 'secret', inputDigest: 'secret', candidateDigest: 'secret', expectedVoidRevision: 1, expectedBlueprintRecordRevision: 1, providerResponseId: 'secret-provider-request', leaseToken: 'secret', leaseExpiresAt: 1, checkpoint: 'secret', terminalReason: 'secret' })
        await ctx.db.insert('learnMasteryScoringRateEvents', { userId: USER_A.tokenIdentifier, jobId, createdAt: 1, expiresAt: 2 })
        await ctx.db.insert('learnLifecycleReceipts', { userId: USER_A.tokenIdentifier, learningVoidId: ids.voidId, idempotencyKey: 'receipt', command: 'create', requestFingerprint: 'private', revision: 1, blueprintRevisionId: ids.revisionId, blueprintRevisionOrdinal: 1, blueprintRecordRevision: 1, createdAt: 1 })
        await ctx.db.insert('learnPlanCommandReceipts', { userId: USER_A.tokenIdentifier, learningVoidId: ids.voidId, idempotencyKey: 'plan-receipt', command: 'plan', requestFingerprint: 'private', response: '{"private":true}', createdAt: 1 })
        await ctx.db.insert('learnPlanAuditEvents', { userId: USER_A.tokenIdentifier, learningVoidId: ids.voidId, reasonCode: 'preview_feasible', details: '{"pinned":true}', createdAt: 1 })
      })
      for (const collection of collections) expect((await asUser.query(api.dataExport.getUserDataPage, { collection, paginationOpts: { cursor: null, numItems: 8 } })).page).toHaveLength(1)
      expect((await asUser.query(api.dataExport.getUserDataPage, { collection: 'learnSourceExcerpts', paginationOpts: { cursor: null, numItems: 8 } })).page[0]).not.toHaveProperty('excerpt')
      expect((await asUser.query(api.dataExport.getUserDataPage, { collection: 'learnSourceExcerpts', paginationOpts: { cursor: null, numItems: 8 } })).page[0]).not.toHaveProperty('privateLocator')
      const blueprintRevision = (await asUser.query(api.dataExport.getUserDataPage, { collection: 'learnBlueprintRevisions', paginationOpts: { cursor: null, numItems: 8 } })).page[0]
      expect(blueprintRevision).not.toHaveProperty('generationInputDigest')
      expect(blueprintRevision).not.toHaveProperty('generationRequestId')
      const masteryAttempt = (await asUser.query(api.dataExport.getUserDataPage, { collection: 'masteryAttempts', paginationOpts: { cursor: null, numItems: 8 } })).page[0]
      expect(masteryAttempt).not.toHaveProperty('idempotencyKey')
      expect(masteryAttempt).not.toHaveProperty('requestFingerprint')
      for (const key of ['response', 'criterionResultsJson', 'misconceptionTagsJson', 'rubricSnapshot', 'scorerModel', 'verifierVersionsJson', 'sourceSnapshotIdsJson', 'studySessionId', 'sessionContentId', 'studyPlanRevisionId', 'blueprintRevisionId', 'objectiveId']) expect(masteryAttempt).not.toHaveProperty(key)
      const sourceIdentity = (await asUser.query(api.dataExport.getUserDataPage, { collection: 'learnSourceIdentities', paginationOpts: { cursor: null, numItems: 8 } })).page[0]
      expect(sourceIdentity).not.toHaveProperty('externalKey')
      expect(sourceIdentity).not.toHaveProperty('canonicalUrl')
      expect(sourceIdentity).not.toHaveProperty('privateLocator')
      expect(sourceIdentity).not.toHaveProperty('folderDocumentId')
      expect(sourceIdentity).not.toHaveProperty('title')
      expect(sourceIdentity).toMatchObject({ publicLocator: 'https://example.com/' })
      expect(JSON.stringify(sourceIdentity)).not.toContain('identity-secret')
      const sourceSnapshot = (await asUser.query(api.dataExport.getUserDataPage, { collection: 'learnSourceSnapshots', paginationOpts: { cursor: null, numItems: 8 } })).page[0]
      expect(sourceSnapshot).not.toHaveProperty('sourceIdentityId')
      expect(sourceSnapshot).not.toHaveProperty('folderManifestId')
      expect(sourceSnapshot).not.toHaveProperty('objectKey')
      expect(sourceSnapshot).not.toHaveProperty('folderId')
      expect(sourceSnapshot).not.toHaveProperty('filename')
      expect(sourceSnapshot).not.toHaveProperty('privateLocator')
      expect(sourceSnapshot).toMatchObject({ publicLocator: 'https://example.com/' })
      expect(JSON.stringify(sourceSnapshot)).not.toContain('snapshot-secret')
      const lease = (await asUser.query(api.dataExport.getUserDataPage, { collection: 'learnSourceFetchLeases', paginationOpts: { cursor: null, numItems: 8 } })).page[0]
      expect(lease).not.toHaveProperty('leaseToken')
      expect(lease).not.toHaveProperty('requestFingerprint')
      expect(lease).not.toHaveProperty('idempotencyKey')
      expect(lease).not.toHaveProperty('idempotencyKeyHash')
      expect(JSON.stringify(lease)).not.toContain('private-fetch-key')
      const sourceReceipt = (await asUser.query(api.dataExport.getUserDataPage, { collection: 'learnSourceCommandReceipts', paginationOpts: { cursor: null, numItems: 8 } })).page[0]
      expect(sourceReceipt).not.toHaveProperty('response')
      expect(sourceReceipt).not.toHaveProperty('requestFingerprint')
      expect(sourceReceipt).not.toHaveProperty('idempotencyKey')
      expect(sourceReceipt).not.toHaveProperty('idempotencyKeyHash')
      expect(JSON.stringify(sourceReceipt)).not.toContain('private-command-key')
      const manifest = (await asUser.query(api.dataExport.getUserDataPage, { collection: 'learnFolderSourceManifests', paginationOpts: { cursor: null, numItems: 8 } })).page[0]
      expect(manifest).not.toHaveProperty('idempotencyKey')
      expect(manifest).not.toHaveProperty('requestFingerprint')
      expect(manifest).not.toHaveProperty('explicitDocumentIds')
      expect(manifest).not.toHaveProperty('rootFolderId')
      const manifestFolder = (await asUser.query(api.dataExport.getUserDataPage, { collection: 'learnFolderSourceManifestFolders', paginationOpts: { cursor: null, numItems: 8 } })).page[0]
      expect(manifestFolder).not.toHaveProperty('folderId')
      expect(manifestFolder).not.toHaveProperty('name')
      expect(manifestFolder).not.toHaveProperty('childCursor')
      const manifestEntry = (await asUser.query(api.dataExport.getUserDataPage, { collection: 'learnFolderSourceManifestEntries', paginationOpts: { cursor: null, numItems: 8 } })).page[0]
      expect(manifestEntry).not.toHaveProperty('documentId')
      expect(manifestEntry).not.toHaveProperty('folderId')
      expect(manifestEntry).not.toHaveProperty('sourceIdentityId')
      expect(manifestEntry).not.toHaveProperty('sourceSnapshotId')
      const claimSupport = (await asUser.query(api.dataExport.getUserDataPage, { collection: 'learnClaimSupports', paginationOpts: { cursor: null, numItems: 8 } })).page[0]
      expect(claimSupport).not.toHaveProperty('sourceExcerptId')
      expect(claimSupport).not.toHaveProperty('sessionContentClaimId')
      const calendarProjection = (await asUser.query(api.dataExport.getUserDataPage, { collection: 'calendarProjections', paginationOpts: { cursor: null, numItems: 8 } })).page[0]
      for (const key of ['calendarConnectionId', 'provider', 'externalEventId', 'privateMetadata', 'providerEtag', 'providerVersion', 'providerCreateLeaseToken']) expect(calendarProjection).not.toHaveProperty(key)
      expect(JSON.stringify(calendarProjection)).not.toContain('private-')
      expect((await asUser.query(api.dataExport.getUserDataPage, { collection: 'searchQuotaBuckets', paginationOpts: { cursor: null, numItems: 8 } })).page[0]).not.toHaveProperty('count')
      expect((await asUser.query(api.dataExport.getUserDataPage, { collection: 'searchQuotaBuckets', paginationOpts: { cursor: null, numItems: 8 } })).page[0]).not.toHaveProperty('providerUsageBaseline')
      expect((await asUser.query(api.dataExport.getUserDataPage, { collection: 'searchQuotaBuckets', paginationOpts: { cursor: null, numItems: 8 } })).page[0]).not.toHaveProperty('providerReportedUsageObservedAt')
      expect((await asUser.query(api.dataExport.getUserDataPage, { collection: 'learnJobs', paginationOpts: { cursor: null, numItems: 8 } })).page[0]).not.toHaveProperty('checkpoint')
      const reservation = (await asUser.query(api.dataExport.getUserDataPage, { collection: 'searchReservations', paginationOpts: { cursor: null, numItems: 8 } })).page[0]
      expect(reservation).not.toHaveProperty('idempotencyKey')
      expect(reservation).not.toHaveProperty('idempotencyKeyHash')
      expect(reservation).not.toHaveProperty('requestFingerprint')
      expect(reservation).not.toHaveProperty('queryDigest')
      expect(reservation).not.toHaveProperty('executionTokenHash')
      expect(reservation).not.toHaveProperty('providerRequestIdHash')
      expect(reservation).not.toHaveProperty('reconciliationKeyHash')
      expect(reservation).not.toHaveProperty('reconciliationRequestFingerprint')
      expect(reservation).not.toHaveProperty('providerUsageBeforeDispatch')
      expect(reservation).not.toHaveProperty('ownerDeletedAt')
      expect(reservation).not.toHaveProperty('voidScopeKey')
      expect(reservation).not.toHaveProperty('provider')
      expect(Object.keys(reservation).sort()).toEqual([
        '_creationTime', '_id', 'blueprintRevisionId', 'createdAt', 'dispatchState', 'dispatchedAt', 'expiresAt',
        'learningVoidId', 'outcomeCode', 'reconciliationRequired', 'revision', 'searchClass', 'status', 'updatedAt', 'userId',
      ].sort())
      const job = (await asUser.query(api.dataExport.getUserDataPage, { collection: 'learnJobs', paginationOpts: { cursor: null, numItems: 8 } })).page[0]
      expect(job).not.toHaveProperty('idempotencyKey')
      expect(job).not.toHaveProperty('requestFingerprint')
      expect(job).not.toHaveProperty('inputDigest')
      expect(job).not.toHaveProperty('candidateDigest')
      expect(job).not.toHaveProperty('expectedVoidRevision')
      expect(job).not.toHaveProperty('expectedBlueprintRecordRevision')
      expect(job).not.toHaveProperty('providerResponseId')
      expect(job).not.toHaveProperty('leaseToken')
      expect(job).not.toHaveProperty('leaseExpiresAt')
      expect(job).not.toHaveProperty('checkpoint')
      expect(job).not.toHaveProperty('terminalReason')
      const receipt = (await asUser.query(api.dataExport.getUserDataPage, { collection: 'learnLifecycleReceipts', paginationOpts: { cursor: null, numItems: 8 } })).page[0]
      expect(receipt).not.toHaveProperty('idempotencyKey')
      expect(receipt).not.toHaveProperty('requestFingerprint')
      expect(receipt).not.toHaveProperty('entityId')
    } finally { if (previous === undefined) delete process.env.LEARN_V2_ENABLED; else process.env.LEARN_V2_ENABLED = previous }
  })
  test('caps each page at 8 rows and advances across multiple cursors', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)

    await t.run(async (ctx) => {
      for (let index = 0; index < 17; index++) {
        await ctx.db.insert('tasks', {
          userId: USER_A.tokenIdentifier,
          type: 'export-pagination-test',
          status: 'complete',
          title: `Task ${index}`,
          createdAt: index,
          updatedAt: index,
        })
      }
      await ctx.db.insert('tasks', {
        userId: USER_B.tokenIdentifier,
        type: 'export-pagination-test',
        status: 'complete',
        title: 'Other user task',
        createdAt: 0,
        updatedAt: 0,
      })
    })

    const first = await asUser.query(api.dataExport.getUserDataPage, {
      collection: 'tasks',
      paginationOpts: { cursor: null, numItems: 1_000 },
    })
    expect(first.page).toHaveLength(8)
    expect(first.isDone).toBe(false)
    expect(first.page.every(row => row.userId === USER_A.tokenIdentifier)).toBe(true)

    const second = await asUser.query(api.dataExport.getUserDataPage, {
      collection: 'tasks',
      paginationOpts: { cursor: first.continueCursor, numItems: 1_000 },
    })
    expect(second.page).toHaveLength(8)
    expect(second.isDone).toBe(false)
    expect(second.page.every(row => row.userId === USER_A.tokenIdentifier)).toBe(true)

    const third = await asUser.query(api.dataExport.getUserDataPage, {
      collection: 'tasks',
      paginationOpts: { cursor: second.continueCursor, numItems: 1_000 },
    })
    expect(third.page).toHaveLength(1)
    expect(third.isDone).toBe(true)
    expect(third.page.every(row => row.userId === USER_A.tokenIdentifier)).toBe(true)
  })

  test('returns only the authenticated user rows', async () => {
    const t = convexTest(schema, modules)

    const a = await seedUser(t, USER_A)
    await seedUser(t, USER_B)

    const result = await collectUserDataForTest(a.asUser)

    expect(result.userId).toBe(USER_A.tokenIdentifier)
    expect(result.folders.every((f: any) => f.userId === USER_A.tokenIdentifier)).toBe(true)
    expect(result.documents.every((d: any) => d.userId === USER_A.tokenIdentifier)).toBe(true)
    expect(result.conversations.every((c: any) => c.userId === USER_A.tokenIdentifier)).toBe(true)
    expect(result.messages.every((m: any) => m.userId === USER_A.tokenIdentifier)).toBe(true)

    expect(result.folders.length).toBe(1)
    expect(result.documents.length).toBe(1)
    expect(result.conversations.length).toBe(1)
    expect(result.messages.length).toBe(1)
  })

  test('throws Unauthenticated when no identity is attached', async () => {
    const t = convexTest(schema, modules)
    await expect(t.query(api.dataExport.getExportMetadata, {})).rejects.toThrow(/Unauthenticated/)
    await expect(t.query(api.dataExport.getUserDataPage, {
      collection: 'documents',
      paginationOpts: { cursor: null, numItems: 10 },
    })).rejects.toThrow(/Unauthenticated/)
  })

  test('does not expose child pages through another user parent id', async () => {
    const t = convexTest(schema, modules)
    const a = await seedUser(t, USER_A)
    const b = await seedUser(t, USER_B)

    const questions = [{
      order: 0,
      question: 'Q1',
      type: 'free-response' as const,
      correctAnswer: 'A1',
      sourceChunkContent: 'c1',
      sourceFilename: 'f.pdf',
    }]
    const quiz = await a.asUser.mutation(api.quizzes.createWithQuestions, {
      folderId: a.folderId,
      title: 'Private quiz',
      questions,
    })
    const question = await t.run(async ctx => await ctx.db
      .query('quizQuestions')
      .withIndex('by_quizId', q => q.eq('quizId', quiz.quizId))
      .unique())
    const attempt = await a.asUser.mutation(api.quizzes.submitAttempt, {
      quizId: quiz.quizId,
      answers: [{ questionId: question!._id, response: 'A1' }],
    })

    expect(await b.asUser.query(api.dataExport.getAttemptAnswersPage, {
      attemptId: attempt.attemptId,
      paginationOpts: { cursor: null, numItems: 10 },
    })).toBeNull()

    const course = await a.asUser.mutation(api.courses.create, {
      folderId: a.folderId,
      title: 'Private course',
      sourceType: 'folder',
      documentIds: [],
    })
    expect(await b.asUser.query(api.dataExport.getCourseSourceDocsPage, {
      courseId: course.courseId,
      paginationOpts: { cursor: null, numItems: 10 },
    })).toBeNull()
  })

  test('returns empty arrays for a user with no data', async () => {
    const t = convexTest(schema, modules)
    const asUser = t.withIdentity(USER_A)

    const result = await collectUserDataForTest(asUser)

    expect(result.folders).toEqual([])
    expect(result.documents).toEqual([])
    expect(result.conversations).toEqual([])
    expect(result.messages).toEqual([])
    expect(result.quizzes).toEqual([])
    expect(result.quizQuestions).toEqual([])
    expect(result.quizAttempts).toEqual([])
    expect(result.attemptAnswers).toEqual([])
    expect(result.flashcardSets).toEqual([])
    expect(result.flashcards).toEqual([])
    expect(result.flashcardRooms).toEqual([])
    expect(result.flashcardRoomCards).toEqual([])
    expect(result.flashcardRoomVersions).toEqual([])
    expect(result.flashcardVersionCards).toEqual([])
    expect(result.tasks).toEqual([])
    expect(result.reviewItems).toEqual([])
    expect(result.reviewSessions).toEqual([])
    expect(result.calendarConnections).toEqual([])
    expect(result.calendarEvents).toEqual([])
    expect(result.audioOverviews).toEqual([])
    expect(result.audioOverviewJobs).toEqual([])
  })

  test('returns flashcardRooms + roomCards scoped to the caller', async () => {
    const t = convexTest(schema, modules)
    const a = await seedUser(t, USER_A)
    const b = await seedUser(t, USER_B)

    const { roomId: aRoom } = await a.asUser.mutation(api.flashcardRooms.createRoom, {
      folderId: a.folderId,
      title: 'Alice Room',
    })
    await a.asUser.mutation(api.flashcardRooms.createCard, { roomId: aRoom, term: 'F1', definition: 'B1' })
    await a.asUser.mutation(api.flashcardRooms.createCard, { roomId: aRoom, term: 'F2', definition: 'B2' })

    const { roomId: bRoom } = await b.asUser.mutation(api.flashcardRooms.createRoom, {
      folderId: b.folderId,
      title: 'Bob Room',
    })
    await b.asUser.mutation(api.flashcardRooms.createCard, { roomId: bRoom, term: 'F1', definition: 'B1' })

    const result = await collectUserDataForTest(a.asUser)

    expect(result.flashcardRooms).toHaveLength(1)
    expect(result.flashcardRooms[0]!.title).toBe('Alice Room')
    expect(result.flashcardRoomCards).toHaveLength(2)
    expect(result.flashcardRoomCards.every((c: any) => c.userId === USER_A.tokenIdentifier)).toBe(true)
  })

  test('returns quizzes + quizQuestions scoped to the caller', async () => {
    const t = convexTest(schema, modules)
    const a = await seedUser(t, USER_A)
    const b = await seedUser(t, USER_B)

    const questions = [
      {
        order: 0,
        question: 'Q1',
        type: 'free-response' as const,
        correctAnswer: 'A1',
        sourceChunkContent: 'c1',
        sourceFilename: 'f.pdf',
      },
      {
        order: 1,
        question: 'Q2',
        type: 'free-response' as const,
        correctAnswer: 'A2',
        sourceChunkContent: 'c2',
        sourceFilename: 'f.pdf',
      },
    ]

    await a.asUser.mutation(api.quizzes.createWithQuestions, {
      folderId: a.folderId,
      title: 'Alice Quiz',
      questions,
    })
    await b.asUser.mutation(api.quizzes.createWithQuestions, {
      folderId: b.folderId,
      title: 'Bob Quiz',
      questions,
    })

    const result = await collectUserDataForTest(a.asUser)

    expect(result.quizzes).toHaveLength(1)
    expect(result.quizzes[0]!.title).toBe('Alice Quiz')
    expect(result.quizzes.every((q: any) => q.userId === USER_A.tokenIdentifier)).toBe(true)
    expect(result.quizQuestions).toHaveLength(2)
    expect(result.quizQuestions.every((q: any) => q.userId === USER_A.tokenIdentifier)).toBe(true)
  })

  test('returns quizAttempts scoped to the caller (Story 6.2)', async () => {
    const t = convexTest(schema, modules)
    const a = await seedUser(t, USER_A)
    const b = await seedUser(t, USER_B)

    const questions = [
      {
        order: 0,
        question: 'Q1',
        type: 'free-response' as const,
        correctAnswer: 'A1',
        sourceChunkContent: 'c1',
        sourceFilename: 'f.pdf',
      },
    ]

    const aQuiz = await a.asUser.mutation(api.quizzes.createWithQuestions, {
      folderId: a.folderId,
      title: 'A',
      questions,
    })
    const bQuiz = await b.asUser.mutation(api.quizzes.createWithQuestions, {
      folderId: b.folderId,
      title: 'B',
      questions,
    })

    const aQs = await t.run(async (ctx) =>
      ctx.db.query('quizQuestions').withIndex('by_quizId', (q) => q.eq('quizId', aQuiz.quizId)).collect(),
    )
    const bQs = await t.run(async (ctx) =>
      ctx.db.query('quizQuestions').withIndex('by_quizId', (q) => q.eq('quizId', bQuiz.quizId)).collect(),
    )

    const aAttempt = await a.asUser.mutation(api.quizzes.submitAttempt, {
      quizId: aQuiz.quizId,
      answers: [{ questionId: aQs[0]!._id, response: 'A1' }],
    })
    const bAttempt = await b.asUser.mutation(api.quizzes.submitAttempt, {
      quizId: bQuiz.quizId,
      answers: [{ questionId: bQs[0]!._id, response: 'A1' }],
    })
    await t.run(async (ctx) => {
      await ctx.db.insert('attemptAnswers', {
        attemptId: aAttempt.attemptId,
        questionId: aQs[0]!._id,
        userAnswer: 'A1',
        isCorrect: true,
        answeredAt: Date.now(),
      })
      await ctx.db.insert('attemptAnswers', {
        attemptId: bAttempt.attemptId,
        questionId: bQs[0]!._id,
        userAnswer: 'A1',
        isCorrect: true,
        answeredAt: Date.now(),
      })
    })

    const result = await collectUserDataForTest(a.asUser)

    expect(result.quizAttempts).toHaveLength(1)
    expect(result.quizAttempts.every((a: any) => a.userId === USER_A.tokenIdentifier)).toBe(true)
    expect(result.attemptAnswers).toHaveLength(1)
    expect(result.attemptAnswers[0]!.attemptId).toBe(aAttempt.attemptId)
  })

  test('exports calendar metadata for the caller without OAuth credentials', async () => {
    const t = convexTest(schema, modules)
    const a = await seedUser(t, USER_A)
    const b = await seedUser(t, USER_B)

    await a.asUser.mutation(api.calendarConnections.upsertConnection, {
      provider: 'google',
      accessToken: 'alice-access-token',
      refreshToken: 'alice-refresh-token',
      expiresAt: Date.now() + 3_600_000,
      timezone: 'America/Toronto',
    })
    await b.asUser.mutation(api.calendarConnections.upsertConnection, {
      provider: 'google',
      accessToken: 'bob-access-token',
      refreshToken: 'bob-refresh-token',
      expiresAt: Date.now() + 3_600_000,
      timezone: 'Europe/London',
    })

    const result = await collectUserDataForTest(a.asUser)
    expect(result.calendarConnections).toHaveLength(1)
    expect(result.calendarConnections[0]).toMatchObject({
      userId: USER_A.tokenIdentifier,
      provider: 'google',
      timezone: 'America/Toronto',
    })
    expect(result.calendarConnections[0]).not.toHaveProperty('accessToken')
    expect(result.calendarConnections[0]).not.toHaveProperty('refreshToken')
  })

  test('returns flashcardRooms + roomCards + versions + versionCards scoped to the caller', async () => {
    const t = convexTest(schema, modules)
    const a = await seedUser(t, USER_A)
    const b = await seedUser(t, USER_B)

    const { roomId } = await a.asUser.mutation(api.flashcardRooms.createRoom, {
      folderId: a.folderId,
      title: 'Alice Room',
    })
    await a.asUser.mutation(api.flashcardRooms.generateRoomCards, {
      roomId,
      origin: 'ai',
      title: 'Gen',
      cards: [
        { term: 'T1', definition: 'D1', metadata: { source: { filename: 'f.pdf', chunkContent: 'c' } } },
      ],
    })

    const { roomId: bRoom } = await b.asUser.mutation(api.flashcardRooms.createRoom, {
      folderId: b.folderId,
      title: 'Bob Room',
    })
    await b.asUser.mutation(api.flashcardRooms.createCard, {
      roomId: bRoom, term: 'BT', definition: 'BD',
    })

    const result = await collectUserDataForTest(a.asUser)
    expect(result.flashcardRooms).toHaveLength(1)
    expect(result.flashcardRoomCards).toHaveLength(1)
    expect(result.flashcardRoomVersions).toHaveLength(1)
    expect(result.flashcardVersionCards).toHaveLength(1)
    expect(result.flashcardRooms[0]!.title).toBe('Alice Room')
  })

  test('returned rows contain expected fields', async () => {
    const t = convexTest(schema, modules)
    const a = await seedUser(t, USER_A)

    const result = await collectUserDataForTest(a.asUser)

    const doc = result.documents[0]!
    expect(doc).toHaveProperty('filename')
    expect(doc).toHaveProperty('fileId')
    expect(doc).toHaveProperty('status')

    const folder = result.folders[0]!
    expect(folder).toHaveProperty('name')

    const convo = result.conversations[0]!
    expect(convo).toHaveProperty('title')

    const msg = result.messages[0]!
    expect(msg).toHaveProperty('role')
    expect(msg).toHaveProperty('content')
  })
})

describe('dataExport.getDocumentDownloadUrl', () => {
  test('returns a URL for the owner of the document', async () => {
    const t = convexTest(schema, modules)
    const a = await seedUser(t, USER_A)

    const result = await a.asUser.query(api.dataExport.getDocumentDownloadUrl, {
      documentId: a.docId,
    })

    expect(result).not.toBeNull()
    expect(result!.filename).toBe('Alice-file.pdf')
    expect(typeof result!.url === 'string' || result!.url === null).toBe(true)
  })

  test('returns null for a document owned by another user', async () => {
    const t = convexTest(schema, modules)
    const a = await seedUser(t, USER_A)
    const bAsUser = t.withIdentity(USER_B)

    const result = await bAsUser.query(api.dataExport.getDocumentDownloadUrl, {
      documentId: a.docId,
    })

    expect(result).toBeNull()
  })

  test('throws Unauthenticated without an identity', async () => {
    const t = convexTest(schema, modules)
    const a = await seedUser(t, USER_A)

    await expect(
      t.query(api.dataExport.getDocumentDownloadUrl, { documentId: a.docId }),
    ).rejects.toThrow(/Unauthenticated/)
  })
})
