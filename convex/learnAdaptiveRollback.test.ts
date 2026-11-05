/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterAll, beforeEach, expect, test } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'
import type { FunctionArgs } from 'convex/server'
import type { Id } from './_generated/dataModel'

const modules = import.meta.glob('./**/*.ts')
const OWNER = { tokenIdentifier: 'https://auth.example.com|rollback-owner' }
const OTHER = { tokenIdentifier: 'https://auth.example.com|rollback-other' }
const originalFlag = process.env.LEARN_V2_ENABLED
const v2Route = { name: 'app-learn', href: '/app/learn?legacy=v2', label: 'Open V2 learning plans' }
const classicRoute = { name: 'index', href: '/', label: 'Open your folders for classic courses' }
const deniedCapabilities = { entry: false, read: false, write: false, jobAdmission: false }

beforeEach(() => { process.env.LEARN_V2_ENABLED = 'true' })
afterAll(() => { if (originalFlag === undefined) delete process.env.LEARN_V2_ENABLED; else process.env.LEARN_V2_ENABLED = originalFlag })

async function fixture() {
  const t = convexTest(schema, modules)
  for (const identity of [OWNER, OTHER]) {
    const actor = t.withIdentity(identity)
    await actor.mutation(api.users.upsertUser, {})
    await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: identity.tokenIdentifier, enabled: true })
    await actor.mutation(internal.learnAdaptiveAccess.setCohortEntitlement, { enabled: true })
  }
  return { t, owner: t.withIdentity(OWNER), other: t.withIdentity(OTHER) }
}

test('public status returns the available named route for every closed gate', async () => {
  const { t, owner } = await fixture()
  expect(await owner.query(api.learnAdaptiveAccess.adaptiveStatus, {})).toEqual({
    kind: 'allowed', capabilities: { entry: true, read: true, write: true, jobAdmission: true },
  })
  expect(await t.query(api.learnAdaptiveAccess.adaptiveStatus, {})).toEqual({ kind: 'denied', capabilities: deniedCapabilities, fallbackRoute: classicRoute })
  await owner.mutation(internal.learnAdaptiveAccess.setCohortEntitlement, { enabled: false })
  expect(await owner.query(api.learnAdaptiveAccess.adaptiveStatus, {})).toEqual({ kind: 'denied', capabilities: deniedCapabilities, fallbackRoute: v2Route })
  await owner.mutation(internal.learnAdaptiveAccess.setCohortEntitlement, { enabled: true })
  await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: OWNER.tokenIdentifier, enabled: false })
  expect(await owner.query(api.learnAdaptiveAccess.adaptiveStatus, {})).toEqual({ kind: 'denied', capabilities: deniedCapabilities, fallbackRoute: classicRoute })
  await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: OWNER.tokenIdentifier, enabled: true })
  process.env.LEARN_V2_ENABLED = 'false'
  expect(await owner.query(api.learnAdaptiveAccess.adaptiveStatus, {})).toEqual({ kind: 'denied', capabilities: deniedCapabilities, fallbackRoute: classicRoute })
  expect(await t.query(api.learnAdaptiveAccess.adaptiveStatus, {})).toEqual({ kind: 'denied', capabilities: deniedCapabilities, fallbackRoute: classicRoute })
})

test('public commands return a structured denial with the available fallback route', async () => {
  const { t, owner } = await fixture()
  const args = { need: 'Keep my next learning move', intent: 'refresh' as const, availableTime: '15' as const,
    sourceScope: { kind: 'none' as const }, idempotencyKey: 'rollback-denied-draft-01' }
  await owner.mutation(internal.learnAdaptiveAccess.setCohortEntitlement, { enabled: false })
  await expect(owner.mutation(api.learnAdaptiveDrafts.createThreadDraft, args)).rejects.toMatchObject({
    data: { code: 'adaptive_access_denied', message: 'Adaptive Learn access denied', fallbackRoute: v2Route },
  })
  process.env.LEARN_V2_ENABLED = 'false'
  await expect(owner.mutation(api.learnAdaptiveDrafts.createThreadDraft, args)).rejects.toMatchObject({
    data: { code: 'adaptive_access_denied', message: 'Adaptive Learn access denied', fallbackRoute: classicRoute },
  })
  await expect(t.mutation(api.learnAdaptiveDrafts.createThreadDraft, args)).rejects.toMatchObject({
    data: { code: 'adaptive_access_denied', message: 'Adaptive Learn access denied', fallbackRoute: classicRoute },
  })
})

