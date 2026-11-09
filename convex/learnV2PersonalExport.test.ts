/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'
import { seedMeasurementStorage, STORAGE_CANARIES } from '../tests/fixtures/learn-v2-measurement-storage'
import { authorizeExport, folderBackedExportFixture } from '../tests/fixtures/learn-v2-personal-export'
import { personalExportResponseContext, liveResponseAggregate } from './lib/learnV2ResponsePrivacy'

const modules = import.meta.glob('./**/*.ts')
const identity = { tokenIdentifier: 'https://auth.example|personal-export' }
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers() })

test('folder-backed legacy work remains readable without excerpts until actual source loss', async () => {
  vi.useFakeTimers()
  vi.stubEnv('LEARN_V2_ENABLED', 'true')
  const f = await folderBackedExportFixture(convexTest(schema, modules), identity.tokenIdentifier)
  await f.t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: f.userId, enabled: true })
  for (const revoked of [false, true]) {
    if (revoked) await f.owner.mutation(api.documents.deleteDocument, { id: f.documentId })
    const authorizationId = await authorizeExport(f.owner)
    const page = await f.owner.query(api.dataExport.getUserDataPage, { authorizationId, collection: 'masteryAttempts', paginationOpts: { cursor: null, numItems: 8 } })
    const mission = await f.owner.query(api.learnV2Journey.getMission, { learningVoidId: f.learningVoidId })
    for (const row of [page.page[0], mission?.mastery[0]?.attempts[0], mission?.calibration.attempts[0]]) {
      expect(row).toMatchObject({ _id: f.attemptId, confidence: 4, serverScorePercent: 80, bodyAvailability: revoked ? 'unavailable' : 'available' })
      if (revoked) expect(row).not.toHaveProperty('response')
      else expect(row).toHaveProperty('response', f.answer)
    }
    expect(mission?.sources.items[0]?.excerpt).toBeNull()
  }
  await f.t.finishAllScheduledFunctions(vi.runAllTimers)
  expect((await f.t.run(ctx => ctx.db.get(f.attemptId)))?.response).toBeUndefined()
})

test('folder-backed activity aliases use body authority without requiring an excerpt', async () => {
  vi.useFakeTimers()
  const f = await folderBackedExportFixture(convexTest(schema, modules), identity.tokenIdentifier)
  await f.t.run(async ctx => {
    const claimId = await ctx.db.insert('sessionContentClaims', { userId: f.userId, sessionContentId: f.scope.contextPins.sessionContentId, order: 0, claim: 'Historical source claim' })
    const supportId = await ctx.db.insert('learnClaimSupports', { userId: f.userId, sessionContentClaimId: claimId,
      sourceExcerptId: f.sourceExcerptId, sourceSnapshotId: f.sourceSnapshotId, entailment: 'entailed', conflictStatus: 'clear' })
    await ctx.db.patch(f.activityId, { submittedResponse: f.answer, evidenceReferences: [{ claimId, supportId,
      sourceSnapshotId: f.sourceSnapshotId, sourceSnapshotRevision: 1, sourceRecordRevision: 1,
      sourceEffectiveStatus: 'user_accepted', verifierVersion: 'historical.v1', integrityState: 'accepted' }] })
    await ctx.db.insert('learnActivityEvidenceLinks', { userId: f.userId, threadId: f.threadId, activityId: f.activityId,
      sourceSnapshotId: f.sourceSnapshotId, boundaryOrdinal: 1, createdAt: f.base.createdAt })
  })
  for (const revoked of [false, true]) {
    if (revoked) await f.owner.mutation(api.documents.deleteDocument, { id: f.documentId })
    const authorizationId = await authorizeExport(f.owner)
    const page = await f.owner.query(api.dataExport.getUserDataPage, { authorizationId, collection: 'learningThreadActivities', paginationOpts: { cursor: null, numItems: 8 } })
    if (revoked) expect(page.page[0]).not.toHaveProperty('submittedResponse')
    else expect(page.page[0]).toHaveProperty('submittedResponse', f.answer)
  }
  await f.t.finishAllScheduledFunctions(vi.runAllTimers)
  expect((await f.t.run(ctx => ctx.db.get(f.activityId)))?.submittedResponse).toBeUndefined()
})

