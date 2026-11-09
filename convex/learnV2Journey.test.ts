/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'
import { seedMeasurementStorage, STORAGE_CANARIES } from '../tests/fixtures/learn-v2-measurement-storage'

const modules = import.meta.glob('./**/*.ts')
const owner = { tokenIdentifier: 'https://auth.example.com|journey-owner', name: 'Journey Owner' }
const other = { tokenIdentifier: 'https://auth.example.com|journey-other', name: 'Journey Other' }

const previousGate = process.env.LEARN_V2_ENABLED
afterEach(() => {
  vi.useRealTimers()
  if (previousGate === undefined) delete process.env.LEARN_V2_ENABLED
  else process.env.LEARN_V2_ENABLED = previousGate
})

async function setup() {
  process.env.LEARN_V2_ENABLED = 'true'
  const t = convexTest(schema, modules)
  const asOwner = t.withIdentity(owner)
  await asOwner.mutation(api.users.upsertUser, {})
  await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: owner.tokenIdentifier, enabled: true })
  const folderId = await asOwner.mutation(api.folders.createFolder, { name: 'Journey folder' })
  const learningVoid = await asOwner.mutation(api.learnV2Lifecycle.createLearningVoid, { folderId, title: 'Journey mission', idempotencyKey: 'journey-create' })
  return { t, asOwner, folderId, learningVoid }
}

