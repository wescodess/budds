import { v } from 'convex/values'
import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { requireAdaptiveMutationAccess, requireAdaptiveQueryAccess } from './lib/adaptiveLearnAccess'
import { requireActiveBlueprint } from './lib/learnV2BlueprintAuthority'
import { findCurrentAdaptiveActivityForSessionContent, hasLearnActivityEvent, writeLearnActivityEvent } from './lib/learnAdaptiveEvents'
import { loadAdaptiveClaimProjection } from './lib/adaptiveClaimProjection'
import { isLearnV2ContentEvidenceReady } from './lib/learnV2ContentEvidenceReady'
import { boundedAdaptiveCommandReference, prepareAdaptiveCommand } from '../shared/adaptive-command-authority'
import { composeAdaptiveActivityPlan, replayAdaptiveActivityPlan, type AdaptiveEvidenceState } from '../shared/learn-adaptive-activity-plan'
import { localDateAt } from '../shared/learn-v2-mastery'
import { adaptiveRecoveryCopy } from '../shared/learn-adaptive-recovery'
import { executeAdaptiveThreadCommand } from './learnAdaptiveCommands'
import { liveEvidenceState } from './learnAdaptiveRecovery'
import { projectAdaptiveControls, reasonTextForActivity } from '../shared/learn-adaptive-controls'

const RECEIPT_TTL_MS = 30 * 24 * 60 * 60_000

function referencedClaimOrders(raw: string | undefined): number[] {
  let parsed: unknown
  try { parsed = raw && JSON.parse(raw) } catch { throw new Error('Ready Canvas evidence is unavailable') }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 16
    || parsed.some(order => !Number.isSafeInteger(order) || order < 0)
    || new Set(parsed).size !== parsed.length) throw new Error('Ready Canvas evidence is unavailable')
  return parsed as number[]
}

