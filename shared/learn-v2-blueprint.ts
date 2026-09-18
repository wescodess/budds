export const LEARN_V2_BLUEPRINT_CANDIDATE_VERSION = 'learn-v2.blueprint-candidate.v1' as const
export const LEARN_V2_ASSESSMENT_VERSION = 'learn-v2.assessment.v1' as const
export const LEARN_V2_BLUEPRINT_LIMITS = {
  minimumMilestones: 3,
  maximumMilestones: 6,
  minimumObjectives: 6,
  maximumObjectives: 15,
  maximumAcceptedSources: 64,
  maximumSourcesPerObjective: 10,
  maximumObjectiveSourceLinks: 60,
  maximumPrerequisiteEdges: 60,
} as const

export type LearnV2AssessmentContract = {
  version: typeof LEARN_V2_ASSESSMENT_VERSION
  kind: 'machine_checkable' | 'bounded_rubric'
  responseFormat: 'short_text' | 'structured'
  instructions: string
  passingScorePercent: 80
  criteria: Array<{
    key: string
    description: string
    weightPercent: number
  }>
}

export type LearnV2BlueprintCandidate = {
  version: typeof LEARN_V2_BLUEPRINT_CANDIDATE_VERSION
  generatorVersion: string
  milestones: Array<{
    key: string
    order: number
    title: string
    description?: string
  }>
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
    assessmentContract: LearnV2AssessmentContract
  }>
}

type UnknownRecord = Record<string, unknown>

function record(value: unknown, label: string): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as UnknownRecord
}

function exactKeys(value: UnknownRecord, required: readonly string[], optional: readonly string[], label: string) {
  const allowed = new Set([...required, ...optional])
  for (const key of required) if (!(key in value)) throw new Error(`${label} is missing ${key}`)
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`${label} has unexpected field ${key}`)
}

function text(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string') throw new Error(`${label} must be text`)
  if (/[\p{Cc}\p{Cf}]/u.test(value)) throw new Error(`${label} contains prohibited control or format characters`)
  const normalized = value.trim()
  if (!normalized) throw new Error(`${label} must not be blank`)
  if (normalized.length > maximum) throw new Error(`${label} exceeds ${maximum} characters`)
  return normalized
}

