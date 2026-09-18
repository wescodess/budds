import type { LearnAssessmentContract, LearnMapEdit } from '~/types/learn-v2-journey'

export interface LearnMapCandidate {
  version: 'learn-v2.blueprint-candidate.v1'
  generatorVersion: string
  milestones: Array<{ key: string; order: number; title: string; description?: string }>
  objectives: Array<{
    key: string
    milestoneKey: string
    order: number
    title: string
    capability: string
    estimatedMinutes: number
    depth?: 'foundational' | 'working' | 'advanced'
    coverage: 'strong' | 'partial' | 'gap'
    gapReason?: string
    sourceSnapshotIds: string[]
    gapSourceSnapshotIds: string[]
    prerequisiteObjectiveKeys: string[]
    assessmentContract: LearnAssessmentContract
  }>
}

function clone(candidate: LearnMapCandidate): LearnMapCandidate {
  return structuredClone(candidate)
}

function normalizeOrders(candidate: LearnMapCandidate) {
  candidate.objectives.forEach((objective, order) => { objective.order = order })
}

function assertPublishableShape(candidate: LearnMapCandidate) {
  if (candidate.objectives.length < 6 || candidate.objectives.length > 15) throw new Error('A learning map must contain 6 to 15 objectives')
  for (const milestone of candidate.milestones) {
    if (!candidate.objectives.some(objective => objective.milestoneKey === milestone.key)) throw new Error(`Keep at least one objective in ${milestone.title}`)
  }
  const keys = new Set(candidate.objectives.map(objective => objective.key))
  const prerequisites = new Map(candidate.objectives.map(objective => [objective.key, objective.prerequisiteObjectiveKeys]))
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (key: string) => {
    if (visiting.has(key)) throw new Error('Prerequisites cannot form a cycle')
    if (visited.has(key)) return
    visiting.add(key)
    for (const prerequisite of prerequisites.get(key) ?? []) {
      if (!keys.has(prerequisite)) throw new Error('A prerequisite is no longer in this map')
      visit(prerequisite)
    }
    visiting.delete(key)
    visited.add(key)
  }
  for (const key of keys) visit(key)
}

function sourceIds(keys: string[], sourceIdByKey: Readonly<Record<string, string>>) {
  return keys.map((key) => {
    const id = sourceIdByKey[key]
    if (!id) throw new Error('A selected source is no longer available in this draft')
    return id
  })
}

function createObjectiveKey(existing: Set<string>, supplied?: () => string) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = supplied?.() ?? `learner-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(candidate) && candidate.length <= 64 && !existing.has(candidate)) return candidate
  }
  throw new Error('Could not create a stable objective identity')
}

export function applyLearnMapEdit(
  current: LearnMapCandidate,
  edit: LearnMapEdit,
  sourceIdByKey: Readonly<Record<string, string>>,
  nextKey?: () => string,
): LearnMapCandidate {
  const candidate = clone(current)
  const existingKeys = new Set(candidate.objectives.map(objective => objective.key))

  if (edit.kind === 'move_objective') {
    const index = candidate.objectives.findIndex(objective => objective.key === edit.objectiveKey)
    if (index < 0) throw new Error('Objective is no longer in this map')
    const destination = edit.direction === 'up' ? index - 1 : index + 1
    if (destination < 0 || destination >= candidate.objectives.length) return candidate
    const [objective] = candidate.objectives.splice(index, 1)
    candidate.objectives.splice(destination, 0, objective!)
  }
  else if (edit.kind === 'remove_objective') {
    const target = candidate.objectives.find(objective => objective.key === edit.objectiveKey)
    if (!target) throw new Error('Objective is no longer in this map')
    candidate.objectives = candidate.objectives.filter(objective => objective.key !== edit.objectiveKey)
    for (const objective of candidate.objectives) objective.prerequisiteObjectiveKeys = objective.prerequisiteObjectiveKeys.filter(key => key !== edit.objectiveKey)
  }
  else if (edit.kind === 'split_objective') {
    if (candidate.objectives.length >= 15) throw new Error('This map already has the maximum of 15 objectives')
    const index = candidate.objectives.findIndex(objective => objective.key === edit.objectiveKey)
    if (index < 0) throw new Error('Objective is no longer in this map')
    const original = candidate.objectives[index]!
    const secondKey = createObjectiveKey(existingKeys, nextKey)
    const second = structuredClone(original)
    original.title = edit.firstTitle
    original.estimatedMinutes = Math.max(5, Math.ceil(original.estimatedMinutes / 2))
    second.key = secondKey
    second.title = edit.secondTitle
    second.estimatedMinutes = Math.max(5, Math.floor(second.estimatedMinutes / 2))
    second.prerequisiteObjectiveKeys = [original.key]
    for (const dependant of candidate.objectives) {
      if (dependant.key !== original.key && dependant.prerequisiteObjectiveKeys.includes(original.key)) {
        dependant.prerequisiteObjectiveKeys = dependant.prerequisiteObjectiveKeys.map(key => key === original.key ? secondKey : key)
      }
    }
    candidate.objectives.splice(index + 1, 0, second)
  }
  else {
    const draft = edit.objective
    const existing = draft.objectiveKey ? candidate.objectives.find(objective => objective.key === draft.objectiveKey) : undefined
    const template = existing ?? candidate.objectives.at(-1)
    if (!template) throw new Error('A generated map is required before adding objectives')
    const key = existing?.key ?? createObjectiveKey(existingKeys, nextKey)
    const updated = {
      ...template,
      key,
      milestoneKey: draft.milestoneKey,
      title: draft.title.trim(),
      capability: draft.capability.trim(),
      estimatedMinutes: draft.effortMinutes,
      depth: draft.depth,
      coverage: draft.coverage,
      gapReason: draft.coverage === 'strong' ? undefined : draft.gapReason?.trim(),
      sourceSnapshotIds: draft.coverage === 'gap' ? [] : sourceIds(draft.supportingSourceKeys, sourceIdByKey),
      gapSourceSnapshotIds: draft.coverage === 'strong' ? [] : sourceIds(draft.gapSourceKeys, sourceIdByKey),
      prerequisiteObjectiveKeys: [...draft.prerequisiteKeys],
      assessmentContract: structuredClone(draft.assessmentContract),
    }
    if (existing) Object.assign(existing, updated)
    else {
      if (candidate.objectives.length >= 15) throw new Error('This map already has the maximum of 15 objectives')
      candidate.objectives.push(updated)
    }
  }

  normalizeOrders(candidate)
  candidate.generatorVersion = 'learn-v2.learner-map-edit.v2'
  assertPublishableShape(candidate)
  return candidate
}
