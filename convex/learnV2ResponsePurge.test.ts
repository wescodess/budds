/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'
import { seedMeasurementStorage, STORAGE_CANARIES } from '../tests/fixtures/learn-v2-measurement-storage'
import { authorizeExport } from '../tests/fixtures/learn-v2-personal-export'
import { initiateAdaptiveThreadDeletion } from './learnAdaptiveCommands'

const modules = import.meta.glob('./**/*.ts')
const identity = { tokenIdentifier: 'https://auth.example|response-purge-owner' }
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

test('source cleanup drains lineage batches of eight before response and activity copies without touching unrelated owners', async () => {
  vi.useFakeTimers()
  vi.stubEnv('LEARN_V2_ENABLED', 'false')
  const t = convexTest(schema, modules)
  const f = await t.run(ctx => seedMeasurementStorage(ctx, identity.tokenIdentifier))
  const unrelated = await t.run(ctx => seedMeasurementStorage(ctx, identity.tokenIdentifier))
  const foreign = await t.run(ctx => seedMeasurementStorage(ctx, 'https://foreign.example|lineage-purge'))
  const lineageIds = await t.run(async ctx => {
    const { _id: _lineageId, _creationTime: _lineageTime, ...lineage } = (await ctx.db.get(f.rows.learnArtifactLineages))!
    const { _id: _linkId, _creationTime: _linkTime, ...link } = (await ctx.db.get(f.rows.learnArtifactSourceLinks))!
    const ids = [f.rows.learnArtifactLineages]
    for (let index = 0; index < 9; index++) {
      const lineageId = await ctx.db.insert('learnArtifactLineages', { ...lineage, key: `purge-${index}` })
      ids.push(lineageId)
      await ctx.db.insert('learnArtifactSourceLinks', { ...link, lineageId })
    }
    await ctx.db.patch(f.activityId, { submittedResponse: STORAGE_CANARIES.answer })
    await ctx.db.insert('learnActivityEvidenceLinks', { userId: identity.tokenIdentifier, threadId: f.threadId,
      activityId: f.activityId, sourceSnapshotId: f.sourceSnapshotId, boundaryOrdinal: 1, createdAt: 1 })
    return ids
  })
  const owner = t.withIdentity(identity)
  const authorizationId = await authorizeExport(owner)
  const pageArgs = { authorizationId, collection: 'learnResponseBodies' as const, paginationOpts: { cursor: null, numItems: 8 } }
  expect(JSON.stringify(await owner.query(api.dataExport.getUserDataPage, pageArgs))).toContain(STORAGE_CANARIES.answer)
  const remaining = () => t.run(ctx => ctx.db.query('learnArtifactSourceLinks')
    .withIndex('by_userId_and_dependency_sourceSnapshotId_and_invalidatedAt', q => q.eq('userId', identity.tokenIdentifier)
      .eq('dependency.sourceSnapshotId', f.sourceSnapshotId).eq('invalidatedAt', undefined)).take(16))
  await t.mutation(internal.learnV2Retention.purgeSourceEvidence, { userId: identity.tokenIdentifier, sourceIdentityId: f.sourceIdentityId })
  expect(await remaining()).toHaveLength(10)
  expect((await t.run(ctx => ctx.db.get(f.rows.learnResponses)))?.bodyAvailability).toBe('available')
  const denied = await owner.query(api.dataExport.getUserDataPage, pageArgs)
  expect(denied.page.find(row => row._id === f.rows.learnResponseBodies)).not.toHaveProperty('payload')
  const sizes = []
  for (let batch = 0; batch < 16; batch++) {
    const before = (await remaining()).length
    await t.mutation(internal.learnV2Retention.purgeSourceEvidence, { userId: identity.tokenIdentifier, sourceIdentityId: f.sourceIdentityId })
    const changed = before - (await remaining()).length
    expect(changed).toBeGreaterThanOrEqual(0)
    expect(changed).toBeLessThanOrEqual(8)
    if (changed) sizes.push(changed)
    if ((await t.run(ctx => ctx.db.get(f.rows.learnResponses)))?.bodyAvailability === 'purged') break
    expect(batch).toBeLessThan(15)
  }
  expect(sizes).toEqual([8, 2])
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  for (const id of lineageIds) expect(await t.run(ctx => ctx.db.get(id))).toMatchObject({ evidenceStatus: 'evidence_unavailable', invalidatedAt: expect.any(Number) })
  const links = await t.run(ctx => ctx.db.query('learnArtifactSourceLinks').withIndex('by_userId', q => q.eq('userId', identity.tokenIdentifier)).take(16))
  for (const link of links.filter(row => lineageIds.includes(row.lineageId))) expect(link).not.toHaveProperty('dependency')
  expect(await t.run(ctx => ctx.db.get(f.rows.learnResponseBodies))).toBeNull()
  expect((await t.run(ctx => ctx.db.get(f.activityId)))?.submittedResponse).toBeUndefined()
  for (const control of [unrelated, foreign]) {
    expect(await t.run(ctx => ctx.db.get(control.rows.learnArtifactLineages))).toMatchObject({ evidenceStatus: 'available' })
    expect(await t.run(ctx => ctx.db.get(control.rows.learnArtifactSourceLinks))).toHaveProperty('dependency')
    expect(await t.run(ctx => ctx.db.get(control.rows.learnResponseBodies))).not.toBeNull()
  }
})

