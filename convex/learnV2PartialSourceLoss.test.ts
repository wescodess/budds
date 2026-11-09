/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import schema from './schema'
import { STORAGE_CANARIES, seedMeasurementStorage } from '../tests/fixtures/learn-v2-measurement-storage'

const modules = import.meta.glob('./**/*.ts')
const identity = { tokenIdentifier: 'https://auth.example.com|partial-source-loss', name: 'Partial Loss Owner' }
const userId = identity.tokenIdentifier
const HASH = 'a'.repeat(64)
const REVISION = `sha256:${HASH}`
const rubric = { version: 'learn-v2.assessment.v1' as const, kind: 'bounded_rubric' as const, responseFormat: 'short_text' as const,
  instructions: 'Explain from the evidence.', passingScorePercent: 80 as const, criteria: [{ key: 'core', description: 'Core correctness.', weightPercent: 100 }] }
const verdict = { scorerVersion: 'learn-v2.mastery-scorer.v1', criterionResults: [{ key: 'core', awarded: true }], misconceptionTags: [], verifierVersions: ['test.verifier.v1'] }

type Kind = 'url' | 'folder'
const KINDS: Kind[] = ['url', 'folder']
const other = (kind: Kind): Kind => kind === 'url' ? 'folder' : 'url'

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

async function seed() {
  vi.useFakeTimers()
  vi.setSystemTime(Date.parse('2030-09-02T12:00:00Z'))
  vi.stubEnv('LEARN_V2_ENABLED', 'true')
  vi.stubEnv('LEARN_V2_CALIBRATION_MODEL', 'fixture-model')
  const t = convexTest(schema, modules)
  const owner = t.withIdentity(identity)
  await owner.mutation(api.users.upsertUser, {})
  await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: userId, enabled: true })
  const ids = await t.run(async ctx => {
    const now = Date.now()
    const folderId = await ctx.db.insert('folders', { userId, name: 'Sources', documentCount: 1 })
    const documentId = await ctx.db.insert('documents', { userId, folderId, filename: 'backing.txt', fileSize: 1, status: 'success', contentHash: HASH, sourceRevision: REVISION })
    const learningVoidId = await ctx.db.insert('learningVoids', { userId, folderId, title: 'Partial loss', status: 'calibration', revision: 5, createdAt: now, updatedAt: now })
    const blueprintId = await ctx.db.insert('learnBlueprints', { userId, learningVoidId, revision: 1, createdAt: now })
    const blueprintRevisionId = await ctx.db.insert('learnBlueprintRevisions', { userId, blueprintId, learningVoidId, revision: 1, recordRevision: 4, status: 'accepted', createdAt: now, updatedAt: now })
    await ctx.db.patch(learningVoidId, { activeBlueprintRevisionId: blueprintRevisionId })
    const objectiveId = await ctx.db.insert('learnObjectives', { userId, blueprintRevisionId, order: 0, title: 'Objective', capability: 'Capability', estimatedMinutes: 30, coverage: 'strong', assessmentContract: rubric })
    const urlIdentityId = await ctx.db.insert('learnSourceIdentities', { userId, learningVoidId, origin: 'user_url', externalKey: 'https://example.com/a', canonicalUrl: 'https://example.com/a' })
    const urlSnapshotId = await ctx.db.insert('learnSourceSnapshots', { userId, sourceIdentityId: urlIdentityId, learningVoidId, blueprintRevisionId, revision: 1, recordRevision: 1, status: 'user_accepted', effectiveStatus: 'user_accepted', rightsStatus: 'permitted', conflictStatus: 'clear', createdAt: now })
    const urlExcerptId = await ctx.db.insert('learnSourceExcerpts', { userId, sourceSnapshotId: urlSnapshotId, locator: 'paragraph:1', excerpt: 'url-excerpt-canary', rightsStatus: 'permitted' })
    const folderIdentityId = await ctx.db.insert('learnSourceIdentities', { userId, learningVoidId, origin: 'folder_document', externalKey: String(documentId), folderDocumentId: documentId })
    const folderSnapshotId = await ctx.db.insert('learnSourceSnapshots', { userId, sourceIdentityId: folderIdentityId, learningVoidId, blueprintRevisionId, revision: 1, recordRevision: 1, status: 'user_accepted', effectiveStatus: 'user_accepted', rightsStatus: 'unknown', conflictStatus: 'clear', contentHash: HASH, sourceRevision: REVISION, createdAt: now })
    const folderExcerptId = await ctx.db.insert('learnSourceExcerpts', { userId, sourceSnapshotId: folderSnapshotId, locator: 'document', rightsStatus: 'unknown' })
    await ctx.db.insert('learnObjectiveSources', { userId, objectiveId, sourceSnapshotId: urlSnapshotId, coverage: 'strong' })
    await ctx.db.insert('learnObjectiveSources', { userId, objectiveId, sourceSnapshotId: folderSnapshotId, coverage: 'strong' })
    return { folderId, documentId, learningVoidId, blueprintRevisionId, objectiveId,
      url: { identity: urlIdentityId, snapshot: urlSnapshotId, excerpt: urlExcerptId },
      folder: { identity: folderIdentityId, snapshot: folderSnapshotId, excerpt: folderExcerptId } }
  })
  const settle = () => t.finishAllScheduledFunctions(vi.runAllTimers)
  const remove = async (kind: Kind) => kind === 'folder'
    ? await owner.mutation(api.documents.deleteDocument, { id: ids.documentId })
    : await owner.mutation(api.learnV2Sources.markUnavailable, { sourceSnapshotId: ids.url.snapshot, expectedRevision: 1, idempotencyKey: 'remove-url', reason: 'access_lost' })
  const markPurged = async (kind: Kind) => {
    for (let pass = 0; pass < 16; pass++) {
      if ((await t.run(ctx => ctx.db.get(ids[kind].snapshot)))?.evidencePurgedAt !== undefined) return
      await t.mutation(internal.learnV2Retention.purgeSourceEvidence, { userId, sourceIdentityId: ids[kind].identity })
    }
    throw new Error('Source was not marked purged')
  }
  const purgeObjective = (kind: Kind) => t.mutation(internal.learnV2Retention.purgeLegacyObjectiveCopies, { userId, sourceSnapshotId: ids[kind].snapshot, objectiveId: ids.objectiveId })
  const contract = async () => (await t.run(ctx => ctx.db.get(ids.objectiveId)))?.assessmentContract
  const addPlan = () => t.run(async ctx => {
    const now = Date.now()
    const planId = await ctx.db.insert('studyPlans', { userId, learningVoidId: ids.learningVoidId, revision: 1, createdAt: now })
    const planRevisionId = await ctx.db.insert('studyPlanRevisions', { userId, studyPlanId: planId, learningVoidId: ids.learningVoidId, revision: 1, recordRevision: 5, status: 'accepted', blueprintRevisionId: ids.blueprintRevisionId, blueprintRecordRevision: 4, timezone: 'UTC', createdAt: now, updatedAt: now })
    await ctx.db.patch(planId, { activeRevisionId: planRevisionId })
    return planRevisionId
  })
  const addStartedSession = async (planRevisionId: Id<'studyPlanRevisions'>, used: Kind[], key: string) => {
    const created = await t.run(async ctx => {
      const now = Date.now()
      const sessionId = await ctx.db.insert('studySessions', { userId, studyPlanRevisionId: planRevisionId, primaryObjectiveId: ids.objectiveId, status: 'in_progress', revision: 7, scheduledStartAt: now, timezone: 'UTC', placementKind: 'learning' })
      const contentId = await ctx.db.insert('sessionContent', { userId, studySessionId: sessionId, studyPlanRevisionId: planRevisionId, blueprintRevisionId: ids.blueprintRevisionId, objectiveId: ids.objectiveId, revision: 11, status: 'published', assessmentRubricSnapshot: JSON.stringify(rubric), providerModel: 'fixture/model', createdAt: now, publishedAt: now })
      await ctx.db.patch(sessionId, { startedSessionContentId: contentId, startedSessionContentRevision: 11 })
      await ctx.db.insert('sessionContentBlocks', { userId, sessionContentId: contentId, order: 3, kind: 'independent_application', content: 'Apply the evidence.' })
      for (const [order, kind] of used.entries()) {
        const claimId = await ctx.db.insert('sessionContentClaims', { userId, sessionContentId: contentId, order, claim: `claim-${kind}`, verifierVersion: 'test.verifier.v1', confidence: 0.9 })
        await ctx.db.insert('learnClaimSupports', { userId, sessionContentClaimId: claimId, sourceExcerptId: ids[kind].excerpt, sourceSnapshotId: ids[kind].snapshot, entailment: 'entailed', verifierVersion: 'test.verifier.v1', confidence: 0.9, conflictStatus: 'clear', evidenceStatus: 'evidence_available' })
      }
      return { sessionId, contentId }
    })
    const request = { tokenIdentifier: userId, studySessionId: created.sessionId, expectedSessionRevision: 7, expectedContentRevision: 11, expectedPlanRecordRevision: 5, expectedBlueprintRecordRevision: 4, response: `answer-${key}`, confidence: 4, idempotencyKey: key }
    return { ...created, request }
  }
  const addGenerationJob = async (planRevisionId: Id<'studyPlanRevisions'>, sources: Id<'learnSourceSnapshots'>[], fields: Partial<Doc<'learnJobs'>> = {}) => t.run(async ctx => {
    const now = Date.now()
    const sessionId = await ctx.db.insert('studySessions', { userId, studyPlanRevisionId: planRevisionId, primaryObjectiveId: ids.objectiveId, status: 'planned', revision: 1, scheduledStartAt: now - 60_000, scheduledEndAt: now + 3_600_000, timezone: 'UTC' })
    const jobId = await ctx.db.insert('learnJobs', { userId, learningVoidId: ids.learningVoidId, blueprintRevisionId: ids.blueprintRevisionId, studyPlanRevisionId: planRevisionId, studySessionId: sessionId, type: 'session_content_generation', status: 'queued', revision: 1, idempotencyKey: `job-${String(sessionId)}`, requestFingerprint: REVISION, inputDigest: REVISION, expectedVoidRevision: 5, expectedBlueprintRecordRevision: 4, expectedSessionRevision: 1, attempts: 0, dispatchSupportingSourceSnapshotIds: sources, createdAt: now, updatedAt: now, ...fields })
    return { sessionId, jobId }
  })
  return { t, owner, ids, settle, remove, markPurged, purgeObjective, contract, addPlan, addStartedSession, addGenerationJob }
}

