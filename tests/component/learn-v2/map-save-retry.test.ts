import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref, shallowRef } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { getFunctionName } from 'convex/server'
import { ConvexError } from 'convex/values'
import LearningTrail from '~/components/learn-v2/LearningTrail.vue'
import { useLearnV2Journey } from '~/composables/useLearnV2Journey'

const mission = shallowRef<Record<string, unknown> | null>(null)
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

describe('Learner map save retry', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    mission.value = null
  })

  it('reuses the draft left by a failed save after Reload and keep my changes', async () => {
    mission.value = missionAt({ _id: 'blueprint_1', status: 'map_review', recordRevision: 2 }, 3)
    forkBlueprintDraft.mockResolvedValue({ _id: 'blueprint_2', status: 'draft', revision: 2, recordRevision: 1 })
    replaceDraftMap.mockResolvedValue({ _id: 'blueprint_2', status: 'map_review', revision: 2, recordRevision: 2 })
    const wrapper = await mountSuspended(Harness, { attachTo: document.body })

    await wrapper.get('[data-testid="learn-v2-map-select-objective-1"]').trigger('click')
    await wrapper.get('[data-testid="learn-v2-objective-title"]').setValue('Recognise cancellation')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await wrapper.get('[data-testid="learn-v2-save-objective"]').trigger('click')
    await vi.advanceTimersByTimeAsync(5_000)
    await flushPromises()
    vi.useRealTimers()
    expect(wrapper.get('[data-testid="learn-v2-map-save-error"]').text()).toContain('The map changed somewhere else')
    expect(forkBlueprintDraft).toHaveBeenCalledTimes(1)
    expect(replaceDraftMap).not.toHaveBeenCalled()

    mission.value = missionAt({ _id: 'blueprint_2', status: 'draft', recordRevision: 1 }, 4)
    await flushPromises()
    await wrapper.get('[data-testid="learn-v2-map-reload"]').trigger('click')
    await wrapper.get('[data-testid="learn-v2-save-objective"]').trigger('click')
    await flushPromises()

    expect(forkBlueprintDraft).toHaveBeenCalledTimes(1)
    expect(replaceDraftMap).toHaveBeenCalledTimes(1)
    const [args] = replaceDraftMap.mock.calls[0]!
    expect(args).toMatchObject({ blueprintRevisionId: 'blueprint_2', expectedRecordRevision: 1, expectedVoidRevision: 4 })
    expect(args.candidate.objectives).toHaveLength(6)
    expect(args.candidate.objectives[0]).toMatchObject({ key: 'objective-1', title: 'Recognise cancellation', sourceSnapshotIds: ['blueprint_2-snapshot'] })
    expect(wrapper.find('[data-testid="learn-v2-map-save-error"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('reuses the draft when Save is retried after the map write fails', async () => {
    mission.value = missionAt({ _id: 'blueprint_1', status: 'map_review', recordRevision: 2 }, 3)
    forkBlueprintDraft.mockImplementation(async () => {
      mission.value = missionAt({ _id: 'blueprint_2', status: 'draft', recordRevision: 1 }, 4)
      return { _id: 'blueprint_2', status: 'draft', revision: 2, recordRevision: 1 }
    })
    replaceDraftMap.mockRejectedValueOnce(new ConvexError({ reasonCode: 'network' })).mockResolvedValueOnce({ _id: 'blueprint_2', status: 'map_review', revision: 2, recordRevision: 2 })
    const wrapper = await mountSuspended(Harness, { attachTo: document.body })

    await wrapper.get('[data-testid="learn-v2-map-select-objective-1"]').trigger('click')
    await wrapper.get('[data-testid="learn-v2-objective-title"]').setValue('Recognise cancellation')
    await wrapper.get('[data-testid="learn-v2-save-objective"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="learn-v2-map-save-error"]').text()).toContain('Couldn’t save objective 1')

    await wrapper.get('[data-testid="learn-v2-save-objective"]').trigger('click')
    await flushPromises()
    expect(forkBlueprintDraft).toHaveBeenCalledTimes(1)
    expect(replaceDraftMap.mock.calls.map(([args]) => args.blueprintRevisionId)).toEqual(['blueprint_2', 'blueprint_2'])
    wrapper.unmount()
  })
})
