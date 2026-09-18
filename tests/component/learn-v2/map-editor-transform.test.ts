import { describe, expect, it } from 'vitest'
import { reactive } from 'vue'
import { applyLearnMapEdit, type LearnMapCandidate } from '../../../app/utils/learn-v2-map-editor'

const assessment = { version: 'learn-v2.assessment.v1' as const, kind: 'bounded_rubric' as const, responseFormat: 'short_text' as const, instructions: 'Apply the accepted evidence.', passingScorePercent: 80 as const, criteria: [{ key: 'correct', description: 'Correct and supported.', weightPercent: 100 }] }

function candidate(): LearnMapCandidate {
  return {
    version: 'learn-v2.blueprint-candidate.v1',
    generatorVersion: 'test',
    milestones: [0, 1, 2].map(order => ({ key: `milestone-${order + 1}`, order, title: `Milestone ${order + 1}` })),
    objectives: Array.from({ length: 6 }, (_, order) => ({ key: `objective-${order + 1}`, milestoneKey: `milestone-${Math.floor(order / 2) + 1}`, order, title: `Objective ${order + 1}`, capability: `Capability ${order + 1}`, estimatedMinutes: 20, depth: 'working' as const, coverage: 'strong' as const, sourceSnapshotIds: ['snapshot-1'], gapSourceSnapshotIds: [], prerequisiteObjectiveKeys: order ? [`objective-${order}`] : [], assessmentContract: assessment })),
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
  })

  it('persists edited depth, evidence links, prerequisites, and assessment criteria', () => {
    const edited = applyLearnMapEdit(candidate(), { kind: 'save_objective', objective: { objectiveKey: 'objective-2', title: 'Apply cancellation safely', capability: 'Choose and justify a cancellation boundary.', milestoneKey: 'milestone-1', effortMinutes: 45, depth: 'advanced', coverage: 'partial', gapReason: 'Needs a server-runtime source.', supportingSourceKeys: ['source-a'], gapSourceKeys: ['source-b'], prerequisiteKeys: ['objective-1'], assessmentContract: { ...assessment, criteria: [{ key: 'choice', description: 'Chooses the correct boundary.', weightPercent: 40 }, { key: 'reason', description: 'Justifies the choice from evidence.', weightPercent: 60 }] } } }, { 'source-a': 'snapshot-a', 'source-b': 'snapshot-b' })
    expect(edited.objectives[1]).toMatchObject({ key: 'objective-2', depth: 'advanced', coverage: 'partial', sourceSnapshotIds: ['snapshot-a'], gapSourceSnapshotIds: ['snapshot-b'], prerequisiteObjectiveKeys: ['objective-1'], assessmentContract: { criteria: [{ weightPercent: 40 }, { weightPercent: 60 }] } })
  })

  it('rejects removal that would leave a milestone empty', () => {
    const map = candidate()
    map.objectives[4]!.milestoneKey = 'milestone-2'
    map.objectives.push({ ...structuredClone(map.objectives[4]!), key: 'objective-7', order: 6, prerequisiteObjectiveKeys: ['objective-5'] })
    expect(() => applyLearnMapEdit(map, { kind: 'remove_objective', objectiveKey: 'objective-6' }, {})).toThrow(/at least one objective in Milestone 3/)
  })
})
