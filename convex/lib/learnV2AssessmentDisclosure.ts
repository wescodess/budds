import { v, type PropertyValidators, type ObjectType } from 'convex/values'
import { z } from 'zod'
import type { Doc, Id } from '../_generated/dataModel'
import type { QueryCtx, MutationCtx } from '../_generated/server'
import { requireAuth } from './auth'
import {
  LEARN_V2_ASSESSMENT_DISCLOSURE_VERSION, learnAssessmentDisclosureContextSchema,
  projectAttemptHistory, projectDeliveredAssessment, projectObjectiveSummary, type LearnAssessmentDisclosureContext,
} from '../../shared/learn-v2-assessment-disclosure'
import { LEARN_V2_DELAYED_CHECK_VERSION, learnAssessmentPurposeSchema } from '../../shared/learn-v2-delayed-check'
import { learnAssessmentPinsSchema, learnV2ScopeSchema } from '../../shared/learn-v2-measurement'
import { masteryStateValidator } from '../../shared/learn-v2-mastery'
import { responseStateValidator } from './learnV2PublicContract'
import { adaptiveActivityFallbackForReason } from '../../shared/learn-adaptive-activity-registry'
import { adaptiveFixedNextPlanValidator, adaptiveOverrideOptionValidator } from '../../shared/learn-adaptive-controls'
import { hasAdaptiveExperienceAccess } from './adaptiveLearnAccess'
import { ADAPTIVE_V2_PILOT_MANIFEST } from '../../shared/adaptive-v2-pilot-policy'

type ReadCtx = QueryCtx | MutationCtx
export const disclosureLiterals = <const T extends string>(values: readonly T[]) => v.union(...values.map(value => v.literal(value)))
const nullableString = v.union(v.string(), v.null())
export const pageFields = { isDone: v.boolean(), continueCursor: v.string() }

// The validator is also the field allowlist; adding a storage field cannot
// enlarge a public document projection.
export function projectFields<T extends PropertyValidators>(fields: T, row: ObjectType<T>): ObjectType<T> {
  return Object.fromEntries(Object.keys(fields).flatMap(key => {
    const value = row[key as keyof typeof row]
    return value === undefined ? [] : [[key, value]]
  })) as ObjectType<T>
}

