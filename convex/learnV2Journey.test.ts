/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, describe, expect, test } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const owner = { tokenIdentifier: 'https://auth.example.com|journey-owner', name: 'Journey Owner' }
const other = { tokenIdentifier: 'https://auth.example.com|journey-other', name: 'Journey Other' }

const previousGate = process.env.LEARN_V2_ENABLED
afterEach(() => {
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
  test('returns bounded hub and current mission projections for the owner', async () => {
    const setupResult = await setup()
    await expect(setupResult.asOwner.query(api.learnV2Journey.listHub, {})).resolves.toMatchObject({ items: [{ _id: setupResult.learningVoid._id, title: 'Journey mission', status: 'draft', nextAction: 'source_selection' }] })
    const mission = await setupResult.asOwner.query(api.learnV2Journey.getMission, { learningVoidId: setupResult.learningVoid._id })
    expect(mission).toMatchObject({ learningVoid: { _id: setupResult.learningVoid._id, title: 'Journey mission' }, nextAction: 'source_selection', sources: { counts: { total: 0 } }, map: null, plan: { root: null }, calibration: { attempts: [], completed: false } })
    expect(await setupResult.asOwner.query(api.learnV2Journey.getCurrentMission, {})).toMatchObject({ learningVoid: { _id: setupResult.learningVoid._id } })
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
      await ctx.db.patch(setupResult.learningVoid._id, { status: 'scheduled', revision: 2 })
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
})
