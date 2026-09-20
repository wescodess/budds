/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import schema from './schema'

vi.mock('../server/utils/ai-gateway', () => ({
  classifyAiGatewayFailure: vi.fn(() => 'definitive_failure'),
  generateCompletion: vi.fn(async () => ({ id: 'calibration-provider-1', model: 'mock-calibration', choices: [{ message: { content: JSON.stringify({ criterionResults: [{ key: 'correct', awarded: true, rationale: 'Matches the pinned evidence.' }] }) } }] })),
}))
vi.mock('../server/utils/learn-v2-folder-evidence', () => ({
  retrieveLearnV2FolderEvidence: vi.fn(async ({ sources }: { sources: Array<{ alias: string }> }) => new Map(sources.map(source => [source.alias, 'Transient pinned folder evidence.']))),
}))

const modules = import.meta.glob('./**/*.ts')
const identity = { tokenIdentifier: 'https://auth.example.com|map-owner', name: 'Map Owner' }
const assessment = {
  version: 'learn-v2.assessment.v1' as const,
  kind: 'machine_checkable' as const,
  responseFormat: 'short_text' as const,
  instructions: 'Give the supported answer.',
  passingScorePercent: 80 as const,
  criteria: [{ key: 'correct', description: 'The answer is correct.', weightPercent: 100 }],
}

async function setupMap() {
  process.env.LEARN_V2_ENABLED = 'true'
  const t = convexTest(schema, modules)
  const owner = t.withIdentity(identity)
  await owner.mutation(api.users.upsertUser, {})
  await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: identity.tokenIdentifier, enabled: true })
  const folderId = await owner.mutation(api.folders.createFolder, { name: 'Map sources' })
  const learningVoid = await owner.mutation(api.learnV2Lifecycle.createLearningVoid, { folderId, title: 'Editable map', idempotencyKey: 'map-void' })
  const blueprint = await owner.mutation(api.learnV2Lifecycle.createBlueprintDraft, { learningVoidId: learningVoid!._id, expectedVoidRevision: 1, idempotencyKey: 'map-blueprint' })
  const seeded = await t.run(async (ctx) => {
    await ctx.db.patch(learningVoid!._id, { status: 'map_review' })
    await ctx.db.patch(blueprint!._id, { status: 'map_review' })
    const sourceIdentityId = await ctx.db.insert('learnSourceIdentities', { userId: identity.tokenIdentifier, learningVoidId: learningVoid!._id, origin: 'user_url', externalKey: 'https://example.com/source', canonicalUrl: 'https://example.com/source' })
    const sourceSnapshotId = await ctx.db.insert('learnSourceSnapshots', { userId: identity.tokenIdentifier, sourceIdentityId, learningVoidId: learningVoid!._id, blueprintRevisionId: blueprint!._id, revision: 1, recordRevision: 1, status: 'user_accepted', effectiveStatus: 'user_accepted', rightsStatus: 'permitted', conflictStatus: 'clear', createdAt: Date.now() })
    await ctx.db.insert('learnSourceExcerpts', { userId: identity.tokenIdentifier, sourceSnapshotId, locator: 'paragraph:1', excerpt: 'Supported evidence.', rightsStatus: 'permitted' })
    const milestones = []
    for (let index = 0; index < 3; index++) milestones.push(await ctx.db.insert('learnMilestones', { userId: identity.tokenIdentifier, blueprintRevisionId: blueprint!._id, order: index, title: `Milestone ${index + 1}` }))
    const objectives = []
    for (let index = 0; index < 6; index++) {
      const objectiveId = await ctx.db.insert('learnObjectives', { userId: identity.tokenIdentifier, blueprintRevisionId: blueprint!._id, milestoneId: milestones[Math.floor(index / 2)], order: index, title: `Objective ${index + 1}`, capability: `Capability ${index + 1}`, estimatedMinutes: 20, coverage: 'strong', assessmentContract: assessment })
      objectives.push(objectiveId)
      await ctx.db.insert('learnObjectiveSources', { userId: identity.tokenIdentifier, objectiveId, sourceSnapshotId, coverage: 'strong' })
    }
    return { sourceSnapshotId, objectives }
  })
  return { t, owner, learningVoid: learningVoid!, blueprint: blueprint!, ...seeded }
}

