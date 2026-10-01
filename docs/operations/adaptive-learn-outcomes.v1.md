# Adaptive Learn outcome metric definitions

ALA 6.2b adds versioned retention, experiment, cross-feature, accessibility/recovery, cost-per-request, and support definitions. The publication remains fixture-only, with unassigned approving principals and pending live adapters. It does not change the frozen first-value denominator or authorize experiment/provider exposure.

## Reproduce the publication

Run the outcome evaluator against its default frozen fixture, then run its public CLI regressions:

```sh
node scripts/adaptive-learn-outcomes.mjs
pnpm exec vitest run shared/learn-adaptive-outcome-metrics.test.ts shared/learn-adaptive-operational-metrics.test.ts convex/learnAdaptiveMetrics.test.ts
```

The registry lives in `shared/learn-adaptive-outcome-metrics.ts`. The CLI accepts bounded synthetic source records and returns aggregates, definition/query identities, and a fixture content digest. It does not export learner, assignment, attempt, or origin identifiers, accept raw learner/contact content, or convert a fixture declaration into trusted production evidence.

The publication pins `outcome_metrics.v1`, `outcome_fixture_query.v1`, and the `adaptive_learn_outcome_fixture.v1` envelope with fixture identity `outcomes.v1`. Input stays within 262,144 bytes, 1,000 total source rows including nested origins, and a measurement window of at most 90 days. The envelope carries exact source versions and separate coverage declarations; a missing source remains unknown even when another family has observations.

## Source and authority boundaries

| Family | Required authority | Missing live evidence |
| --- | --- | --- |
| Delayed retention | Independently enumerated eligible capabilities, authoritative scored attempts, pinned rubric/source identity, and the first-independent local clock/timezone. | Event exports alone do not enumerate capabilities with no delayed attempt or preserve every required clock/attempt pin. |
| Experiment | Frozen analysis-plan identity, authenticated-learner assignment, eligibility/exclusions, cohort, and linked outcomes. | Exported assignments omit the plan ID; actual approved baseline/effect/sample/stop decisions remain outstanding. |
| Cross-feature | Canonical contribution and attempt identity plus producer-verified shared activity lineage, retaining each distinct origin. | Owner exports omit full producer provenance; unrelated/client-claimed aliases cannot establish one attempt. |
| Accessibility/recovery | Tested revision, task/cohort, baseline/treatment population, completion/recovery outcomes, and versioned verifier evidence. | Synthetic/component records do not prove physical assistive-technology or deployed behavior. |
| Cost per request | Known provider dispatch and recorded integer USD micro-units for the complete eligible request population. | Existing job exports contain ceilings/reservation upper bounds, not actual invoices or recorded spend. |
| Support contacts | Versioned contact source, opaque contact identity, category/cohort, reporting window, and eligible population coverage. | The closed event taxonomy has no support-contact event; no trusted live support adapter exists. |

Each published definition pins its eligibility, numerator, denominator, window, exclusions, source/query/fixture identities, owner role, principal, and approval state. Assigning a role is not assigning a real principal. A new approved definition requires a separate reviewed version; operators must not rewrite a frozen denominator or infer approval from a successful fixture run.

## Interpretation rules

Retention joins actual delayed unassisted evidence to an independently enumerated eligible capability. Seven days means seven local calendar days under the immutable first-independent timezone, not 168 elapsed hours. Immediate completion, confidence, clicks, views, and a retained-state transition alone cannot qualify. A missing due check remains visible in coverage and blocks a complete retention claim.

The earliest eligible unassisted check determines the result for each due capability; a later passing retry cannot replace an earlier failure. The observed-check subaggregate remains separate from complete retention. Historical first-independent evidence can predate the reporting window, but reported delayed checks remain inside it.

Experiment performance, task completion, and self-reported usefulness remain separate outcomes. Cross-feature reconciliation requires verified producer lineage and cannot hide an origin or count a retry as another attempt. Missing approval, corpus, baseline, verifier, or source coverage remains explicit; the evaluator does not infer a release decision.

Cost reservations and configured ceilings remain upper bounds. Missing recorded cost or unknown dispatch prevents a complete cost-per-request result, while any observed partial aggregate carries its own label. Missing support or accessibility evidence is unknown, not zero contacts or a passing audit.

## Remaining gates

The six metric families have deterministic synthetic definitions, not trusted live telemetry adapters. Product Analytics must assign real metric owners and approve frozen eligibility, clock, source, corpus, and experiment decisions; independent accessibility and operational evidence remain separate gates. A fixture result cannot close these gates, activate a cohort/provider, or establish a physical-device, production, or seven-day-soak result.