const preservedCollections = [
  'learningThreads', 'learningThreadActivities', 'learningThreadArtifacts', 'learnActivityDecisions',
  'learnActivityCommandReceipts', 'learnActivityEvents', 'learnActivityEvidenceLinks',
  'learningVoids', 'learnBlueprints', 'learnBlueprintRevisions', 'learnObjectives',
  'learnSourceIdentities', 'learnSourceSnapshots', 'learnSourceExcerpts',
  'masteryAttempts', 'masteryRecords', 'studyPlans', 'studyPlanRevisions', 'learnJobs',
] as const satisfies ReadonlyArray<FunctionArgs<typeof api.dataExport.getUserDataPage>['collection']>

test.each(['adaptive', 'v2', 'product', 'anonymous'] as const)('%s denial returns the public action fallback before scoring admission', async (gate) => {
  const { t, owner } = await fixture()
  const ids = await t.run(async (ctx) => {
    const userId = OWNER.tokenIdentifier
    const folderId = await ctx.db.insert('folders', { userId, name: 'Scoring sources', documentCount: 0 })
    const learningVoidId = await ctx.db.insert('learningVoids', { userId, folderId, title: 'Scoring', status: 'active', revision: 1, createdAt: 1, updatedAt: 1 })
    const blueprintId = await ctx.db.insert('learnBlueprints', { userId, learningVoidId, revision: 1, createdAt: 1 })
    const blueprintRevisionId = await ctx.db.insert('learnBlueprintRevisions', { userId, blueprintId, learningVoidId, revision: 1, recordRevision: 1, status: 'accepted', createdAt: 1, updatedAt: 1 })
    const primaryObjectiveId = await ctx.db.insert('learnObjectives', { userId, blueprintRevisionId, order: 0, title: 'Original objective' })
    const studyPlanId = await ctx.db.insert('studyPlans', { userId, learningVoidId, revision: 1, createdAt: 1 })
    const studyPlanRevisionId = await ctx.db.insert('studyPlanRevisions', { userId, learningVoidId, studyPlanId, revision: 1, status: 'accepted', createdAt: 1 })
    const studySessionId = await ctx.db.insert('studySessions', { userId, studyPlanRevisionId, primaryObjectiveId, status: 'ready', revision: 1, scheduledStartAt: 1 })
    const threadId = await ctx.db.insert('learningThreads', { userId, originalNeed: 'Existing scoring thread', intent: 'understand', availableTime: '15', authorityKind: 'v2_mission', learningVoidId, sourceScope: { kind: 'none' }, evidenceState: 'ready', lifecycle: 'active', revision: 1, createdAt: 1, updatedAt: 1 })
    return { threadId, studySessionId }
  })
  const args = { ...ids, activityId: 'original-scoring-activity', expectedSessionRevision: 1, expectedContentRevision: 1,
    expectedPlanRecordRevision: 1, expectedBlueprintRecordRevision: 1, response: 'Preserve my answer', confidence: 4, idempotencyKey: 'rollback-scoring-original' }
  const exportedJobs = () => owner.query(api.dataExport.getUserDataPage, { collection: 'learnJobs', paginationOpts: { cursor: null, numItems: 8 } })
  const exportedAttempts = () => owner.query(api.dataExport.getUserDataPage, { collection: 'masteryAttempts', paginationOpts: { cursor: null, numItems: 8 } })
  const beforeJobs = await exportedJobs()
  const beforeAttempts = await exportedAttempts()
  if (gate === 'adaptive') await owner.mutation(internal.learnAdaptiveAccess.setCohortEntitlement, { enabled: false })
  if (gate === 'v2') await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: OWNER.tokenIdentifier, enabled: false })
  if (gate === 'product') process.env.LEARN_V2_ENABLED = 'false'
  const actor = gate === 'anonymous' ? t : owner
  for (let retry = 0; retry < 3; retry++) {
    expect(await actor.action(api.learnAdaptive.submitResponse, args)).toEqual({
      kind: 'denied', code: 'adaptive_gate_unavailable', message: 'Adaptive Learn is unavailable.', retryable: false,
      fallbackRoute: gate === 'adaptive' ? v2Route : classicRoute,
    })
  }
  expect(await exportedJobs()).toEqual(beforeJobs)
  expect(await exportedAttempts()).toEqual(beforeAttempts)
})

