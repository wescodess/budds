import type { FirstValueEligibility, FirstValueExclusionCode, LearnActivityEventVersion } from './learn-adaptive-events'

export const FIRST_VALUE_METRIC_DEFINITION = {
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
} as const

export type FirstValueFixtureEvent = {
  eventId: string
  userId: string
  threadId: string
  opportunityOrdinal: number
  eventVersion: LearnActivityEventVersion
  occurredAt: number
  firstValueEligibility?: FirstValueEligibility
  firstValueExclusionCode?: FirstValueExclusionCode
  cohort?: string
  activityContractVersion?: string
}

export function evaluateFirstValueFixture(events: FirstValueFixtureEvent[]) {
  const starts = new Map<string, FirstValueFixtureEvent>()
  const stops = new Map<string, FirstValueFixtureEvent[]>()
  const key = (event: FirstValueFixtureEvent) => `${event.userId}\u0000${event.threadId}\u0000${event.opportunityOrdinal}`
  const earlier = (left: FirstValueFixtureEvent, right: FirstValueFixtureEvent) => left.occurredAt < right.occurredAt || (left.occurredAt === right.occurredAt && left.eventId < right.eventId)
  for (const event of events) {
    const eventKey = key(event)
    if (event.eventVersion === FIRST_VALUE_METRIC_DEFINITION.startEvent) {
      const current = starts.get(eventKey)
      if (!current || earlier(event, current)) starts.set(eventKey, event)
    }
    else if (event.eventVersion === FIRST_VALUE_METRIC_DEFINITION.stopEvent) {
      stops.set(eventKey, [...(stops.get(eventKey) ?? []), event])
    }
  }
  const opportunities = [...starts.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([eventKey, start]) => {
    const stop = (stops.get(eventKey) ?? []).filter(event => event.occurredAt >= start.occurredAt).sort((left, right) => earlier(left, right) ? -1 : earlier(right, left) ? 1 : 0)[0]
    if (start.cohort === undefined || start.activityContractVersion === undefined) throw new Error('First-value opportunity dimensions are incomplete')
    const eligibility = start.firstValueEligibility ?? 'excluded'
    const exclusionCode = start.firstValueExclusionCode ?? null
    const countedInReadyDenominator = FIRST_VALUE_METRIC_DEFINITION.eligibility.includes(eligibility as never) && exclusionCode === null
    const elapsedMs = stop ? stop.occurredAt - start.occurredAt : null
    return {
      userId: start.userId,
      threadId: start.threadId,
      opportunityOrdinal: start.opportunityOrdinal,
      cohort: start.cohort,
      activityContractVersion: start.activityContractVersion,
      eligibility,
      exclusionCode,
      startedAt: start.occurredAt,
      meaningfulActivityStartedAt: stop?.occurredAt ?? null,
      elapsedMs,
      countedInReadyDenominator,
      countedInNumerator: countedInReadyDenominator && elapsedMs !== null && elapsedMs <= FIRST_VALUE_METRIC_DEFINITION.timeWindowMs,
    }
  })
  return {
    metricVersion: FIRST_VALUE_METRIC_DEFINITION.version,
    readyDenominator: opportunities.filter(row => row.countedInReadyDenominator).length,
    readyNumerator: opportunities.filter(row => row.countedInNumerator).length,
    preparingDenominator: opportunities.filter(row => row.eligibility === 'preparing').length,
    excluded: opportunities.filter(row => row.eligibility === 'excluded' || row.exclusionCode !== null).length,
    opportunities,
  }
}
