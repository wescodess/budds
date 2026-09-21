/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import { LEARN_V2_MASTERY_SCORING_ADMISSION } from './learnV2Mastery'
import { masteryScopeKey } from './lib/learnV2MasteryScope'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const OWNER = { tokenIdentifier: 'https://auth.example.com|mastery-owner', name: 'Mastery Owner' }
const OTHER = { tokenIdentifier: 'https://auth.example.com|mastery-other', name: 'Mastery Other' }
const assessment = { version: 'learn-v2.assessment.v1' as const, kind: 'machine_checkable' as const, responseFormat: 'short_text' as const, instructions: 'Answer from the evidence.', passingScorePercent: 80 as const, criteria: [{ key: 'core', description: 'Core correctness.', weightPercent: 79 }, { key: 'boundary', description: 'Boundary correctness.', weightPercent: 1 }, { key: 'edge', description: 'Complete correctness.', weightPercent: 20 }] }
const rubric = JSON.stringify(assessment)
const verdict = (score = 100) => ({ scorerVersion: 'learn-v2.mastery-scorer.v1', criterionResults: [{ key: 'core', awarded: score >= 79 }, { key: 'boundary', awarded: score >= 80 }, { key: 'edge', awarded: score === 100 }], misconceptionTags: [], verifierVersions: ['test.verifier.v1'] })

async function fixture(options: { placementKind?: 'learning' | 'retained_review', state?: 'guided' | 'independent', firstDate?: string, sessionTimezone?: string } = {}) {
  process.env.LEARN_V2_ENABLED = 'true'
  const t = convexTest(schema, modules)
  const owner = t.withIdentity(OWNER)
  await owner.mutation(api.users.upsertUser, {})
  await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: OWNER.tokenIdentifier, enabled: true })
  const ids = await t.run(async ctx => {
    const now = Date.now()
    const folderId = await ctx.db.insert('folders', { userId: OWNER.tokenIdentifier, name: 'Mastery', documentCount: 0 })
    const voidId = await ctx.db.insert('learningVoids', { userId: OWNER.tokenIdentifier, folderId, title: 'Mastery', status: 'active', revision: 1, createdAt: now, updatedAt: now })
    const blueprintId = await ctx.db.insert('learnBlueprints', { userId: OWNER.tokenIdentifier, learningVoidId: voidId, revision: 1, createdAt: now })
    const blueprintIdRevision = await ctx.db.insert('learnBlueprintRevisions', { userId: OWNER.tokenIdentifier, blueprintId, learningVoidId: voidId, revision: 1, recordRevision: 3, status: 'accepted', createdAt: now, updatedAt: now })
    await ctx.db.patch(voidId, { activeBlueprintRevisionId: blueprintIdRevision })
    const objectiveId = await ctx.db.insert('learnObjectives', { userId: OWNER.tokenIdentifier, blueprintRevisionId: blueprintIdRevision, order: 1, title: 'Objective', assessmentContract: assessment })
    const planId = await ctx.db.insert('studyPlans', { userId: OWNER.tokenIdentifier, learningVoidId: voidId, revision: 1, createdAt: now })
    const planRevisionId = await ctx.db.insert('studyPlanRevisions', { userId: OWNER.tokenIdentifier, studyPlanId: planId, learningVoidId: voidId, revision: 1, recordRevision: 5, status: 'accepted', blueprintRevisionId: blueprintIdRevision, blueprintRecordRevision: 3, timezone: options.sessionTimezone ?? 'America/Toronto', createdAt: now })
    await ctx.db.patch(planId, { activeRevisionId: planRevisionId })
    const sessionId = await ctx.db.insert('studySessions', { userId: OWNER.tokenIdentifier, studyPlanRevisionId: planRevisionId, primaryObjectiveId: objectiveId, status: 'in_progress', revision: 7, scheduledStartAt: now, timezone: options.sessionTimezone ?? 'America/Toronto', placementKind: options.placementKind ?? 'learning' })
    const contentId = await ctx.db.insert('sessionContent', { userId: OWNER.tokenIdentifier, studySessionId: sessionId, studyPlanRevisionId: planRevisionId, blueprintRevisionId: blueprintIdRevision, objectiveId, revision: 11, status: 'published', assessmentRubricSnapshot: rubric, providerModel: 'test/mastery-model', createdAt: now, publishedAt: now })
    await ctx.db.patch(sessionId, { startedSessionContentId: contentId, startedSessionContentRevision: 11 })
    await ctx.db.insert('sessionContentBlocks', { userId: OWNER.tokenIdentifier, sessionContentId: contentId, order: 1, kind: 'worked_example', content: 'Revealed worked answer.' })
    await ctx.db.insert('sessionContentBlocks', { userId: OWNER.tokenIdentifier, sessionContentId: contentId, order: 2, kind: 'faded_example', content: 'Substantive hint.' })
    await ctx.db.insert('sessionContentBlocks', { userId: OWNER.tokenIdentifier, sessionContentId: contentId, order: 3, kind: 'independent_application', content: 'Apply the evidence to a novel case.' })
    const sourceIdentityId = await ctx.db.insert('learnSourceIdentities', { userId: OWNER.tokenIdentifier, learningVoidId: voidId, origin: 'user_url', externalKey: 'mastery-source' })
    const sourceId = await ctx.db.insert('learnSourceSnapshots', { userId: OWNER.tokenIdentifier, sourceIdentityId, learningVoidId: voidId, revision: 1, status: 'user_accepted', effectiveStatus: 'user_accepted', rightsStatus: 'permitted', conflictStatus: 'clear', createdAt: now })
    await ctx.db.insert('learnObjectiveSources', { userId: OWNER.tokenIdentifier, objectiveId, sourceSnapshotId: sourceId, coverage: 'strong' })
    const excerptId = await ctx.db.insert('learnSourceExcerpts', { userId: OWNER.tokenIdentifier, sourceSnapshotId: sourceId, locator: 'paragraph:1', excerpt: 'Supported evidence.', rightsStatus: 'permitted' })
    const claimId = await ctx.db.insert('sessionContentClaims', { userId: OWNER.tokenIdentifier, sessionContentId: contentId, order: 1, claim: 'The evidence supports the answer.', verifierVersion: 'test.verifier.v1', confidence: 0.9 })
    await ctx.db.insert('learnClaimSupports', { userId: OWNER.tokenIdentifier, sessionContentClaimId: claimId, sourceExcerptId: excerptId, sourceSnapshotId: sourceId, entailment: 'entailed', verifierVersion: 'test.verifier.v1', confidence: 0.9, conflictStatus: 'clear', evidenceStatus: 'evidence_available' })
    if (options.state) await ctx.db.insert('masteryRecords', { userId: OWNER.tokenIdentifier, blueprintRevisionId: blueprintIdRevision, objectiveId, scopeKey: await masteryScopeKey(OWNER.tokenIdentifier, blueprintIdRevision, objectiveId), state: options.state, recordRevision: 4, firstIndependentLocalDate: options.firstDate, firstIndependentPassAt: options.firstDate ? now : undefined, firstIndependentTimezone: options.firstDate ? 'America/Toronto' : undefined, updatedAt: now })
    return { voidId, blueprintIdRevision, objectiveId, planId, planRevisionId, sessionId, contentId, sourceId }
  })
  const args = (key: string, score = 100) => ({ tokenIdentifier: OWNER.tokenIdentifier, studySessionId: ids.sessionId, expectedSessionRevision: 7, expectedContentRevision: 11, expectedPlanRecordRevision: 5, expectedBlueprintRecordRevision: 3, response: 'A server-scored response.', confidence: 4, idempotencyKey: key, scorerVerdict: verdict(score) })
  return { t, owner, ids, args }
}

