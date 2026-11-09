/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import type { FunctionArgs } from 'convex/server'
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

function editedCandidate(sourceSnapshotId: Id<'learnSourceSnapshots'>): FunctionArgs<typeof api.learnV2MapCalibration.replaceDraftMap>['candidate'] {
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
    })),
  }
}

type MapFixture = Awaited<ReturnType<typeof setupMap>>
const privateInstructions = 'PRIVATE_MAP_INSTRUCTIONS'
const privateCriterion = 'PRIVATE_MAP_CRITERION'

async function editableMap() {
  const f = await setupMap()
  await f.t.run(async ctx => {
    await ctx.db.patch(f.blueprint._id, { status: 'draft' })
    for (const [index, id] of f.objectives.entries()) await ctx.db.patch(id, { stableKey: `objective-${index + 1}`, assessmentContract: {
      ...assessment, instructions: `  ${privateInstructions}_${index}  `, criteria: [{ key: `private-${index}`, description: `${privateCriterion}_${index}`, weightPercent: 100 }],
    } })
  })
  return f
}

function editCommand(f: MapFixture) {
  return { blueprintRevisionId: f.blueprint._id, expectedRecordRevision: 1, expectedVoidRevision: 2,
    idempotencyKey: 'private-contract-map-edit', candidate: editedCandidate(f.sourceSnapshotId) }
}

async function storedObjectives(f: MapFixture) {
  return await f.t.run(ctx => ctx.db.query('learnObjectives').withIndex('by_userId_and_blueprintRevisionId_and_order', q => q
    .eq('userId', identity.tokenIdentifier).eq('blueprintRevisionId', f.blueprint._id)).take(16))
}

async function mapState(f: MapFixture) {
  const objectives = await storedObjectives(f)
  return await f.t.run(async ctx => ({ blueprint: await ctx.db.get(f.blueprint._id), learningVoid: await ctx.db.get(f.learningVoid._id),
    objectives, receipts: await ctx.db.query('learnLifecycleReceipts').withIndex('by_userId_and_learningVoidId', q => q.eq('userId', identity.tokenIdentifier).eq('learningVoidId', f.learningVoid._id)).take(20) }))
}

async function assertPrivateMap(f: MapFixture) {
  const reads = [await f.owner.query(api.learnV2Blueprints.getBlueprintMap, { blueprintRevisionId: f.blueprint._id }),
    await f.owner.query(api.learnV2Journey.getMission, { learningVoidId: f.learningVoid._id }),
    await f.owner.query(api.learnV2Journey.getCurrentMission, {})]
  const serialized = JSON.stringify(reads)
  for (const value of [privateInstructions, privateCriterion, 'assessmentContract', 'weightPercent', 'Demonstrate the capability using the accepted evidence.']) expect(serialized).not.toContain(value)
}

