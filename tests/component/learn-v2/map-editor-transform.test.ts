import { describe, expect, it } from 'vitest'
import { reactive } from 'vue'
import { ConvexError } from 'convex/values'
import { applyLearnMapEdit, isLearnMapChangedError, LearnMapChangedError, type LearnMapCandidate } from '../../../app/utils/learn-v2-map-editor'

function candidate(): LearnMapCandidate {
  return {
    version: 'learn-v2.blueprint-candidate.v1',
    generatorVersion: 'test',
    milestones: [0, 1, 2].map(order => ({ key: `milestone-${order + 1}`, order, title: `Milestone ${order + 1}` })),
    objectives: Array.from({ length: 6 }, (_, order) => ({ key: `objective-${order + 1}`, milestoneKey: `milestone-${Math.floor(order / 2) + 1}`, order, title: `Objective ${order + 1}`, capability: `Capability ${order + 1}`, estimatedMinutes: 20, depth: 'working' as const, coverage: 'strong' as const, sourceSnapshotIds: ['snapshot-1'], gapSourceSnapshotIds: [], prerequisiteObjectiveKeys: order ? [`objective-${order}`] : [] })),
  }
}

describe('Learning map revision transform', () => {
  it('accepts the reactive map projection used by the production workspace', () => {
    const edited = applyLearnMapEdit(reactive(candidate()), { kind: 'move_objective', objectiveKey: 'objective-2', direction: 'up' }, {})
    expect(edited.objectives[0]?.key).toBe('objective-2')
  })

  it('reorders without changing objective identity or prerequisite identity', () => {
    const edited = applyLearnMapEdit(candidate(), { kind: 'move_objective', objectiveKey: 'objective-2', direction: 'up' }, {})
    expect(edited.objectives.map(objective => objective.key)).toEqual(['objective-2', 'objective-1', 'objective-3', 'objective-4', 'objective-5', 'objective-6'])
    expect(edited.objectives.find(objective => objective.key === 'objective-3')?.prerequisiteObjectiveKeys).toEqual(['objective-2'])
  })

  it('splits an objective and retargets dependants to the second capability', () => {
    const edited = applyLearnMapEdit(candidate(), { kind: 'split_objective', objectiveKey: 'objective-2', firstTitle: 'Recognize cancellation', secondTitle: 'Apply cancellation' }, {}, () => 'learner-split')
    expect(edited.objectives.slice(1, 3).map(objective => [objective.key, objective.title])).toEqual([['objective-2', 'Recognize cancellation'], ['learner-split', 'Apply cancellation']])
    expect(edited.objectives.find(objective => objective.key === 'learner-split')?.prerequisiteObjectiveKeys).toEqual(['objective-2'])
    expect(edited.objectives.find(objective => objective.key === 'objective-3')?.prerequisiteObjectiveKeys).toEqual(['learner-split'])
    expect(edited.objectives.find(objective => objective.key === 'learner-split')?.splitFromObjectiveKey).toBe('objective-2')
    expect(edited.objectives.find(objective => objective.key === 'objective-2')).not.toHaveProperty('splitFromObjectiveKey')
  })

  it('persists edited depth, evidence links and prerequisites without any assessment fields', () => {
    const edited = applyLearnMapEdit(candidate(), { kind: 'save_objective', objective: { objectiveKey: 'objective-2', title: 'Apply cancellation safely', capability: 'Choose and justify a cancellation boundary.', milestoneKey: 'milestone-1', effortMinutes: 45, depth: 'advanced', coverage: 'partial', gapReason: 'Needs a server-runtime source.', supportingSourceKeys: ['source-a'], gapSourceKeys: ['source-b'], prerequisiteKeys: ['objective-1'] } }, { 'source-a': 'snapshot-a', 'source-b': 'snapshot-b' })
    expect(edited.objectives[1]).toMatchObject({ key: 'objective-2', depth: 'advanced', coverage: 'partial', sourceSnapshotIds: ['snapshot-a'], gapSourceSnapshotIds: ['snapshot-b'], prerequisiteObjectiveKeys: ['objective-1'] })
    expect(JSON.stringify(edited)).not.toMatch(/assessment|criteri|rubric|weight/i)
  })

  it('applies a held reorder and milestone change in the same save', () => {
    const order = ['objective-1', 'objective-3', 'objective-2', 'objective-4', 'objective-5', 'objective-6']
    const objective = { objectiveKey: 'objective-3', title: 'Objective 3', capability: 'Capability 3', milestoneKey: 'milestone-1', effortMinutes: 20, depth: 'working' as const, coverage: 'strong' as const, supportingSourceKeys: ['source-a'], gapSourceKeys: [], prerequisiteKeys: ['objective-1'] }
    const edited = applyLearnMapEdit(candidate(), { kind: 'save_objective', objective, order }, { 'source-a': 'snapshot-a' })
    expect(edited.objectives.map(item => [item.key, item.milestoneKey, item.order])).toEqual([
      ['objective-1', 'milestone-1', 0], ['objective-3', 'milestone-1', 1], ['objective-2', 'milestone-1', 2],
      ['objective-4', 'milestone-2', 3], ['objective-5', 'milestone-3', 4], ['objective-6', 'milestone-3', 5],
    ])
  })

  it('applies a held split in the same save as the other changes', () => {
    const objective = { objectiveKey: 'objective-2', title: 'Recognise cancellation', capability: 'Capability 2', milestoneKey: 'milestone-1', effortMinutes: 30, depth: 'working' as const, coverage: 'strong' as const, supportingSourceKeys: ['source-a'], gapSourceKeys: [], prerequisiteKeys: ['objective-1'] }
    const order = ['objective-2', 'objective-1', 'objective-3', 'objective-4', 'objective-5', 'objective-6']
    const edited = applyLearnMapEdit(candidate(), { kind: 'save_objective', objective, order, split: { secondTitle: 'Recognise cancellation: apply' } }, { 'source-a': 'snapshot-a' }, () => 'learner-split')
    expect(edited.objectives.map(item => [item.key, item.title, item.estimatedMinutes, item.splitFromObjectiveKey])).toEqual([
      ['objective-2', 'Recognise cancellation', 15, undefined], ['learner-split', 'Recognise cancellation: apply', 15, 'objective-2'],
      ['objective-1', 'Objective 1', 20, undefined], ['objective-3', 'Objective 3', 20, undefined], ['objective-4', 'Objective 4', 20, undefined],
      ['objective-5', 'Objective 5', 20, undefined], ['objective-6', 'Objective 6', 20, undefined],
    ])
    expect(edited.objectives.find(item => item.key === 'objective-3')?.prerequisiteObjectiveKeys).toEqual(['learner-split'])
  })

  it('marks a map that changed under the edit as changed elsewhere', () => {
    expect(() => applyLearnMapEdit(candidate(), { kind: 'remove_objective', objectiveKey: 'objective-9' }, {})).toThrow(LearnMapChangedError)
    expect(isLearnMapChangedError(new ConvexError({ version: 'learn-v2.map-edit.v1', status: 'rejected', reasonCode: 'revision_conflict' }))).toBe(true)
    expect(isLearnMapChangedError(new ConvexError({ version: 'learn-v2.map-edit.v1', status: 'rejected', reasonCode: 'invalid_split_parent' }))).toBe(false)
    expect(isLearnMapChangedError(new Error('Blueprint revision conflict'))).toBe(false)
  })

  it('rejects a held order that no longer matches the map', () => {
    const objective = { objectiveKey: 'objective-1', title: 'Objective 1', capability: 'Capability 1', milestoneKey: 'milestone-1', effortMinutes: 20, depth: 'working' as const, coverage: 'strong' as const, supportingSourceKeys: ['source-a'], gapSourceKeys: [], prerequisiteKeys: [] }
    expect(() => applyLearnMapEdit(candidate(), { kind: 'save_objective', objective, order: ['objective-1', 'objective-2'] }, { 'source-a': 'snapshot-a' })).toThrow(/no longer in this map/)
  })

  it('adds a new objective at the end of its milestone without a split marker', () => {
    const map = candidate()
    map.objectives[1]!.splitFromObjectiveKey = 'objective-1'
    const objective = { title: 'Compare signals', capability: 'Compare abort signals.', milestoneKey: 'milestone-1', effortMinutes: 25, depth: 'working' as const, coverage: 'strong' as const, supportingSourceKeys: ['source-a'], gapSourceKeys: [], prerequisiteKeys: ['objective-2'] }
    const edited = applyLearnMapEdit(map, { kind: 'save_objective', objective }, { 'source-a': 'snapshot-a' }, () => 'learner-new')
    expect(edited.objectives.map(item => item.key).slice(0, 4)).toEqual(['objective-1', 'objective-2', 'learner-new', 'objective-3'])
    expect(edited.objectives[2]).not.toHaveProperty('splitFromObjectiveKey')
  })

  it('rejects removal that would leave a milestone empty', () => {
    const map = candidate()
    map.objectives[4]!.milestoneKey = 'milestone-2'
    map.objectives.push({ ...structuredClone(map.objectives[4]!), key: 'objective-7', order: 6, prerequisiteObjectiveKeys: ['objective-5'] })
    expect(() => applyLearnMapEdit(map, { kind: 'remove_objective', objectiveKey: 'objective-6' }, {})).toThrow(/at least one objective in Milestone 3/)
  })
})
