import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { mutation, query, type MutationCtx } from './_generated/server'
import { requireLearnV2MutationAccess, requireLearnV2QueryAccess } from './lib/learnV2Access'
import { LEARN_V2_SCHEDULER_VERSION, rescheduleStudySessions, scheduleStudyPlan, type SchedulingPriority, type StudyPlanSchedulingInput } from '../shared/learn-v2-scheduling'

const MAX_IDEMPOTENCY_KEY_LENGTH = 128
const MAX_OBJECTIVES = 15
const MAX_SESSIONS = 600
const MAX_AVAILABILITY_WINDOWS = 28
const MAX_BLACKOUT_DATES = 90
const MAX_REVIEW_INTERVALS = 4

async function digest(value: unknown) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))))
  return `sha256:${[...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')}`
}

async function supportedSourceIds(ctx: MutationCtx, userId: string, objectiveId: Id<'learnObjectives'>) {
  const links = await ctx.db.query('learnObjectiveSources').withIndex('by_userId_and_objectiveId_and_sourceSnapshotId', q => q.eq('userId', userId).eq('objectiveId', objectiveId)).take(65)
  if (links.length > 64) throw new Error('Session content source scope is outside the bounded contract')
  const sourceIds: Id<'learnSourceSnapshots'>[] = []
  for (const link of links) {
    if (link.coverage === 'gap') continue
    const source = await ctx.db.get(link.sourceSnapshotId)
    if (source?.userId === userId && source.status === 'user_accepted' && source.effectiveStatus === 'user_accepted' && source.rightsStatus === 'permitted' && source.conflictStatus === 'clear' && source.evidencePurgedAt === undefined) sourceIds.push(source._id)
  }
  const unique = [...new Map(sourceIds.map(id => [String(id), id])).values()].sort((a, b) => String(a).localeCompare(String(b)))
  return unique
}

const schedulingInputValidator = v.object({
  version: v.literal('learn-v2.schedule-input.v1'), timezone: v.string(), startLocalDate: v.string(), targetLocalDate: v.union(v.string(), v.null()),
  sessionMinutes: v.number(), minRestMinutes: v.number(),
  availability: v.array(v.object({ weekday: v.number(), start: v.string(), end: v.string() })), blackoutDates: v.array(v.string()), reviewIntervalsDays: v.array(v.number()),
})

