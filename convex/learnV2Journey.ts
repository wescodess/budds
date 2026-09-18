import { v } from 'convex/values'
import { query } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { requireLearnV2QueryAccess } from './lib/learnV2Access'

const MAX_VOIDS = 32
const MAX_SOURCES = 64
const MAX_MILESTONES = 8
const MAX_OBJECTIVES = 16
const MAX_SESSIONS = 32
const MAX_ATTEMPTS_PER_OBJECTIVE = 8
const MAX_REVISIONS = 32

type VoidRow = Doc<'learningVoids'>
type BlueprintRow = Doc<'learnBlueprintRevisions'>

async function ownedVoid(ctx: Parameters<typeof requireLearnV2QueryAccess>[0], userId: string, id: Id<'learningVoids'>) {
  const row = await ctx.db.get(id)
  if (!row || row.userId !== userId) return null
  const folder = await ctx.db.get(row.folderId)
  return folder?.userId === userId ? { row, folder } : null
}

async function currentBlueprint(ctx: Parameters<typeof requireLearnV2QueryAccess>[0], userId: string, voidRow: VoidRow) {
  const rows = await ctx.db.query('learnBlueprintRevisions')
    .withIndex('by_userId_and_learningVoidId', q => q.eq('userId', userId).eq('learningVoidId', voidRow._id))
    .order('desc').take(MAX_REVISIONS + 1)
  if (rows.length > MAX_REVISIONS) throw new Error('Learn V2 blueprint revisions exceed their bounded contract')
  rows.sort((a, b) => b.revision - a.revision)
  return rows.length === 1 || rows[0]?.revision !== rows[1]?.revision ? rows[0] ?? null : null
}

async function mapProjection(ctx: Parameters<typeof requireLearnV2QueryAccess>[0], userId: string, blueprint: BlueprintRow | null) {
  if (!blueprint) return null
  const milestones = await ctx.db.query('learnMilestones')
    .withIndex('by_userId_and_blueprintRevisionId_and_order', q => q.eq('userId', userId).eq('blueprintRevisionId', blueprint._id))
    .take(MAX_MILESTONES + 1)
  const objectives = await ctx.db.query('learnObjectives')
    .withIndex('by_userId_and_blueprintRevisionId_and_order', q => q.eq('userId', userId).eq('blueprintRevisionId', blueprint._id))
    .take(MAX_OBJECTIVES + 1)
  if (milestones.length > MAX_MILESTONES || objectives.length > MAX_OBJECTIVES) throw new Error('Learn V2 map exceeds its bounded contract')
  const objectiveViews = []
  for (const objective of objectives) {
    const links = await ctx.db.query('learnObjectiveSources')
      .withIndex('by_userId_and_objectiveId_and_sourceSnapshotId', q => q.eq('userId', userId).eq('objectiveId', objective._id))
      .take(MAX_SOURCES + 1)
    if (links.length > MAX_SOURCES) throw new Error('Learn V2 objective evidence exceeds its bounded contract')
    const prerequisites = await ctx.db.query('learnObjectivePrerequisites')
      .withIndex('by_userId_and_blueprintRevisionId_and_objectiveId', q => q.eq('userId', userId).eq('blueprintRevisionId', blueprint._id).eq('objectiveId', objective._id))
      .take(MAX_OBJECTIVES + 1)
    objectiveViews.push({ ...objective, sourceLinks: links, prerequisiteObjectiveIds: prerequisites.map(row => row.prerequisiteObjectiveId) })
  }
  return { blueprint, milestones, objectives: objectiveViews }
}