test('revokes exports immediately and drains protected aliases, preserving unrelated and foreign history', async () => {
  vi.useFakeTimers()
  vi.stubEnv('LEARN_V2_ENABLED', 'false')
  const t = convexTest(schema, modules)
  const f = await t.run(ctx => seedMeasurementStorage(ctx, identity.tokenIdentifier))
  const unrelated = await t.run(ctx => seedMeasurementStorage(ctx, identity.tokenIdentifier))
  const foreign = await t.run(ctx => seedMeasurementStorage(ctx, 'https://other.example|response-purge-owner'))
  const secret = 'protected-dependent-response-canary'
  const legacyId = await t.run(async ctx => {
    await ctx.db.insert('learnObjectiveSources', { userId: identity.tokenIdentifier, objectiveId: f.scope.objectiveId, sourceSnapshotId: f.sourceSnapshotId, coverage: 'strong' })
    await ctx.db.patch(f.scope.objectiveId, { assessmentContract: secret })
    await ctx.db.insert('learnLifecycleReceipts', { userId: identity.tokenIdentifier, learningVoidId: f.learningVoidId,
      idempotencyKey: 'map-copy', command: 'replaceDraftMap', requestFingerprint: JSON.stringify({ candidate: secret }), revision: 1, createdAt: 1 })
    await ctx.db.insert('learnPlanCommandReceipts', { userId: identity.tokenIdentifier, learningVoidId: f.learningVoidId,
      idempotencyKey: 'plan-copy', command: 'createPlan', requestFingerprint: JSON.stringify({ source: secret }), response: JSON.stringify({ inputSnapshot: secret }), createdAt: 1 })
    const claimId = await ctx.db.insert('sessionContentClaims', { userId: identity.tokenIdentifier, sessionContentId: f.scope.contextPins.sessionContentId, order: 0, claim: secret })
    await ctx.db.insert('learnClaimSupports', { userId: identity.tokenIdentifier, sessionContentClaimId: claimId, sourceSnapshotId: f.sourceSnapshotId, sourceExcerptId: f.sourceExcerptId, entailment: 'entailed', conflictStatus: 'clear' })
    await ctx.db.patch(f.scope.contextPins.sessionContentId, { assessmentRubricSnapshot: secret })
    await ctx.db.insert('sessionContentBlocks', { userId: identity.tokenIdentifier, sessionContentId: f.scope.contextPins.sessionContentId, order: 0, kind: 'independent_application', content: secret })
    await ctx.db.patch(f.activityId, { submittedResponse: secret, submittedConfidence: 4, canonicalInputSnapshot: secret,
      recoveryFeedback: { templateVersion: 'learn-adaptive.feedback-templates.v1', template: 'provider_unavailable', message: secret },
      fallback: { ...(await ctx.db.get(f.activityId))!.fallback, body: secret } })
    await ctx.db.insert('learnActivityEvidenceLinks', { userId: identity.tokenIdentifier, threadId: f.threadId, activityId: f.activityId, sourceSnapshotId: f.sourceSnapshotId, boundaryOrdinal: 1, createdAt: 1 })
    await ctx.db.insert('learnJobs', { userId: identity.tokenIdentifier, learningVoidId: f.learningVoidId, type: 'calibration_scoring', status: 'succeeded', revision: 1, idempotencyKey: 'legacy-copy', requestFingerprint: JSON.stringify({ response: secret }), checkpoint: secret })
    const execution = (await ctx.db.get(f.rows.learnScoringExecutions))!
    const { _id: _executionId, _creationTime: _executionTime, ...fields } = execution
    for (let index = 0; index < 9; index++) await ctx.db.insert('learnScoringExecutions', { ...fields, dispatchOrdinal: index + 2, frozenConfiguration: { digest: 'configuration-digest', snapshot: secret },
      verdict: { criterionResults: [{ key: secret, awarded: true }], misconceptionTags: [secret], scorePercent: 80, verdictDigest: 'digest', responseDigest: 'digest' } })
    return await ctx.db.insert('masteryAttempts', { userId: identity.tokenIdentifier, objectiveId: f.scope.objectiveId,
      attemptedAt: 123, serverScorePercent: 80, confidence: 4, usedHint: true, usedReveal: false, result: 'passed', idempotencyKey: 'legacy-answer',
      response: secret, requestFingerprint: JSON.stringify({ response: secret }), rubricSnapshot: secret,
      contentRevisionPinsJson: secret, criterionResultsJson: secret, feedbackProjectionJson: secret, sourceSnapshotIdsJson: JSON.stringify([f.sourceSnapshotId]) })
  })
  const owner = t.withIdentity(identity)
  const authorizationId = await authorizeExport(owner)
  const before = await owner.query(api.dataExport.getUserDataPage, { authorizationId, collection: 'learnResponseBodies', paginationOpts: { cursor: null, numItems: 8 } })
  expect(JSON.stringify(before)).toContain(STORAGE_CANARIES.answer)
  const untouched = await t.run(ctx => ctx.db.get(unrelated.rows.learnResponses))
  await t.mutation(internal.learnV2Retention.purgeSourceEvidence, { userId: identity.tokenIdentifier, sourceIdentityId: f.sourceIdentityId, reason: 'access_lost' })
  const immediate = await owner.query(api.dataExport.getUserDataPage, { authorizationId, collection: 'learnResponseBodies', paginationOpts: { cursor: null, numItems: 8 } })
  expect(immediate.page.find(row => row._id === f.rows.learnResponseBodies)).not.toHaveProperty('payload')
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  const retained = await t.run(async ctx => ({
    attempt: await ctx.db.get(legacyId), response: await ctx.db.get(f.rows.learnResponses),
    bodies: await ctx.db.query('learnResponseBodies').withIndex('by_userId_and_submissionId', q => q.eq('userId', identity.tokenIdentifier).eq('submissionId', f.rows.learnResponses)).take(8),
    executions: await ctx.db.query('learnScoringExecutions').withIndex('by_userId_and_submissionId', q => q.eq('userId', identity.tokenIdentifier).eq('submissionId', f.rows.learnResponses)).take(16),
    activities: await ctx.db.get(f.activityId), content: await ctx.db.get(f.scope.contextPins.sessionContentId),
    objective: await ctx.db.get(f.scope.objectiveId), plan: await ctx.db.get(f.scope.contextPins.studyPlanRevisionId),
    lifecycleReceipts: await ctx.db.query('learnLifecycleReceipts').withIndex('by_userId_and_learningVoidId', q => q.eq('userId', identity.tokenIdentifier).eq('learningVoidId', f.learningVoidId)).take(8),
    planReceipts: await ctx.db.query('learnPlanCommandReceipts').withIndex('by_userId_and_learningVoidId', q => q.eq('userId', identity.tokenIdentifier).eq('learningVoidId', f.learningVoidId)).take(8),
    jobs: await ctx.db.query('learnJobs').withIndex('by_userId_and_learningVoidId_and_type', q => q.eq('userId', identity.tokenIdentifier).eq('learningVoidId', f.learningVoidId)).take(8),
    claims: await ctx.db.query('sessionContentClaims').withIndex('by_userId_and_sessionContentId_and_order', q => q.eq('userId', identity.tokenIdentifier).eq('sessionContentId', f.scope.contextPins.sessionContentId)).take(8),
  }))
  expect(retained.attempt).toMatchObject({ serverScorePercent: 80, attemptedAt: 123, confidence: 4, usedHint: true, usedReveal: false, result: 'passed' })
  expect(retained.attempt?.requestFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/)
  expect(retained.activities).not.toHaveProperty('recoveryFeedback')
  expect(retained.executions.every(row => row.verdict === undefined)).toBe(true)
  expect(retained.response).toMatchObject({ bodyAvailability: 'purged', currentEligibility: 'excluded' })
  expect(retained.bodies).toEqual([])
  expect(retained.executions).toHaveLength(10)
  expect(retained.executions.every(row => row.evidenceStatus === 'evidence_unavailable')).toBe(true)
  expect(JSON.stringify(retained)).not.toContain(secret)
  expect(await t.run(ctx => ctx.db.get(unrelated.rows.learnResponses))).toEqual(untouched)
  expect(await t.run(ctx => ctx.db.get(unrelated.rows.learnResponseBodies))).not.toBeNull()
  expect(await t.run(ctx => ctx.db.get(foreign.rows.learnResponseBodies))).not.toBeNull()
  expect(await t.run(ctx => ctx.db.get(f.rows.learnAssessmentExposures))).not.toBeNull()
  // Replays cannot recreate body rows or erase the original case consumption.
  await t.mutation(internal.learnV2Retention.purgeSourceEvidence, { userId: identity.tokenIdentifier, sourceIdentityId: f.sourceIdentityId })
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  expect(await t.run(ctx => ctx.db.get(f.rows.learnResponseBodies))).toBeNull()
})