const voidStatus = disclosureLiterals(['draft', 'sourcing', 'source_review', 'map_review', 'calibration', 'plan_review', 'scheduled', 'active', 'completed', 'paused', 'needs_attention', 'failed', 'archived'])
export const voidSummary = v.object({
  _id: v.id('learningVoids'), folderId: v.id('folders'), title: v.string(), status: voidStatus,
  revision: v.number(), activeBlueprintRevisionId: v.optional(v.id('learnBlueprintRevisions')),
  createdAt: v.number(), updatedAt: v.number(),
})
export const blueprintSummary = v.object({
  _id: v.id('learnBlueprintRevisions'), blueprintId: v.id('learnBlueprints'), learningVoidId: v.id('learningVoids'),
  revision: v.number(), recordRevision: v.number(),
  status: disclosureLiterals(['draft', 'source_review', 'map_review', 'accepted', 'active', 'superseded']),
  intentVersion: v.optional(v.literal('learn-v2.blueprint-intent.v1')), desiredOutcome: v.optional(v.string()),
  mode: v.optional(disclosureLiterals(['understand', 'prepare', 'apply'])),
  desiredDepth: v.optional(disclosureLiterals(['overview', 'working', 'deep'])),
  sourcePolicy: v.optional(disclosureLiterals(['folder_only', 'folder_plus_web', 'web_only'])),
  targetLocalDate: v.optional(v.string()), sessionMinutes: v.optional(v.number()),
  generatedAt: v.optional(v.number()), acceptedAt: v.optional(v.number()), createdAt: v.number(), updatedAt: v.number(),
})
export const milestoneSummary = v.object({
  _id: v.id('learnMilestones'), blueprintRevisionId: v.id('learnBlueprintRevisions'),
  stableKey: v.optional(v.string()), order: v.number(), title: v.string(), description: v.optional(v.string()),
})
export const sourceLinkSummary = v.object({
  _id: v.id('learnObjectiveSources'), objectiveId: v.id('learnObjectives'), sourceSnapshotId: v.id('learnSourceSnapshots'),
  coverage: disclosureLiterals(['strong', 'partial', 'gap']),
  evidenceStatus: v.optional(disclosureLiterals(['evidence_available', 'evidence_unavailable'])),
})
export const objectiveSummary = v.object({
  _id: v.id('learnObjectives'), blueprintRevisionId: v.id('learnBlueprintRevisions'),
  stableKey: v.optional(v.string()), milestoneId: v.optional(v.id('learnMilestones')), order: v.number(),
  title: v.string(), capability: v.string(), estimatedMinutes: v.optional(v.number()),
  depth: disclosureLiterals(['foundational', 'working', 'advanced']),
  coverage: v.optional(disclosureLiterals(['strong', 'partial', 'gap'])),
  storedCoverage: v.optional(disclosureLiterals(['strong', 'partial', 'gap'])), gapReason: v.optional(v.string()),
  sourceLinks: v.array(sourceLinkSummary), prerequisiteObjectiveIds: v.array(v.id('learnObjectives')),
})
export function projectObjective(row: Doc<'learnObjectives'>, revision: number) {
  const safe = projectObjectiveSummary({ objectiveId: row._id, title: row.title,
    capability: row.capability ?? row.title, depth: row.depth ?? 'working', revision })
  return { _id: row._id, blueprintRevisionId: row.blueprintRevisionId, stableKey: row.stableKey,
    milestoneId: row.milestoneId, order: row.order, title: safe.title, capability: safe.capability,
    depth: safe.depth, estimatedMinutes: row.estimatedMinutes, coverage: row.coverage, gapReason: row.gapReason }
}
export const mapSummary = v.object({ blueprint: blueprintSummary, milestones: v.array(milestoneSummary), objectives: v.array(objectiveSummary) })
export const planRootSummary = v.object({
  _id: v.id('studyPlans'), learningVoidId: v.id('learningVoids'), revision: v.number(),
  activeRevisionId: v.optional(v.id('studyPlanRevisions')), createdAt: v.number(), updatedAt: v.optional(v.number()),
})
export const planSummary = v.object({
  _id: v.id('studyPlanRevisions'), studyPlanId: v.id('studyPlans'), learningVoidId: v.id('learningVoids'),
  revision: v.number(), recordRevision: v.optional(v.number()), status: disclosureLiterals(['draft', 'accepted', 'active', 'superseded']),
  parentRevisionId: v.optional(v.id('studyPlanRevisions')),
  changeReason: v.optional(disclosureLiterals(['availability_changed', 'deadline_changed', 'session_length_changed', 'future_incomplete_reflow'])),
  blueprintRevisionId: v.optional(v.id('learnBlueprintRevisions')), blueprintRecordRevision: v.optional(v.number()),
  schedulerVersion: v.optional(v.string()), timezone: v.optional(v.string()),
  inputSnapshot: v.optional(v.string()), resultSnapshot: v.optional(v.string()), feasibility: v.optional(disclosureLiterals(['feasible', 'infeasible'])),
  createdAt: v.number(), acceptedAt: v.optional(v.number()), updatedAt: v.optional(v.number()),
})
const scheduleResult = z.object({
  status: z.enum(['feasible', 'infeasible']),
  reasonCodes: z.array(z.enum(['capacity_available', 'prerequisites_ordered', 'reviews_spaced', 'buffer_reserved', 'insufficient_capacity', 'final_buffer_missing'])).max(16),
  alternatives: z.array(z.object({ code: z.enum(['extend_deadline', 'add_availability', 'shorten_sessions_increase_cadence', 'reduce_depth', 'remove_lower_priority_objectives']) })).max(8),
})
const schedulingPreferences = z.object({
  version: z.literal('learn-v2.schedule-input.v1'), timezone: z.string().min(1).max(100),
  startLocalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), targetLocalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  sessionMinutes: z.number().int().min(15).max(60), minRestMinutes: z.number().int().min(0).max(10080),
  availability: z.array(z.object({ weekday: z.number().int().min(0).max(6), start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/) })).max(28),
  blackoutDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(90), reviewIntervalsDays: z.array(z.number().int().min(1).max(730)).max(4),
})
export function projectPlan(row: Doc<'studyPlanRevisions'>) {
  const safe = projectFields(planSummary.fields, row)
  delete safe.inputSnapshot
  delete safe.resultSnapshot
  if (row.inputSnapshot && row.inputSnapshot.length <= 256_000) {
    try {
      const input = schedulingPreferences.safeParse(JSON.parse(row.inputSnapshot))
      if (input.success) safe.inputSnapshot = JSON.stringify(input.data)
    }
    catch { /* Scheduling preferences require a valid bounded envelope. */ }
  }
  if (row.resultSnapshot && row.resultSnapshot.length <= 256_000) {
    try {
      const result = scheduleResult.safeParse(JSON.parse(row.resultSnapshot))
      if (result.success) safe.resultSnapshot = JSON.stringify(result.data)
    }
    catch { /* Unverifiable snapshots have no public payload. */ }
  }
  return safe
}
export const sessionSummary = v.object({
  _id: v.id('studySessions'), studyPlanRevisionId: v.id('studyPlanRevisions'), primaryObjectiveId: v.id('learnObjectives'),
  placementId: v.optional(v.string()), status: disclosureLiterals(['planned', 'ready', 'in_progress', 'completed', 'missed', 'cancelled', 'blocked', 'generation_failed', 'needs_reschedule']),
  revision: v.number(), scheduledStartAt: v.number(), scheduledEndAt: v.optional(v.number()), timezone: v.optional(v.string()),
  offsetMinutes: v.optional(v.number()), placementKind: v.optional(disclosureLiterals(['learning', 'review', 'retained_review'])),
  schedulerVersion: v.optional(v.string()), startedSessionContentId: v.optional(v.id('sessionContent')),
  startedSessionContentRevision: v.optional(v.number()), missedAt: v.optional(v.number()),
})
export const masterySummary = v.object({
  _id: v.id('masteryRecords'), objectiveId: v.id('learnObjectives'), blueprintRevisionId: v.optional(v.id('learnBlueprintRevisions')),
  state: masteryStateValidator, recordRevision: v.optional(v.number()), firstIndependentPassAt: v.optional(v.number()),
  firstIndependentLocalDate: v.optional(v.string()), firstIndependentTimezone: v.optional(v.string()),
  lastAttemptAt: v.optional(v.number()), lastAttemptId: v.optional(v.id('masteryAttempts')),
  nextReviewAt: v.optional(v.number()), updatedAt: v.optional(v.number()),
})
export const attemptSummary = v.object({
  _id: v.id('masteryAttempts'), objectiveId: v.id('learnObjectives'), blueprintRevisionId: v.optional(v.id('learnBlueprintRevisions')),
  studySessionId: v.optional(v.id('studySessions')), sessionContentId: v.optional(v.id('sessionContent')),
  kind: v.optional(disclosureLiterals(['calibration', 'independent_application', 'retained_transfer', 'measurement_cold', 'measurement_delayed'])),
  attemptedAt: v.number(), serverScorePercent: v.optional(v.number()), usedHint: v.optional(v.boolean()), usedReveal: v.optional(v.boolean()),
  confidence: v.optional(v.number()), response: v.optional(v.string()),
  work: v.optional(responseStateValidator.members[1].fields.work),
  masteryStateBefore: v.optional(masteryStateValidator), masteryStateAfter: v.optional(masteryStateValidator),
})

export async function canReadSourceEvidence(ctx: ReadCtx, source: Doc<'learnSourceSnapshots'>) {
  const userId = await requireAuth(ctx)
  if (source.userId !== userId || source.evidencePurgedAt !== undefined || (source.effectiveStatus ?? source.status) === 'unavailable') return false
  const voidRow = await ctx.db.get(source.learningVoidId)
  if (!voidRow || voidRow.userId !== userId || (await ctx.db.get(voidRow.folderId))?.userId !== userId) return false
  const identity = await ctx.db.get(source.sourceIdentityId)
  if (!identity || identity.userId !== userId || identity.learningVoidId !== source.learningVoidId || identity.tombstonedAt !== undefined) return false
  if (identity.folderDocumentId) {
    const document = await ctx.db.get(identity.folderDocumentId)
    if (!document || document.userId !== userId || (await ctx.db.get(document.folderId))?.userId !== userId
      || source.contentHash !== document.contentHash || source.sourceRevision !== document.sourceRevision) return false
  }
  return true
}

