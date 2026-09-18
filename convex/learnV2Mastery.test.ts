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

async function fixture(options: { placementKind?: 'learning' | 'retained_review', state?: 'guided' | 'independent', firstDate?: string } = {}) {
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
    const planRevisionId = await ctx.db.insert('studyPlanRevisions', { userId: OWNER.tokenIdentifier, studyPlanId: planId, learningVoidId: voidId, revision: 1, recordRevision: 5, status: 'accepted', blueprintRevisionId: blueprintIdRevision, timezone: 'America/Toronto', createdAt: now })
    await ctx.db.patch(planId, { activeRevisionId: planRevisionId })
    const sessionId = await ctx.db.insert('studySessions', { userId: OWNER.tokenIdentifier, studyPlanRevisionId: planRevisionId, primaryObjectiveId: objectiveId, status: 'in_progress', revision: 7, scheduledStartAt: now, timezone: 'America/Toronto', placementKind: options.placementKind ?? 'learning' })
    const contentId = await ctx.db.insert('sessionContent', { userId: OWNER.tokenIdentifier, studySessionId: sessionId, studyPlanRevisionId: planRevisionId, blueprintRevisionId: blueprintIdRevision, objectiveId, revision: 11, status: 'published', assessmentRubricSnapshot: rubric, createdAt: now, publishedAt: now })
    await ctx.db.patch(sessionId, { startedSessionContentId: contentId, startedSessionContentRevision: 11 })
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
    const hint = await owner.mutation(api.learnV2Mastery.recordAssistanceUse, { studySessionId: ids.sessionId, expectedSessionRevision: 7, kind: 'substantive_hint' })
    expect(hint).toMatchObject({ revision: 8, replayed: false })
    expect(await owner.mutation(api.learnV2Mastery.recordAssistanceUse, { studySessionId: ids.sessionId, expectedSessionRevision: 8, kind: 'substantive_hint' })).toMatchObject({ revision: 8, replayed: true })
    await t.withIdentity(OTHER).mutation(api.users.upsertUser, {})
    await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: OTHER.tokenIdentifier, enabled: true })
    await expect(t.withIdentity(OTHER).mutation(api.learnV2Mastery.recordAssistanceUse, { studySessionId: ids.sessionId, expectedSessionRevision: 8, kind: 'answer_reveal' })).rejects.toThrow(/Study session not found/)
    expect(await owner.mutation(api.learnV2Mastery.recordAssistanceUse, { studySessionId: ids.sessionId, expectedSessionRevision: 8, kind: 'answer_reveal' })).toMatchObject({ revision: 9, replayed: false })
  })

  test('enforces exact started content/session/active-plan pins and rejects purged evidence', async () => {
    const stale = await fixture()
    await stale.t.run(ctx => ctx.db.patch(stale.ids.planId, { activeRevisionId: undefined }))
    await expect(stale.t.mutation(internal.learnV2Mastery.recordMasteryAttempt, stale.args('stale-plan'))).rejects.toThrow(/pin is no longer current/)
    const wrongContentRevision = await fixture()
    await expect(wrongContentRevision.t.mutation(internal.learnV2Mastery.recordMasteryAttempt, { ...wrongContentRevision.args('stale-content'), expectedContentRevision: 10 })).rejects.toThrow(/revision conflict/)
    const purged = await fixture()
    await purged.t.run(ctx => ctx.db.patch(purged.ids.sourceId, { evidencePurgedAt: Date.now() }))
    await expect(purged.t.mutation(internal.learnV2Mastery.recordMasteryAttempt, purged.args('purged-evidence'))).rejects.toThrow(/evidence is unavailable/)
  })

  test('uses 79/80 boundary, persists remediation, and appends exactly one replay-safe attempt', async () => {
    const { t, ids, args } = await fixture()
    const first = await t.mutation(internal.learnV2Mastery.recordMasteryAttempt, args('same-key', 79))
    expect(first).toMatchObject({ scorePercent: 79, state: 'needs_review', replayed: false })
    expect(await t.mutation(internal.learnV2Mastery.recordMasteryAttempt, args('same-key', 79))).toMatchObject({ attemptId: first.attemptId, replayed: true })
    await expect(t.mutation(internal.learnV2Mastery.recordMasteryAttempt, { ...args('same-key', 80), response: 'changed' })).rejects.toThrow(/different request/)
    const rows = await t.run(async ctx => ({ attempts: await ctx.db.query('masteryAttempts').withIndex('by_userId_and_objectiveId_and_attemptedAt', q => q.eq('userId', OWNER.tokenIdentifier).eq('objectiveId', ids.objectiveId)).take(3), record: await ctx.db.query('masteryRecords').withIndex('by_userId_and_objectiveId', q => q.eq('userId', OWNER.tokenIdentifier).eq('objectiveId', ids.objectiveId)).unique() }))
    expect(rows.attempts).toHaveLength(1)
    expect(rows.attempts[0]).toMatchObject({ studySessionId: ids.sessionId, sessionContentId: expect.any(String), studyPlanRevisionId: expect.any(String), blueprintRevisionId: expect.any(String), sessionRevision: 7, contentRevision: 11, planRecordRevision: 5, blueprintRecordRevision: 3, sourceSnapshotIdsJson: expect.stringContaining('learnSourceSnapshots') })
    expect(rows.record).toMatchObject({ state: 'needs_review', schedulingPriority: 'remediation', remediationAttemptId: first.attemptId, nextReviewAt: expect.any(Number) })
  })

  test('caps assisted passes without downgrading established independence', async () => {
    const { t, owner, ids, args } = await fixture({ state: 'independent', firstDate: '2026-03-01' })
    await owner.mutation(api.learnV2Mastery.recordAssistanceUse, { studySessionId: ids.sessionId, expectedSessionRevision: 7, kind: 'substantive_hint' })
    const result = await t.mutation(internal.learnV2Mastery.recordMasteryAttempt, { ...args('assisted'), expectedSessionRevision: 8 })
    expect(result).toMatchObject({ scorePercent: 100, state: 'independent' })
    expect(await t.run(ctx => ctx.db.get(ids.sessionId))).toMatchObject({ substantiveHintUsedAt: expect.any(Number), status: 'completed' })
  })

  test('rejects day 6 and accepts retained day 7 across the DST boundary', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-08T16:00:00.000Z')) // Toronto's first DST Sunday.
    try {
      const day6 = await fixture({ placementKind: 'retained_review', state: 'independent', firstDate: '2026-03-02' })
      await expect(day6.t.mutation(internal.learnV2Mastery.recordMasteryAttempt, day6.args('day-six'))).rejects.toThrow(/seven calendar days/)
      const day7 = await fixture({ placementKind: 'retained_review', state: 'independent', firstDate: '2026-03-01' })
      await expect(day7.t.mutation(internal.learnV2Mastery.recordMasteryAttempt, day7.args('day-seven'))).resolves.toMatchObject({ state: 'retained' })
    }
    finally { vi.useRealTimers() }
  })
})
