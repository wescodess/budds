# Adaptive Learn first-value and operational metrics

The ALA 6.2a registry publishes versioned definitions and a bounded, reproducible fixture query. The registry extends the existing Slice-0 first-value contract without changing its denominator, event writers, or runtime exposure gates.

## Run the fixture query

Run the query from the repository root with the supported Node version. The default input is `docs/operations/adaptive-learn-metric-fixtures/operational.v1.json`; an explicit fixture uses the same versioned, bounded input contract.

```sh
node scripts/adaptive-learn-metrics.mjs
node scripts/adaptive-learn-metrics.mjs --fixture docs/operations/adaptive-learn-metric-fixtures/operational.v1.json
```

The CLI emits aggregate JSON with fixture identity, content digest, definition/query versions, and pending approval state. Its output always identifies synthetic evidence and reports `activationReady: false`. A fixture result does not approve a metric, authorize provider dispatch, or satisfy a deployed release gate.

## Definition authority

`shared/learn-adaptive-operational-metrics.ts` owns the frozen `operational_metrics.v1` registry and `operational_fixture_query.v1` query. Each definition declares its version, event source, eligibility, numerator, denominator, time window, exclusions, query/fixture identity, owner role, and approval state. Change a published definition by introducing a new version; do not silently reinterpret existing results.

Product Analytics and Platform Operations remain responsible roles, not assigned approving principals. The registry records `ownerPrincipal: null` and pending approval. Real identities and approval evidence require a separate versioned review record tied to the frozen definition; they must not silently change this registry. This document does not assign a person or fabricate sign-off.

## Preserve the Slice-0 first-value boundary

The first-value wrapper references `FIRST_VALUE_METRIC_DEFINITION` and the existing evaluator in `shared/learn-adaptive-metrics.ts`. Timing starts at `thread_command_committed.v1` and stops at the earliest subsequent server-authorized `meaningful_activity_started.v1`. Eligible ready-content opportunities retain their eligibility and exclusions at commit; later evidence readiness does not move preparing opportunities into that denominator.

The inclusive 90,000 ms window and existing 70% pilot threshold remain unchanged. Preparing opportunities appear separately. Loading, generated outlines, schedules, clicks, confidence, or content views do not substitute for a meaningful activity start or imply mastery.

## Operational sources and unknowns

The fixtures reproduce ambiguity, fallback, latency, quota, and recorded-cost counters through the explicit `provider_boundary_fixture.v1` source contract and eligible activity boundaries. Fixture records are synthetic; the source contract still needs a trusted live telemetry adapter before an operator can use it as deployed evidence.

| Counter | Source boundary | Evidence limit |
| --- | --- | --- |
| Provider ambiguity | A dispatched provider boundary that requires reconciliation. | A reservation failure alone does not establish dispatch or ambiguity. |
| Fallback | An eligible activity boundary with an observed fallback outcome. | An available fallback is not proof that the learner saw it. |
| Latency | Observed provider dispatch and completion timing. | Job creation/update timestamps do not establish provider latency. |
| Quota denial | An explicit quota decision at an eligible admission boundary. | A generic reservation-stage failure is not a quota-denial counter. |
| Recorded cost | Recorded usage cost with explicit provenance. | Configured cost ceilings, reserved credits, or missing cost records are not actual cost. |

Current owner-visible `learnJobs` exports contain policy limits and a configured cost ceiling, but not actual monetary cost or provider dispatch/completion timestamps. Missing telemetry must remain unknown rather than become zero; incomplete cost coverage must not become a complete spend total. An empty eligible denominator does not establish a successful release rate.

## Verification and remaining gates

CLI tests check reproducibility, frozen first-value behavior, bounds, invalid/private input rejection, retry duplicate handling, unknown telemetry, and pending approval. Run the focused tests and the repository-wide `pnpm verify` gate before publishing changes.

```sh
pnpm exec vitest run shared/learn-adaptive-operational-metrics.test.ts convex/learnAdaptiveMetrics.test.ts
```

The registry and frozen fixtures establish local reproducibility only. Assigned metric owners, independent approval, trusted live telemetry, merged dependencies, and required operational evidence remain release gates. Retention, cross-feature, accessibility, usefulness, and support definitions belong to ALA 6.2b rather than this registry slice.