function editedCandidate(sourceSnapshotId: Id<'learnSourceSnapshots'>) {
  return {
    version: 'learn-v2.blueprint-candidate.v1' as const,
    generatorVersion: 'human-map-editor.v1',
    milestones: Array.from({ length: 3 }, (_, index) => ({ key: `milestone-${index + 1}`, order: index, title: `Edited milestone ${index + 1}` })),
    objectives: Array.from({ length: 6 }, (_, index) => ({
      key: `objective-${index + 1}`,
      milestoneKey: `milestone-${Math.floor(index / 2) + 1}`,
      order: index,
      title: `Edited objective ${index + 1}`,
      capability: `Edited capability ${index + 1}`,
      estimatedMinutes: 25,
      depth: index === 0 ? 'advanced' as const : 'working' as const,
      coverage: 'strong' as const,
      sourceSnapshotIds: [sourceSnapshotId],
      gapSourceSnapshotIds: [],
      prerequisiteObjectiveKeys: index === 0 ? [] : [`objective-${index}`],
      assessmentContract: assessment,
    })),
  }
}

describe('Learn V2 revision-safe map editing and calibration', () => {
  test('installs and atomically replaces the active Blueprint pointer with exact replay', async () => {
    const previous = process.env.LEARN_V2_ENABLED
    try {
      const setup = await setupMap()
      const firstAcceptanceArgs = { blueprintRevisionId: setup.blueprint._id, expectedRecordRevision: 1, expectedVoidRevision: 2, idempotencyKey: 'accept-first-map' }
      const firstAcceptance = await setup.owner.mutation(api.learnV2MapCalibration.acceptBlueprintMap, firstAcceptanceArgs)
      expect(await setup.owner.mutation(api.learnV2MapCalibration.acceptBlueprintMap, firstAcceptanceArgs)).toEqual(firstAcceptance)
      expect(await setup.t.run(ctx => ctx.db.get(setup.learningVoid._id))).toMatchObject({
        activeBlueprintRevisionId: setup.blueprint._id,
        revision: 3,
        status: 'calibration',
      })

      const fork = await setup.owner.mutation(api.learnV2Lifecycle.forkBlueprintDraft, {
        blueprintRevisionId: setup.blueprint._id,
        expectedRecordRevision: firstAcceptance.recordRevision,
        expectedVoidRevision: 3,
        idempotencyKey: 'fork-active-map',
      })
      const clonedSource = await setup.t.run(ctx => ctx.db.query('learnSourceSnapshots')
        .withIndex('by_userId_and_blueprintRevisionId', q => q.eq('userId', identity.tokenIdentifier).eq('blueprintRevisionId', fork!._id))
        .first())
      await setup.owner.mutation(api.learnV2MapCalibration.replaceDraftMap, {
        blueprintRevisionId: fork!._id,
        expectedRecordRevision: 1,
        expectedVoidRevision: 4,
        idempotencyKey: 'replace-active-map',
        candidate: editedCandidate(clonedSource!._id),
      })
      const replacementArgs = { blueprintRevisionId: fork!._id, expectedRecordRevision: 2, expectedVoidRevision: 5, idempotencyKey: 'accept-replacement-map' }
      const replacement = await setup.owner.mutation(api.learnV2MapCalibration.acceptBlueprintMap, replacementArgs)
      expect(await setup.owner.mutation(api.learnV2MapCalibration.acceptBlueprintMap, replacementArgs)).toEqual(replacement)
      expect(await setup.t.run(async (ctx) => ({
        learningVoid: await ctx.db.get(setup.learningVoid._id),
        previous: await ctx.db.get(setup.blueprint._id),
        replacement: await ctx.db.get(fork!._id),
      }))).toMatchObject({
        learningVoid: { activeBlueprintRevisionId: fork!._id, revision: 6, status: 'calibration' },
        previous: { status: 'superseded', recordRevision: firstAcceptance.recordRevision + 1 },
        replacement: { status: 'accepted', recordRevision: replacement.recordRevision },
      })
    }
    finally {
      if (previous === undefined) delete process.env.LEARN_V2_ENABLED
      else process.env.LEARN_V2_ENABLED = previous
    }
  })

  test('forks a complete private copy and rejects a concurrent stale fork without mutating the parent', async () => {
    const previous = process.env.LEARN_V2_ENABLED
    try {
      const setup = await setupMap()
      await setup.t.run(async (ctx) => {
        const source = await ctx.db.get(setup.sourceSnapshotId)
        for (let index = 0; index < 65; index++) {
          await ctx.db.insert('learnSourceSnapshots', { userId: identity.tokenIdentifier, sourceIdentityId: source!.sourceIdentityId, learningVoidId: setup.learningVoid._id, blueprintRevisionId: setup.blueprint._id, revision: index + 2, status: 'rejected', rejectedAt: index + 1, createdAt: index + 1 })
        }
      })
      const fork = await setup.owner.mutation(api.learnV2Lifecycle.forkBlueprintDraft, { blueprintRevisionId: setup.blueprint._id, expectedRecordRevision: 1, expectedVoidRevision: 2, idempotencyKey: 'fork-map' })
      await expect(setup.owner.mutation(api.learnV2Lifecycle.forkBlueprintDraft, { blueprintRevisionId: setup.blueprint._id, expectedRecordRevision: 1, expectedVoidRevision: 2, idempotencyKey: 'fork-map-stale' })).rejects.toThrow(/revision conflict/)
      expect(await setup.owner.mutation(api.learnV2Lifecycle.forkBlueprintDraft, { blueprintRevisionId: setup.blueprint._id, expectedRecordRevision: 1, expectedVoidRevision: 2, idempotencyKey: 'fork-map' })).toEqual(fork)
      const parent = await setup.owner.query(api.learnV2Blueprints.getBlueprintMap, { blueprintRevisionId: setup.blueprint._id })
      const child = await setup.owner.query(api.learnV2Blueprints.getBlueprintMap, { blueprintRevisionId: fork!._id })
      expect(parent?.objectives).toHaveLength(6)
      expect(child?.objectives).toHaveLength(6)
      expect(child?.objectives[0]?.title).toBe(parent?.objectives[0]?.title)
      expect(child?.objectives[0]?._id).not.toBe(parent?.objectives[0]?._id)
      expect(child?.objectives[0]?.sourceLinks[0]?.sourceSnapshotId).not.toBe(parent?.objectives[0]?.sourceLinks[0]?.sourceSnapshotId)
    }
    finally {
      if (previous === undefined) delete process.env.LEARN_V2_ENABLED
      else process.env.LEARN_V2_ENABLED = previous
    }
  })

  test('replaces only the forked draft, accepts it, and completes a bounded server-scored calibration', async () => {
    const previous = process.env.LEARN_V2_ENABLED
    try {
      const setup = await setupMap()
      const fork = await setup.owner.mutation(api.learnV2Lifecycle.forkBlueprintDraft, { blueprintRevisionId: setup.blueprint._id, expectedRecordRevision: 1, expectedVoidRevision: 2, idempotencyKey: 'edit-fork' })
      const clonedSource = await setup.t.run(ctx => ctx.db.query('learnSourceSnapshots').withIndex('by_userId_and_blueprintRevisionId', q => q.eq('userId', identity.tokenIdentifier).eq('blueprintRevisionId', fork!._id)).first())
      const editArgs = { blueprintRevisionId: fork!._id, expectedRecordRevision: 1, expectedVoidRevision: 3, idempotencyKey: 'replace-map', candidate: editedCandidate(clonedSource!._id) }
      const edited = await setup.owner.mutation(api.learnV2MapCalibration.replaceDraftMap, editArgs)
      expect(await setup.owner.mutation(api.learnV2MapCalibration.replaceDraftMap, editArgs)).toEqual(edited)
      const parent = await setup.owner.query(api.learnV2Blueprints.getBlueprintMap, { blueprintRevisionId: setup.blueprint._id })
      const child = await setup.owner.query(api.learnV2Blueprints.getBlueprintMap, { blueprintRevisionId: fork!._id })
      expect(parent?.objectives[0]?.title).toBe('Objective 1')
      expect(child?.objectives[0]?.title).toBe('Edited objective 1')
      expect(child?.objectives[0]).toMatchObject({ stableKey: 'objective-1', depth: 'advanced' })
      const accepted = await setup.owner.mutation(api.learnV2MapCalibration.acceptBlueprintMap, { blueprintRevisionId: fork!._id, expectedRecordRevision: 2, expectedVoidRevision: 4, idempotencyKey: 'accept-map' })
      expect(accepted.status).toBe('accepted')
      await expect(setup.owner.mutation(api.learnV2MapCalibration.replaceDraftMap, { ...editArgs, expectedRecordRevision: 3, expectedVoidRevision: 5, idempotencyKey: 'mutate-accepted' })).rejects.toThrow(/not ready|different request/)
      const objectiveIds = child!.objectives.slice(0, 3).map(row => row._id)
      const outcomes = []
      for (let index = 0; index < objectiveIds.length; index++) {
        outcomes.push(await setup.t.mutation(internal.learnV2MapCalibration.recordCalibrationAttempt, { tokenIdentifier: identity.tokenIdentifier, blueprintRevisionId: fork!._id, objectiveId: objectiveIds[index]!, expectedBlueprintRecordRevision: 3, expectedVoidRevision: 5, idempotencyKey: `calibration-${index}`, serverScorePercent: index === 0 ? 100 : 79, usedHint: index === 2, usedReveal: false, confidence: 5, rubricVersion: 'rubric.v1' }))
      }
      expect(outcomes.map(row => row.result)).toEqual(['provisionally_known', 'learning', 'learning'])
      const records = await setup.t.run(ctx => ctx.db.query('masteryRecords').withIndex('by_userId_and_blueprintRevisionId', q => q.eq('userId', identity.tokenIdentifier).eq('blueprintRevisionId', fork!._id)).collect())
      expect(records.map(row => row.state).sort()).toEqual(['learning', 'learning', 'provisionally_known'])
      expect(records.every(row => !['independent', 'retained'].includes(row.state))).toBe(true)
      const completed = await setup.owner.mutation(api.learnV2MapCalibration.completeCalibration, { blueprintRevisionId: fork!._id, expectedBlueprintRecordRevision: 3, expectedVoidRevision: 5, idempotencyKey: 'complete-calibration' })
      expect(completed).toMatchObject({ status: 'plan_review', revision: 6 })
    }
    finally {
      if (previous === undefined) delete process.env.LEARN_V2_ENABLED
      else process.env.LEARN_V2_ENABLED = previous
    }
  })

  test('rejects early completion, duplicate objectives, and changed idempotent calibration requests', async () => {
    const previous = process.env.LEARN_V2_ENABLED
    try {
      const setup = await setupMap()
      const accepted = await setup.owner.mutation(api.learnV2MapCalibration.acceptBlueprintMap, { blueprintRevisionId: setup.blueprint._id, expectedRecordRevision: 1, expectedVoidRevision: 2, idempotencyKey: 'direct-accept' })
      const args = { tokenIdentifier: identity.tokenIdentifier, blueprintRevisionId: setup.blueprint._id, objectiveId: setup.objectives[0]!, expectedBlueprintRecordRevision: accepted.recordRevision, expectedVoidRevision: 3, idempotencyKey: 'single-attempt', serverScorePercent: 80, usedHint: false, usedReveal: false, confidence: 3, rubricVersion: 'rubric.v1' }
      const attempt = await setup.t.mutation(internal.learnV2MapCalibration.recordCalibrationAttempt, args)
      expect((await setup.t.mutation(internal.learnV2MapCalibration.recordCalibrationAttempt, args)).attemptId).toBe(attempt.attemptId)
      await expect(setup.t.mutation(internal.learnV2MapCalibration.recordCalibrationAttempt, { ...args, serverScorePercent: 100 })).rejects.toThrow(/different request/)
      await expect(setup.t.mutation(internal.learnV2MapCalibration.recordCalibrationAttempt, { ...args, idempotencyKey: 'duplicate-objective' })).rejects.toThrow(/already attempted/)
      await setup.t.run(async (ctx) => {
        for (const [index, objectiveId] of setup.objectives.slice(1, 3).entries()) {
          await ctx.db.insert('masteryAttempts', { userId: identity.tokenIdentifier, blueprintRevisionId: setup.blueprint._id, objectiveId, attemptedAt: index + 1, idempotencyKey: `legacy-${index}`, result: 'passed' })
        }
      })
      await expect(setup.owner.mutation(api.learnV2MapCalibration.completeCalibration, { blueprintRevisionId: setup.blueprint._id, expectedBlueprintRecordRevision: accepted.recordRevision, expectedVoidRevision: 3, idempotencyKey: 'too-early' })).rejects.toThrow(/between three and seven/)
    }
    finally {
      if (previous === undefined) delete process.env.LEARN_V2_ENABLED
      else process.env.LEARN_V2_ENABLED = previous
    }
  })

  test('revalidates the active Blueprint pointer before calibration provider dispatch', async () => {
    const setup = await setupMap()
    const accepted = await setup.owner.mutation(api.learnV2MapCalibration.acceptBlueprintMap, { blueprintRevisionId: setup.blueprint._id, expectedRecordRevision: 1, expectedVoidRevision: 2, idempotencyKey: 'dispatch-accept' })
    const request = { tokenIdentifier: identity.tokenIdentifier, blueprintRevisionId: setup.blueprint._id, objectiveId: setup.objectives[0]!, expectedBlueprintRecordRevision: accepted.recordRevision, expectedVoidRevision: 3, response: 'Supported answer.', confidence: 4, usedHint: false, usedReveal: false, idempotencyKey: 'dispatch-reservation' }
    const reservation = await setup.t.mutation(internal.learnV2MapCalibration.reserveCalibrationScoring, request)
    expect(reservation.kind).toBe('acquired')
    if (reservation.kind !== 'acquired') throw new Error('Expected calibration lease')
    await setup.t.run(ctx => ctx.db.patch(setup.learningVoid._id, { activeBlueprintRevisionId: undefined }))
    await expect(setup.t.mutation(internal.learnV2MapCalibration.markCalibrationScoringDispatched, {
      tokenIdentifier: identity.tokenIdentifier,
      jobId: reservation.jobId,
      leaseToken: reservation.leaseToken,
      expectedRevision: reservation.revision,
    })).rejects.toThrow(/active Blueprint pointer/i)
  })

  test('rejects a malformed persisted map whose prerequisite edge count exceeds the contract', async () => {
    const previous = process.env.LEARN_V2_ENABLED
    try {
      const setup = await setupMap()
      await setup.t.run(async (ctx) => {
        for (let index = 0; index < 61; index++) {
          await ctx.db.insert('learnObjectivePrerequisites', { userId: identity.tokenIdentifier, blueprintRevisionId: setup.blueprint._id, objectiveId: setup.objectives[1]!, prerequisiteObjectiveId: setup.objectives[0]! })
        }
      })
      await expect(setup.owner.mutation(api.learnV2MapCalibration.acceptBlueprintMap, { blueprintRevisionId: setup.blueprint._id, expectedRecordRevision: 1, expectedVoidRevision: 2, idempotencyKey: 'reject-too-many-edges' })).rejects.toThrow(/prerequisite set exceeds/)
    }
    finally {
      if (previous === undefined) delete process.env.LEARN_V2_ENABLED
      else process.env.LEARN_V2_ENABLED = previous
    }
  })

  test('scores calibration through the public action, persists provider pins, and replays before dispatch', async () => {
    const previousModel = process.env.LEARN_V2_CALIBRATION_MODEL
    process.env.LEARN_V2_CALIBRATION_MODEL = 'mock-calibration'
    try {
      const setup = await setupMap()
      await setup.t.run(async (ctx) => {
        const source = await ctx.db.get(setup.sourceSnapshotId)
        const excerpt = await ctx.db.query('learnSourceExcerpts').withIndex('by_userId_and_sourceSnapshotId', q => q.eq('userId', identity.tokenIdentifier).eq('sourceSnapshotId', setup.sourceSnapshotId)).unique()
        const learningVoid = await ctx.db.get(setup.learningVoid._id)
        const documentId = await ctx.db.insert('documents', { userId: identity.tokenIdentifier, folderId: learningVoid!.folderId, filename: 'folder-evidence.pdf', status: 'success', fileSize: 100, r2Key: 'owners/map/folder-evidence.pdf' })
        await ctx.db.patch(source!.sourceIdentityId, { origin: 'folder_document', externalKey: `document:${documentId}`, canonicalUrl: undefined, folderDocumentId: documentId })
        await ctx.db.patch(source!._id, { rightsStatus: 'unknown', objectKey: 'owners/map/folder-evidence.pdf', contentHash: 'a'.repeat(64), sourceRevision: `sha256:${'a'.repeat(64)}` })
        await ctx.db.patch(excerpt!._id, { rightsStatus: 'unknown', locator: `sha256:${'a'.repeat(64)}`, excerpt: undefined })
      })
      const accepted = await setup.owner.mutation(api.learnV2MapCalibration.acceptBlueprintMap, { blueprintRevisionId: setup.blueprint._id, expectedRecordRevision: 1, expectedVoidRevision: 2, idempotencyKey: 'public-accept' })
      const args = { blueprintRevisionId: setup.blueprint._id, objectiveId: setup.objectives[0]!, expectedBlueprintRecordRevision: accepted.recordRevision, expectedVoidRevision: 3, response: 'The supported answer.', confidence: 4, usedHint: false, usedReveal: false, idempotencyKey: 'public-calibration-1' }
      const scored = await setup.owner.action(api.learnV2MapCalibration.submitCalibrationAttempt, args)
      expect(scored).toMatchObject({ result: 'provisionally_known', replayed: false })
      expect(await setup.owner.action(api.learnV2MapCalibration.submitCalibrationAttempt, args)).toMatchObject({ result: 'provisionally_known', replayed: true })
      expect(await setup.t.run(ctx => ctx.db.query('masteryAttempts').withIndex('by_userId_and_idempotencyKey', q => q.eq('userId', identity.tokenIdentifier).eq('idempotencyKey', args.idempotencyKey)).unique())).toMatchObject({
        response: args.response,
        activityContractVersion: 'learn-v2.calibration-attempt.v1',
        providerVersion: 'openrouter-via-cloudflare-ai-gateway.v1',
        blueprintRecordRevision: accepted.recordRevision,
        scorerModel: 'mock-calibration',
        scorerVersion: 'learn-v2.calibration-scorer.v1',
        verifierVersionsJson: JSON.stringify(['learn-v2.calibration-evidence-policy.v1']),
        sourceSnapshotIdsJson: JSON.stringify([setup.sourceSnapshotId]),
        contentRevisionPinsJson: JSON.stringify([{ sourceSnapshotId: String(setup.sourceSnapshotId), revision: 1, recordRevision: 1, sourceRevision: `sha256:${'a'.repeat(64)}` }]),
      })
    }
    finally {
      if (previousModel === undefined) delete process.env.LEARN_V2_CALIBRATION_MODEL
      else process.env.LEARN_V2_CALIBRATION_MODEL = previousModel
    }
  })
})
