import { describe, expect, test } from 'vitest'
import {
  projectAdaptiveClaimIntegrity,
  projectAdaptiveClaimAuthority,
  type AdaptiveClaimAuthorityInput,
  type AdaptiveClaimIntegrityInput,
} from './adaptive-claim-adapter'

const ownerId = 'owner-1'

function factualInput(): Extract<AdaptiveClaimAuthorityInput, { kind: 'factual' }> {
  return {
    kind: 'factual',
    ownerId,
    pins: {
      learningVoidId: 'void-1',
      blueprintRevisionId: 'blueprint-revision-1',
      objectiveId: 'objective-1',
      sessionContentId: 'session-content-1',
    },
    requestedReferences: [{
      claimId: 'claim-1',
      supportId: 'support-1',
      sourceSnapshotId: 'snapshot-1',
    }],
    authority: {
      learningVoid: { id: 'void-1', userId: ownerId },
      blueprintRevision: { id: 'blueprint-revision-1', userId: ownerId, learningVoidId: 'void-1' },
      objective: { id: 'objective-1', userId: ownerId, blueprintRevisionId: 'blueprint-revision-1' },
      sessionContent: {
        id: 'session-content-1',
        userId: ownerId,
        blueprintRevisionId: 'blueprint-revision-1',
        objectiveId: 'objective-1',
        revision: 4,
        status: 'published',
        inputDigest: `sha256:${'a'.repeat(64)}`,
        generatorVersion: 'learn-v2.session-content.v1',
      },
      claims: [{ id: 'claim-1', userId: ownerId, sessionContentId: 'session-content-1', verifierVersion: 'learn-v2.entailment.v2' }],
      supports: [{
        id: 'support-1',
        userId: ownerId,
        sessionContentClaimId: 'claim-1',
        sourceExcerptId: 'excerpt-1',
        sourceSnapshotId: 'snapshot-1',
        entailment: 'entailed',
        verifierVersion: 'learn-v2.entailment.v2',
        conflictStatus: 'clear',
        evidenceStatus: 'evidence_available',
      }],
      sourceSnapshots: [{
        id: 'snapshot-1',
        userId: ownerId,
        sourceIdentityId: 'identity-1',
        learningVoidId: 'void-1',
        blueprintRevisionId: 'blueprint-revision-1',
        revision: 3,
        recordRevision: 7,
        status: 'user_accepted',
        effectiveStatus: 'user_accepted',
        rightsStatus: 'permitted',
        conflictStatus: 'clear',
      }],
      sourceExcerpts: [{
        id: 'excerpt-1',
        userId: ownerId,
        sourceSnapshotId: 'snapshot-1',
        locator: 'page:4#paragraph:2',
        privateLocator: 'r2://must-not-cross-adapter',
        rightsStatus: 'permitted',
      }],
      sourceIdentities: [{
        id: 'identity-1',
        userId: ownerId,
        learningVoidId: 'void-1',
        origin: 'user_url',
      }],
    },
  }
}

function integrityInput(overrides: Partial<AdaptiveClaimIntegrityInput> = {}): AdaptiveClaimIntegrityInput {
  return {
    ownerId,
    historical: false,
    sessionContentId: 'session-content-1',
    sessionContentRevision: 4,
    pinned: {
      claimId: 'claim-1',
      supportId: 'support-1',
      sourceSnapshotId: 'snapshot-1',
      sourceSnapshotRevision: 3,
      sourceRecordRevision: 7,
      sourceEffectiveStatus: 'user_accepted',
      verifierVersion: 'learn-v2.entailment.v2',
      integrityState: 'accepted',
    },
    records: {
      sessionContent: { id: 'session-content-1', userId: ownerId, revision: 4, status: 'published' },
      claim: { id: 'claim-1', userId: ownerId, sessionContentId: 'session-content-1', claim: 'Plants convert light energy.', verifierVersion: 'learn-v2.entailment.v2' },
      support: { id: 'support-1', userId: ownerId, sessionContentClaimId: 'claim-1', sourceExcerptId: 'excerpt-1', sourceSnapshotId: 'snapshot-1', entailment: 'entailed', verifierVersion: 'learn-v2.entailment.v2', conflictStatus: 'clear', evidenceStatus: 'evidence_available' },
      sourceSnapshot: { id: 'snapshot-1', userId: ownerId, sourceIdentityId: 'identity-1', revision: 3, recordRevision: 7, status: 'user_accepted', effectiveStatus: 'user_accepted', rightsStatus: 'permitted', conflictStatus: 'clear' },
      sourceExcerpt: { id: 'excerpt-1', userId: ownerId, sourceSnapshotId: 'snapshot-1', locator: 'page:4#paragraph:2', privateLocator: 'r2://must-never-project', rightsStatus: 'permitted' },
      sourceIdentity: { id: 'identity-1', userId: ownerId, origin: 'user_url', privateLocator: 'https://private.example/source' },
    },
    ...overrides,
  }
}

