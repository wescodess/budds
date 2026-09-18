import { v } from 'convex/values'
import type { Id } from './_generated/dataModel'
import { internalMutation, mutation, type MutationCtx } from './_generated/server'
import { requireLearnV2MutationAccess } from './lib/learnV2Access'
import { deriveMastery, LEARN_V2_MASTERY_SCORER_VERSION, localDateAt, scoreCriteria } from '../shared/learn-v2-mastery'

const MAX_RESPONSE = 12_000
const MAX_MISCONCEPTIONS = 16
const MAX_SOURCES = 64
const scorerVerdictValidator = v.object({
  scorerVersion: v.string(), criterionResults: v.array(v.object({ key: v.string(), awarded: v.boolean(), rationale: v.optional(v.string()) })),
  misconceptionTags: v.array(v.string()), verifierVersions: v.array(v.string()),
})
function fingerprint(value: unknown) { return JSON.stringify(value) }
function validText(value: string, label: string, max: number) { if (!value.trim() || value.length > max) throw new Error(`${label} is invalid`) }

async function sessionScope(ctx: MutationCtx, userId: string, sessionId: Id<'studySessions'>) {
  const session = await ctx.db.get(sessionId)
  if (!session || session.userId !== userId) throw new Error('Study session not found')
  const plan = await ctx.db.get(session.studyPlanRevisionId)
  const root = plan && await ctx.db.get(plan.studyPlanId)
  const content = session.startedSessionContentId && await ctx.db.get(session.startedSessionContentId)
  const blueprint = plan?.blueprintRevisionId && await ctx.db.get(plan.blueprintRevisionId)
  const objective = await ctx.db.get(session.primaryObjectiveId)
  const voidRow = plan && await ctx.db.get(plan.learningVoidId)
  const folder = voidRow && await ctx.db.get(voidRow.folderId)
  if (!plan || !root || !content || !blueprint || !objective || !voidRow || !folder || plan.userId !== userId || root.userId !== userId || content.userId !== userId || blueprint.userId !== userId || objective.userId !== userId || voidRow.userId !== userId || folder.userId !== userId) throw new Error('Started session pin is unavailable')
  if (root.activeRevisionId !== plan._id || plan.status !== 'accepted' || blueprint.status !== 'accepted' || content.status !== 'published' || content.studySessionId !== session._id || content.blueprintRevisionId !== blueprint._id || content.objectiveId !== objective._id || content.studyPlanRevisionId !== plan._id) throw new Error('Started session pin is no longer current')
  return { session, plan, root, content, blueprint, objective, voidRow }
}

export const recordAssistanceUse = mutation({
  args: { studySessionId: v.id('studySessions'), expectedSessionRevision: v.number(), kind: v.union(v.literal('substantive_hint'), v.literal('answer_reveal')) },
  handler: async (ctx, args) => {
    const userId = await requireLearnV2MutationAccess(ctx)
    const scope = await sessionScope(ctx, userId, args.studySessionId)
    if (scope.session.status !== 'in_progress' || scope.session.revision !== args.expectedSessionRevision) throw new Error('Study session revision conflict')
    const now = Date.now()
    const already = args.kind === 'substantive_hint' ? scope.session.substantiveHintUsedAt !== undefined : scope.session.answerRevealedAt !== undefined
    if (already) return { status: 'recorded' as const, revision: scope.session.revision, replayed: true }
    await ctx.db.patch(scope.session._id, {
      ...(args.kind === 'substantive_hint' ? { substantiveHintUsedAt: now } : { answerRevealedAt: now }),
      assistanceRevision: (scope.session.assistanceRevision ?? 0) + 1, revision: scope.session.revision + 1,
    })
    return { status: 'recorded' as const, revision: scope.session.revision + 1, replayed: false }
  },
})

