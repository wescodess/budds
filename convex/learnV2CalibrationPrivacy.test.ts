/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'
import { seedMeasurementStorage } from '../tests/fixtures/learn-v2-measurement-storage'

afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers() })

test('identity tombstone stops calibration before byte cleanup finishes', async () => {
  vi.useFakeTimers()
  vi.stubEnv('LEARN_V2_ENABLED', 'true')
  vi.stubEnv('LEARN_V2_CALIBRATION_MODEL', 'fixture-model')
  const userId = 'https://auth.example|c2-425-probe'
  const t = convexTest(schema, import.meta.glob('./**/*.ts'))
  await t.withIdentity({ tokenIdentifier: userId }).mutation(api.users.upsertUser, {})
  await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: userId, enabled: true })
  const f = await t.run(ctx => seedMeasurementStorage(ctx, userId))
  const jobId = await t.run(async ctx => {
    await ctx.db.patch(f.learningVoidId, { status: 'calibration', activeBlueprintRevisionId: f.scope.blueprintRevisionId })
    await ctx.db.patch(f.scope.blueprintRevisionId, { status: 'accepted' })
    await ctx.db.patch(f.documentId, { status: 'success' })
    await ctx.db.insert('learnObjectiveSources', { userId, objectiveId: f.scope.objectiveId, sourceSnapshotId: f.sourceSnapshotId, coverage: 'strong' })
    return await ctx.db.insert('learnJobs', { userId, learningVoidId: f.learningVoidId,
      blueprintRevisionId: f.scope.blueprintRevisionId, type: 'calibration_scoring', status: 'running', revision: 1,
      idempotencyKey: 'calibration-in-flight', leaseToken: 'probe-lease', leaseExpiresAt: Date.now() + 60_000 })
  })
  await t.mutation(internal.learnV2Retention.purgeSourceEvidence, { userId, sourceIdentityId: f.sourceIdentityId, reason: 'access_lost' })
  expect(await t.run(ctx => ctx.db.get(f.sourceIdentityId))).toHaveProperty('tombstonedAt')
  expect(await t.run(ctx => ctx.db.get(f.sourceSnapshotId))).toMatchObject({ effectiveStatus: 'user_accepted' })
  await expect(t.query(internal.learnV2MapCalibration.getCalibrationScoringInput, {
    tokenIdentifier: userId, jobId, leaseToken: 'probe-lease', blueprintRevisionId: f.scope.blueprintRevisionId,
    objectiveId: f.scope.objectiveId, response: 'Saved answer',
  })).rejects.toThrow(/evidence.*unavailable/i)
})

test('completed purge prevents calibration from recreating a raw fingerprint', async () => {
  vi.useFakeTimers()
  vi.stubEnv('LEARN_V2_ENABLED', 'true')
  const userId = 'https://auth.example|c2-425-replay-probe'
  const t = convexTest(schema, import.meta.glob('./**/*.ts'))
  await t.withIdentity({ tokenIdentifier: userId }).mutation(api.users.upsertUser, {})
  await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: userId, enabled: true })
  const f = await t.run(ctx => seedMeasurementStorage(ctx, userId))
  await t.run(async ctx => {
    await ctx.db.patch(f.learningVoidId, { status: 'calibration', activeBlueprintRevisionId: f.scope.blueprintRevisionId })
    await ctx.db.patch(f.scope.blueprintRevisionId, { status: 'accepted' })
    await ctx.db.patch(f.documentId, { status: 'success' })
    await ctx.db.insert('learnObjectiveSources', { userId, objectiveId: f.scope.objectiveId, sourceSnapshotId: f.sourceSnapshotId, coverage: 'strong' })
  })
  let pending = true
  for (let batch = 0; batch < 64 && pending; batch++) {
    pending = (await t.mutation(internal.learnV2Retention.purgeSourceEvidence, { userId, sourceIdentityId: f.sourceIdentityId })).pending
  }
  expect(pending).toBe(false)
  expect(await t.run(ctx => ctx.db.get(f.sourceSnapshotId))).toMatchObject({ effectiveStatus: 'unavailable' })
  const response = 'raw-source-quote-canary'
  await expect(t.mutation(internal.learnV2MapCalibration.reserveCalibrationScoring, {
    tokenIdentifier: userId, blueprintRevisionId: f.scope.blueprintRevisionId, objectiveId: f.scope.objectiveId,
    expectedBlueprintRecordRevision: 1, expectedVoidRevision: 1, response, confidence: 3,
    usedHint: false, usedReveal: false, idempotencyKey: 'after-completed-purge',
  })).rejects.toThrow(/evidence.*unavailable/i)
  const jobs = await t.run(ctx => ctx.db.query('learnJobs').withIndex('by_userId', q => q.eq('userId', userId)).take(8))
  expect(JSON.stringify(jobs)).not.toContain(response)
})

