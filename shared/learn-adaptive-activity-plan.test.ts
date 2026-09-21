import { describe, expect, test } from 'vitest'
import {
  ADAPTIVE_ACTIVITY_PLAN_VERSION,
  ADAPTIVE_ACTIVITY_REPLAY_VERSION,
  type AdaptiveActivityPlanInput,
  composeAdaptiveActivityPlan,
  replayAdaptiveActivityPlan,
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
    verifierVersion: 'learn-v2.entailment.v2',
    integrityState: 'accepted' as const,
  }],
  generationInputs: {
    sessionContentRevision: 2,
    sessionContentInputDigest: `sha256:${'a'.repeat(64)}`,
    generatorVersion: 'learn-v2.session-content.v1',
  },
  decisionInputs: {
    availableTime: '25' as const,
    sourceState: 'ready' as const,
    priorActivityId: null,
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
})