test('deleting an optional Canvas wrapper preserves its Void-owned response graph', async () => {
  vi.useFakeTimers()
  const t = convexTest(schema, modules)
  const f = await t.run(ctx => seedMeasurementStorage(ctx, identity.tokenIdentifier))
  await t.run(async ctx => {
    await ctx.db.patch(f.threadId, { authorityKind: 'v2_mission', learningVoidId: f.learningVoidId })
    const canvas = { threadId: f.threadId, threadRevision: 1, pilotConfigurationVersion: 'pilot.v1', activityId: f.activityId, activityRevision: 1, planVersion: 'learn-adaptive.activity-plan.v1', replayVersion: 'learn-adaptive.activity-replay.v1', rendererVersion: 'renderer.v1', evaluationVersion: 'evaluation.v1' }
    await ctx.db.patch(f.rows.learnResponses, { contextPins: { ...f.scope.contextPins, canvas } })
    await ctx.db.patch(f.rows.learnResponseSlots, { contextPins: { ...f.scope.contextPins, canvas } })
    await ctx.db.patch(f.rows.learnAssessmentOpportunities, { contextPins: { ...f.scope.contextPins, canvas } })
    await ctx.db.patch(f.rows.learnResponseEvidenceLinks, { threadId: f.threadId })
    await ctx.db.patch(f.rows.learnResponseCommandReceipts, { threadId: f.threadId })
    await initiateAdaptiveThreadDeletion(ctx, identity.tokenIdentifier, f.threadId)
  })
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  expect(await t.run(ctx => ctx.db.get(f.threadId))).toBeNull()
  for (const id of [f.rows.learnResponses, f.rows.learnResponseBodies, f.rows.learnResponseEvidenceLinks, f.rows.learnResponseCommandReceipts]) expect(await t.run(ctx => ctx.db.get(id))).not.toBeNull()
  const response = await t.run(ctx => ctx.db.get(f.rows.learnResponses))
  expect(response?.scopeKind === 'v2' && response.contextPins.kind === 'session' ? response.contextPins.canvas : null).toBeUndefined()
})