async function calibrationFixture() {
  vi.useFakeTimers()
  vi.stubEnv('LEARN_V2_ENABLED', 'true')
  vi.stubEnv('LEARN_V2_CALIBRATION_MODEL', 'fixture-model')
  const userId = 'https://auth.example|calibration-controls'
  const t = convexTest(schema, import.meta.glob('./**/*.ts'))
  await t.withIdentity({ tokenIdentifier: userId }).mutation(api.users.upsertUser, {})
  await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: userId, enabled: true })
  const f = await t.run(ctx => seedMeasurementStorage(ctx, userId))
  await t.run(async ctx => {
    await ctx.db.patch(f.learningVoidId, { status: 'calibration', activeBlueprintRevisionId: f.scope.blueprintRevisionId })
    await ctx.db.patch(f.scope.blueprintRevisionId, { status: 'accepted' })
    await ctx.db.patch(f.documentId, { status: 'success' })
    await ctx.db.insert('learnObjectiveSources', { userId, objectiveId: f.scope.objectiveId, sourceSnapshotId: f.sourceSnapshotId, coverage: 'strong' })
  })
  const request = { tokenIdentifier: userId, blueprintRevisionId: f.scope.blueprintRevisionId, objectiveId: f.scope.objectiveId,
    expectedBlueprintRecordRevision: 1, expectedVoidRevision: 1, response: 'My calibration answer.', confidence: 3,
    usedHint: false, usedReveal: false, idempotencyKey: 'calibration-controls' }
  return { t, f, userId, request }
}

test.each(['identity', 'snapshot', 'excerpt', 'document'] as const)('revokes %s at reservation, input, dispatch and replayed commit', async kind => {
  const { t, f, userId, request } = await calibrationFixture()
  const reservation = await t.mutation(internal.learnV2MapCalibration.reserveCalibrationScoring, request)
  if (reservation.kind !== 'acquired') throw new Error('Expected reservation')
  const dispatch = { tokenIdentifier: userId, jobId: reservation.jobId, leaseToken: reservation.leaseToken, expectedRevision: reservation.revision }
  await t.mutation(internal.learnV2MapCalibration.markCalibrationScoringDispatched, dispatch)
  const input = { tokenIdentifier: userId, jobId: reservation.jobId, leaseToken: reservation.leaseToken,
    blueprintRevisionId: request.blueprintRevisionId, objectiveId: request.objectiveId, response: request.response }
  await expect(t.query(internal.learnV2MapCalibration.getCalibrationScoringInput, input)).resolves.toHaveProperty('evidence')
  const commit = { ...request, serverScorePercent: 80, rubricVersion: 'rubric.v1' }
  const saved = await t.mutation(internal.learnV2MapCalibration.recordCalibrationAttempt, commit)
  const before = await t.run(ctx => ctx.db.get(saved.attemptId))
  await t.run(async ctx => {
    if (kind === 'identity') await ctx.db.patch(f.sourceIdentityId, { tombstonedAt: Date.now() })
    if (kind === 'snapshot') await ctx.db.patch(f.sourceSnapshotId, { evidencePurgedAt: Date.now() })
    if (kind === 'excerpt') await ctx.db.patch(f.sourceExcerptId, { evidencePurgedAt: Date.now() })
    if (kind === 'document') await ctx.db.patch(f.documentId, { status: 'failed' })
    await ctx.db.patch(reservation.jobId, { status: 'leased', revision: reservation.revision })
  })
  await expect(t.mutation(internal.learnV2MapCalibration.reserveCalibrationScoring, request)).rejects.toThrow(/evidence.*unavailable/i)
  await expect(t.mutation(internal.learnV2MapCalibration.markCalibrationScoringDispatched, dispatch)).rejects.toThrow(/evidence.*unavailable/i)
  await t.run(ctx => ctx.db.patch(reservation.jobId, { status: 'running' }))
  await expect(t.query(internal.learnV2MapCalibration.getCalibrationScoringInput, input)).rejects.toThrow(/evidence.*unavailable/i)
  await expect(t.mutation(internal.learnV2MapCalibration.recordCalibrationAttempt, commit)).rejects.toThrow(/evidence.*unavailable/i)
  expect(await t.run(ctx => ctx.db.get(saved.attemptId))).toEqual(before)
})