async function runJob(f: Awaited<ReturnType<typeof seed>>, jobId: Id<'learnJobs'>) {
  const lease = await f.t.mutation(internal.learnV2SessionContent.leaseSessionContentGeneration, { tokenIdentifier: userId, jobId, expectedRevision: 1 })
  if (lease.kind !== 'leased') throw new Error('Expected a leased job')
  const begun = await f.t.mutation(internal.learnV2SessionContent.beginSessionContentGeneration, { tokenIdentifier: userId, jobId, leaseToken: lease.leaseToken, expectedRevision: lease.revision })
  if (begun.status !== 'running') throw new Error('Expected a running job')
  return { tokenIdentifier: userId, jobId, leaseToken: lease.leaseToken, expectedRevision: begun.revision }
}

describe('objective with several supporting sources', () => {
  test.each(KINDS)('removing the %s source keeps the rubric and only surviving sources drive generation', async kind => {
    const f = await seed()
    const survivor = other(kind)
    await f.t.run(async ctx => {
      const identityId = await ctx.db.insert('learnSourceIdentities', { userId, learningVoidId: f.ids.learningVoidId, origin: 'user_url', externalKey: 'https://example.com/gap' })
      const sourceSnapshotId = await ctx.db.insert('learnSourceSnapshots', { userId, sourceIdentityId: identityId, learningVoidId: f.ids.learningVoidId, blueprintRevisionId: f.ids.blueprintRevisionId, revision: 1, recordRevision: 1, status: 'user_accepted', effectiveStatus: 'user_accepted', rightsStatus: 'permitted', conflictStatus: 'clear', createdAt: Date.now() })
      await ctx.db.insert('learnObjectiveSources', { userId, objectiveId: f.ids.objectiveId, sourceSnapshotId, coverage: 'gap' })
    })
    await f.remove(kind)
    await f.settle()
    expect(await f.contract()).toEqual(rubric)
    expect((await f.t.run(ctx => ctx.db.get(f.ids[kind].snapshot)))?.evidencePurgedAt).toEqual(expect.any(Number))
    expect((await f.t.run(ctx => ctx.db.get(f.ids[survivor].snapshot)))?.evidencePurgedAt).toBeUndefined()

    await f.t.run(ctx => ctx.db.patch(f.ids.learningVoidId, { status: 'plan_review' }))
    const preview = await f.owner.mutation(api.learnV2Plans.createPlanPreview, { learningVoidId: f.ids.learningVoidId, blueprintRevisionId: f.ids.blueprintRevisionId, expectedVoidRevision: 5, expectedBlueprintRecordRevision: 4, idempotencyKey: 'preview',
      schedulingInput: { version: 'learn-v2.schedule-input.v1', timezone: 'UTC', startLocalDate: '2030-09-16', targetLocalDate: '2030-09-20', sessionMinutes: 30, minRestMinutes: 0, availability: [1, 2, 3, 4, 5].map(weekday => ({ weekday, start: '09:00', end: '13:00' })), blackoutDates: [], reviewIntervalsDays: [1] } })
    await f.owner.mutation(api.learnV2Plans.acceptPlanPreview, { studyPlanRevisionId: preview._id as Id<'studyPlanRevisions'>, expectedVoidRevision: 5, expectedPlanRecordRevision: 1, idempotencyKey: 'accept' })
    const jobs = await f.t.run(ctx => ctx.db.query('learnJobs').withIndex('by_userId_and_learningVoidId_and_type', q => q.eq('userId', userId).eq('learningVoidId', f.ids.learningVoidId).eq('type', 'session_content_generation')).take(8))
    expect(jobs.length).toBeGreaterThan(0)
    for (const job of jobs) expect(job.dispatchSupportingSourceSnapshotIds).toEqual([f.ids[survivor].snapshot])
    const input = await f.t.query(internal.learnV2SessionContent.getSessionContentGenerationInput, await runJob(f, jobs[0]!._id))
    expect(input.objective.assessmentRubric).toEqual(rubric)
    expect(input.sources.map(row => row.sourceSnapshotId)).toEqual([f.ids[survivor].snapshot])
  })

  test.each(KINDS)('a started session that used only the surviving source scores after the %s source goes', async kind => {
    const f = await seed()
    const planRevisionId = await f.addPlan()
    const surviving = await f.addStartedSession(planRevisionId, [other(kind)], 'surviving')
    const lost = await f.addStartedSession(planRevisionId, [kind], 'lost')
    await f.remove(kind)
    await f.settle()
    expect(await f.contract()).toEqual(rubric)
    const content = await f.t.run(async ctx => ({ surviving: await ctx.db.get(surviving.contentId), lost: await ctx.db.get(lost.contentId) }))
    expect(content.surviving?.assessmentRubricSnapshot).toBe(JSON.stringify(rubric))
    expect(content.lost?.assessmentRubricSnapshot).toBeUndefined()
    const scoring = await f.t.query(internal.learnV2Mastery.getMasteryScoringInput, surviving.request)
    expect(scoring).toMatchObject({ kind: 'score', sourceSnapshotIds: [f.ids[other(kind)].snapshot] })
    await expect(f.t.mutation(internal.learnV2Mastery.recordMasteryAttempt, { ...surviving.request, scorerVerdict: verdict })).resolves.toMatchObject({ scorePercent: 100, replayed: false })
    await expect(f.t.query(internal.learnV2Mastery.getMasteryScoringInput, lost.request)).rejects.toThrow('Started session rubric is unavailable')
    await expect(f.t.mutation(internal.learnV2Mastery.recordMasteryAttempt, { ...lost.request, scorerVerdict: verdict })).rejects.toThrow()
  })

  test.each(KINDS)('calibration skips the lost %s link and records only surviving evidence', async kind => {
    const f = await seed()
    const request = { tokenIdentifier: userId, blueprintRevisionId: f.ids.blueprintRevisionId, objectiveId: f.ids.objectiveId, expectedBlueprintRecordRevision: 4, expectedVoidRevision: 5, response: 'Calibration answer.', confidence: 3, usedHint: false, usedReveal: false, idempotencyKey: 'calibration' }
    const reservation = await f.t.mutation(internal.learnV2MapCalibration.reserveCalibrationScoring, request)
    if (reservation.kind !== 'acquired') throw new Error('Expected a reservation')
    await f.t.run(ctx => ctx.db.patch(reservation.jobId, { status: 'failed', leaseToken: undefined }))
    await f.remove(kind)
    await f.settle()
    const survivor = f.ids[other(kind)].snapshot
    const next = await f.t.mutation(internal.learnV2MapCalibration.reserveCalibrationScoring, { ...request, idempotencyKey: 'calibration-after-loss' })
    if (next.kind !== 'acquired') throw new Error('Expected a reservation')
    const dispatch = await f.t.mutation(internal.learnV2MapCalibration.markCalibrationScoringDispatched, { tokenIdentifier: userId, jobId: next.jobId, leaseToken: next.leaseToken, expectedRevision: next.revision })
    expect(dispatch.revision).toBe(next.revision + 1)
    const input = await f.t.query(internal.learnV2MapCalibration.getCalibrationScoringInput, { tokenIdentifier: userId, jobId: next.jobId, leaseToken: next.leaseToken, blueprintRevisionId: f.ids.blueprintRevisionId, objectiveId: f.ids.objectiveId, response: request.response })
    expect(input.objective.assessmentContract).toEqual(rubric)
    expect(input.sourceSnapshotIds).toEqual([survivor])
    expect(input.evidence).toHaveLength(1)
    const saved = await f.t.mutation(internal.learnV2MapCalibration.recordCalibrationAttempt, { ...request, idempotencyKey: 'calibration-direct', serverScorePercent: 80, rubricVersion: 'rubric.v1' })
    const attempt = await f.t.run(ctx => ctx.db.get(saved.attemptId))
    expect(attempt?.sourceSnapshotIdsJson).toBe(JSON.stringify([survivor]))
  })

  test('calibration skips a link whose conflict status is not clear, as generation does', async () => {
    const f = await seed()
    await f.t.run(ctx => ctx.db.patch(f.ids.url.snapshot, { conflictStatus: undefined }))
    const saved = await f.t.mutation(internal.learnV2MapCalibration.recordCalibrationAttempt, { tokenIdentifier: userId, blueprintRevisionId: f.ids.blueprintRevisionId, objectiveId: f.ids.objectiveId, expectedBlueprintRecordRevision: 4, expectedVoidRevision: 5, response: 'Answer.', confidence: 3, usedHint: false, usedReveal: false, idempotencyKey: 'calibration-conflict', serverScorePercent: 80, rubricVersion: 'rubric.v1' })
    expect((await f.t.run(ctx => ctx.db.get(saved.attemptId)))?.sourceSnapshotIdsJson).toBe(JSON.stringify([f.ids.folder.snapshot]))
  })

  test('the Journey map keeps the rubric while support survives and returns its safe shape after the last source', async () => {
    const f = await seed()
    const args = { learningVoidId: f.ids.learningVoidId }
    await f.remove('folder')
    await f.settle()
    expect((await f.owner.query(api.learnV2Journey.getMission, args))?.map?.objectives[0]?.assessmentContract).toEqual(rubric)
    await f.remove('url')
    await f.settle()
    expect((await f.owner.query(api.learnV2Journey.getMission, args))?.map?.objectives[0]?.assessmentContract).toMatchObject({ instructions: '', criteria: [] })
  })
})