test('archiving preserves owner export bodies and factual eligibility while product recovery denies them', async () => {
  vi.stubEnv('LEARN_V2_ENABLED', 'true')
  const f = await folderBackedExportFixture(convexTest(schema, modules), identity.tokenIdentifier)
  await f.t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: f.userId, enabled: true })
  const authorizationId = await authorizeExport(f.owner)
  for (const archived of [false, true]) {
    if (archived) await f.owner.mutation(api.learnV2Lifecycle.transitionLearningVoid, { learningVoidId: f.learningVoidId,
      expectedRevision: 1, status: 'archived', idempotencyKey: 'archive-retained-work' })
    const args = { authorizationId, paginationOpts: { cursor: null, numItems: 8 } }
    expect(JSON.stringify(await f.owner.query(api.dataExport.getUserDataPage, { ...args, collection: 'learnResponseBodies' }))).toContain(STORAGE_CANARIES.answer)
    expect((await f.owner.query(api.dataExport.getUserDataPage, { ...args, collection: 'learnResponses' })).page).toMatchObject([
      { bodyAvailability: 'available', currentEligibility: 'eligible', evidenceStatus: 'available', confidence: 3 }])
    expect((await f.owner.query(api.dataExport.getUserDataPage, { ...args, collection: 'masteryAttempts' })).page[0]).toHaveProperty('response', f.answer)
    if (archived) {
      const mission = await f.owner.query(api.learnV2Journey.getMission, { learningVoidId: f.learningVoidId })
      expect(mission?.mastery[0]?.attempts[0]).not.toHaveProperty('response')
    }
  }
})

test('the archive exception is limited to the export handler owner', async () => {
  const t = convexTest(schema, modules)
  const f = await t.run(ctx => seedMeasurementStorage(ctx, identity.tokenIdentifier))
  await t.run(ctx => ctx.db.patch(f.learningVoidId, { status: 'archived' }))
  const scope = { scopeKind: 'v2' as const, learningVoidId: f.learningVoidId }
  expect(await t.run(ctx => liveResponseAggregate(personalExportResponseContext(ctx, identity.tokenIdentifier), identity.tokenIdentifier, scope))).toBe(true)
  expect(await t.run(ctx => liveResponseAggregate(ctx, identity.tokenIdentifier, scope))).toBe(false)
  expect(await t.run(ctx => liveResponseAggregate(personalExportResponseContext(ctx, 'https://foreign.example|export'), identity.tokenIdentifier, scope))).toBe(false)
})