async function sourceAvailable(ctx: ReadCtx, userId: string, id: Id<'learnSourceSnapshots'>, voidId: Id<'learningVoids'>) {
  const source = await ctx.db.get(id)
  return Boolean(source && source.userId === userId && source.learningVoidId === voidId
    && (source.effectiveStatus ?? source.status) === 'user_accepted' && source.rightsStatus === 'permitted'
    && source.conflictStatus === 'clear' && await canReadSourceEvidence(ctx, source))
}

export async function resolveAssessmentDisclosureContext(ctx: ReadCtx, assessmentOpportunityId: Id<'learnAssessmentOpportunities'>): Promise<LearnAssessmentDisclosureContext | null> {
  const userId = await requireAuth(ctx)
  const row = await ctx.db.get(assessmentOpportunityId)
  if (!row || row.userId !== userId) return null
  const purpose = learnAssessmentPurposeSchema.safeParse(row.purpose)
  const scope = learnV2ScopeSchema.safeParse({ scopeKind: row.scopeKind, learningVoidId: row.learningVoidId,
    blueprintRevisionId: row.blueprintRevisionId, objectiveId: row.objectiveId, blueprintRecordRevision: row.blueprintRecordRevision,
    assessmentContractVersion: row.assessmentContractVersion, assessmentContractDigest: row.assessmentContractDigest,
    depth: row.depth, contextPins: row.contextPins })
  const pins = learnAssessmentPinsSchema.safeParse(row.assessmentPins)
  if (!purpose.success || !scope.success || !pins.success) return null
  const [voidRow, blueprint, objective, exposure, submission] = await Promise.all([
    ctx.db.get(row.learningVoidId), ctx.db.get(row.blueprintRevisionId), ctx.db.get(row.objectiveId),
    row.deliveryGrantId ? ctx.db.get(row.deliveryGrantId) : null, row.submissionId ? ctx.db.get(row.submissionId) : null,
  ])
  const owned = voidRow?.userId === userId && blueprint?.userId === userId && objective?.userId === userId
    && blueprint.learningVoidId === voidRow._id && objective.blueprintRevisionId === blueprint._id
  let accessAvailable = Boolean(owned && (await ctx.db.get(voidRow!.folderId))?.userId === userId)
  let pinsMatch = Boolean(owned && blueprint!.recordRevision === row.blueprintRecordRevision
    && objective!.depth === row.depth && !['invalid', 'cancelled'].includes(row.phase) && row.invalidatedAt === undefined)
  let evidenceAvailable = row.evidenceStatus === 'available' && row.invalidatedAt === undefined
  const contextPins = row.contextPins
  if (contextPins.kind !== 'calibration') {
    const [root, plan] = await Promise.all([ctx.db.get(contextPins.studyPlanId), ctx.db.get(contextPins.studyPlanRevisionId)])
    pinsMatch &&= Boolean(root?.userId === userId && plan?.userId === userId && plan.studyPlanId === root._id
      && root.learningVoidId === row.learningVoidId && plan.learningVoidId === row.learningVoidId
      && plan.blueprintRevisionId === row.blueprintRevisionId && plan.revision === contextPins.planRevision
      && plan.recordRevision === contextPins.planRecordRevision && plan.blueprintRecordRevision === row.blueprintRecordRevision)
    if (contextPins.kind === 'session') {
      const [session, content] = await Promise.all([ctx.db.get(contextPins.studySessionId), ctx.db.get(contextPins.sessionContentId)])
      pinsMatch &&= Boolean(session?.userId === userId && content?.userId === userId
        && session.studyPlanRevisionId === contextPins.studyPlanRevisionId && session.primaryObjectiveId === row.objectiveId
        && content.studySessionId === session._id && content.studyPlanRevisionId === contextPins.studyPlanRevisionId
        && content.blueprintRevisionId === row.blueprintRevisionId && content.objectiveId === row.objectiveId
        && content.revision === contextPins.contentRevision && content.inputDigest === contextPins.contentInputDigest
        && content.generatorVersion === contextPins.generatorVersion
        && session.revision === contextPins.sessionRevision)
      if (contextPins.canvas) {
        const canvas = contextPins.canvas
        const [thread, activity] = await Promise.all([ctx.db.get(canvas.threadId), ctx.db.get(canvas.activityId)])
        accessAvailable &&= Boolean(thread?.userId === userId && thread.authorityKind === 'v2_mission'
          && thread.learningVoidId === row.learningVoidId && thread.deletionStartedAt === undefined
          && activity?.userId === userId && activity.threadId === thread._id && await hasAdaptiveExperienceAccess(ctx, userId))
        pinsMatch &&= Boolean(thread?.revision === canvas.threadRevision && activity?.planRevision === canvas.activityRevision
          && activity.sessionContentId === contextPins.sessionContentId && activity.objectiveId === row.objectiveId
          && activity.blueprintRevisionId === row.blueprintRevisionId && activity.planVersion === canvas.planVersion
          && activity.replayVersion === canvas.replayVersion && activity.rendererVersion === canvas.rendererVersion
          && activity.evaluationContract.version === canvas.evaluationVersion && canvas.pilotConfigurationVersion === ADAPTIVE_V2_PILOT_MANIFEST.version)
      }
    }
  }
  let identity: Record<string, unknown>
  if (row.assessmentPins.kind === 'measurement') {
    const p = row.assessmentPins.itemPins
    const item = await ctx.db.get(p.itemId)
    pinsMatch &&= Boolean(item?.userId === userId && item.learningVoidId === row.learningVoidId
      && item.blueprintRevisionId === row.blueprintRevisionId && item.objectiveId === row.objectiveId
      && item.revision === p.itemRevision && item.promptDigest === p.promptDigest && item.caseId === p.caseId
      && item.familyId === p.familyId && item.familyRevision === p.familyRevision && item.formLabel === p.formLabel
      && item.scoringSpecId === p.scoringSpecId && item.scoringSpecRevision === p.scoringSpecRevision
      && item.scoringSpecDigest === p.scoringSpecDigest && item.supportManifestDigest === p.supportManifestDigest
      && item.publicationValidationId === p.publicationValidationId && ['published', 'retired'].includes(item.status))
    evidenceAvailable &&= item?.evidenceStatus === 'available' && item.invalidatedAt === undefined
    const assignment = row.assignmentId ? await ctx.db.get(row.assignmentId) : null
    const measurementPurpose = row.purpose.kind === 'measurement_cold' || row.purpose.kind === 'measurement_delayed' ? row.purpose : null
    pinsMatch &&= Boolean(measurementPurpose && measurementPurpose.assignmentId === row.assignmentId
      && assignment?.userId === userId && assignment.status === 'admitted' && assignment.learningVoidId === row.learningVoidId
      && assignment.blueprintRevisionId === row.blueprintRevisionId && assignment.objectiveId === row.objectiveId
      && assignment.familyId === p.familyId && assignment.familyRevision === p.familyRevision)
    if (assignment?.status === 'admitted' && measurementPurpose) {
      const allocation = assignment.allocation
      const assigned = measurementPurpose.kind === 'measurement_cold' ? allocation.cold
        : allocation.kind === 'three_case' ? measurementPurpose.horizonDays === 7 ? allocation.day7 : allocation.day30
          : allocation.horizonDays === measurementPurpose.horizonDays ? allocation.delayed : null
      pinsMatch &&= Boolean(assigned && JSON.stringify(assigned) === JSON.stringify(p))
      evidenceAvailable &&= assignment.evidenceStatus === 'available' && assignment.invalidatedAt === undefined
    }
    const supports = await ctx.db.query('learnMeasurementSupports').withIndex('by_userId_and_itemId', q => q.eq('userId', userId).eq('itemId', p.itemId)).take(65)
    evidenceAvailable &&= supports.length > 0 && supports.length <= 64
    for (const support of supports) {
      const source = await ctx.db.get(support.sourceSnapshotId)
      const excerpt = await ctx.db.get(support.sourceExcerptId)
      evidenceAvailable &&= support.evidenceStatus === 'available' && support.invalidatedAt === undefined
        && await sourceAvailable(ctx, userId, support.sourceSnapshotId, row.learningVoidId)
        && source?.revision === support.sourceSnapshotRevision && source.recordRevision === support.sourceRecordRevision
        && source.contentHash === support.sourceContentHash && source.sourceRevision === support.sourceRevision
        && excerpt?.userId === userId && excerpt.sourceSnapshotId === support.sourceSnapshotId
        && excerpt.rightsStatus === 'permitted' && excerpt.evidencePurgedAt === undefined && Boolean(excerpt.excerpt)
    }
    identity = { kind: 'measurement', itemId: p.itemId, itemRevision: p.itemRevision, promptDigest: p.promptDigest }
  }
  else {
    const expectedKind = row.purpose.kind === 'calibration' ? 'calibration' : 'session_application'
    pinsMatch &&= row.assessmentPins.kind === expectedKind
    const links = await ctx.db.query('learnObjectiveSources').withIndex('by_userId_and_objectiveId_and_sourceSnapshotId', q => q.eq('userId', userId).eq('objectiveId', row.objectiveId)).take(65)
    const supporting = links.filter(link => link.coverage !== 'gap')
    evidenceAvailable &&= supporting.length > 0 && links.length <= 64
    for (const link of supporting) evidenceAvailable &&= await sourceAvailable(ctx, userId, link.sourceSnapshotId, row.learningVoidId)
    identity = row.assessmentPins.kind === 'calibration'
      ? { kind: 'calibration', objectiveId: row.objectiveId, blueprintRevisionId: row.blueprintRevisionId, promptDigest: row.assessmentPins.promptDigest }
      : contextPins.kind === 'session'
        ? { kind: 'session_application', sessionContentId: contextPins.sessionContentId, contentRevision: contextPins.contentRevision, promptDigest: row.assessmentPins.promptDigest }
        : {}
  }
  const exposurePurpose = { calibration: 'calibration', independent_application: 'practice', retained_transfer: 'retained_check', measurement_cold: 'cold_measurement', measurement_delayed: 'delayed_measurement' }[row.purpose.kind]
  const grantValid = exposure?.userId === userId && exposure.assessmentOpportunityId === row._id
    && exposure.policyVersion === LEARN_V2_ASSESSMENT_DISCLOSURE_VERSION && exposure.purpose === exposurePurpose
    && ['granted', 'acknowledged'].includes(exposure.status) && exposure.learningVoidId === row.learningVoidId
    && exposure.blueprintRevisionId === row.blueprintRevisionId && exposure.objectiveId === row.objectiveId
    && (contextPins.kind !== 'session' || exposure.studySessionId === contextPins.studySessionId)
    && (row.assessmentPins.kind === 'measurement' || exposure.caseId === row.assessmentPins.caseId && exposure.itemId === undefined)
    && (row.assessmentPins.kind !== 'measurement' || exposure.itemId === row.assessmentPins.itemPins.itemId
      && exposure.itemRevision === row.assessmentPins.itemPins.itemRevision && exposure.caseId === row.assessmentPins.itemPins.caseId)
  if (row.deliveryGrantId && !grantValid) pinsMatch = false
  if (row.submissionId && (!submission || submission.userId !== userId || !('assessmentOpportunityId' in submission)
    || submission.assessmentOpportunityId !== row._id || submission.deliveryGrantId !== row.deliveryGrantId)) pinsMatch = false
  const parsed = learnAssessmentDisclosureContextSchema.safeParse({
    version: LEARN_V2_ASSESSMENT_DISCLOSURE_VERSION, owned, accessAvailable, evidenceAvailable, pinsMatch,
    lifecycle: { version: LEARN_V2_DELAYED_CHECK_VERSION, assessmentOpportunityId: row._id, revision: row.revision,
      purpose: purpose.data, phase: row.phase, deliveryGrantId: row.deliveryGrantId ?? null,
      submissionId: row.submissionId ?? null, authoritativeAttemptId: row.authoritativeAttemptId ?? null,
      acceptedAt: submission?.acceptedAt ?? null, checkSequence: row.checkSequence },
    grant: grantValid ? { policyVersion: LEARN_V2_ASSESSMENT_DISCLOSURE_VERSION, deliveryGrantId: exposure._id,
      assessmentOpportunityId: row._id, identity, projectionDigest: exposure.projectionDigest,
      grantedAt: exposure.serverTime, status: exposure.status } : null,
  })
  return parsed.success ? parsed.data : null
}

