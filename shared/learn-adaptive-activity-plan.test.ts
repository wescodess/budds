import { describe, expect, test } from 'vitest'
import {
  ADAPTIVE_ACTIVITY_PLAN_VERSION,
  ADAPTIVE_ACTIVITY_REPLAY_VERSION,
  ADAPTIVE_ASSESSMENT_PLAN_VERSION,
  adaptiveAssessmentReferenceSchema,
  type AdaptiveActivityPlanInput,
  composeAdaptiveActivityPlan,
  replayAdaptiveActivityPlan,
  readAdaptiveAssessmentReference,
} from './learn-adaptive-activity-plan'

const input = () => ({
  activityId: 'activity-001',
  threadId: 'thread-001',
  boundaryOrdinal: 1,
  planRevision: 1,
  activityClass: 'factual' as const,
  intent: 'understand' as const,
  objectiveId: 'objective-001',
  purpose: 'Explain the accepted mechanism before independent practice.',
  reasonCode: 'accepted_evidence_explanation',
  primitiveSequence: [{
    type: 'cited_explanation',
    action: 'continue',
    props: {
      heading: 'Photosynthesis mechanism',
      explanation: 'Plants convert light energy into stored chemical energy.',
      sourceRefs: ['snapshot-001'],
    },
  }],
  requiredAction: { kind: 'continue', label: 'Continue' },
  evaluationContract: {
    version: 'learn-adaptive.evaluation.v1',
    kind: 'acknowledgement' as const,
    responseFormat: 'none' as const,
    passingScorePercent: null,
  },
  accessibilityMetadata: {
    heading: 'Photosynthesis mechanism',
    instructions: 'Read the explanation, inspect its source if needed, then continue.',
    focusTargetTestId: 'learn-primitive-cited-explanation',
    liveRegionMode: 'polite' as const,
  },
  pins: {
    learningVoidId: 'void-001',
    blueprintRevisionId: 'blueprint-revision-001',
    objectiveId: 'objective-001',
    sessionContentId: 'session-content-001',
  },
  evidenceReferences: [{
    claimId: 'claim-001',
    supportId: 'support-001',
    sourceSnapshotId: 'snapshot-001',
    sourceSnapshotRevision: 3,
    sourceRecordRevision: 7,
    sourceEffectiveStatus: 'user_accepted' as const,
    verifierVersion: 'learn-v2.entailment.v2',
    integrityState: 'accepted' as const,
  }],
  generationInputs: {
    sessionContentRevision: 2,
    sessionContentInputDigest: `sha256:${'a'.repeat(64)}`,
    generatorVersion: 'learn-v2.session-content.v1',
  },
  decisionInputs: {
    intentRevision: 1,
    routerVersion: 'learn-adaptive.router.v1',
    availableTime: '25' as const,
    sourceState: 'ready' as const,
    sourceInputs: [{ sourceSnapshotId: 'snapshot-001', effectiveStatus: 'user_accepted' as const, recordRevision: 7 }],
    priorActivityId: null,
    priorAttemptId: null,
    priorOutcome: null,
    assistance: 'none' as const,
    confidence: null,
  },
})

