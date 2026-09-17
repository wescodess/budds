import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import { LEARN_V2_BLUEPRINT_LIMITS } from '../../shared/learn-v2-blueprint'

function stored<T extends { _id: unknown, _creationTime: unknown }>(row: T) {
  const { _id: _id, _creationTime: _creationTime, ...value } = row
  return value
}

export async function cloneBlueprintChildren(
  ctx: MutationCtx,
  userId: string,
  source: Doc<'learnBlueprintRevisions'>,
  targetId: Id<'learnBlueprintRevisions'>,
) {
  const milestones = await ctx.db.query('learnMilestones')
    .withIndex('by_userId_and_blueprintRevisionId_and_order', q => q.eq('userId', userId).eq('blueprintRevisionId', source._id))
    .take(LEARN_V2_BLUEPRINT_LIMITS.maximumMilestones + 1)
  if (milestones.length > LEARN_V2_BLUEPRINT_LIMITS.maximumMilestones) throw new Error('Blueprint milestone set exceeds its bounded contract')
  const objectives = await ctx.db.query('learnObjectives')
    .withIndex('by_userId_and_blueprintRevisionId_and_order', q => q.eq('userId', userId).eq('blueprintRevisionId', source._id))
    .take(LEARN_V2_BLUEPRINT_LIMITS.maximumObjectives + 1)
  if (objectives.length > LEARN_V2_BLUEPRINT_LIMITS.maximumObjectives) throw new Error('Blueprint objective set exceeds its bounded contract')

  const acceptedSources = await ctx.db.query('learnSourceSnapshots')
    .withIndex('by_userId_and_blueprintRevisionId_and_status', q => q.eq('userId', userId).eq('blueprintRevisionId', source._id).eq('status', 'user_accepted'))
    .take(LEARN_V2_BLUEPRINT_LIMITS.maximumAcceptedSources + 1)
  if (acceptedSources.length > LEARN_V2_BLUEPRINT_LIMITS.maximumAcceptedSources) throw new Error('Blueprint accepted source set exceeds its bounded contract')
  const sourceRows = new Map(acceptedSources.map(row => [String(row._id), row]))
  for (const sourceId of source.generationSupportingSourceSnapshotIds ?? []) {
    const row = await ctx.db.get(sourceId)
    if (!row || row.userId !== userId || row.blueprintRevisionId !== source._id) throw new Error('Blueprint supporting source scope mismatch')
    sourceRows.set(String(row._id), row)
  }
  const objectiveLinks = new Map<string, Doc<'learnObjectiveSources'>[]>()
  let sourceLinkCount = 0
  for (const objective of objectives) {
    const links = await ctx.db.query('learnObjectiveSources')
      .withIndex('by_userId_and_objectiveId_and_sourceSnapshotId', q => q.eq('userId', userId).eq('objectiveId', objective._id))
      .take(LEARN_V2_BLUEPRINT_LIMITS.maximumSourcesPerObjective + 1)
    if (links.length > LEARN_V2_BLUEPRINT_LIMITS.maximumSourcesPerObjective) throw new Error('Blueprint objective source set exceeds its bounded contract')
    sourceLinkCount += links.length
    objectiveLinks.set(String(objective._id), links)
    for (const link of links) {
      const row = await ctx.db.get(link.sourceSnapshotId)
      if (!row || row.userId !== userId || row.blueprintRevisionId !== source._id) throw new Error('Blueprint objective source scope mismatch')
      sourceRows.set(String(row._id), row)
    }
  }
  if (sourceLinkCount > LEARN_V2_BLUEPRINT_LIMITS.maximumObjectiveSourceLinks) throw new Error('Blueprint objective source set exceeds its bounded contract')

  const sourceIds = new Map<string, Id<'learnSourceSnapshots'>>()
  for (const sourceSnapshot of sourceRows.values()) {
    const { folderManifestId: _folderManifestId, ...sourceValue } = stored(sourceSnapshot)
    const cloneId = await ctx.db.insert('learnSourceSnapshots', {
      ...sourceValue,
      blueprintRevisionId: targetId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    sourceIds.set(String(sourceSnapshot._id), cloneId)
    const excerpts = await ctx.db.query('learnSourceExcerpts')
      .withIndex('by_userId_and_sourceSnapshotId', q => q.eq('userId', userId).eq('sourceSnapshotId', sourceSnapshot._id))
      .take(2)
    if (excerpts.length > 1) throw new Error('Source excerpt set exceeds its bounded contract')
    for (const excerpt of excerpts) {
      await ctx.db.insert('learnSourceExcerpts', { ...stored(excerpt), sourceSnapshotId: cloneId })
    }
  }

  const milestoneIds = new Map<string, Id<'learnMilestones'>>()
  for (const milestone of milestones) {
    const cloneId = await ctx.db.insert('learnMilestones', { ...stored(milestone), blueprintRevisionId: targetId })
    milestoneIds.set(String(milestone._id), cloneId)
  }

  const objectiveIds = new Map<string, Id<'learnObjectives'>>()
  for (const objective of objectives) {
    const milestoneId = objective.milestoneId && milestoneIds.get(String(objective.milestoneId))
    if (objective.milestoneId && !milestoneId) throw new Error('Blueprint objective milestone scope mismatch')
    const cloneId = await ctx.db.insert('learnObjectives', {
      ...stored(objective),
      blueprintRevisionId: targetId,
      milestoneId,
    })
    objectiveIds.set(String(objective._id), cloneId)
  }

  for (const objective of objectives) {
    const objectiveId = objectiveIds.get(String(objective._id))!
    const prerequisites = await ctx.db.query('learnObjectivePrerequisites')
      .withIndex('by_userId_and_blueprintRevisionId_and_objectiveId', q => q.eq('userId', userId).eq('blueprintRevisionId', source._id).eq('objectiveId', objective._id))
      .take(LEARN_V2_BLUEPRINT_LIMITS.maximumPrerequisiteEdges + 1)
    if (prerequisites.length > LEARN_V2_BLUEPRINT_LIMITS.maximumPrerequisiteEdges) throw new Error('Blueprint prerequisite set exceeds its bounded contract')
    for (const edge of prerequisites) {
      const prerequisiteObjectiveId = objectiveIds.get(String(edge.prerequisiteObjectiveId))
      if (!prerequisiteObjectiveId) throw new Error('Blueprint prerequisite scope mismatch')
      await ctx.db.insert('learnObjectivePrerequisites', { userId, blueprintRevisionId: targetId, objectiveId, prerequisiteObjectiveId })
    }
    for (const link of objectiveLinks.get(String(objective._id)) ?? []) {
      const sourceSnapshotId = sourceIds.get(String(link.sourceSnapshotId))
      if (!sourceSnapshotId) throw new Error('Blueprint objective source scope mismatch')
      await ctx.db.insert('learnObjectiveSources', { userId, objectiveId, sourceSnapshotId, coverage: link.coverage })
    }
  }

  return sourceIds
}
