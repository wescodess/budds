import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref, shallowRef } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { getFunctionName } from 'convex/server'
import { ConvexError } from 'convex/values'
import { convexTest } from 'convex-test'
import LearningTrail from '~/components/learn-v2/LearningTrail.vue'
import { useLearnV2Journey } from '~/composables/useLearnV2Journey'
import { api, internal } from '~~/convex/_generated/api'
import schema from '~~/convex/schema'

const mission = shallowRef<Record<string, any> | null>(null)
const forkBlueprintDraft = vi.fn()
const replaceDraftMap = vi.fn()

mockNuxtImport('useLearnV2Access', () => () => ({ allowed: ref(true), checkingAccess: ref(false) }))
mockNuxtImport('useConvexQuery', () => () => ({ data: ref(null), pending: ref(false) }))
mockNuxtImport('useConvexAction', () => () => ({ mutate: vi.fn() }))
mockNuxtImport('useConvexMutation', () => (reference: never) => {
  const name = getFunctionName(reference)
  return { mutate: name === 'learnV2Lifecycle:forkBlueprintDraft' ? forkBlueprintDraft : name === 'learnV2MapCalibration:replaceDraftMap' ? replaceDraftMap : vi.fn() }
})
vi.mock('~/composables/useTeachingQuery', () => ({
  useTeachingQuery: (reference: never) => ({
    data: getFunctionName(reference) === 'learnV2Journey:getMission' ? mission : ref(null),
    pending: ref(false),
    failure: ref(null),
    refresh: async () => {},
  }),
}))

function missionAt(blueprint: { _id: string; status: string; recordRevision: number }, voidRevision: number) {
  const prefix = blueprint._id
  return {
    learningVoid: { _id: 'void_1', status: 'map_review', revision: voidRevision },
    currentBlueprint: { ...blueprint, desiredDepth: 'working' },
    map: {
      milestones: [0, 1, 2].map(order => ({ _id: `${prefix}-milestone-${order}`, stableKey: `milestone-${order + 1}`, order, title: `Milestone ${order + 1}` })),
      objectives: Array.from({ length: 6 }, (_, order) => ({
        _id: `${prefix}-objective-${order}`, stableKey: `objective-${order + 1}`, milestoneId: `${prefix}-milestone-${Math.floor(order / 2)}`, order,
        title: `Objective ${order + 1}`, capability: `Capability ${order + 1}`, estimatedMinutes: 25, depth: 'working', coverage: 'strong',
        sourceLinks: [{ sourceSnapshotId: `${prefix}-snapshot`, coverage: 'strong' }], prerequisiteObjectiveIds: [],
      })),
    },
    sources: { items: [{ _id: `${prefix}-snapshot`, identity: { _id: 'identity-1', title: 'AbortController guide', origin: 'folder_document' }, status: 'user_accepted', effectiveStatus: 'user_accepted' }], counts: { accepted: 1 } },
  }
}

const Harness = defineComponent({
  setup() {
    const journey = useLearnV2Journey('void_1')
    return () => h(LearningTrail, { objectives: journey.objectives.value, sources: journey.sources.value, busy: journey.busy.value, save: journey.editLearningMap })
  },
})

const identity = { tokenIdentifier: 'https://auth.example.com|map-owner', name: 'Map Owner' }
const assessment = { version: 'learn-v2.assessment.v1' as const, kind: 'machine_checkable' as const, responseFormat: 'short_text' as const, instructions: 'Give the supported answer.', passingScorePercent: 80 as const, criteria: [{ key: 'correct', description: 'The answer is correct.', weightPercent: 100 }] }

