import { v, type Infer } from 'convex/values'
import { internalMutation, internalQuery, type MutationCtx } from './_generated/server'
import type { Doc } from './_generated/dataModel'
import { commitAdaptiveActivityPlanValidator } from '../shared/adaptive-learn-storage-manifest'
import {
  composeAdaptiveActivityPlan,
  replayAdaptiveActivityPlan,
  type AdaptiveActivityEvidenceReference,
  type AdaptiveActivityPlanInput,
  type ComposedAdaptiveActivityPlan,
} from '../shared/learn-adaptive-activity-plan'

type CommitArgs = Infer<typeof commitAdaptiveActivityPlanValidator>

async function requireEvidenceAuthority(ctx: MutationCtx, args: CommitArgs): Promise<{
  evidenceReferences: AdaptiveActivityEvidenceReference[]
  generationInputs: AdaptiveActivityPlanInput['generationInputs']
}> {
  if (args.activityClass === 'non_factual') {
    if (args.evidenceReferences.length > 0 || args.learningVoidId !== null || args.blueprintRevisionId !== null || args.objectiveId !== null || args.sessionContentId !== null) {
      throw new Error('Non-factual activity cannot persist factual authority pins')
    }
    return { evidenceReferences: [], generationInputs: { sessionContentRevision: null, sessionContentInputDigest: null, generatorVersion: null } }
  }
  if (!args.learningVoidId || !args.blueprintRevisionId || !args.objectiveId || !args.sessionContentId) {
    throw new Error('Factual activity requires complete matching V2 pins')
  }
  if (args.evidenceReferences.length < 1 || args.evidenceReferences.length > 16) throw new Error('Factual activity requires accepted evidence')

  const [learningVoid, blueprint, objective, content] = await Promise.all([
    ctx.db.get(args.learningVoidId),
    ctx.db.get(args.blueprintRevisionId),
    ctx.db.get(args.objectiveId),
    ctx.db.get(args.sessionContentId),
  ])
  if (!learningVoid || learningVoid.userId !== args.tokenIdentifier) throw new Error('Learning Void not found')
  if (!blueprint || blueprint.userId !== args.tokenIdentifier || blueprint.learningVoidId !== learningVoid._id) throw new Error('Blueprint revision not found')
  if (!objective || objective.userId !== args.tokenIdentifier || objective.blueprintRevisionId !== blueprint._id) throw new Error('Objective not found')
  if (!content || content.userId !== args.tokenIdentifier || content.status !== 'published' || content.blueprintRevisionId !== blueprint._id || content.objectiveId !== objective._id) {
    throw new Error('Published session content not found')
  }
  if (!content.inputDigest || !content.generatorVersion) throw new Error('Published session content lacks immutable generation inputs')

  const evidenceReferences: AdaptiveActivityEvidenceReference[] = []
  const seen = new Set<string>()
  for (const reference of args.evidenceReferences) {
    const key = `${reference.claimId}:${reference.supportId}:${reference.sourceSnapshotId}`
    if (seen.has(key)) throw new Error('Activity evidence references must be unique')
    seen.add(key)
    const [claim, support, snapshot] = await Promise.all([
      ctx.db.get(reference.claimId),
      ctx.db.get(reference.supportId),
      ctx.db.get(reference.sourceSnapshotId),
    ])
    if (!claim || claim.userId !== args.tokenIdentifier || claim.sessionContentId !== content._id) throw new Error('Accepted claim reference not found')
    if (!support || support.userId !== args.tokenIdentifier || support.sessionContentClaimId !== claim._id || support.sourceSnapshotId !== snapshot?._id || support.entailment !== 'entailed' || support.conflictStatus !== 'clear' || support.evidenceStatus === 'evidence_unavailable') {
      throw new Error('Accepted claim support not found')
    }
    if (!snapshot || snapshot.userId !== args.tokenIdentifier || snapshot.learningVoidId !== learningVoid._id || snapshot.blueprintRevisionId !== blueprint._id || snapshot.status !== 'user_accepted' || (snapshot.effectiveStatus !== undefined && snapshot.effectiveStatus !== 'user_accepted') || snapshot.evidencePurgedAt !== undefined || snapshot.rightsStatus !== 'permitted' || snapshot.conflictStatus !== 'clear' || snapshot.recordRevision === undefined) {
      throw new Error('Accepted source snapshot not found')
    }
    const verifierVersion = support.verifierVersion ?? claim.verifierVersion
    if (!verifierVersion || (support.verifierVersion && claim.verifierVersion && support.verifierVersion !== claim.verifierVersion)) {
      throw new Error('Evidence verifier pin is unavailable')
    }
    evidenceReferences.push({
      claimId: String(claim._id),
      supportId: String(support._id),
      sourceSnapshotId: String(snapshot._id),
      sourceSnapshotRevision: snapshot.revision,
      sourceRecordRevision: snapshot.recordRevision,
      verifierVersion,
      integrityState: 'accepted',
    })
  }
  return {
    evidenceReferences,
    generationInputs: {
      sessionContentRevision: content.revision,
      sessionContentInputDigest: content.inputDigest,
      generatorVersion: content.generatorVersion,
    },
  }
}