// This is the existing V2-session entry path. It creates a fresh V2-backed
// thread from an owned ready session; need-first draft promotion is a separate
// continuation and must not be inferred from the matching title or folder.
// The client chooses a session, never a plan, evidence reference, provider, or score.
export const attachReadySession = mutation({
  args: { studySessionId: v.id('studySessions'), expectedSessionRevision: v.number(), idempotencyKey: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireAdaptiveMutationAccess(ctx)
    const prepared = await prepareAdaptiveCommand({
      userId, commandName: 'attachReadySession', targetId: String(args.studySessionId),
      expectedRevision: args.expectedSessionRevision, idempotencyKey: args.idempotencyKey,
      payload: { studySessionId: String(args.studySessionId) },
    })
    const prior = await ctx.db.query('learnActivityCommandReceipts')
      .withIndex('by_userId_and_idempotencyKeyHash', q => q.eq('userId', userId).eq('idempotencyKeyHash', prepared.idempotencyKeyHash))
      .unique()
    if (prior) {
      if (prior.commandName !== 'attachReadySession' || prior.requestFingerprint !== prepared.requestFingerprint) throw new Error('Idempotency key was already used for a different request')
      if (!prior.resultReference || prior.resultRedactedAt !== undefined) throw new Error('Attachment receipt has expired')
      const saved = JSON.parse(prior.resultReference) as { threadId: Id<'learningThreads'>, activityId: string }
      const thread = await ctx.db.get(saved.threadId)
      if (!thread || thread.userId !== userId || thread.currentActivityId === undefined) throw new Error('Attached thread is unavailable')
      const activity = await ctx.db.get(thread.currentActivityId)
      if (!activity || activity.userId !== userId || activity.threadId !== thread._id
        || activity.activityId !== saved.activityId || activity.status === 'ended' || activity.status === 'replaced') throw new Error('Attached activity is unavailable')
      const content = activity.sessionContentId && await ctx.db.get(activity.sessionContentId)
      const session = content && await ctx.db.get(content.studySessionId)
      const plan = session && await ctx.db.get(session.studyPlanRevisionId)
      const learningVoid = plan && await ctx.db.get(plan.learningVoidId)
      if (!content || !session || !plan || !learningVoid || content.studySessionId !== args.studySessionId
        || content.userId !== userId || session.userId !== userId || plan.userId !== userId
        || thread.authorityKind !== 'v2_mission' || thread.learningVoidId !== learningVoid._id
        || activity.learningVoidId !== learningVoid._id || learningVoid.userId !== userId
        || activity.blueprintRevisionId !== content.blueprintRevisionId || activity.objectiveId !== content.objectiveId
        || activity.generationInputs.sessionContentRevision !== content.revision) throw new Error('Attached V2 anchor is unavailable')
      if (!(await isLearnV2ContentEvidenceReady(ctx, userId, content, learningVoid._id))) throw new Error('Attached Canvas evidence is unavailable')
      return { kind: 'attached' as const, ...saved, replayed: true as const }
    }

    const session = await ctx.db.get(args.studySessionId)
    if (!session || session.userId !== userId || !['ready', 'in_progress'].includes(session.status) || session.revision !== args.expectedSessionRevision) throw new Error('Ready study session is unavailable')
    const plan = await ctx.db.get(session.studyPlanRevisionId)
    const stablePlan = plan && await ctx.db.get(plan.studyPlanId)
    const learningVoid = plan && await ctx.db.get(plan.learningVoidId)
    const blueprint = plan?.blueprintRevisionId && await ctx.db.get(plan.blueprintRevisionId)
    const objective = await ctx.db.get(session.primaryObjectiveId)
    if (!plan || !stablePlan || !learningVoid || !blueprint || !objective
      || plan.userId !== userId || learningVoid.userId !== userId || blueprint.userId !== userId || objective.userId !== userId
      || stablePlan.activeRevisionId !== plan._id || plan.status !== 'accepted' || blueprint.status !== 'accepted'
      || plan.blueprintRecordRevision !== blueprint.recordRevision || objective.blueprintRevisionId !== blueprint._id) throw new Error('Ready study session is not current')
    const folder = await ctx.db.get(learningVoid.folderId)
    if (!folder || folder.userId !== userId || typeof objective.assessmentContract !== 'object') throw new Error('Ready study session is not current')
    await requireActiveBlueprint(ctx, userId, learningVoid, blueprint._id)
    const now = Date.now()
    const timezone = session.timezone ?? plan.timezone ?? 'UTC'
    if (session.scheduledStartAt > now && localDateAt(session.scheduledStartAt, timezone) !== localDateAt(now, timezone)) throw new Error('Study session is not scheduled for today')
    if (session.scheduledEndAt !== undefined && session.scheduledEndAt < now) throw new Error('Study session window has expired')
    const content = session.status === 'in_progress' && session.startedSessionContentRevision !== undefined
      ? await ctx.db.query('sessionContent').withIndex('by_userId_and_studySessionId_and_revision', q => q.eq('userId', userId).eq('studySessionId', session._id).eq('revision', session.startedSessionContentRevision!)).unique()
      : await ctx.db.query('sessionContent').withIndex('by_userId_and_studySessionId_and_revision', q => q.eq('userId', userId).eq('studySessionId', session._id)).order('desc').first()
    if (!content || content.status !== 'published' || content.studyPlanRevisionId !== plan._id
      || content.blueprintRevisionId !== blueprint._id || content.objectiveId !== objective._id
      || !content.inputDigest || !content.generatorVersion
      || (session.status === 'in_progress' && (session.startedSessionContentId !== content._id || session.startedSessionContentRevision !== content.revision))) throw new Error('Published study content is unavailable')
    if (!(await isLearnV2ContentEvidenceReady(ctx, userId, content, learningVoid._id))) throw new Error('Ready Canvas evidence is unavailable')
    const linked = await findCurrentAdaptiveActivityForSessionContent(ctx, userId, content._id)
    if (linked) {
      if (linked.thread.authorityKind !== 'v2_mission' || linked.thread.learningVoidId !== learningVoid._id
        || linked.activity.learningVoidId !== learningVoid._id || linked.activity.blueprintRevisionId !== blueprint._id
        || linked.activity.objectiveId !== objective._id || linked.activity.sessionContentId !== content._id
        || linked.activity.generationInputs.sessionContentRevision !== content.revision) throw new Error('Attached V2 anchor is unavailable')
      return { kind: 'attached' as const, threadId: linked.thread._id, activityId: linked.activity.activityId, replayed: true as const }
    }
    if (session.status !== 'ready') throw new Error('This started session has no adaptive thread')
    const attachedRows = await ctx.db.query('learningThreadActivities')
      .withIndex('by_userId_and_sessionContentId_and_updatedAt', q => q.eq('userId', userId).eq('sessionContentId', content._id))
      .take(9)
    if (attachedRows.length) throw new Error('This session already has an adaptive activity')

    const blocks = await ctx.db.query('sessionContentBlocks')
      .withIndex('by_userId_and_sessionContentId_and_order', q => q.eq('userId', userId).eq('sessionContentId', content._id)).take(17)
    if (blocks.length > 16) throw new Error('Published study content exceeds Canvas bounds')
    const explanation = blocks.find(block => block.kind === 'explanation' && block.content?.trim())
    const application = blocks.find(block => block.kind === 'independent_application' && block.content?.trim())
    if (!explanation || !application) throw new Error('Ready Canvas content is unavailable')
    const explanationOrders = referencedClaimOrders(explanation.claimOrdersJson)
    const claimOrders = [...new Set([...explanationOrders, ...referencedClaimOrders(application.claimOrdersJson)])].sort((a, b) => a - b)
    if (claimOrders.length > 16) throw new Error('Ready Canvas evidence is unavailable')
    const evidenceReferences = [] as Array<{
      claimId: Id<'sessionContentClaims'>, supportId: Id<'learnClaimSupports'>, sourceSnapshotId: Id<'learnSourceSnapshots'>,
      sourceSnapshotRevision: number, sourceRecordRevision: number, sourceEffectiveStatus: 'user_accepted', verifierVersion: string, integrityState: 'accepted'
    }>
    const sourceInputs = [] as Array<{ sourceSnapshotId: string, effectiveStatus: 'user_accepted', recordRevision: number }>
    const sourceIds = new Set<string>()
    const explanationSourceIds = new Set<string>()
    for (const order of claimOrders) {
      const claim = await ctx.db.query('sessionContentClaims')
        .withIndex('by_userId_and_sessionContentId_and_order', q => q.eq('userId', userId).eq('sessionContentId', content._id).eq('order', order)).unique()
      if (!claim || !claim.verifierVersion || (claim.confidence ?? 0) < 0.8) throw new Error('Ready Canvas evidence is unavailable')
      const supports = await ctx.db.query('learnClaimSupports')
        .withIndex('by_userId_and_sessionContentClaimId', q => q.eq('userId', userId).eq('sessionContentClaimId', claim._id)).take(9)
      if (!supports.length || supports.length > 8) throw new Error('Ready Canvas evidence is unavailable')
      let pinned = false
      for (const support of supports) {
        if (support.entailment !== 'entailed' || support.evidenceStatus !== 'evidence_available' || support.conflictStatus !== 'clear' || (support.confidence ?? 0) < 0.8 || !support.verifierVersion) continue
        const excerpt = await ctx.db.get(support.sourceExcerptId)
        const sourceSnapshotId = support.sourceSnapshotId ?? excerpt?.sourceSnapshotId
        const source = sourceSnapshotId && await ctx.db.get(sourceSnapshotId)
        if (!excerpt || !source || excerpt.sourceSnapshotId !== source._id || source.userId !== userId || source.learningVoidId !== learningVoid._id || source.effectiveStatus !== 'user_accepted') continue
        evidenceReferences.push({ claimId: claim._id, supportId: support._id, sourceSnapshotId: source._id,
          sourceSnapshotRevision: source.revision, sourceRecordRevision: source.recordRevision ?? 1,
          sourceEffectiveStatus: 'user_accepted', verifierVersion: support.verifierVersion, integrityState: 'accepted' })
        if (!sourceIds.has(String(source._id))) {
          sourceIds.add(String(source._id))
          sourceInputs.push({ sourceSnapshotId: String(source._id), effectiveStatus: 'user_accepted', recordRevision: source.recordRevision ?? 1 })
        }
        if (explanationOrders.includes(order)) explanationSourceIds.add(String(source._id))
        pinned = true
        break
      }
      if (!pinned) throw new Error('Ready Canvas evidence is unavailable')
    }
    if (sourceIds.size > 8) throw new Error('Ready Canvas evidence is unavailable')
    const evidence = await loadAdaptiveClaimProjection(ctx, {
      userId, historical: false, sessionContentId: content._id, sessionContentRevision: content.revision, evidenceReferences,
    })
    if (evidence.integrityState !== 'accepted') throw new Error('Ready Canvas evidence is unavailable')

    const availableTime = objective.estimatedMinutes && objective.estimatedMinutes <= 15 ? '15' as const
      : objective.estimatedMinutes && objective.estimatedMinutes <= 25 ? '25' as const
        : objective.estimatedMinutes && objective.estimatedMinutes <= 45 ? '45' as const : '60' as const
    const threadId = await ctx.db.insert('learningThreads', {
      userId, originalNeed: objective.title, outcome: objective.capability ?? objective.title,
      outcomeProvenance: 'explicit', intent: 'understand', availableTime,
      authorityKind: 'v2_mission', learningVoidId: learningVoid._id,
      sourceScope: { kind: 'folder', sourceId: String(learningVoid.folderId) },
      evidenceState: 'ready', lifecycle: 'ready', revision: 2, createdAt: now, updatedAt: now,
    })
    const activityId = `ready-session:${String(session._id)}`
    const composed = await composeAdaptiveActivityPlan({
      activityId, threadId: String(threadId), boundaryOrdinal: 1, planRevision: 1,
      activityClass: 'factual', intent: 'understand', objectiveId: String(objective._id),
      purpose: 'Study the supported explanation, then apply it independently.',
      reasonCode: 'ready_v2_session',
      primitiveSequence: [{ type: 'cited_explanation', action: 'continue', props: {
        heading: objective.title, explanation: explanation.content!, sourceRefs: [...explanationSourceIds],
      } }],
      requiredAction: { kind: 'continue', label: 'Continue' },
      evaluationContract: { version: 'learn-adaptive.evaluation.v1', kind: 'server_scored', responseFormat: 'short_text', passingScorePercent: objective.assessmentContract.passingScorePercent },
      accessibilityMetadata: { heading: objective.title, instructions: 'Read the explanation, then continue to the independent response.', focusTargetTestId: 'learn-primitive-cited-explanation', liveRegionMode: 'polite' },
      pins: { learningVoidId: String(learningVoid._id), blueprintRevisionId: String(blueprint._id), objectiveId: String(objective._id), sessionContentId: String(content._id) },
      evidenceReferences: evidenceReferences.map(row => ({ ...row, claimId: String(row.claimId), supportId: String(row.supportId), sourceSnapshotId: String(row.sourceSnapshotId) })),
      generationInputs: { sessionContentRevision: content.revision, sessionContentInputDigest: content.inputDigest, generatorVersion: content.generatorVersion },
      decisionInputs: { intentRevision: 1, routerVersion: 'learn-adaptive.router.v1', availableTime, sourceState: 'ready', sourceInputs, priorActivityId: null, priorAttemptId: null, priorOutcome: null, assistance: 'none', confidence: null },
    })
    const activityDocumentId = await ctx.db.insert('learningThreadActivities', {
      userId, threadId, activityId, boundaryOrdinal: 1, planRevision: 1, activityClass: 'factual', status: 'eligible',
      planVersion: composed.planVersion, replayVersion: composed.replayVersion, contractVersion: composed.contractVersion,
      rendererVersion: composed.rendererVersion, validationVersion: composed.validationVersion,
      sequenceValidationVersion: composed.sequenceValidationVersion, fallbackVersion: composed.fallbackVersion,
      intent: composed.intent, objectiveId: objective._id, purpose: composed.purpose, reasonCode: composed.reasonCode,
      reasonText: reasonTextForActivity({ activityClass: 'factual', purpose: composed.purpose, reasonCode: composed.reasonCode, sourceState: 'ready' }),
      primitivePlan: composed.primitivePlan, requiredAction: composed.requiredAction,
      evaluationContract: composed.evaluationContract, fallback: composed.fallback,
      accessibilityMetadata: composed.accessibilityMetadata,
      learningVoidId: learningVoid._id, blueprintRevisionId: blueprint._id, sessionContentId: content._id,
      evidenceReferences, generationInputs: composed.generationInputs, decisionInputs: composed.decisionInputs,
      replacesActivityId: composed.replacesActivityId, canonicalInputSnapshot: composed.canonicalInputSnapshot,
      inputDigest: composed.inputDigest, createdAt: now, updatedAt: now,
    })
    await ctx.db.patch(threadId, { currentActivityId: activityDocumentId })
    for (const sourceSnapshotId of sourceIds) await ctx.db.insert('learnActivityEvidenceLinks', { userId, threadId, activityId: activityDocumentId, sourceSnapshotId: sourceSnapshotId as Id<'learnSourceSnapshots'>, boundaryOrdinal: 1, createdAt: now })
    await writeLearnActivityEvent(ctx, { userId, threadId, activityId: activityDocumentId, eventType: 'activity_eligible', eventVersion: 'activity_eligible.v1', sourceVersion: composed.planVersion, contractVersion: composed.contractVersion, semanticKey: `activity:${activityId}:eligible`, occurredAt: now, reasonCode: 'ready_session_attached', outcomeCode: 'eligible', metadata: { activityClass: 'factual', boundaryOrdinal: 1, planRevision: 1 } })
    const receiptId = await ctx.db.insert('learnActivityCommandReceipts', {
      userId, threadId, idempotencyKeyHash: prepared.idempotencyKeyHash,
      requestFingerprint: prepared.requestFingerprint, commandName: 'attachReadySession', targetRevision: args.expectedSessionRevision,
      resultKind: 'ok', resultReference: boundedAdaptiveCommandReference({ threadId, activityId }), errorReference: null,
      createdAt: now, resultExpiresAt: now + RECEIPT_TTL_MS, redactionStatus: 'pending',
    })
    return { kind: 'attached' as const, threadId, activityId, receiptId: String(receiptId), replayed: false as const }
  },
})