async function serverMap() {
  const t = convexTest(schema, import.meta.glob('/convex/**/*.ts'))
  const owner = t.withIdentity(identity)
  await owner.mutation(api.users.upsertUser, {})
  await t.mutation(internal.learnV2Access.setCohortEntitlement, { tokenIdentifier: identity.tokenIdentifier, enabled: true })
  const folderId = await owner.mutation(api.folders.createFolder, { name: 'Map sources' })
  const learningVoid = (await owner.mutation(api.learnV2Lifecycle.createLearningVoid, { folderId, title: 'Editable map', idempotencyKey: 'map-void' }))!
  const blueprint = (await owner.mutation(api.learnV2Lifecycle.createBlueprintDraft, { learningVoidId: learningVoid._id, expectedVoidRevision: 1, idempotencyKey: 'map-blueprint' }))!
  await t.run(async (ctx) => {
    await ctx.db.patch(learningVoid._id, { status: 'map_review' })
    await ctx.db.patch(blueprint._id, { status: 'map_review' })
    const sourceIdentityId = await ctx.db.insert('learnSourceIdentities', { userId: identity.tokenIdentifier, learningVoidId: learningVoid._id, origin: 'user_url', externalKey: 'https://example.com/source', canonicalUrl: 'https://example.com/source' })
    const sourceSnapshotId = await ctx.db.insert('learnSourceSnapshots', { userId: identity.tokenIdentifier, sourceIdentityId, learningVoidId: learningVoid._id, blueprintRevisionId: blueprint._id, revision: 1, recordRevision: 1, status: 'user_accepted', effectiveStatus: 'user_accepted', rightsStatus: 'permitted', conflictStatus: 'clear', createdAt: Date.now() })
    await ctx.db.insert('learnSourceExcerpts', { userId: identity.tokenIdentifier, sourceSnapshotId, locator: 'paragraph:1', excerpt: 'Supported evidence.', rightsStatus: 'permitted' })
    const milestones = []
    for (let index = 0; index < 3; index++) milestones.push(await ctx.db.insert('learnMilestones', { userId: identity.tokenIdentifier, blueprintRevisionId: blueprint._id, stableKey: `milestone-${index + 1}`, order: index, title: `Milestone ${index + 1}` }))
    for (let index = 0; index < 6; index++) {
      const objectiveId = await ctx.db.insert('learnObjectives', { userId: identity.tokenIdentifier, blueprintRevisionId: blueprint._id, stableKey: `objective-${index + 1}`, milestoneId: milestones[Math.floor(index / 2)]!, order: index, title: `Objective ${index + 1}`, capability: `Capability ${index + 1}`, estimatedMinutes: 25, coverage: 'strong', assessmentContract: assessment })
      await ctx.db.insert('learnObjectiveSources', { userId: identity.tokenIdentifier, objectiveId, sourceSnapshotId, coverage: 'strong' })
    }
  })
  const read = async () => (await owner.query(api.learnV2Journey.getMission, { learningVoidId: learningVoid._id }))!
  return { owner, read }
}

function candidateOf(row: any) {
  const milestoneKeys = new Map(row.map.milestones.map((item: any) => [item._id, item.stableKey]))
  const objectiveKeys = new Map(row.map.objectives.map((item: any) => [item._id, item.stableKey]))
  return {
    version: 'learn-v2.blueprint-candidate.v1' as const, generatorVersion: 'other-session',
    milestones: row.map.milestones.map((item: any) => ({ key: item.stableKey, order: item.order, title: item.title })),
    objectives: row.map.objectives.map((item: any) => ({
      key: item.stableKey, milestoneKey: milestoneKeys.get(item.milestoneId), order: item.order, title: item.title, capability: item.capability,
      estimatedMinutes: item.estimatedMinutes, coverage: item.storedCoverage ?? item.coverage, gapReason: item.gapReason,
      sourceSnapshotIds: item.sourceLinks.filter((link: any) => link.coverage !== 'gap').map((link: any) => link.sourceSnapshotId),
      gapSourceSnapshotIds: item.sourceLinks.filter((link: any) => link.coverage === 'gap').map((link: any) => link.sourceSnapshotId),
      prerequisiteObjectiveKeys: item.prerequisiteObjectiveIds.map((id: any) => objectiveKeys.get(id)),
    })),
  }
}

const forkArgs = (row: any, idempotencyKey: string) => ({ blueprintRevisionId: row.currentBlueprint._id, expectedRecordRevision: row.currentBlueprint.recordRevision, expectedVoidRevision: row.learningVoid.revision, idempotencyKey })

async function editTitle(wrapper: Awaited<ReturnType<typeof mountSuspended>>) {
  await wrapper.get('[data-testid="learn-v2-map-select-objective-1"]').trigger('click')
  await wrapper.get('[data-testid="learn-v2-objective-title"]').setValue('Recognise cancellation')
}