// Contextual teaching reads examine the entire bounded Void, including old
// wrappers. Overflow and unknown authority cannot imply that no check is open.
export async function canReadAssessmentTeaching(ctx: ReadCtx, learningVoidId: Id<'learningVoids'>): Promise<boolean> {
  const userId = await requireAuth(ctx)
  const voidRow = await ctx.db.get(learningVoidId)
  if (!voidRow || voidRow.userId !== userId || (await ctx.db.get(voidRow.folderId))?.userId !== userId) return false
  const rows = await ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId_and_learningVoidId', q => q.eq('userId', userId).eq('learningVoidId', learningVoidId)).take(9)
  if (rows.length > 8) return false
  for (const row of rows) {
    const context = await resolveAssessmentDisclosureContext(ctx, row._id)
    if (!context || !context.pinsMatch || !context.accessAvailable || !context.evidenceAvailable) return false
    if (['retained_transfer', 'measurement_cold', 'measurement_delayed'].includes(context.lifecycle.purpose.kind)
      && !context.lifecycle.submissionId && !['cancelled', 'abandoned'].includes(context.lifecycle.phase)) return false
  }
  return true
}

export async function projectAttempt(ctx: ReadCtx, row: Doc<'masteryAttempts'>) {
  const userId = await requireAuth(ctx)
  if (row.userId !== userId) throw new Error('Assessment history is unavailable')
  const safe = projectFields(attemptSummary.fields, row)
  delete safe.response
  delete safe.work
  if (row.assessmentOpportunityId) {
    const context = await resolveAssessmentDisclosureContext(ctx, row.assessmentOpportunityId)
    if (!context || context.lifecycle.authoritativeAttemptId !== row._id || !['scored_pass', 'scored_fail'].includes(context.lifecycle.phase)) {
      delete safe.serverScorePercent
      delete safe.masteryStateAfter
    }
  }
  if (row.submissionId) {
    const submission = await ctx.db.get(row.submissionId)
    const context = row.assessmentOpportunityId ? await resolveAssessmentDisclosureContext(ctx, row.assessmentOpportunityId) : null
    if (submission?.userId === userId && submission.scopeKind === 'v2' && 'assessmentOpportunityId' in submission
      && submission.assessmentOpportunityId === row.assessmentOpportunityId && submission.objectiveId === row.objectiveId
      && submission.blueprintRevisionId === row.blueprintRevisionId) {
      const bodies = await ctx.db.query('learnResponseBodies').withIndex('by_userId_and_submissionId', q => q.eq('userId', userId).eq('submissionId', submission._id)).take(2)
      const body = bodies.length === 1 && 'learningVoidId' in bodies[0]! && bodies[0].learningVoidId === submission.learningVoidId
        && bodies[0].payloadDigest === submission.payloadDigest ? bodies[0] : null
      try {
        safe.work = projectAttemptHistory({ submissionId: submission._id, acceptedAt: submission.acceptedAt, confidence: submission.confidence,
          assistanceSnapshot: submission.assistanceSnapshot, validitySnapshot: submission.validitySnapshot, currentEligibility: submission.currentEligibility,
          body: submission.bodyAvailability === 'purged'
            ? { bodyAvailability: 'purged', reasonCode: 'evidence_unavailable', purgedAt: submission.bodyPurgedAt }
            : body ? { bodyAvailability: 'available', payload: body.payload } : { bodyAvailability: 'unavailable', reasonCode: 'evidence_unavailable' }, result: null },
        { owned: true, bodyDisclosureAllowed: Boolean(context?.accessAvailable && context.evidenceAvailable && context.pinsMatch
          && context.lifecycle.submissionId === submission._id && submission.evidenceStatus === 'available' && submission.invalidatedAt === undefined), resultDisclosureAllowed: false })
      }
      catch { /* Invalid legacy snapshots do not authorize body disclosure. */ }
    }
  }
  // Legacy work is already learner authored; its evidence dependencies still
  // have to be intact before returning retained text.
  if (!row.submissionId && row.response && row.blueprintRevisionId) {
    const blueprint = await ctx.db.get(row.blueprintRevisionId)
    let available = blueprint?.userId === userId
    let sourceIds: unknown = null
    try { sourceIds = row.sourceSnapshotIdsJson && JSON.parse(row.sourceSnapshotIdsJson) }
    catch { available = false }
    if (!Array.isArray(sourceIds) || sourceIds.length === 0 || sourceIds.length > 64) available = false
    if (available && blueprint && Array.isArray(sourceIds)) for (const id of sourceIds) {
      const normalized = typeof id === 'string' ? ctx.db.normalizeId('learnSourceSnapshots', id) : null
      available &&= Boolean(normalized && await sourceAvailable(ctx, userId, normalized, blueprint.learningVoidId))
    }
    if (available) safe.response = row.response
  }
  return safe
}

