import { v } from 'convex/values'
import type { Doc, Id } from './_generated/dataModel'
import { internalMutation, mutation, type MutationCtx } from './_generated/server'
import { hasLearnV2Access, requireLearnV2MutationAccess } from './lib/learnV2Access'
import { LEARN_V2_BLUEPRINT_LIMITS, validateLearnV2BlueprintCandidate } from '../shared/learn-v2-blueprint'

const MAX_IDEMPOTENCY_KEY_LENGTH = 128
const MIN_CALIBRATION_ITEMS = 3
const MAX_CALIBRATION_ITEMS = 7

const assessmentContractValidator = v.object({
  version: v.literal('learn-v2.assessment.v1'),
  kind: v.union(v.literal('machine_checkable'), v.literal('bounded_rubric')),
  responseFormat: v.union(v.literal('short_text'), v.literal('structured')),
  instructions: v.string(),
  passingScorePercent: v.literal(80),
  criteria: v.array(v.object({ key: v.string(), description: v.string(), weightPercent: v.number() })),
})

const blueprintCandidateValidator = v.object({
  version: v.literal('learn-v2.blueprint-candidate.v1'),
  generatorVersion: v.string(),
  milestones: v.array(v.object({ key: v.string(), order: v.number(), title: v.string(), description: v.optional(v.string()) })),
  objectives: v.array(v.object({
    key: v.string(),
    milestoneKey: v.string(),
    order: v.number(),
    title: v.string(),
    capability: v.string(),
    estimatedMinutes: v.number(),
    coverage: v.union(v.literal('strong'), v.literal('partial'), v.literal('gap')),
    gapReason: v.optional(v.string()),
    sourceSnapshotIds: v.array(v.id('learnSourceSnapshots')),
    gapSourceSnapshotIds: v.optional(v.array(v.id('learnSourceSnapshots'))),
    prerequisiteObjectiveKeys: v.array(v.string()),
    assessmentContract: assessmentContractValidator,
  })),
})

function assertPositiveInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a safe positive integer`)
}

function assertIdempotencyKey(value: string) {
  if (!value.trim()) throw new Error('Idempotency key must not be blank')
  if (value.length > MAX_IDEMPOTENCY_KEY_LENGTH) throw new Error(`Idempotency key must not exceed ${MAX_IDEMPOTENCY_KEY_LENGTH} characters`)
}

function fingerprint(command: string, args: Record<string, unknown>) {
  return JSON.stringify({ command, ...args })
}

async function requireLiveVoid(ctx: MutationCtx, userId: string, learningVoidId: Id<'learningVoids'>) {
  const learningVoid = await ctx.db.get(learningVoidId)
  if (!learningVoid || learningVoid.userId !== userId) throw new Error('Learning Void not found')
  const folder = await ctx.db.get(learningVoid.folderId)
  if (!folder || folder.userId !== userId) throw new Error('Learning Void folder not found')
  return learningVoid
}

async function requireCurrentBlueprint(ctx: MutationCtx, userId: string, blueprintRevisionId: Id<'learnBlueprintRevisions'>) {
  const blueprint = await ctx.db.get(blueprintRevisionId)
  if (!blueprint || blueprint.userId !== userId) throw new Error('Blueprint revision not found')
  const latest = await ctx.db.query('learnBlueprintRevisions')
    .withIndex('by_userId_and_blueprintId_and_revision', q => q.eq('userId', userId).eq('blueprintId', blueprint.blueprintId))
    .order('desc').first()
  if (!latest || latest._id !== blueprint._id) throw new Error('Blueprint revision conflict')
  return blueprint
}

async function lifecycleReplay(ctx: MutationCtx, userId: string, idempotencyKey: string, requestFingerprint: string) {
  const receipt = await ctx.db.query('learnLifecycleReceipts')
    .withIndex('by_userId_and_idempotencyKey', q => q.eq('userId', userId).eq('idempotencyKey', idempotencyKey)).unique()
  if (!receipt) return null
  if (receipt.requestFingerprint !== requestFingerprint) throw new Error('Idempotency key was already used for a different request')
  await requireLiveVoid(ctx, userId, receipt.learningVoidId)
  return receipt
}

function blueprintOutcome(receipt: Pick<Doc<'learnLifecycleReceipts'>, 'blueprintRevisionId' | 'status' | 'blueprintRevisionOrdinal' | 'blueprintRecordRevision'>) {
  if (!receipt.blueprintRevisionId || !receipt.status || receipt.blueprintRevisionOrdinal === undefined || receipt.blueprintRecordRevision === undefined) throw new Error('Lifecycle receipt is incomplete')
  return { _id: receipt.blueprintRevisionId, status: receipt.status, revision: receipt.blueprintRevisionOrdinal, recordRevision: receipt.blueprintRecordRevision }
}

function voidOutcome(receipt: Pick<Doc<'learnLifecycleReceipts'>, 'learningVoidId' | 'status' | 'revision' | 'blueprintRevisionId'>) {
  if (!receipt.status) throw new Error('Lifecycle receipt is incomplete')
  return { _id: receipt.learningVoidId, status: receipt.status, revision: receipt.revision, activeBlueprintRevisionId: receipt.blueprintRevisionId ?? null }
}

async function scopedSources(ctx: MutationCtx, userId: string, blueprintRevisionId: Id<'learnBlueprintRevisions'>) {
  const rows = await ctx.db.query('learnSourceSnapshots')
    .withIndex('by_userId_and_blueprintRevisionId', q => q.eq('userId', userId).eq('blueprintRevisionId', blueprintRevisionId))
    .take(65)
  if (rows.length > 64) throw new Error('Blueprint source set exceeds its bounded contract')
  return rows
}

async function sourceCanSupport(ctx: MutationCtx, userId: string, blueprint: Doc<'learnBlueprintRevisions'>, source: Doc<'learnSourceSnapshots'>) {
  if ((source.effectiveStatus ?? source.status) !== 'user_accepted' || source.evidencePurgedAt !== undefined
    || source.rightsStatus === 'prohibited' || source.conflictStatus !== 'clear') return false
  if ((blueprint.generationSupportingSourceSnapshotIds ?? []).some(id => id === source._id)) return true
  if (source.objectKey && source.contentHash && source.sourceRevision) return true
  const excerpt = await ctx.db.query('learnSourceExcerpts')
    .withIndex('by_userId_and_sourceSnapshotId_and_evidencePurgedAt', q => q.eq('userId', userId).eq('sourceSnapshotId', source._id).eq('evidencePurgedAt', undefined))
    .first()
  return source.rightsStatus === 'permitted' && Boolean(excerpt?.excerpt?.trim())
}

async function clearMap(ctx: MutationCtx, userId: string, blueprintRevisionId: Id<'learnBlueprintRevisions'>) {
  const objectives = await ctx.db.query('learnObjectives')
    .withIndex('by_userId_and_blueprintRevisionId_and_order', q => q.eq('userId', userId).eq('blueprintRevisionId', blueprintRevisionId))
    .take(LEARN_V2_BLUEPRINT_LIMITS.maximumObjectives + 1)
  if (objectives.length > LEARN_V2_BLUEPRINT_LIMITS.maximumObjectives) throw new Error('Blueprint map exceeds its bounded contract')
  for (const objective of objectives) {
    const prerequisites = await ctx.db.query('learnObjectivePrerequisites')
      .withIndex('by_userId_and_blueprintRevisionId_and_objectiveId', q => q.eq('userId', userId).eq('blueprintRevisionId', blueprintRevisionId).eq('objectiveId', objective._id))
      .take(LEARN_V2_BLUEPRINT_LIMITS.maximumPrerequisiteEdges + 1)
    const links = await ctx.db.query('learnObjectiveSources')
      .withIndex('by_userId_and_objectiveId_and_sourceSnapshotId', q => q.eq('userId', userId).eq('objectiveId', objective._id))
      .take(LEARN_V2_BLUEPRINT_LIMITS.maximumSourcesPerObjective + 1)
    for (const row of prerequisites) await ctx.db.delete(row._id)
    for (const row of links) await ctx.db.delete(row._id)
    await ctx.db.delete(objective._id)
  }
  const milestones = await ctx.db.query('learnMilestones')
    .withIndex('by_userId_and_blueprintRevisionId_and_order', q => q.eq('userId', userId).eq('blueprintRevisionId', blueprintRevisionId))
    .take(LEARN_V2_BLUEPRINT_LIMITS.maximumMilestones + 1)
  if (milestones.length > LEARN_V2_BLUEPRINT_LIMITS.maximumMilestones) throw new Error('Blueprint map exceeds its bounded contract')
  for (const row of milestones) await ctx.db.delete(row._id)
}

export const replaceDraftMap = mutation({
  args: {
    blueprintRevisionId: v.id('learnBlueprintRevisions'),
    expectedRecordRevision: v.number(),
    expectedVoidRevision: v.number(),
    idempotencyKey: v.string(),
    candidate: blueprintCandidateValidator,
  },
  handler: async (ctx, args) => {
    assertPositiveInteger(args.expectedRecordRevision, 'Expected Blueprint record revision')
    assertPositiveInteger(args.expectedVoidRevision, 'Expected Learning Void revision')
    assertIdempotencyKey(args.idempotencyKey)
    const userId = await requireLearnV2MutationAccess(ctx)
    const requestFingerprint = fingerprint('replaceDraftMap', args)
    const replay = await lifecycleReplay(ctx, userId, args.idempotencyKey, requestFingerprint)
    if (replay) return blueprintOutcome(replay)
    const blueprint = await requireCurrentBlueprint(ctx, userId, args.blueprintRevisionId)
    const learningVoid = await requireLiveVoid(ctx, userId, blueprint.learningVoidId)
    if (blueprint.status !== 'draft' || learningVoid.status !== 'map_review') throw new Error('Blueprint draft is not ready for map editing')
    if (blueprint.recordRevision !== args.expectedRecordRevision || learningVoid.revision !== args.expectedVoidRevision) throw new Error('Blueprint revision conflict')
    const sources = await scopedSources(ctx, userId, blueprint._id)
    const supportingSourceIds = []
    for (const source of sources) if (await sourceCanSupport(ctx, userId, blueprint, source)) supportingSourceIds.push(String(source._id))
    const gapSourceIds = sources.filter(source => source.evidencePurgedAt === undefined && source.status !== 'rejected').map(source => String(source._id))
    const candidate = validateLearnV2BlueprintCandidate(args.candidate, supportingSourceIds, gapSourceIds)
    await clearMap(ctx, userId, blueprint._id)
    const milestoneIds = new Map<string, Id<'learnMilestones'>>()
    for (const milestone of candidate.milestones) {
      milestoneIds.set(milestone.key, await ctx.db.insert('learnMilestones', { userId, blueprintRevisionId: blueprint._id, order: milestone.order, title: milestone.title, description: milestone.description }))
    }
    const objectiveIds = new Map<string, Id<'learnObjectives'>>()
    for (const objective of candidate.objectives) {
      const milestoneId = milestoneIds.get(objective.milestoneKey)
      if (!milestoneId) throw new Error('Blueprint objective milestone disappeared')
      const objectiveId = await ctx.db.insert('learnObjectives', { userId, blueprintRevisionId: blueprint._id, milestoneId, order: objective.order, title: objective.title, capability: objective.capability, estimatedMinutes: objective.estimatedMinutes, coverage: objective.coverage, gapReason: objective.gapReason, assessmentContract: objective.assessmentContract })
      objectiveIds.set(objective.key, objectiveId)
      for (const sourceSnapshotId of objective.sourceSnapshotIds) await ctx.db.insert('learnObjectiveSources', { userId, objectiveId, sourceSnapshotId: sourceSnapshotId as Id<'learnSourceSnapshots'>, coverage: objective.coverage })
      for (const sourceSnapshotId of objective.gapSourceSnapshotIds) await ctx.db.insert('learnObjectiveSources', { userId, objectiveId, sourceSnapshotId: sourceSnapshotId as Id<'learnSourceSnapshots'>, coverage: 'gap' })
    }
    for (const objective of candidate.objectives) {
      const objectiveId = objectiveIds.get(objective.key)!
      for (const key of objective.prerequisiteObjectiveKeys) await ctx.db.insert('learnObjectivePrerequisites', { userId, blueprintRevisionId: blueprint._id, objectiveId, prerequisiteObjectiveId: objectiveIds.get(key)! })
    }
    const now = Date.now()
    const recordRevision = blueprint.recordRevision + 1
    await ctx.db.patch(blueprint._id, { status: 'map_review', recordRevision, generatorVersion: candidate.generatorVersion, updatedAt: now })
    await ctx.db.patch(learningVoid._id, { revision: learningVoid.revision + 1, lastIdempotencyKey: args.idempotencyKey, updatedAt: now })
    await ctx.db.insert('learnLifecycleReceipts', { userId, learningVoidId: learningVoid._id, idempotencyKey: args.idempotencyKey, command: 'replaceDraftMap', requestFingerprint, revision: recordRevision, status: 'map_review', blueprintRevisionId: blueprint._id, blueprintRevisionOrdinal: blueprint.revision, blueprintRecordRevision: recordRevision, createdAt: now })
    return { _id: blueprint._id, status: 'map_review' as const, revision: blueprint.revision, recordRevision }
  },
})

async function validateStoredMap(ctx: MutationCtx, userId: string, blueprint: Doc<'learnBlueprintRevisions'>) {
  const milestones = await ctx.db.query('learnMilestones').withIndex('by_userId_and_blueprintRevisionId_and_order', q => q.eq('userId', userId).eq('blueprintRevisionId', blueprint._id)).take(7)
  const objectives = await ctx.db.query('learnObjectives').withIndex('by_userId_and_blueprintRevisionId_and_order', q => q.eq('userId', userId).eq('blueprintRevisionId', blueprint._id)).take(16)
  if (milestones.length < 3 || milestones.length > 6 || objectives.length < 6 || objectives.length > 15) throw new Error('Blueprint map is incomplete')
  const milestoneIds = new Set(milestones.map(row => String(row._id)))
  const usedMilestoneIds = new Set<string>()
  const objectiveIds = new Set(objectives.map(row => String(row._id)))
  const graph = new Map(objectives.map(row => [String(row._id), [] as string[]]))
  let sourceLinkCount = 0
  let prerequisiteCount = 0
  for (const objective of objectives) {
    if (!objective.milestoneId || !milestoneIds.has(String(objective.milestoneId))) throw new Error('Blueprint objective milestone scope mismatch')
    usedMilestoneIds.add(String(objective.milestoneId))
    if (typeof objective.assessmentContract !== 'object' || objective.assessmentContract.version !== 'learn-v2.assessment.v1' || objective.assessmentContract.passingScorePercent !== 80) throw new Error('Blueprint assessment contract is invalid')
    const links = await ctx.db.query('learnObjectiveSources').withIndex('by_userId_and_objectiveId_and_sourceSnapshotId', q => q.eq('userId', userId).eq('objectiveId', objective._id)).take(LEARN_V2_BLUEPRINT_LIMITS.maximumSourcesPerObjective + 1)
    if (links.length > LEARN_V2_BLUEPRINT_LIMITS.maximumSourcesPerObjective) throw new Error('Blueprint objective source set exceeds its bounded contract')
    sourceLinkCount += links.length
    if (objective.coverage !== 'gap' && !links.some(link => link.coverage !== 'gap')) throw new Error('Blueprint objective lacks supporting evidence')
    for (const link of links) {
      const source = await ctx.db.get(link.sourceSnapshotId)
      if (!source || source.userId !== userId || source.blueprintRevisionId !== blueprint._id || source.evidencePurgedAt !== undefined) throw new Error('Blueprint objective evidence is unavailable')
      if (link.coverage !== 'gap' && !(await sourceCanSupport(ctx, userId, blueprint, source))) throw new Error('Blueprint objective evidence is unavailable')
    }
    const edges = await ctx.db.query('learnObjectivePrerequisites').withIndex('by_userId_and_blueprintRevisionId_and_objectiveId', q => q.eq('userId', userId).eq('blueprintRevisionId', blueprint._id).eq('objectiveId', objective._id)).take(LEARN_V2_BLUEPRINT_LIMITS.maximumPrerequisiteEdges + 1)
    prerequisiteCount += edges.length
    for (const edge of edges) {
      if (!objectiveIds.has(String(edge.prerequisiteObjectiveId))) throw new Error('Blueprint prerequisite scope mismatch')
      graph.get(String(objective._id))!.push(String(edge.prerequisiteObjectiveId))
    }
  }
  if (sourceLinkCount > LEARN_V2_BLUEPRINT_LIMITS.maximumObjectiveSourceLinks) throw new Error('Blueprint objective source set exceeds its bounded contract')
  if (prerequisiteCount > LEARN_V2_BLUEPRINT_LIMITS.maximumPrerequisiteEdges) throw new Error('Blueprint prerequisite set exceeds its bounded contract')
  if (usedMilestoneIds.size !== milestones.length) throw new Error('Each Blueprint milestone must contain an objective')
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string) => {
    if (visiting.has(id)) throw new Error('Blueprint prerequisite graph must be acyclic')
    if (visited.has(id)) return
    visiting.add(id)
    for (const prior of graph.get(id) ?? []) visit(prior)
    visiting.delete(id)
    visited.add(id)
  }
  for (const id of graph.keys()) visit(id)
}

export const acceptBlueprintMap = mutation({
  args: { blueprintRevisionId: v.id('learnBlueprintRevisions'), expectedRecordRevision: v.number(), expectedVoidRevision: v.number(), idempotencyKey: v.string() },
  handler: async (ctx, args) => {
    assertPositiveInteger(args.expectedRecordRevision, 'Expected Blueprint record revision')
    assertPositiveInteger(args.expectedVoidRevision, 'Expected Learning Void revision')
    assertIdempotencyKey(args.idempotencyKey)
    const userId = await requireLearnV2MutationAccess(ctx)
    const requestFingerprint = fingerprint('acceptBlueprintMap', args)
    const replay = await lifecycleReplay(ctx, userId, args.idempotencyKey, requestFingerprint)
    if (replay) return blueprintOutcome(replay)
    const blueprint = await requireCurrentBlueprint(ctx, userId, args.blueprintRevisionId)
    const learningVoid = await requireLiveVoid(ctx, userId, blueprint.learningVoidId)
    if (blueprint.status !== 'map_review' || learningVoid.status !== 'map_review') throw new Error('Blueprint map is not ready for acceptance')
    if (blueprint.recordRevision !== args.expectedRecordRevision || learningVoid.revision !== args.expectedVoidRevision) throw new Error('Blueprint revision conflict')
    await validateStoredMap(ctx, userId, blueprint)
    const now = Date.now()
    const recordRevision = blueprint.recordRevision + 1
    const voidRevision = learningVoid.revision + 1
    await ctx.db.patch(blueprint._id, { status: 'accepted', recordRevision, acceptedAt: now, updatedAt: now })
    await ctx.db.patch(learningVoid._id, { status: 'calibration', revision: voidRevision, lastIdempotencyKey: args.idempotencyKey, updatedAt: now })
    await ctx.db.insert('learnLifecycleReceipts', { userId, learningVoidId: learningVoid._id, idempotencyKey: args.idempotencyKey, command: 'acceptBlueprintMap', requestFingerprint, revision: voidRevision, status: 'accepted', blueprintRevisionId: blueprint._id, blueprintRevisionOrdinal: blueprint.revision, blueprintRecordRevision: recordRevision, createdAt: now })
    return { _id: blueprint._id, status: 'accepted' as const, revision: blueprint.revision, recordRevision }
  },
})

export const recordCalibrationAttempt = internalMutation({
  args: { tokenIdentifier: v.string(), blueprintRevisionId: v.id('learnBlueprintRevisions'), objectiveId: v.id('learnObjectives'), expectedBlueprintRecordRevision: v.number(), expectedVoidRevision: v.number(), idempotencyKey: v.string(), serverScorePercent: v.number(), usedHint: v.boolean(), usedReveal: v.boolean(), confidence: v.number(), rubricVersion: v.string() },
  handler: async (ctx, args) => {
    if (!(await hasLearnV2Access(ctx, args.tokenIdentifier))) throw new Error('Learn V2 access denied')
    assertIdempotencyKey(args.idempotencyKey)
    assertPositiveInteger(args.expectedBlueprintRecordRevision, 'Expected Blueprint record revision')
    assertPositiveInteger(args.expectedVoidRevision, 'Expected Learning Void revision')
    if (!Number.isFinite(args.serverScorePercent) || args.serverScorePercent < 0 || args.serverScorePercent > 100) throw new Error('Server score must be between 0 and 100')
    if (!Number.isSafeInteger(args.confidence) || args.confidence < 1 || args.confidence > 5) throw new Error('Confidence must be an integer from 1 to 5')
    if (!args.rubricVersion.trim() || args.rubricVersion.length > 96) throw new Error('Rubric version is invalid')
    const requestFingerprint = fingerprint('recordCalibrationAttempt', args)
    const prior = await ctx.db.query('masteryAttempts').withIndex('by_userId_and_idempotencyKey', q => q.eq('userId', args.tokenIdentifier).eq('idempotencyKey', args.idempotencyKey)).unique()
    if (prior) {
      if (prior.requestFingerprint !== requestFingerprint) throw new Error('Idempotency key was already used for a different request')
      return { attemptId: prior._id, result: prior.result, replayed: true }
    }
    const blueprint = await requireCurrentBlueprint(ctx, args.tokenIdentifier, args.blueprintRevisionId)
    const learningVoid = await requireLiveVoid(ctx, args.tokenIdentifier, blueprint.learningVoidId)
    if (blueprint.status !== 'accepted' || learningVoid.status !== 'calibration') throw new Error('Blueprint is not in calibration')
    if (blueprint.recordRevision !== args.expectedBlueprintRecordRevision || learningVoid.revision !== args.expectedVoidRevision) throw new Error('Calibration revision conflict')
    const objective = await ctx.db.get(args.objectiveId)
    if (!objective || objective.userId !== args.tokenIdentifier || objective.blueprintRevisionId !== blueprint._id) throw new Error('Calibration objective not found')
    const existing = await ctx.db.query('masteryAttempts').withIndex('by_userId_and_blueprintRevisionId_and_kind', q => q.eq('userId', args.tokenIdentifier).eq('blueprintRevisionId', blueprint._id).eq('kind', 'calibration')).take(MAX_CALIBRATION_ITEMS + 1)
    if (existing.length >= MAX_CALIBRATION_ITEMS) throw new Error('Calibration already has seven items')
    if (existing.some(row => row.objectiveId === objective._id)) throw new Error('Calibration objective was already attempted')
    const unassistedPass = args.serverScorePercent >= 80 && !args.usedHint && !args.usedReveal
    const result = unassistedPass ? 'provisionally_known' as const : 'learning' as const
    const schedulingPriority = unassistedPass ? 'deprioritized' as const : 'remediation' as const
    const now = Date.now()
    const attemptId = await ctx.db.insert('masteryAttempts', { userId: args.tokenIdentifier, blueprintRevisionId: blueprint._id, objectiveId: objective._id, kind: 'calibration', attemptedAt: now, idempotencyKey: args.idempotencyKey, requestFingerprint, serverScorePercent: args.serverScorePercent, usedHint: args.usedHint, usedReveal: args.usedReveal, confidence: args.confidence, rubricVersion: args.rubricVersion, result })
    const record = await ctx.db.query('masteryRecords').withIndex('by_userId_and_objectiveId', q => q.eq('userId', args.tokenIdentifier).eq('objectiveId', objective._id)).unique()
    if (record) await ctx.db.patch(record._id, { blueprintRevisionId: blueprint._id, state: result, schedulingPriority, recordRevision: (record.recordRevision ?? 0) + 1, updatedAt: now })
    else await ctx.db.insert('masteryRecords', { userId: args.tokenIdentifier, blueprintRevisionId: blueprint._id, objectiveId: objective._id, state: result, schedulingPriority, recordRevision: 1, updatedAt: now })
    return { attemptId, result, schedulingPriority, replayed: false }
  },
})

export const completeCalibration = mutation({
  args: { blueprintRevisionId: v.id('learnBlueprintRevisions'), expectedBlueprintRecordRevision: v.number(), expectedVoidRevision: v.number(), idempotencyKey: v.string() },
  handler: async (ctx, args) => {
    assertIdempotencyKey(args.idempotencyKey)
    assertPositiveInteger(args.expectedBlueprintRecordRevision, 'Expected Blueprint record revision')
    assertPositiveInteger(args.expectedVoidRevision, 'Expected Learning Void revision')
    const userId = await requireLearnV2MutationAccess(ctx)
    const requestFingerprint = fingerprint('completeCalibration', args)
    const replay = await lifecycleReplay(ctx, userId, args.idempotencyKey, requestFingerprint)
    if (replay) return voidOutcome(replay)
    const blueprint = await requireCurrentBlueprint(ctx, userId, args.blueprintRevisionId)
    const learningVoid = await requireLiveVoid(ctx, userId, blueprint.learningVoidId)
    if (blueprint.status !== 'accepted' || learningVoid.status !== 'calibration') throw new Error('Blueprint is not in calibration')
    if (blueprint.recordRevision !== args.expectedBlueprintRecordRevision || learningVoid.revision !== args.expectedVoidRevision) throw new Error('Calibration revision conflict')
    const attempts = await ctx.db.query('masteryAttempts').withIndex('by_userId_and_blueprintRevisionId_and_kind', q => q.eq('userId', userId).eq('blueprintRevisionId', blueprint._id).eq('kind', 'calibration')).take(MAX_CALIBRATION_ITEMS + 1)
    if (attempts.length < MIN_CALIBRATION_ITEMS || attempts.length > MAX_CALIBRATION_ITEMS) throw new Error('Calibration requires between three and seven items')
    if (new Set(attempts.map(row => String(row.objectiveId))).size !== attempts.length) throw new Error('Calibration objectives must be unique')
    const now = Date.now()
    const revision = learningVoid.revision + 1
    await ctx.db.patch(learningVoid._id, { status: 'plan_review', revision, lastIdempotencyKey: args.idempotencyKey, updatedAt: now })
    await ctx.db.insert('learnLifecycleReceipts', { userId, learningVoidId: learningVoid._id, idempotencyKey: args.idempotencyKey, command: 'completeCalibration', requestFingerprint, revision, status: 'plan_review', createdAt: now })
    return { _id: learningVoid._id, status: 'plan_review' as const, revision, activeBlueprintRevisionId: null }
  },
})