describe('server-owned map assessment contracts', () => {
  test.each(['command', 'candidate', 'objective', 'milestone'].flatMap(level => ['assessmentContract', 'instructions', 'criteria', 'weightPercent', 'weights', 'rubric'].map(field => ({ level, field }))))('$level rejects client $field before changing the map', async ({ level, field }) => {
    const f = await editableMap()
    const args = editCommand(f)
    const target = level === 'command' ? args : level === 'candidate' ? args.candidate : level === 'objective' ? args.candidate.objectives[0]! : args.candidate.milestones[0]!
    Reflect.set(target, field, field === 'assessmentContract' ? assessment : 'CLIENT_PRIVATE_ASSESSMENT_PAYLOAD')
    const before = await mapState(f)
    await expect(f.owner.mutation(api.learnV2MapCalibration.replaceDraftMap, args)).rejects.toThrow()
    expect(await mapState(f)).toEqual(before)
  })

  test('stable identities preserve exact private contracts through edits and repeated reorders', async () => {
    const f = await editableMap()
    const before = new Map((await storedObjectives(f)).map(row => [row.stableKey, row.assessmentContract]))
    const args = editCommand(f)
    args.candidate.objectives.reverse().forEach((row, index) => { row.order = index; row.title = `Renamed ${index}` })
    const result = await f.owner.mutation(api.learnV2MapCalibration.replaceDraftMap, args)
    expect(JSON.stringify(result)).not.toContain(privateInstructions)
    for (const row of await storedObjectives(f)) expect(row.assessmentContract).toEqual(before.get(row.stableKey))
    args.candidate.objectives.reverse().forEach((row, index) => { row.order = index })
    await f.owner.mutation(api.learnV2MapCalibration.replaceDraftMap, { ...args, expectedRecordRevision: 2, expectedVoidRevision: 3, idempotencyKey: 'second-order', candidate: args.candidate })
    for (const row of await storedObjectives(f)) expect(row.assessmentContract).toEqual(before.get(row.stableKey))
    await assertPrivateMap(f)
    const state = await mapState(f)
    expect(JSON.stringify(state.receipts)).not.toContain(privateInstructions)
  })

  test('a new objective receives the exact fixed server default without learner text or a provider call', async () => {
    const f = await editableMap()
    const args = editCommand(f)
    args.candidate.objectives.push({ ...args.candidate.objectives[0]!, key: 'new-objective', order: 6,
      title: 'LEARNER_TEXT_MUST_NOT_ENTER_CONTRACT', capability: 'LEARNER_TEXT_MUST_NOT_ENTER_CONTRACT' })
    const { generateCompletion } = await import('../server/utils/ai-gateway')
    vi.mocked(generateCompletion).mockClear()
    await f.owner.mutation(api.learnV2MapCalibration.replaceDraftMap, args)
    expect((await storedObjectives(f)).find(row => row.stableKey === 'new-objective')?.assessmentContract).toEqual({
      version: 'learn-v2.assessment.v1', kind: 'bounded_rubric', responseFormat: 'short_text',
      instructions: 'Demonstrate the capability using the accepted evidence.', passingScorePercent: 80,
      criteria: [{ key: 'correct', description: 'The response is correct and supported by the accepted evidence.', weightPercent: 100 }],
    })
    expect(generateCompletion).not.toHaveBeenCalled()
    await assertPrivateMap(f)
    await expect(f.owner.mutation(api.learnV2MapCalibration.acceptBlueprintMap, { blueprintRevisionId: f.blueprint._id,
      expectedRecordRevision: 2, expectedVoidRevision: 3, idempotencyKey: 'accept-default' })).resolves.toMatchObject({ status: 'accepted' })
    await assertPrivateMap(f)
  })

  test.each(['split-child', ' split-child '])('an explicit split inherits the unchanged stored parent contract for both children and replays without rewriting: %s', async childKey => {
    const f = await editableMap()
    const parentContract = (await storedObjectives(f))[0]!.assessmentContract
    const args = editCommand(f)
    args.candidate.objectives[0]!.title = 'First split capability'
    args.candidate.objectives.push({ ...args.candidate.objectives[0]!, key: childKey, order: 6, title: 'Second split capability', splitFromObjectiveKey: 'objective-1' })
    const result = await f.owner.mutation(api.learnV2MapCalibration.replaceDraftMap, args)
    const rows = await storedObjectives(f)
    for (const key of ['objective-1', 'split-child']) expect(rows.find(row => row.stableKey === key)?.assessmentContract).toEqual(parentContract)
    expect(await f.owner.mutation(api.learnV2MapCalibration.replaceDraftMap, args)).toEqual(result)
    expect(await storedObjectives(f)).toEqual(rows)
    await expect(f.owner.mutation(api.learnV2MapCalibration.replaceDraftMap, { ...args, candidate: { ...args.candidate,
      objectives: args.candidate.objectives.map(row => row.key === childKey ? { ...row, splitFromObjectiveKey: 'objective-2' } : row) } })).rejects.toThrow('different request')
    await f.owner.mutation(api.learnV2MapCalibration.acceptBlueprintMap, { blueprintRevisionId: f.blueprint._id,
      expectedRecordRevision: 2, expectedVoidRevision: 3, idempotencyKey: 'accept-split' })
    await assertPrivateMap(f)
  })

  test.each(['missing', 'foreign', 'other-revision', 'removed', 'existing-child', 'padded-existing-child', 'new-parent', 'self'] as const)('rejects a %s split parent atomically', async failure => {
    const f = await editableMap()
    const args = editCommand(f)
    let parentKey = 'objective-1'
    if (failure === 'missing') parentKey = 'missing-parent'
    if (failure === 'self') parentKey = 'split-child'
    if (failure === 'removed') args.candidate.objectives.shift()
    if (failure === 'new-parent') { parentKey = 'new-parent'; args.candidate.objectives.push({ ...args.candidate.objectives[0]!, key: parentKey, order: 6 }) }
    if (failure === 'foreign' || failure === 'other-revision') {
      parentKey = 'outside-parent'
      await f.t.run(async ctx => {
        const { _id: _rowId, _creationTime: _rowTime, ...objective } = (await ctx.db.get(f.objectives[0]!))!
        let blueprintRevisionId = f.blueprint._id
        if (failure === 'other-revision') {
          const { _id: _blueprintId, _creationTime: _blueprintTime, ...blueprint } = (await ctx.db.get(blueprintRevisionId))!
          blueprintRevisionId = await ctx.db.insert('learnBlueprintRevisions', { ...blueprint, revision: 0 })
        }
        await ctx.db.insert('learnObjectives', { ...objective, blueprintRevisionId, stableKey: parentKey, userId: failure === 'foreign' ? 'foreign-owner' : identity.tokenIdentifier })
      })
      args.candidate.objectives.push({ ...args.candidate.objectives[0]!, key: parentKey, order: 6 })
    }
    if (failure === 'existing-child' || failure === 'padded-existing-child') {
      args.candidate.objectives[1]!.splitFromObjectiveKey = parentKey
      if (failure === 'padded-existing-child') args.candidate.objectives[1]!.key = ' objective-2 '
    }
    else args.candidate.objectives.push({ ...args.candidate.objectives[0]!, key: 'split-child', order: args.candidate.objectives.length, splitFromObjectiveKey: parentKey })
    args.candidate.objectives.forEach((row, index) => { row.order = index; row.prerequisiteObjectiveKeys = [] })
    const before = await mapState(f)
    await expect(f.owner.mutation(api.learnV2MapCalibration.replaceDraftMap, args)).rejects.toMatchObject({ data: { status: 'rejected', reasonCode: 'invalid_split_parent' } })
    expect(await mapState(f)).toEqual(before)
  })

  test('a split cannot replace an unavailable parent contract with the new-objective default', async () => {
    const f = await editableMap()
    await f.t.run(ctx => ctx.db.patch(f.objectives[0]!, { assessmentContract: undefined }))
    const args = editCommand(f)
    args.candidate.objectives.push({ ...args.candidate.objectives[0]!, key: 'split-child', order: 6, splitFromObjectiveKey: 'objective-1' })
    const before = await mapState(f)
    await expect(f.owner.mutation(api.learnV2MapCalibration.replaceDraftMap, args)).rejects.toMatchObject({ data: { reasonCode: 'assessment_contract_unavailable' } })
    expect(await mapState(f)).toEqual(before)
  })

  test.each(['duplicate', 'overflow'] as const)('a %s stored objective identity set rejects before replacement', async failure => {
    const f = await editableMap()
    await f.t.run(async ctx => {
      if (failure === 'duplicate') await ctx.db.patch(f.objectives[1]!, { stableKey: 'objective-1' })
      else {
        const { _id: _rowId, _creationTime: _rowTime, ...objective } = (await ctx.db.get(f.objectives[0]!))!
        for (let index = 0; index < 10; index++) await ctx.db.insert('learnObjectives', { ...objective, stableKey: `extra-${index}`, order: index + 6 })
      }
    })
    const before = await mapState(f)
    await expect(f.owner.mutation(api.learnV2MapCalibration.replaceDraftMap, editCommand(f))).rejects.toMatchObject({ data: { reasonCode: 'objective_identity_unavailable' } })
    expect(await mapState(f)).toEqual(before)
  })

  test('an ordinary edit keeps a purged contract absent and acceptance returns a typed rejection', async () => {
    const f = await editableMap()
    await f.t.run(ctx => ctx.db.patch(f.objectives[0]!, { assessmentContract: undefined }))
    await f.owner.mutation(api.learnV2MapCalibration.replaceDraftMap, editCommand(f))
    expect((await storedObjectives(f))[0]!.assessmentContract).toBeUndefined()
    const before = await mapState(f)
    await expect(f.owner.mutation(api.learnV2MapCalibration.acceptBlueprintMap, { blueprintRevisionId: f.blueprint._id,
      expectedRecordRevision: 2, expectedVoidRevision: 3, idempotencyKey: 'accept-purged' })).rejects.toMatchObject({ data: {
      version: 'learn-v2.map-edit.v1', status: 'rejected', reasonCode: 'assessment_contract_unavailable',
    } })
    expect(await mapState(f)).toEqual(before)
    await assertPrivateMap(f)
  })

  test.each(['blank-instructions', 'empty-criteria', 'duplicate-keys', 'wrong-total', 'fractional-weight', 'blank-description', 'too-many-criteria'] as const)('acceptance rejects a %s private contract without leaking it or changing authority', async failure => {
    const f = await setupMap()
    const contract = { ...assessment, instructions: privateInstructions, criteria: [{ key: 'private-key', description: privateCriterion, weightPercent: 100 }] }
    if (failure === 'blank-instructions') contract.instructions = ' '
    if (failure === 'empty-criteria') contract.criteria = []
    if (failure === 'duplicate-keys') contract.criteria = [0, 1].map(() => ({ key: 'private-key', description: privateCriterion, weightPercent: 50 }))
    if (failure === 'wrong-total') contract.criteria[0]!.weightPercent = 99
    if (failure === 'fractional-weight') contract.criteria[0]!.weightPercent = 99.5
    if (failure === 'blank-description') contract.criteria[0]!.description = ' '
    if (failure === 'too-many-criteria') contract.criteria = Array.from({ length: 9 }, (_, i) => ({ key: `key-${i}`, description: privateCriterion, weightPercent: i === 8 ? 20 : 10 }))
    await f.t.run(ctx => ctx.db.patch(f.objectives[0]!, { assessmentContract: contract }))
    const before = await mapState(f)
    const error = await f.owner.mutation(api.learnV2MapCalibration.acceptBlueprintMap, { blueprintRevisionId: f.blueprint._id,
      expectedRecordRevision: 1, expectedVoidRevision: 2, idempotencyKey: 'invalid-private-contract' }).catch(error => error)
    expect(error.data).toEqual({ version: 'learn-v2.map-edit.v1', status: 'rejected', reasonCode: 'assessment_contract_unavailable' })
    expect(String(error)).not.toContain(privateCriterion)
    expect(String(error)).not.toContain(privateInstructions)
    expect(await mapState(f)).toEqual(before)
    await assertPrivateMap(f)
  })
})