export async function projectCalibrationDelivery(ctx: ReadCtx, objective: Doc<'learnObjectives'>, learningVoidId: Id<'learningVoids'>) {
  const userId = await requireAuth(ctx)
  const rows = await ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId_and_learningVoidId', q => q.eq('userId', userId).eq('learningVoidId', learningVoidId)).take(9)
  if (rows.length > 8) return null
  const candidates = rows.filter(row => row.objectiveId === objective._id && row.blueprintRevisionId === objective.blueprintRevisionId && row.purpose.kind === 'calibration' && row.deliveryGrantId)
  if (candidates.length !== 1) return null
  const context = await resolveAssessmentDisclosureContext(ctx, candidates[0]!._id)
  const contract = objective.assessmentContract
  if (!context || !context.grant || !contract || typeof contract !== 'object') return null
  const digest = await disclosureDigest(contract)
  if (digest !== candidates[0]!.assessmentContractDigest || context.grant.identity.promptDigest !== await disclosureDigest(contract.instructions)) return null
  const input = { identity: context.grant.identity, prompt: contract.instructions, declaredStimulus: null,
    instructions: contract.instructions, responseSpec: { kind: 'bounded_rubric', version: contract.version, maxCodeUnits: 12000 } }
  const projectionDigest = await disclosureDigest(input)
  const result = projectDeliveredAssessment({ ...input, projectionDigest }, context)
  return result.status === 'delivered' ? result : null
}

