/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterAll, beforeEach, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const identity = { tokenIdentifier: 'https://auth.example.com|contribution-owner' }
const originalFlag = process.env.LEARN_V2_ENABLED
const paginationOpts = { numItems: 50, cursor: null }
beforeEach(() => { process.env.LEARN_V2_ENABLED = 'true' })
afterAll(() => { if (originalFlag === undefined) delete process.env.LEARN_V2_ENABLED; else process.env.LEARN_V2_ENABLED = originalFlag })

test('a source-attributed contribution can be retried and exported without private content', async () => {
  const t = convexTest(schema, modules)
  const owner = t.withIdentity(identity)
  await owner.mutation(api.users.upsertUser, {})
  await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: identity.tokenIdentifier, enabled: true })
  await owner.mutation(internal.learnAdaptiveAccess.setCohortEntitlement, { enabled: true })
  const draft = await owner.mutation(api.learnAdaptiveDrafts.createThreadDraft, {
    need: 'Understand photosynthesis', outcome: 'Explain it', intent: 'understand', availableTime: '25', sourceScope: { kind: 'none' }, idempotencyKey: 'contribution-draft-0001',
  })
  if (draft.kind !== 'created') throw new Error('Expected draft')
  const threadId = draft.thread.id
  const sourceId = await t.run(async ctx => {
    const folderId = await ctx.db.insert('folders', { userId: identity.tokenIdentifier, name: 'Notes', documentCount: 0 })
    const conversationId = await ctx.db.insert('conversations', { userId: identity.tokenIdentifier, folderId, title: 'Biology' })
    return await ctx.db.insert('messages', { userId: identity.tokenIdentifier, conversationId, role: 'user', content: 'Private biology notes' })
  })
  const source = { feature: 'chat' as const, id: sourceId }
  const inspected = await owner.query(api.learnAdaptive.inspectContributionSource, { source })
  expect(inspected).toMatchObject({ status: 'available', revision: expect.stringMatching(/^sha256:/) })
  const args = { threadId, source: { ...source, revision: inspected.revision! }, contributionKind: 'context' as const,
    classification: 'non_factual' as const, metadata: { role: 'background' as const }, expectedRevision: 1, idempotencyKey: 'contribution-submit-0001' }
  const recorded = await owner.mutation(api.learnAdaptive.recordContribution, args)
  expect(recorded).toMatchObject({ kind: 'recorded', contributionId: expect.any(String) })
  if (recorded.kind !== 'recorded') throw new Error('Expected contribution')
  const persisted = await t.run(ctx => ctx.db.get(recorded.contributionId))
  const provenanceTuple = ['learn-thread-contribution.v1', identity.tokenIdentifier, String(threadId), 'chat', String(sourceId), args.source.revision, 'context']
  const provenanceBytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(provenanceTuple))))
  expect(persisted?.provenanceKey).toBe(`sha256:${[...provenanceBytes].map(byte => byte.toString(16).padStart(2, '0')).join('')}`)
  expect(await owner.mutation(api.learnAdaptive.recordContribution, args)).toMatchObject({ kind: 'recorded', contributionId: recorded.contributionId, replayed: true })
  const listed = await owner.query(api.learnAdaptive.listThreadContributions, { threadId, paginationOpts })
  expect(listed.page).toHaveLength(1)
  expect(JSON.stringify(listed.page)).not.toContain('Private biology notes')
  const exported = await owner.query(api.dataExport.getUserDataPage, { collection: 'learningThreadContributions', paginationOpts: { numItems: 100, cursor: null } })
  expect(exported.page).toHaveLength(1)
  expect(exported.page[0]).toMatchObject({ sourceFeature: 'chat', contributionKind: 'context', sourceIdentity: sourceId })
  expect(JSON.stringify(exported.page)).not.toContain('Private biology notes')
  expect(exported.page[0]).not.toHaveProperty('idempotencyKeyHash')
  expect(exported.page[0]).not.toHaveProperty('requestFingerprint')
  expect(exported.page[0]).not.toHaveProperty('provenanceKey')
  expect(await owner.mutation(api.learnAdaptive.recordContribution, { ...args, idempotencyKey: 'unsupported-source-0001', source: { ...args.source, feature: 'video' } }))
    .toMatchObject({ kind: 'rejected', code: 'unsupported_source' })
  expect(await owner.mutation(api.learnAdaptive.recordContribution, { ...args, idempotencyKey: 'unsupported-kind-0001', contributionKind: 'result' }))
    .toMatchObject({ kind: 'rejected', code: 'invalid_provenance' })
  expect(await owner.mutation(api.learnAdaptive.recordContribution, { ...args, idempotencyKey: 'oversized-payload-0001', source: { ...args.source, id: 'x'.repeat(5000) } }))
    .toMatchObject({ kind: 'rejected', code: 'oversized_payload' })
  expect(await owner.mutation(api.learnAdaptive.recordContribution, { ...args, idempotencyKey: 'x'.repeat(200) }))
    .toMatchObject({ kind: 'rejected', code: 'invalid_key' })
  expect(await owner.mutation(api.learnAdaptive.recordContribution, { ...args, classification: 'unknown' }))
    .toMatchObject({ kind: 'rejected', code: 'duplicate_key' })
  expect(await owner.mutation(api.learnAdaptive.recordContribution, { ...args, idempotencyKey: 'unverified-evidence-0001', classification: 'accepted_evidence' }))
    .toMatchObject({ kind: 'rejected', code: 'invalid_provenance' })
  const otherIdentity = { tokenIdentifier: 'https://auth.example.com|contribution-other' }
  const other = t.withIdentity(otherIdentity)
  await other.mutation(api.users.upsertUser, {})
  await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: otherIdentity.tokenIdentifier, enabled: true })
  await other.mutation(internal.learnAdaptiveAccess.setCohortEntitlement, { enabled: true })
  expect(await other.query(api.learnAdaptive.inspectContributionSource, { source })).toMatchObject({ status: 'unavailable' })
  expect(await other.mutation(api.learnAdaptive.recordContribution, args)).toMatchObject({ kind: 'rejected', code: 'thread_unavailable' })
  expect(await other.query(api.learnAdaptive.listThreadContributions, { threadId, paginationOpts })).toMatchObject({ page: [], isDone: true })
  const foreignMessageId = await t.run(async ctx => {
    const folderId = await ctx.db.insert('folders', { userId: otherIdentity.tokenIdentifier, name: 'Private', documentCount: 0 })
    const conversationId = await ctx.db.insert('conversations', { userId: otherIdentity.tokenIdentifier, folderId, title: 'Private' })
    return await ctx.db.insert('messages', { userId: otherIdentity.tokenIdentifier, conversationId, role: 'user', content: 'Other learner secret' })
  })
  expect(await owner.mutation(api.learnAdaptive.recordContribution, {
    ...args, source: { feature: 'chat', id: foreignMessageId, revision: args.source.revision },
    idempotencyKey: 'foreign-source-0001',
  })).toMatchObject({ kind: 'rejected', code: 'source_unavailable' })
  const rejectedEvent = await t.run(ctx => ctx.db.query('learnActivityEvents')
    .withIndex('by_userId_and_eventType_and_occurredAt', q => q.eq('userId', identity.tokenIdentifier).eq('eventType', 'contribution_rejected')).first())
  expect(rejectedEvent).toMatchObject({ eventVersion: 'contribution_rejected.v1', outcomeCode: 'rejected' })
  const documentId = await t.run(async ctx => {
    const message = await ctx.db.get(sourceId)
    const conversation = await ctx.db.get(message!.conversationId)
    return await ctx.db.insert('documents', {
      userId: identity.tokenIdentifier, folderId: conversation!.folderId,
      filename: 'private.pdf', status: 'success', fileSize: 100, sourceRevision: 'document-v1', contentHash: 'document-hash-v1',
    })
  })
  const documentSource = { feature: 'documents' as const, id: documentId }
  const documentInspection = await owner.query(api.learnAdaptive.inspectContributionSource, { source: documentSource })
  const documentArgs = { ...args, source: { ...documentSource, revision: documentInspection.revision! }, contributionKind: 'source' as const, idempotencyKey: 'document-source-0001' }
  expect(await owner.mutation(api.learnAdaptive.recordContribution, documentArgs)).toMatchObject({ kind: 'recorded' })
  const evidence = await t.run(async ctx => {
    const document = await ctx.db.get(documentId)
    const learningVoidId = await ctx.db.insert('learningVoids', {
      userId: identity.tokenIdentifier, folderId: document!.folderId, title: 'Biology', status: 'draft', revision: 1, createdAt: 1, updatedAt: 1,
    })
    const sourceIdentityId = await ctx.db.insert('learnSourceIdentities', {
      userId: identity.tokenIdentifier, learningVoidId, origin: 'folder_document', externalKey: `document:${documentId}`, folderDocumentId: documentId,
    })
    const snapshotId = await ctx.db.insert('learnSourceSnapshots', {
      userId: identity.tokenIdentifier, learningVoidId, sourceIdentityId, revision: 1,
      status: 'user_accepted', effectiveStatus: 'user_accepted', rightsStatus: 'permitted', conflictStatus: 'clear',
      sourceRevision: 'document-v1', contentHash: 'document-hash-v1', createdAt: 1,
    })
    await ctx.db.insert('learnSourceExcerpts', {
      userId: identity.tokenIdentifier, sourceSnapshotId: snapshotId, locator: 'section-1', excerpt: 'Verified material', rightsStatus: 'permitted',
    })
    return { snapshotId, sourceIdentityId }
  })
  const acceptedArgs = {
    ...documentArgs, contributionKind: 'context', classification: 'accepted_evidence', evidenceSnapshotId: evidence.snapshotId,
    idempotencyKey: 'document-evidence-0001',
  } as const
  expect(await owner.mutation(api.learnAdaptive.recordContribution, acceptedArgs)).toMatchObject({ kind: 'recorded' })
  await t.run(ctx => ctx.db.patch(evidence.snapshotId, { effectiveStatus: 'unavailable' }))
  expect(await owner.mutation(api.learnAdaptive.recordContribution, acceptedArgs)).toMatchObject({ kind: 'rejected', code: 'evidence_unavailable' })
  await t.run(ctx => ctx.db.patch(evidence.snapshotId, { effectiveStatus: 'user_accepted' }))
  const wrongDocumentId = await t.run(async ctx => {
    const document = await ctx.db.get(documentId)
    return await ctx.db.insert('documents', {
      userId: identity.tokenIdentifier, folderId: document!.folderId, filename: 'other.pdf',
      status: 'success', fileSize: 50, sourceRevision: 'document-v1', contentHash: 'document-hash-v1',
    })
  })
  const wrongSource = await owner.query(api.learnAdaptive.inspectContributionSource, { source: { feature: 'documents', id: wrongDocumentId } })
  expect(await owner.mutation(api.learnAdaptive.recordContribution, {
    ...documentArgs, source: { feature: 'documents', id: wrongDocumentId, revision: wrongSource.revision! },
    classification: 'accepted_evidence', evidenceSnapshotId: evidence.snapshotId,
    idempotencyKey: 'wrong-evidence-source-0001',
  })).toMatchObject({ kind: 'rejected', code: 'evidence_unavailable' })
  expect(await t.mutation(internal.learnV2Retention.purgeSourceEvidence, {
    userId: identity.tokenIdentifier, sourceIdentityId: evidence.sourceIdentityId,
  })).toMatchObject({ pending: true })
  const afterEvidencePurge = await t.run(ctx => ctx.db.query('learningThreadContributions')
    .withIndex('by_userId_and_evidenceSnapshotId', q => q.eq('userId', identity.tokenIdentifier).eq('evidenceSnapshotId', evidence.snapshotId)).take(1))
  expect(afterEvidencePurge).toEqual([])
  expect((await owner.query(api.learnAdaptive.listThreadContributions, { threadId,
    paginationOpts: { numItems: 10, cursor: null },
  })).page).toContainEqual(expect.objectContaining({ classification: 'accepted_evidence', evidenceIntegrity: 'unavailable' }))
  await t.mutation(internal.learnV2Retention.purgeFolderDocumentSources, { userId: identity.tokenIdentifier, documentId })
  const afterPurge = await owner.query(api.dataExport.getUserDataPage, { collection: 'learningThreadContributions', paginationOpts: { numItems: 100, cursor: null } })
  type ExportedContribution = Extract<(typeof afterPurge.page)[number], { sourceFeature: string }>
  const documentRows = afterPurge.page.filter((row): row is ExportedContribution => 'sourceFeature' in row && row.sourceFeature === 'documents')
  expect(documentRows).toHaveLength(2)
  expect(documentRows.every(row => row.sourceIdentity === '[purged]' && row.sourceRevision === '[purged]' && row.sourceStatus === 'source_unavailable')).toBe(true)
  expect(await owner.mutation(api.learnAdaptive.recordContribution, documentArgs)).toMatchObject({ kind: 'rejected', code: 'source_unavailable' })
  const conversationId = await t.run(async ctx => (await ctx.db.get(sourceId))!.conversationId)
  for (let index = 0; index < 10; index++) {
    const messageId = await t.run(ctx => ctx.db.insert('messages', {
      userId: identity.tokenIdentifier, conversationId, role: 'user', content: `Private note ${index}`,
    }))
    const inspected = await owner.query(api.learnAdaptive.inspectContributionSource, { source: { feature: 'chat', id: messageId } })
    expect(await owner.mutation(api.learnAdaptive.recordContribution, {
      ...args, source: { feature: 'chat', id: messageId, revision: inspected.revision! },
      idempotencyKey: `paged-message-${index}-0001`,
    })).toMatchObject({ kind: 'recorded' })
  }
  const firstPage = await owner.query(api.dataExport.getUserDataPage, { collection: 'learningThreadContributions', paginationOpts: { numItems: 100, cursor: null } })
  expect(firstPage.page).toHaveLength(8)
  expect(firstPage.isDone).toBe(false)
  const secondPage = await owner.query(api.dataExport.getUserDataPage, { collection: 'learningThreadContributions', paginationOpts: { numItems: 100, cursor: firstPage.continueCursor } })
  expect(secondPage.page).toHaveLength(5)
  expect(secondPage.isDone).toBe(true)
  const listPage = await owner.query(api.learnAdaptive.listThreadContributions, { threadId, paginationOpts: { numItems: 8, cursor: null } })
  expect(listPage.page).toHaveLength(8)
  expect(listPage.isDone).toBe(false)
  const listRemainder = await owner.query(api.learnAdaptive.listThreadContributions, { threadId, paginationOpts: { numItems: 8, cursor: listPage.continueCursor } })
  expect(listRemainder.page).toHaveLength(5)
  expect(listRemainder.isDone).toBe(true)
  await t.run(ctx => ctx.db.patch(threadId, { revision: 2 }))
  expect(await owner.mutation(api.learnAdaptive.recordContribution, { ...args, expectedRevision: 2, idempotencyKey: 'canonical-origin-retry-0001' }))
    .toMatchObject({ kind: 'recorded', contributionId: recorded.contributionId, replayed: true, revision: 2 })
  expect(await owner.mutation(api.learnAdaptive.recordContribution, { ...args, expectedRevision: 2 }))
    .toMatchObject({ kind: 'recorded', contributionId: recorded.contributionId, replayed: true, revision: 2 })
  const event = await t.run(ctx => ctx.db.query('learnActivityEvents')
    .withIndex('by_userId_and_eventType_and_occurredAt', q => q.eq('userId', identity.tokenIdentifier).eq('eventType', 'contribution_recorded')).first())
  expect(event).toMatchObject({ eventType: 'contribution_recorded', eventVersion: 'contribution_recorded.v1', outcomeCode: 'recorded' })
  vi.useFakeTimers()
  try {
    await owner.mutation(api.learnAdaptive.requestThreadDeletion, { threadId })
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    expect(await t.run(ctx => ctx.db.query('learningThreadContributions').withIndex('by_userId', q => q.eq('userId', identity.tokenIdentifier)).take(1))).toEqual([])
  }
  finally { vi.useRealTimers() }
})

