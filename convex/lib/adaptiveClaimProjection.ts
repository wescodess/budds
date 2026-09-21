import type { Doc, Id } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'
import {
  projectAdaptiveClaimIntegrity,
  type AdaptiveClaimIntegrityProjection,
  type AdaptiveEvidenceIntegrityState,
} from '../../shared/adaptive-claim-adapter'

const MAX_ACTIVITY_EVIDENCE_REFERENCES = 16
const INTEGRITY_PRIORITY: readonly AdaptiveEvidenceIntegrityState[] = [
  'deleted',
  'unavailable',
  'conflicting',
  'stale',
  'insufficient',
  'accepted',
]

type EvidenceReference = Doc<'learningThreadActivities'>['evidenceReferences'][number]

export type LoadedAdaptiveClaimProjection = {
  claims: AdaptiveClaimIntegrityProjection[]
  integrityState: AdaptiveEvidenceIntegrityState
}

function aggregateIntegrity(states: AdaptiveEvidenceIntegrityState[]): AdaptiveEvidenceIntegrityState {
  return INTEGRITY_PRIORITY.find(state => states.includes(state)) ?? 'insufficient'
}

export async function loadAdaptiveClaimProjection(
  ctx: Pick<QueryCtx, 'db'>,
  input: {
    userId: string
    historical: boolean
    sessionContentId: Id<'sessionContent'>
    sessionContentRevision: number
    evidenceReferences: EvidenceReference[]
  },
): Promise<LoadedAdaptiveClaimProjection> {
  if (input.evidenceReferences.length < 1 || input.evidenceReferences.length > MAX_ACTIVITY_EVIDENCE_REFERENCES) {
    throw new Error('Factual activity evidence reference count is invalid')
  }

  const sessionContent = await ctx.db.get(input.sessionContentId)
  const claims = await Promise.all(input.evidenceReferences.map(async (pinned) => {
    const [claim, support, snapshot] = await Promise.all([
      ctx.db.get(pinned.claimId),
      ctx.db.get(pinned.supportId),
      ctx.db.get(pinned.sourceSnapshotId),
    ])
    const excerpt = support ? await ctx.db.get(support.sourceExcerptId) : null
    const identity = snapshot ? await ctx.db.get(snapshot.sourceIdentityId) : null

    return projectAdaptiveClaimIntegrity({
      ownerId: input.userId,
      historical: input.historical,
      sessionContentId: String(input.sessionContentId),
      sessionContentRevision: input.sessionContentRevision,
      pinned: {
        claimId: String(pinned.claimId),
        supportId: String(pinned.supportId),
        sourceSnapshotId: String(pinned.sourceSnapshotId),
        sourceSnapshotRevision: pinned.sourceSnapshotRevision,
        sourceRecordRevision: pinned.sourceRecordRevision,
        sourceEffectiveStatus: pinned.sourceEffectiveStatus,
        verifierVersion: pinned.verifierVersion,
        integrityState: pinned.integrityState,
      },
      records: {
        sessionContent: sessionContent
          ? { id: String(sessionContent._id), userId: sessionContent.userId, revision: sessionContent.revision, status: sessionContent.status }
          : null,
        // V2 currently has no authoritative epistemic classifier. Do not infer
        // fact/synthesis/inference from the claim text or entailment result.
        claim: claim
          ? { id: String(claim._id), userId: claim.userId, sessionContentId: String(claim.sessionContentId), claim: claim.claim, verifierVersion: claim.verifierVersion }
          : null,
        support: support
          ? { id: String(support._id), userId: support.userId, sessionContentClaimId: String(support.sessionContentClaimId), sourceExcerptId: String(support.sourceExcerptId), sourceSnapshotId: support.sourceSnapshotId ? String(support.sourceSnapshotId) : undefined, entailment: support.entailment, verifierVersion: support.verifierVersion, conflictStatus: support.conflictStatus, evidenceStatus: support.evidenceStatus }
          : null,
        sourceSnapshot: snapshot
          ? { id: String(snapshot._id), userId: snapshot.userId, sourceIdentityId: String(snapshot.sourceIdentityId), revision: snapshot.revision, recordRevision: snapshot.recordRevision, status: snapshot.status, effectiveStatus: snapshot.effectiveStatus, rightsStatus: snapshot.rightsStatus, conflictStatus: snapshot.conflictStatus, evidencePurgedAt: snapshot.evidencePurgedAt }
          : null,
        sourceExcerpt: excerpt
          ? { id: String(excerpt._id), userId: excerpt.userId, sourceSnapshotId: String(excerpt.sourceSnapshotId), locator: excerpt.locator, rightsStatus: excerpt.rightsStatus, evidencePurgedAt: excerpt.evidencePurgedAt }
          : null,
        sourceIdentity: identity
          ? { id: String(identity._id), userId: identity.userId, origin: identity.origin, tombstonedAt: identity.tombstonedAt }
          : null,
      },
    })
  }))

  return { claims, integrityState: aggregateIntegrity(claims.map(claim => claim.integrityState)) }
}