describe('last supporting source', () => {
  test.each([['url', 'folder'], ['folder', 'url']] as const)('%s then %s clears the rubric and every server path rejects', async (first, second) => {
    const f = await seed()
    const planRevisionId = await f.addPlan()
    const started = await f.addStartedSession(planRevisionId, ['url', 'folder'], 'started')
    const generation = await f.addGenerationJob(planRevisionId, [f.ids.url.snapshot, f.ids.folder.snapshot])
    await f.remove(first)
    await f.settle()
    expect(await f.contract()).toEqual(rubric)
    await f.remove(second)
    await f.settle()
    expect(await f.contract()).toBeUndefined()
    expect((await f.owner.query(api.learnV2Journey.getMission, { learningVoidId: f.ids.learningVoidId }))?.map?.objectives[0]?.assessmentContract).toMatchObject({ instructions: '', criteria: [] })
    await expect(f.t.query(internal.learnV2Mastery.getMasteryScoringInput, started.request)).rejects.toThrow('Started session rubric is unavailable')
    await expect(f.t.mutation(internal.learnV2MapCalibration.reserveCalibrationScoring, { tokenIdentifier: userId, blueprintRevisionId: f.ids.blueprintRevisionId, objectiveId: f.ids.objectiveId, expectedBlueprintRecordRevision: 4, expectedVoidRevision: 5, response: 'Answer.', confidence: 3, usedHint: false, usedReveal: false, idempotencyKey: 'after-last' })).rejects.toThrow('Calibration evidence is unavailable')
    expect((await f.t.run(ctx => ctx.db.get(generation.jobId)))).toMatchObject({ status: 'blocked', terminalReason: 'evidence_unavailable' })
    const job = await f.t.run(async ctx => {
      const sessionId = await ctx.db.insert('studySessions', { userId, studyPlanRevisionId: planRevisionId, primaryObjectiveId: f.ids.objectiveId, status: 'planned', revision: 1, scheduledStartAt: Date.now() })
      return await ctx.db.insert('learnJobs', { userId, learningVoidId: f.ids.learningVoidId, blueprintRevisionId: f.ids.blueprintRevisionId, studyPlanRevisionId: planRevisionId, studySessionId: sessionId, type: 'session_content_generation', status: 'queued', revision: 1, idempotencyKey: 'after-last-job', inputDigest: REVISION, expectedVoidRevision: 5, expectedBlueprintRecordRevision: 4, expectedSessionRevision: 1, attempts: 0, dispatchSupportingSourceSnapshotIds: [f.ids.url.snapshot], createdAt: Date.now(), updatedAt: Date.now() })
    })
    await expect(f.t.query(internal.learnV2SessionContent.getSessionContentGenerationInput, await runJob(f, job))).rejects.toThrow('objective_rubric_unavailable')
  })

  type Step = 'mark-url' | 'mark-folder' | ['run', Kind, 'kept' | 'cleared']
  test.each<[string, Step[]]>([
    ['each source marked then run in turn', ['mark-url', ['run', 'url', 'kept'], 'mark-folder', ['run', 'folder', 'cleared']]],
    ['the other order', ['mark-folder', ['run', 'folder', 'kept'], 'mark-url', ['run', 'url', 'cleared']]],
    ['both marked before either runs', ['mark-url', 'mark-folder', ['run', 'url', 'cleared'], ['run', 'folder', 'cleared']]],
    ['both marked, the other run order', ['mark-folder', 'mark-url', ['run', 'folder', 'cleared'], ['run', 'url', 'cleared']]],
    ['an early run before its own mark', [['run', 'url', 'kept'], 'mark-url', ['run', 'folder', 'cleared']]],
    ['concurrent early runs repeat after each mark', [['run', 'url', 'kept'], ['run', 'folder', 'kept'], 'mark-url', ['run', 'url', 'kept'], 'mark-folder', ['run', 'folder', 'cleared']]],
  ])('no ordering leaves the rubric set forever: %s', async (_name, steps) => {
    const f = await seed()
    for (const step of steps) {
      if (step === 'mark-url') await f.markPurged('url')
      else if (step === 'mark-folder') await f.markPurged('folder')
      else {
        await f.purgeObjective(step[1])
        expect(await f.contract()).toEqual(step[2] === 'kept' ? rubric : undefined)
      }
    }
    await f.settle()
    expect(await f.contract()).toBeUndefined()
  })

  test('two removals in separate concurrent transactions clear the rubric', async () => {
    const f = await seed()
    await Promise.all([
      f.t.mutation(internal.learnV2Retention.purgeSourceEvidence, { userId, sourceIdentityId: f.ids.url.identity }),
      f.t.mutation(internal.learnV2Retention.purgeSourceEvidence, { userId, sourceIdentityId: f.ids.folder.identity }),
    ])
    await f.settle()
    expect(await f.contract()).toBeUndefined()
  })

  test('a multi-pass source purge still re-evaluates after its final mark', async () => {
    const f = await seed()
    const planRevisionId = await f.addPlan()
    await f.t.run(async ctx => {
      const sessionId = await ctx.db.insert('studySessions', { userId, studyPlanRevisionId: planRevisionId, primaryObjectiveId: f.ids.objectiveId, status: 'ready', revision: 1, scheduledStartAt: Date.now() })
      const contentId = await ctx.db.insert('sessionContent', { userId, studySessionId: sessionId, revision: 1, status: 'published', createdAt: Date.now() })
      for (let order = 0; order < 9; order++) {
        const claimId = await ctx.db.insert('sessionContentClaims', { userId, sessionContentId: contentId, order, claim: 'claim' })
        await ctx.db.insert('learnClaimSupports', { userId, sessionContentClaimId: claimId, sourceExcerptId: f.ids.url.excerpt, sourceSnapshotId: f.ids.url.snapshot, entailment: 'entailed', conflictStatus: 'clear', evidenceStatus: 'evidence_available' })
      }
    })
    await f.markPurged('folder')
    await f.purgeObjective('folder')
    expect(await f.contract()).toEqual(rubric)
    await f.t.mutation(internal.learnV2Retention.purgeSourceEvidence, { userId, sourceIdentityId: f.ids.url.identity })
    await f.t.mutation(internal.learnV2Retention.purgeSourceEvidence, { userId, sourceIdentityId: f.ids.url.identity })
    await f.settle()
    expect((await f.t.run(ctx => ctx.db.get(f.ids.url.snapshot)))?.evidencePurgedAt).toEqual(expect.any(Number))
    expect(await f.contract()).toBeUndefined()
  })
})

