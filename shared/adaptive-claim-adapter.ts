import type { AdaptiveActivityEvidenceReference, AdaptiveActivityPlanInput } from './learn-adaptive-activity-plan'

export type AdaptiveClaimPins = {
  learningVoidId: string | null
  blueprintRevisionId: string | null
  objectiveId: string | null
  sessionContentId: string | null
}

export type AdaptiveRequestedClaimReference = {
  claimId: string
  supportId: string
  sourceSnapshotId: string
}

type OwnedRecord = { id: string, userId: string }

export type AdaptiveClaimAuthorityRecords = {
  learningVoid: OwnedRecord | null
  blueprintRevision: (OwnedRecord & { learningVoidId: string }) | null
  objective: (OwnedRecord & { blueprintRevisionId: string }) | null
  sessionContent: (OwnedRecord & {
    blueprintRevisionId?: string
    objectiveId?: string
    revision: number
    status: 'draft' | 'ready' | 'published' | 'superseded'
    inputDigest?: string
    generatorVersion?: string
  }) | null
  claims: Array<OwnedRecord & { sessionContentId: string, verifierVersion?: string }>
  supports: Array<OwnedRecord & {
    sessionContentClaimId: string
    sourceExcerptId: string
    sourceSnapshotId?: string
    entailment: 'entailed' | 'not_entailed' | 'not_evaluated'
    verifierVersion?: string
    conflictStatus: 'clear' | 'unresolved'
    evidenceStatus?: 'evidence_available' | 'evidence_unavailable'
  }>
  sourceSnapshots: Array<OwnedRecord & {
    sourceIdentityId: string
    learningVoidId: string
    blueprintRevisionId?: string
    revision: number
    recordRevision?: number
    status: 'candidate' | 'fetched' | 'evaluated' | 'user_accepted' | 'rejected' | 'unavailable'
    effectiveStatus?: 'candidate' | 'fetched' | 'evaluated' | 'user_accepted' | 'rejected' | 'unavailable'
    rightsStatus?: 'permitted' | 'unknown' | 'prohibited'
    conflictStatus?: 'clear' | 'unresolved'
    evidencePurgedAt?: number
  }>
  sourceExcerpts: Array<OwnedRecord & {
    sourceSnapshotId: string
    locator: string
    privateLocator?: string
    rightsStatus: 'permitted' | 'unknown' | 'prohibited'
    evidencePurgedAt?: number
  }>
  sourceIdentities: Array<OwnedRecord & {
    learningVoidId: string
    origin: 'folder_document' | 'user_url' | 'open_database' | 'general_web_search'
    tombstonedAt?: number
  }>
}

export type AdaptiveClaimAuthorityInput = {
  ownerId: string
  pins: AdaptiveClaimPins
  requestedReferences: AdaptiveRequestedClaimReference[]
} & (
  | { kind: 'non_factual' }
  | { kind: 'factual', authority: AdaptiveClaimAuthorityRecords }
)

export type AdaptiveClaimProjection = AdaptiveActivityEvidenceReference & {
  origin: AdaptiveClaimAuthorityRecords['sourceIdentities'][number]['origin']
  locator: string
}

export type AdaptiveClaimAuthorityProjection =
  | {
    kind: 'non_factual'
    claims: []
    evidenceReferences: []
    generationInputs: { sessionContentRevision: null, sessionContentInputDigest: null, generatorVersion: null }
  }
  | {
    kind: 'factual'
    claims: AdaptiveClaimProjection[]
    evidenceReferences: AdaptiveActivityEvidenceReference[]
    generationInputs: AdaptiveActivityPlanInput['generationInputs']
  }

function boundedText(value: string | undefined, label: string, maximum = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\p{Cc}\p{Cf}]/u.test(value)) throw new Error(`${label} is invalid`)
  return value.trim()
}

function positiveInteger(value: number | undefined, label: string): number {
  if (!Number.isSafeInteger(value) || (value ?? 0) < 1) throw new Error(`${label} is invalid`)
  return value as number
}

function owned(record: OwnedRecord | null | undefined, ownerId: string, label: string): asserts record is OwnedRecord {
  if (!record || record.userId !== ownerId) throw new Error(`${label} not found`)
}

