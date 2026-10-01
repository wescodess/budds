import { FIRST_VALUE_METRIC_DEFINITION } from './learn-adaptive-metrics.ts'

export const OPERATIONAL_QUERY_VERSION = 'operational_fixture_query.v1'
export const OPERATIONAL_REGISTRY_VERSION = 'operational_metrics.v1'
export const OPERATIONAL_FIXTURE_VERSION = 'adaptive_learn_metric_fixture.v1'
export const PROVIDER_BOUNDARY_SOURCE_VERSION = 'provider_boundary_fixture.v1'
export const OPERATIONAL_FIXTURE_LIMITS = Object.freeze({ bytes: 262_144, rows: 1000, windowMs: 90 * 24 * 60 * 60 * 1000 })

const common = {
  queryIdentity: OPERATIONAL_QUERY_VERSION,
  fixtureIdentity: 'operational.v1',
  timeWindow: 'fixture [windowStart, windowEnd], at most 90 days',
  ownerPrincipal: null,
  approval: 'pending',
  exclusions: Object.freeze(['outside fixture window rejected', 'identical eventId retries deduplicated', 'missing source telemetry reported unknown', 'known not_dispatched excluded from dispatched metrics; unknown dispatch blocks completeness']),
} as const

// Slice-0 owns the nested definition; this wrapper adds publication metadata only.
export const OPERATIONAL_METRIC_DEFINITIONS = Object.freeze([
  Object.freeze({ ...common, version: FIRST_VALUE_METRIC_DEFINITION.version, eventSource: FIRST_VALUE_METRIC_DEFINITION.eventSource, eligibility: FIRST_VALUE_METRIC_DEFINITION.eligibility, numerator: FIRST_VALUE_METRIC_DEFINITION.numerator, denominator: FIRST_VALUE_METRIC_DEFINITION.denominator, timeWindow: '90000ms from committed opportunity', exclusions: FIRST_VALUE_METRIC_DEFINITION.exclusionCodes, ownerRole: 'product_analytics', definition: FIRST_VALUE_METRIC_DEFINITION }),
  ...[
    ['provider_ambiguity.v1', 'learnActivityEvents/provider_ambiguity.v1 + provider_boundary_fixture.v1', 'dispatchState dispatched; unknown dispatch makes rate unknown', 'distinct dispatched boundaries with reconciliation ambiguity', 'dispatchState dispatched boundaries'],
    ['fallback.v1', 'learnActivityEvents/canvas_render_failure.v1 + provider_boundary_fixture.v1', 'render attempts', 'attempts with fallback_rendered outcome', 'render attempts'],
    ['provider_latency.v1', PROVIDER_BOUNDARY_SOURCE_VERSION, 'dispatchState dispatched; incomplete completion timing or unknown dispatch blocks complete mean', 'sum completedAt - dispatchedAt in ms over observed samples; report sample mean', 'sampleCount for observed mean; eligibleCount is dispatched boundaries; missingCount is dispatched boundaries without completion timing'],
    ['quota_denial.v1', PROVIDER_BOUNDARY_SOURCE_VERSION, 'reservation decisions explicitly admitted or quota_denied', 'explicit quota_denied decisions', 'all explicit reservation decisions'],
    ['recorded_provider_cost.v1', PROVIDER_BOUNDARY_SOURCE_VERSION, 'dispatchState dispatched; missing recorded cost or unknown dispatch blocks complete total', 'sum recordedCostUsdMicros over observed samples; no ceiling substitution', 'sampleCount is boundaries with recorded cost; eligibleCount is dispatched boundaries; missingCount is dispatched boundaries without cost'],
  ].map(([version, eventSource, eligibility, numerator, denominator]) => Object.freeze({ ...common, version, eventSource, eligibility, numerator, denominator, ownerRole: 'platform_operations' })),
])