describe('gap links and availability', () => {
  test('a gap-only link never clears a contract', async () => {
    const f = await seed()
    await f.t.run(async ctx => {
      const links = await ctx.db.query('learnObjectiveSources').withIndex('by_userId_and_objectiveId_and_sourceSnapshotId', q => q.eq('userId', userId).eq('objectiveId', f.ids.objectiveId)).take(4)
      for (const link of links) await ctx.db.patch(link._id, { coverage: 'gap' })
    })
    await f.remove('url')
    await f.settle()
    await f.remove('folder')
    await f.settle()
    expect(await f.contract()).toEqual(rubric)
  })

  test('a live gap link is not support, so removing the only supporting source clears', async () => {
    const f = await seed()
    await f.t.run(async ctx => {
      const link = await ctx.db.query('learnObjectiveSources').withIndex('by_userId_and_objectiveId_and_sourceSnapshotId', q => q.eq('userId', userId).eq('objectiveId', f.ids.objectiveId).eq('sourceSnapshotId', f.ids.folder.snapshot)).unique()
      await ctx.db.patch(link!._id, { coverage: 'gap' })
    })
    await f.remove('url')
    await f.settle()
    expect((await f.t.run(ctx => ctx.db.get(f.ids.folder.snapshot)))?.evidencePurgedAt).toBeUndefined()
    expect(await f.contract()).toBeUndefined()
  })

  test('removing a gap link keeps the rubric while a supporting source remains', async () => {
    const f = await seed()
    await f.t.run(async ctx => {
      const link = await ctx.db.query('learnObjectiveSources').withIndex('by_userId_and_objectiveId_and_sourceSnapshotId', q => q.eq('userId', userId).eq('objectiveId', f.ids.objectiveId).eq('sourceSnapshotId', f.ids.folder.snapshot)).unique()
      await ctx.db.patch(link!._id, { coverage: 'gap' })
    })
    await f.remove('folder')
    await f.settle()
    expect(await f.contract()).toEqual(rubric)
  })

  test('the source being purged counts as gone even before its own snapshot is marked', async () => {
    const f = await seed()
    await f.t.run(async ctx => {
      await ctx.db.patch(f.ids.folder.snapshot, { effectiveStatus: 'unavailable' })
    })
    await f.purgeObjective('url')
    expect(await f.contract()).toBeUndefined()
  })

  test.each<[string, Kind, Partial<Doc<'learnSourceSnapshots'>>]>([
    ['not accepted', 'url', { status: 'rejected' }],
    ['effectively unavailable', 'url', { effectiveStatus: 'unavailable' }],
    ['in conflict', 'url', { conflictStatus: 'unresolved' }],
    ['purged', 'url', { evidencePurgedAt: 1 }],
    ['owned by someone else', 'url', { userId: 'https://other.example|foreign' }],
    ['missing its content hash', 'folder', { contentHash: undefined }],
    ['missing its revision', 'folder', { sourceRevision: undefined }],
  ])('a survivor %s does not keep the rubric', async (_name, survivor, patch) => {
    const f = await seed()
    await f.t.run(ctx => ctx.db.patch(f.ids[survivor].snapshot, patch))
    await f.purgeObjective(other(survivor))
    expect(await f.contract()).toBeUndefined()
  })

  test.each<[string, Partial<Doc<'learnSourceIdentities'>>]>([
    ['without a document', { folderDocumentId: undefined }],
    ['not folder-backed', { origin: 'user_url' }],
    ['owned by someone else', { userId: 'https://other.example|foreign' }],
  ])('a folder survivor whose identity is %s does not keep the rubric', async (_name, patch) => {
    const f = await seed()
    await f.t.run(ctx => ctx.db.patch(f.ids.folder.identity, patch))
    await f.purgeObjective('url')
    expect(await f.contract()).toBeUndefined()
  })

  test.each<[string, Kind]>([['permitted url source', 'url'], ['folder-backed source with unknown rights', 'folder']])('a usable %s keeps the rubric', async (_name, survivor) => {
    const f = await seed()
    await f.purgeObjective(other(survivor))
    expect(await f.contract()).toEqual(rubric)
  })
})