export const recordMasteryAttempt = internalMutation({
  args: {
    tokenIdentifier: v.string(), studySessionId: v.id('studySessions'), expectedSessionRevision: v.number(), expectedContentRevision: v.number(), expectedPlanRecordRevision: v.number(), expectedBlueprintRecordRevision: v.number(),
    response: v.string(), confidence: v.number(), idempotencyKey: v.string(), scorerVerdict: scorerVerdictValidator,
  },
  handler: async (ctx, args) => {
    validText(args.idempotencyKey, 'Idempotency key', 128); validText(args.response, 'Response', MAX_RESPONSE)
    if (!Number.isInteger(args.confidence) || args.confidence < 1 || args.confidence > 5) throw new Error('Confidence is invalid')
    if (args.scorerVerdict.scorerVersion !== LEARN_V2_MASTERY_SCORER_VERSION || args.scorerVerdict.misconceptionTags.length > MAX_MISCONCEPTIONS || args.scorerVerdict.verifierVersions.length > MAX_SOURCES) throw new Error('Server scorer verdict is invalid')
    const requestFingerprint = fingerprint({ studySessionId: String(args.studySessionId), expectedSessionRevision: args.expectedSessionRevision, expectedContentRevision: args.expectedContentRevision, expectedPlanRecordRevision: args.expectedPlanRecordRevision, expectedBlueprintRecordRevision: args.expectedBlueprintRecordRevision, response: args.response, confidence: args.confidence, scorerVerdict: args.scorerVerdict })
    const prior = await ctx.db.query('masteryAttempts').withIndex('by_userId_and_idempotencyKey', q => q.eq('userId', args.tokenIdentifier).eq('idempotencyKey', args.idempotencyKey)).unique()
    if (prior) {
      if (prior.requestFingerprint !== requestFingerprint) throw new Error('Idempotency key was already used for a different request')
      return { attemptId: prior._id, scorePercent: prior.serverScorePercent, replayed: true }
    }
    const scope = await sessionScope(ctx, args.tokenIdentifier, args.studySessionId)
    if (scope.session.status !== 'in_progress' || scope.session.revision !== args.expectedSessionRevision || scope.content.revision !== args.expectedContentRevision || scope.session.startedSessionContentRevision !== scope.content.revision || scope.plan.recordRevision !== args.expectedPlanRecordRevision || scope.blueprint.recordRevision !== args.expectedBlueprintRecordRevision) throw new Error('Started session revision conflict')
    const rubric = JSON.parse(scope.content.assessmentRubricSnapshot ?? 'null') as { version: string, criteria: Array<{ key: string, weightPercent: number }> } | null
    if (!rubric || rubric.version !== 'learn-v2.assessment.v1') throw new Error('Started session rubric is unavailable')
    const scorePercent = scoreCriteria(rubric.criteria, args.scorerVerdict.criterionResults)
    const sources = await ctx.db.query('learnObjectiveSources').withIndex('by_userId_and_objectiveId_and_sourceSnapshotId', q => q.eq('userId', args.tokenIdentifier).eq('objectiveId', scope.objective._id)).take(MAX_SOURCES + 1)
    if (!sources.length || sources.length > MAX_SOURCES) throw new Error('Objective evidence scope is unavailable')
    const sourceIds: string[] = []
    for (const row of sources) {
      const source = await ctx.db.get(row.sourceSnapshotId)
      if (!source || source.userId !== args.tokenIdentifier || source.evidencePurgedAt !== undefined || source.status !== 'user_accepted' || source.effectiveStatus !== 'user_accepted' || source.rightsStatus !== 'permitted' || source.conflictStatus !== 'clear') throw new Error('Objective evidence is unavailable')
      sourceIds.push(String(source._id))
    }
    const now = Date.now(); const timezone = scope.session.timezone ?? scope.plan.timezone
    if (!timezone) throw new Error('Started session timezone pin is unavailable')
    const record = await ctx.db.query('masteryRecords').withIndex('by_userId_and_objectiveId', q => q.eq('userId', args.tokenIdentifier).eq('objectiveId', scope.objective._id)).unique()
    const kind = scope.session.placementKind === 'retained_review' ? 'retained_transfer' as const : 'independent_application' as const
    const assisted = scope.session.substantiveHintUsedAt !== undefined || scope.session.answerRevealedAt !== undefined
    const outcome = deriveMastery({ scorePercent, assisted, kind, previousState: record?.state, firstIndependentLocalDate: record?.firstIndependentLocalDate, attemptLocalDate: localDateAt(now, timezone) })
    const attemptId = await ctx.db.insert('masteryAttempts', { userId: args.tokenIdentifier, blueprintRevisionId: scope.blueprint._id, objectiveId: scope.objective._id, studySessionId: scope.session._id, sessionContentId: scope.content._id, studyPlanRevisionId: scope.plan._id, kind, attemptedAt: now, idempotencyKey: args.idempotencyKey, requestFingerprint, serverScorePercent: scorePercent, response: args.response, criterionResultsJson: JSON.stringify(args.scorerVerdict.criterionResults), misconceptionTagsJson: JSON.stringify(args.scorerVerdict.misconceptionTags), usedHint: scope.session.substantiveHintUsedAt !== undefined, usedReveal: scope.session.answerRevealedAt !== undefined, confidence: args.confidence, rubricVersion: rubric.version, rubricSnapshot: scope.content.assessmentRubricSnapshot, scorerVersion: args.scorerVerdict.scorerVersion, verifierVersionsJson: JSON.stringify(args.scorerVerdict.verifierVersions), sourceSnapshotIdsJson: JSON.stringify(sourceIds.sort()), sessionRevision: scope.session.revision, contentRevision: scope.content.revision, planRevision: scope.plan.revision, blueprintRecordRevision: scope.blueprint.recordRevision, result: outcome.state })
    const patch = { state: outcome.state, schedulingPriority: outcome.remediation ? 'remediation' as const : 'standard' as const, recordRevision: (record?.recordRevision ?? 0) + 1, lastAttemptAt: now, lastAttemptId: attemptId, ...(outcome.remediation ? { nextReviewAt: now, remediationAttemptId: attemptId } : {}), ...(outcome.setFirstIndependent ? { firstIndependentPassAt: now, firstIndependentLocalDate: localDateAt(now, timezone), firstIndependentTimezone: timezone } : {}), updatedAt: now }
    if (record) await ctx.db.patch(record._id, patch)
    else await ctx.db.insert('masteryRecords', { userId: args.tokenIdentifier, blueprintRevisionId: scope.blueprint._id, objectiveId: scope.objective._id, ...patch })
    await ctx.db.patch(scope.session._id, { status: 'completed', revision: scope.session.revision + 1, auditReasonCode: 'mastery_attempt_recorded' })
    await ctx.db.insert('learnPlanAuditEvents', { userId: args.tokenIdentifier, learningVoidId: scope.voidRow._id, studyPlanRevisionId: scope.plan._id, studySessionId: scope.session._id, reasonCode: 'mastery_attempt_recorded', details: JSON.stringify({ attemptId, kind, scorePercent, state: outcome.state, assisted }), createdAt: now })
    return { attemptId, scorePercent, state: outcome.state, replayed: false }
  },
})