describe('Adaptive activity plan replay contract', () => {
  test('composes identical pinned inputs into the same immutable plan and digest', async () => {
    const first = await composeAdaptiveActivityPlan(input())
    const second = await composeAdaptiveActivityPlan(structuredClone(input()))

    expect(first).toEqual(second)
    expect(first).toMatchObject({
      planVersion: ADAPTIVE_ACTIVITY_PLAN_VERSION,
      replayVersion: ADAPTIVE_ACTIVITY_REPLAY_VERSION,
      activityId: 'activity-001',
      threadId: 'thread-001',
      boundaryOrdinal: 1,
      planRevision: 1,
      reasonCode: 'accepted_evidence_explanation',
      decisionInputs: {
        intentRevision: 1,
        routerVersion: 'learn-adaptive.router.v1',
        sourceInputs: [{ sourceSnapshotId: 'snapshot-001', effectiveStatus: 'user_accepted', recordRevision: 7 }],
      },
      primitivePlan: [{ type: 'cited_explanation', action: 'continue' }],
      fallback: { kind: 'text_card', testId: 'learn-activity-fallback' },
      inputDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    })
    expect(await replayAdaptiveActivityPlan(first)).toEqual({ ok: true, value: first })
  })

  test.each([
    ['persisted purpose', (plan: Awaited<ReturnType<typeof composeAdaptiveActivityPlan>>) => ({ ...plan, purpose: 'Tampered purpose' })],
    ['persisted evidence link', (plan: Awaited<ReturnType<typeof composeAdaptiveActivityPlan>>) => ({ ...plan, evidenceReferences: [{ ...plan.evidenceReferences[0]!, claimId: 'claim-tampered' }] })],
    ['canonical snapshot', (plan: Awaited<ReturnType<typeof composeAdaptiveActivityPlan>>) => ({ ...plan, canonicalInputSnapshot: `${plan.canonicalInputSnapshot} ` })],
  ] as const)('rejects altered %s without rewriting the immutable plan', async (_label, alter) => {
    const original = await composeAdaptiveActivityPlan(input())
    const candidate = alter(structuredClone(original))

    expect(await replayAdaptiveActivityPlan(candidate)).toEqual({
      ok: false,
      reason: 'replay_integrity_failed',
    })
    expect(original).toEqual(await composeAdaptiveActivityPlan(input()))
  })

  test('rejects factual composition when evidence is missing or not accepted', async () => {
    await expect(composeAdaptiveActivityPlan({ ...input(), evidenceReferences: [] }))
      .rejects.toThrow('Factual activity requires accepted evidence')
    await expect(composeAdaptiveActivityPlan({
      ...input(),
      evidenceReferences: [{ ...input().evidenceReferences[0]!, integrityState: 'conflict' as const }],
    } as unknown as AdaptiveActivityPlanInput)).rejects.toThrow('Factual activity requires accepted evidence')
  })

  test('assessment plans retain only versioned measurement references in the existing envelope', async () => {
    const reference = adaptiveAssessmentReferenceSchema.parse({ version: ADAPTIVE_ASSESSMENT_PLAN_VERSION, assessmentOpportunityId: 'opportunity-001', deliveryGrantId: 'grant-001',
      item: { itemId: 'item-001', itemRevision: 1, promptDigest: `sha256:${'a'.repeat(64)}` },
      responseSpec: { kind: 'bounded_rubric' as const, version: 'response.v1', maxCodeUnits: 12000 as const },
      claims: [{ claimId: 'measurement-claim-001', revision: 1, claimDigest: `sha256:${'b'.repeat(64)}` }] })
    const assessment = { ...input(), assessmentReference: reference, primitiveSequence: [], evidenceReferences: [],
      purpose: 'PRIVATE TEACHING PURPOSE', evaluationContract: { version: 'learn-adaptive.evaluation.v1', kind: 'server_scored' as const,
        responseFormat: 'short_text' as const, passingScorePercent: 80 }, decisionInputs: { ...input().decisionInputs, sourceInputs: [] } }
    const plan = await composeAdaptiveActivityPlan(assessment)
    expect(plan.planVersion).toBe(ADAPTIVE_ACTIVITY_PLAN_VERSION)
    expect(plan.primitivePlan).toEqual([])
    expect(plan.evidenceReferences).toEqual([])
    expect(readAdaptiveAssessmentReference(plan)).toEqual(reference)
    expect(JSON.stringify(plan)).not.toContain('PRIVATE TEACHING PURPOSE')
    expect(JSON.stringify(plan)).not.toContain(input().primitiveSequence[0]!.props.explanation)
    expect(await replayAdaptiveActivityPlan(plan)).toEqual({ ok: true, value: plan })
    await expect(composeAdaptiveActivityPlan({ ...assessment, primitiveSequence: input().primitiveSequence })).rejects.toThrow('cannot contain teaching')
    await expect(composeAdaptiveActivityPlan({ ...assessment, assessmentReference: { ...reference, key: 'PRIVATE KEY' } } as unknown as AdaptiveActivityPlanInput)).rejects.toThrow()
    await expect(composeAdaptiveActivityPlan({ ...assessment, assessmentReference: { ...reference, claims: [...reference.claims, ...reference.claims] } })).rejects.toThrow()
    expect(await replayAdaptiveActivityPlan({ ...plan, canonicalInputSnapshot: plan.canonicalInputSnapshot.replace('grant-001', 'grant-other') })).toEqual({ ok: false, reason: 'replay_integrity_failed' })
    expect(await composeAdaptiveActivityPlan(input())).toEqual(await composeAdaptiveActivityPlan({ ...input(), assessmentReference: undefined }))
  })
})