describe('privacy of removed sources', () => {
  test('protected copies of the removed source are purged while the rubric stays', async () => {
    const f = await seed()
    const planRevisionId = await f.addPlan()
    const lost = await f.addStartedSession(planRevisionId, ['url'], 'lost-copies')
    await f.t.run(async ctx => {
      await ctx.db.insert('masteryAttempts', { userId, objectiveId: f.ids.objectiveId, attemptedAt: 1, serverScorePercent: 80, confidence: 3, usedHint: false, usedReveal: false, result: 'passed', idempotencyKey: 'old-attempt', response: 'attempt-canary', rubricSnapshot: 'rubric-canary', sourceSnapshotIdsJson: JSON.stringify([f.ids.url.snapshot]) })
    })
    await f.remove('url')
    await f.settle()
    const rows = await f.t.run(async ctx => ({
      excerpt: await ctx.db.get(f.ids.url.excerpt), snapshot: await ctx.db.get(f.ids.url.snapshot), content: await ctx.db.get(lost.contentId),
      blocks: await ctx.db.query('sessionContentBlocks').withIndex('by_userId_and_sessionContentId_and_order', q => q.eq('userId', userId).eq('sessionContentId', lost.contentId)).take(4),
      attempts: await ctx.db.query('masteryAttempts').withIndex('by_userId_and_objectiveId_and_attemptedAt', q => q.eq('userId', userId).eq('objectiveId', f.ids.objectiveId)).take(4),
    }))
    expect(rows.excerpt).toMatchObject({ evidencePurgedAt: expect.any(Number) })
    expect(rows.excerpt).not.toHaveProperty('excerpt')
    expect(rows.content?.assessmentRubricSnapshot).toBeUndefined()
    expect(rows.blocks.every(row => row.content === undefined)).toBe(true)
    expect(rows.attempts[0]).not.toHaveProperty('response')
    expect(rows.attempts[0]).not.toHaveProperty('rubricSnapshot')
    expect(JSON.stringify(rows)).not.toContain('url-excerpt-canary')
    expect(await f.contract()).toEqual(rubric)
  })

  test('a re-imported source or a replay cannot restore purged text or reset exposure', async () => {
    vi.useFakeTimers()
    vi.stubEnv('LEARN_V2_ENABLED', 'false')
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => seedMeasurementStorage(ctx, userId))
    const live = await t.run(async ctx => {
      const contract = { ...rubric, instructions: 'Keep me.' }
      await ctx.db.patch(f.scope.objectiveId, { assessmentContract: contract })
      await ctx.db.insert('learnObjectiveSources', { userId, objectiveId: f.scope.objectiveId, sourceSnapshotId: f.sourceSnapshotId, coverage: 'strong' })
      const identityId = await ctx.db.insert('learnSourceIdentities', { userId, learningVoidId: f.learningVoidId, origin: 'user_url', externalKey: 'https://example.com/live' })
      const snapshotId = await ctx.db.insert('learnSourceSnapshots', { userId, sourceIdentityId: identityId, learningVoidId: f.learningVoidId, revision: 1, recordRevision: 1, status: 'user_accepted', effectiveStatus: 'user_accepted', rightsStatus: 'permitted', conflictStatus: 'clear', createdAt: Date.now() })
      await ctx.db.insert('learnSourceExcerpts', { userId, sourceSnapshotId: snapshotId, locator: 'paragraph:1', excerpt: 'surviving text', rightsStatus: 'permitted' })
      await ctx.db.insert('learnObjectiveSources', { userId, objectiveId: f.scope.objectiveId, sourceSnapshotId: snapshotId, coverage: 'strong' })
      return { contract, exposure: (await ctx.db.get(f.rows.learnAssessmentExposures))! }
    })
    await t.mutation(internal.learnV2Retention.purgeSourceEvidence, { userId, sourceIdentityId: f.sourceIdentityId })
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    const purged = await t.run(async ctx => ({ excerpt: await ctx.db.get(f.sourceExcerptId), body: await ctx.db.get(f.rows.learnResponseBodies), exposure: await ctx.db.get(f.rows.learnAssessmentExposures) }))
    expect(purged.excerpt).toMatchObject({ evidencePurgedAt: expect.any(Number) })
    expect(purged.excerpt).not.toHaveProperty('excerpt')
    expect(purged.body).toBeNull()
    expect(purged.exposure).toEqual(live.exposure)
    await t.run(async ctx => {
      const newIdentity = await ctx.db.insert('learnSourceIdentities', { userId, learningVoidId: f.learningVoidId, origin: 'folder_document', externalKey: 'fixture-source', folderDocumentId: f.documentId })
      const snapshot = await ctx.db.insert('learnSourceSnapshots', { userId, sourceIdentityId: newIdentity, learningVoidId: f.learningVoidId, revision: 2, recordRevision: 1, status: 'user_accepted', effectiveStatus: 'user_accepted', rightsStatus: 'permitted', conflictStatus: 'clear', contentHash: 'source-hash', sourceRevision: 'source.r1', createdAt: Date.now() })
      await ctx.db.insert('learnSourceExcerpts', { userId, sourceSnapshotId: snapshot, locator: 'page', excerpt: 'Fresh import text', rightsStatus: 'permitted' })
    })
    await t.mutation(internal.learnV2Retention.purgeSourceEvidence, { userId, sourceIdentityId: f.sourceIdentityId })
    await t.mutation(internal.learnV2Retention.purgeLegacyObjectiveCopies, { userId, sourceSnapshotId: f.sourceSnapshotId, objectiveId: f.scope.objectiveId })
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    const replayed = await t.run(async ctx => ({ excerpt: await ctx.db.get(f.sourceExcerptId), snapshot: await ctx.db.get(f.sourceSnapshotId), body: await ctx.db.get(f.rows.learnResponseBodies), exposure: await ctx.db.get(f.rows.learnAssessmentExposures), objective: await ctx.db.get(f.scope.objectiveId) }))
    expect(replayed.excerpt).not.toHaveProperty('excerpt')
    expect(JSON.stringify(replayed.snapshot)).not.toContain('Fresh import text')
    expect(replayed.body).toBeNull()
    expect(replayed.exposure).toEqual(live.exposure)
    expect(JSON.stringify(replayed)).not.toContain(STORAGE_CANARIES.answer)
    expect(replayed.objective?.assessmentContract).toEqual(live.contract)
  })
})