describe('Learn V2 public journey read model', () => {
  test('keeps live canonical answer history and denies its purged body before alias cleanup', async () => {
    vi.useFakeTimers()
    const { t, asOwner } = await setup()
    const f = await t.run(ctx => seedMeasurementStorage(ctx, owner.tokenIdentifier))
    const attemptId = await t.run(async ctx => {
      await ctx.db.patch(f.scope.blueprintRevisionId, { status: 'accepted' })
      await ctx.db.patch(f.learningVoidId, { activeBlueprintRevisionId: f.scope.blueprintRevisionId })
      await ctx.db.patch(f.scope.objectiveId, { assessmentContract: { version: 'learn-v2.assessment.v1', kind: 'bounded_rubric', responseFormat: 'short_text',
        instructions: 'Existing editable calibration instructions.', passingScorePercent: 80, criteria: [{ key: 'correct', description: 'Existing public criterion.', weightPercent: 100 }] } })
      return await ctx.db.insert('masteryAttempts', { userId: owner.tokenIdentifier, blueprintRevisionId: f.scope.blueprintRevisionId,
        objectiveId: f.scope.objectiveId, submissionId: f.rows.learnResponses, kind: 'calibration', attemptedAt: 123,
        idempotencyKey: 'canonical-history', response: STORAGE_CANARIES.answer, confidence: 3, serverScorePercent: 80,
        usedHint: false, usedReveal: false, rubricVersion: 'rubric.v1', scorerVersion: 'scorer.v1',
        rubricSnapshot: STORAGE_CANARIES.rubric, contentRevisionPinsJson: STORAGE_CANARIES.locator })
    })
    const args = { learningVoidId: f.learningVoidId }
    const live = await asOwner.query(api.learnV2Journey.getMission, args)
    // Ownership of the contract does not establish a calibration delivery.
    expect(live?.calibration.items[0]).not.toHaveProperty('rubric')
    expect(live?.map?.objectives[0]).not.toHaveProperty('assessmentContract')
    expect(live?.calibration.items[0]?.prompt).toBeNull()
    expect(live?.calibration.attempts[0]).toMatchObject({ _id: attemptId, response: STORAGE_CANARIES.answer,
      submissionId: f.rows.learnResponses, rubricVersion: 'rubric.v1', scorerVersion: 'scorer.v1', bodyAvailability: 'available' })
    expect(live?.mastery[0]?.attempts[0]).toEqual(live?.calibration.attempts[0])
    expect(JSON.stringify(live)).not.toContain(STORAGE_CANARIES.rubric)
    expect(JSON.stringify(live)).not.toContain(STORAGE_CANARIES.locator)
    await t.mutation(internal.documents.updateDocumentStatus, { id: f.documentId, status: 'failed' })
    expect(await t.run(ctx => ctx.db.get(f.rows.learnResponseBodies))).toMatchObject({ payload: { text: STORAGE_CANARIES.answer } })
    const unavailable = await asOwner.query(api.learnV2Journey.getMission, args)
    expect(unavailable?.calibration.attempts[0]).toMatchObject({ _id: attemptId, serverScorePercent: 80, bodyAvailability: 'unavailable' })
    expect(JSON.stringify(unavailable)).not.toContain(STORAGE_CANARIES.answer)
    await t.mutation(internal.documents.updateDocumentStatus, { id: f.documentId, status: 'success' })
    expect((await asOwner.query(api.learnV2Journey.getMission, args))?.calibration.attempts[0]).toHaveProperty('response', STORAGE_CANARIES.answer)
    await t.mutation(internal.learnV2Retention.purgeResponseCopies, { userId: owner.tokenIdentifier, submissionId: f.rows.learnResponses })
    expect(await t.run(ctx => ctx.db.get(attemptId))).toMatchObject({ response: STORAGE_CANARIES.answer })
    const purged = await asOwner.query(api.learnV2Journey.getMission, args)
    expect(purged?.calibration.attempts[0]).toMatchObject({ _id: attemptId, serverScorePercent: 80, confidence: 3,
      attemptedAt: 123, rubricVersion: 'rubric.v1', scorerVersion: 'scorer.v1', bodyAvailability: 'unavailable' })
    expect(purged?.calibration.attempts[0]).not.toHaveProperty('response')
    expect(purged?.mastery[0]?.attempts[0]).not.toHaveProperty('response')
    expect(JSON.stringify(purged)).not.toContain(STORAGE_CANARIES.answer)
  })

  test('returns bounded hub and current mission projections for the owner', async () => {
    const setupResult = await setup()
    await expect(setupResult.asOwner.query(api.learnV2Journey.listHub, {})).resolves.toMatchObject({ items: [{ _id: setupResult.learningVoid._id, title: 'Journey mission', status: 'draft', nextAction: 'source_selection' }] })
    const mission = await setupResult.asOwner.query(api.learnV2Journey.getMission, { learningVoidId: setupResult.learningVoid._id })
    expect(mission).toMatchObject({ learningVoid: { _id: setupResult.learningVoid._id, title: 'Journey mission' }, nextAction: 'source_selection', sources: { counts: { total: 0 } }, map: null, plan: { root: null }, calibration: { attempts: [], completed: false } })
    expect(await setupResult.asOwner.query(api.learnV2Journey.getCurrentMission, {})).toMatchObject({ learningVoid: { _id: setupResult.learningVoid._id } })
  })

  test('rejects a V1 course ID while the owned V2 destination still loads', async () => {
    const { asOwner, folderId, learningVoid } = await setup()
    const { courseId } = await asOwner.mutation(api.courses.create, {
      title: 'V1 source', sourceType: 'web-only', folderId,
    })
    await expect(asOwner.query(api.learnV2Journey.getMission, {
      learningVoidId: courseId as never,
    })).rejects.toThrow()
    expect(await asOwner.query(api.learnV2Journey.getMission, { learningVoidId: learningVoid._id }))
      .toMatchObject({ learningVoid: { _id: learningVoid._id } })
  })

  test('keeps pre-acceptance setup usable but resolves accepted authority only from the active pointer', async () => {
    const setupResult = await setup()
    const blueprint = await setupResult.asOwner.mutation(api.learnV2Lifecycle.createBlueprintDraft, { learningVoidId: setupResult.learningVoid._id, expectedVoidRevision: 1, idempotencyKey: 'authority-blueprint' })
    expect(await setupResult.asOwner.query(api.learnV2Journey.getMission, { learningVoidId: setupResult.learningVoid._id })).toMatchObject({
      currentBlueprint: { _id: blueprint._id, status: 'draft' },
    })
    const newerDraftId = await setupResult.t.run(async (ctx) => {
      const current = await ctx.db.get(blueprint._id)
      await ctx.db.patch(blueprint._id, { status: 'accepted', recordRevision: 2 })
      await ctx.db.patch(setupResult.learningVoid._id, { status: 'calibration', activeBlueprintRevisionId: blueprint._id, revision: 3 })
      return await ctx.db.insert('learnBlueprintRevisions', {
        userId: owner.tokenIdentifier,
        blueprintId: current!.blueprintId,
        learningVoidId: setupResult.learningVoid._id,
        revision: 2,
        recordRevision: 1,
        status: 'draft',
        createdAt: 2,
        updatedAt: 2,
      })
    })
    const mission = await setupResult.asOwner.query(api.learnV2Journey.getMission, { learningVoidId: setupResult.learningVoid._id })
    expect(mission).toMatchObject({ currentBlueprint: { _id: blueprint._id, status: 'accepted' } })
    expect(mission?.currentBlueprint?._id).not.toBe(newerDraftId)
  })

  test('does not disclose another owner’s mission and requires entitlement', async () => {
    const setupResult = await setup()
    const unauthenticated = setupResult.t
    await expect(unauthenticated.query(api.learnV2Journey.getMission, { learningVoidId: setupResult.learningVoid._id })).rejects.toThrow(/access denied|authenticated/)
    const asOther = setupResult.t.withIdentity(other)
    await asOther.mutation(api.users.upsertUser, {})
    await setupResult.t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: other.tokenIdentifier, enabled: true })
    expect(await asOther.query(api.learnV2Journey.getMission, { learningVoidId: setupResult.learningVoid._id })).toBeNull()
    await expect(asOther.query(api.learnV2Journey.listHub, {})).resolves.toEqual({ items: [] })
  })

  test('returns only a current owner-scoped session with its exact revision pins', async () => {
    const setupResult = await setup()
    const blueprint = await setupResult.asOwner.mutation(api.learnV2Lifecycle.createBlueprintDraft, { learningVoidId: setupResult.learningVoid._id, expectedVoidRevision: 1, idempotencyKey: 'session-blueprint' })
    const ids = await setupResult.t.run(async ctx => {
      await ctx.db.patch(setupResult.learningVoid._id, { status: 'scheduled', activeBlueprintRevisionId: blueprint._id, revision: 2 })
      await ctx.db.patch(blueprint._id, { status: 'accepted', recordRevision: 3 })
      const planId = await ctx.db.insert('studyPlans', { userId: owner.tokenIdentifier, learningVoidId: setupResult.learningVoid._id, revision: 1, createdAt: 1 })
      const planRevisionId = await ctx.db.insert('studyPlanRevisions', { userId: owner.tokenIdentifier, studyPlanId: planId, learningVoidId: setupResult.learningVoid._id, revision: 1, recordRevision: 5, status: 'accepted', blueprintRevisionId: blueprint._id, blueprintRecordRevision: 3, timezone: 'America/Toronto', createdAt: 1, updatedAt: 1 })
      await ctx.db.patch(planId, { activeRevisionId: planRevisionId })
      const objectiveId = await ctx.db.insert('learnObjectives', { userId: owner.tokenIdentifier, blueprintRevisionId: blueprint._id, order: 0, title: 'Pinned objective', capability: 'Explain the evidence.', estimatedMinutes: 25 })
      const sessionId = await ctx.db.insert('studySessions', { userId: owner.tokenIdentifier, studyPlanRevisionId: planRevisionId, primaryObjectiveId: objectiveId, status: 'ready', revision: 7, scheduledStartAt: 1, scheduledEndAt: Date.now() + 60_000, timezone: 'America/Toronto' })
      await ctx.db.insert('sessionContent', { userId: owner.tokenIdentifier, studySessionId: sessionId, studyPlanRevisionId: planRevisionId, blueprintRevisionId: blueprint._id, objectiveId, status: 'published', revision: 11, createdAt: 1 })
      return { sessionId }
    })
    await expect(setupResult.asOwner.query(api.learnV2Journey.getSessionCandidate, { learningVoidId: setupResult.learningVoid._id, studySessionId: ids.sessionId })).resolves.toMatchObject({ status: 'ready', sessionRevision: 7, plan: { recordRevision: 5 }, blueprint: { recordRevision: 3 }, content: { revision: 11 } })
    const asOther = setupResult.t.withIdentity(other)
    await asOther.mutation(api.users.upsertUser, {})
    await setupResult.t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: other.tokenIdentifier, enabled: true })
    await expect(asOther.query(api.learnV2Journey.getSessionCandidate, { learningVoidId: setupResult.learningVoid._id, studySessionId: ids.sessionId })).resolves.toBeNull()
  })

  test('projects the latest blueprint generation state without exposing provider data', async () => {
    const setupResult = await setup()
    const blueprint = await setupResult.asOwner.mutation(api.learnV2Lifecycle.createBlueprintDraft, {
      learningVoidId: setupResult.learningVoid._id, expectedVoidRevision: 1, idempotencyKey: 'journey-blueprint',
    })
    await setupResult.t.run(async ctx => {
      await ctx.db.insert('learnJobs', {
        userId: owner.tokenIdentifier, learningVoidId: setupResult.learningVoid._id,
        blueprintRevisionId: blueprint._id, type: 'blueprint_generation', status: 'running', revision: 3,
        idempotencyKey: 'journey-generation', attempts: 1, checkpoint: 'generating', createdAt: 10, updatedAt: 11,
      })
    })
    await expect(setupResult.asOwner.query(api.learnV2Journey.getMission, { learningVoidId: setupResult.learningVoid._id }))
      .resolves.toMatchObject({ generation: { status: 'running', attempts: 1, terminalReason: null, updatedAt: 11 } })
  })
})
