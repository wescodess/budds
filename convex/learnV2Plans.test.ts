/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const identity = { tokenIdentifier: 'https://auth.example.com|plan-owner', name: 'Plan Owner' }

async function setupPlan() {
  process.env.LEARN_V2_ENABLED = 'true'
  const t = convexTest(schema, modules)
  const owner = t.withIdentity(identity)
  await owner.mutation(api.users.upsertUser, {})
  await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: identity.tokenIdentifier, enabled: true })
  const folderId = await owner.mutation(api.folders.createFolder, { name: 'Plan sources' })
  const learningVoid = await owner.mutation(api.learnV2Lifecycle.createLearningVoid, { folderId, title: 'Plan me', idempotencyKey: 'void' })
  const blueprint = await owner.mutation(api.learnV2Lifecycle.createBlueprintDraft, { learningVoidId: learningVoid!._id, expectedVoidRevision: 1, idempotencyKey: 'blueprint' })
  const objectiveIds = await t.run(async ctx => {
    await ctx.db.patch(learningVoid!._id, { status: 'plan_review', revision: 5 })
    await ctx.db.patch(blueprint!._id, { status: 'accepted', recordRevision: 4 })
    return await Promise.all([0, 1].map(async order => await ctx.db.insert('learnObjectives', {
      userId: identity.tokenIdentifier, blueprintRevisionId: blueprint!._id, order, title: `Objective ${order + 1}`,
      estimatedMinutes: 30,
    })))
  })
  await t.run(ctx => ctx.db.insert('learnObjectivePrerequisites', {
    userId: identity.tokenIdentifier, blueprintRevisionId: blueprint!._id,
    objectiveId: objectiveIds[1]!, prerequisiteObjectiveId: objectiveIds[0]!,
  }))
  return { t, owner, learningVoid: learningVoid!, blueprint: blueprint!, objectiveIds }
}

function input() {
  return {
    version: 'learn-v2.schedule-input.v1' as const,
    timezone: 'America/Toronto', startLocalDate: '2030-09-16', targetLocalDate: '2030-09-20',
    sessionMinutes: 30, minRestMinutes: 0, availability: [{ weekday: 1, start: '09:00', end: '13:00' }, { weekday: 2, start: '09:00', end: '13:00' }, { weekday: 3, start: '09:00', end: '13:00' }, { weekday: 4, start: '09:00', end: '13:00' }, { weekday: 5, start: '09:00', end: '13:00' }],
    blackoutDates: [], reviewIntervalsDays: [1],
  }
}