test('a gap-only source neither revokes nor purges an unrelated legacy answer, and archive still denies Journey bodies', async () => {
  vi.useFakeTimers()
  vi.stubEnv('LEARN_V2_ENABLED', 'true')
  const f = await folderBackedExportFixture(convexTest(schema, modules), identity.tokenIdentifier)
  await f.t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: f.userId, enabled: true })
  await f.t.run(async ctx => {
    const link = await ctx.db.query('learnObjectiveSources').withIndex('by_userId_and_objectiveId_and_sourceSnapshotId', q => q.eq('userId', f.userId).eq('objectiveId', f.scope.objectiveId).eq('sourceSnapshotId', f.sourceSnapshotId)).unique()
    await ctx.db.patch(link!._id, { coverage: 'gap' })
    await ctx.db.patch(f.attemptId, { sourceSnapshotIdsJson: undefined })
  })
  await f.owner.mutation(api.documents.deleteDocument, { id: f.documentId })
  await f.t.finishAllScheduledFunctions(vi.runAllTimers)
  const authorizationId = await authorizeExport(f.owner)
  const args = { authorizationId, collection: 'masteryAttempts' as const, paginationOpts: { cursor: null, numItems: 8 } }
  expect((await f.owner.query(api.dataExport.getUserDataPage, args)).page[0]).toHaveProperty('response', f.answer)
  expect((await f.owner.query(api.learnV2Journey.getMission, { learningVoidId: f.learningVoidId }))?.mastery[0]?.attempts[0]).toHaveProperty('response', f.answer)
  await f.owner.mutation(api.learnV2Lifecycle.transitionLearningVoid, { learningVoidId: f.learningVoidId, expectedRevision: 1, status: 'archived', idempotencyKey: 'archive-gap-history' })
  expect((await f.owner.query(api.learnV2Journey.getMission, { learningVoidId: f.learningVoidId }))?.mastery[0]?.attempts[0]).not.toHaveProperty('response')
  expect((await f.owner.query(api.dataExport.getUserDataPage, args)).page[0]).toHaveProperty('response', f.answer)
})

test.each((['live', 'revoked', 'purged'] as const).flatMap(state => [4, undefined].map(confidence => [state, confidence] as const)))(
  'direct export retains canonical confidence for %s responses with confidence=%s and no scored attempt', async (state, confidence) => {
    vi.useFakeTimers()
    vi.setSystemTime(1_800_000_000_001)
    vi.stubEnv('LEARN_V2_ENABLED', 'false')
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => seedMeasurementStorage(ctx, identity.tokenIdentifier))
    await t.run(async ctx => {
      await ctx.db.patch(f.rows.learnResponses, { confidence })
      await ctx.db.patch(f.rows.learnAssessmentOpportunities, { phase: 'scoring_pending' })
    })
    if (state !== 'live') await t.mutation(internal.learnV2Retention.purgeSourceEvidence, { userId: identity.tokenIdentifier, sourceIdentityId: f.sourceIdentityId })
    if (state === 'purged') await t.finishAllScheduledFunctions(vi.runAllTimers)
    const retained = await t.run(ctx => ctx.db.get(f.rows.learnResponses))
    expect(retained).toMatchObject({ bodyAvailability: state === 'purged' ? 'purged' : 'available' })
    expect(await t.run(ctx => ctx.db.query('masteryAttempts').withIndex('by_userId', q => q.eq('userId', identity.tokenIdentifier)).collect())).toEqual([])
    const owner = t.withIdentity(identity)
    const authorizationId = await authorizeExport(owner)
    const page = await owner.query(api.dataExport.getUserDataPage, { authorizationId, collection: 'learnResponses', paginationOpts: { cursor: null, numItems: 8 } })
    expect(page.page).toHaveLength(1)
    const row = page.page[0]!
    expect(row).toMatchObject({ _id: f.rows.learnResponses, acceptedAt: f.base.createdAt,
      assistance: f.assistanceSnapshot, validity: f.validitySnapshot,
      bodyAvailability: state === 'live' ? 'available' : state === 'purged' ? 'purged' : 'unavailable',
      currentEligibility: state === 'live' ? 'eligible' : 'excluded' })
    if (confidence === undefined) expect(row).not.toHaveProperty('confidence')
    else expect(row).toHaveProperty('confidence', retained?.confidence)
    expect(JSON.stringify(row)).not.toContain(STORAGE_CANARIES.answer)
    const bodies = await owner.query(api.dataExport.getUserDataPage, { authorizationId, collection: 'learnResponseBodies', paginationOpts: { cursor: null, numItems: 8 } })
    if (state === 'live') expect(JSON.stringify(bodies.page)).toContain(STORAGE_CANARIES.answer)
    else expect(JSON.stringify(bodies.page)).not.toContain(STORAGE_CANARIES.answer)
    if (state === 'purged') expect(await t.run(ctx => ctx.db.get(f.rows.learnResponseBodies))).toBeNull()
  },
)