test('all supported source features require owned current records and revisions', async () => {
  const t = convexTest(schema, modules)
  const owner = t.withIdentity(identity)
  await owner.mutation(api.users.upsertUser, {})
  await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: identity.tokenIdentifier, enabled: true })
  await owner.mutation(internal.learnAdaptiveAccess.setCohortEntitlement, { enabled: true })
  const ids = await t.run(async ctx => {
    const folderId = await ctx.db.insert('folders', { userId: identity.tokenIdentifier, name: 'Sources', documentCount: 1 })
    const threadId = await ctx.db.insert('learningThreads', {
      userId: identity.tokenIdentifier, originalNeed: 'Review sources', intent: 'understand', availableTime: '15',
      authorityKind: 'standalone', sourceScope: { kind: 'none' }, evidenceState: 'none', lifecycle: 'active',
      revision: 1, createdAt: 1, updatedAt: 1,
    })
    const conversationId = await ctx.db.insert('conversations', { userId: identity.tokenIdentifier, folderId, title: 'Chat' })
    const chatId = await ctx.db.insert('messages', { userId: identity.tokenIdentifier, conversationId, role: 'user', content: 'Private message' })
    const quizId = await ctx.db.insert('quizzes', { userId: identity.tokenIdentifier, folderId, title: 'Quiz', status: 'ready' })
    const quizQuestionId = await ctx.db.insert('quizQuestions', {
      userId: identity.tokenIdentifier, quizId, order: 0, question: 'What is ATP?', type: 'free-response', correctAnswer: 'Energy carrier',
    })
    const flashcardRoomId = await ctx.db.insert('flashcardRooms', { userId: identity.tokenIdentifier, folderId, title: 'Cards', updatedAt: 1 })
    const flashcardsId = await ctx.db.insert('flashcardRoomVersions', { userId: identity.tokenIdentifier, roomId: flashcardRoomId, title: 'Cards v1', origin: 'manual', createdAt: 1 })
    const podcastId = await ctx.db.insert('audioOverviews', {
      userId: identity.tokenIdentifier, folderId, title: 'Audio', status: 'ready', turns: [],
      voiceProfile: { hostA: 'A', hostB: 'B' }, totalDurationMs: 0,
    })
    const documentsId = await ctx.db.insert('documents', {
      userId: identity.tokenIdentifier, folderId, filename: 'private.pdf', status: 'success', fileSize: 100,
    })
    return { threadId, chatId, quizId, quizQuestionId, flashcardsId, podcastId, documentsId }
  })
  const sources = [
    { feature: 'chat', id: ids.chatId, contributionKind: 'context' },
    { feature: 'quiz', id: ids.quizId, contributionKind: 'question' },
    { feature: 'flashcards', id: ids.flashcardsId, contributionKind: 'question' },
    { feature: 'podcast', id: ids.podcastId, contributionKind: 'context' },
    { feature: 'documents', id: ids.documentsId, contributionKind: 'source' },
  ] as const
  for (const [index, candidate] of sources.entries()) {
    const { contributionKind, ...source } = candidate
    const inspected = await owner.query(api.learnAdaptive.inspectContributionSource, { source })
    expect(inspected).toMatchObject({ status: 'available', revision: expect.stringMatching(/^sha256:/) })
    const result = await owner.mutation(api.learnAdaptive.recordContribution, {
      threadId: ids.threadId, source: { ...source, revision: inspected.revision! },
      contributionKind, classification: 'non_factual', metadata: {}, expectedRevision: 1,
      idempotencyKey: `source-feature-${index}-0001`,
    })
    expect(result).toMatchObject({ kind: 'recorded' })
  }
  expect((await owner.query(api.learnAdaptive.listThreadContributions, { threadId: ids.threadId, paginationOpts })).page).toHaveLength(5)
  const oldQuiz = await owner.query(api.learnAdaptive.inspectContributionSource, { source: { feature: 'quiz', id: ids.quizId } })
  await t.run(ctx => ctx.db.patch(ids.quizQuestionId, { correctAnswer: 'Energy carrier, revised' }))
  const revisedQuiz = await owner.query(api.learnAdaptive.inspectContributionSource, { source: { feature: 'quiz', id: ids.quizId } })
  expect(revisedQuiz.revision).not.toBe(oldQuiz.revision)
  expect(await owner.mutation(api.learnAdaptive.recordContribution, {
    threadId: ids.threadId, source: { feature: 'quiz', id: ids.quizId, revision: oldQuiz.revision! },
    contributionKind: 'question', classification: 'non_factual', metadata: {}, expectedRevision: 1,
    idempotencyKey: 'source-feature-1-0001',
  })).toMatchObject({ kind: 'rejected', code: 'source_revision_changed' })
  await t.run(ctx => ctx.db.patch(ids.quizId, { title: 'Revised quiz' }))
  expect(await owner.mutation(api.learnAdaptive.recordContribution, {
    threadId: ids.threadId, source: { feature: 'quiz', id: ids.quizId, revision: oldQuiz.revision! },
    contributionKind: 'context', classification: 'non_factual', metadata: {}, expectedRevision: 1,
    idempotencyKey: 'stale-source-0001',
  })).toMatchObject({ kind: 'rejected', code: 'source_revision_changed', recovery: 'refresh_source' })
  await t.run(ctx => ctx.db.patch(ids.chatId, { content: 'Edited but still owned' }))
  vi.useFakeTimers()
  try {
    await owner.mutation(api.quizzes.deleteQuiz, { quizId: ids.quizId })
    expect(await owner.mutation(api.learnAdaptive.recordContribution, {
      threadId: ids.threadId, source: { feature: 'quiz', id: ids.quizId, revision: oldQuiz.revision! },
      contributionKind: 'question', classification: 'non_factual', metadata: {}, expectedRevision: 1,
      idempotencyKey: 'source-feature-1-0001',
    })).toMatchObject({ kind: 'rejected', code: 'source_unavailable' })
    await t.finishAllScheduledFunctions(vi.runAllTimers)
  }
  finally { vi.useRealTimers() }
  expect(await owner.query(api.learnAdaptive.inspectContributionSource, { source: { feature: 'quiz', id: ids.quizId } })).toMatchObject({ status: 'unavailable' })
  expect((await owner.query(api.learnAdaptive.listThreadContributions, { threadId: ids.threadId, paginationOpts })).page).toContainEqual(expect.objectContaining({ sourceFeature: 'quiz', sourceStatus: 'source_unavailable', sourceIdentity: '[purged]' }))
  expect((await owner.query(api.learnAdaptive.listThreadContributions, { threadId: ids.threadId, paginationOpts })).page).toContainEqual(expect.objectContaining({ sourceFeature: 'chat', sourceStatus: 'available', sourceIdentity: ids.chatId }))
  expect(await t.run(ctx => ctx.db.get(ids.threadId))).toMatchObject({ revision: 1 })
})