export async function disclosureDigest(value: unknown) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))))
  return `sha256:${[...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')}`
}

export const adaptiveSourceScope = v.union(v.object({ kind: v.literal('none') }),
  v.object({ kind: v.literal('folder'), sourceId: v.string() }), v.object({ kind: v.literal('document'), sourceId: v.string() }),
  v.object({ kind: v.literal('url'), urlHash: v.string() }), v.object({ kind: v.literal('pasted'), contentDigest: v.string(), byteCount: v.number() }))
export function projectSourceScope(scope: Doc<'learningThreads'>['sourceScope']) {
  if (scope.kind === 'none') return { kind: scope.kind }
  if (scope.kind === 'folder' || scope.kind === 'document') return { kind: scope.kind, sourceId: scope.sourceId }
  if (scope.kind === 'url') return { kind: scope.kind, urlHash: scope.urlHash }
  return { kind: scope.kind, contentDigest: scope.contentDigest, byteCount: scope.byteCount }
}
export const adaptiveLifecycle = disclosureLiterals(['draft', 'preparing', 'ready', 'active', 'paused', 'ended', 'blocked', 'rollback'])
export const adaptiveActivityStatus = disclosureLiterals(['eligible', 'started', 'submitted', 'scoring', 'feedback', 'blocked', 'reconciling', 'ended', 'replaced'])
export const adaptiveIntent = disclosureLiterals(['understand', 'prepare', 'build', 'master', 'refresh', 'explore'])
export const adaptiveDraftSummary = v.object({ id: v.id('learningThreads'), originalNeed: v.string(), outcome: v.string(), intent: adaptiveIntent,
  availableTime: disclosureLiterals(['15', '25', '45', '60', 'no_limit']), authorityKind: disclosureLiterals(['standalone', 'v2_mission']),
  sourceScope: adaptiveSourceScope, evidenceState: v.string(), lifecycle: adaptiveLifecycle, revision: v.number(), createdAt: v.number(), updatedAt: v.number() })
export const adaptiveFallback = v.object({ version: v.literal('learn-adaptive.text-card-fallback.v1'), kind: v.literal('text_card'),
  title: v.string(), body: v.string(), primaryAction: v.object({ type: v.literal('continue_safe'), label: v.string() }), testId: v.literal('learn-activity-fallback') })
const primitiveBase = { contractVersion: v.literal('learn-adaptive.activity-contract.v1'), rendererVersion: v.literal('learn-adaptive.renderer.v1') }
export const nonFactualPrimitive = v.union(
  v.object({ ...primitiveBase, type: v.literal('diagnostic_prompt'), action: v.literal('submit_response'), testId: v.literal('learn-primitive-diagnostic-prompt'),
    props: v.object({ prompt: v.string(), responseFormat: disclosureLiterals(['short_text', 'long_text']), assistance: disclosureLiterals(['none', 'hint_available']) }) }),
  v.object({ ...primitiveBase, type: v.literal('artifact_workspace'), action: disclosureLiterals(['save_artifact', 'apply_artifact', 'share_artifact']), testId: v.literal('learn-primitive-artifact-workspace'),
    props: v.object({ prompt: v.string(), artifactKind: disclosureLiterals(['note', 'plan', 'draft', 'answer', 'other']), starterText: v.string() }) }),
  v.object({ ...primitiveBase, type: v.literal('reflection_next_move'), action: disclosureLiterals(['accept_next_move', 'override_next_move', 'end_thread']), testId: v.literal('learn-primitive-reflection-next-move'),
    props: v.object({ feedback: v.string(), nextMove: v.string(), allowedDecisions: v.array(disclosureLiterals(['accept', 'override', 'end'])) }) }),
)
export function projectNonFactualPayload(activity: Doc<'learningThreadActivities'>, allowed: boolean) {
  const p = allowed && activity.primitivePlan.length === 1 ? activity.primitivePlan[0] : null
  const primitive = !p ? null : p.type === 'diagnostic_prompt'
    ? { contractVersion: p.contractVersion, rendererVersion: p.rendererVersion, type: p.type, action: p.action, testId: p.testId,
        props: { prompt: p.props.prompt, responseFormat: p.props.responseFormat, assistance: p.props.assistance } }
    : p.type === 'artifact_workspace'
      ? { contractVersion: p.contractVersion, rendererVersion: p.rendererVersion, type: p.type, action: p.action, testId: p.testId,
          props: { prompt: p.props.prompt, artifactKind: p.props.artifactKind, starterText: p.props.starterText } }
      : p.type === 'reflection_next_move'
        ? { contractVersion: p.contractVersion, rendererVersion: p.rendererVersion, type: p.type, action: p.action, testId: p.testId,
            props: { feedback: p.props.feedback, nextMove: p.props.nextMove, allowedDecisions: [...p.props.allowedDecisions] } } : null
  const f = primitive ? activity.fallback : adaptiveActivityFallbackForReason('invalid_props')
  return { primitive, fallback: { version: f.version, kind: f.kind, title: f.title, body: f.body,
    primaryAction: { type: f.primaryAction.type, label: f.primaryAction.label }, testId: f.testId } }
}

export async function canReadActivityTeaching(ctx: ReadCtx, thread: Doc<'learningThreads'>, activity: Doc<'learningThreadActivities'>) {
  const userId = await requireAuth(ctx)
  if (thread.userId !== userId || activity.userId !== userId || activity.threadId !== thread._id || thread.deletionStartedAt !== undefined) return false
  if (activity.learningVoidId && activity.learningVoidId !== thread.learningVoidId) return false
  if (activity.sessionContentId) {
    const content = await ctx.db.get(activity.sessionContentId)
    if (!content || content.userId !== userId || content.blueprintRevisionId !== activity.blueprintRevisionId
      || content.objectiveId !== activity.objectiveId || content.revision !== activity.generationInputs.sessionContentRevision) return false
    if (content.assessmentPurpose && !['independent_application'].includes(content.assessmentPurpose)) return false
    if (content.assessmentOpportunityId) {
      const context = await resolveAssessmentDisclosureContext(ctx, content.assessmentOpportunityId)
      if (!context || !context.pinsMatch || !context.evidenceAvailable || !context.accessAvailable
        || context.lifecycle.purpose.kind !== 'independent_application') return false
    }
    const opportunities = await ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId_and_contextPins_studySessionId', q => q.eq('userId', userId).eq('contextPins.studySessionId', content.studySessionId)).take(9)
    if (opportunities.length > 8 || opportunities.some(row => row.contextPins.kind === 'session'
      && row.contextPins.sessionContentId === content._id && row.purpose.kind !== 'independent_application')) return false
  }
  if (thread.authorityKind === 'v2_mission' && !thread.learningVoidId) return false
  return thread.learningVoidId ? await canReadAssessmentTeaching(ctx, thread.learningVoidId) : activity.learningVoidId === null
}

