import { describe, expect, test } from 'vitest'
import { applyAdaptiveOverrideAtBoundary } from './learn-adaptive-override-application'
import type { AdaptiveRouterInput, AdaptiveRouterResult } from './learn-adaptive-router'
import type { AdaptiveOverrideOption } from './learn-adaptive-controls'

const input: AdaptiveRouterInput = {
  routerVersion: 'learn-adaptive.router.v1', threadState: 'active', authorityKind: 'v2_mission',
  intent: 'understand', intentRevision: 4, sourceState: 'ready',
  sourceInputs: [{ sourceSnapshotId: 'source_1', effectiveStatus: 'user_accepted', recordRevision: 1 },
    { sourceSnapshotId: 'source_2', effectiveStatus: 'user_accepted', recordRevision: 2 }],
  pins: { learningVoidId: 'void_1', blueprintRevisionId: 'blueprint_1', blueprintRecordRevision: 1,
    objectiveId: 'objective_1', sessionContentId: 'content_1', sessionContentRevision: 1 },
  availableTime: '25', priorActivity: null, mastery: null,
}
const routed: AdaptiveRouterResult = {
  routerVersion: 'learn-adaptive.router.v1', status: 'recommended',
  recommendation: { primitive: 'cited_explanation', activityClass: 'factual' }, reasonCode: 'grounded_start',
  overrides: [], fallback: { kind: 'non_factual_activity', primitive: 'diagnostic_prompt',
    activityClass: 'non_factual', reasonCode: 'safe_non_factual_recovery' },
}

describe('versioned next-boundary override application', () => {
  test.each([
    ['explain_differently', 'cited_explanation', 'factual'], ['example', 'worked_example', 'factual'],
    ['try', 'independent_application', 'factual'], ['quiz', 'independent_application', 'factual'],
    ['compare_sources', 'source_comparison', 'factual'], ['practical', 'artifact_workspace', 'non_factual'],
    ['easier', 'worked_example', 'factual'], ['answer_now', 'cited_explanation', 'factual'],
  ] as const)('maps %s to one closed semantic recommendation', (option, primitive, activityClass) => {
    expect(applyAdaptiveOverrideAtBoundary(input, routed, option)).toMatchObject({
      version: 'learn-adaptive.override-application.v1', outcome: 'applied', option,
      status: 'recommended', recommendation: { primitive, activityClass },
      reasonCode: `learner_requested_${option}`, effectiveAvailableTime: '25',
    })
  })

  test.each([
    ['time_15', '15'], ['time_25', '25'], ['time_45', '45'], ['time_60', '60'], ['time_no_limit', 'no_limit'],
  ] as const)('changes only next-boundary time for %s', (option, availableTime) => {
    expect(applyAdaptiveOverrideAtBoundary(input, routed, option)).toMatchObject({
      outcome: 'applied', option, recommendation: routed.recommendation,
      reasonCode: `learner_requested_${option}`, effectiveAvailableTime: availableTime,
    })
  })

  test('keeps harder unavailable and compare-sources blocked with one accepted source', () => {
    expect(applyAdaptiveOverrideAtBoundary(input, routed, 'harder')).toMatchObject({
      outcome: 'fallback', status: 'blocked', recommendation: null, applicationReason: 'policy_unavailable',
    })
    expect(applyAdaptiveOverrideAtBoundary({ ...input, sourceInputs: input.sourceInputs.slice(0, 1) }, routed, 'compare_sources'))
      .toMatchObject({ outcome: 'fallback', status: 'blocked', recommendation: null,
        applicationReason: 'insufficient_sources', fallback: routed.fallback })
  })

  test('does not override a blocked factual route or turn source-free work into factual content', () => {
    const blocked: AdaptiveRouterResult = { ...routed, status: 'blocked', recommendation: null,
      reasonCode: 'evidence_stale' }
    expect(applyAdaptiveOverrideAtBoundary({ ...input, sourceState: 'stale' }, blocked, 'answer_now'))
      .toMatchObject({ outcome: 'fallback', status: 'blocked', recommendation: null,
        reasonCode: 'evidence_stale', fallback: blocked.fallback, applicationReason: 'router_blocked' })
    const sourceFree = { ...input, authorityKind: 'standalone' as const, sourceState: 'none' as const,
      sourceInputs: [], pins: { learningVoidId: null, blueprintRevisionId: null, blueprintRecordRevision: null,
        objectiveId: null, sessionContentId: null, sessionContentRevision: null } }
    const diagnostic = { ...routed, recommendation: { primitive: 'diagnostic_prompt' as const,
      activityClass: 'non_factual' as const } }
    expect(applyAdaptiveOverrideAtBoundary(sourceFree, diagnostic, 'try')).toMatchObject({
      outcome: 'applied', recommendation: { primitive: 'diagnostic_prompt', activityClass: 'non_factual' },
    })
    expect(applyAdaptiveOverrideAtBoundary(sourceFree, diagnostic, 'answer_now')).toMatchObject({
      outcome: 'fallback', status: 'blocked', recommendation: null, applicationReason: 'evidence_unavailable',
    })
  })

  test('returns canonical byte-equivalent output for the same closed input', () => {
    const option: AdaptiveOverrideOption = 'example'
    expect(JSON.stringify(applyAdaptiveOverrideAtBoundary(input, routed, option)))
      .toBe(JSON.stringify(applyAdaptiveOverrideAtBoundary({ ...input, sourceInputs: [...input.sourceInputs] },
        { ...routed, overrides: [...routed.overrides] }, option)))
  })
})