test('account deletion removes contribution children in bounded batches before their thread', async () => {
  const t = convexTest(schema, modules)
  const threadId = await t.run(async ctx => {
    const now = Date.now()
    const id = await ctx.db.insert('learningThreads', {
      userId: identity.tokenIdentifier, originalNeed: 'Delete account', intent: 'explore', availableTime: '15',
      authorityKind: 'standalone', sourceScope: { kind: 'none' }, evidenceState: 'none', lifecycle: 'ready',
      revision: 1, createdAt: now, updatedAt: now,
    })
    for (let index = 0; index < 10; index++) await ctx.db.insert('learningThreadContributions', {
      userId: identity.tokenIdentifier, threadId: id, sourceFeature: 'documents', sourceIdentity: `document-${index}`,
      sourceRevision: `revision-${index}`, contributionKind: 'source', provenanceVersion: 'learn-adaptive.contribution.v1',
      provenanceKey: `key-${index}`, classification: 'non_factual', metadata: {}, sourceStatus: 'available',
      idempotencyKeyHash: `sha256:${index.toString(16).padStart(64, '0')}`,
      requestFingerprint: `sha256:${(index + 100).toString(16).padStart(64, '0')}`, createdAt: now + index,
    })
    await ctx.db.insert('accountDeletionJobs', { userId: identity.tokenIdentifier, status: 'active', phase: 'learnV2', startedAt: now, updatedAt: now })
    return id
  })
  await t.mutation(internal.accountDeletion.runDeletionBatch, { userId: identity.tokenIdentifier })
  expect(await t.run(ctx => ctx.db.query('learningThreadContributions').withIndex('by_userId', q => q.eq('userId', identity.tokenIdentifier)).take(10))).toHaveLength(2)
  expect(await t.run(ctx => ctx.db.get(threadId))).not.toBeNull()
  await t.mutation(internal.accountDeletion.runDeletionBatch, { userId: identity.tokenIdentifier })
  expect(await t.run(ctx => ctx.db.query('learningThreadContributions').withIndex('by_userId', q => q.eq('userId', identity.tokenIdentifier)).take(10))).toEqual([])
  expect(await t.run(ctx => ctx.db.get(threadId))).not.toBeNull()
})