function rowToComposed(row: Doc<'learningThreadActivities'>): ComposedAdaptiveActivityPlan {
  return {
    planVersion: row.planVersion,
    replayVersion: row.replayVersion,
    contractVersion: row.contractVersion,
    rendererVersion: row.rendererVersion,
    validationVersion: row.validationVersion,
    sequenceValidationVersion: row.sequenceValidationVersion,
    fallbackVersion: row.fallbackVersion,
    activityId: row.activityId,
    threadId: String(row.threadId),
    boundaryOrdinal: row.boundaryOrdinal,
    planRevision: row.planRevision,
    activityClass: row.activityClass,
    intent: row.intent,
    objectiveId: row.objectiveId ? String(row.objectiveId) : null,
    purpose: row.purpose,
    reasonCode: row.reasonCode,
    primitivePlan: row.primitivePlan,
    requiredAction: row.requiredAction,
    evaluationContract: row.evaluationContract,
    fallback: row.fallback,
    accessibilityMetadata: row.accessibilityMetadata,
    pins: {
      learningVoidId: row.learningVoidId ? String(row.learningVoidId) : null,
      blueprintRevisionId: row.blueprintRevisionId ? String(row.blueprintRevisionId) : null,
      objectiveId: row.objectiveId ? String(row.objectiveId) : null,
      sessionContentId: row.sessionContentId ? String(row.sessionContentId) : null,
    },
    evidenceReferences: row.evidenceReferences.map(reference => ({ ...reference, claimId: String(reference.claimId), supportId: String(reference.supportId), sourceSnapshotId: String(reference.sourceSnapshotId) })),
    generationInputs: row.generationInputs,
    decisionInputs: row.decisionInputs,
    replacesActivityId: row.replacesActivityId,
    canonicalInputSnapshot: row.canonicalInputSnapshot,
    inputDigest: row.inputDigest,
  }
}