test('withholds a legacy answer with missing pins through its normalized objective dependency before byte cleanup', async () => {
  vi.useFakeTimers()
  const t = convexTest(schema, modules)
  const f = await t.run(ctx => seedMeasurementStorage(ctx, identity.tokenIdentifier))
  const legacyId = await t.run(async ctx => {
    await ctx.db.insert('learnObjectiveSources', { userId: identity.tokenIdentifier, objectiveId: f.scope.objectiveId, sourceSnapshotId: f.sourceSnapshotId, coverage: 'strong' })
    return await ctx.db.insert('masteryAttempts', { userId: identity.tokenIdentifier, objectiveId: f.scope.objectiveId,
      attemptedAt: 123, idempotencyKey: 'legacy-without-pins', activityContractVersion: 'learn-v2.mastery-attempt.v1', response: 'retained legacy answer', serverScorePercent: 80 })
  })
  const owner = t.withIdentity(identity)
  const authorizationId = await authorizeExport(owner)
  const args = { authorizationId, collection: 'masteryAttempts' as const, paginationOpts: { cursor: null, numItems: 8 } }
  expect((await owner.query(api.dataExport.getUserDataPage, args)).page).toMatchObject([{ response: 'retained legacy answer', activityContractVersion: 'learn-v2.mastery-attempt.v1' }])
  await t.mutation(internal.learnV2Retention.purgeSourceEvidence, { userId: identity.tokenIdentifier, sourceIdentityId: f.sourceIdentityId })
  const page = await owner.query(api.dataExport.getUserDataPage, args)
  expect(page.page[0]).toMatchObject({ bodyAvailability: 'unavailable', serverScorePercent: 80, attemptedAt: 123, activityContractVersion: 'learn-v2.mastery-attempt.v1' })
  expect(page.page[0]).not.toHaveProperty('response')
  expect((await t.run(ctx => ctx.db.get(legacyId)))?.response).toBe('retained legacy answer')
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  expect((await t.run(ctx => ctx.db.get(legacyId)))?.response).toBeUndefined()
})

test('requires owner export authorization on direct pages, child pages and original download URLs with flags off', async () => {
  vi.stubEnv('LEARN_V2_ENABLED', 'false')
  const t = convexTest(schema, modules)
  const f = await t.run(ctx => seedMeasurementStorage(ctx, identity.tokenIdentifier))
  await t.run(async ctx => {
    const fileId = await ctx.storage.store(new Blob(['original file']))
    await ctx.db.patch(f.documentId, { fileId })
  })
  const owner = t.withIdentity(identity)
  await expect(t.mutation(api.dataExport.authorizePersonalExport, {})).rejects.toThrow('Unauthenticated')
  await expect(owner.query(api.dataExport.getUserDataPage, { collection: 'learnResponseBodies', paginationOpts: { cursor: null, numItems: 8 } })).rejects.toThrow(/authorization/)
  await expect(owner.query(api.dataExport.getDocumentDownloadUrl, { documentId: f.documentId })).rejects.toThrow(/authorization/)
  const authorizationId = await authorizeExport(owner)
  await expect(owner.query(api.dataExport.getDocumentDownloadUrl, { documentId: f.documentId, authorizationId })).resolves.toMatchObject({ url: expect.any(String) })
  const foreign = t.withIdentity({ tokenIdentifier: 'https://other.example|personal-export' })
  await expect(foreign.query(api.dataExport.getUserDataPage, { authorizationId, collection: 'learnResponseBodies', paginationOpts: { cursor: null, numItems: 8 } })).rejects.toThrow(/authorization/)
  await expect(foreign.query(api.dataExport.getDocumentDownloadUrl, { documentId: f.documentId, authorizationId })).resolves.toBeNull()
  await t.run(ctx => ctx.db.patch(f.documentId, { status: 'failed' }))
  await expect(owner.query(api.dataExport.getDocumentDownloadUrl, { documentId: f.documentId, authorizationId })).resolves.toBeNull()
})

