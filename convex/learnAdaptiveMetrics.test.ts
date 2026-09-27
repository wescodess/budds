import { describe, expect, test } from 'vitest'
import { buildFirstValuePilotReport, FIRST_VALUE_METRIC_DEFINITION, evaluateFirstValueFixture, type FirstValueFixtureEvent } from '../shared/learn-adaptive-metrics'

describe('Adaptive Learn first-value metric', () => {
  test('freezes the ready-content denominator and inclusive 90-second numerator', () => {
    expect(FIRST_VALUE_METRIC_DEFINITION).toEqual({
      version: 'first_value.v1',
      eventSource: 'learnActivityEvents',
      startEvent: 'thread_command_committed.v1',
      stopEvent: 'meaningful_activity_started.v1',
      eligibility: ['ready_factual_content', 'ready_standalone_non_factual'],
      numerator: 'eligible opportunities with a server-authorized meaningful activity start at or before 90000ms',
      denominator: 'authenticated flag-eligible ready-content opportunities at thread command commit with no exclusion code',
      timeWindowMs: 90_000,
      exclusionCodes: ['explicit_exclusion', 'not_authenticated', 'flag_ineligible', 'evidence_blocked_at_commit', 'content_not_published_at_commit', 'standalone_activity_invalid'],
      preparingDenominator: 'preparing_at_commit opportunities measured separately from ready content',
      dimensions: ['eligibilityReason', 'eventVersions', 'exclusionCode', 'cohort', 'activityContractVersion', 'threadId'],
    })
    const result = evaluateFirstValueFixture([
      { eventId: 's-ready', userId: 'u1', threadId: 't1', opportunityOrdinal: 1, eventVersion: 'thread_command_committed.v1', occurredAt: 1_000, firstValueEligibility: 'ready_factual_content', cohort: 'pilot_a', activityContractVersion: 'learn-adaptive.activity-contract.v1' },
      { eventId: 'z-late-duplicate', userId: 'u1', threadId: 't1', opportunityOrdinal: 1, eventVersion: 'meaningful_activity_started.v1', occurredAt: 91_001 },
      { eventId: 'a-boundary', userId: 'u1', threadId: 't1', opportunityOrdinal: 1, eventVersion: 'meaningful_activity_started.v1', occurredAt: 91_000 },
      { eventId: 's-missed', userId: 'u2', threadId: 't2', opportunityOrdinal: 1, eventVersion: 'thread_command_committed.v1', occurredAt: 5_000, firstValueEligibility: 'ready_standalone_non_factual', cohort: 'pilot_a', activityContractVersion: 'learn-adaptive.activity-contract.v1' },
      { eventId: 's-preparing', userId: 'u3', threadId: 't3', opportunityOrdinal: 1, eventVersion: 'thread_command_committed.v1', occurredAt: 2_000, firstValueEligibility: 'preparing', cohort: 'pilot_b', activityContractVersion: 'learn-adaptive.activity-contract.v1' },
      { eventId: 's-excluded', userId: 'u4', threadId: 't4', opportunityOrdinal: 1, eventVersion: 'thread_command_committed.v1', occurredAt: 2_000, firstValueEligibility: 'excluded', firstValueExclusionCode: 'explicit_exclusion', cohort: 'pilot_b', activityContractVersion: 'learn-adaptive.activity-contract.v1' },
    ])
    expect(result).toEqual({
      metricVersion: 'first_value.v1', readyDenominator: 2, readyNumerator: 1, preparingDenominator: 1, excluded: 1,
      opportunities: [
        { userId: 'u1', threadId: 't1', opportunityOrdinal: 1, cohort: 'pilot_a', activityContractVersion: 'learn-adaptive.activity-contract.v1', eligibility: 'ready_factual_content', exclusionCode: null, startedAt: 1_000, meaningfulActivityStartedAt: 91_000, elapsedMs: 90_000, countedInReadyDenominator: true, countedInNumerator: true },
        { userId: 'u2', threadId: 't2', opportunityOrdinal: 1, cohort: 'pilot_a', activityContractVersion: 'learn-adaptive.activity-contract.v1', eligibility: 'ready_standalone_non_factual', exclusionCode: null, startedAt: 5_000, meaningfulActivityStartedAt: null, elapsedMs: null, countedInReadyDenominator: true, countedInNumerator: false },
        { userId: 'u3', threadId: 't3', opportunityOrdinal: 1, cohort: 'pilot_b', activityContractVersion: 'learn-adaptive.activity-contract.v1', eligibility: 'preparing', exclusionCode: null, startedAt: 2_000, meaningfulActivityStartedAt: null, elapsedMs: null, countedInReadyDenominator: false, countedInNumerator: false },
        { userId: 'u4', threadId: 't4', opportunityOrdinal: 1, cohort: 'pilot_b', activityContractVersion: 'learn-adaptive.activity-contract.v1', eligibility: 'excluded', exclusionCode: 'explicit_exclusion', startedAt: 2_000, meaningfulActivityStartedAt: null, elapsedMs: null, countedInReadyDenominator: false, countedInNumerator: false },
      ],
    })
  })

  test('never retroactively moves preparing opportunities into the ready denominator', () => {
    expect(evaluateFirstValueFixture([
      { eventId: 'start', userId: 'u1', threadId: 't1', opportunityOrdinal: 1, eventVersion: 'thread_command_committed.v1', occurredAt: 1, firstValueEligibility: 'preparing', cohort: 'pilot_a', activityContractVersion: 'learn-adaptive.activity-contract.v1' },
      { eventId: 'ready', userId: 'u1', threadId: 't1', opportunityOrdinal: 1, eventVersion: 'evidence_ready.v1', occurredAt: 2 },
      { eventId: 'meaningful', userId: 'u1', threadId: 't1', opportunityOrdinal: 1, eventVersion: 'meaningful_activity_started.v1', occurredAt: 3 },
    ])).toMatchObject({ readyDenominator: 0, readyNumerator: 0, preparingDenominator: 1 })
  })

  test('reproducible query fixture returns the 70 percent threshold within the frozen 90-second window', () => {
    const readyStarts: FirstValueFixtureEvent[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(index => ({
      eventId: `ready-start-${index}`, userId: `ready-user-${index}`, threadId: `ready-thread-${index}`,
      opportunityOrdinal: 1, eventVersion: 'thread_command_committed.v1', occurredAt: index * 100_000,
      firstValueEligibility: 'ready_factual_content', cohort: 'pilot_fixture', activityContractVersion: 'learn-adaptive.activity-contract.v1',
    }))
    const onTimeStops: FirstValueFixtureEvent[] = [1, 2, 3, 4, 5, 6, 7].map(index => ({
      eventId: `ready-stop-${index}`, userId: `ready-user-${index}`, threadId: `ready-thread-${index}`,
      opportunityOrdinal: 1, eventVersion: 'meaningful_activity_started.v1', occurredAt: index * 100_000 + 90_000,
    }))
    const fixture: FirstValueFixtureEvent[] = [
      ...readyStarts, ...onTimeStops,
      { eventId: 'late-stop', userId: 'ready-user-8', threadId: 'ready-thread-8', opportunityOrdinal: 1, eventVersion: 'meaningful_activity_started.v1', occurredAt: 890_001 },
      { eventId: 'preparing-start', userId: 'preparing-user', threadId: 'preparing-thread', opportunityOrdinal: 1, eventVersion: 'thread_command_committed.v1', occurredAt: 2_000_000, firstValueEligibility: 'preparing', cohort: 'pilot_fixture', activityContractVersion: 'learn-adaptive.activity-contract.v1' },
      { eventId: 'excluded-start', userId: 'excluded-user', threadId: 'excluded-thread', opportunityOrdinal: 1, eventVersion: 'thread_command_committed.v1', occurredAt: 2_100_000, firstValueEligibility: 'excluded', firstValueExclusionCode: 'explicit_exclusion', cohort: 'pilot_fixture', activityContractVersion: 'learn-adaptive.activity-contract.v1' },
    ]
    expect(buildFirstValuePilotReport(fixture)).toMatchObject({
      metricVersion: 'first_value.v1', timeWindowMs: 90_000, targetReadyRate: 0.7,
      readyDenominator: 10, readyNumerator: 7, readyRate: 0.7, preparingDenominator: 1, excluded: 1, meetsPilotTarget: true,
    })
  })
})