describe('Learner map save retry', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    mission.value = null
  })

  it('forks again after Reload and keep my changes and saves the whole map', async () => {
    mission.value = missionAt({ _id: 'blueprint_1', status: 'map_review', recordRevision: 2 }, 3)
    forkBlueprintDraft.mockResolvedValueOnce({ _id: 'blueprint_2', status: 'draft', revision: 2, recordRevision: 1 }).mockImplementationOnce(async () => {
      mission.value = missionAt({ _id: 'blueprint_3', status: 'draft', recordRevision: 1 }, 5)
      return { _id: 'blueprint_3', status: 'draft', revision: 3, recordRevision: 1 }
    })
    replaceDraftMap.mockResolvedValue({ _id: 'blueprint_3', status: 'map_review', revision: 3, recordRevision: 2 })
    const wrapper = await mountSuspended(Harness, { attachTo: document.body, route: '/login' })

    await editTitle(wrapper)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await wrapper.get('[data-testid="learn-v2-save-objective"]').trigger('click')
    await vi.advanceTimersByTimeAsync(5_000)
    await flushPromises()
    vi.useRealTimers()
    expect(wrapper.get('[data-testid="learn-v2-map-save-error"]').text()).toContain('The map changed somewhere else')
    expect(replaceDraftMap).not.toHaveBeenCalled()

    mission.value = missionAt({ _id: 'blueprint_2', status: 'draft', recordRevision: 1 }, 4)
    await flushPromises()
    await wrapper.get('[data-testid="learn-v2-map-reload"]').trigger('click')
    await wrapper.get('[data-testid="learn-v2-save-objective"]').trigger('click')
    await flushPromises()

    expect(forkBlueprintDraft.mock.calls.map(([args]) => args.blueprintRevisionId)).toEqual(['blueprint_1', 'blueprint_2'])
    expect(replaceDraftMap).toHaveBeenCalledTimes(1)
    const [args] = replaceDraftMap.mock.calls[0]!
    expect(args).toMatchObject({ blueprintRevisionId: 'blueprint_3', expectedRecordRevision: 1, expectedVoidRevision: 5 })
    expect(args.candidate.objectives).toHaveLength(6)
    expect(args.candidate.objectives[0]).toMatchObject({ key: 'objective-1', title: 'Recognise cancellation', sourceSnapshotIds: ['blueprint_3-snapshot'] })
    expect(wrapper.find('[data-testid="learn-v2-map-save-error"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('forks again when Save is retried after the map write fails', async () => {
    mission.value = missionAt({ _id: 'blueprint_1', status: 'map_review', recordRevision: 2 }, 3)
    let ordinal = 1
    forkBlueprintDraft.mockImplementation(async () => {
      ordinal++
      mission.value = missionAt({ _id: `blueprint_${ordinal}`, status: 'draft', recordRevision: 1 }, ordinal + 2)
      return { _id: `blueprint_${ordinal}`, status: 'draft', revision: ordinal, recordRevision: 1 }
    })
    replaceDraftMap.mockRejectedValueOnce(new ConvexError({ reasonCode: 'network' })).mockResolvedValueOnce({ _id: 'blueprint_3', status: 'map_review', revision: 3, recordRevision: 2 })
    const wrapper = await mountSuspended(Harness, { attachTo: document.body, route: '/login' })

    await editTitle(wrapper)
    await wrapper.get('[data-testid="learn-v2-save-objective"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="learn-v2-map-save-error"]').text()).toContain('Couldn’t save objective 1')

    await wrapper.get('[data-testid="learn-v2-save-objective"]').trigger('click')
    await flushPromises()
    expect(forkBlueprintDraft.mock.calls.map(([args]) => args.blueprintRevisionId)).toEqual(['blueprint_1', 'blueprint_2'])
    expect(replaceDraftMap.mock.calls.map(([args]) => [args.blueprintRevisionId, args.candidate.objectives.length])).toEqual([['blueprint_2', 6], ['blueprint_3', 6]])
    wrapper.unmount()
  })

  it('never writes a retry into a newer draft another session opened', async () => {
    vi.stubEnv('LEARN_V2_ENABLED', 'true')
    vi.stubEnv('NUXT_BETTER_AUTH_SECRET', 'map-save-retry')
    const { owner, read } = await serverMap()
    mission.value = await read()
    forkBlueprintDraft.mockImplementation(async (args) => {
      const result = await owner.mutation(api.learnV2Lifecycle.forkBlueprintDraft, args)
      mission.value = await read()
      return result
    })
    let rejectFirst = true
    replaceDraftMap.mockImplementation(async (args) => {
      const command = rejectFirst ? { ...args, candidate: { ...args.candidate, objectives: args.candidate.objectives.slice(0, 5) } } : args
      rejectFirst = false
      const result = await owner.mutation(api.learnV2MapCalibration.replaceDraftMap, command)
      mission.value = await read()
      return result
    })
    const wrapper = await mountSuspended(Harness, { attachTo: document.body, route: '/login' })

    await editTitle(wrapper)
    await wrapper.get('[data-testid="learn-v2-save-objective"]').trigger('click')
    await vi.waitFor(() => expect(wrapper.text()).toContain('Couldn’t save objective 1'))

    await owner.mutation(api.learnV2Lifecycle.forkBlueprintDraft, forkArgs(await read(), 'other-fork'))
    const other = await read()
    const otherCandidate = candidateOf(other)
    otherCandidate.objectives[0].capability = 'Newer capability from another session'
    await owner.mutation(api.learnV2MapCalibration.replaceDraftMap, { ...forkArgs(other, 'other-save'), candidate: otherCandidate })
    await owner.mutation(api.learnV2Lifecycle.forkBlueprintDraft, forkArgs(await read(), 'other-next-fork'))
    const newer = await read()
    mission.value = newer
    await flushPromises()

    await wrapper.get('[data-testid="learn-v2-save-objective"]').trigger('click')
    await vi.waitFor(() => expect(mission.value?.currentBlueprint.status).toBe('map_review'))
    const after = await read()
    expect(String(after.currentBlueprint._id)).not.toBe(String(newer.currentBlueprint._id))
    expect(after.map!.objectives).toHaveLength(6)
    expect(after.map!.objectives[0]).toMatchObject({ title: 'Recognise cancellation' })
    const untouched = await owner.query(api.learnV2Blueprints.getBlueprintMap, { blueprintRevisionId: newer.currentBlueprint._id })
    expect(untouched?.objectives).toHaveLength(6)
    expect(untouched?.objectives[0]).toMatchObject({ title: 'Objective 1', capability: 'Newer capability from another session' })
    wrapper.unmount()
  }, 30_000)
})