test('folder deletion purges document contribution origin without deleting its thread', async () => {
  const t = convexTest(schema, modules)
  const owner = t.withIdentity(identity)
  await owner.mutation(api.users.upsertUser, {})
  await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: identity.tokenIdentifier, enabled: true })
  await owner.mutation(internal.learnAdaptiveAccess.setCohortEntitlement, { enabled: true })
  const { folderId, threadId, documentId } = await t.run(async ctx => {
    const folderId = await ctx.db.insert('folders', { userId: identity.tokenIdentifier, name: 'Delete me', documentCount: 1 })
    const threadId = await ctx.db.insert('learningThreads', {
      userId: identity.tokenIdentifier, originalNeed: 'Keep thread', intent: 'understand', availableTime: '15',
      authorityKind: 'standalone', sourceScope: { kind: 'none' }, evidenceState: 'none', lifecycle: 'active',
      revision: 1, createdAt: 1, updatedAt: 1,
    })
    const documentId = await ctx.db.insert('documents', {
      userId: identity.tokenIdentifier, folderId, filename: 'secret.pdf', status: 'success', fileSize: 100,
    })
    return { folderId, threadId, documentId }
  })
  const inspected = await owner.query(api.learnAdaptive.inspectContributionSource, { source: { feature: 'documents', id: documentId } })
  expect(await owner.mutation(api.learnAdaptive.recordContribution, {
    threadId, source: { feature: 'documents', id: documentId, revision: inspected.revision! },
    contributionKind: 'source', classification: 'non_factual', metadata: {}, expectedRevision: 1,
    idempotencyKey: 'folder-source-0001',
  })).toMatchObject({ kind: 'recorded' })
  vi.useFakeTimers()
  try {
    await owner.mutation(api.folders.deleteFolder, { id: folderId })
    await t.finishAllScheduledFunctions(vi.runAllTimers)
  }
  finally { vi.useRealTimers() }
  expect(await t.run(ctx => ctx.db.get(threadId))).not.toBeNull()
  expect((await owner.query(api.learnAdaptive.listThreadContributions, { threadId, paginationOpts })).page).toMatchObject([
    { sourceIdentity: '[purged]', sourceRevision: '[purged]', sourceStatus: 'source_unavailable' },
  ])
})