describe('purge during session generation', () => {
  test.each([
    ['queued', {}],
    ['leased', { status: 'leased' as const, leaseToken: 'purge-lease', leaseExpiresAt: Date.parse('2030-09-02T13:00:00Z') }],
    ['running', { status: 'running' as const, leaseToken: 'purge-lease', leaseExpiresAt: Date.parse('2030-09-02T13:00:00Z'), checkpoint: 'preparing_input' }],
  ] as const)('a %s generation job leaves the session blocked and retryable', async (_name, fields) => {
    const f = await seed()
    const planRevisionId = await f.addPlan()
    const { sessionId, jobId } = await f.addGenerationJob(planRevisionId, [f.ids.url.snapshot, f.ids.folder.snapshot], fields)
    vi.setSystemTime(Date.parse('2030-09-02T12:05:00Z'))
    await f.remove('url')
    await f.settle()
    expect(await f.t.run(ctx => ctx.db.get(sessionId))).toMatchObject({ status: 'blocked', revision: 2, auditReasonCode: 'evidence_unavailable' })
    const job = await f.t.run(ctx => ctx.db.get(jobId))
    expect(job).toMatchObject({ status: 'blocked', terminalReason: 'evidence_unavailable', revision: 2 })
    expect(job?.updatedAt).toBeGreaterThanOrEqual(Date.parse('2030-09-02T12:05:00Z'))
    expect(job).not.toHaveProperty('leaseToken')
    expect(job).not.toHaveProperty('leaseExpiresAt')
    expect(job).not.toHaveProperty('checkpoint')
    await f.settle()
    expect(await f.t.run(ctx => ctx.db.get(sessionId))).toMatchObject({ status: 'blocked', revision: 2 })
    await expect(f.owner.query(api.learnV2Today.getToday, {})).resolves.toMatchObject({ status: 'blocked', reason: 'evidence_unavailable', sessionId, sessionRevision: 2, canRetryGeneration: true })
    await expect(f.owner.mutation(api.learnV2SessionContent.retrySessionContentGeneration, { studySessionId: sessionId, expectedSessionRevision: 2, idempotencyKey: 'retry-after-purge' })).resolves.toMatchObject({ status: 'pending', sessionRevision: 3 })
  })

  test('matches the session and job state the worker path produces', async () => {
    const f = await seed()
    const planRevisionId = await f.addPlan()
    const purged = await f.addGenerationJob(planRevisionId, [f.ids.url.snapshot])
    await f.remove('url')
    await f.settle()
    const g = await seed()
    const gPlanRevisionId = await g.addPlan()
    const worker = await g.addGenerationJob(gPlanRevisionId, [g.ids.url.snapshot])
    await g.t.run(ctx => ctx.db.patch(g.ids.url.snapshot, { evidencePurgedAt: 1 }))
    const running = await runJob(g, worker.jobId)
    await expect(g.t.query(internal.learnV2SessionContent.getSessionContentGenerationInput, running)).rejects.toThrow('evidence_unavailable')
    await g.t.mutation(internal.learnV2SessionContent.terminalizeSessionContentGeneration, { ...running, reason: 'evidence_unavailable', sessionStatus: 'blocked' })
    const pick = (row: Record<string, unknown> | null) => row && Object.fromEntries(['status', 'revision', 'auditReasonCode', 'terminalReason', 'leaseToken', 'leaseExpiresAt', 'checkpoint'].map(key => [key, row[key]]))
    const [fSession, gSession, fJob, gJob] = [
      await f.t.run(ctx => ctx.db.get(purged.sessionId)), await g.t.run(ctx => ctx.db.get(worker.sessionId)),
      await f.t.run(ctx => ctx.db.get(purged.jobId)), await g.t.run(ctx => ctx.db.get(worker.jobId)),
    ]
    expect(pick(fSession)).toEqual(pick(gSession))
    expect({ ...pick(fJob), revision: 0 }).toEqual({ ...pick(gJob), revision: 0 })
  })

  test('leaves unrelated sessions and jobs alone', async () => {
    const f = await seed()
    const planRevisionId = await f.addPlan()
    const unrelated = await f.addGenerationJob(planRevisionId, [f.ids.folder.snapshot])
    const stale = await f.addGenerationJob(planRevisionId, [f.ids.url.snapshot], { expectedSessionRevision: 9 })
    const blocked = await f.addGenerationJob(planRevisionId, [f.ids.url.snapshot], { status: 'blocked', terminalReason: 'provider_outcome_unknown' })
    const succeeded = await f.addGenerationJob(planRevisionId, [f.ids.url.snapshot], { status: 'succeeded' })
    const scoring = await f.addGenerationJob(planRevisionId, [f.ids.url.snapshot], { type: 'calibration_scoring' })
    const foreign = await f.addGenerationJob(planRevisionId, [f.ids.url.snapshot])
    await f.t.run(ctx => ctx.db.patch(foreign.sessionId, { userId: 'https://other.example|foreign' }))
    await f.remove('url')
    await f.settle()
    const state = (ids: { sessionId: Id<'studySessions'>, jobId: Id<'learnJobs'> }) => f.t.run(async ctx => ({ session: await ctx.db.get(ids.sessionId), job: await ctx.db.get(ids.jobId) }))
    expect((await state(unrelated)).session).toMatchObject({ status: 'planned', revision: 1 })
    expect((await state(unrelated)).job).toMatchObject({ status: 'queued', revision: 1 })
    expect((await state(stale)).session).toMatchObject({ status: 'planned', revision: 1 })
    expect((await state(stale)).job).toMatchObject({ status: 'blocked', revision: 2 })
    expect((await state(blocked)).session).toMatchObject({ status: 'planned', revision: 1 })
    expect((await state(blocked)).job).toMatchObject({ status: 'blocked', revision: 1 })
    expect((await state(succeeded)).session).toMatchObject({ status: 'planned', revision: 1 })
    expect((await state(succeeded)).job).toMatchObject({ status: 'succeeded', revision: 1 })
    expect((await state(scoring)).session).toMatchObject({ status: 'planned', revision: 1 })
    expect((await state(scoring)).job).toMatchObject({ status: 'blocked', revision: 1 })
    expect((await state(foreign)).session).toMatchObject({ status: 'planned', revision: 1 })
  })

  test.each([
    ['session content has not started', 'unstarted'],
    ['content has no claims', 'no_claims'],
    ['content exceeds the claim bound', 'too_many_claims'],
    ['a claim exceeds the support bound', 'too_many_supports'],
    ['a support is pinned through its excerpt', 'excerpt_support'],
    ['a support lost its excerpt', 'missing_excerpt'],
    ['the started session belongs to someone else', 'foreign_session'],
  ] as const)('an in-flight scoring job stops when %s', async (_name, shape) => {
    const f = await seed()
    const planRevisionId = await f.addPlan()
    const started = await f.addStartedSession(planRevisionId, ['folder'], `inflight-${shape}`)
    await f.t.run(async ctx => {
      if (shape === 'unstarted') await ctx.db.patch(started.sessionId, { startedSessionContentId: undefined, startedSessionContentRevision: undefined })
      const claims = await ctx.db.query('sessionContentClaims').withIndex('by_userId_and_sessionContentId_and_order', q => q.eq('userId', userId).eq('sessionContentId', started.contentId)).take(4)
      const support = await ctx.db.query('learnClaimSupports').withIndex('by_userId_and_sessionContentClaimId', q => q.eq('userId', userId).eq('sessionContentClaimId', claims[0]!._id)).unique()
      if (shape === 'no_claims') { await ctx.db.delete(support!._id); await ctx.db.delete(claims[0]!._id) }
      if (shape === 'too_many_claims') for (let order = 1; order <= 32; order++) await ctx.db.insert('sessionContentClaims', { userId, sessionContentId: started.contentId, order, claim: 'extra' })
      if (shape === 'too_many_supports') for (let copy = 0; copy < 8; copy++) await ctx.db.insert('learnClaimSupports', { userId, sessionContentClaimId: claims[0]!._id, sourceExcerptId: f.ids.folder.excerpt, sourceSnapshotId: f.ids.folder.snapshot, entailment: 'entailed', conflictStatus: 'clear', evidenceStatus: 'evidence_available' })
      if (shape === 'excerpt_support') await ctx.db.insert('learnClaimSupports', { userId, sessionContentClaimId: claims[0]!._id, sourceExcerptId: f.ids.url.excerpt, entailment: 'entailed', conflictStatus: 'clear', evidenceStatus: 'evidence_available' })
      if (shape === 'missing_excerpt') {
        const excerptId = await ctx.db.insert('learnSourceExcerpts', { userId, sourceSnapshotId: f.ids.folder.snapshot, locator: 'gone', rightsStatus: 'unknown' })
        await ctx.db.insert('learnClaimSupports', { userId, sessionContentClaimId: claims[0]!._id, sourceExcerptId: excerptId, entailment: 'entailed', conflictStatus: 'clear', evidenceStatus: 'evidence_available' })
        await ctx.db.delete(excerptId)
      }
      if (shape === 'foreign_session') await ctx.db.patch(started.sessionId, { userId: 'https://other.example|foreign' })
    })
    const jobId = await f.t.run(ctx => ctx.db.insert('learnJobs', { userId, learningVoidId: f.ids.learningVoidId, blueprintRevisionId: f.ids.blueprintRevisionId, studyPlanRevisionId: planRevisionId, studySessionId: started.sessionId, type: 'mastery_scoring', status: 'running', revision: 1, idempotencyKey: `job-${shape}`, leaseToken: 'lease', leaseExpiresAt: Date.now() + 60_000 }))
    await f.remove('url')
    await f.settle()
    expect(await f.t.run(ctx => ctx.db.get(jobId))).toMatchObject({ status: 'blocked', terminalReason: 'evidence_unavailable' })
  })

  test('a finished scoring job on surviving content is still redacted, and a generation job on started content still stops', async () => {
    const f = await seed()
    const planRevisionId = await f.addPlan()
    const surviving = await f.addStartedSession(planRevisionId, ['folder'], 'finished-surviving')
    const raw = JSON.stringify({ command: 'submitMasteryAttempt', response: 'raw-fingerprint-canary' })
    const [finished, generation] = await f.t.run(async ctx => [
      await ctx.db.insert('learnJobs', { userId, learningVoidId: f.ids.learningVoidId, blueprintRevisionId: f.ids.blueprintRevisionId, studyPlanRevisionId: planRevisionId, studySessionId: surviving.sessionId, type: 'mastery_scoring', status: 'succeeded', revision: 1, idempotencyKey: 'finished', requestFingerprint: raw, checkpoint: 'attempt:done' }),
      await ctx.db.insert('learnJobs', { userId, learningVoidId: f.ids.learningVoidId, blueprintRevisionId: f.ids.blueprintRevisionId, studyPlanRevisionId: planRevisionId, studySessionId: surviving.sessionId, type: 'session_content_generation', status: 'queued', revision: 1, idempotencyKey: 'generation-on-started', expectedSessionRevision: 7, dispatchSupportingSourceSnapshotIds: [f.ids.url.snapshot] }),
    ])
    await f.remove('url')
    await f.settle()
    const rows = await f.t.run(async ctx => ({ finished: await ctx.db.get(finished!), generation: await ctx.db.get(generation!), session: await ctx.db.get(surviving.sessionId) }))
    expect(rows.finished).toMatchObject({ status: 'succeeded', requestFingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) })
    expect(rows.finished).not.toHaveProperty('checkpoint')
    expect(JSON.stringify(rows.finished)).not.toContain('raw-fingerprint-canary')
    expect(rows.generation).toMatchObject({ status: 'blocked', terminalReason: 'evidence_unavailable', revision: 2 })
    expect(rows.session).toMatchObject({ status: 'in_progress', revision: 7 })
  })

  test('an in-flight scoring job continues when its content did not use the removed source', async () => {
    const f = await seed()
    const planRevisionId = await f.addPlan()
    const surviving = await f.addStartedSession(planRevisionId, ['folder'], 'inflight-surviving')
    const lost = await f.addStartedSession(planRevisionId, ['url'], 'inflight-lost')
    const scoringJob = (sessionId: Id<'studySessions'>, key: string) => f.t.run(ctx => ctx.db.insert('learnJobs', { userId, learningVoidId: f.ids.learningVoidId, blueprintRevisionId: f.ids.blueprintRevisionId, studyPlanRevisionId: planRevisionId, studySessionId: sessionId, type: 'mastery_scoring', status: 'running', revision: 1, idempotencyKey: key, requestFingerprint: REVISION, leaseToken: 'lease', leaseExpiresAt: Date.now() + 60_000, checkpoint: 'provider_dispatched' }))
    await f.t.run(async ctx => {
      const claim = await ctx.db.query('sessionContentClaims').withIndex('by_userId_and_sessionContentId_and_order', q => q.eq('userId', userId).eq('sessionContentId', surviving.contentId)).first()
      await ctx.db.insert('learnClaimSupports', { userId, sessionContentClaimId: claim!._id, sourceExcerptId: f.ids.folder.excerpt, entailment: 'entailed', conflictStatus: 'clear', evidenceStatus: 'evidence_available' })
    })
    const continuing = await scoringJob(surviving.sessionId, 'scoring-surviving')
    const stopped = await scoringJob(lost.sessionId, 'scoring-lost')
    await f.remove('url')
    await f.settle()
    expect(await f.t.run(ctx => ctx.db.get(continuing))).toMatchObject({ status: 'running', leaseToken: 'lease', checkpoint: 'provider_dispatched', requestFingerprint: REVISION })
    expect(await f.t.run(ctx => ctx.db.get(stopped))).toMatchObject({ status: 'blocked', terminalReason: 'evidence_unavailable' })
    expect(await f.t.run(ctx => ctx.db.get(stopped))).not.toHaveProperty('checkpoint')
  })
})