describe('Learn V2 revision-safe map editing and calibration', () => {
  test.each([false, true])('map acceptance cleanly rejects a missing or legacy stored contract with legacy=%s while the projection remains editable', async legacy => {
    const f = await setupMap()
    await f.t.mutation(internal.learnV2Retention.purgeLegacyObjectiveCopies, { userId: identity.tokenIdentifier,
      sourceSnapshotId: f.sourceSnapshotId, objectiveId: f.objectives[0]! })
    if (legacy) await f.t.run(ctx => ctx.db.patch(f.objectives[0]!, { assessmentContract: 'Legacy rubric cache' }))
    expect((await f.owner.query(api.learnV2Journey.getMission, { learningVoidId: f.learningVoid._id }))?.map?.objectives[0]).not.toHaveProperty('assessmentContract')
    await expect(f.owner.mutation(api.learnV2MapCalibration.acceptBlueprintMap, { blueprintRevisionId: f.blueprint._id,
      expectedRecordRevision: 1, expectedVoidRevision: 2, idempotencyKey: 'missing-contract' })).rejects.toMatchObject({ data: { status: 'rejected', reasonCode: 'assessment_contract_unavailable' } })
  })

  test('map receipt replay recognizes the purged fingerprint without restoring the request', async () => {
    vi.useFakeTimers()
    try {
      const f = await setupMap()
      await f.t.run(ctx => ctx.db.patch(f.blueprint._id, { status: 'draft' }))
      const args = { blueprintRevisionId: f.blueprint._id, expectedRecordRevision: 1, expectedVoidRevision: 2,
        idempotencyKey: 'replay-edited-map', candidate: editedCandidate(f.sourceSnapshotId) }
      const original = await f.owner.mutation(api.learnV2MapCalibration.replaceDraftMap, args)
      const source = (await f.t.run(ctx => ctx.db.get(f.sourceSnapshotId)))!
      await f.t.mutation(internal.learnV2Retention.purgeSourceEvidence, { userId: identity.tokenIdentifier, sourceIdentityId: source.sourceIdentityId })
      await f.t.finishAllScheduledFunctions(vi.runAllTimers)
      expect(await f.owner.mutation(api.learnV2MapCalibration.replaceDraftMap, args)).toEqual(original)
      await expect(f.owner.mutation(api.learnV2MapCalibration.replaceDraftMap, { ...args, expectedRecordRevision: 3 })).rejects.toThrow('Idempotency key was already used for a different request')
    }
    finally { vi.useRealTimers() }
  })

  test('folder purge skips gap contracts and keeps missing supported contracts editable without republishing them', async () => {
    vi.useFakeTimers()
    try {
      const f = await setupMap()
      const documentId = await f.t.run(async ctx => {
        const aggregate = (await ctx.db.get(f.learningVoid._id))!
        const documentId = await ctx.db.insert('documents', { userId: identity.tokenIdentifier, folderId: aggregate.folderId,
          filename: 'map-backing.txt', fileSize: 1, status: 'success' })
        const snapshot = (await ctx.db.get(f.sourceSnapshotId))!
        await ctx.db.patch(snapshot.sourceIdentityId, { origin: 'folder_document', folderDocumentId: documentId })
        await ctx.db.patch(snapshot._id, { rightsStatus: 'unknown' })
        const excerpt = await ctx.db.query('learnSourceExcerpts').withIndex('by_userId_and_sourceSnapshotId', q => q.eq('userId', identity.tokenIdentifier).eq('sourceSnapshotId', snapshot._id)).unique()
        await ctx.db.delete(excerpt!._id)
        const link = await ctx.db.query('learnObjectiveSources').withIndex('by_userId_and_objectiveId_and_sourceSnapshotId', q => q.eq('userId', identity.tokenIdentifier).eq('objectiveId', f.objectives[0]!).eq('sourceSnapshotId', snapshot._id)).unique()
        await ctx.db.patch(link!._id, { coverage: 'gap' })
        await ctx.db.patch(f.objectives[0]!, { coverage: 'gap', gapReason: 'This source does not support the objective.' })
        return documentId
      })
      expect((await f.owner.query(api.learnV2Journey.getMission, { learningVoidId: f.learningVoid._id }))?.map?.objectives[1]).not.toHaveProperty('assessmentContract')
      await f.owner.mutation(api.documents.deleteDocument, { id: documentId })
      await f.t.finishAllScheduledFunctions(vi.runAllTimers)
      expect((await f.t.run(ctx => ctx.db.get(f.objectives[0]!)))?.assessmentContract).toEqual(assessment)
      expect((await f.t.run(ctx => ctx.db.get(f.objectives[1]!)))?.assessmentContract).toBeUndefined()
      const mission = await f.owner.query(api.learnV2Journey.getMission, { learningVoidId: f.learningVoid._id })
      expect(mission?.map?.objectives[1]).not.toHaveProperty('assessmentContract')
      await expect(f.owner.mutation(api.learnV2MapCalibration.acceptBlueprintMap, { blueprintRevisionId: f.blueprint._id,
        expectedRecordRevision: 1, expectedVoidRevision: 2, idempotencyKey: 'reject-missing-contract' })).rejects.toThrow('Blueprint objective evidence is unavailable')
    }
    finally { vi.useRealTimers() }
  })

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
      expect(await setup.t.run(ctx => ctx.db.get(attempt.attemptId))).toMatchObject({
        masteryStateBefore: 'unseen',
        masteryStateAfter: 'provisionally_known',
        masteryTransitionReason: 'calibration_provisional',
        masteryTransitionVersion: 'learn-v2.mastery-transition.v1',
        masteryRecordRevision: 1,
      })
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

  test('fails closed when calibration evidence revisions drift after scorer input is pinned', async () => {
    const previousModel = process.env.LEARN_V2_CALIBRATION_MODEL
    process.env.LEARN_V2_CALIBRATION_MODEL = 'mock-calibration'
    try {
      const setup = await setupMap()
      const accepted = await setup.owner.mutation(api.learnV2MapCalibration.acceptBlueprintMap, { blueprintRevisionId: setup.blueprint._id, expectedRecordRevision: 1, expectedVoidRevision: 2, idempotencyKey: 'drift-accept' })
      const request = { tokenIdentifier: identity.tokenIdentifier, blueprintRevisionId: setup.blueprint._id, objectiveId: setup.objectives[0]!, expectedBlueprintRecordRevision: accepted.recordRevision, expectedVoidRevision: 3, response: 'Pinned response.', confidence: 4, usedHint: false, usedReveal: false, idempotencyKey: 'drift-calibration' }
      const reservation = await setup.t.mutation(internal.learnV2MapCalibration.reserveCalibrationScoring, request)
      expect(reservation.kind).toBe('acquired')
      if (reservation.kind !== 'acquired') throw new Error('Expected calibration scoring lease')
      await setup.t.mutation(internal.learnV2MapCalibration.markCalibrationScoringDispatched, { tokenIdentifier: identity.tokenIdentifier, jobId: reservation.jobId, leaseToken: reservation.leaseToken, expectedRevision: reservation.revision })
      const input = await setup.t.query(internal.learnV2MapCalibration.getCalibrationScoringInput, { tokenIdentifier: identity.tokenIdentifier, jobId: reservation.jobId, leaseToken: reservation.leaseToken, blueprintRevisionId: setup.blueprint._id, objectiveId: setup.objectives[0]!, response: request.response })
      await setup.t.run(async (ctx) => {
        const excerpt = await ctx.db.query('learnSourceExcerpts').withIndex('by_userId_and_sourceSnapshotId', q => q.eq('userId', identity.tokenIdentifier).eq('sourceSnapshotId', setup.sourceSnapshotId)).unique()
        await ctx.db.patch(excerpt!._id, { excerpt: 'Mutated evidence after dispatch.' })
      })
      await expect(setup.t.mutation(internal.learnV2MapCalibration.recordCalibrationAttempt, {
        ...request,
        serverScorePercent: 100,
        rubricVersion: 'learn-v2.assessment.v1',
        scoringJobId: reservation.jobId,
        scoringLeaseToken: reservation.leaseToken,
        scoredSourceSnapshotIds: input.sourceSnapshotIds,
        scoredContentRevisionPins: input.contentRevisionPins,
        scoredVerifierVersions: input.verifierVersions,
      })).rejects.toThrow(/evidence pins no longer match/i)
    }
    finally {
      if (previousModel === undefined) delete process.env.LEARN_V2_CALIBRATION_MODEL
      else process.env.LEARN_V2_CALIBRATION_MODEL = previousModel
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
        const documentId = await ctx.db.insert('documents', { userId: identity.tokenIdentifier, folderId: learningVoid!.folderId, filename: 'folder-evidence.pdf', status: 'success', contentHash: 'a'.repeat(64), sourceRevision: `sha256:${'a'.repeat(64)}`, fileSize: 100, r2Key: 'owners/map/folder-evidence.pdf' })
        await ctx.db.patch(source!.sourceIdentityId, { origin: 'folder_document', externalKey: `document:${documentId}`, canonicalUrl: undefined, folderDocumentId: documentId })
        await ctx.db.patch(source!._id, { rightsStatus: 'unknown', objectKey: 'owners/map/folder-evidence.pdf', contentHash: 'a'.repeat(64), sourceRevision: `sha256:${'a'.repeat(64)}` })
        await ctx.db.patch(excerpt!._id, { rightsStatus: 'unknown', locator: `sha256:${'a'.repeat(64)}`, excerpt: undefined })
      })
      const accepted = await setup.owner.mutation(api.learnV2MapCalibration.acceptBlueprintMap, { blueprintRevisionId: setup.blueprint._id, expectedRecordRevision: 1, expectedVoidRevision: 2, idempotencyKey: 'public-accept' })
      const args = { blueprintRevisionId: setup.blueprint._id, objectiveId: setup.objectives[0]!, expectedBlueprintRecordRevision: accepted.recordRevision, expectedVoidRevision: 3, response: 'The supported answer.', confidence: 4, idempotencyKey: 'public-calibration-1' }
      await expect(setup.owner.action(api.learnV2MapCalibration.submitCalibrationAttempt, { ...args, objectiveId: setup.objectives[1]!, idempotencyKey: 'spoofed-calibration-assistance', usedHint: false, usedReveal: false } as never)).rejects.toThrow()
      const scored = await setup.owner.action(api.learnV2MapCalibration.submitCalibrationAttempt, args)
      expect(scored).toMatchObject({ result: 'provisionally_known', replayed: false })
      expect(await setup.owner.action(api.learnV2MapCalibration.submitCalibrationAttempt, args)).toMatchObject({ result: 'provisionally_known', replayed: true })
      const persistedAttempt = await setup.t.run(ctx => ctx.db.query('masteryAttempts').withIndex('by_userId_and_idempotencyKey', q => q.eq('userId', identity.tokenIdentifier).eq('idempotencyKey', args.idempotencyKey)).unique())
      expect(persistedAttempt).toMatchObject({
        response: args.response,
        activityContractVersion: 'learn-v2.calibration-attempt.v1',
        providerVersion: 'openrouter-via-cloudflare-ai-gateway.v1',
        blueprintRecordRevision: accepted.recordRevision,
        scorerModel: 'mock-calibration',
        scorerVersion: 'learn-v2.calibration-scorer.v1',
        verifierVersionsJson: JSON.stringify(['learn-v2.calibration-evidence-policy.v1']),
        sourceSnapshotIdsJson: JSON.stringify([setup.sourceSnapshotId]),
      })
      expect(JSON.parse(persistedAttempt!.contentRevisionPinsJson!)).toMatchObject([{ sourceSnapshotId: String(setup.sourceSnapshotId), sourceExcerptId: expect.any(String), locator: `sha256:${'a'.repeat(64)}`, revision: 1, recordRevision: 1, sourceRevision: `sha256:${'a'.repeat(64)}`, evidenceContentHash: 'a'.repeat(64) }])
    }
    finally {
      if (previousModel === undefined) delete process.env.LEARN_V2_CALIBRATION_MODEL
      else process.env.LEARN_V2_CALIBRATION_MODEL = previousModel
    }
  })
})
