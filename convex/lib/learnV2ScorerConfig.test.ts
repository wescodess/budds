/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, expect, test, vi } from 'vitest'
import { api, internal } from '../_generated/api'
import schema from '../schema'

const modules = import.meta.glob('../**/*.ts')
afterEach(() => vi.unstubAllEnvs())

test.each([
  { calibration: '  fixture/calibration  ', fallback: 'fixture/mastery-fallback', expected: 'fixture/calibration' },
  { calibration: ' ', fallback: '  fixture/mastery-fallback  ', expected: 'fixture/mastery-fallback' },
  { calibration: undefined, fallback: undefined, expected: undefined },
])('calibration retains its independent legacy fallback: $expected', async ({ calibration, fallback, expected }) => {
  vi.stubEnv('LEARN_V2_ENABLED', 'true')
  vi.stubEnv('LEARN_V2_CALIBRATION_MODEL', calibration)
  vi.stubEnv('LEARN_V2_MASTERY_MODEL', fallback)
  vi.stubEnv('LEARN_V2_MASTERY_SCORER_CONFIG_VERSION', 'fixture.prospective.v2')
  const t = convexTest(schema, modules)
  const tokenIdentifier = 'https://fixture.invalid|scorer-config-owner'
  const owner = t.withIdentity({ tokenIdentifier })
  await owner.mutation(api.users.upsertUser, {})
  await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier, enabled: true })
  const folderId = await owner.mutation(api.folders.createFolder, { name: 'Synthetic scorer sources' })
  const learningVoid = await owner.mutation(api.learnV2Lifecycle.createLearningVoid, { folderId, title: 'Synthetic calibration', idempotencyKey: 'fixture-void' })
  const blueprint = await owner.mutation(api.learnV2Lifecycle.createBlueprintDraft, { learningVoidId: learningVoid!._id, expectedVoidRevision: 1, idempotencyKey: 'fixture-blueprint' })
  const pins = await t.run(async ctx => {
    await ctx.db.patch(learningVoid!._id, { status: 'calibration', activeBlueprintRevisionId: blueprint!._id })
    await ctx.db.patch(blueprint!._id, { status: 'accepted' })
    const sourceIdentityId = await ctx.db.insert('learnSourceIdentities', { userId: tokenIdentifier, learningVoidId: learningVoid!._id,
      origin: 'user_url', externalKey: 'https://fixture.invalid/source', canonicalUrl: 'https://fixture.invalid/source' })
    const sourceSnapshotId = await ctx.db.insert('learnSourceSnapshots', { userId: tokenIdentifier, sourceIdentityId, learningVoidId: learningVoid!._id,
      blueprintRevisionId: blueprint!._id, revision: 1, recordRevision: 1, status: 'user_accepted', effectiveStatus: 'user_accepted',
      rightsStatus: 'permitted', conflictStatus: 'clear', createdAt: Date.now() })
    await ctx.db.insert('learnSourceExcerpts', { userId: tokenIdentifier, sourceSnapshotId, locator: 'paragraph:1', excerpt: 'Synthetic supported evidence.', rightsStatus: 'permitted' })
    const milestoneId = await ctx.db.insert('learnMilestones', { userId: tokenIdentifier, blueprintRevisionId: blueprint!._id, order: 0, title: 'Synthetic milestone' })
    const objectiveId = await ctx.db.insert('learnObjectives', { userId: tokenIdentifier, blueprintRevisionId: blueprint!._id, milestoneId,
      order: 0, title: 'Synthetic objective', capability: 'Apply a synthetic rule', estimatedMinutes: 10, coverage: 'strong',
      assessmentContract: { version: 'learn-v2.assessment.v1', kind: 'machine_checkable', responseFormat: 'short_text', instructions: 'Apply the rule.',
        passingScorePercent: 80, criteria: [{ key: 'rule', description: 'Apply the rule.', weightPercent: 100 }] } })
    await ctx.db.insert('learnObjectiveSources', { userId: tokenIdentifier, objectiveId, sourceSnapshotId, coverage: 'strong' })
    return { objectiveId, blueprintRevision: (await ctx.db.get(blueprint!._id))!.recordRevision, voidRevision: (await ctx.db.get(learningVoid!._id))!.revision }
  })
  const reserved = await t.mutation(internal.learnV2MapCalibration.reserveCalibrationScoring, { tokenIdentifier, blueprintRevisionId: blueprint!._id,
    objectiveId: pins.objectiveId, expectedBlueprintRecordRevision: pins.blueprintRevision, expectedVoidRevision: pins.voidRevision,
    response: 'Synthetic answer.', confidence: 4, usedHint: false, usedReveal: false, idempotencyKey: 'fixture-calibration' })
  if (reserved.kind !== 'acquired') throw new Error('Expected synthetic calibration lease')
  expect((await t.run(ctx => ctx.db.get(reserved.jobId)))?.providerModel).toBe(expected)
  await t.mutation(internal.learnV2MapCalibration.markCalibrationScoringDispatched, { tokenIdentifier, jobId: reserved.jobId, leaseToken: reserved.leaseToken, expectedRevision: reserved.revision })
  const input = t.query(internal.learnV2MapCalibration.getCalibrationScoringInput, { tokenIdentifier, jobId: reserved.jobId,
    leaseToken: reserved.leaseToken, blueprintRevisionId: blueprint!._id, objectiveId: pins.objectiveId, response: 'Synthetic answer.' })
  if (expected) expect((await input).model).toBe(expected)
  else await expect(input).rejects.toThrow('Calibration scorer is unavailable')
})