describe('LA2-12 server-scored mastery attempts', () => {
  test('revalidates the active Blueprint pointer before reservation and provider dispatch', async () => {
    const beforeReservation = await fixture()
    await beforeReservation.t.run(ctx => ctx.db.patch(beforeReservation.ids.voidId, { activeBlueprintRevisionId: undefined }))
    const { scorerVerdict: _firstVerdict, ...missingPointerRequest } = beforeReservation.args('missing-pointer', 80)
    await expect(beforeReservation.t.mutation(internal.learnV2Mastery.beginMasteryScoring, missingPointerRequest)).rejects.toThrow(/active Blueprint pointer/i)

    const beforeDispatch = await fixture()
    const { scorerVerdict: _secondVerdict, ...dispatchRequest } = beforeDispatch.args('stale-before-dispatch', 80)
    const reservation = await beforeDispatch.t.mutation(internal.learnV2Mastery.beginMasteryScoring, dispatchRequest)
    expect(reservation.kind).toBe('acquired')
    if (reservation.kind !== 'acquired') throw new Error('Expected scoring lease')
    await beforeDispatch.t.run(ctx => ctx.db.patch(beforeDispatch.ids.voidId, { activeBlueprintRevisionId: undefined }))
    await expect(beforeDispatch.t.mutation(internal.learnV2Mastery.markMasteryScoringDispatched, {
      tokenIdentifier: OWNER.tokenIdentifier,
      jobId: reservation.jobId,
      leaseToken: reservation.leaseToken,
    })).rejects.toThrow(/active Blueprint pointer/i)

    const beforeCommit = await fixture()
    await beforeCommit.t.run(ctx => ctx.db.patch(beforeCommit.ids.voidId, { activeBlueprintRevisionId: undefined }))
    await expect(beforeCommit.t.mutation(internal.learnV2Mastery.recordMasteryAttempt, beforeCommit.args('stale-before-commit', 80))).rejects.toThrow(/active Blueprint pointer/i)
  })

  test('fails closed when scored evidence revisions drift before attempt commit', async () => {
    const setup = await fixture()
    const { scorerVerdict: _verdict, ...request } = setup.args('evidence-drift', 80)
    const reservation = await setup.t.mutation(internal.learnV2Mastery.beginMasteryScoring, request)
    expect(reservation.kind).toBe('acquired')
    if (reservation.kind !== 'acquired') throw new Error('Expected scoring lease')
    const input = await setup.t.query(internal.learnV2Mastery.getMasteryScoringInput, request)
    expect(input.kind).toBe('score')
    if (input.kind !== 'score') throw new Error('Expected scoring input')
    await setup.t.mutation(internal.learnV2Mastery.markMasteryScoringDispatched, { tokenIdentifier: OWNER.tokenIdentifier, jobId: reservation.jobId, leaseToken: reservation.leaseToken })
    await setup.t.run(ctx => ctx.db.patch(setup.ids.sourceId, { recordRevision: 2 }))
    await expect(setup.t.mutation(internal.learnV2Mastery.recordMasteryAttempt, {
      ...setup.args('evidence-drift', 80),
      scoringJobId: reservation.jobId,
      scoringLeaseToken: reservation.leaseToken,
      scoredSourceSnapshotIds: input.sourceSnapshotIds,
      scoredContentRevisionPins: input.contentRevisionPins,
    })).rejects.toThrow(/evidence pins do not match/i)
  })

  test('leaves legacy unscoped mastery read-only and creates the scoped projection', async () => {
    const { t, ids, args } = await fixture()
    const legacyRecordId = await t.run(ctx => ctx.db.insert('masteryRecords', {
      userId: OWNER.tokenIdentifier,
      objectiveId: ids.objectiveId,
      state: 'guided',
      recordRevision: 7,
      updatedAt: 1,
    }))
    const result = await t.mutation(internal.learnV2Mastery.recordMasteryAttempt, args('scoped-projection', 80))
    expect(result).toMatchObject({ state: 'independent', replayed: false })
    const rows = await t.run(async (ctx) => ({
      legacy: await ctx.db.get(legacyRecordId),
      attempt: await ctx.db.get(result.attemptId),
      scoped: await ctx.db.query('masteryRecords')
        .withIndex('by_userId_and_blueprintRevisionId', q => q.eq('userId', OWNER.tokenIdentifier).eq('blueprintRevisionId', ids.blueprintIdRevision))
        .unique(),
    }))
    expect(rows.legacy).not.toHaveProperty('blueprintRevisionId')
    expect(rows.legacy).toMatchObject({ state: 'guided', recordRevision: 7 })
    expect(rows.attempt).toMatchObject({
      blueprintRevisionId: ids.blueprintIdRevision,
      objectiveId: ids.objectiveId,
      sessionContentId: ids.contentId,
      studyPlanRevisionId: ids.planRevisionId,
      activityContractVersion: 'learn-v2.mastery-attempt.v1',
      providerVersion: 'openrouter-via-cloudflare-ai-gateway.v1',
      rubricVersion: 'learn-v2.assessment.v1',
      scorerVersion: 'learn-v2.mastery-scorer.v1',
      scorerModel: 'test/mastery-model',
      verifierVersionsJson: JSON.stringify(['test.verifier.v1']),
      sessionRevision: 7,
      contentRevision: 11,
      planRevision: 1,
      planRecordRevision: 5,
      blueprintRecordRevision: 3,
    })
    expect(JSON.parse(rows.attempt!.contentRevisionPinsJson!)).toMatchObject([{ sourceSnapshotId: String(ids.sourceId), sourceRevisionNumber: 1, sourceRecordRevision: 1, sourceRevision: null, excerptLocator: 'paragraph:1', verifierVersion: 'test.verifier.v1' }])
    expect(rows.scoped).toMatchObject({ blueprintRevisionId: ids.blueprintIdRevision, objectiveId: ids.objectiveId, scopeKey: await masteryScopeKey(OWNER.tokenIdentifier, ids.blueprintIdRevision, ids.objectiveId), state: 'independent' })
  })

  test('commits at most one deterministic mastery projection for concurrent same-scope commands', async () => {
    const setup = await fixture()
    const secondSessionId = await setup.t.run(async (ctx) => {
      const now = Date.now()
      const sessionId = await ctx.db.insert('studySessions', { userId: OWNER.tokenIdentifier, studyPlanRevisionId: setup.ids.planRevisionId, primaryObjectiveId: setup.ids.objectiveId, status: 'in_progress', revision: 7, scheduledStartAt: now + 1, timezone: 'America/Toronto', placementKind: 'learning' })
      const contentId = await ctx.db.insert('sessionContent', { userId: OWNER.tokenIdentifier, studySessionId: sessionId, studyPlanRevisionId: setup.ids.planRevisionId, blueprintRevisionId: setup.ids.blueprintIdRevision, objectiveId: setup.ids.objectiveId, revision: 11, status: 'published', assessmentRubricSnapshot: rubric, providerModel: 'test/mastery-model', createdAt: now, publishedAt: now })
      await ctx.db.patch(sessionId, { startedSessionContentId: contentId, startedSessionContentRevision: 11 })
      await ctx.db.insert('sessionContentBlocks', { userId: OWNER.tokenIdentifier, sessionContentId: contentId, order: 1, kind: 'independent_application', content: 'Apply the evidence to another novel case.' })
      const excerpt = await ctx.db.query('learnSourceExcerpts').withIndex('by_userId_and_sourceSnapshotId', q => q.eq('userId', OWNER.tokenIdentifier).eq('sourceSnapshotId', setup.ids.sourceId)).unique()
      const claimId = await ctx.db.insert('sessionContentClaims', { userId: OWNER.tokenIdentifier, sessionContentId: contentId, order: 1, claim: 'The evidence supports another answer.', verifierVersion: 'test.verifier.v1', confidence: 0.9 })
      await ctx.db.insert('learnClaimSupports', { userId: OWNER.tokenIdentifier, sessionContentClaimId: claimId, sourceExcerptId: excerpt!._id, sourceSnapshotId: setup.ids.sourceId, entailment: 'entailed', verifierVersion: 'test.verifier.v1', confidence: 0.9, conflictStatus: 'clear', evidenceStatus: 'evidence_available' })
      return sessionId
    })
    const [first, second] = await Promise.allSettled([
      setup.t.mutation(internal.learnV2Mastery.recordMasteryAttempt, setup.args('scope-race-a', 80)),
      setup.t.mutation(internal.learnV2Mastery.recordMasteryAttempt, { ...setup.args('scope-race-b', 80), studySessionId: secondSessionId }),
    ])
    expect([first.status, second.status]).toEqual(['fulfilled', 'fulfilled'])
    const scopeKey = await masteryScopeKey(OWNER.tokenIdentifier, setup.ids.blueprintIdRevision, setup.ids.objectiveId)
    const records = await setup.t.run(ctx => ctx.db.query('masteryRecords').withIndex('by_userId_and_scopeKey', q => q.eq('userId', OWNER.tokenIdentifier).eq('scopeKey', scopeKey)).take(2))
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ blueprintRevisionId: setup.ids.blueprintIdRevision, objectiveId: setup.ids.objectiveId, scopeKey })
  })

  test('records monotonic server-observed hint/reveal use and denies another owner', async () => {
    const { t, owner, ids } = await fixture()
    expect((await owner.query(api.learnV2SessionContent.getSessionContent, { studySessionId: ids.sessionId }))!.blocks.map(block => block.kind)).not.toContain('faded_example')
    const hint = await owner.mutation(api.learnV2Mastery.recordAssistanceUse, { studySessionId: ids.sessionId, expectedSessionRevision: 7, kind: 'substantive_hint' })
    expect(hint).toMatchObject({ revision: 8, replayed: false, assistance: { content: 'Substantive hint.' } })
    expect((await owner.query(api.learnV2SessionContent.getSessionContent, { studySessionId: ids.sessionId }))!.blocks.map(block => block.kind)).toContain('faded_example')
    expect(await owner.mutation(api.learnV2Mastery.recordAssistanceUse, { studySessionId: ids.sessionId, expectedSessionRevision: 8, kind: 'substantive_hint' })).toMatchObject({ revision: 8, replayed: true })
    await t.withIdentity(OTHER).mutation(api.users.upsertUser, {})
    await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: OTHER.tokenIdentifier, enabled: true })
    await expect(t.withIdentity(OTHER).mutation(api.learnV2Mastery.recordAssistanceUse, { studySessionId: ids.sessionId, expectedSessionRevision: 8, kind: 'answer_reveal' })).rejects.toThrow(/Study session not found/)
    expect(await owner.mutation(api.learnV2Mastery.recordAssistanceUse, { studySessionId: ids.sessionId, expectedSessionRevision: 8, kind: 'answer_reveal' })).toMatchObject({ revision: 9, replayed: false, assistance: { content: 'Revealed worked answer.' } })
  })

  test('scores through the authenticated server action and replays before provider dispatch', async () => {
    const { owner, args } = await fixture()
    const internalArgs = args('public-submit', 80)
    const { tokenIdentifier: _tokenIdentifier, scorerVerdict: _scorerVerdict, ...publicArgs } = internalArgs
    const provider = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ id: 'score-1', model: 'test/mastery-model', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ criterionResults: verdict(80).criterionResults.map(row => ({ ...row, rationale: 'Pinned evidence supports this decision.' })), misconceptionTags: [] }) } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', provider)
    process.env.OPENROUTER_API_KEY = 'test-key'
    process.env.CF_ACCOUNT_ID = 'test-account'
    process.env.CLOUDFLARE_AI_GATEWAY_ID = 'test-gateway'
    try {
      await expect(owner.action(api.learnV2Mastery.submitMasteryAttempt, publicArgs)).resolves.toMatchObject({ scorePercent: 80, state: 'independent', replayed: false })
      await expect(owner.action(api.learnV2Mastery.submitMasteryAttempt, publicArgs)).resolves.toMatchObject({ scorePercent: 80, state: 'independent', replayed: true })
      expect(provider).toHaveBeenCalledTimes(1)
      const request = provider.mock.calls[0]![1] as RequestInit
      expect(request.headers).toMatchObject({ 'cf-aig-max-attempts': '1', 'cf-aig-collect-log-payload': 'false', 'cf-aig-skip-cache': 'true' })
      expect(JSON.parse(String(request.body))).toMatchObject({ max_tokens: 1_200, provider: { allow_fallbacks: false, zdr: true, data_collection: 'deny' } })
    }
    finally {
      delete process.env.OPENROUTER_API_KEY
      delete process.env.CF_ACCOUNT_ID
      delete process.env.CLOUDFLARE_AI_GATEWAY_ID
      vi.unstubAllGlobals()
    }
  })

  test('records the versioned minimized request ledger before provider I/O without raw payloads', async () => {
    const { t, args } = await fixture()
    const { scorerVerdict: _verdict, ...request } = args('request-ledger', 80)
    const reservation = await t.mutation(internal.learnV2Mastery.beginMasteryScoring, request)
    expect(reservation.kind).toBe('acquired')
    if (reservation.kind !== 'acquired') throw new Error('Expected scoring lease')
    const job = await t.run(ctx => ctx.db.get(reservation.jobId))
    expect(job).toMatchObject({
      providerRequestVersion: 'adaptive-v2-mastery-request.v1',
      providerVersion: 'openrouter-via-cloudflare-ai-gateway.v1',
      providerJobVersion: 'learn-v2.mastery-scoring-job.v1',
      providerPayloadPolicyVersion: 'learn-v2.mastery-minimized-payload.v1',
      providerLogPolicyVersion: 'metadata-only-no-payload.v1',
      providerRetentionPolicyVersion: 'zero_data_retention_requested',
      providerDeletionPolicyVersion: 'delete_with_v2_job_on_account_deletion',
      providerTimeoutMs: 90_000,
      providerMaxRequestBytes: 48_000,
      providerMaxResponseBytes: 32_000,
      providerMaxOutputTokens: 1_200,
      providerRequestDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      providerRequestBytes: expect.any(Number),
      checkpoint: 'reserved',
    })
    expect(JSON.stringify(job)).not.toContain(request.response)
    expect(JSON.stringify(job)).not.toContain('learnerResponse')
  })

  test('returns typed adaptive gate and pending-pilot outcomes without jobs, attempts, or provider I/O', async () => {
    const { t, owner, ids, args } = await fixture()
    const activity = await t.run(async (ctx) => {
      const support = await ctx.db.query('learnClaimSupports').withIndex('by_userId_and_sessionContentClaimId').take(1)
      const claim = await ctx.db.query('sessionContentClaims').withIndex('by_userId_and_sessionContentId_and_order', q => q.eq('userId', OWNER.tokenIdentifier).eq('sessionContentId', ids.contentId)).unique()
      if (!support[0] || !claim) throw new Error('Expected evidence fixture')
      const threadId = await ctx.db.insert('learningThreads', { userId: OWNER.tokenIdentifier, originalNeed: 'Practice safely', intent: 'master', availableTime: '15', authorityKind: 'v2_mission', learningVoidId: ids.voidId, sourceScope: { kind: 'none' }, evidenceState: 'ready', lifecycle: 'active', revision: 1, createdAt: 1, updatedAt: 1 })
      const activityDocumentId = await ctx.db.insert('learningThreadActivities', {
        userId: OWNER.tokenIdentifier, threadId, activityId: 'adaptive-scored-1', boundaryOrdinal: 1, planRevision: 1, activityClass: 'factual', status: 'submitted',
        planVersion: 'learn-adaptive.activity-plan.v1', replayVersion: 'learn-adaptive.activity-replay.v1', contractVersion: 'learn-adaptive.activity-contract.v1', rendererVersion: 'learn-adaptive.renderer.v1', validationVersion: 'learn-adaptive.primitive-validation.v1', sequenceValidationVersion: 'learn-adaptive.primitive-sequence-validation.v1', fallbackVersion: 'learn-adaptive.text-card-fallback.v1',
        intent: 'master', objectiveId: ids.objectiveId, purpose: 'Demonstrate mastery.', reasonCode: 'pilot_scoring', primitivePlan: [], requiredAction: { kind: 'submit_response', label: 'Submit' }, evaluationContract: { version: 'learn-adaptive.evaluation.v1', kind: 'server_scored', responseFormat: 'short_text', passingScorePercent: 80 }, fallback: { version: 'learn-adaptive.text-card-fallback.v1', kind: 'text_card', title: 'Saved', body: 'Try later.', primaryAction: { type: 'continue_safe', label: 'Continue' }, testId: 'learn-activity-fallback' }, accessibilityMetadata: { heading: 'Practice', instructions: 'Answer.', focusTargetTestId: 'adaptive-scored', liveRegionMode: 'polite' }, learningVoidId: ids.voidId, blueprintRevisionId: ids.blueprintIdRevision, sessionContentId: ids.contentId,
        evidenceReferences: [{ claimId: claim._id, supportId: support[0]._id, sourceSnapshotId: ids.sourceId, sourceSnapshotRevision: 1, sourceRecordRevision: 1, sourceEffectiveStatus: 'user_accepted', verifierVersion: 'test.verifier.v1', integrityState: 'accepted' }], generationInputs: { sessionContentRevision: 11, sessionContentInputDigest: null, generatorVersion: null }, decisionInputs: { intentRevision: 1, routerVersion: 'v1', availableTime: '15', sourceState: 'ready', sourceInputs: [{ sourceSnapshotId: String(ids.sourceId), effectiveStatus: 'user_accepted', recordRevision: 1 }], priorActivityId: null, priorAttemptId: null, priorOutcome: null, assistance: 'none', confidence: 4 }, replacesActivityId: null, canonicalInputSnapshot: '{}', inputDigest: `sha256:${'a'.repeat(64)}`, createdAt: 1, updatedAt: 1,
      })
      await ctx.db.patch(threadId, { currentActivityId: activityDocumentId })
      return { threadId }
    })
    const { tokenIdentifier: _token, scorerVerdict: _verdict, ...attempt } = args('adaptive-pilot-pending', 80)
    const provider = vi.fn()
    vi.stubGlobal('fetch', provider)
    try {
      await expect(owner.action(api.learnAdaptive.submitResponse, { threadId: activity.threadId, activityId: 'adaptive-scored-1', ...attempt }))
        .resolves.toMatchObject({ kind: 'denied', code: 'adaptive_gate_unavailable' })
      await owner.mutation(internal.learnAdaptiveAccess.setCohortEntitlement, { enabled: true })
      process.env.LEARN_ADAPTIVE_V2_PILOT_MANIFEST = 'adaptive-v2-pilot.v1'
      await expect(owner.action(api.learnAdaptive.submitResponse, { threadId: activity.threadId, activityId: 'adaptive-scored-1', ...attempt }))
        .resolves.toMatchObject({ kind: 'blocked', code: 'pilot_manifest_not_approved' })
      expect(provider).not.toHaveBeenCalled()
      expect(await t.run(ctx => ctx.db.query('learnJobs').withIndex('by_userId_and_idempotencyKey', q => q.eq('userId', OWNER.tokenIdentifier).eq('idempotencyKey', attempt.idempotencyKey)).unique())).toBeNull()
      expect(await t.run(ctx => ctx.db.query('masteryAttempts').withIndex('by_userId_and_idempotencyKey', q => q.eq('userId', OWNER.tokenIdentifier).eq('idempotencyKey', attempt.idempotencyKey)).unique())).toBeNull()
    }
    finally {
      delete process.env.LEARN_ADAPTIVE_V2_PILOT_MANIFEST
      vi.unstubAllGlobals()
    }
  })

  test('admits only one concurrent provider dispatch and blocks ambiguous retries', async () => {
    const concurrent = await fixture()
    const { tokenIdentifier: _token, scorerVerdict: _verdict, ...publicArgs } = concurrent.args('concurrent', 80)
    let release!: (response: Response) => void
    const delayed = new Promise<Response>((resolve) => { release = resolve })
    const provider = vi.fn(() => delayed)
    vi.stubGlobal('fetch', provider)
    process.env.OPENROUTER_API_KEY = 'test-key'; process.env.CF_ACCOUNT_ID = 'test-account'; process.env.CLOUDFLARE_AI_GATEWAY_ID = 'test-gateway'
    try {
      const first = concurrent.owner.action(api.learnV2Mastery.submitMasteryAttempt, publicArgs)
      await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(1))
      await expect(concurrent.owner.action(api.learnV2Mastery.submitMasteryAttempt, publicArgs)).resolves.toEqual({ status: 'in_progress', replayed: false })
      release(new Response(JSON.stringify({ id: 'score-concurrent', model: 'test/mastery-model', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ criterionResults: verdict(80).criterionResults.map(row => ({ ...row, rationale: 'Supported.' })), misconceptionTags: [] }) } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }), { status: 200 }))
      await expect(first).resolves.toMatchObject({ status: 'completed', state: 'independent' })
      expect(provider).toHaveBeenCalledTimes(1)

      const ambiguous = await fixture()
      const { tokenIdentifier: _token2, scorerVerdict: _verdict2, ...ambiguousArgs } = ambiguous.args('ambiguous', 80)
      provider.mockImplementationOnce(async () => { throw new Error('connection ended after dispatch') })
      await expect(ambiguous.owner.action(api.learnV2Mastery.submitMasteryAttempt, ambiguousArgs)).rejects.toThrow(/connection ended/)
      await expect(ambiguous.owner.action(api.learnV2Mastery.submitMasteryAttempt, ambiguousArgs)).rejects.toThrow(/requires reconciliation/)
      expect(provider).toHaveBeenCalledTimes(2)
    }
    finally {
      delete process.env.OPENROUTER_API_KEY; delete process.env.CF_ACCOUNT_ID; delete process.env.CLOUDFLARE_AI_GATEWAY_ID
      vi.unstubAllGlobals()
    }
  })

  test('turns an expired post-dispatch lease into a reconciliation block', async () => {
    const { t, args } = await fixture()
    const { scorerVerdict: _scorerVerdict, ...request } = args('crashed-dispatch', 80)
    const reservation = await t.mutation(internal.learnV2Mastery.beginMasteryScoring, request)
    expect(reservation.kind).toBe('acquired')
    if (reservation.kind !== 'acquired') throw new Error('Expected scoring lease')
    await t.mutation(internal.learnV2Mastery.markMasteryScoringDispatched, { tokenIdentifier: OWNER.tokenIdentifier, jobId: reservation.jobId, leaseToken: reservation.leaseToken })
    await t.run(ctx => ctx.db.patch(reservation.jobId, { leaseExpiresAt: Date.now() - 1 }))
    await expect(t.mutation(internal.learnV2Mastery.beginMasteryScoring, request)).resolves.toEqual({ kind: 'pending', status: 'blocked' })
    await expect(t.run(ctx => ctx.db.get(reservation.jobId))).resolves.toMatchObject({ status: 'blocked', terminalReason: 'provider_outcome_requires_reconciliation' })
  })

  test('cron recovery requeues only expired pre-dispatch work and blocks ambiguous provider work', async () => {
    const { t, args } = await fixture()
    const { scorerVerdict: _scorerVerdict, ...preDispatchRequest } = args('recovery-pre-dispatch', 80)
    const preDispatch = await t.mutation(internal.learnV2Mastery.beginMasteryScoring, preDispatchRequest)
    if (preDispatch.kind !== 'acquired') throw new Error('Expected scoring lease')
    await t.run(ctx => ctx.db.patch(preDispatch.jobId, { leaseExpiresAt: Date.now() - 1 }))

    const { scorerVerdict: _scorerVerdict2, ...postDispatchRequest } = args('recovery-post-dispatch', 80)
    const postDispatch = await t.mutation(internal.learnV2Mastery.beginMasteryScoring, postDispatchRequest)
    if (postDispatch.kind !== 'acquired') throw new Error('Expected scoring lease')
    await t.mutation(internal.learnV2Mastery.markMasteryScoringDispatched, { tokenIdentifier: OWNER.tokenIdentifier, jobId: postDispatch.jobId, leaseToken: postDispatch.leaseToken })
    await t.run(ctx => ctx.db.patch(postDispatch.jobId, { leaseExpiresAt: Date.now() - 1 }))

    await expect(t.mutation(internal.learnV2Mastery.recoverExpiredMasteryScoringJobs, {})).resolves.toEqual({ recovered: 1, blocked: 1 })
    await expect(t.run(ctx => ctx.db.get(preDispatch.jobId))).resolves.toMatchObject({ status: 'queued', terminalReason: 'provider_not_dispatched' })
    await expect(t.run(ctx => ctx.db.get(postDispatch.jobId))).resolves.toMatchObject({ status: 'blocked', terminalReason: 'provider_outcome_requires_reconciliation' })
  })

  test('enforces a rolling provider-dispatch budget without charging an idempotent lease twice', async () => {
    const { t, args } = await fixture()
    const { scorerVerdict: _scorerVerdict, ...request } = args('rate-budget', 80)
    const reservation = await t.mutation(internal.learnV2Mastery.beginMasteryScoring, request)
    if (reservation.kind !== 'acquired') throw new Error('Expected scoring lease')
    const now = Date.now()
    await t.run(async ctx => {
      for (let index = 0; index < LEARN_V2_MASTERY_SCORING_ADMISSION.maxProviderDispatches; index += 1) {
        await ctx.db.insert('learnMasteryScoringRateEvents', { userId: OWNER.tokenIdentifier, jobId: reservation.jobId, createdAt: now - 1, expiresAt: now + LEARN_V2_MASTERY_SCORING_ADMISSION.windowMs })
      }
    })
    await expect(t.mutation(internal.learnV2Mastery.markMasteryScoringDispatched, { tokenIdentifier: OWNER.tokenIdentifier, jobId: reservation.jobId, leaseToken: reservation.leaseToken })).rejects.toThrow(/quota reached; retry after/)
    expect(await t.run(ctx => ctx.db.query('learnMasteryScoringRateEvents').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).take(20))).toHaveLength(LEARN_V2_MASTERY_SCORING_ADMISSION.maxProviderDispatches)

    await t.run(async ctx => {
      const events = await ctx.db.query('learnMasteryScoringRateEvents').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).take(20)
      for (const event of events) await ctx.db.patch(event._id, { createdAt: now - LEARN_V2_MASTERY_SCORING_ADMISSION.windowMs })
    })
    await expect(t.mutation(internal.learnV2Mastery.markMasteryScoringDispatched, { tokenIdentifier: OWNER.tokenIdentifier, jobId: reservation.jobId, leaseToken: reservation.leaseToken })).resolves.toBeNull()
    expect(await t.run(ctx => ctx.db.query('learnMasteryScoringRateEvents').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).take(20))).toHaveLength(LEARN_V2_MASTERY_SCORING_ADMISSION.maxProviderDispatches + 1)
  })

  test('enforces the finite two-dispatch-attempt job cap before provider admission', async () => {
    const { t, args } = await fixture()
    const { scorerVerdict: _verdict, ...request } = args('dispatch-attempt-cap', 80)
    const reservation = await t.mutation(internal.learnV2Mastery.beginMasteryScoring, request)
    if (reservation.kind !== 'acquired') throw new Error('Expected scoring lease')
    await t.run(ctx => ctx.db.patch(reservation.jobId, { attempts: 2 }))
    await expect(t.mutation(internal.learnV2Mastery.markMasteryScoringDispatched, { tokenIdentifier: OWNER.tokenIdentifier, jobId: reservation.jobId, leaseToken: reservation.leaseToken }))
      .rejects.toThrow(/dispatch attempt cap reached/)
    expect(await t.run(ctx => ctx.db.query('learnMasteryScoringRateEvents').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).take(1))).toEqual([])
  })

  test('releases a quota-denied pre-dispatch job for retry once the window expires', async () => {
    const { t, owner, args } = await fixture()
    const { scorerVerdict: _scorerVerdict, ...seedRequest } = args('quota-seed', 80)
    const seed = await t.mutation(internal.learnV2Mastery.beginMasteryScoring, seedRequest)
    if (seed.kind !== 'acquired') throw new Error('Expected scoring lease')
    const now = Date.now()
    await t.run(async ctx => {
      for (let index = 0; index < LEARN_V2_MASTERY_SCORING_ADMISSION.maxProviderDispatches; index += 1) {
        await ctx.db.insert('learnMasteryScoringRateEvents', { userId: OWNER.tokenIdentifier, jobId: seed.jobId, createdAt: now - 1, expiresAt: now + LEARN_V2_MASTERY_SCORING_ADMISSION.windowMs })
      }
    })
    const { tokenIdentifier: _tokenIdentifier, scorerVerdict: _verdict, ...publicArgs } = args('quota-retry', 80)
    await expect(owner.action(api.learnV2Mastery.submitMasteryAttempt, publicArgs)).rejects.toThrow(/quota reached; retry after/)
    const denied = await t.run(ctx => ctx.db.query('learnJobs').withIndex('by_userId_and_idempotencyKey', q => q.eq('userId', OWNER.tokenIdentifier).eq('idempotencyKey', 'quota-retry')).unique())
    expect(denied).toMatchObject({ status: 'queued', terminalReason: 'provider_not_dispatched' })

    await t.run(async ctx => {
      const events = await ctx.db.query('learnMasteryScoringRateEvents').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).take(20)
      for (const event of events) await ctx.db.patch(event._id, { createdAt: now - LEARN_V2_MASTERY_SCORING_ADMISSION.windowMs })
    })
    const provider = vi.fn(async () => new Response(JSON.stringify({ id: 'quota-retry', model: 'test/mastery-model', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ criterionResults: verdict(80).criterionResults.map(row => ({ ...row, rationale: 'Supported.' })), misconceptionTags: [] }) } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }), { status: 200 }))
    vi.stubGlobal('fetch', provider)
    process.env.OPENROUTER_API_KEY = 'test-key'; process.env.CF_ACCOUNT_ID = 'test-account'; process.env.CLOUDFLARE_AI_GATEWAY_ID = 'test-gateway'
    try {
      await expect(owner.action(api.learnV2Mastery.submitMasteryAttempt, publicArgs)).resolves.toMatchObject({ status: 'completed', replayed: false })
      expect(provider).toHaveBeenCalledTimes(1)
    }
    finally {
      delete process.env.OPENROUTER_API_KEY; delete process.env.CF_ACCOUNT_ID; delete process.env.CLOUDFLARE_AI_GATEWAY_ID
      vi.unstubAllGlobals()
    }
  })

  test('enforces exact started content/session/active-plan pins and rejects purged evidence', async () => {
    const stale = await fixture()
    await stale.t.run(ctx => ctx.db.patch(stale.ids.planId, { activeRevisionId: undefined }))
    await expect(stale.t.mutation(internal.learnV2Mastery.recordMasteryAttempt, stale.args('stale-plan'))).rejects.toThrow(/pin is no longer current/)
    const wrongContentRevision = await fixture()
    await expect(wrongContentRevision.t.mutation(internal.learnV2Mastery.recordMasteryAttempt, { ...wrongContentRevision.args('stale-content'), expectedContentRevision: 10 })).rejects.toThrow(/revision conflict/)
    const purged = await fixture()
    await purged.t.run(ctx => ctx.db.patch(purged.ids.sourceId, { evidencePurgedAt: Date.now() }))
    await expect(purged.owner.query(api.learnV2Today.getToday, {})).resolves.toMatchObject({ status: 'blocked', reason: 'content_evidence_unavailable' })
    await expect(purged.t.mutation(internal.learnV2Mastery.recordMasteryAttempt, purged.args('purged-evidence'))).rejects.toThrow(/evidence is unavailable/)
  })

  test('allows same-day early starts, keeps future-day sessions scheduled, and requires the exact started-content id', async () => {
    const future = await fixture()
    const scheduledStartAt = Date.now() + 60_000
    await future.t.run(ctx => ctx.db.patch(future.ids.sessionId, { status: 'ready', scheduledStartAt, timezone: 'America/Toronto' }))
    await expect(future.owner.query(api.learnV2Today.getToday, {})).resolves.toMatchObject({ status: 'ready', nextScheduledAt: scheduledStartAt })
    await expect(future.owner.mutation(api.learnV2SessionContent.startStudySession, { studySessionId: future.ids.sessionId, expectedSessionRevision: 7, expectedContentRevision: 11, idempotencyKey: 'future-start' })).resolves.toMatchObject({ status: 'in_progress' })

    const futureDay = await fixture()
    const futureDayStart = Date.now() + 48 * 60 * 60_000
    await futureDay.t.run(ctx => ctx.db.patch(futureDay.ids.sessionId, { status: 'ready', scheduledStartAt: futureDayStart, timezone: 'America/Toronto' }))
    await expect(futureDay.owner.query(api.learnV2Today.getToday, {})).resolves.toMatchObject({ status: 'empty', nextScheduledAt: futureDayStart })
    await expect(futureDay.owner.mutation(api.learnV2SessionContent.startStudySession, { studySessionId: futureDay.ids.sessionId, expectedSessionRevision: 7, expectedContentRevision: 11, idempotencyKey: 'future-day-start' })).rejects.toThrow(/not scheduled for today/)

    const mismatched = await fixture()
    await mismatched.t.run(ctx => ctx.db.patch(mismatched.ids.sessionId, { startedSessionContentId: undefined }))
    await expect(mismatched.owner.query(api.learnV2Today.getToday, {})).resolves.toMatchObject({ status: 'blocked', reason: 'started_content_unavailable' })
  })

  test('does not project or start a ready session after its scheduled window', async () => {
    const expired = await fixture()
    const now = Date.now()
    await expired.t.run(ctx => ctx.db.patch(expired.ids.sessionId, { status: 'ready', scheduledStartAt: now - 120_000, scheduledEndAt: now - 60_000 }))
    await expect(expired.owner.query(api.learnV2Today.getToday, {})).resolves.toMatchObject({ status: 'empty' })
    await expect(expired.owner.mutation(api.learnV2SessionContent.startStudySession, { studySessionId: expired.ids.sessionId, expectedSessionRevision: 7, expectedContentRevision: 11, idempotencyKey: 'expired-start' })).rejects.toThrow(/window has expired/)
  })

  test('ignores bounded inactive history when selecting an active Today session', async () => {
    const { t, owner, ids } = await fixture()
    await t.run(async (ctx) => {
      for (let index = 0; index < 129; index += 1) {
        await ctx.db.insert('studySessions', {
          userId: OWNER.tokenIdentifier,
          studyPlanRevisionId: ids.planRevisionId,
          primaryObjectiveId: ids.objectiveId,
          status: index % 2 === 0 ? 'completed' : 'cancelled',
          revision: 1,
          scheduledStartAt: Date.now() - 1_000_000 - index,
        })
      }
    })

    await expect(owner.query(api.learnV2Today.getToday, {})).resolves.toMatchObject({
      status: 'ready',
      sessionId: ids.sessionId,
    })
  })

  test('uses 79/80 boundary, persists remediation, and appends exactly one replay-safe attempt', async () => {
    const { t, owner, ids, args } = await fixture()
    await expect(owner.query(api.learnV2Today.getToday, {})).resolves.toMatchObject({ status: 'ready', sessionId: ids.sessionId, sessionRevision: 7, timezone: 'America/Toronto', content: { revision: 11 }, plan: { recordRevision: 5, blueprintRecordRevision: 3 } })
    const first = await t.mutation(internal.learnV2Mastery.recordMasteryAttempt, args('same-key', 79))
    expect(first).toMatchObject({ scorePercent: 79, state: 'needs_review', replayed: false })
    expect(await t.mutation(internal.learnV2Mastery.recordMasteryAttempt, args('same-key', 79))).toMatchObject({ attemptId: first.attemptId, replayed: true })
    expect(await t.mutation(internal.learnV2Mastery.recordMasteryAttempt, args('same-key', 80))).toMatchObject({ attemptId: first.attemptId, scorePercent: 79, replayed: true })
    await expect(t.mutation(internal.learnV2Mastery.recordMasteryAttempt, { ...args('same-key', 80), response: 'changed' })).rejects.toThrow(/different request/)
    const scopeKey = await masteryScopeKey(OWNER.tokenIdentifier, ids.blueprintIdRevision, ids.objectiveId)
    const rows = await t.run(async ctx => ({ attempts: await ctx.db.query('masteryAttempts').withIndex('by_userId_blueprintRevisionId_objectiveId_attemptedAt', q => q.eq('userId', OWNER.tokenIdentifier).eq('blueprintRevisionId', ids.blueprintIdRevision).eq('objectiveId', ids.objectiveId)).take(3), record: await ctx.db.query('masteryRecords').withIndex('by_userId_and_scopeKey', q => q.eq('userId', OWNER.tokenIdentifier).eq('scopeKey', scopeKey)).unique(), sessions: await ctx.db.query('studySessions').withIndex('by_userId_and_studyPlanRevisionId_and_scheduledStartAt', q => q.eq('userId', OWNER.tokenIdentifier).eq('studyPlanRevisionId', ids.planRevisionId)).take(4), jobs: await ctx.db.query('learnJobs').withIndex('by_userId_and_idempotencyKey', q => q.eq('userId', OWNER.tokenIdentifier).eq('idempotencyKey', `mastery-followup:${first.attemptId}`)).unique(), calendar: await ctx.db.query('calendarProjections').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).take(2) }))
    expect(rows.attempts).toHaveLength(1)
    expect(rows.attempts[0]).toMatchObject({ studySessionId: ids.sessionId, sessionContentId: expect.any(String), studyPlanRevisionId: expect.any(String), blueprintRevisionId: expect.any(String), sessionRevision: 7, contentRevision: 11, planRecordRevision: 5, blueprintRecordRevision: 3, sourceSnapshotIdsJson: expect.stringContaining('learnSourceSnapshots') })
    expect(rows.record).toMatchObject({ state: 'needs_review', schedulingPriority: 'remediation', remediationAttemptId: first.attemptId, nextReviewAt: expect.any(Number) })
    expect(rows.sessions.filter(row => row._id !== ids.sessionId)).toMatchObject([{ placementKind: 'review', schedulingPriority: 'prerequisite_remediation' }])
    expect(rows.jobs).toMatchObject({ type: 'session_content_generation', dispatchSupportingSourceSnapshotIds: [ids.sourceId] })
    expect(rows.calendar).toEqual([])
    await expect(owner.query(api.learnV2Today.getToday, {})).resolves.toMatchObject({ sessionId: rows.sessions.find(row => row._id !== ids.sessionId)!._id })
    const boundary = await fixture()
    await expect(boundary.t.mutation(internal.learnV2Mastery.recordMasteryAttempt, boundary.args('boundary', 80))).resolves.toMatchObject({ scorePercent: 80, state: 'independent' })
  })

  test('caps assisted passes without downgrading established independence', async () => {
    const { t, owner, ids, args } = await fixture({ state: 'independent', firstDate: '2026-03-01' })
    await owner.mutation(api.learnV2Mastery.recordAssistanceUse, { studySessionId: ids.sessionId, expectedSessionRevision: 7, kind: 'substantive_hint' })
    const result = await t.mutation(internal.learnV2Mastery.recordMasteryAttempt, { ...args('assisted'), expectedSessionRevision: 8 })
    expect(result).toMatchObject({ scorePercent: 100, state: 'independent' })
    expect(await t.run(ctx => ctx.db.get(ids.sessionId))).toMatchObject({ substantiveHintUsedAt: expect.any(Number), status: 'completed' })
  })

  test('caps an answer-revealed pass at guided', async () => {
    const { t, owner, ids, args } = await fixture()
    await owner.mutation(api.learnV2Mastery.recordAssistanceUse, { studySessionId: ids.sessionId, expectedSessionRevision: 7, kind: 'answer_reveal' })
    const result = await t.mutation(internal.learnV2Mastery.recordMasteryAttempt, { ...args('revealed'), expectedSessionRevision: 8, scorerVerdict: { ...verdict(100), misconceptionTags: ['explain-boundary'], criterionResults: verdict(100).criterionResults.map(row => ({ ...row, rationale: 'Specific bounded feedback.' })) } })
    expect(result).toMatchObject({ scorePercent: 100, state: 'guided', nextReviewAt: expect.any(Number), feedback: { misconceptionTags: ['explain-boundary'], criterionResults: expect.arrayContaining([expect.objectContaining({ rationale: 'Specific bounded feedback.' })]) } })
    expect(await t.mutation(internal.learnV2Mastery.recordMasteryAttempt, { ...args('revealed'), expectedSessionRevision: 8, scorerVerdict: { ...verdict(100), misconceptionTags: ['explain-boundary'], criterionResults: verdict(100).criterionResults.map(row => ({ ...row, rationale: 'Specific bounded feedback.' })) } })).toMatchObject({ replayed: true, feedback: { misconceptionTags: ['explain-boundary'] } })
    const sessions = await t.run(ctx => ctx.db.query('studySessions').withIndex('by_userId_and_studyPlanRevisionId_and_scheduledStartAt', q => q.eq('userId', OWNER.tokenIdentifier).eq('studyPlanRevisionId', ids.planRevisionId)).take(3))
    expect(sessions.filter(row => row._id !== ids.sessionId)).toHaveLength(1)
  })

  test('rejects day 6 and accepts retained day 7 across the DST boundary', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-08T16:00:00.000Z')) // Toronto's first DST Sunday.
    try {
      const day6 = await fixture({ placementKind: 'retained_review', state: 'independent', firstDate: '2026-03-02' })
      await expect(day6.t.mutation(internal.learnV2Mastery.recordMasteryAttempt, day6.args('day-six'))).rejects.toThrow(/seven calendar days/)
      const day7 = await fixture({ placementKind: 'retained_review', state: 'independent', firstDate: '2026-03-01', sessionTimezone: 'Pacific/Auckland' })
      await expect(day7.t.mutation(internal.learnV2Mastery.recordMasteryAttempt, day7.args('day-seven'))).resolves.toMatchObject({ state: 'retained' })
      const attempt = await day7.t.run(ctx => ctx.db.query('masteryAttempts').withIndex('by_userId_and_objectiveId_and_attemptedAt', q => q.eq('userId', OWNER.tokenIdentifier).eq('objectiveId', day7.ids.objectiveId)).unique())
      expect(attempt).toMatchObject({ attemptLocalDate: '2026-03-08', attemptTimezone: 'America/Toronto' })
    }
    finally { vi.useRealTimers() }
  })
})