function key(value: unknown, label: string): string {
  const normalized = text(value, label, 64)
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(normalized)) throw new Error(`${label} must be a stable lowercase key`)
  return normalized
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`)
  }
  return value as number
}

function array(value: unknown, minimum: number, maximum: number, label: string): unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw new Error(`${label} must contain ${minimum} to ${maximum} items`)
  }
  return value
}

function unique(values: string[], label: string) {
  if (new Set(values).size !== values.length) throw new Error(`${label} must not contain duplicates`)
}

function assessment(value: unknown, objectiveKey: string): LearnV2AssessmentContract {
  const item = record(value, `Assessment ${objectiveKey}`)
  exactKeys(item, ['version', 'kind', 'responseFormat', 'instructions', 'passingScorePercent', 'criteria'], [], `Assessment ${objectiveKey}`)
  if (item.version !== LEARN_V2_ASSESSMENT_VERSION) throw new Error(`Assessment ${objectiveKey} has an unsupported version`)
  if (item.kind !== 'machine_checkable' && item.kind !== 'bounded_rubric') throw new Error(`Assessment ${objectiveKey} has an invalid kind`)
  if (item.responseFormat !== 'short_text' && item.responseFormat !== 'structured') throw new Error(`Assessment ${objectiveKey} has an invalid response format`)
  if (item.passingScorePercent !== 80) throw new Error(`Assessment ${objectiveKey} must use the server mastery threshold`)
  const criteria = array(item.criteria, 1, 8, `Assessment ${objectiveKey} criteria`).map((raw, index) => {
    const criterion = record(raw, `Assessment ${objectiveKey} criterion ${index}`)
    exactKeys(criterion, ['key', 'description', 'weightPercent'], [], `Assessment ${objectiveKey} criterion ${index}`)
    return {
      key: key(criterion.key, `Assessment ${objectiveKey} criterion ${index} key`),
      description: text(criterion.description, `Assessment ${objectiveKey} criterion ${index} description`, 300),
      weightPercent: integer(criterion.weightPercent, 1, 100, `Assessment ${objectiveKey} criterion ${index} weight`),
    }
  })
  unique(criteria.map(item => item.key), `Assessment ${objectiveKey} criterion keys`)
  if (criteria.reduce((sum, item) => sum + item.weightPercent, 0) !== 100) throw new Error(`Assessment ${objectiveKey} criterion weights must total 100`)
  return {
    version: LEARN_V2_ASSESSMENT_VERSION,
    kind: item.kind,
    responseFormat: item.responseFormat,
    instructions: text(item.instructions, `Assessment ${objectiveKey} instructions`, 1_000),
    passingScorePercent: 80,
    criteria,
  }
}

function assertContiguousOrders(items: Array<{ order: number }>, label: string) {
  const orders = items.map(item => item.order).sort((left, right) => left - right)
  if (orders.some((order, index) => order !== index)) throw new Error(`${label} orders must be unique and contiguous from zero`)
}

function assertDag(objectives: LearnV2BlueprintCandidate['objectives']) {
  const prerequisites = new Map(objectives.map(objective => [objective.key, objective.prerequisiteObjectiveKeys]))
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (objectiveKey: string) => {
    if (visiting.has(objectiveKey)) throw new Error('Objective prerequisites must form a DAG')
    if (visited.has(objectiveKey)) return
    visiting.add(objectiveKey)
    for (const prerequisite of prerequisites.get(objectiveKey) ?? []) visit(prerequisite)
    visiting.delete(objectiveKey)
    visited.add(objectiveKey)
  }
  for (const objective of objectives) visit(objective.key)
}

export function validateLearnV2BlueprintCandidate(
  input: unknown,
  acceptedSourceSnapshotIds: readonly string[],
  gapAttributionSourceSnapshotIds: readonly string[] = acceptedSourceSnapshotIds,
): LearnV2BlueprintCandidate {
  if ((acceptedSourceSnapshotIds.length === 0 && gapAttributionSourceSnapshotIds.length === 0)
    || acceptedSourceSnapshotIds.length > LEARN_V2_BLUEPRINT_LIMITS.maximumAcceptedSources
    || gapAttributionSourceSnapshotIds.length > LEARN_V2_BLUEPRINT_LIMITS.maximumAcceptedSources) {
    throw new Error('Blueprint generation requires a bounded accepted source set')
  }
  unique([...acceptedSourceSnapshotIds], 'Accepted source snapshot IDs')
  unique([...gapAttributionSourceSnapshotIds], 'Gap attribution source snapshot IDs')
  const acceptedSources = new Set(acceptedSourceSnapshotIds)
  const gapAttributionSources = new Set(gapAttributionSourceSnapshotIds)
  const candidate = record(input, 'Blueprint candidate')
  exactKeys(candidate, ['version', 'generatorVersion', 'milestones', 'objectives'], [], 'Blueprint candidate')
  if (candidate.version !== LEARN_V2_BLUEPRINT_CANDIDATE_VERSION) throw new Error('Blueprint candidate has an unsupported version')

  const milestones = array(
    candidate.milestones,
    LEARN_V2_BLUEPRINT_LIMITS.minimumMilestones,
    LEARN_V2_BLUEPRINT_LIMITS.maximumMilestones,
    'Blueprint milestones',
  ).map((raw, index) => {
    const item = record(raw, `Milestone ${index}`)
    exactKeys(item, ['key', 'order', 'title'], ['description'], `Milestone ${index}`)
    return {
      key: key(item.key, `Milestone ${index} key`),
      order: integer(item.order, 0, LEARN_V2_BLUEPRINT_LIMITS.maximumMilestones - 1, `Milestone ${index} order`),
      title: text(item.title, `Milestone ${index} title`, 200),
      ...(item.description === undefined ? {} : { description: text(item.description, `Milestone ${index} description`, 500) }),
    }
  })
  unique(milestones.map(item => item.key), 'Milestone keys')
  assertContiguousOrders(milestones, 'Milestone')
  const milestoneKeys = new Set(milestones.map(item => item.key))

  let sourceLinkCount = 0
  let prerequisiteCount = 0
  const objectives = array(
    candidate.objectives,
    LEARN_V2_BLUEPRINT_LIMITS.minimumObjectives,
    LEARN_V2_BLUEPRINT_LIMITS.maximumObjectives,
    'Blueprint objectives',
  ).map((raw, index) => {
    const item = record(raw, `Objective ${index}`)
    exactKeys(item, [
      'key', 'milestoneKey', 'order', 'title', 'capability', 'estimatedMinutes', 'coverage',
      'sourceSnapshotIds', 'prerequisiteObjectiveKeys', 'assessmentContract',
    ], ['depth', 'gapReason', 'gapSourceSnapshotIds'], `Objective ${index}`)
    const objectiveKey = key(item.key, `Objective ${index} key`)
    const milestoneKey = key(item.milestoneKey, `Objective ${objectiveKey} milestone key`)
    if (!milestoneKeys.has(milestoneKey)) throw new Error(`Objective ${objectiveKey} references an unknown milestone`)
    if (item.coverage !== 'strong' && item.coverage !== 'partial' && item.coverage !== 'gap') throw new Error(`Objective ${objectiveKey} has invalid coverage`)
    if (item.depth !== undefined && item.depth !== 'foundational' && item.depth !== 'working' && item.depth !== 'advanced') throw new Error(`Objective ${objectiveKey} has invalid depth`)
    const depth = item.depth as LearnV2BlueprintCandidate['objectives'][number]['depth']
    const coverage: 'strong' | 'partial' | 'gap' = item.coverage
    const sourceSnapshotIds = array(item.sourceSnapshotIds, 0, LEARN_V2_BLUEPRINT_LIMITS.maximumSourcesPerObjective, `Objective ${objectiveKey} sources`)
      .map((value, sourceIndex) => text(value, `Objective ${objectiveKey} source ${sourceIndex}`, 200))
    unique(sourceSnapshotIds, `Objective ${objectiveKey} sources`)
    for (const sourceId of sourceSnapshotIds) if (!acceptedSources.has(sourceId)) throw new Error(`Objective ${objectiveKey} references a source that was not accepted`)
    const gapSourceSnapshotIds = array(item.gapSourceSnapshotIds ?? [], 0, LEARN_V2_BLUEPRINT_LIMITS.maximumSourcesPerObjective, `Objective ${objectiveKey} gap sources`)
      .map((value, sourceIndex) => text(value, `Objective ${objectiveKey} gap source ${sourceIndex}`, 200))
    unique(gapSourceSnapshotIds, `Objective ${objectiveKey} gap sources`)
    for (const sourceId of gapSourceSnapshotIds) if (!gapAttributionSources.has(sourceId)) throw new Error(`Objective ${objectiveKey} attributes a gap to an unknown reviewed source`)
    if (gapSourceSnapshotIds.some(sourceId => sourceSnapshotIds.includes(sourceId))) throw new Error(`Objective ${objectiveKey} cannot use the same source as support and gap attribution`)
    if (sourceSnapshotIds.length + gapSourceSnapshotIds.length > LEARN_V2_BLUEPRINT_LIMITS.maximumSourcesPerObjective) {
      throw new Error(`Objective ${objectiveKey} has too many combined source links`)
    }
    sourceLinkCount += sourceSnapshotIds.length + gapSourceSnapshotIds.length
    const prerequisiteObjectiveKeys = array(item.prerequisiteObjectiveKeys, 0, LEARN_V2_BLUEPRINT_LIMITS.maximumObjectives - 1, `Objective ${objectiveKey} prerequisites`)
      .map((value, prerequisiteIndex) => key(value, `Objective ${objectiveKey} prerequisite ${prerequisiteIndex}`))
    unique(prerequisiteObjectiveKeys, `Objective ${objectiveKey} prerequisites`)
    prerequisiteCount += prerequisiteObjectiveKeys.length
    const gapReason = item.gapReason === undefined ? undefined : text(item.gapReason, `Objective ${objectiveKey} gap reason`, 500)
    if (coverage === 'gap' && (sourceSnapshotIds.length !== 0 || !gapReason)) throw new Error(`Objective ${objectiveKey} gap must be explicit and contain no supporting evidence`)
    if (coverage === 'partial' && (sourceSnapshotIds.length === 0 || !gapReason)) throw new Error(`Objective ${objectiveKey} partial coverage requires accepted evidence and an explicit remaining gap`)
    if (coverage === 'strong' && (sourceSnapshotIds.length === 0 || gapSourceSnapshotIds.length !== 0 || gapReason !== undefined)) throw new Error(`Objective ${objectiveKey} strong coverage requires accepted evidence and no gap attribution`)
    return {
      key: objectiveKey,
      milestoneKey,
      order: integer(item.order, 0, LEARN_V2_BLUEPRINT_LIMITS.maximumObjectives - 1, `Objective ${objectiveKey} order`),
      title: text(item.title, `Objective ${objectiveKey} title`, 200),
      capability: text(item.capability, `Objective ${objectiveKey} capability`, 500),
      estimatedMinutes: integer(item.estimatedMinutes, 5, 480, `Objective ${objectiveKey} estimated minutes`),
      ...(depth === undefined ? {} : { depth }),
      coverage,
      ...(gapReason === undefined ? {} : { gapReason }),
      sourceSnapshotIds,
      gapSourceSnapshotIds,
      prerequisiteObjectiveKeys,
      assessmentContract: assessment(item.assessmentContract, objectiveKey),
    }
  })
  unique(objectives.map(item => item.key), 'Objective keys')
  assertContiguousOrders(objectives, 'Objective')
  const objectiveKeys = new Set(objectives.map(item => item.key))
  for (const objective of objectives) {
    if (!milestones.some(milestone => milestone.key === objective.milestoneKey)) throw new Error(`Objective ${objective.key} references an unknown milestone`)
    for (const prerequisite of objective.prerequisiteObjectiveKeys) {
      if (prerequisite === objective.key) throw new Error(`Objective ${objective.key} cannot require itself`)
      if (!objectiveKeys.has(prerequisite)) throw new Error(`Objective ${objective.key} references an unknown prerequisite`)
    }
  }
  for (const milestone of milestones) {
    if (!objectives.some(objective => objective.milestoneKey === milestone.key)) throw new Error(`Milestone ${milestone.key} must contain an objective`)
  }
  if (sourceLinkCount > LEARN_V2_BLUEPRINT_LIMITS.maximumObjectiveSourceLinks) throw new Error('Blueprint has too many objective-source links')
  if (prerequisiteCount > LEARN_V2_BLUEPRINT_LIMITS.maximumPrerequisiteEdges) throw new Error('Blueprint has too many prerequisite edges')
  assertDag(objectives)

  return {
    version: LEARN_V2_BLUEPRINT_CANDIDATE_VERSION,
    generatorVersion: text(candidate.generatorVersion, 'Blueprint generator version', 96),
    milestones,
    objectives,
  }
}

export function parseLearnV2BlueprintCandidate(
  json: string,
  acceptedSourceSnapshotIds: readonly string[],
  gapAttributionSourceSnapshotIds?: readonly string[],
): LearnV2BlueprintCandidate {
  if (json.length > 128_000) throw new Error('Blueprint candidate exceeds the maximum payload size')
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  }
  catch {
    throw new Error('Blueprint candidate is not valid JSON')
  }
  return validateLearnV2BlueprintCandidate(parsed, acceptedSourceSnapshotIds, gapAttributionSourceSnapshotIds)
}

export function parseLearnV2BlueprintAliasCandidate(
  json: string,
  supportingAliases: readonly string[],
  gapAliases: readonly string[],
): LearnV2BlueprintCandidate {
  if (json.length > 128_000) throw new Error('Blueprint candidate exceeds the maximum payload size')
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  }
  catch {
    throw new Error('Blueprint candidate is not valid JSON')
  }
  const candidate = record(parsed, 'Blueprint candidate')
  const milestones = array(candidate.milestones, LEARN_V2_BLUEPRINT_LIMITS.minimumMilestones, LEARN_V2_BLUEPRINT_LIMITS.maximumMilestones, 'Blueprint milestones')
    .map((raw, index) => {
      const milestone = record(raw, `Milestone ${index}`)
      if (milestone.description !== null) return milestone
      const { description: _description, ...rest } = milestone
      return rest
    })
  const objectives = array(candidate.objectives, LEARN_V2_BLUEPRINT_LIMITS.minimumObjectives, LEARN_V2_BLUEPRINT_LIMITS.maximumObjectives, 'Blueprint objectives')
    .map((raw, index) => {
      const objective = record(raw, `Objective ${index}`)
      exactKeys(objective, [
        'key', 'milestoneKey', 'order', 'title', 'capability', 'estimatedMinutes', 'coverage',
        'sourceAliases', 'gapSourceAliases', 'prerequisiteObjectiveKeys', 'assessmentContract',
      ], ['gapReason'], `Objective ${index}`)
      const { sourceAliases, gapSourceAliases, gapReason, ...rest } = objective
      return {
        ...rest,
        ...(gapReason === null ? {} : { gapReason }),
        sourceSnapshotIds: sourceAliases,
        gapSourceSnapshotIds: gapSourceAliases,
      }
    })
  return validateLearnV2BlueprintCandidate({
    ...candidate,
    generatorVersion: 'learn-v2.blueprint-generator.v1',
    milestones,
    objectives,
  }, supportingAliases, gapAliases)
}