async function sourceProjection(ctx: Parameters<typeof requireLearnV2QueryAccess>[0], userId: string, blueprint: BlueprintRow | null) {
  if (!blueprint) return { items: [], counts: { total: 0, accepted: 0, evaluated: 0, rejected: 0, unavailable: 0, pending: 0 } }
  const rows = await ctx.db.query('learnSourceSnapshots')
    .withIndex('by_userId_and_blueprintRevisionId', q => q.eq('userId', userId).eq('blueprintRevisionId', blueprint._id))
    .take(MAX_SOURCES + 1)
  if (rows.length > MAX_SOURCES) throw new Error('Learn V2 source set exceeds its bounded contract')
  const objectives = await ctx.db.query('learnObjectives').withIndex('by_userId_and_blueprintRevisionId_and_order', q => q.eq('userId', userId).eq('blueprintRevisionId', blueprint._id)).take(MAX_OBJECTIVES + 1)
  if (objectives.length > MAX_OBJECTIVES) throw new Error('Learn V2 map exceeds its bounded contract')
  const mappedBySource = new Map<string, Array<{ objectiveId: Id<'learnObjectives'>, title: string, coverage: 'strong' | 'partial' | 'gap' }>>()
  for (const objective of objectives) {
    const links = await ctx.db.query('learnObjectiveSources').withIndex('by_userId_and_objectiveId_and_sourceSnapshotId', q => q.eq('userId', userId).eq('objectiveId', objective._id)).take(MAX_SOURCES + 1)
    if (links.length > MAX_SOURCES) throw new Error('Learn V2 objective evidence exceeds its bounded contract')
    for (const link of links) {
      const current = mappedBySource.get(String(link.sourceSnapshotId)) ?? []
      current.push({ objectiveId: objective._id, title: objective.title, coverage: link.coverage })
      mappedBySource.set(String(link.sourceSnapshotId), current)
    }
  }
  const counts = { total: rows.length, accepted: 0, evaluated: 0, rejected: 0, unavailable: 0, pending: 0 }
  const items = []
  for (const source of rows) {
    const status = source.effectiveStatus ?? source.status
    if (status === 'user_accepted') counts.accepted += 1
    else if (status === 'evaluated') counts.evaluated += 1
    else if (status === 'rejected') counts.rejected += 1
    else if (status === 'unavailable') counts.unavailable += 1
    else counts.pending += 1
    const identity = await ctx.db.get(source.sourceIdentityId)
    const excerpt = status === 'user_accepted' && source.rightsStatus === 'permitted' && source.evidencePurgedAt === undefined
      ? await ctx.db.query('learnSourceExcerpts').withIndex('by_userId_and_sourceSnapshotId_and_evidencePurgedAt', q => q.eq('userId', userId).eq('sourceSnapshotId', source._id).eq('evidencePurgedAt', undefined)).first()
      : null
    items.push({
      _id: source._id,
      status: source.status,
      effectiveStatus: status,
      recordRevision: source.recordRevision ?? 1,
      publicLocator: source.publicLocator ?? null,
      origin: identity?.origin ?? null,
      title: identity?.title ?? null,
      retrievedAt: source.fetchedAt ?? null,
      excerpt: excerpt?.rightsStatus === 'permitted' && excerpt.evidencePurgedAt === undefined && excerpt.excerpt?.trim() ? { locator: excerpt.locator, text: excerpt.excerpt } : null,
      mappedObjectives: mappedBySource.get(String(source._id)) ?? [],
      rightsStatus: source.rightsStatus ?? null,
      conflictStatus: source.conflictStatus ?? null,
    })
  }
  return { items, counts }
}

async function planProjection(ctx: Parameters<typeof requireLearnV2QueryAccess>[0], userId: string, voidRow: VoidRow) {
  const roots = await ctx.db.query('studyPlans').withIndex('by_userId_and_learningVoidId', q => q.eq('userId', userId).eq('learningVoidId', voidRow._id)).take(2)
  if (roots.length > 1) throw new Error('Learn V2 study plan identity is ambiguous')
  const root = roots[0]
  if (!root) return { root: null, preview: null, accepted: null, sessions: [] }
  const revisions = await ctx.db.query('studyPlanRevisions').withIndex('by_userId_and_studyPlanId_and_revision', q => q.eq('userId', userId).eq('studyPlanId', root._id)).order('desc').take(MAX_REVISIONS + 1)
  if (revisions.length > MAX_REVISIONS) throw new Error('Learn V2 plan revisions exceed their bounded contract')
  const preview = revisions.find(row => row.status === 'draft') ?? null
  const accepted = root.activeRevisionId ? await ctx.db.get(root.activeRevisionId) : revisions.find(row => row.status === 'accepted') ?? null
  const sessions = accepted ? await ctx.db.query('studySessions').withIndex('by_userId_and_studyPlanRevisionId_and_scheduledStartAt', q => q.eq('userId', userId).eq('studyPlanRevisionId', accepted._id)).take(MAX_SESSIONS + 1) : []
  if (sessions.length > MAX_SESSIONS) throw new Error('Learn V2 sessions exceed their bounded contract')
  return { root, preview, accepted, sessions }
}