export function projectAdaptiveClaimAuthority(input: AdaptiveClaimAuthorityInput): AdaptiveClaimAuthorityProjection {
  boundedText(input.ownerId, 'Evidence owner')
  if (input.kind === 'non_factual') {
    if (input.requestedReferences.length > 0 || Object.values(input.pins).some(pin => pin !== null)) {
      throw new Error('Non-factual activity cannot carry factual authority')
    }
    return {
      kind: 'non_factual',
      claims: [],
      evidenceReferences: [],
      generationInputs: { sessionContentRevision: null, sessionContentInputDigest: null, generatorVersion: null },
    }
  }

  const { authority, pins } = input
  const learningVoidId = boundedText(pins.learningVoidId ?? undefined, 'Learning Void pin')
  const blueprintRevisionId = boundedText(pins.blueprintRevisionId ?? undefined, 'Blueprint revision pin')
  const objectiveId = boundedText(pins.objectiveId ?? undefined, 'Objective pin')
  const sessionContentId = boundedText(pins.sessionContentId ?? undefined, 'Session content pin')
  if (input.requestedReferences.length < 1 || input.requestedReferences.length > 16) throw new Error('Factual activity requires between 1 and 16 evidence references')

  owned(authority.learningVoid, input.ownerId, 'Learning Void')
  if (authority.learningVoid.id !== learningVoidId) throw new Error('Learning Void pin does not match authority')
  owned(authority.blueprintRevision, input.ownerId, 'Blueprint revision')
  if (authority.blueprintRevision.id !== blueprintRevisionId || authority.blueprintRevision.learningVoidId !== learningVoidId) throw new Error('Blueprint revision parentage is invalid')
  owned(authority.objective, input.ownerId, 'Objective')
  if (authority.objective.id !== objectiveId || authority.objective.blueprintRevisionId !== blueprintRevisionId) throw new Error('Objective parentage is invalid')
  owned(authority.sessionContent, input.ownerId, 'Published session content')
  if (authority.sessionContent.id !== sessionContentId || authority.sessionContent.status !== 'published' || authority.sessionContent.blueprintRevisionId !== blueprintRevisionId || authority.sessionContent.objectiveId !== objectiveId) {
    throw new Error('Published session content authority is invalid')
  }
  const sessionContentRevision = positiveInteger(authority.sessionContent.revision, 'Session content revision')
  const sessionContentInputDigest = boundedText(authority.sessionContent.inputDigest, 'Session content input digest')
  const generatorVersion = boundedText(authority.sessionContent.generatorVersion, 'Session content generator version', 120)

  const claimsById = new Map(authority.claims.map(record => [record.id, record]))
  const supportsById = new Map(authority.supports.map(record => [record.id, record]))
  const snapshotsById = new Map(authority.sourceSnapshots.map(record => [record.id, record]))
  const excerptsById = new Map(authority.sourceExcerpts.map(record => [record.id, record]))
  const identitiesById = new Map(authority.sourceIdentities.map(record => [record.id, record]))
  const seen = new Set<string>()

  const claims = input.requestedReferences.map((requested): AdaptiveClaimProjection => {
    const claimId = boundedText(requested.claimId, 'Claim reference')
    const supportId = boundedText(requested.supportId, 'Support reference')
    const sourceSnapshotId = boundedText(requested.sourceSnapshotId, 'Source snapshot reference')
    const key = `${claimId}\u0000${supportId}\u0000${sourceSnapshotId}`
    if (seen.has(key)) throw new Error('Activity evidence references must be unique')
    seen.add(key)

    const claim = claimsById.get(claimId)
    owned(claim, input.ownerId, 'Accepted claim reference')
    if (claim.sessionContentId !== sessionContentId) throw new Error('Claim parentage is invalid')
    const support = supportsById.get(supportId)
    owned(support, input.ownerId, 'Accepted claim support')
    if (support.sessionContentClaimId !== claimId || support.sourceSnapshotId !== sourceSnapshotId || support.entailment !== 'entailed' || support.conflictStatus !== 'clear' || support.evidenceStatus !== 'evidence_available') {
      throw new Error('Claim support authority is invalid')
    }
    const snapshot = snapshotsById.get(sourceSnapshotId)
    owned(snapshot, input.ownerId, 'Accepted source snapshot')
    if (snapshot.learningVoidId !== learningVoidId || snapshot.blueprintRevisionId !== blueprintRevisionId || snapshot.status !== 'user_accepted' || snapshot.effectiveStatus !== 'user_accepted' || snapshot.rightsStatus !== 'permitted' || snapshot.conflictStatus !== 'clear' || snapshot.evidencePurgedAt !== undefined) {
      throw new Error('Source snapshot authority is invalid')
    }
    const excerpt = excerptsById.get(support.sourceExcerptId)
    owned(excerpt, input.ownerId, 'Permitted source excerpt')
    if (excerpt.sourceSnapshotId !== sourceSnapshotId || excerpt.rightsStatus !== 'permitted' || excerpt.evidencePurgedAt !== undefined) throw new Error('Source excerpt authority is invalid')
    const identity = identitiesById.get(snapshot.sourceIdentityId)
    owned(identity, input.ownerId, 'Source identity')
    if (identity.learningVoidId !== learningVoidId || identity.tombstonedAt !== undefined) throw new Error('Source identity authority is invalid')
    if (!(['folder_document', 'user_url', 'open_database', 'general_web_search'] as const).includes(identity.origin)) throw new Error('Source origin is invalid')

    const claimVerifier = claim.verifierVersion
    const supportVerifier = support.verifierVersion
    if (!claimVerifier || !supportVerifier || claimVerifier !== supportVerifier) throw new Error('Evidence verifier pin is unavailable or inconsistent')
    return {
      claimId,
      supportId,
      sourceSnapshotId,
      origin: identity.origin,
      locator: boundedText(excerpt.locator, 'Source locator', 1_000),
      sourceSnapshotRevision: positiveInteger(snapshot.revision, 'Source snapshot revision'),
      sourceRecordRevision: positiveInteger(snapshot.recordRevision, 'Source record revision'),
      sourceEffectiveStatus: 'user_accepted',
      verifierVersion: boundedText(claimVerifier, 'Evidence verifier version', 120),
      integrityState: 'accepted',
    }
  })
  const evidenceReferences = claims.map(({ origin: _origin, locator: _locator, ...reference }) => reference)

  return {
    kind: 'factual',
    claims,
    evidenceReferences,
    generationInputs: { sessionContentRevision, sessionContentInputDigest, generatorVersion },
  }
}
