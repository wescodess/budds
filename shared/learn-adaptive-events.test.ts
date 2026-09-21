import { describe, expect, test } from 'vitest'
import {
  LEARN_ACTIVITY_EVENT_TAXONOMY,
  LEARN_ACTIVITY_EVENT_TAXONOMY_VERSION,
  eventVersionFor,
  validateLearnActivityEventInput,
} from './learn-adaptive-events'

describe('Adaptive Learn event contract', () => {
  test('freezes the exact closed v1 taxonomy and type/version pairing', () => {
    expect(LEARN_ACTIVITY_EVENT_TAXONOMY_VERSION).toBe('learn-adaptive.activity-events.v1')
    expect(LEARN_ACTIVITY_EVENT_TAXONOMY).toEqual([
      'thread_command_committed', 'meaningful_activity_started', 'thread_drafted', 'evidence_ready', 'evidence_blocked',
      'activity_eligible', 'activity_started', 'meaningful_response', 'assistance', 'activity_completed',
      'representative_pass', 'representative_fail', 'delayed_check_eligible', 'delayed_check_attempt', 'retained',
      'remediation', 'provider_failure', 'provider_ambiguity', 'evidence_gap', 'evidence_invalidation', 'abandonment', 'explicit_end',
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
  })
})
