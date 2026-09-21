import { v, type Infer } from 'convex/values'
import { internalMutation, internalQuery, type MutationCtx } from './_generated/server'
import type { Doc } from './_generated/dataModel'
import { commitAdaptiveActivityPlanValidator } from '../shared/adaptive-learn-storage-manifest'
import {
  composeAdaptiveActivityPlan,
  replayAdaptiveActivityPlan,
  type ComposedAdaptiveActivityPlan,
} from '../shared/learn-adaptive-activity-plan'
import { projectAdaptiveClaimAuthority } from '../shared/adaptive-claim-adapter'
import { requireAdaptiveQueryAccess } from './lib/adaptiveLearnAccess'
import { loadAdaptiveClaimGraph, loadAdaptiveClaimProjection } from './lib/adaptiveClaimProjection'
import { requireActiveBlueprint } from './lib/learnV2BlueprintAuthority'
import { AdaptiveCommandConflict, executeAdaptiveThreadCommand } from './learnAdaptiveCommands'
import { writeLearnActivityEvent } from './lib/learnAdaptiveEvents'

type CommitArgs = Infer<typeof commitAdaptiveActivityPlanValidator>

async function requireEvidenceAuthority(ctx: MutationCtx, userId: string, args: CommitArgs) {
  const pins = {
    learningVoidId: args.learningVoidId ? String(args.learningVoidId) : null,
    blueprintRevisionId: args.blueprintRevisionId ? String(args.blueprintRevisionId) : null,
    objectiveId: args.objectiveId ? String(args.objectiveId) : null,
    sessionContentId: args.sessionContentId ? String(args.sessionContentId) : null,
  }
  const requestedReferences = args.evidenceReferences.map(reference => ({
    claimId: String(reference.claimId),
    supportId: String(reference.supportId),
    sourceSnapshotId: String(reference.sourceSnapshotId),
  }))
  if (args.activityClass === 'non_factual') {
    return projectAdaptiveClaimAuthority({ kind: 'non_factual', ownerId: userId, pins, requestedReferences })
  }
  if (!args.learningVoidId || !args.blueprintRevisionId || !args.objectiveId || !args.sessionContentId) {
    throw new Error('Factual activity requires complete matching V2 pins')
  }

  const [learningVoid, blueprint, objective, content] = await Promise.all([
    ctx.db.get(args.learningVoidId),
    ctx.db.get(args.blueprintRevisionId),
    ctx.db.get(args.objectiveId),
    ctx.db.get(args.sessionContentId),
  ])
  if (!learningVoid || learningVoid.userId !== userId) throw new Error('Learning Void not found')
  await requireActiveBlueprint(ctx, userId, learningVoid, blueprint?._id)
  const loaded = await loadAdaptiveClaimGraph(ctx, args.evidenceReferences)

  return projectAdaptiveClaimAuthority({
    kind: 'factual',
    ownerId: userId,
    pins,
    requestedReferences,
    authority: {
      learningVoid: learningVoid ? { id: String(learningVoid._id), userId: learningVoid.userId } : null,
      blueprintRevision: blueprint ? { id: String(blueprint._id), userId: blueprint.userId, learningVoidId: String(blueprint.learningVoidId) } : null,
      objective: objective ? { id: String(objective._id), userId: objective.userId, blueprintRevisionId: String(objective.blueprintRevisionId) } : null,
      sessionContent: content ? { id: String(content._id), userId: content.userId, blueprintRevisionId: content.blueprintRevisionId ? String(content.blueprintRevisionId) : undefined, objectiveId: content.objectiveId ? String(content.objectiveId) : undefined, revision: content.revision, status: content.status, inputDigest: content.inputDigest, generatorVersion: content.generatorVersion } : null,
      claims: loaded.flatMap(({ claim }) => claim ? [{ id: String(claim._id), userId: claim.userId, sessionContentId: String(claim.sessionContentId), verifierVersion: claim.verifierVersion }] : []),
      supports: loaded.flatMap(({ support }) => support ? [{ id: String(support._id), userId: support.userId, sessionContentClaimId: String(support.sessionContentClaimId), sourceExcerptId: String(support.sourceExcerptId), sourceSnapshotId: support.sourceSnapshotId ? String(support.sourceSnapshotId) : undefined, entailment: support.entailment, verifierVersion: support.verifierVersion, conflictStatus: support.conflictStatus, evidenceStatus: support.evidenceStatus }] : []),
      sourceSnapshots: loaded.flatMap(({ snapshot }) => snapshot ? [{ id: String(snapshot._id), userId: snapshot.userId, sourceIdentityId: String(snapshot.sourceIdentityId), learningVoidId: String(snapshot.learningVoidId), blueprintRevisionId: snapshot.blueprintRevisionId ? String(snapshot.blueprintRevisionId) : undefined, revision: snapshot.revision, recordRevision: snapshot.recordRevision, status: snapshot.status, effectiveStatus: snapshot.effectiveStatus, rightsStatus: snapshot.rightsStatus, conflictStatus: snapshot.conflictStatus, evidencePurgedAt: snapshot.evidencePurgedAt }] : []),
      sourceExcerpts: loaded.flatMap(({ excerpt }) => excerpt ? [{ id: String(excerpt._id), userId: excerpt.userId, sourceSnapshotId: String(excerpt.sourceSnapshotId), locator: excerpt.locator, privateLocator: excerpt.privateLocator, rightsStatus: excerpt.rightsStatus, evidencePurgedAt: excerpt.evidencePurgedAt }] : []),
      sourceIdentities: loaded.flatMap(({ identity }) => identity ? [{ id: String(identity._id), userId: identity.userId, learningVoidId: String(identity.learningVoidId), origin: identity.origin, tombstonedAt: identity.tombstonedAt }] : []),
    },
  })
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
    const { expectedRevision, idempotencyKey, ...payload } = args
    return await executeAdaptiveThreadCommand(ctx, {
      threadId: args.threadId,
      expectedRevision,
      idempotencyKey,
      commandName: 'commitActivityPlan',
      payload,
      apply: async (commandCtx, thread, userId) => {
    if (thread.intent !== args.intent || thread.availableTime !== args.decisionInputs.availableTime) throw new Error('Thread plan inputs are stale')
    if (args.activityClass === 'factual' && (thread.authorityKind !== 'v2_mission' || thread.learningVoidId !== args.learningVoidId)) {
      throw new Error('Thread factual authority does not match the activity')
    }

    const duplicate = await commandCtx.db.query('learningThreadActivities')
      .withIndex('by_userId_and_activityId', q => q.eq('userId', userId).eq('activityId', args.activityId))
      .unique()
    if (duplicate) throw new Error('Activity identity already exists')
    const latest = await commandCtx.db.query('learningThreadActivities')
      .withIndex('by_userId_and_threadId_and_boundaryOrdinal', q => q.eq('userId', userId).eq('threadId', thread._id))
      .order('desc')
      .first()
    if (!latest) {
      if (args.boundaryOrdinal !== 1 || args.planRevision !== 1 || args.replacesActivityId !== undefined) throw new AdaptiveCommandConflict('activity_boundary_changed', thread.revision)
    }
    else if (args.boundaryOrdinal !== latest.boundaryOrdinal + 1 || args.planRevision !== latest.planRevision + 1 || args.replacesActivityId !== latest.activityId) {
      throw new AdaptiveCommandConflict('activity_boundary_changed', thread.revision)
    }

    const authority = await requireEvidenceAuthority(commandCtx, userId, args)
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
      decisionInputs: {
        ...args.decisionInputs,
        intentRevision: thread.revision,
        sourceInputs: authority.evidenceReferences.map(reference => ({ sourceSnapshotId: reference.sourceSnapshotId, effectiveStatus: reference.sourceEffectiveStatus, recordRevision: reference.sourceRecordRevision })),
      },
      replacesActivityId: args.replacesActivityId,
    })
    const now = Date.now()
    const activityDocumentId = await commandCtx.db.insert('learningThreadActivities', {
      userId,
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
          sourceEffectiveStatus: pinned.sourceEffectiveStatus,
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
    const revision = thread.revision + 1
    await commandCtx.db.patch(thread._id, { currentActivityId: activityDocumentId, revision, updatedAt: now })
    for (const sourceSnapshotId of new Set(args.evidenceReferences.map(reference => reference.sourceSnapshotId))) {
      await commandCtx.db.insert('learnActivityEvidenceLinks', {
        userId,
        threadId: thread._id,
        activityId: activityDocumentId,
        sourceSnapshotId,
        boundaryOrdinal: composed.boundaryOrdinal,
        createdAt: now,
      })
    }
    await writeLearnActivityEvent(commandCtx, {
      userId,
      threadId: thread._id,
      activityId: activityDocumentId,
      eventType: 'activity_eligible',
      eventVersion: 'activity_eligible.v1',
      sourceVersion: composed.planVersion,
      contractVersion: composed.contractVersion,
      semanticKey: `activity:${composed.activityId}:eligible`,
      occurredAt: now,
      reasonCode: 'activity_plan_committed',
      outcomeCode: 'eligible',
      metadata: { activityClass: composed.activityClass, boundaryOrdinal: composed.boundaryOrdinal, planRevision: composed.planRevision },
    })
    return {
      value: { activityDocumentId, activityId: composed.activityId, boundaryOrdinal: composed.boundaryOrdinal, planRevision: composed.planRevision, inputDigest: composed.inputDigest, replayable: true as const },
      revision,
    }
      },
    })
  },
})

