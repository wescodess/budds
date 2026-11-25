/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, expect, test, vi } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'
import { seedMeasurementStorage } from '../tests/fixtures/learn-v2-measurement-storage'

const modules = import.meta.glob('./**/*.ts')
afterEach(() => vi.unstubAllEnvs())

test('disabled Canvas preparation returns metadata without changing an existing session, assessment or enrollment', async () => {
  vi.stubEnv('LEARN_V2_ENABLED', 'true')
  const t = convexTest(schema, modules)
  const tokenIdentifier = 'https://preparation.example|owner'
  const owner = t.withIdentity({ tokenIdentifier })
  const f = await t.run(async ctx => {
    await ctx.db.insert('users', { tokenIdentifier, name: 'Learner', learnV2Entitlement: { enabled: true, updatedAt: Date.now() },
      learnAdaptiveExperienceEntitlement: { enabled: true, updatedAt: Date.now() } })
    return await seedMeasurementStorage(ctx, tokenIdentifier)
  })
  const snapshot = () => t.run(async ctx => ({ session: await ctx.db.get(f.studySessionId),
    assignments: await ctx.db.query('learnMeasurementAssignments').take(8), opportunities: await ctx.db.query('learnAssessmentOpportunities').take(8),
    exposures: await ctx.db.query('learnAssessmentExposures').take(8), content: await ctx.db.query('sessionContent').take(8),
    threads: await ctx.db.query('learningThreads').take(8), activities: await ctx.db.query('learningThreadActivities').take(8),
    receipts: await ctx.db.query('learnActivityCommandReceipts').take(8), facts: await ctx.db.query('learnMeasurementReportFacts').take(8),
    dueWork: await ctx.db.query('learnMeasurementDueWork').take(8) }))
  const before = await snapshot()
  const request = { studySessionId: f.studySessionId, expectedSessionRevision: before.session!.revision, idempotencyKey: 'off_canvas_preparation_1234567890' }
  expect(await owner.mutation(api.learnAdaptiveCanvas.prepareCanvasSession, request)).toEqual({ kind: 'not_admitted', reasonCode: 'disabled', observations: 'no_observations' })
  expect(await owner.mutation(api.learnAdaptiveCanvas.startCanvasSession, { ...request, expectedContentRevision: 1 }))
    .toEqual({ kind: 'not_admitted', reasonCode: 'disabled', observations: 'no_observations' })
  expect(await owner.query(api.learnAdaptiveCanvas.listDueChecks, {})).toEqual({ status: 'disabled', reasonCode: 'disabled', checks: [] })
  expect(await owner.mutation(api.learnAdaptiveCanvas.prepareCanvasSession, request)).toEqual({ kind: 'not_admitted', reasonCode: 'disabled', observations: 'no_observations' })
  expect(await snapshot()).toEqual(before)
})