describe('adaptive claim adapter', () => {
  test('keeps standalone non-factual activities evidence-free', () => {
    expect(projectAdaptiveClaimAuthority({
      kind: 'non_factual',
      ownerId,
      pins: { learningVoidId: null, blueprintRevisionId: null, objectiveId: null, sessionContentId: null },
      requestedReferences: [],
    })).toEqual({
      kind: 'non_factual',
      claims: [],
      evidenceReferences: [],
      generationInputs: {
        sessionContentRevision: null,
        sessionContentInputDigest: null,
        generatorVersion: null,
      },
    })
  })

  test('projects only immutable permitted authority for a factual activity', () => {
    expect(projectAdaptiveClaimAuthority(factualInput())).toEqual({
      kind: 'factual',
      claims: [{
        claimId: 'claim-1',
        supportId: 'support-1',
        sourceSnapshotId: 'snapshot-1',
        origin: 'user_url',
        locator: 'page:4#paragraph:2',
        sourceSnapshotRevision: 3,
        sourceRecordRevision: 7,
        sourceEffectiveStatus: 'user_accepted',
        verifierVersion: 'learn-v2.entailment.v2',
        integrityState: 'accepted',
      }],
      evidenceReferences: [{
        claimId: 'claim-1',
        supportId: 'support-1',
        sourceSnapshotId: 'snapshot-1',
        sourceSnapshotRevision: 3,
        sourceRecordRevision: 7,
        sourceEffectiveStatus: 'user_accepted',
        verifierVersion: 'learn-v2.entailment.v2',
        integrityState: 'accepted',
      }],
      generationInputs: {
        sessionContentRevision: 4,
        sessionContentInputDigest: `sha256:${'a'.repeat(64)}`,
        generatorVersion: 'learn-v2.session-content.v1',
      },
    })
  })

  test('rejects a non-canonical source origin at the plain-record boundary', () => {
    const input = factualInput()
    input.authority.sourceIdentities[0]!.origin = 'model_memory' as 'user_url'

    expect(() => projectAdaptiveClaimAuthority(input)).toThrow('Source origin is invalid')
  })

  test('rejects forged ownership, parentage, eligibility, revision, verifier, and cardinality inputs', () => {
    const corruptions: Array<(input: ReturnType<typeof factualInput>) => void> = [
      input => { input.authority.claims[0]!.userId = 'other-owner' },
      input => { input.authority.objective!.blueprintRevisionId = 'other-blueprint' },
      input => { input.authority.sessionContent!.status = 'ready' },
      input => { input.authority.sourceSnapshots[0]!.effectiveStatus = 'unavailable' },
      input => { input.authority.sourceSnapshots[0]!.rightsStatus = 'unknown' },
      input => { input.authority.sourceSnapshots[0]!.conflictStatus = 'unresolved' },
      input => { input.authority.sourceSnapshots[0]!.evidencePurgedAt = 1 },
      input => { input.authority.sourceSnapshots[0]!.recordRevision = undefined },
      input => { input.authority.supports[0]!.verifierVersion = 'other-verifier' },
      input => { input.authority.supports[0]!.evidenceStatus = 'evidence_unavailable' },
      input => { input.authority.sourceExcerpts[0]!.evidencePurgedAt = 1 },
      input => { input.authority.sourceIdentities[0]!.tombstonedAt = 1 },
      input => { input.requestedReferences.push({ ...input.requestedReferences[0]! }) },
      input => { input.requestedReferences = Array.from({ length: 17 }, (_, index) => ({ claimId: `claim-${index}`, supportId: `support-${index}`, sourceSnapshotId: `snapshot-${index}` })) },
    ]

    for (const corrupt of corruptions) {
      const input = factualInput()
      corrupt(input)
      expect(() => projectAdaptiveClaimAuthority(input)).toThrow()
    }
  })

  test('rejects factual pins on a non-factual activity', () => {
    expect(() => projectAdaptiveClaimAuthority({
      kind: 'non_factual',
      ownerId,
      pins: { learningVoidId: 'void-1', blueprintRevisionId: null, objectiveId: null, sessionContentId: null },
      requestedReferences: [],
    })).toThrow('Non-factual activity cannot carry factual authority')
  })

  test('keeps an accepted entailed claim epistemically unknown when V2 has no authoritative classifier', () => {
    expect(projectAdaptiveClaimIntegrity(integrityInput())).toEqual({
      claimId: 'claim-1',
      claimText: 'Plants convert light energy.',
      claimStatus: 'unknown',
      integrityState: 'accepted',
      source: {
        origin: 'user_url',
        locator: 'page:4#paragraph:2',
        sourceSnapshotId: 'snapshot-1',
        sourceSnapshotRevision: 3,
        sourceRecordRevision: 7,
      },
    })
  })

  test('passes through only an explicit authoritative epistemic classification', () => {
    const input = integrityInput()
    input.records.claim!.epistemicStatus = 'synthesis'

    const projection = projectAdaptiveClaimIntegrity(input)

    expect(projection.claimStatus).toBe('synthesis')
    delete input.records.claim!.epistemicStatus
    expect(projectAdaptiveClaimIntegrity(input).claimStatus).toBe('unknown')
  })

  test.each([
    ['insufficient', (input: AdaptiveClaimIntegrityInput) => { input.records.support!.entailment = 'not_evaluated' }],
    ['conflicting', (input: AdaptiveClaimIntegrityInput) => { input.records.support!.conflictStatus = 'unresolved' }],
    ['stale', (input: AdaptiveClaimIntegrityInput) => { input.records.sourceSnapshot!.recordRevision = 8 }],
    ['deleted', (input: AdaptiveClaimIntegrityInput) => { input.records.sourceExcerpt!.evidencePurgedAt = 123 }],
    ['unavailable', (input: AdaptiveClaimIntegrityInput) => { input.records.support!.evidenceStatus = 'evidence_unavailable' }],
  ] as const)('projects %s integrity without promoting degraded evidence', (integrityState, mutate) => {
    const input = integrityInput()
    mutate(input)

    const projection = projectAdaptiveClaimIntegrity(input)

    expect(projection.integrityState).toBe(integrityState)
    expect(projection.claimStatus).toBe('unknown')
    if (integrityState === 'deleted' || integrityState === 'unavailable' || integrityState === 'insufficient') {
      expect(projection.source.locator).toBeNull()
    }
    expect(JSON.stringify(projection)).not.toContain('must-never-project')
    expect(JSON.stringify(projection)).not.toContain('private.example')
  })

  test('labels purged historical evidence unavailable and keeps the claim read-only-safe', () => {
    const input = integrityInput({ historical: true })
    input.records.sourceSnapshot!.evidencePurgedAt = 123

    expect(projectAdaptiveClaimIntegrity(input)).toMatchObject({
      claimText: 'Plants convert light energy.',
      claimStatus: 'unknown',
      integrityState: 'unavailable',
      source: { locator: null },
    })
  })
})