export async function loadReadyCanvas(ctx: QueryCtx | MutationCtx, userId: string, threadId: Id<'learningThreads'>) {
    const owner = await ctx.db.query('users').withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', userId)).unique()
    const thread = await ctx.db.get(threadId)
    if (!owner || !thread || thread.userId !== userId || thread.authorityKind !== 'v2_mission' || thread.deletionStartedAt !== undefined || !thread.currentActivityId) return null
    const activity = await ctx.db.get(thread.currentActivityId)
    if (!activity || activity.userId !== userId || activity.threadId !== thread._id || !activity.sessionContentId || !activity.learningVoidId
      || thread.learningVoidId !== activity.learningVoidId) return null
    const content = await ctx.db.get(activity.sessionContentId)
    const session = content && await ctx.db.get(content.studySessionId)
    const learningVoid = await ctx.db.get(activity.learningVoidId)
    if (!content || !session || !learningVoid || content.userId !== userId || session.userId !== userId || learningVoid.userId !== userId) return null
    const plan = await ctx.db.get(session.studyPlanRevisionId)
    const stablePlan = plan && await ctx.db.get(plan.studyPlanId)
    const blueprint = activity.blueprintRevisionId && await ctx.db.get(activity.blueprintRevisionId)
    const objective = activity.objectiveId && await ctx.db.get(activity.objectiveId)
    if (!plan || !stablePlan || !blueprint || !objective || plan.userId !== userId || blueprint.userId !== userId || objective.userId !== userId) return null
    const replay = await replayAdaptiveActivityPlan({
      planVersion: activity.planVersion, replayVersion: activity.replayVersion, contractVersion: activity.contractVersion,
      rendererVersion: activity.rendererVersion, validationVersion: activity.validationVersion,
      sequenceValidationVersion: activity.sequenceValidationVersion, fallbackVersion: activity.fallbackVersion,
      activityId: activity.activityId, threadId: String(thread._id), boundaryOrdinal: activity.boundaryOrdinal,
      planRevision: activity.planRevision, activityClass: activity.activityClass, intent: activity.intent,
      objectiveId: activity.objectiveId ? String(activity.objectiveId) : null,
      purpose: activity.purpose, reasonCode: activity.reasonCode, primitivePlan: activity.primitivePlan,
      requiredAction: activity.requiredAction, evaluationContract: activity.evaluationContract,
      fallback: activity.fallback, accessibilityMetadata: activity.accessibilityMetadata,
      pins: { learningVoidId: activity.learningVoidId ? String(activity.learningVoidId) : null, blueprintRevisionId: activity.blueprintRevisionId ? String(activity.blueprintRevisionId) : null, objectiveId: activity.objectiveId ? String(activity.objectiveId) : null, sessionContentId: activity.sessionContentId ? String(activity.sessionContentId) : null },
      evidenceReferences: activity.evidenceReferences.map(reference => ({ ...reference, claimId: String(reference.claimId), supportId: String(reference.supportId), sourceSnapshotId: String(reference.sourceSnapshotId) })),
      generationInputs: activity.generationInputs, decisionInputs: activity.decisionInputs,
      replacesActivityId: activity.replacesActivityId, canonicalInputSnapshot: activity.canonicalInputSnapshot, inputDigest: activity.inputDigest,
    })
    const evidence = activity.evidenceReferences.length > 0 && activity.generationInputs.sessionContentRevision !== null
      ? await loadAdaptiveClaimProjection(ctx, { userId, historical: false, sessionContentId: content._id, sessionContentRevision: activity.generationInputs.sessionContentRevision, evidenceReferences: activity.evidenceReferences })
      : null
    const contentEvidenceReady = await isLearnV2ContentEvidenceReady(ctx, userId, content, learningVoid._id)
    const scoredAttempt = activity.masteryAttemptId && await ctx.db.get(activity.masteryAttemptId)
    const completedFeedback = activity.status === 'feedback' && session.status === 'completed' && scoredAttempt
      && scoredAttempt.userId === userId && scoredAttempt.studySessionId === session._id
      && scoredAttempt.sessionContentId === content._id && scoredAttempt.blueprintRevisionId === blueprint._id
      && scoredAttempt.objectiveId === objective._id && scoredAttempt.contentRevision === content.revision
      && session.startedSessionContentId === content._id && session.startedSessionContentRevision === content.revision
    const current = plan.status === 'accepted' && stablePlan.activeRevisionId === plan._id && blueprint.status === 'accepted' && content.status === 'published'
      && contentEvidenceReady
      && activity.sessionContentId === content._id && activity.objectiveId === objective._id
      && activity.blueprintRevisionId === blueprint._id && plan.blueprintRecordRevision === blueprint.recordRevision
      && session.studyPlanRevisionId === plan._id && content.studyPlanRevisionId === plan._id
      && content.blueprintRevisionId === blueprint._id && content.objectiveId === objective._id
      && learningVoid.activeBlueprintRevisionId === blueprint._id
      && (session.status === 'ready' || session.status === 'in_progress' || Boolean(completedFeedback))
      && (session.status !== 'in_progress' || session.startedSessionContentId === content._id && session.startedSessionContentRevision === content.revision)
    const blocks = await ctx.db.query('sessionContentBlocks').withIndex('by_userId_and_sessionContentId_and_order', q => q.eq('userId', userId).eq('sessionContentId', content._id)).take(17)
    const prompt = blocks.length <= 16 ? blocks.find(block => block.kind === 'independent_application')?.content : undefined
    const status = !current || !replay.ok || evidence?.integrityState !== 'accepted' || !prompt?.trim()
      ? 'blocked' as const
      : activity.status === 'eligible' && session.status === 'ready' ? 'ready' as const
        : activity.status === 'started' && session.status === 'in_progress' ? 'started' as const
          : ['submitted', 'scoring', 'feedback', 'reconciling'].includes(activity.status) ? activity.status : 'blocked' as const
    const recoveryState: AdaptiveEvidenceState = thread.evidenceState === 'invalidated' || evidence?.integrityState === 'deleted' || !replay.ok ? 'invalidated'
      : evidence?.integrityState === 'unavailable' || thread.evidenceState === 'unavailable' ? 'unavailable'
        : evidence?.integrityState === 'stale' || thread.evidenceState === 'stale' ? 'stale'
          : thread.evidenceState === 'blocked' || evidence?.integrityState === 'insufficient' || evidence?.integrityState === 'conflicting' ? 'blocked'
            : !current ? 'stale' : 'blocked'
    const selectedOverride = await ctx.db.query('learnActivityOverrides')
      .withIndex('by_userId_and_activityId_and_createdAt', q => q.eq('userId', userId).eq('activityId', activity._id))
      .order('desc').first()
    const sourceReady = (await liveEvidenceState(ctx, thread)) === 'ready'
    return {
      status, ownerId: owner._id, thread: { id: thread._id, outcome: thread.outcome ?? thread.originalNeed, intent: thread.intent, revision: thread.revision },
      recoveryState: status === 'blocked' ? recoveryState : null,
      recovery: status === 'blocked' ? adaptiveRecoveryCopy(recoveryState) : null,
      activity: { id: activity.activityId, status: activity.status, purpose: activity.purpose, reasonCode: activity.reasonCode,
        controls: projectAdaptiveControls({ activityClass: 'factual', activityStatus: status === 'blocked' || !sourceReady ? 'blocked' : activity.status, lifecycle: thread.lifecycle,
          evidenceReady: status !== 'blocked' && sourceReady, sourceCount: new Set(activity.evidenceReferences.map(reference => String(reference.sourceSnapshotId))).size,
          currentTime: thread.availableTime,
          selected: selectedOverride?.option, fixedNextPlan: selectedOverride?.fixedNextPlan, reasonText: activity.reasonText,
          purpose: activity.purpose, reasonCode: activity.reasonCode, sourceState: activity.decisionInputs.sourceState }),
        primitive: status !== 'blocked' && replay.ok ? activity.primitivePlan[0] : null,
        fallback: activity.fallback, requiredAction: activity.requiredAction },
      session: { studySessionId: session._id, revision: session.revision, contentRevision: content.revision,
        planRecordRevision: plan.recordRevision, blueprintRecordRevision: blueprint.recordRevision,
        scheduledStartAt: session.scheduledStartAt, scheduledEndAt: session.scheduledEndAt ?? null,
        timezone: session.timezone ?? plan.timezone ?? 'UTC' },
      responsePrompt: status === 'blocked' ? null : prompt ?? null,
      savedResponse: activity.submittedResponse !== undefined && activity.submittedConfidence !== undefined
        ? { response: activity.submittedResponse, confidence: activity.submittedConfidence }
        : null,
    }
}