export const replayActivityPlan = internalQuery({
  args: { activityId: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireAdaptiveQueryAccess(ctx)
    const row = await ctx.db.query('learningThreadActivities')
      .withIndex('by_userId_and_activityId', q => q.eq('userId', userId).eq('activityId', args.activityId))
      .unique()
    if (!row) return { ok: false as const, reason: 'activity_not_found' as const }
    if (row.activityClass === 'factual') {
      const thread = await ctx.db.get(row.threadId)
      if (!thread || thread.userId !== userId) return { ok: false as const, reason: 'activity_not_found' as const }
      if (!row.sessionContentId
        || row.generationInputs.sessionContentRevision === null
        || row.evidenceReferences.length < 1
        || row.evidenceReferences.length > 16) {
        return { ok: false as const, reason: 'evidence_invalidated' as const }
      }
      const historical = thread.currentActivityId !== row._id
        || row.status === 'replaced'
        || row.status === 'ended'
      const projection = await loadAdaptiveClaimProjection(ctx, {
        userId,
        historical,
        sessionContentId: row.sessionContentId,
        sessionContentRevision: row.generationInputs.sessionContentRevision,
        evidenceReferences: row.evidenceReferences,
      })
      if (projection.integrityState !== 'accepted') {
        return {
          ok: false as const,
          reason: projection.integrityState === 'unavailable'
            ? 'evidence_unavailable' as const
            : 'evidence_invalidated' as const,
        }
      }
    }
    return await replayAdaptiveActivityPlan(rowToComposed(row))
  },
})
