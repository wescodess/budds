import { describe, expect, test } from 'vitest'
import {
  LEARN_ACTIVITY_EVENT_TAXONOMY,
  LEARN_ACTIVITY_EVENT_TAXONOMY_VERSION,
  eventVersionFor,
  validateLearnActivityEventInput,
} from './learn-adaptive-events'

describe('Adaptive Learn event contract', () => {
  test('freezes the exact closed v6 taxonomy and type/version pairing', () => {
    expect(LEARN_ACTIVITY_EVENT_TAXONOMY_VERSION).toBe('learn-adaptive.activity-events.v6')
    expect(LEARN_ACTIVITY_EVENT_TAXONOMY).toEqual([
      'thread_command_committed', 'meaningful_activity_started', 'thread_drafted', 'evidence_ready', 'evidence_blocked',
      'activity_eligible', 'activity_started', 'meaningful_response', 'assistance', 'activity_completed',
      'representative_pass', 'representative_fail', 'delayed_check_eligible', 'delayed_check_attempt', 'retained',
      'remediation', 'provider_failure', 'provider_ambiguity', 'evidence_gap', 'evidence_invalidation', 'abandonment', 'explicit_end', 'routing_decision', 'canvas_render_failure', 'contribution_recorded', 'contribution_rejected', 'cross_feature_activity_created', 'cross_feature_activity_blocked', 'cross_feature_activity_invalidated', 'experiment_assignment',
    ])
    expect(LEARN_ACTIVITY_EVENT_TAXONOMY.map(type => eventVersionFor(type))).toEqual(
      LEARN_ACTIVITY_EVENT_TAXONOMY.map(type => `${type}.v1`),
    )
  })

  test('accepts only bounded non-content metadata and rejects sensitive payload fields', () => {
    const safe = {
      eventType: 'activity_eligible' as const,
      eventVersion: 'activity_eligible.v1' as const,
      sourceVersion: 'learn-adaptive.activity-plan.v1',
      contractVersion: 'learn-adaptive.activity-contract.v1',
      semanticKey: 'activity:activity-1:eligible',
      occurredAt: 1,
      reasonCode: 'activity_plan_committed',
      outcomeCode: 'eligible',
      metadata: { activityClass: 'factual' as const, boundaryOrdinal: 1, planRevision: 1, firstValueEligibility: 'ready_factual_content' as const },
    }
    expect(validateLearnActivityEventInput(safe)).toEqual(safe)
    for (const forbidden of ['rawQuery', 'providerResult', 'privateLocator', 'secret', 'learnerResponse']) {
      expect(() => validateLearnActivityEventInput({ ...safe, [forbidden]: 'private-value' } as never), forbidden).toThrow(/event payload/i)
      expect(() => validateLearnActivityEventInput({ ...safe, metadata: { ...safe.metadata, [forbidden]: 'private-value' } } as never), forbidden).toThrow(/metadata/i)
    }
    expect(() => validateLearnActivityEventInput({ ...safe, reasonCode: 'https://private.example/a' })).toThrow(/reason code/i)
    expect(() => validateLearnActivityEventInput({ ...safe, metadata: { ...safe.metadata,
      experimentAnalysisVersion: 'adaptive-routing-analysis.v1', experimentEligibility: 'eligible', cohort: 'adaptive' } }))
      .toThrow(/experiment metadata/i)
  })

  test('routing decision events carry only a boundary and optional closed activity class', () => {
    const routing = { eventType: 'routing_decision' as const, eventVersion: 'routing_decision.v1' as const,
      sourceVersion: 'learn-adaptive.router.v1', contractVersion: 'learn-adaptive.routing-decision.v1',
      semanticKey: 'routing:activity-1', occurredAt: 1, reasonCode: 'source_free_diagnostic',
      outcomeCode: 'recommended', metadata: { boundaryOrdinal: 1, activityClass: 'non_factual' as const } }
    expect(validateLearnActivityEventInput(routing)).toEqual(routing)
    expect(() => validateLearnActivityEventInput({ ...routing, metadata: { boundaryOrdinal: 1, cohort: 'private_cohort' } } as never))
      .toThrow(/routing decision metadata/i)
    expect(() => validateLearnActivityEventInput({ ...routing, metricDefinitionVersion: 'first_value.v1' }))
      .toThrow(/routing decision metadata/i)
  })

  test('experiment assignment event outcome agrees with closed eligibility and exclusion metadata', () => {
    const assigned = { eventType: 'experiment_assignment' as const, eventVersion: 'experiment_assignment.v1' as const,
      sourceVersion: 'adaptive-routing-analysis.v1', contractVersion: 'learn-adaptive.experiment-assignment.v1',
      semanticKey: 'experiment:adaptive-routing-analysis.v1', occurredAt: 1, outcomeCode: 'assigned',
      metadata: { cohort: 'adaptive', experimentEligibility: 'eligible' as const,
        experimentAnalysisVersion: 'adaptive-routing-analysis.v1' as const } }
    expect(validateLearnActivityEventInput(assigned)).toEqual(assigned)
    expect(() => validateLearnActivityEventInput({ ...assigned, outcomeCode: 'excluded' })).toThrow(/assignment metadata/i)
    expect(() => validateLearnActivityEventInput({ ...assigned, metadata: { ...assigned.metadata, cohort: 'excluded' } })).toThrow(/assignment metadata/i)
    const excluded = { ...assigned, outcomeCode: 'excluded', reasonCode: 'guardrail_rollback',
      metadata: { cohort: 'excluded', experimentEligibility: 'excluded' as const,
        experimentExclusionCode: 'guardrail_rollback' as const,
        experimentAnalysisVersion: 'adaptive-routing-analysis.v1' as const } }
    expect(validateLearnActivityEventInput(excluded)).toEqual(excluded)
    expect(() => validateLearnActivityEventInput({ ...excluded, reasonCode: 'other' })).toThrow(/assignment metadata/i)
  })

  test('Canvas render failures contain only a closed reason and bounded fallback metadata', () => {
    const failure = { eventType: 'canvas_render_failure' as const, eventVersion: 'canvas_render_failure.v1' as const,
      sourceVersion: 'learn-adaptive.primitive-validation.v1', contractVersion: 'learn-adaptive.activity-contract.v1',
      semanticKey: 'activity:one:plan:1:render:unsafe_url', occurredAt: 1, reasonCode: 'unsafe_url',
      outcomeCode: 'fallback_rendered', metadata: { activityClass: 'factual' as const, boundaryOrdinal: 1, planRevision: 1 } }
    expect(validateLearnActivityEventInput(failure)).toEqual(failure)
    expect(validateLearnActivityEventInput({ ...failure, reasonCode: 'renderer_unavailable' })).toMatchObject({ reasonCode: 'renderer_unavailable' })
    expect(() => validateLearnActivityEventInput({ ...failure, reasonCode: 'private_source_url' })).toThrow(/Canvas render failure metadata/i)
    expect(() => validateLearnActivityEventInput({ ...failure, metadata: { ...failure.metadata, cohort: 'private' } } as never)).toThrow(/Canvas render failure metadata/i)
    expect(() => validateLearnActivityEventInput({ ...failure, outcomeCode: 'success' })).toThrow(/Canvas render failure metadata/i)
  })
})
