import { describe, expect, test } from 'vitest'
import {
  parseLearnV2BlueprintAliasCandidate,
  validateLearnV2BlueprintCandidate,
  type LearnV2BlueprintCandidate,
} from '../../shared/learn-v2-blueprint'

const sources = Array.from({ length: 6 }, (_, index) => `source-${index + 1}`)

function candidate(): LearnV2BlueprintCandidate {
  return {
    version: 'learn-v2.blueprint-candidate.v1',
    generatorVersion: 'test-generator.v1',
    milestones: [
      { key: 'foundations', order: 0, title: 'Foundations' },
      { key: 'practice', order: 1, title: 'Practice' },
      { key: 'transfer', order: 2, title: 'Transfer' },
    ],
    objectives: Array.from({ length: 6 }, (_, index) => ({
      key: `objective-${index + 1}`,
      milestoneKey: index < 2 ? 'foundations' : index < 4 ? 'practice' : 'transfer',
      order: index,
      title: `Objective ${index + 1}`,
      capability: `Apply capability ${index + 1} to a bounded case`,
      estimatedMinutes: 25,
      coverage: 'strong' as const,
      sourceSnapshotIds: [sources[index % sources.length]!],
      prerequisiteObjectiveKeys: index === 0 ? [] : [`objective-${index}`],
      assessmentContract: {
        version: 'learn-v2.assessment.v1',
        kind: 'bounded_rubric' as const,
        responseFormat: 'short_text' as const,
        instructions: `Apply capability ${index + 1} to a novel case.`,
        passingScorePercent: 80 as const,
        criteria: [
          { key: 'accuracy', description: 'Uses the accepted evidence accurately.', weightPercent: 60 },
          { key: 'application', description: 'Applies the capability to the case.', weightPercent: 40 },
        ],
      },
    })),
  }
}