function fingerprint(command: string, args: Record<string, unknown>) { return JSON.stringify({ command, ...args }) }
function assertIdempotencyKey(key: string) {
  if (!key.trim()) throw new Error('Idempotency key must not be blank')
  if (key.length > MAX_IDEMPOTENCY_KEY_LENGTH) throw new Error(`Idempotency key must not exceed ${MAX_IDEMPOTENCY_KEY_LENGTH} characters`)
}
function assertPositiveInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a safe positive integer`)
}
function assertSchedulingPreferences(input: { availability: unknown[], blackoutDates: unknown[], reviewIntervalsDays: unknown[] }) {
  if (input.availability.length > MAX_AVAILABILITY_WINDOWS) throw new Error('Availability exceeds its bounded plan contract')
  if (input.blackoutDates.length > MAX_BLACKOUT_DATES) throw new Error('Blackout dates exceed their bounded plan contract')
  if (input.reviewIntervalsDays.length > MAX_REVIEW_INTERVALS) throw new Error('Review intervals exceed their bounded plan contract')
}
async function requireLiveVoid(ctx: MutationCtx, userId: string, id: Id<'learningVoids'>) {
  const row = await ctx.db.get(id)
  if (!row || row.userId !== userId) throw new Error('Learning Void not found')
  const folder = await ctx.db.get(row.folderId)
  if (!folder || folder.userId !== userId) throw new Error('Learning Void folder not found')
  return row
}
async function replay(ctx: MutationCtx, userId: string, key: string, requestFingerprint: string) {
  const row = await ctx.db.query('learnPlanCommandReceipts').withIndex('by_userId_and_idempotencyKey', q => q.eq('userId', userId).eq('idempotencyKey', key)).unique()
  if (!row) return null
  if (row.requestFingerprint !== requestFingerprint) throw new Error('Idempotency key was already used for a different request')
  await requireLiveVoid(ctx, userId, row.learningVoidId)
  return JSON.parse(row.response) as Record<string, unknown>
}
async function receipt(ctx: MutationCtx, data: { userId: string, learningVoidId: Id<'learningVoids'>, idempotencyKey: string, command: string, requestFingerprint: string, response: Record<string, unknown>, nowUtcMs: number }) {
  await ctx.db.insert('learnPlanCommandReceipts', { userId: data.userId, learningVoidId: data.learningVoidId, idempotencyKey: data.idempotencyKey, command: data.command, requestFingerprint: data.requestFingerprint, response: JSON.stringify(data.response), createdAt: data.nowUtcMs })
}
async function audit(ctx: MutationCtx, data: { userId: string, learningVoidId: Id<'learningVoids'>, studyPlanRevisionId?: Id<'studyPlanRevisions'>, studySessionId?: Id<'studySessions'>, reasonCode: string, details: Record<string, unknown>, nowUtcMs: number }) {
  await ctx.db.insert('learnPlanAuditEvents', { userId: data.userId, learningVoidId: data.learningVoidId, studyPlanRevisionId: data.studyPlanRevisionId, studySessionId: data.studySessionId, reasonCode: data.reasonCode, details: JSON.stringify(data.details), createdAt: data.nowUtcMs })
}
async function currentBlueprint(ctx: MutationCtx, userId: string, blueprintRevisionId: Id<'learnBlueprintRevisions'>, learningVoidId: Id<'learningVoids'>) {
  const blueprint = await ctx.db.get(blueprintRevisionId)
  if (!blueprint || blueprint.userId !== userId || blueprint.learningVoidId !== learningVoidId || blueprint.status !== 'accepted') throw new Error('Accepted Blueprint revision not found')
  const latest = await ctx.db.query('learnBlueprintRevisions').withIndex('by_userId_and_blueprintId_and_revision', q => q.eq('userId', userId).eq('blueprintId', blueprint.blueprintId)).order('desc').first()
  if (!latest || latest._id !== blueprint._id) throw new Error('Blueprint revision conflict')
  return blueprint
}
async function planForVoid(ctx: MutationCtx, userId: string, learningVoidId: Id<'learningVoids'>, now: number) {
  const existing = await ctx.db.query('studyPlans').withIndex('by_userId_and_learningVoidId', q => q.eq('userId', userId).eq('learningVoidId', learningVoidId)).take(2)
  if (existing.length > 1) throw new Error('Study plan identity is ambiguous')
  return existing[0] ?? { _id: await ctx.db.insert('studyPlans', { userId, learningVoidId, revision: 1, createdAt: now }) }
}
async function buildSchedulingInput(ctx: MutationCtx, userId: string, blueprint: Doc<'learnBlueprintRevisions'>, input: Omit<StudyPlanSchedulingInput, 'objectives'>): Promise<StudyPlanSchedulingInput> {
  const objectives = await ctx.db.query('learnObjectives').withIndex('by_userId_and_blueprintRevisionId_and_order', q => q.eq('userId', userId).eq('blueprintRevisionId', blueprint._id)).take(MAX_OBJECTIVES + 1)
  if (objectives.length === 0 || objectives.length > MAX_OBJECTIVES) throw new Error('Blueprint objectives are outside the bounded plan contract')
  const scheduledObjectives: StudyPlanSchedulingInput['objectives'] = []
  const retainedReviews: StudyPlanSchedulingInput['retainedReviews'] = []
  for (const objective of objectives) {
    const prerequisites = await ctx.db.query('learnObjectivePrerequisites').withIndex('by_userId_and_blueprintRevisionId_and_objectiveId', q => q.eq('userId', userId).eq('blueprintRevisionId', blueprint._id).eq('objectiveId', objective._id)).take(MAX_OBJECTIVES + 1)
    if (prerequisites.length > MAX_OBJECTIVES) throw new Error('Objective prerequisite set is outside the bounded plan contract')
    const record = await ctx.db.query('masteryRecords').withIndex('by_userId_and_objectiveId', q => q.eq('userId', userId).eq('objectiveId', objective._id)).first()
    scheduledObjectives.push({ id: String(objective._id), order: objective.order, estimatedMinutes: objective.estimatedMinutes ?? input.sessionMinutes, prerequisiteIds: prerequisites.map(row => String(row.prerequisiteObjectiveId)), priority: record?.schedulingPriority === 'remediation' ? 'prerequisite_remediation' : 'new_learning' })
    if (record?.state === 'independent' && record.firstIndependentPassAt !== undefined) {
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: input.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(record.firstIndependentPassAt)
      const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(row => row.type === type)?.value
      retainedReviews.push({ objectiveId: String(objective._id), independentLocalDate: `${value('year')}-${value('month')}-${value('day')}` })
    }
  }
  return { ...input, objectives: scheduledObjectives, retainedReviews }
}

export const createPlanPreview = mutation({
  args: { learningVoidId: v.id('learningVoids'), blueprintRevisionId: v.id('learnBlueprintRevisions'), expectedVoidRevision: v.number(), expectedBlueprintRecordRevision: v.number(), idempotencyKey: v.string(), schedulingInput: schedulingInputValidator },
  handler: async (ctx, args) => {
    assertPositiveInteger(args.expectedVoidRevision, 'Expected Learning Void revision'); assertPositiveInteger(args.expectedBlueprintRecordRevision, 'Expected Blueprint record revision'); assertIdempotencyKey(args.idempotencyKey)
    const userId = await requireLearnV2MutationAccess(ctx); const requestFingerprint = fingerprint('createPlanPreview', args)
    const prior = await replay(ctx, userId, args.idempotencyKey, requestFingerprint); if (prior) return prior
    const learningVoid = await requireLiveVoid(ctx, userId, args.learningVoidId)
    if (learningVoid.status !== 'plan_review' || learningVoid.revision !== args.expectedVoidRevision) throw new Error('Learning Void is not ready for plan preview')
    const blueprint = await currentBlueprint(ctx, userId, args.blueprintRevisionId, learningVoid._id)
    if (blueprint.recordRevision !== args.expectedBlueprintRecordRevision) throw new Error('Blueprint revision conflict')
    const now = Date.now()
    assertSchedulingPreferences(args.schedulingInput)
    const schedulingInput = await buildSchedulingInput(ctx, userId, blueprint, { ...args.schedulingInput, nowUtcMs: now, retainedReviews: [] })
    const result = scheduleStudyPlan(schedulingInput)
    const existingPlans = await ctx.db.query('studyPlans').withIndex('by_userId_and_learningVoidId', q => q.eq('userId', userId).eq('learningVoidId', learningVoid._id)).take(2)
    if (existingPlans.length > 0) throw new Error('Initial plan preview already exists; use editPlanPreview')
    const plan = await planForVoid(ctx, userId, learningVoid._id, now)
    const latest = await ctx.db.query('studyPlanRevisions').withIndex('by_userId_and_studyPlanId_and_revision', q => q.eq('userId', userId).eq('studyPlanId', plan._id)).order('desc').first()
    const revision = (latest?.revision ?? 0) + 1
    const id = await ctx.db.insert('studyPlanRevisions', { userId, studyPlanId: plan._id, learningVoidId: learningVoid._id, revision, recordRevision: 1, status: 'draft', blueprintRevisionId: blueprint._id, blueprintRecordRevision: blueprint.recordRevision, schedulerVersion: LEARN_V2_SCHEDULER_VERSION, timezone: schedulingInput.timezone, inputSnapshot: JSON.stringify(schedulingInput), resultSnapshot: JSON.stringify(result), feasibility: result.status, createdAt: now, updatedAt: now })
    const response = { _id: id, status: 'draft' as const, revision, recordRevision: 1, feasibility: result.status, schedulerVersion: LEARN_V2_SCHEDULER_VERSION, reasonCodes: result.reasonCodes }
    await audit(ctx, { userId, learningVoidId: learningVoid._id, studyPlanRevisionId: id, reasonCode: result.status === 'feasible' ? 'preview_feasible' : 'preview_infeasible', details: { schedulerVersion: LEARN_V2_SCHEDULER_VERSION, timezone: schedulingInput.timezone, offsetPolicy: 'placement_pinned', reasonCodes: result.reasonCodes }, nowUtcMs: now })
    await receipt(ctx, { userId, learningVoidId: learningVoid._id, idempotencyKey: args.idempotencyKey, command: 'createPlanPreview', requestFingerprint, response, nowUtcMs: now })
    return response
  },
})

export const editPlanPreview = mutation({
  args: { studyPlanRevisionId: v.id('studyPlanRevisions'), expectedPlanRecordRevision: v.number(), expectedVoidRevision: v.number(), expectedBlueprintRecordRevision: v.number(), changeReason: v.union(v.literal('availability_changed'), v.literal('deadline_changed'), v.literal('session_length_changed')), idempotencyKey: v.string(), schedulingInput: schedulingInputValidator },
  handler: async (ctx, args) => {
    assertPositiveInteger(args.expectedPlanRecordRevision, 'Expected plan record revision'); assertPositiveInteger(args.expectedVoidRevision, 'Expected Learning Void revision'); assertPositiveInteger(args.expectedBlueprintRecordRevision, 'Expected Blueprint record revision'); assertIdempotencyKey(args.idempotencyKey)
    const userId = await requireLearnV2MutationAccess(ctx); const requestFingerprint = fingerprint('editPlanPreview', args)
    const source = await ctx.db.get(args.studyPlanRevisionId); if (!source || source.userId !== userId) throw new Error('Study-plan preview not found')
    const prior = await replay(ctx, userId, args.idempotencyKey, requestFingerprint); if (prior) return prior
    const learningVoid = await requireLiveVoid(ctx, userId, source.learningVoidId)
    if (learningVoid.status !== 'plan_review' || learningVoid.revision !== args.expectedVoidRevision || source.status !== 'draft' || source.recordRevision !== args.expectedPlanRecordRevision) throw new Error('Plan preview is not ready for editing')
    const latest = await ctx.db.query('studyPlanRevisions').withIndex('by_userId_and_studyPlanId_and_revision', q => q.eq('userId', userId).eq('studyPlanId', source.studyPlanId)).order('desc').first()
    if (!latest || latest._id !== source._id) throw new Error('Plan preview is not the latest draft')
    if (!source.blueprintRevisionId) throw new Error('Plan preview is missing its Blueprint pin')
    const blueprint = await currentBlueprint(ctx, userId, source.blueprintRevisionId, learningVoid._id)
    if (blueprint.recordRevision !== args.expectedBlueprintRecordRevision) throw new Error('Blueprint revision conflict')
    assertSchedulingPreferences(args.schedulingInput)
    const now = Date.now(); const schedulingInput = await buildSchedulingInput(ctx, userId, blueprint, { ...args.schedulingInput, nowUtcMs: now, retainedReviews: [] }); const result = scheduleStudyPlan(schedulingInput)
    await ctx.db.patch(source._id, { status: 'superseded', recordRevision: (source.recordRevision ?? 0) + 1, updatedAt: now })
    const id = await ctx.db.insert('studyPlanRevisions', { userId, studyPlanId: source.studyPlanId, learningVoidId: learningVoid._id, revision: source.revision + 1, recordRevision: 1, status: 'draft', parentRevisionId: source._id, changeReason: args.changeReason, blueprintRevisionId: blueprint._id, blueprintRecordRevision: blueprint.recordRevision, schedulerVersion: LEARN_V2_SCHEDULER_VERSION, timezone: schedulingInput.timezone, inputSnapshot: JSON.stringify(schedulingInput), resultSnapshot: JSON.stringify(result), feasibility: result.status, createdAt: now, updatedAt: now })
    const response = { _id: id, status: 'draft' as const, revision: source.revision + 1, recordRevision: 1, feasibility: result.status, parentRevisionId: source._id }
    await audit(ctx, { userId, learningVoidId: learningVoid._id, studyPlanRevisionId: id, reasonCode: 'preview_edited', details: { parentRevisionId: source._id, changeReason: args.changeReason, schedulerVersion: LEARN_V2_SCHEDULER_VERSION }, nowUtcMs: now })
    await receipt(ctx, { userId, learningVoidId: learningVoid._id, idempotencyKey: args.idempotencyKey, command: 'editPlanPreview', requestFingerprint, response, nowUtcMs: now })
    return response
  },
})

export const acceptPlanPreview = mutation({
  args: { studyPlanRevisionId: v.id('studyPlanRevisions'), expectedVoidRevision: v.number(), expectedPlanRecordRevision: v.number(), idempotencyKey: v.string() },
  handler: async (ctx, args) => {
    assertPositiveInteger(args.expectedVoidRevision, 'Expected Learning Void revision'); assertPositiveInteger(args.expectedPlanRecordRevision, 'Expected plan record revision'); assertIdempotencyKey(args.idempotencyKey)
    const userId = await requireLearnV2MutationAccess(ctx); const requestFingerprint = fingerprint('acceptPlanPreview', args)
    const planRevision = await ctx.db.get(args.studyPlanRevisionId)
    if (!planRevision || planRevision.userId !== userId) throw new Error('Study-plan preview not found')
    const prior = await replay(ctx, userId, args.idempotencyKey, requestFingerprint); if (prior) return prior
    const learningVoid = await requireLiveVoid(ctx, userId, planRevision.learningVoidId)
    if (learningVoid.status !== 'plan_review' || learningVoid.revision !== args.expectedVoidRevision || planRevision.status !== 'draft' || planRevision.feasibility !== 'feasible' || planRevision.recordRevision !== args.expectedPlanRecordRevision) throw new Error('Plan preview is not ready for acceptance')
    const latest = await ctx.db.query('studyPlanRevisions').withIndex('by_userId_and_studyPlanId_and_revision', q => q.eq('userId', userId).eq('studyPlanId', planRevision.studyPlanId)).order('desc').first()
    if (!latest || latest._id !== planRevision._id) throw new Error('Plan preview is not the latest plan revision')
    if (!planRevision.blueprintRevisionId) throw new Error('Plan preview is missing its Blueprint pin')
    const blueprint = await currentBlueprint(ctx, userId, planRevision.blueprintRevisionId, learningVoid._id)
    if (blueprint.recordRevision !== planRevision.blueprintRecordRevision) throw new Error('Blueprint revision conflict')
    const pinnedInput = JSON.parse(planRevision.inputSnapshot ?? '{}') as StudyPlanSchedulingInput
    const currentObjectives = await ctx.db.query('learnObjectives').withIndex('by_userId_and_blueprintRevisionId_and_order', q => q.eq('userId', userId).eq('blueprintRevisionId', blueprint._id)).take(MAX_OBJECTIVES + 1)
    if (currentObjectives.length === 0 || currentObjectives.length > MAX_OBJECTIVES || new Set(pinnedInput.objectives?.map(row => row.id)).size !== currentObjectives.length || currentObjectives.some(row => !pinnedInput.objectives?.some(pinned => pinned.id === String(row._id)))) throw new Error('Plan preview objective scope conflict')
    const result = JSON.parse(planRevision.resultSnapshot ?? '{}') as ReturnType<typeof scheduleStudyPlan>
    if (result.status !== 'feasible' || !Array.isArray(result.placements) || result.placements.length > MAX_SESSIONS) throw new Error('Plan preview result is invalid')
    const now = Date.now()
    if (result.placements.some(placement => placement.startUtcMs <= now)) throw new Error('Plan preview contains a past placement')
    await ctx.db.patch(planRevision._id, { status: 'accepted', recordRevision: (planRevision.recordRevision ?? 0) + 1, acceptedAt: now, updatedAt: now })
    await ctx.db.patch(learningVoid._id, { status: 'scheduled', revision: learningVoid.revision + 1, lastIdempotencyKey: args.idempotencyKey, updatedAt: now })
    await ctx.db.patch(planRevision.studyPlanId, { activeRevisionId: planRevision._id, updatedAt: now })
    const initialSessionIds: Id<'studySessions'>[] = []
    for (const placement of result.placements) initialSessionIds.push(await ctx.db.insert('studySessions', { userId, studyPlanRevisionId: planRevision._id, primaryObjectiveId: placement.objectiveId as Id<'learnObjectives'>, placementId: placement.id, status: 'planned', revision: 1, scheduledStartAt: placement.startUtcMs, scheduledEndAt: placement.endUtcMs, timezone: planRevision.timezone, offsetMinutes: placement.offsetMinutes, placementKind: placement.kind, schedulingPriority: placement.priority, schedulerVersion: planRevision.schedulerVersion }))
    const firstTwo = initialSessionIds.map((id, index) => ({ id, at: result.placements[index]!.startUtcMs })).sort((a, b) => a.at - b.at || String(a.id).localeCompare(String(b.id))).slice(0, 2)
    for (const [index, item] of firstTwo.entries()) {
      const session = await ctx.db.get(item.id)
      if (!session) throw new Error('Session shell disappeared')
      const supportIds = await supportedSourceIds(ctx, userId, session.primaryObjectiveId)
      const inputDigest = await digest({ planRevisionId: String(planRevision._id), sessionId: String(session._id), sessionRevision: session.revision, objectiveId: String(session.primaryObjectiveId), sourceIds: supportIds.map(String).sort() })
      const jobId = await ctx.db.insert('learnJobs', { userId, learningVoidId: learningVoid._id, blueprintRevisionId: blueprint._id, studyPlanRevisionId: planRevision._id, studySessionId: session._id, type: 'session_content_generation', status: 'queued', revision: 1, idempotencyKey: `session-content:${planRevision._id}:${index}`, requestFingerprint: inputDigest, inputDigest, expectedVoidRevision: learningVoid.revision + 1, expectedBlueprintRecordRevision: blueprint.recordRevision, expectedSessionRevision: 1, attempts: 0, dispatchSupportingSourceSnapshotIds: supportIds, providerEnabled: process.env.LEARN_V2_SESSION_CONTENT_PROVIDER_ENABLED === 'true', providerModel: process.env.LEARN_V2_SESSION_CONTENT_MODEL?.trim() || undefined, providerPolicyVersion: 'learn-v2.session-content-provider.v1', createdAt: now, updatedAt: now })
      await ctx.scheduler.runAfter(0, internal.learnV2SessionContent.executeSessionContentGeneration, { tokenIdentifier: userId, jobId, expectedRevision: 1 })
    }
    const response = { _id: planRevision._id, status: 'accepted' as const, voidStatus: 'scheduled' as const, sessionCount: result.placements.length, recordRevision: (planRevision.recordRevision ?? 0) + 1 }
    await audit(ctx, { userId, learningVoidId: learningVoid._id, studyPlanRevisionId: planRevision._id, reasonCode: 'preview_accepted', details: { blueprintRevisionId: planRevision.blueprintRevisionId, schedulerVersion: planRevision.schedulerVersion, timezone: planRevision.timezone }, nowUtcMs: now })
    await receipt(ctx, { userId, learningVoidId: learningVoid._id, idempotencyKey: args.idempotencyKey, command: 'acceptPlanPreview', requestFingerprint, response, nowUtcMs: now })
    return response
  },
})

export const markExpiredSessionsMissed = mutation({
  args: { learningVoidId: v.id('learningVoids'), idempotencyKey: v.string() },
  handler: async (ctx, args) => {
    assertIdempotencyKey(args.idempotencyKey)
    const now = Date.now()
    const userId = await requireLearnV2MutationAccess(ctx); const requestFingerprint = fingerprint('markExpiredSessionsMissed', args)
    const prior = await replay(ctx, userId, args.idempotencyKey, requestFingerprint); if (prior) return prior
    const learningVoid = await requireLiveVoid(ctx, userId, args.learningVoidId)
    const plans = await ctx.db.query('studyPlans').withIndex('by_userId_and_learningVoidId', q => q.eq('userId', userId).eq('learningVoidId', learningVoid._id)).take(2)
    const activeRevisionId = plans.length === 1 ? plans[0]!.activeRevisionId : undefined
    if (!activeRevisionId) throw new Error('Current active Study Plan revision not found')
    const missedSessionIds: Id<'studySessions'>[] = []
    const revision = await ctx.db.get(activeRevisionId)
    if (!revision || revision.userId !== userId || revision.studyPlanId !== plans[0]!._id) throw new Error('Current active Study Plan revision not found')
    const sessions = await ctx.db.query('studySessions').withIndex('by_userId_and_studyPlanRevisionId_and_scheduledStartAt', q => q.eq('userId', userId).eq('studyPlanRevisionId', revision._id)).take(MAX_SESSIONS + 1)
    if (sessions.length > MAX_SESSIONS) throw new Error('Study plan session count is outside the bounded contract')
    for (const session of sessions) if ((session.status === 'planned' || session.status === 'ready') && (session.scheduledEndAt ?? session.scheduledStartAt) < now) {
      await ctx.db.patch(session._id, { status: 'missed', revision: session.revision + 1, missedAt: now, auditReasonCode: 'session_expired' }); missedSessionIds.push(session._id)
      await audit(ctx, { userId, learningVoidId: learningVoid._id, studyPlanRevisionId: revision._id, studySessionId: session._id, reasonCode: 'session_expired', details: { priorStatus: session.status, scheduledEndAt: session.scheduledEndAt ?? session.scheduledStartAt }, nowUtcMs: now })
    }
    const response = { missedSessionIds }
    await receipt(ctx, { userId, learningVoidId: learningVoid._id, idempotencyKey: args.idempotencyKey, command: 'markExpiredSessionsMissed', requestFingerprint, response, nowUtcMs: now })
    return response
  },
})

export const markStudySessionMissed = mutation({
  args: { studySessionId: v.id('studySessions'), expectedSessionRevision: v.number(), idempotencyKey: v.string() },
  handler: async (ctx, args) => {
    assertPositiveInteger(args.expectedSessionRevision, 'Expected Study Session revision'); assertIdempotencyKey(args.idempotencyKey)
    const userId = await requireLearnV2MutationAccess(ctx); const requestFingerprint = fingerprint('markStudySessionMissed', args)
    const session = await ctx.db.get(args.studySessionId); if (!session || session.userId !== userId) throw new Error('Study Session not found')
    const plan = await ctx.db.get(session.studyPlanRevisionId); if (!plan || plan.userId !== userId) throw new Error('Study-plan revision not found')
    const planRoot = await ctx.db.get(plan.studyPlanId)
    if (!planRoot || planRoot.userId !== userId || planRoot.activeRevisionId !== plan._id) throw new Error('Study-plan revision is not current')
    const prior = await replay(ctx, userId, args.idempotencyKey, requestFingerprint); if (prior) return prior
    const learningVoid = await requireLiveVoid(ctx, userId, plan.learningVoidId); const now = Date.now()
    if (session.revision !== args.expectedSessionRevision || !['planned', 'ready'].includes(session.status)) throw new Error('Study Session revision conflict')
    if ((session.scheduledEndAt ?? session.scheduledStartAt) >= now) throw new Error('Future Study Session cannot be marked missed')
    await ctx.db.patch(session._id, { status: 'missed', revision: session.revision + 1, missedAt: now, auditReasonCode: 'session_expired' })
    const response = { _id: session._id, status: 'missed' as const, revision: session.revision + 1 }
    await audit(ctx, { userId, learningVoidId: learningVoid._id, studyPlanRevisionId: plan._id, studySessionId: session._id, reasonCode: 'session_expired', details: { scheduledEndAt: session.scheduledEndAt ?? session.scheduledStartAt }, nowUtcMs: now })
    await receipt(ctx, { userId, learningVoidId: learningVoid._id, idempotencyKey: args.idempotencyKey, command: 'markStudySessionMissed', requestFingerprint, response, nowUtcMs: now })
    return response
  },
})

export const reflowFutureIncomplete = mutation({
  args: { studyPlanRevisionId: v.id('studyPlanRevisions'), expectedPlanRecordRevision: v.number(), idempotencyKey: v.string() },
  handler: async (ctx, args) => {
    assertPositiveInteger(args.expectedPlanRecordRevision, 'Expected plan record revision'); assertIdempotencyKey(args.idempotencyKey)
    const now = Date.now()
    const userId = await requireLearnV2MutationAccess(ctx); const requestFingerprint = fingerprint('reflowFutureIncomplete', args)
    const plan = await ctx.db.get(args.studyPlanRevisionId); if (!plan || plan.userId !== userId) throw new Error('Study-plan revision not found')
    const prior = await replay(ctx, userId, args.idempotencyKey, requestFingerprint); if (prior) return prior
    const learningVoid = await requireLiveVoid(ctx, userId, plan.learningVoidId)
    if (plan.recordRevision !== args.expectedPlanRecordRevision || !['accepted', 'active'].includes(plan.status)) throw new Error('Study-plan revision conflict')
    const planRoot = await ctx.db.get(plan.studyPlanId)
    if (!planRoot || planRoot.userId !== userId || planRoot.activeRevisionId !== plan._id) throw new Error('Study-plan revision is not current')
    const sessions = await ctx.db.query('studySessions').withIndex('by_userId_and_studyPlanRevisionId_and_scheduledStartAt', q => q.eq('userId', userId).eq('studyPlanRevisionId', plan._id)).take(MAX_SESSIONS + 1)
    if (sessions.length > MAX_SESSIONS) throw new Error('Study plan session count is outside the bounded contract')
    const storedInput = JSON.parse(plan.inputSnapshot ?? '{}') as StudyPlanSchedulingInput
    const validPriorities = new Set<SchedulingPriority>(['overdue_retained_review', 'prerequisite_remediation', 'due_review', 'new_learning', 'optional_enrichment'])
    const reflow = rescheduleStudySessions({
      version: 'learn-v2.session-reflow-input.v1',
      nowUtcMs: now,
      schedulingInput: storedInput,
      sessions: sessions.map((session, index) => {
        if (!session.placementId || !session.scheduledEndAt || !session.placementKind || !session.schedulingPriority || !validPriorities.has(session.schedulingPriority as SchedulingPriority)) throw new Error('Study Session is missing its scheduling pin')
        return { id: String(session._id), placementId: session.placementId, objectiveId: String(session.primaryObjectiveId), objectiveOrder: index, kind: session.placementKind, priority: session.schedulingPriority as SchedulingPriority, status: session.status, scheduledStartAt: session.scheduledStartAt, scheduledEndAt: session.scheduledEndAt }
      }),
    })
    for (const sessionId of reflow.replacedSessionIds) {
      const session = sessions.find(row => String(row._id) === sessionId)
      if (!session) throw new Error('Reflow session disappeared')
      if (session.status !== 'missed') await ctx.db.patch(session._id, { status: 'needs_reschedule', revision: session.revision + 1, auditReasonCode: 'future_incomplete_reflow' })
      await audit(ctx, { userId, learningVoidId: learningVoid._id, studyPlanRevisionId: plan._id, studySessionId: session._id, reasonCode: session.status === 'missed' ? 'missed_session_replacement' : 'future_incomplete_reflow', details: { priorStatus: session.status, scheduledStartAt: session.scheduledStartAt }, nowUtcMs: now })
    }
    const successorId = await ctx.db.insert('studyPlanRevisions', { userId, studyPlanId: plan.studyPlanId, learningVoidId: learningVoid._id, revision: plan.revision + 1, recordRevision: 1, status: 'accepted', parentRevisionId: plan._id, changeReason: 'future_incomplete_reflow', blueprintRevisionId: plan.blueprintRevisionId, blueprintRecordRevision: plan.blueprintRecordRevision, schedulerVersion: LEARN_V2_SCHEDULER_VERSION, timezone: storedInput.timezone, inputSnapshot: JSON.stringify({ ...storedInput, nowUtcMs: now }), resultSnapshot: JSON.stringify(reflow), feasibility: 'feasible', createdAt: now, acceptedAt: now, updatedAt: now })
    const generationCandidates: Array<{ id: Id<'studySessions'>, objectiveId: Id<'learnObjectives'>, revision: number, scheduledStartAt: number }> = []
    for (const sessionId of reflow.replacedSessionIds) {
      const session = sessions.find(row => String(row._id) === sessionId)
      if (!session) throw new Error('Reflow session disappeared')
      const placement = reflow.replacements.find(row => row.id === session.placementId)
      if (!placement) throw new Error('Future incomplete session has no replacement placement')
      const successorSessionId = await ctx.db.insert('studySessions', { userId, studyPlanRevisionId: successorId, primaryObjectiveId: session.primaryObjectiveId, placementId: placement.id, status: 'planned', revision: 1, scheduledStartAt: placement.startUtcMs, scheduledEndAt: placement.endUtcMs, timezone: storedInput.timezone, offsetMinutes: placement.offsetMinutes, placementKind: placement.kind, schedulingPriority: placement.priority, schedulerVersion: LEARN_V2_SCHEDULER_VERSION, auditReasonCode: 'future_incomplete_reflow' })
      generationCandidates.push({ id: successorSessionId, objectiveId: session.primaryObjectiveId, revision: 1, scheduledStartAt: placement.startUtcMs })
    }
    const carriedStatuses = new Set(['planned', 'ready', 'in_progress', 'blocked', 'generation_failed', 'needs_reschedule'])
    for (const sessionId of reflow.preservedSessionIds) {
      const session = sessions.find(row => String(row._id) === sessionId)
      if (!session || session.scheduledEndAt === undefined || session.scheduledEndAt <= now || !carriedStatuses.has(session.status)) continue
      // Content belongs to the immutable old session identity. A successor
      // shell must regenerate rather than exposing `ready` without content.
      const successorSessionId = await ctx.db.insert('studySessions', { userId, studyPlanRevisionId: successorId, primaryObjectiveId: session.primaryObjectiveId, placementId: session.placementId, status: session.status === 'ready' ? 'planned' : session.status, revision: session.status === 'ready' ? 1 : session.revision, scheduledStartAt: session.scheduledStartAt, scheduledEndAt: session.scheduledEndAt, timezone: session.timezone, offsetMinutes: session.offsetMinutes, placementKind: session.placementKind, schedulingPriority: session.schedulingPriority, schedulerVersion: session.schedulerVersion, auditReasonCode: session.status === 'ready' ? 'ready_content_regeneration_required' : 'preserved_during_reflow' })
      if (session.status === 'ready' || session.status === 'planned') generationCandidates.push({ id: successorSessionId, objectiveId: session.primaryObjectiveId, revision: session.status === 'ready' ? 1 : session.revision, scheduledStartAt: session.scheduledStartAt })
    }
    if (plan.blueprintRevisionId) {
      for (const session of generationCandidates.sort((a, b) => a.scheduledStartAt - b.scheduledStartAt || String(a.id).localeCompare(String(b.id))).slice(0, 2)) {
        const sourceIds = await supportedSourceIds(ctx, userId, session.objectiveId)
        const inputDigest = await digest({ planRevisionId: String(successorId), sessionId: String(session.id), sessionRevision: session.revision, objectiveId: String(session.objectiveId), sourceIds: sourceIds.map(String).sort() })
        const jobId = await ctx.db.insert('learnJobs', { userId, learningVoidId: learningVoid._id, blueprintRevisionId: plan.blueprintRevisionId, studyPlanRevisionId: successorId, studySessionId: session.id, type: 'session_content_generation', status: 'queued', revision: 1, idempotencyKey: `session-content:${successorId}:${session.id}`, requestFingerprint: inputDigest, inputDigest, expectedVoidRevision: learningVoid.revision, expectedBlueprintRecordRevision: plan.blueprintRecordRevision, expectedSessionRevision: session.revision, attempts: 0, dispatchSupportingSourceSnapshotIds: sourceIds, providerEnabled: process.env.LEARN_V2_SESSION_CONTENT_PROVIDER_ENABLED === 'true', providerModel: process.env.LEARN_V2_SESSION_CONTENT_MODEL?.trim() || undefined, providerPolicyVersion: 'learn-v2.session-content-provider.v1', createdAt: now, updatedAt: now })
        await ctx.scheduler.runAfter(0, internal.learnV2SessionContent.executeSessionContentGeneration, { tokenIdentifier: userId, jobId, expectedRevision: 1 })
      }
    }
    await ctx.db.patch(plan._id, { status: 'superseded', recordRevision: (plan.recordRevision ?? 0) + 1, updatedAt: now })
    await ctx.db.patch(planRoot._id, { activeRevisionId: successorId, updatedAt: now })
    const response = { successorPlanRevisionId: successorId, changedSessionIds: reflow.replacedSessionIds, preservedSessionIds: reflow.preservedSessionIds, recordRevision: 1 }
    await audit(ctx, { userId, learningVoidId: learningVoid._id, studyPlanRevisionId: successorId, reasonCode: 'future_incomplete_reflow_accepted', details: { ...response, parentRevisionId: plan._id }, nowUtcMs: now })
    await receipt(ctx, { userId, learningVoidId: learningVoid._id, idempotencyKey: args.idempotencyKey, command: 'reflowFutureIncomplete', requestFingerprint, response, nowUtcMs: now })
    return response
  },
})

export const getPlanPreview = query({
  args: { studyPlanRevisionId: v.id('studyPlanRevisions') },
  handler: async (ctx, args) => {
    const userId = await requireLearnV2QueryAccess(ctx); const row = await ctx.db.get(args.studyPlanRevisionId)
    if (!row || row.userId !== userId) return null
    const voidRow = await ctx.db.get(row.learningVoidId); const folder = voidRow && await ctx.db.get(voidRow.folderId)
    return voidRow?.userId === userId && folder?.userId === userId ? row : null
  },
})