export const adaptiveAttribution = v.object({ contributionId: v.string(), sourceFeature: disclosureLiterals(['chat', 'quiz', 'flashcards', 'podcast', 'documents']),
  classification: disclosureLiterals(['accepted_evidence', 'synthesis', 'inference', 'unknown', 'non_factual']),
  provenanceVersion: v.literal('learn-adaptive.contribution.v1'), sourceStatus: disclosureLiterals(['available', 'source_revision_changed', 'source_unavailable']) })
export const adaptiveActivitySummary = v.object({ id: v.string(), status: adaptiveActivityStatus, activityClass: disclosureLiterals(['factual', 'non_factual']),
  purpose: v.string(), reasonCode: v.string(), boundaryOrdinal: v.number(), attribution: v.union(adaptiveAttribution, v.null()),
  planRevision: v.number(), replacesActivityId: nullableString })
export const adaptiveCompletion = v.object({ version: v.literal('learn-adaptive.representative-completion.v1'), status: disclosureLiterals(['passed', 'needs_practice']),
  basis: v.literal('server_scored_representative_task'), activityId: v.string(), recordedAt: v.number() })
export const adaptiveNextAction = v.object({ kind: v.string(), label: v.string(), reasonCode: v.string(), activityId: nullableString })
export const adaptiveOverrideOptions = v.array(v.object({ key: adaptiveOverrideOptionValidator, label: v.string(), available: v.boolean(),
  unavailableReason: v.union(disclosureLiterals(['state', 'evidence', 'mastery', 'policy']), v.null()) }))
export const adaptiveControls = v.object({ reasonText: v.object({ version: v.literal('learn-adaptive.reason-text.v1'), purpose: v.string(), text: v.string() }),
  selected: v.union(adaptiveOverrideOptionValidator, v.null()), fixedNextPlan: v.union(adaptiveFixedNextPlanValidator, v.null()), options: adaptiveOverrideOptions })
export const adaptiveThreadSummary = v.object({
  ownerId: v.id('users'), thread: v.object({ id: v.id('learningThreads'), goal: v.string(), outcome: v.string(), intent: adaptiveIntent,
    sourceScope: adaptiveSourceScope, evidenceState: v.string(), lifecycle: adaptiveLifecycle, revision: v.number(), lifecycleChangedAt: v.union(v.number(), v.null()),
    authorityKind: disclosureLiterals(['standalone', 'v2_mission']), learningVoidId: v.union(v.id('learningVoids'), v.null()) }),
  currentActivity: v.union(adaptiveActivitySummary, v.null()),
  attemptContext: v.union(v.object({ priorOutcome: nullableString, assistance: v.string() }), v.null()),
  artifact: v.union(v.object({ id: v.id('learningThreadArtifacts'), title: v.string(), status: disclosureLiterals(['draft', 'saved']), activityId: nullableString, historical: v.boolean() }), v.null()),
  unresolvedPoint: nullableString, completion: v.union(adaptiveCompletion, v.null()),
  history: v.array(v.object({ ...adaptiveActivitySummary.fields, updatedAt: v.number() })), nextAction: adaptiveNextAction,
})

export const ASSESSMENT_DISCLOSURE_READS = [
  ['learnV2Journey.listHub', 'hub summary', 'listHub.returns'],
  ['learnV2Journey.getMission', 'journey', 'journeyValidator'],
  ['learnV2Journey.getCurrentMission', 'journey', 'journeyValidator'],
  ['learnV2Journey.getSessionCandidate', 'session selection', 'getSessionCandidate.returns'],
  ['learnV2Blueprints.getBlueprintMap', 'map summary', 'mapSummary'],
  ['learnV2Blueprints.getBlueprintGenerationJob', 'job status', 'getBlueprintGenerationJob.returns'],
  ['learnV2Lifecycle.getLearningVoid', 'Void summary', 'voidSummary'],
  ['learnV2Lifecycle.listLearningVoids', 'Void summary page', 'voidSummary'],
  ['learnV2Lifecycle.getBlueprintRevision', 'Blueprint summary', 'blueprintSummary'],
  ['learnV2Plans.getPlanPreview', 'schedule summary', 'planSummary'],
  ['learnV2Sources.getSource', 'source summary', 'sourceSummary'],
  ['learnV2Sources.listSources', 'source summary page', 'sourceSummary'],
  ['learnV2Sources.listSourceReview', 'contextual source review', 'listSourceReview.returns'],
  ['learnAdaptive.getThread', 'thread summary', 'adaptiveThreadSummary'],
  ['learnAdaptive.getMemory', 'owner memory', 'getMemory.returns'],
  ['learnAdaptive.listThreadHistory', 'thread summary page', 'listThreadHistory.returns'],
  ['learnAdaptive.listResumeCandidates', 'resume summaries', 'listResumeCandidates.returns'],
  ['learnAdaptive.listPromotionProposals', 'proposal summaries', 'proposalSummary'],
  ['learnAdaptive.listThreadArtifacts', 'learner artifacts', 'artifactSummary'],
  ['learnAdaptive.listThreadContributions', 'contribution attribution page', 'contributionSummary'],
  ['learnAdaptive.inspectContributionSource', 'source revision status', 'inspectContributionSource.returns'],
  ['learnAdaptive.getArtifactCanvas', 'validated artifact primitive', 'getArtifactCanvas.returns'],
  ['learnAdaptive.getReflectionCanvas', 'validated reflection primitive', 'getReflectionCanvas.returns'],
  ['learnAdaptiveEvidence.getThreadActivityEvidence', 'contextual evidence', 'evidenceFields'],
  ['learnAdaptiveEvidence.getActivityEvidence', 'contextual evidence, internal alias', 'evidenceFields'],
  ['learnAdaptiveRecovery.getDiagnosticCanvas', 'validated diagnostic primitive and own work', 'getDiagnosticCanvas.returns'],
  ['learnAdaptiveDrafts.getThreadDraft', 'learner draft', 'adaptiveDraftSummary'],
  ['learnAdaptiveClarifications.getInitialDecision', 'fixed clarification template', 'getInitialDecision.returns'],
  ['learnAdaptiveRouting.decideNextActivity', 'verified routing decision receipt', 'commandReturn'],
  ['learnAdaptiveRouting.replayDecision', 'verified routing decision replay', 'decisionValueValidator'],
] as const