describe('Learn V2 blueprint candidate contract', () => {
  test('accepts a bounded evidence-backed map and returns normalized content', () => {
    const result = validateLearnV2BlueprintCandidate(candidate(), sources)

    expect(result.milestones).toHaveLength(3)
    expect(result.objectives).toHaveLength(6)
    expect(result.objectives[5]?.prerequisiteObjectiveKeys).toEqual(['objective-5'])
  })

  test.each([
    ['too few milestones', (value: LearnV2BlueprintCandidate) => { value.milestones.pop() }],
    ['too few objectives', (value: LearnV2BlueprintCandidate) => { value.objectives.pop() }],
    ['unknown source', (value: LearnV2BlueprintCandidate) => { value.objectives[0]!.sourceSnapshotIds = ['not-accepted'] }],
    ['missing evidence', (value: LearnV2BlueprintCandidate) => { value.objectives[0]!.sourceSnapshotIds = [] }],
    ['cycle', (value: LearnV2BlueprintCandidate) => { value.objectives[0]!.prerequisiteObjectiveKeys = ['objective-6'] }],
    ['duplicate order', (value: LearnV2BlueprintCandidate) => { value.objectives[1]!.order = 0 }],
    ['invalid assessment weights', (value: LearnV2BlueprintCandidate) => { value.objectives[0]!.assessmentContract.criteria[0]!.weightPercent = 50 }],
  ])('rejects %s', (_name, mutate) => {
    const value = candidate()
    mutate(value)
    expect(() => validateLearnV2BlueprintCandidate(value, sources)).toThrow()
  })

  test('accepts only explicit source-free gaps', () => {
    const value = candidate()
    Object.assign(value.objectives[0]!, {
      coverage: 'gap',
      sourceSnapshotIds: [],
      gapReason: 'No accepted source supports this capability.',
    })

    expect(validateLearnV2BlueprintCandidate(value, sources).objectives[0]).toMatchObject({ coverage: 'gap' })

    value.objectives[0]!.sourceSnapshotIds = [sources[0]!]
    expect(() => validateLearnV2BlueprintCandidate(value, sources)).toThrow(/gap/i)
  })

  test('requires partial coverage to disclose its remaining evidence gap', () => {
    const value = candidate()
    Object.assign(value.objectives[0]!, {
      coverage: 'partial',
      gapReason: 'The accepted evidence covers the mechanism but not the boundary case.',
      gapSourceSnapshotIds: [sources[1]],
    })
    expect(validateLearnV2BlueprintCandidate(value, sources).objectives[0]).toMatchObject({ coverage: 'partial' })
    delete value.objectives[0]!.gapReason
    expect(() => validateLearnV2BlueprintCandidate(value, sources)).toThrow(/partial coverage/i)
  })

  test('caps supporting and gap-attribution links as one per-objective budget', () => {
    const value = candidate()
    const supporting = Array.from({ length: 10 }, (_, index) => `support-${index}`)
    const gaps = ['gap-0']
    Object.assign(value.objectives[0]!, {
      coverage: 'partial',
      sourceSnapshotIds: supporting,
      gapSourceSnapshotIds: gaps,
      gapReason: 'One reviewed source still leaves a bounded gap.',
    })
    expect(() => validateLearnV2BlueprintCandidate(value, supporting, gaps)).toThrow(/combined source links/i)
  })

  test('allows an all-gap provider map when accepted evidence is locator-only', () => {
    const value = candidate()
    const providerValue = {
      version: value.version,
      milestones: value.milestones.map(milestone => ({ ...milestone, description: null })),
      objectives: value.objectives.map(({ sourceSnapshotIds: _sourceSnapshotIds, gapSourceSnapshotIds: _gapSourceSnapshotIds, ...objective }) => ({
        ...objective,
        coverage: 'gap',
        gapReason: 'The reviewed source is unavailable as supporting evidence.',
        sourceAliases: [],
        gapSourceAliases: ['source-001'],
      })),
    }
    expect(parseLearnV2BlueprintAliasCandidate(JSON.stringify(providerValue), [], ['source-001']).objectives.every(objective => objective.coverage === 'gap')).toBe(true)
  })

  test('rejects unknown object properties instead of silently accepting provider drift', () => {
    const value = candidate() as LearnV2BlueprintCandidate & { surprise?: boolean }
    value.surprise = true
    expect(() => validateLearnV2BlueprintCandidate(value, sources)).toThrow(/unexpected field/i)
  })

  test('accepts inclusive maximum cardinalities and empty, diamond, and disconnected DAG shapes', () => {
    const value = candidate()
    value.milestones.push(
      { key: 'synthesis', order: 3, title: 'Synthesis' },
      { key: 'analysis', order: 4, title: 'Analysis' },
      { key: 'extension', order: 5, title: 'Extension' },
    )
    const template = value.objectives[0]!
    value.objectives = Array.from({ length: 15 }, (_, index) => ({
      ...structuredClone(template),
      key: `maximum-${index + 1}`,
      milestoneKey: value.milestones[index % value.milestones.length]!.key,
      order: index,
      sourceSnapshotIds: [sources[index % sources.length]!],
      prerequisiteObjectiveKeys: [],
    }))
    value.objectives[2]!.prerequisiteObjectiveKeys = ['maximum-1']
    value.objectives[3]!.prerequisiteObjectiveKeys = ['maximum-1']
    value.objectives[4]!.prerequisiteObjectiveKeys = ['maximum-3', 'maximum-4']
    expect(validateLearnV2BlueprintCandidate(value, sources).objectives).toHaveLength(15)
  })

  test.each([
    ['milestone overflow', (value: LearnV2BlueprintCandidate) => value.milestones.push({ key: 'four', order: 3, title: 'Four' }, { key: 'five', order: 4, title: 'Five' }, { key: 'six', order: 5, title: 'Six' }, { key: 'seven', order: 6, title: 'Seven' })],
    ['objective overflow', (value: LearnV2BlueprintCandidate) => { const base = value.objectives[0]!; value.objectives = Array.from({ length: 16 }, (_, index) => ({ ...structuredClone(base), key: `overflow-${index}`, order: index })) }],
    ['self edge', (value: LearnV2BlueprintCandidate) => { value.objectives[0]!.prerequisiteObjectiveKeys = ['objective-1'] }],
    ['duplicate edge', (value: LearnV2BlueprintCandidate) => { value.objectives[1]!.prerequisiteObjectiveKeys = ['objective-1', 'objective-1'] }],
    ['orphan edge', (value: LearnV2BlueprintCandidate) => { value.objectives[1]!.prerequisiteObjectiveKeys = ['missing-objective'] }],
    ['invalid effort', (value: LearnV2BlueprintCandidate) => { value.objectives[0]!.estimatedMinutes = 0 }],
    ['missing assessment', (value: LearnV2BlueprintCandidate) => { delete (value.objectives[0] as Partial<LearnV2BlueprintCandidate['objectives'][number]>).assessmentContract }],
    ['control text', (value: LearnV2BlueprintCandidate) => { value.objectives[0]!.title = 'Unsafe\u0000title' }],
    ['format text', (value: LearnV2BlueprintCandidate) => { value.objectives[0]!.capability = 'Unsafe\u202Ecapability' }],
  ])('rejects frozen-contract boundary: %s', (_name, mutate) => {
    const value = candidate()
    mutate(value)
    expect(() => validateLearnV2BlueprintCandidate(value, sources)).toThrow()
  })
})