export const commitActivityPlan = internalMutation({
  args: commitAdaptiveActivityPlanValidator.fields,
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId)
    if (!thread || thread.userId !== args.tokenIdentifier) throw new Error('Thread not found')
    if (thread.intent !== args.intent || thread.availableTime !== args.decisionInputs.availableTime) throw new Error('Thread plan inputs are stale')
    if (args.activityClass === 'factual' && (thread.authorityKind !== 'v2_mission' || thread.learningVoidId !== args.learningVoidId)) {
      throw new Error('Thread factual authority does not match the activity')
    }

    const duplicate = await ctx.db.query('learningThreadActivities')
      .withIndex('by_userId_and_activityId', q => q.eq('userId', args.tokenIdentifier).eq('activityId', args.activityId))
      .unique()
    if (duplicate) throw new Error('Activity identity already exists')
    const latest = await ctx.db.query('learningThreadActivities')
      .withIndex('by_userId_and_threadId_and_boundaryOrdinal', q => q.eq('userId', args.tokenIdentifier).eq('threadId', thread._id))
      .order('desc')
      .first()
    if (!latest) {
      if (args.boundaryOrdinal !== 1 || args.planRevision !== 1 || args.replacesActivityId !== undefined) throw new Error('Activity must begin at the first boundary and plan revision')
    }
    else if (args.boundaryOrdinal !== latest.boundaryOrdinal + 1 || args.planRevision !== latest.planRevision + 1 || args.replacesActivityId !== latest.activityId) {
      throw new Error('Replacement must create the next boundary and plan revision')
    }

    const authority = await requireEvidenceAuthority(ctx, args)
    const composed = await composeAdaptiveActivityPlan({
      activityId: args.activityId,
      threadId: String(thread._id),
      boundaryOrdinal: args.boundaryOrdinal,
      planRevision: args.planRevision,
      activityClass: args.activityClass,
      intent: args.intent,
      objectiveId: args.objectiveId ? String(args.objectiveId) : null,
      purpose: args.purpose,
      reasonCode: args.reasonCode,
      primitiveSequence: args.primitiveSequence,
      requiredAction: args.requiredAction,
      evaluationContract: args.evaluationContract,
      accessibilityMetadata: args.accessibilityMetadata,
      pins: {
        learningVoidId: args.learningVoidId ? String(args.learningVoidId) : null,
        blueprintRevisionId: args.blueprintRevisionId ? String(args.blueprintRevisionId) : null,
        objectiveId: args.objectiveId ? String(args.objectiveId) : null,
        sessionContentId: args.sessionContentId ? String(args.sessionContentId) : null,
      },
      evidenceReferences: authority.evidenceReferences,
      generationInputs: authority.generationInputs,
      decisionInputs: args.decisionInputs,
      replacesActivityId: args.replacesActivityId,
    })
    const now = Date.now()
    const activityDocumentId = await ctx.db.insert('learningThreadActivities', {
      userId: args.tokenIdentifier,
      threadId: thread._id,
      activityId: composed.activityId,
      boundaryOrdinal: composed.boundaryOrdinal,
      planRevision: composed.planRevision,
      activityClass: composed.activityClass,
      status: 'eligible',
      planVersion: composed.planVersion,
      replayVersion: composed.replayVersion,
      contractVersion: composed.contractVersion,
      rendererVersion: composed.rendererVersion,
      validationVersion: composed.validationVersion,
      sequenceValidationVersion: composed.sequenceValidationVersion,
      fallbackVersion: composed.fallbackVersion,
      intent: composed.intent,
      objectiveId: args.objectiveId,
      purpose: composed.purpose,
      reasonCode: composed.reasonCode,
      primitivePlan: composed.primitivePlan,
      requiredAction: composed.requiredAction,
      evaluationContract: composed.evaluationContract,
      fallback: composed.fallback,
      accessibilityMetadata: composed.accessibilityMetadata,
      learningVoidId: args.learningVoidId,
      blueprintRevisionId: args.blueprintRevisionId,
      sessionContentId: args.sessionContentId,
      evidenceReferences: args.evidenceReferences.map((reference, index) => {
        const pinned = authority.evidenceReferences[index]!
        return {
          claimId: reference.claimId,
          supportId: reference.supportId,
          sourceSnapshotId: reference.sourceSnapshotId,
          sourceSnapshotRevision: pinned.sourceSnapshotRevision,
          sourceRecordRevision: pinned.sourceRecordRevision,
          verifierVersion: pinned.verifierVersion,
          integrityState: pinned.integrityState,
        }
      }),
      generationInputs: composed.generationInputs,
      decisionInputs: composed.decisionInputs,
      replacesActivityId: composed.replacesActivityId,
      canonicalInputSnapshot: composed.canonicalInputSnapshot,
      inputDigest: composed.inputDigest,
      createdAt: now,
      updatedAt: now,
    })
    await ctx.db.patch(thread._id, { currentActivityId: activityDocumentId, revision: thread.revision + 1, updatedAt: now })
    return { activityDocumentId, activityId: composed.activityId, boundaryOrdinal: composed.boundaryOrdinal, planRevision: composed.planRevision, inputDigest: composed.inputDigest, replayable: true as const }
  },
})

export const replayActivityPlan = internalQuery({
  args: { tokenIdentifier: v.string(), activityId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.query('learningThreadActivities')
      .withIndex('by_userId_and_activityId', q => q.eq('userId', args.tokenIdentifier).eq('activityId', args.activityId))
      .unique()
    if (!row) return { ok: false as const, reason: 'activity_not_found' as const }
    return await replayAdaptiveActivityPlan(rowToComposed(row))
  },
})