export const ASSESSMENT_DISCLOSURE_OTHER_OWNERS = {
  'C5.4 #435': ['learnV2Today.getToday', 'learnV2SessionContent.getSessionContent', 'learnV2SessionContent.startStudySession', 'learnV2SessionContent.retrySessionContentGeneration'],
  'C5.5 #436': ['learnAdaptiveCanvas.attachReadySession', 'learnAdaptiveCanvas.getCanvas', 'learnAdaptiveCanvas.submitCanvasResponse', 'learnAdaptiveCanvas.loadReadyCanvas'],
  'C5.3 #434': ['learnV2Mastery.recordAssistanceUse', 'learnV2Mastery.submitMasteryAttempt', 'learnV2Mastery.submitMasteryAttemptForOwner', 'learnV2Mastery.feedback'],
  'C2.1 #424': ['learnV2Responses.getResponseState', 'learnV2MapCalibration.submitCalibrationAttempt', 'learnV2MapCalibration.replaceDraftMap', 'learnV2MapCalibration.acceptBlueprintMap', 'learnV2MapCalibration.completeCalibration'],
  'C5.1 #432 / C5.4 #435': ['learnV2Assessments.getAssessment', 'learnV2Assessments.getAssessmentState', 'learnV2Assessments.grantAssessmentDelivery'],
  'C2.2 #425': ['dataExport.getUserDataPage', 'dataExport.getExportMetadata', 'dataExport.getAttemptAnswersPage', 'dataExport.getCourseSourceDocsPage', 'dataExport.getDocumentDownloadUrl', 'server/api/export/me.get.ts'],
  'C4.2 #430': ['learnV2SearchActions.searchPublicWeb', 'learnV2SourceActions.fetchSource', 'learnV2SourceActions.fetchAndPrepareSourceForReview',
    'messages.listByConversation', 'conversations.getConversation', 'conversations.listRecentForUser', 'conversations.getMostRecentForFolder',
    'server/api/chat/general.post.ts', 'server/api/rag/chat.post.ts', 'server/api/rag/search.post.ts'],
  'C4.3 #431': ['quizzes.getWithQuestions', 'quizzes.startAttempt', 'quizzes.submitAnswer', 'quizzes.submitAllAnswers', 'quizzes.submitAttempt', 'quizzes.getAttemptResults', 'quizzes.getQuizHistory', 'quizzes.listAttempts', 'quizzes.listByFolder',
    'quizAnswerAssessments.listPendingForAttempt', 'quizAnswerAssessments.listPendingForShadowAttempt', 'server/api/quiz/assess-attempt.post.ts',
    'courseSections.get', 'courseSections.listByCourse', 'courseSections.getNextSection', 'courseSections.getOfflineCachePayload', 'courseSections.checkPreFetchStatus',
    'courses.get', 'courses.listByUser', 'courses.listByFolder', 'server/api/learn/section-cache-payload.get.ts', 'reviewItems.listDueForUser', 'reviewItems.listDueWithContext', 'reviewItems.listBySection',
    'flashcardRooms.getRoom', 'flashcardRooms.getRoomVersion', 'flashcardRooms.listRoomVersions', 'flashcardRooms.listRoomsByFolder',
    'server/api/course/generate-outline.post.ts', 'server/api/course/generate-section.post.ts', 'server/api/quiz/generate.post.ts', 'server/api/quiz/topics.post.ts', 'server/api/flashcards/generate.post.ts',
    'documents.listDocumentsByFolder', 'folders.resolveScope', 'folders.searchScopeItems', 'courseSourceDocs.listByCourse',
    'audioOverviews.getCourseScopedOverview', 'audioOverviews.listByFolder', 'audioOverviews.listByRoom', 'audioOverviews.getWithTurns', 'audioOverviews.getTurnUrls', 'audioOverviews.getByShareToken', 'audioOverviews.getTurnUrlsByShareToken',
    'audioOverviewV2.getPlaybackForOwner', 'audioOverviewV2.getPlaybackByShareToken', 'audioOverviewV2.resolveMediaForOwner', 'audioOverviewV2.resolveMediaByShareToken', 'audioOverviewV2.listAlignmentSegments',
    'audioOverviewInterjections.listByOverview', 'audioOverviewInterjections.getTurnUrls', 'audioOverviewInterjectionsV2.getForOwner', 'audioOverviewInterjectionsV2.resolveMediaForOwner', 'audioOverviewRooms.listByFolder', 'audioOverviewRooms.getForConversation',
    'server/api/audio-overview/generate.post.ts', 'server/api/audio-overview/interject.post.ts', 'server/api/audio-overview/jobs/step.post.ts', 'server/api/audio-overview/media/[artifactId].get.ts', 'server/api/audio-overview/public/[token]/media.get.ts', 'server/api/audio-overview/interjections/[interjectionId]/media.get.ts'],
  status_only: ['learnV2Calendar.getStatus', 'learnV2Calendar.listProjections', 'learnV2Calendar.projectSession', 'learnV2CalendarReconciliation.listProposals', 'tasks.get', 'tasks.listByFolder', 'http.ts'],
  internal_only: ['learnV2SessionContent.inputs', 'learnV2SessionContent.getSessionContentGenerationInput', 'learnV2Mastery.getMasteryScoringInput', 'learnV2MapCalibration.getCalibrationScoringInput',
    'learnAdaptiveActivities.replayActivityPlan', 'audioOverviewV2.getForWorkflow', 'audioOverviewJobs.getStepContext', 'audioOverviewJobs.getAlignmentContext'],
} as const