test('covers more than eight open opportunities before releasing a page and rejects a skipped authorization cursor', async () => {
  const t = convexTest(schema, modules)
  const f = await t.run(ctx => seedMeasurementStorage(ctx, identity.tokenIdentifier))
  const ids = await t.run(async ctx => {
    const row = (await ctx.db.get(f.rows.learnAssessmentOpportunities))!
    const { _id: _id, _creationTime: _creationTime, ...fields } = row
    const ids = []
    for (let index = 0; index < 10; index++) ids.push(await ctx.db.insert('learnAssessmentOpportunities', { ...fields, phase: 'test_open', submissionId: undefined, delayedCheckId: `open-${index}` }))
    return ids
  })
  const owner = t.withIdentity(identity)
  let result = await owner.mutation(api.dataExport.authorizePersonalExport, {})
  expect(result.done).toBe(false)
  await expect(owner.query(api.dataExport.getUserDataPage, { authorizationId: result.authorizationId, collection: 'learnResponseBodies', paginationOpts: { cursor: null, numItems: 8 } })).rejects.toThrow(/authorization/)
  await expect(owner.mutation(api.dataExport.authorizePersonalExport, { authorizationId: result.authorizationId, cursor: 'forged-cursor' })).rejects.toThrow(/authorization/)
  while (!result.done) result = await owner.mutation(api.dataExport.authorizePersonalExport, { authorizationId: result.authorizationId, cursor: result.cursor ?? undefined })
  for (const id of ids) {
    const exposures = await t.run(ctx => ctx.db.query('learnAssessmentExposures').withIndex('by_userId_and_assessmentOpportunityId', q => q.eq('userId', identity.tokenIdentifier).eq('assessmentOpportunityId', id)).take(8))
    expect(exposures).toMatchObject([{ status: 'unknown', purpose: 'imported' }])
  }
  const reuse = await owner.mutation(api.dataExport.authorizePersonalExport, {})
  expect(reuse).toEqual(result)
  await expect(owner.query(api.dataExport.getUserDataPage, { authorizationId: result.authorizationId, collection: 'learnResponseBodies', paginationOpts: { cursor: null, numItems: 8 } })).resolves.toHaveProperty('page')
})

test('revalidates newly created opportunities and source revocation between authorized pages', async () => {
  const t = convexTest(schema, modules)
  const f = await t.run(ctx => seedMeasurementStorage(ctx, identity.tokenIdentifier))
  const owner = t.withIdentity(identity)
  const authorizationId = await authorizeExport(owner)
  await t.run(async ctx => {
    const row = (await ctx.db.get(f.rows.learnAssessmentOpportunities))!
    const { _id: _id, _creationTime: _creationTime, ...fields } = row
    await ctx.db.insert('learnAssessmentOpportunities', { ...fields, phase: 'test_open', submissionId: undefined, delayedCheckId: 'created-after-authorization' })
  })
  await expect(owner.query(api.dataExport.getUserDataPage, { authorizationId, collection: 'learnResponseBodies', paginationOpts: { cursor: null, numItems: 8 } })).rejects.toThrow(/authorization/)
  const refreshed = await authorizeExport(owner)
  await t.run(ctx => ctx.db.patch(f.sourceIdentityId, { tombstonedAt: Date.now() }))
  const page = await owner.query(api.dataExport.getUserDataPage, { authorizationId: refreshed, collection: 'learnResponseBodies', paginationOpts: { cursor: null, numItems: 8 } })
  expect(page.page).toMatchObject([{ bodyAvailability: 'unavailable', bodyUnavailableReason: 'evidence_unavailable' }])
  expect(page.page[0]).not.toHaveProperty('payload')
})