describe('Learn V2 study-plan preview and acceptance', () => {
  test('pins a feasible latest preview, accepts it exactly once, and creates immutable session shells', async () => {
    const setup = await setupPlan()
    const args = { learningVoidId: setup.learningVoid._id, blueprintRevisionId: setup.blueprint._id, expectedVoidRevision: 5, expectedBlueprintRecordRevision: 4, idempotencyKey: 'preview-1', schedulingInput: input() }
    const preview = await setup.owner.mutation(api.learnV2Plans.createPlanPreview, args)
    expect(preview).toMatchObject({ status: 'draft', feasibility: 'feasible', schedulerVersion: 'learn-v2.scheduler.v1' })
    expect(await setup.owner.mutation(api.learnV2Plans.createPlanPreview, args)).toEqual(preview)
    const newer = await setup.owner.mutation(api.learnV2Plans.editPlanPreview, { studyPlanRevisionId: preview!._id as Id<'studyPlanRevisions'>, expectedPlanRecordRevision: 1, expectedVoidRevision: 5, expectedBlueprintRecordRevision: 4, changeReason: 'availability_changed', idempotencyKey: 'preview-2', schedulingInput: input() })
    await expect(setup.owner.mutation(api.learnV2Plans.acceptPlanPreview, { studyPlanRevisionId: preview!._id as Id<'studyPlanRevisions'>, expectedVoidRevision: 5, expectedPlanRecordRevision: 1, idempotencyKey: 'accept-stale' })).rejects.toThrow(/not ready|latest plan revision/)
    const accepted = await setup.owner.mutation(api.learnV2Plans.acceptPlanPreview, { studyPlanRevisionId: newer!._id as Id<'studyPlanRevisions'>, expectedVoidRevision: 5, expectedPlanRecordRevision: 1, idempotencyKey: 'accept' })
    expect(accepted).toMatchObject({ status: 'accepted', voidStatus: 'scheduled', sessionCount: 4 })
    expect(await setup.owner.mutation(api.learnV2Plans.acceptPlanPreview, { studyPlanRevisionId: newer!._id as Id<'studyPlanRevisions'>, expectedVoidRevision: 5, expectedPlanRecordRevision: 1, idempotencyKey: 'accept' })).toEqual(accepted)
    const sessions = await setup.t.run(ctx => ctx.db.query('studySessions').withIndex('by_userId_and_studyPlanRevisionId_and_scheduledStartAt', q => q.eq('userId', identity.tokenIdentifier).eq('studyPlanRevisionId', newer!._id as Id<'studyPlanRevisions'>)).take(10))
    expect(sessions).toHaveLength(4)
    expect(sessions.every(row => row.status === 'planned' && row.schedulerVersion === 'learn-v2.scheduler.v1')).toBe(true)
  })

  test('anchors retained reviews to the immutable first independent pass', async () => {
    const setup = await setupPlan()
    const firstIndependentPassAt = Date.parse('2030-09-10T02:00:00Z')
    await setup.t.run(ctx => ctx.db.insert('masteryRecords', {
      userId: identity.tokenIdentifier, blueprintRevisionId: setup.blueprint._id, objectiveId: setup.objectiveIds[0]!, state: 'independent',
      firstIndependentPassAt, updatedAt: Date.parse('2030-09-12T02:00:00Z'),
    }))
    const preview = await setup.owner.mutation(api.learnV2Plans.createPlanPreview, { learningVoidId: setup.learningVoid._id, blueprintRevisionId: setup.blueprint._id, expectedVoidRevision: 5, expectedBlueprintRecordRevision: 4, idempotencyKey: 'retained', schedulingInput: input() })
    const row = await setup.t.run(ctx => ctx.db.get(preview._id as Id<'studyPlanRevisions'>))
    const storedInput = JSON.parse(row!.inputSnapshot!)
    expect(storedInput.retainedReviews).toEqual([{ objectiveId: String(setup.objectiveIds[0]), independentLocalDate: '2030-09-09' }])
  })

  test('only marks eligible expired sessions missed and reflows future incomplete sessions without changing mastery', async () => {
    const setup = await setupPlan()
    const preview = await setup.owner.mutation(api.learnV2Plans.createPlanPreview, { learningVoidId: setup.learningVoid._id, blueprintRevisionId: setup.blueprint._id, expectedVoidRevision: 5, expectedBlueprintRecordRevision: 4, idempotencyKey: 'preview', schedulingInput: input() })
    await setup.owner.mutation(api.learnV2Plans.acceptPlanPreview, { studyPlanRevisionId: preview!._id as Id<'studyPlanRevisions'>, expectedVoidRevision: 5, expectedPlanRecordRevision: 1, idempotencyKey: 'accept' })
    const rows = await setup.t.run(ctx => ctx.db.query('studySessions').withIndex('by_userId_and_studyPlanRevisionId_and_scheduledStartAt', q => q.eq('userId', identity.tokenIdentifier).eq('studyPlanRevisionId', preview!._id as Id<'studyPlanRevisions'>)).take(10))
    await setup.t.run(async ctx => {
      await ctx.db.patch(rows[0]!._id, { status: 'ready', scheduledStartAt: 1, scheduledEndAt: 1 + 30 * 60_000 })
      await ctx.db.patch(rows[1]!._id, { status: 'in_progress', scheduledStartAt: 1, scheduledEndAt: 1 + 30 * 60_000 })
      await ctx.db.patch(rows[2]!._id, { status: 'planned', scheduledStartAt: Date.UTC(2030, 8, 17, 13), scheduledEndAt: Date.UTC(2030, 8, 17, 13, 30) })
    })
    const expired = await setup.owner.mutation(api.learnV2Plans.markExpiredSessionsMissed, { learningVoidId: setup.learningVoid._id, idempotencyKey: 'expire' })
    expect(expired.missedSessionIds).toContain(rows[0]!._id)
    expect(expired.missedSessionIds).not.toContain(rows[1]!._id)
    const reflow = await setup.owner.mutation(api.learnV2Plans.reflowFutureIncomplete, { studyPlanRevisionId: preview!._id as Id<'studyPlanRevisions'>, expectedPlanRecordRevision: 2, idempotencyKey: 'reflow' })
    expect(reflow.preservedSessionIds).toContain(rows[1]!._id)
    expect(reflow.changedSessionIds).toEqual(expect.arrayContaining([rows[0]!._id, rows[2]!._id]))
    expect(await setup.t.run(ctx => ctx.db.get(rows[2]!._id))).toMatchObject({ status: 'needs_reschedule', auditReasonCode: 'future_incomplete_reflow' })
    const successor = await setup.t.run(ctx => ctx.db.get(reflow.successorPlanRevisionId as Id<'studyPlanRevisions'>))
    expect(successor).toMatchObject({ status: 'accepted', parentRevisionId: preview!._id })
    expect(await setup.t.run(ctx => ctx.db.query('studySessions').withIndex('by_userId_and_studyPlanRevisionId_and_scheduledStartAt', q => q.eq('userId', identity.tokenIdentifier).eq('studyPlanRevisionId', reflow.successorPlanRevisionId as Id<'studyPlanRevisions'>)).take(10))).toHaveLength((reflow.changedSessionIds as string[]).length)
    const successorJobs = await setup.t.run(async (ctx) => {
      const jobs = await ctx.db.query('learnJobs').withIndex('by_userId_and_learningVoidId_and_type', q => q.eq('userId', identity.tokenIdentifier).eq('learningVoidId', setup.learningVoid._id).eq('type', 'session_content_generation')).take(10)
      return jobs.filter(job => job.studyPlanRevisionId === reflow.successorPlanRevisionId)
    })
    expect(successorJobs).toHaveLength(2)
    expect(new Set(successorJobs.map(job => job.studySessionId)).size).toBe(2)
    expect(await setup.t.run(ctx => ctx.db.query('masteryRecords').withIndex('by_userId_and_blueprintRevisionId', q => q.eq('userId', identity.tokenIdentifier).eq('blueprintRevisionId', setup.blueprint._id)).take(10))).toEqual([])
    await setup.t.run(ctx => ctx.db.patch(rows[3]!._id, { status: 'planned', scheduledStartAt: 1, scheduledEndAt: 1 + 30 * 60_000 }))
    await expect(setup.owner.mutation(api.learnV2Plans.markStudySessionMissed, { studySessionId: rows[3]!._id, expectedSessionRevision: rows[3]!.revision, idempotencyKey: 'stale-history' })).rejects.toThrow(/not current/)
  })

  test('rejects changed idempotent payloads, oversized preferences, and cross-owner access', async () => {
    const setup = await setupPlan()
    const args = { learningVoidId: setup.learningVoid._id, blueprintRevisionId: setup.blueprint._id, expectedVoidRevision: 5, expectedBlueprintRecordRevision: 4, idempotencyKey: 'guarded-preview', schedulingInput: input() }
    const preview = await setup.owner.mutation(api.learnV2Plans.createPlanPreview, args)
    await expect(setup.owner.mutation(api.learnV2Plans.createPlanPreview, { ...args, schedulingInput: { ...input(), sessionMinutes: 25 } })).rejects.toThrow(/different request/)
    const otherIdentity = { tokenIdentifier: 'https://auth.example.com|other-plan-owner', name: 'Other' }
    const other = setup.t.withIdentity(otherIdentity)
    await other.mutation(api.users.upsertUser, {})
    await setup.t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: otherIdentity.tokenIdentifier, enabled: true })
    expect(await other.query(api.learnV2Plans.getPlanPreview, { studyPlanRevisionId: preview!._id as Id<'studyPlanRevisions'> })).toBeNull()

    const bounded = await setupPlan()
    await expect(bounded.owner.mutation(api.learnV2Plans.createPlanPreview, {
      learningVoidId: bounded.learningVoid._id, blueprintRevisionId: bounded.blueprint._id, expectedVoidRevision: 5, expectedBlueprintRecordRevision: 4, idempotencyKey: 'too-many-windows',
      schedulingInput: { ...input(), availability: Array.from({ length: 29 }, (_, index) => ({ weekday: index % 7 + 1, start: '09:00', end: '10:00' })) },
    })).rejects.toThrow(/bounded plan contract/)
  })

  test('rejects infeasible and stale previews instead of creating past session shells', async () => {
    const infeasible = await setupPlan()
    const preview = await infeasible.owner.mutation(api.learnV2Plans.createPlanPreview, {
      learningVoidId: infeasible.learningVoid._id, blueprintRevisionId: infeasible.blueprint._id, expectedVoidRevision: 5, expectedBlueprintRecordRevision: 4, idempotencyKey: 'infeasible',
      schedulingInput: { ...input(), availability: [{ weekday: 1, start: '09:00', end: '09:30' }], targetLocalDate: '2030-09-16' },
    })
    expect(preview.feasibility).toBe('infeasible')
    await expect(infeasible.owner.mutation(api.learnV2Plans.acceptPlanPreview, { studyPlanRevisionId: preview._id as Id<'studyPlanRevisions'>, expectedVoidRevision: 5, expectedPlanRecordRevision: 1, idempotencyKey: 'reject-infeasible' })).rejects.toThrow(/not ready for acceptance/)

    const stale = await setupPlan()
    const stalePreview = await stale.owner.mutation(api.learnV2Plans.createPlanPreview, { learningVoidId: stale.learningVoid._id, blueprintRevisionId: stale.blueprint._id, expectedVoidRevision: 5, expectedBlueprintRecordRevision: 4, idempotencyKey: 'stale', schedulingInput: input() })
    await stale.t.run(async ctx => {
      const row = await ctx.db.get(stalePreview._id as Id<'studyPlanRevisions'>)
      const result = JSON.parse(row!.resultSnapshot!)
      result.placements[0].startUtcMs = 1
      result.placements[0].endUtcMs = 1 + 30 * 60_000
      await ctx.db.patch(row!._id, { resultSnapshot: JSON.stringify(result) })
    })
    await expect(stale.owner.mutation(api.learnV2Plans.acceptPlanPreview, { studyPlanRevisionId: stalePreview._id as Id<'studyPlanRevisions'>, expectedVoidRevision: 5, expectedPlanRecordRevision: 1, idempotencyKey: 'reject-stale' })).rejects.toThrow(/past placement/)
  })
})
