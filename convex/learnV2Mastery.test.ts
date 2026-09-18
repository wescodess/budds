/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
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
    if (options.state) await ctx.db.insert('masteryRecords', { userId: OWNER.tokenIdentifier, blueprintRevisionId: blueprintIdRevision, objectiveId, state: options.state, recordRevision: 4, firstIndependentLocalDate: options.firstDate, firstIndependentPassAt: options.firstDate ? now : undefined, firstIndependentTimezone: options.firstDate ? 'America/Toronto' : undefined, updatedAt: now })
    return { voidId, blueprintIdRevision, objectiveId, planId, planRevisionId, sessionId, contentId, sourceId }
  })
  const args = (key: string, score = 100) => ({ tokenIdentifier: OWNER.tokenIdentifier, studySessionId: ids.sessionId, expectedSessionRevision: 7, expectedContentRevision: 11, expectedPlanRecordRevision: 5, expectedBlueprintRecordRevision: 3, response: 'A server-scored response.', confidence: 4, idempotencyKey: key, scorerVerdict: verdict(score) })
  return { t, owner, ids, args }
}

describe('LA2-12 server-scored mastery attempts', () => {
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
    const provider = vi.fn(async () => new Response(JSON.stringify({ id: 'score-1', model: 'test/mastery-model', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ criterionResults: verdict(80).criterionResults.map(row => ({ ...row, rationale: 'Pinned evidence supports this decision.' })), misconceptionTags: [] }) } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', provider)
    process.env.OPENROUTER_API_KEY = 'test-key'
    process.env.CF_ACCOUNT_ID = 'test-account'
    process.env.CLOUDFLARE_AI_GATEWAY_ID = 'test-gateway'
    try {
      await expect(owner.action(api.learnV2Mastery.submitMasteryAttempt, publicArgs)).resolves.toMatchObject({ scorePercent: 80, state: 'independent', replayed: false })
      await expect(owner.action(api.learnV2Mastery.submitMasteryAttempt, publicArgs)).resolves.toMatchObject({ scorePercent: 80, state: 'independent', replayed: true })
      expect(provider).toHaveBeenCalledTimes(1)
    }
    finally {
      delete process.env.OPENROUTER_API_KEY
      delete process.env.CF_ACCOUNT_ID
      delete process.env.CLOUDFLARE_AI_GATEWAY_ID
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

  test('uses 79/80 boundary, persists remediation, and appends exactly one replay-safe attempt', async () => {
    const { t, owner, ids, args } = await fixture()
    await expect(owner.query(api.learnV2Today.getToday, {})).resolves.toMatchObject({ status: 'ready', sessionId: ids.sessionId, sessionRevision: 7, timezone: 'America/Toronto', content: { revision: 11 }, plan: { recordRevision: 5, blueprintRecordRevision: 3 } })
    const first = await t.mutation(internal.learnV2Mastery.recordMasteryAttempt, args('same-key', 79))
    expect(first).toMatchObject({ scorePercent: 79, state: 'needs_review', replayed: false })
    expect(await t.mutation(internal.learnV2Mastery.recordMasteryAttempt, args('same-key', 79))).toMatchObject({ attemptId: first.attemptId, replayed: true })
    expect(await t.mutation(internal.learnV2Mastery.recordMasteryAttempt, args('same-key', 80))).toMatchObject({ attemptId: first.attemptId, scorePercent: 79, replayed: true })
    await expect(t.mutation(internal.learnV2Mastery.recordMasteryAttempt, { ...args('same-key', 80), response: 'changed' })).rejects.toThrow(/different request/)
    const rows = await t.run(async ctx => ({ attempts: await ctx.db.query('masteryAttempts').withIndex('by_userId_and_objectiveId_and_attemptedAt', q => q.eq('userId', OWNER.tokenIdentifier).eq('objectiveId', ids.objectiveId)).take(3), record: await ctx.db.query('masteryRecords').withIndex('by_userId_and_objectiveId', q => q.eq('userId', OWNER.tokenIdentifier).eq('objectiveId', ids.objectiveId)).unique(), sessions: await ctx.db.query('studySessions').withIndex('by_userId_and_studyPlanRevisionId_and_scheduledStartAt', q => q.eq('userId', OWNER.tokenIdentifier).eq('studyPlanRevisionId', ids.planRevisionId)).take(4), jobs: await ctx.db.query('learnJobs').withIndex('by_userId_and_idempotencyKey', q => q.eq('userId', OWNER.tokenIdentifier).eq('idempotencyKey', `mastery-followup:${first.attemptId}`)).unique(), calendar: await ctx.db.query('calendarProjections').withIndex('by_userId', q => q.eq('userId', OWNER.tokenIdentifier)).take(2) }))
    expect(rows.attempts).toHaveLength(1)
    expect(rows.attempts[0]).toMatchObject({ studySessionId: ids.sessionId, sessionContentId: expect.any(String), studyPlanRevisionId: expect.any(String), blueprintRevisionId: expect.any(String), sessionRevision: 7, contentRevision: 11, planRecordRevision: 5, blueprintRecordRevision: 3, sourceSnapshotIdsJson: expect.stringContaining('learnSourceSnapshots') })
    expect(rows.record).toMatchObject({ state: 'needs_review', schedulingPriority: 'remediation', remediationAttemptId: first.attemptId, nextReviewAt: expect.any(Number) })
    expect(rows.sessions.filter(row => row._id !== ids.sessionId)).toMatchObject([{ placementKind: 'review', schedulingPriority: 'prerequisite_remediation', status: 'planned' }])
    expect(rows.jobs).toMatchObject({ type: 'session_content_generation', status: 'queued', dispatchSupportingSourceSnapshotIds: [ids.sourceId] })
    expect(rows.calendar).toEqual([])
    await expect(owner.query(api.learnV2Today.getToday, {})).resolves.toMatchObject({ status: 'pending', sessionId: rows.sessions.find(row => row._id !== ids.sessionId)!._id })
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