test('writes only canonical digests and compares legacy command fingerprints in memory', async () => {
  const { t, request } = await calibrationFixture()
  const reservation = await t.mutation(internal.learnV2MapCalibration.reserveCalibrationScoring, request)
  if (reservation.kind !== 'acquired') throw new Error('Expected reservation')
  const job = await t.run(ctx => ctx.db.get(reservation.jobId))
  expect(job?.requestFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/)
  expect(JSON.stringify(job)).not.toContain(request.response)
  const legacy = JSON.stringify({ command: 'submitCalibrationAttempt', blueprintRevisionId: request.blueprintRevisionId, objectiveId: request.objectiveId,
    expectedBlueprintRecordRevision: request.expectedBlueprintRecordRevision, expectedVoidRevision: request.expectedVoidRevision,
    response: request.response, confidence: request.confidence, usedHint: request.usedHint, usedReveal: request.usedReveal, idempotencyKey: request.idempotencyKey })
  await t.run(ctx => ctx.db.patch(reservation.jobId, { requestFingerprint: legacy }))
  await expect(t.mutation(internal.learnV2MapCalibration.reserveCalibrationScoring, request)).resolves.toMatchObject({ kind: 'pending' })
  await expect(t.mutation(internal.learnV2MapCalibration.reserveCalibrationScoring, { ...request, response: 'Changed answer.' })).rejects.toThrow(/different request/)
  const commit = { ...request, serverScorePercent: 80, rubricVersion: 'rubric.v1' }
  const saved = await t.mutation(internal.learnV2MapCalibration.recordCalibrationAttempt, commit)
  const attempt = await t.run(ctx => ctx.db.get(saved.attemptId))
  expect(attempt?.requestFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/)
  await t.run(ctx => ctx.db.patch(saved.attemptId, { requestFingerprint: JSON.stringify({ command: 'recordCalibrationAttempt', ...commit }) }))
  await expect(t.mutation(internal.learnV2MapCalibration.recordCalibrationAttempt, commit)).resolves.toMatchObject({ attemptId: saved.attemptId, replayed: true })
})

test.each(['purge_first', 'score_first', 'concurrent'] as const)('source purge versus score commit: %s', async ordering => {
  const { t, f, userId, request } = await calibrationFixture()
  const commit = { ...request, serverScorePercent: 80, rubricVersion: 'rubric.v1', rubricSnapshot: 'private-score-rubric' }
  const score = () => t.mutation(internal.learnV2MapCalibration.recordCalibrationAttempt, commit)
  const purge = () => t.mutation(internal.learnV2Retention.purgeSourceEvidence, { userId, sourceIdentityId: f.sourceIdentityId })
  let scored = false
  if (ordering === 'purge_first') {
    await purge()
    await expect(score()).rejects.toThrow(/evidence.*unavailable/i)
  }
  else if (ordering === 'score_first') {
    await score()
    scored = true
    await purge()
  }
  else {
    const [result, revocation] = await Promise.allSettled([score(), purge()])
    expect(revocation.status).toBe('fulfilled')
    scored = result.status === 'fulfilled'
    if (result.status === 'rejected') expect(String(result.reason)).toMatch(/evidence.*unavailable/i)
  }
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  const attempts = await t.run(ctx => ctx.db.query('masteryAttempts')
    .withIndex('by_userId_and_objectiveId_and_attemptedAt', q => q.eq('userId', userId).eq('objectiveId', request.objectiveId)).take(8))
  expect(attempts).toHaveLength(scored ? 1 : 0)
  if (scored) {
    expect(attempts[0]).toMatchObject({ serverScorePercent: 80, confidence: 3, usedHint: false, usedReveal: false, attemptedAt: expect.any(Number) })
    expect(attempts[0]?.requestFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(attempts[0]).not.toHaveProperty('response')
    expect(attempts[0]).not.toHaveProperty('rubricSnapshot')
  }
  await expect(score()).rejects.toThrow(/evidence.*unavailable/i)
})