export const getCanvas = query({
  args: { threadId: v.id('learningThreads') },
  handler: async (ctx, args) => await loadReadyCanvas(ctx, await requireAdaptiveQueryAccess(ctx), args.threadId),
})

// A single response boundary precedes shared V2 scoring. No score, attempt,
// provider job, or mastery row is authored by this command.
export const submitCanvasResponse = mutation({
  args: { threadId: v.id('learningThreads'), activityId: v.string(), studySessionId: v.id('studySessions'), expectedSessionRevision: v.number(), expectedRevision: v.number(), response: v.string(), confidence: v.number(), idempotencyKey: v.string() },
  handler: async (ctx, args) => {
    const canonicalResponse = args.response.trim()
    if (!canonicalResponse || canonicalResponse.length > 12_000 || !Number.isInteger(args.confidence) || args.confidence < 1 || args.confidence > 5) throw new Error('Canvas response is invalid')
    const responseHash = `sha256:${Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalResponse)))).map(byte => byte.toString(16).padStart(2, '0')).join('')}`
    return await executeAdaptiveThreadCommand(ctx, {
      threadId: args.threadId, expectedRevision: args.expectedRevision, idempotencyKey: args.idempotencyKey,
      commandName: 'submitCanvasResponse',
      payload: { activityId: args.activityId, studySessionId: String(args.studySessionId), expectedSessionRevision: args.expectedSessionRevision, responseHash, confidence: args.confidence },
      apply: async (commandCtx, thread, userId) => {
        const activity = thread.currentActivityId && await commandCtx.db.get(thread.currentActivityId)
        const content = activity?.sessionContentId && await commandCtx.db.get(activity.sessionContentId)
        const session = await commandCtx.db.get(args.studySessionId)
        const plan = session && await commandCtx.db.get(session.studyPlanRevisionId)
        const stablePlan = plan && await commandCtx.db.get(plan.studyPlanId)
        const learningVoid = plan && await commandCtx.db.get(plan.learningVoidId)
        const blueprint = plan?.blueprintRevisionId && await commandCtx.db.get(plan.blueprintRevisionId)
        if (!activity || activity.userId !== userId || activity.threadId !== thread._id || activity.activityId !== args.activityId
          || activity.status !== 'started' || activity.evaluationContract.kind !== 'server_scored'
          || !content || content.studySessionId !== args.studySessionId || !session || session.userId !== userId
          || session.status !== 'in_progress' || session.revision !== args.expectedSessionRevision
          || session.startedSessionContentId !== content._id || session.startedSessionContentRevision !== content.revision
          || !plan || !stablePlan || !learningVoid || !blueprint
          || thread.authorityKind !== 'v2_mission' || thread.learningVoidId !== learningVoid._id
          || activity.learningVoidId !== learningVoid._id
          || plan.userId !== userId || learningVoid.userId !== userId || blueprint.userId !== userId
          || stablePlan.activeRevisionId !== plan._id || plan.status !== 'accepted' || blueprint.status !== 'accepted'
          || plan.blueprintRecordRevision !== blueprint.recordRevision || activity.blueprintRevisionId !== blueprint._id
          || content.studyPlanRevisionId !== plan._id || content.blueprintRevisionId !== blueprint._id
          || !(await hasLearnActivityEvent(commandCtx, userId, activity._id, 'activity_started'))) throw new Error('Started Canvas activity is unavailable')
        await requireActiveBlueprint(commandCtx, userId, learningVoid, blueprint._id)
        if (activity.evidenceReferences.length < 1 || activity.generationInputs.sessionContentRevision !== content.revision
          || (await loadAdaptiveClaimProjection(commandCtx, { userId, historical: false, sessionContentId: content._id, sessionContentRevision: content.revision, evidenceReferences: activity.evidenceReferences })).integrityState !== 'accepted'
          || !(await isLearnV2ContentEvidenceReady(commandCtx, userId, content, learningVoid._id))) throw new Error('Started Canvas evidence is unavailable')
        const now = Date.now()
        await commandCtx.db.patch(activity._id, {
          status: 'submitted', submittedResponse: canonicalResponse, submittedConfidence: args.confidence, updatedAt: now,
        })
        const revision = thread.revision + 1
        await commandCtx.db.patch(thread._id, { revision, lifecycle: 'active', updatedAt: now })
        return { value: { status: 'submitted' as const, activityId: activity.activityId }, revision }
      },
    })
  },
})
