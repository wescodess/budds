import { ConvexError, v, type Infer } from 'convex/values'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import { LEARN_V2_BLUEPRINT_LIMITS, validateLearnV2AssessmentContract, validateLearnV2BlueprintCandidate, type LearnV2AssessmentContract } from '../../shared/learn-v2-blueprint'

export const mapEditCandidateValidator = v.object({
  version: v.literal('learn-v2.blueprint-candidate.v1'),
  generatorVersion: v.string(),
  milestones: v.array(v.object({ key: v.string(), order: v.number(), title: v.string(), description: v.optional(v.string()) })),
  objectives: v.array(v.object({
    key: v.string(), milestoneKey: v.string(), order: v.number(), title: v.string(), capability: v.string(), estimatedMinutes: v.number(),
    depth: v.optional(v.union(v.literal('foundational'), v.literal('working'), v.literal('advanced'))),
    coverage: v.union(v.literal('strong'), v.literal('partial'), v.literal('gap')), gapReason: v.optional(v.string()),
    sourceSnapshotIds: v.array(v.id('learnSourceSnapshots')), gapSourceSnapshotIds: v.optional(v.array(v.id('learnSourceSnapshots'))),
    prerequisiteObjectiveKeys: v.array(v.string()), splitFromObjectiveKey: v.optional(v.string()),
  })),
})

export function defaultMapObjectiveContract(): LearnV2AssessmentContract {
  return { version: 'learn-v2.assessment.v1', kind: 'bounded_rubric', responseFormat: 'short_text',
    instructions: 'Demonstrate the capability using the accepted evidence.', passingScorePercent: 80,
    criteria: [{ key: 'correct', description: 'The response is correct and supported by the accepted evidence.', weightPercent: 100 }] }
}

function rejectMapEdit(reasonCode: 'assessment_contract_unavailable' | 'invalid_split_parent' | 'objective_identity_unavailable'): never {
  throw new ConvexError({ version: 'learn-v2.map-edit.v1', status: 'rejected', reasonCode })
}

export function requireServerAssessmentContract(value: unknown): asserts value is LearnV2AssessmentContract {
  try { validateLearnV2AssessmentContract(value, 'objective') }
  catch { rejectMapEdit('assessment_contract_unavailable') }
}

export async function resolveMapEditCandidate(ctx: MutationCtx, userId: string, blueprintRevisionId: Id<'learnBlueprintRevisions'>,
  input: Infer<typeof mapEditCandidateValidator>, supportingSourceIds: string[], gapSourceIds: string[]) {
  // Validate editable fields without normalizing or replacing stored contracts.
  const candidate = validateLearnV2BlueprintCandidate({ ...input, objectives: input.objectives.map(({ splitFromObjectiveKey: _parent, ...objective }) => ({
    ...objective, assessmentContract: defaultMapObjectiveContract(),
  })) }, supportingSourceIds, gapSourceIds)
  const rows = await ctx.db.query('learnObjectives').withIndex('by_userId_and_blueprintRevisionId_and_order', q => q
    .eq('userId', userId).eq('blueprintRevisionId', blueprintRevisionId)).take(LEARN_V2_BLUEPRINT_LIMITS.maximumObjectives + 1)
  if (rows.length > LEARN_V2_BLUEPRINT_LIMITS.maximumObjectives) rejectMapEdit('objective_identity_unavailable')
  const existing = new Map<string, Doc<'learnObjectives'>>()
  for (const row of rows) {
    const key = row.stableKey ?? `objective-${row.order + 1}`
    if (existing.has(key)) rejectMapEdit('objective_identity_unavailable')
    existing.set(key, row)
  }
  const retained = new Set(candidate.objectives.map(row => row.key))
  const parents = new Map(candidate.objectives.map((row, index) => [row.key, input.objectives[index]!.splitFromObjectiveKey]))
  return { ...candidate, objectives: candidate.objectives.map(objective => {
    const original = existing.get(objective.key)
    const parentKey = parents.get(objective.key)
    let contract = original?.assessmentContract
    if (original) {
      if (parentKey !== undefined) rejectMapEdit('invalid_split_parent')
    }
    else if (parentKey !== undefined) {
      const parent = existing.get(parentKey)
      if (!parent || !retained.has(parentKey)) rejectMapEdit('invalid_split_parent')
      requireServerAssessmentContract(parent.assessmentContract)
      contract = parent.assessmentContract
    }
    else contract = defaultMapObjectiveContract()
    return { ...objective, assessmentContract: contract }
  }) }
}
