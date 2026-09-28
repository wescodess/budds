import { describe, expect, test } from 'vitest'
import { routeAdaptiveNextActivity } from './learn-adaptive-router'

function scopedMastery<T extends 'unseen' | 'guided' | 'needs_review' | 'independent' | 'retained'>(state: T) {
  return { scope: 'revision_scoped' as const, blueprintRevisionId: 'blueprint-revision-1', objectiveId: 'objective-1', state }
}

const readyInput = {
  routerVersion: 'learn-adaptive.router.v1', threadState: 'active', authorityKind: 'v2_mission', intent: 'understand', intentRevision: 2,
  sourceState: 'ready', sourceInputs: [{ sourceSnapshotId: 'snapshot-1', effectiveStatus: 'user_accepted', recordRevision: 3 }],
  pins: { learningVoidId: 'void-1', blueprintRevisionId: 'blueprint-revision-1', blueprintRecordRevision: 2,
    objectiveId: 'objective-1', sessionContentId: 'content-1', sessionContentRevision: 1 },
  availableTime: '25', priorActivity: null, mastery: scopedMastery('unseen'),
} as const

describe('versioned adaptive router', () => {
  test('accepts mastery only when its scoped identities are pinned to this objective and blueprint revision', () => {
    const result = routeAdaptiveNextActivity({ ...readyInput, mastery: {
      scope: 'revision_scoped', blueprintRevisionId: 'blueprint-revision-1', objectiveId: 'objective-1', state: 'unseen',
    } } as never)
    expect(result).toMatchObject({ status: 'recommended', recommendation: { primitive: 'cited_explanation' } })
  })

  test.each([
    ['blueprint revision', { ...scopedMastery('independent'), blueprintRevisionId: 'foreign-blueprint-revision' }],
    ['objective', { ...scopedMastery('independent'), objectiveId: 'foreign-objective' }],
  ] as const)('rejects mastery scoped to a different %s', (_label, mastery) => {
    const result = routeAdaptiveNextActivity({ ...readyInput, intent: 'master', mastery })
    expect(result).toMatchObject({ status: 'blocked', recommendation: null, reasonCode: 'unsupported_mastery' })
  })

  test('rejects retained transfer from a state that cannot be eligible for delayed mastery', () => {
    const result = routeAdaptiveNextActivity({ ...readyInput, intent: 'master', priorActivity: {
      activityId: 'activity-ineligible-transfer', primitive: 'independent_application', activityClass: 'factual',
      outcome: 'representative_pass', attemptId: 'attempt-ineligible-transfer', attemptKind: 'retained_transfer',
      assistance: 'none', confidence: null,
      masteryTransition: { attemptId: 'attempt-ineligible-transfer', attemptKind: 'retained_transfer',
        stateBefore: 'guided', stateAfter: 'retained', reason: 'eligible_delayed_pass_retained',
        version: 'learn-v2.mastery-transition.v1' },
    }, mastery: scopedMastery('retained') } as never)
    expect(result).toMatchObject({ status: 'blocked', recommendation: null, reasonCode: 'unsupported_mastery' })
  })

  test('recommends one grounded primitive from a pinned ready snapshot with a safe fallback', () => {
    const result = routeAdaptiveNextActivity(readyInput)
    expect(result).toMatchObject({
      routerVersion: 'learn-adaptive.router.v1', status: 'recommended',
      recommendation: { primitive: 'cited_explanation', activityClass: 'factual' },
      reasonCode: 'grounded_start',
      fallback: { primitive: 'diagnostic_prompt', activityClass: 'non_factual', reasonCode: 'safe_non_factual_recovery' },
    })
    expect(result.overrides).toHaveLength(14)
    expect(result.overrides.map(option => option.key)).toEqual([
      'explain_differently', 'example', 'try', 'quiz', 'compare_sources', 'practical', 'easier', 'harder',
      'answer_now', 'time_15', 'time_25', 'time_45', 'time_60', 'time_no_limit',
    ])
  })

  test.each(['none', 'preparing'] as const)('routes %s to a non-factual diagnostic without a mastery claim', (sourceState) => {
    const result = routeAdaptiveNextActivity({ ...readyInput, sourceState, sourceInputs: [], authorityKind: 'standalone', pins: {
      learningVoidId: null, blueprintRevisionId: null, blueprintRecordRevision: null,
      objectiveId: null, sessionContentId: null, sessionContentRevision: null,
    }, mastery: null })
    expect(result).toMatchObject({ status: 'recommended', recommendation: { primitive: 'diagnostic_prompt', activityClass: 'non_factual' },
      reasonCode: sourceState === 'none' ? 'source_free_diagnostic' : 'preparing_diagnostic' })
    expect(JSON.stringify(result)).not.toMatch(/"masteryState"|"independent"|"retained"/)
  })

  test.each(['blocked', 'stale', 'invalidated', 'unavailable'] as const)('blocks factual routing on %s source state with named non-factual recovery', (sourceState) => {
    const result = routeAdaptiveNextActivity({ ...readyInput, sourceState })
    expect(result).toMatchObject({ status: 'blocked', recommendation: null, reasonCode: `evidence_${sourceState}`,
      fallback: { primitive: 'diagnostic_prompt', activityClass: 'non_factual', reasonCode: 'safe_non_factual_recovery' } })
    expect(result.overrides.every(option => option.available === false)).toBe(true)
  })

  test.each([
    ['unsupported_router_version', { routerVersion: 'learn-adaptive.router.v2' }],
    ['thread_unavailable', { threadState: 'ended' }],
    ['unsupported_intent', { intent: 'watch' }],
    ['unsupported_pins', { pins: { ...readyInput.pins, objectiveId: null } }],
    ['unsupported_pins', { authorityKind: 'standalone' }],
    ['unsupported_evidence', { sourceInputs: [] }],
    ['unsupported_evidence', { sourceInputs: [{ sourceSnapshotId: 'snapshot-1', effectiveStatus: 'pending', recordRevision: 3 }] }],
    ['unsupported_evidence', { sourceInputs: [readyInput.sourceInputs[0], readyInput.sourceInputs[0]] }],
    ['unsupported_evidence', { sourceInputs: [{ sourceSnapshotId: 'snapshot-z', effectiveStatus: 'user_accepted', recordRevision: 1 },
      { sourceSnapshotId: 'snapshot-a', effectiveStatus: 'user_accepted', recordRevision: 1 }] }],
    ['unsupported_mastery', { mastery: { scope: 'legacy_unscoped', state: 'independent' } }],
    ['unsupported_input', { clickCount: 99 }],
    ['unsupported_input', { sourceText: 'PRIVATE SOURCE PASSAGE' }],
  ] as const)('fails closed for %s input combination', (reasonCode, change) => {
    const result = routeAdaptiveNextActivity({ ...readyInput, ...change } as never)
    expect(result).toMatchObject({ status: 'blocked', recommendation: null, reasonCode,
      fallback: { kind: 'safe_handoff', destination: 'learn_home' } })
    expect(result.overrides).toEqual([])
    expect(JSON.stringify(result)).not.toContain('PRIVATE SOURCE PASSAGE')
  })

  test.each([
    ['understand', 1, 'cited_explanation', 'grounded_start'],
    ['prepare', 1, 'independent_application', 'representative_practice'],
    ['build', 1, 'artifact_workspace', 'build_useful_artifact'],
    ['master', 1, 'independent_application', 'representative_practice'],
    ['refresh', 1, 'cited_explanation', 'grounded_review'],
    ['explore', 2, 'source_comparison', 'compare_accepted_sources'],
    ['explore', 1, 'cited_explanation', 'grounded_start'],
  ] as const)('%s with %s accepted source(s) selects one supported primitive', (intent, count, primitive, reasonCode) => {
    const sourceInputs = count === 1 ? readyInput.sourceInputs : [readyInput.sourceInputs[0],
      { sourceSnapshotId: 'snapshot-2', effectiveStatus: 'user_accepted' as const, recordRevision: 1 }]
    const result = routeAdaptiveNextActivity({ ...readyInput, intent, sourceInputs })
    expect(result).toMatchObject({ status: 'recommended', recommendation: { primitive }, reasonCode })
    expect(result.overrides.length).toBeLessThanOrEqual(14)
  })

  test('a failed representative attempt routes to remediation without rewriting the attempt', () => {
    const priorActivity = { activityId: 'activity-1', primitive: 'independent_application', activityClass: 'factual',
      outcome: 'representative_fail', attemptId: 'attempt-1', attemptKind: 'independent_application', assistance: 'none', confidence: { scale: 'v2_1_5', value: 2 },
      masteryTransition: { attemptId: 'attempt-1', attemptKind: 'independent_application', stateBefore: 'unseen', stateAfter: 'needs_review',
        reason: 'failed_check_needs_review', version: 'learn-v2.mastery-transition.v1' } } as const
    const result = routeAdaptiveNextActivity({ ...readyInput, intent: 'master', priorActivity,
      mastery: scopedMastery('needs_review') })
    expect(result).toMatchObject({ status: 'recommended', recommendation: { primitive: 'worked_example', activityClass: 'factual' }, reasonCode: 'remediate_failed_attempt' })
    expect(JSON.stringify(result)).not.toContain('attempt-1')
  })

  test('a pinned retained-transfer delayed pass promotes independent to retained', () => {
    const result = routeAdaptiveNextActivity({ ...readyInput, intent: 'master', priorActivity: {
      activityId: 'activity-delayed-pass', primitive: 'independent_application', activityClass: 'factual',
      outcome: 'representative_pass', attemptId: 'attempt-delayed-pass', attemptKind: 'retained_transfer',
      assistance: 'none', confidence: null,
      masteryTransition: { attemptId: 'attempt-delayed-pass', attemptKind: 'retained_transfer',
        stateBefore: 'independent', stateAfter: 'retained', reason: 'eligible_delayed_pass_retained',
        version: 'learn-v2.mastery-transition.v1' },
    }, mastery: scopedMastery('retained') } as never)
    expect(result).toMatchObject({ status: 'recommended', recommendation: { primitive: 'reflection_next_move' },
      reasonCode: 'reflect_on_demonstration' })
  })

  test('a pinned retained-transfer delayed failure moves retained to needs review', () => {
    const result = routeAdaptiveNextActivity({ ...readyInput, intent: 'master', priorActivity: {
      activityId: 'activity-delayed-fail', primitive: 'independent_application', activityClass: 'factual',
      outcome: 'representative_fail', attemptId: 'attempt-delayed-fail', attemptKind: 'retained_transfer',
      assistance: 'none', confidence: null,
      masteryTransition: { attemptId: 'attempt-delayed-fail', attemptKind: 'retained_transfer',
        stateBefore: 'retained', stateAfter: 'needs_review', reason: 'eligible_delayed_failure_needs_review',
        version: 'learn-v2.mastery-transition.v1' },
    }, mastery: scopedMastery('needs_review') } as never)
    expect(result).toMatchObject({ status: 'recommended', recommendation: { primitive: 'worked_example' },
      reasonCode: 'remediate_failed_attempt' })
  })

  test('assisted retained-transfer work preserves retained mastery even when the response fails', () => {
    const result = routeAdaptiveNextActivity({ ...readyInput, intent: 'master', priorActivity: {
      activityId: 'activity-delayed-assisted', primitive: 'independent_application', activityClass: 'factual',
      outcome: 'representative_fail', attemptId: 'attempt-delayed-assisted', attemptKind: 'retained_transfer',
      assistance: 'reveal', confidence: null,
      masteryTransition: { attemptId: 'attempt-delayed-assisted', attemptKind: 'retained_transfer',
        stateBefore: 'retained', stateAfter: 'retained', reason: 'assisted_mastery_preserved',
        version: 'learn-v2.mastery-transition.v1' },
    }, mastery: scopedMastery('retained') } as never)
    expect(result).toMatchObject({ status: 'recommended', recommendation: { primitive: 'worked_example' },
      reasonCode: 'remediate_failed_attempt' })
  })

  test.each([
    ['mismatched pinned attempt kind', 'independent_application', 'eligible_delayed_pass_retained', 'unsupported_prior_activity'],
    ['independent transition for a retained-transfer pass', 'retained_transfer', 'unassisted_pass_independent', 'unsupported_mastery'],
  ] as const)('rejects %s', (_name, transitionKind, reason, reasonCode) => {
    const result = routeAdaptiveNextActivity({ ...readyInput, intent: 'master', priorActivity: {
      activityId: 'activity-delayed-mismatch', primitive: 'independent_application', activityClass: 'factual',
      outcome: 'representative_pass', attemptId: 'attempt-delayed-mismatch', attemptKind: 'retained_transfer',
      assistance: 'none', confidence: null,
      masteryTransition: { attemptId: 'attempt-delayed-mismatch', attemptKind: transitionKind,
        stateBefore: 'independent', stateAfter: 'retained', reason, version: 'learn-v2.mastery-transition.v1' },
    }, mastery: scopedMastery('retained') } as never)
    expect(result).toMatchObject({ status: 'blocked', recommendation: null, reasonCode })
  })

  test('assisted representative success stays guided even with a high confidence calibration', () => {
    const priorActivity = { activityId: 'activity-2', primitive: 'independent_application', activityClass: 'factual',
      outcome: 'representative_pass', attemptId: 'attempt-2', attemptKind: 'independent_application', assistance: 'hint', confidence: { scale: 'v2_1_5', value: 5 },
      masteryTransition: { attemptId: 'attempt-2', attemptKind: 'independent_application', stateBefore: 'unseen', stateAfter: 'guided',
        reason: 'assisted_pass_guided', version: 'learn-v2.mastery-transition.v1' } } as const
    const result = routeAdaptiveNextActivity({ ...readyInput, intent: 'master', priorActivity,
      mastery: scopedMastery('guided') })
    expect(result).toMatchObject({ status: 'recommended', recommendation: { primitive: 'worked_example', activityClass: 'factual' }, reasonCode: 'assisted_guidance' })
    expect(JSON.stringify(result)).not.toMatch(/"primitive":"independent_application"|"state":"retained"|"state":"independent"/)
  })

  test('assisted work preserves a previously independent state without promoting it', () => {
    const result = routeAdaptiveNextActivity({ ...readyInput, intent: 'master', priorActivity: {
      activityId: 'activity-preserved', primitive: 'independent_application', activityClass: 'factual',
      outcome: 'representative_pass', attemptId: 'attempt-preserved', attemptKind: 'independent_application', assistance: 'hint', confidence: null,
      masteryTransition: { attemptId: 'attempt-preserved', attemptKind: 'independent_application', stateBefore: 'independent', stateAfter: 'independent',
        reason: 'assisted_mastery_preserved', version: 'learn-v2.mastery-transition.v1' },
    }, mastery: scopedMastery('independent') } as never)
    expect(result).toMatchObject({ status: 'recommended', recommendation: { primitive: 'worked_example' }, reasonCode: 'assisted_guidance' })
  })

  test.each([
    ['hint', 'guided', 'independent'],
    ['reveal', 'unseen', 'retained'],
  ] as const)('%s cannot promote %s to %s through an assisted representative pass', (assistance, stateBefore, stateAfter) => {
    const result = routeAdaptiveNextActivity({ ...readyInput, intent: 'master', priorActivity: {
      activityId: 'activity-promotion', primitive: 'independent_application', activityClass: 'factual',
      outcome: 'representative_pass', attemptId: 'attempt-promotion', attemptKind: 'independent_application', assistance, confidence: null,
      masteryTransition: { attemptId: 'attempt-promotion', attemptKind: 'independent_application', stateBefore, stateAfter,
        reason: 'assisted_mastery_preserved', version: 'learn-v2.mastery-transition.v1' },
    }, mastery: scopedMastery(stateAfter) } as never)
    expect(result).toMatchObject({ status: 'blocked', recommendation: null, reasonCode: 'unsupported_mastery' })
  })

  test('assisted work also preserves an already retained state without creating a new claim', () => {
    const result = routeAdaptiveNextActivity({ ...readyInput, intent: 'master', priorActivity: {
      activityId: 'activity-retained', primitive: 'independent_application', activityClass: 'factual',
      outcome: 'representative_pass', attemptId: 'attempt-retained', attemptKind: 'independent_application', assistance: 'reveal', confidence: null,
      masteryTransition: { attemptId: 'attempt-retained', attemptKind: 'independent_application', stateBefore: 'retained', stateAfter: 'retained',
        reason: 'assisted_mastery_preserved', version: 'learn-v2.mastery-transition.v1' },
    }, mastery: scopedMastery('retained') } as never)
    expect(result).toMatchObject({ status: 'recommended', recommendation: { primitive: 'worked_example' }, reasonCode: 'assisted_guidance' })
    expect(JSON.stringify(result)).not.toContain('retained')
  })

  test.each([
    ['attempt identity', { attemptId: 'other-attempt' }, 'unsupported_prior_activity'],
    ['transition reason', { reason: 'unassisted_pass_independent' }, 'unsupported_mastery'],
    ['transition version', { version: 'learn-v2.mastery-transition.v2' }, 'unsupported_mastery'],
    ['after-state', { stateAfter: 'retained' }, 'unsupported_mastery'],
  ] as const)('rejects a representative transition with mismatched %s', (_label, change, reasonCode) => {
    const priorActivity = { activityId: 'activity-checked', primitive: 'independent_application', activityClass: 'factual',
      outcome: 'representative_pass', attemptId: 'attempt-checked', attemptKind: 'independent_application', assistance: 'hint', confidence: null,
      masteryTransition: { attemptId: 'attempt-checked', attemptKind: 'independent_application', stateBefore: 'guided', stateAfter: 'guided',
        reason: 'assisted_pass_guided', version: 'learn-v2.mastery-transition.v1', ...change } }
    const result = routeAdaptiveNextActivity({ ...readyInput, intent: 'master', priorActivity, mastery: scopedMastery('guided') } as never)
    expect(result).toMatchObject({ status: 'blocked', recommendation: null, reasonCode })
  })

  test('a failed check honors the existing mastery table instead of accepting independent as an unchanged state', () => {
    const result = routeAdaptiveNextActivity({ ...readyInput, intent: 'master', priorActivity: {
      activityId: 'activity-failed', primitive: 'independent_application', activityClass: 'factual',
      outcome: 'representative_fail', attemptId: 'attempt-failed', attemptKind: 'independent_application', assistance: 'none', confidence: null,
      masteryTransition: { attemptId: 'attempt-failed', attemptKind: 'independent_application', stateBefore: 'independent', stateAfter: 'independent',
        reason: 'retained_mastery_preserved', version: 'learn-v2.mastery-transition.v1' },
    }, mastery: scopedMastery('independent') } as never)
    expect(result).toMatchObject({ status: 'blocked', recommendation: null, reasonCode: 'unsupported_mastery' })
  })

  test('the two tagged confidence scales normalize to the same observational route', () => {
    const prior = { activityId: 'activity-3', primitive: 'diagnostic_prompt', activityClass: 'non_factual', outcome: 'completed',
      attemptId: null, attemptKind: null, assistance: 'none', masteryTransition: null } as const
    const lowV2 = routeAdaptiveNextActivity({ ...readyInput, intent: 'prepare', priorActivity: { ...prior, confidence: { scale: 'v2_1_5', value: 1 } } })
    const lowNormalized = routeAdaptiveNextActivity({ ...readyInput, intent: 'prepare', priorActivity: { ...prior, confidence: { scale: 'normalized_0_1', value: 0 } } })
    expect(lowV2).toEqual(lowNormalized)
    expect(lowV2).toMatchObject({ recommendation: { primitive: 'worked_example' }, reasonCode: 'low_confidence_support' })
  })

  test('identical pinned values yield byte-equivalent JSON across object key order and repeat calls', () => {
    const shuffled = { mastery: { state: 'unseen', objectiveId: 'objective-1', scope: 'revision_scoped', blueprintRevisionId: 'blueprint-revision-1' }, priorActivity: null, availableTime: '25',
      pins: { sessionContentRevision: 1, sessionContentId: 'content-1', objectiveId: 'objective-1', blueprintRecordRevision: 2,
        blueprintRevisionId: 'blueprint-revision-1', learningVoidId: 'void-1' },
      sourceInputs: [{ recordRevision: 3, effectiveStatus: 'user_accepted', sourceSnapshotId: 'snapshot-1' }],
      sourceState: 'ready', intentRevision: 2, intent: 'understand', authorityKind: 'v2_mission',
      threadState: 'active', routerVersion: 'learn-adaptive.router.v1' } as const
    const original = JSON.stringify(routeAdaptiveNextActivity(readyInput))
    expect(JSON.stringify(routeAdaptiveNextActivity(shuffled))).toBe(original)
    expect(JSON.stringify(routeAdaptiveNextActivity(readyInput))).toBe(original)
  })

  test('mutating a returned fallback cannot affect a later decision', () => {
    const blockedInput = { ...readyInput, sourceState: 'stale' as const }
    const first = routeAdaptiveNextActivity(blockedInput)
    const expected = JSON.stringify(first)
    const mutableFallback = first.fallback as unknown as { reasonCode: string }
    mutableFallback.reasonCode = 'tampered'
    expect(JSON.stringify(routeAdaptiveNextActivity(blockedInput))).toBe(expected)
  })

  test.each([
    ['unsupported_pins', { pins: { ...readyInput.pins, sessionContentRevision: '1' } }],
    ['unsupported_pins', { pins: { ...readyInput.pins, objectiveId: 123 } }],
    ['unsupported_pins', { authorityKind: 'v2_mission', sourceState: 'preparing', sourceInputs: [], pins: { ...readyInput.pins, learningVoidId: null } }],
    ['unsupported_prior_activity', { priorActivity: { activityId: 'a-1', primitive: 'independent_application', activityClass: 'factual', outcome: 'representative_pass', attemptId: null, assistance: 'none', confidence: null } }],
    ['unsupported_prior_activity', { priorActivity: { activityId: 'a-1', primitive: 'diagnostic_prompt', activityClass: 'non_factual', outcome: 'representative_pass', attemptId: 'attempt-1', assistance: 'none', confidence: null } }],
    ['unsupported_prior_activity', { priorActivity: { activityId: 'a-1', primitive: 'cited_explanation', activityClass: 'non_factual', outcome: 'completed', attemptId: null, assistance: 'none', confidence: null } }],
    ['unsupported_prior_activity', { priorActivity: { activityId: 'a-1', primitive: 'diagnostic_prompt', activityClass: 'non_factual', outcome: 'completed', attemptId: null, assistance: 'none', confidence: { scale: 'v2_1_5', value: 6 } } }],
    ['unsupported_prior_activity', { priorActivity: { activityId: 'a-1', primitive: 'diagnostic_prompt', activityClass: 'non_factual', outcome: 'completed', attemptId: null, assistance: 'none', confidence: { scale: 'normalized_0_1', value: 1.5 } } }],
    ['unsupported_prior_activity', { priorActivity: { activityId: 'a-1', primitive: 'diagnostic_prompt', activityClass: 'non_factual', outcome: 'completed', attemptId: null, assistance: 'none', confidence: null, response: 'PRIVATE RESPONSE' } }],
    ['unsupported_prior_activity', { priorActivity: { activityId: 'a-1', primitive: 'diagnostic_prompt', activityClass: 'non_factual', outcome: 'provider_failure', attemptId: null, assistance: 'none', confidence: null } }],
    ['unsupported_prior_activity', { priorActivity: { activityId: 'a-1', primitive: 'independent_application', activityClass: 'factual', outcome: 'completed', attemptId: null, assistance: 'none', confidence: null } }],
    ['unsupported_mastery', { sourceState: 'preparing', sourceInputs: [], pins: { ...readyInput.pins, blueprintRevisionId: null, blueprintRecordRevision: null, objectiveId: null, sessionContentId: null, sessionContentRevision: null } }],
  ] as const)('blocks malformed pinned combination: %s', (reasonCode, change) => {
    const result = routeAdaptiveNextActivity({ ...readyInput, ...change } as never)
    expect(result).toMatchObject({ status: 'blocked', recommendation: null, reasonCode })
    expect(JSON.stringify(result)).not.toContain('PRIVATE RESPONSE')
  })

  test('observational signals cannot enter the router or raise a mastery claim', () => {
    const result = routeAdaptiveNextActivity({ ...readyInput, clicks: 500, timeOnPageMs: 900_000 } as never)
    expect(result).toMatchObject({ status: 'blocked', recommendation: null, reasonCode: 'unsupported_input' })
    expect(JSON.stringify(routeAdaptiveNextActivity(readyInput))).not.toMatch(/"mastery"|"score"|"retained"/)
  })

  test.each([
    ['unassisted pass with unseen state', 'representative_pass', 'none', 'unseen'],
    ['assisted pass with unseen state', 'representative_pass', 'hint', 'unseen'],
    ['failed attempt with unseen state', 'representative_fail', 'none', 'unseen'],
  ] as const)('blocks contradictory pinned mastery: %s', (_name, outcome, assistance, state) => {
    const result = routeAdaptiveNextActivity({ ...readyInput, intent: 'master', priorActivity: {
      activityId: 'activity-4', primitive: 'independent_application', activityClass: 'factual',
      outcome, attemptId: 'attempt-4', attemptKind: 'independent_application', assistance, confidence: null,
      masteryTransition: { attemptId: 'attempt-4', attemptKind: 'independent_application', stateBefore: 'unseen', stateAfter: state,
        reason: outcome === 'representative_fail' ? 'failed_check_needs_review' as const
          : assistance === 'none' ? 'unassisted_pass_independent' as const : 'assisted_pass_guided' as const,
        version: 'learn-v2.mastery-transition.v1' as const },
    }, mastery: scopedMastery(state) })
    expect(result).toMatchObject({ status: 'blocked', recommendation: null, reasonCode: 'unsupported_mastery' })
  })

  test('all closed source states and intents produce one bounded, JSON-safe result', () => {
    const intents = ['understand', 'prepare', 'build', 'master', 'refresh', 'explore'] as const
    const states = ['none', 'preparing', 'ready', 'blocked', 'stale', 'invalidated', 'unavailable'] as const
    for (const intent of intents) for (const sourceState of states) {
      const input = sourceState === 'none' || sourceState === 'preparing'
        ? { ...readyInput, intent, sourceState, authorityKind: 'standalone' as const, sourceInputs: [], pins: {
          learningVoidId: null, blueprintRevisionId: null, blueprintRecordRevision: null,
          objectiveId: null, sessionContentId: null, sessionContentRevision: null,
        }, mastery: null }
        : { ...readyInput, intent, sourceState }
      const result = routeAdaptiveNextActivity(input)
      expect(result.overrides.length).toBeLessThanOrEqual(14)
      expect(JSON.stringify(result)).toBe(JSON.stringify(routeAdaptiveNextActivity(input)))
      if (sourceState === 'ready') expect(result.status).toBe('recommended')
      else if (sourceState === 'none' || sourceState === 'preparing') expect(result.recommendation).toMatchObject({ activityClass: 'non_factual' })
      else expect(result).toMatchObject({ status: 'blocked', recommendation: null })
    }
  })

  test.each(['incomplete', 'provider_failure'] as const)('does not start a second factual activity from %s prior work', (outcome) => {
    const result = routeAdaptiveNextActivity({ ...readyInput, intent: 'prepare', priorActivity: {
      activityId: 'activity-5', primitive: 'cited_explanation', activityClass: 'factual', outcome,
      attemptId: null, attemptKind: null, assistance: 'none', confidence: null, masteryTransition: null,
    } })
    expect(result).toMatchObject({ status: 'blocked', recommendation: null,
      reasonCode: outcome === 'incomplete' ? 'prior_activity_incomplete' : 'prior_provider_failure',
      fallback: { kind: 'stay_on_current', reasonCode: 'unresolved_prior_activity' } })
  })
})