function nextAction(voidRow: VoidRow, blueprint: BlueprintRow | null, sourceCounts: Awaited<ReturnType<typeof sourceProjection>>, plan: Awaited<ReturnType<typeof planProjection>>) {
  if (voidRow.status === 'draft' || voidRow.status === 'sourcing') return 'source_selection'
  if (voidRow.status === 'source_review' && sourceCounts.counts.accepted === 0) return 'source_review'
  if (voidRow.status === 'source_review') return 'blueprint_generation'
  if (voidRow.status === 'map_review' && blueprint?.status !== 'accepted') return 'map_review'
  if (voidRow.status === 'calibration') return 'calibration'
  if (voidRow.status === 'plan_review' && !plan.preview) return 'plan_preview'
  if (voidRow.status === 'plan_review') return 'plan_acceptance'
  if (voidRow.status === 'scheduled' || voidRow.status === 'active') return plan.sessions.some(row => row.status === 'in_progress') ? 'mastery' : 'study_session'
  return voidRow.status
}

async function journey(ctx: Parameters<typeof requireLearnV2QueryAccess>[0], userId: string, voidRow: VoidRow, folder: Doc<'folders'>) {
  const blueprint = await currentBlueprint(ctx, userId, voidRow)
  const sources = await sourceProjection(ctx, userId, blueprint)
  const map = await mapProjection(ctx, userId, blueprint)
  const calibrationAttempts = blueprint ? await ctx.db.query('masteryAttempts').withIndex('by_userId_and_blueprintRevisionId_and_kind', q => q.eq('userId', userId).eq('blueprintRevisionId', blueprint._id).eq('kind', 'calibration')).take(8) : []
  const plan = await planProjection(ctx, userId, voidRow)
  const mastery = []
  for (const objective of map?.objectives ?? []) {
    const record = await ctx.db.query('masteryRecords').withIndex('by_userId_and_objectiveId', q => q.eq('userId', userId).eq('objectiveId', objective._id)).first()
    const attempts = await ctx.db.query('masteryAttempts').withIndex('by_userId_and_objectiveId_and_attemptedAt', q => q.eq('userId', userId).eq('objectiveId', objective._id)).order('desc').take(MAX_ATTEMPTS_PER_OBJECTIVE)
    mastery.push({ objectiveId: objective._id, record, attempts })
  }
  const calibrationItems = (map?.objectives ?? []).map(objective => {
    const rubric = objective.assessmentContract && typeof objective.assessmentContract === 'object' ? objective.assessmentContract : null
    return { objectiveId: objective._id, title: objective.title, capability: objective.capability, prompt: rubric && 'instructions' in rubric && typeof rubric.instructions === 'string' ? rubric.instructions : null, rubric }
  })
  return { folder, learningVoid: voidRow, currentBlueprint: blueprint, nextAction: nextAction(voidRow, blueprint, sources, plan), sources, map, calibration: { attempts: calibrationAttempts, items: calibrationItems, completed: voidRow.status !== 'calibration' && calibrationAttempts.length >= 3 }, plan, mastery }
}

export const listHub = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireLearnV2QueryAccess(ctx)
    const rows = await ctx.db.query('learningVoids').withIndex('by_userId', q => q.eq('userId', userId)).order('desc').take(MAX_VOIDS + 1)
    if (rows.length > MAX_VOIDS) throw new Error('Learn V2 Learning Void list exceeds its bounded contract')
    const items = []
    for (const row of rows) {
      const owned = await ownedVoid(ctx, userId, row._id)
      if (!owned) continue
      const blueprint = await currentBlueprint(ctx, userId, row)
      const sources = await sourceProjection(ctx, userId, blueprint)
      const plan = await planProjection(ctx, userId, row)
      items.push({ _id: row._id, title: row.title, status: row.status, revision: row.revision, folderId: row.folderId, blueprintRevisionId: blueprint?._id ?? null, nextAction: nextAction(row, blueprint, sources, plan), nextScheduledAt: plan.sessions.filter(session => session.status === 'planned' || session.status === 'ready').map(session => session.scheduledStartAt).sort((a, b) => a - b)[0] ?? null })
    }
    return { items }
  },
})

export const getMission = query({
  args: { learningVoidId: v.id('learningVoids') },
  handler: async (ctx, args) => {
    const userId = await requireLearnV2QueryAccess(ctx)
    const owned = await ownedVoid(ctx, userId, args.learningVoidId)
    return owned ? await journey(ctx, userId, owned.row, owned.folder) : null
  },
})

export const getCurrentMission = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireLearnV2QueryAccess(ctx)
    const rows = await ctx.db.query('learningVoids').withIndex('by_userId', q => q.eq('userId', userId)).order('desc').take(MAX_VOIDS + 1)
    if (rows.length > MAX_VOIDS) throw new Error('Learn V2 Learning Void list exceeds its bounded contract')
    const current = rows.find(row => !['completed', 'archived'].includes(row.status))
    if (!current) return null
    const owned = await ownedVoid(ctx, userId, current._id)
    return owned ? await journey(ctx, userId, owned.row, owned.folder) : null
  },
})