test.each(['adaptive', 'v2', 'product'] as const)('%s rollback preserves saved work and original receipts through public exports', async (gate) => {
  const { t, owner, other } = await fixture()
  // Arrange pre-existing V2 history independently from the adaptive commands.
  await t.run(async (ctx) => {
    const userId = OWNER.tokenIdentifier
    const folderId = await ctx.db.insert('folders', { userId, name: 'Existing evidence', documentCount: 0 })
    const learningVoidId = await ctx.db.insert('learningVoids', { userId, folderId, title: 'Prior learning', status: 'active', revision: 1, createdAt: 1, updatedAt: 1 })
    const blueprintId = await ctx.db.insert('learnBlueprints', { userId, learningVoidId, revision: 1, createdAt: 1 })
    const blueprintRevisionId = await ctx.db.insert('learnBlueprintRevisions', { userId, blueprintId, learningVoidId, revision: 1, recordRevision: 1, status: 'accepted', createdAt: 1, updatedAt: 1 })
    const objectiveId = await ctx.db.insert('learnObjectives', { userId, blueprintRevisionId, order: 0, title: 'Explain the prior concept' })
    const sourceIdentityId = await ctx.db.insert('learnSourceIdentities', { userId, learningVoidId, origin: 'user_url', externalKey: 'original-owned-source' })
    const sourceSnapshotId = await ctx.db.insert('learnSourceSnapshots', { userId, sourceIdentityId, learningVoidId, blueprintRevisionId, revision: 1, status: 'user_accepted', effectiveStatus: 'user_accepted', rightsStatus: 'permitted', createdAt: 1 })
    await ctx.db.insert('learnSourceExcerpts', { userId, sourceSnapshotId, locator: 'p:1', excerpt: 'The original accepted evidence.', rightsStatus: 'permitted' })
    const attemptId = await ctx.db.insert('masteryAttempts', { userId, blueprintRevisionId, objectiveId, kind: 'independent_application', attemptedAt: 1, idempotencyKey: 'prior-scored-attempt', response: 'My earlier answer', serverScorePercent: 90, masteryStateBefore: 'unseen', masteryStateAfter: 'independent' })
    await ctx.db.insert('masteryRecords', { userId, blueprintRevisionId, objectiveId, state: 'independent', recordRevision: 1, lastAttemptId: attemptId })
    const studyPlanId = await ctx.db.insert('studyPlans', { userId, learningVoidId, revision: 1, createdAt: 1 })
    await ctx.db.insert('studyPlanRevisions', { userId, learningVoidId, studyPlanId, revision: 1, status: 'accepted', blueprintRevisionId, createdAt: 1 })
  })
  const draftArgs = { need: 'Understand the original idea', intent: 'refresh' as const, availableTime: '15' as const,
    sourceScope: { kind: 'pasted' as const, contentDigest: `sha256:${'a'.repeat(64)}`, byteCount: 128 }, idempotencyKey: 'rollback-create-original' }
  const draft = await owner.mutation(api.learnAdaptiveDrafts.createThreadDraft, draftArgs)
  if (draft.kind !== 'created') throw new Error('Expected created draft')
  const threadId = draft.thread.id
  const prepareArgs = { threadId, expectedRevision: 1, idempotencyKey: 'rollback-prepare-original' }
  const prepared = await owner.mutation(api.learnAdaptiveClarifications.prepareInitialDecision, prepareArgs)
  expect(prepared).toMatchObject({ kind: 'ok', revision: 2, value: { status: 'not_required' } })
  const continueArgs = { threadId, expectedRevision: 2, idempotencyKey: 'rollback-continue-original' }
  const continued = await owner.mutation(api.learnAdaptiveRecovery.continueDraft, continueArgs)
  if (continued.kind !== 'ok') throw new Error('Expected diagnostic')
  const activityId = continued.value.activityId
  const responseArgs = { threadId, activityId, expectedRevision: 3, response: 'I know the starting idea and need a worked example.', idempotencyKey: 'rollback-response-original' }
  const response = await owner.mutation(api.learnAdaptiveRecovery.submitDiagnosticResponse, responseArgs)
  expect(response).toMatchObject({ kind: 'ok', revision: 4, value: { status: 'submitted' } })
  const artifactArgs = { threadId, activityId, artifactKind: 'plan' as const, title: 'Keep this draft', summary: 'Revisit the original evidence tomorrow.', status: 'draft' as const, expectedRevision: 4, idempotencyKey: 'rollback-artifact-original' }
  const artifact = await owner.mutation(api.learnAdaptive.saveArtifact, artifactArgs)
  expect(artifact).toMatchObject({ kind: 'ok', revision: 5, value: { status: 'draft' } })
  const decisionArgs = { threadId, expectedRevision: 5, idempotencyKey: 'rollback-routing-original' }
  const decision = await owner.mutation(api.learnAdaptiveRouting.decideNextActivity, decisionArgs)
  if (decision.kind !== 'ok') throw new Error('Expected routing decision')
  const decisionId = decision.value.decisionId as Id<'learnActivityDecisions'>

  async function exportedSnapshot(actor = owner) {
    return await Promise.all(preservedCollections.map(async (collection) => {
      const rows: unknown[] = []
      let cursor: string | null = null
      for (;;) {
        const result: { page: unknown[], isDone: boolean, continueCursor: string } = await actor.query(api.dataExport.getUserDataPage, { collection, paginationOpts: { cursor, numItems: 8 } })
        rows.push(...result.page)
        if (result.isDone) return { collection, rows }
        cursor = result.continueCursor
      }
    }))
  }
  const before = await exportedSnapshot()
  const projection = await owner.query(api.learnAdaptive.getThread, { threadId })
  const canvas = await owner.query(api.learnAdaptiveRecovery.getDiagnosticCanvas, { threadId })
  const replay = await owner.query(api.learnAdaptiveRouting.replayDecision, { decisionId })
  const commands = [
    () => owner.mutation(api.learnAdaptiveDrafts.createThreadDraft, draftArgs),
    () => owner.mutation(api.learnAdaptiveClarifications.prepareInitialDecision, prepareArgs),
    () => owner.mutation(api.learnAdaptiveRecovery.continueDraft, continueArgs),
    () => owner.mutation(api.learnAdaptiveRecovery.submitDiagnosticResponse, responseArgs),
    () => owner.mutation(api.learnAdaptive.saveArtifact, artifactArgs),
    () => owner.mutation(api.learnAdaptiveRouting.decideNextActivity, decisionArgs),
  ]
  if (gate === 'adaptive') await owner.mutation(internal.learnAdaptiveAccess.setCohortEntitlement, { enabled: false })
  if (gate === 'v2') await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: OWNER.tokenIdentifier, enabled: false })
  if (gate === 'product') process.env.LEARN_V2_ENABLED = 'false'
  const expectedDenial = { data: { code: 'adaptive_access_denied', message: 'Adaptive Learn access denied', fallbackRoute: gate === 'adaptive' ? v2Route : classicRoute } }
  for (let retry = 0; retry < 3; retry++) {
    for (const command of commands) await expect(command()).rejects.toMatchObject(expectedDenial)
    await expect(owner.query(api.learnAdaptive.getThread, { threadId })).rejects.toMatchObject(expectedDenial)
    expect(await exportedSnapshot()).toEqual(before)
  }
  expect((await exportedSnapshot(other)).every(collection => collection.rows.length === 0)).toBe(true)
  await expect(t.query(api.dataExport.getUserDataPage, { collection: 'learningThreads', paginationOpts: { cursor: null, numItems: 8 } })).rejects.toThrow()

  process.env.LEARN_V2_ENABLED = 'true'
  await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: OWNER.tokenIdentifier, enabled: true })
  await owner.mutation(internal.learnAdaptiveAccess.setCohortEntitlement, { enabled: true })
  expect(await owner.query(api.learnAdaptive.getThread, { threadId })).toEqual(projection)
  expect(await owner.query(api.learnAdaptiveRecovery.getDiagnosticCanvas, { threadId })).toEqual(canvas)
  expect(await owner.query(api.learnAdaptiveRouting.replayDecision, { decisionId })).toEqual(replay)
  expect(await commands[0]!()).toEqual({ ...draft, replayed: true, thread: await owner.query(api.learnAdaptiveDrafts.getThreadDraft, { threadId }) })
  for (const [index, original] of [prepared, continued, response, artifact, decision].entries()) expect(await commands[index + 1]!()).toEqual(original)
  expect(await exportedSnapshot()).toEqual(before)
  expect(await other.query(api.learnAdaptive.getThread, { threadId })).toBeNull()
  expect(await other.query(api.learnAdaptiveRecovery.getDiagnosticCanvas, { threadId })).toBeNull()
  expect(await other.query(api.learnAdaptiveRouting.replayDecision, { decisionId })).toBeNull()
})
