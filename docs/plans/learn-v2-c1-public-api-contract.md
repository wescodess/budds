# Phase C1 public API contract

API version: `learn-v2.public-api.v1`. Implements [C1.3 #423](https://github.com/wescodess/budds/issues/423) for [C1 #413](https://github.com/wescodess/budds/issues/413). Report output is `learn-v2.measurement-report.v2`; source/query and metric definitions remain v1. This contract adds no active response, delivery, scoring, assistance or report writer.

The accepted [baseline](https://github.com/wescodess/budds/issues/359#issuecomment-6651298918), [lifecycle](https://github.com/wescodess/budds/issues/360#issuecomment-6651303610), [responses](https://github.com/wescodess/budds/issues/363#issuecomment-6651831618), [items](https://github.com/wescodess/budds/issues/364#issuecomment-6651739355), [reports](https://github.com/wescodess/budds/issues/366#issuecomment-6652156993), [disclosure](https://github.com/wescodess/budds/issues/373#issuecomment-6651824980) and [scorer identity](https://github.com/wescodess/budds/issues/380#issuecomment-6651838342) resolutions remain binding.

## Registered boundaries

Argument and return validators live in `convex/lib/learnV2PublicContract.ts`. They are importable by application and server adapters and contain no private scorer or source loader. Existing shared schemas supply semantic validation, including original-envelope bytes, finite numbers, exact response text, code-unit limits and URL-safe command keys. Invalid wire input produces a bounded generic error. The new public functions accept no owner, cohort, scorer, phase, trusted grant object or draft payload.

Authentication derives ownership from `tokenIdentifier` through `requireAuth`, including the account-deletion tombstone. Targeted calls check the record and its owning Void/Blueprint/objective/plan/session or standalone thread/activity. Canvas attribution retains the additional adaptive access conjunction; a wrapper cannot remove it. Unauthenticated, foreign, missing or mismatched authority is denied without returning stored payloads. A new handler never returns a successful save, grant, terminalization, score or report from an unimplemented operation.

| Public function | Arguments / returns | Current behavior | Implementation owner |
| --- | --- | --- | --- |
| `learnV2Responses.acceptResponse` | `acceptResponseArgs` / `responseReceiptValidator` | Formative/diagnostic slot only; `rejected`, reason `disabled`; no submission or body write | [C2.1 #424](https://github.com/wescodess/budds/issues/424) |
| `learnV2Responses.getResponseState` | `responseStateArgs` / `responseStateValidator` | Disabled status only, including when saved work already exists | C2.1 #424 |
| `learnV2Responses.terminalizeResponse` | `terminalizeResponseArgs` / `terminalizeResponseValidator` | Disabled; no cancellation/abandonment inferred or persisted | C2.1 #424 |
| `learnV2Assessments.getFeatureReadiness` | `{}` / `featureReadinessValidator` | Authenticated capability/status metadata; every new capability off | Readiness integration [C6.4 #440](https://github.com/wescodess/budds/issues/440) |
| `learnV2Assessments.grantAssessmentDelivery` | `grantAssessmentDeliveryArgs` / `grantAssessmentDeliveryValidator` | Disabled; no grant, exposure or prompt delivery | Assignment [C5.2 #433](https://github.com/wescodess/budds/issues/433); entry integration [C5.4 #435](https://github.com/wescodess/budds/issues/435), [C5.5 #436](https://github.com/wescodess/budds/issues/436) |
| `learnV2Assessments.getAssessment` | `assessmentReferenceArgs` / `assessmentDeliveryValidator` | Disabled; no prompt, stimulus, source or scoring payload | Publication [C5.1 #432](https://github.com/wescodess/budds/issues/432); disclosure [C4.1 #429](https://github.com/wescodess/budds/issues/429); entry C5.4/C5.5 |
| `learnV2Assessments.getAssessmentState` | `assessmentReferenceArgs` / `assessmentStateValidator` | Disabled; no guessed phase or submission | C5.2/C5.4/C5.5 |
| `learnV2Mastery.acceptMasterySubmission` | `acceptMasterySubmissionArgs` / `responseReceiptValidator` | Required object envelope `{ submission: command }`; rejects with `disabled`; one assessment or the existing teach-back/application bundle; no acceptance time or submission ID | Shared acceptance C2.1 #424; sole mastery writer [C5.3 #434](https://github.com/wescodess/budds/issues/434) |
| `learnV2Mastery.scoreMasterySubmission` | `scoreMasterySubmissionArgs` / `scoreMasterySubmissionValidator` | Validates the owned sealed submission reference, then disabled; no provider, job, attempt or score | C5.3 #434, consuming [C3.2 #427](https://github.com/wescodess/budds/issues/427) |
| `learnV2Assistance.authorizeAssistance` | `authorizeAssistanceArgs` / `assistanceAuthorizationValidator` | `denied`, reason `disabled`, also with omitted context; no assistance delivery or authorization reference | Shared transaction C2.1 #424; consumers [C4.2 #430](https://github.com/wescodess/budds/issues/430); mastery assistance C5.3 |
| `learnV2MeasurementReports.requestReport` | `requestReportArgs` / `requestReportValidator` | Requires an active owned viewer grant; disabled with `protocol_not_frozen`; no run or refresh scheduled | [C6.2 #438](https://github.com/wescodess/budds/issues/438) |
| `learnV2MeasurementReports.getReport` | `reportReferenceArgs` / `reportValidator` | Owned run plus current scoped viewer grant required; disabled, no snapshot/source rows | C6.2 #438 |
| `learnV2MeasurementReports.getReportCells` | `reportPageArgs` / `reportCellsValidator` | Same repeated authorization; disabled, no fabricated cells | C6.2 #438 |
| `learnV2MeasurementReports.exportAggregateReport` | `reportPageArgs` / `aggregateExportValidator` | Same authorization; disabled, no file, learner rows or private inputs | C6.2 #438; replay [C6.3 #439](https://github.com/wescodess/budds/issues/439) |

Delivery mutations and prompt reads are separate. A future grant result is only a reference; a query cannot create the first grant. Future state/score returns use the C1.2 own-work and safe-result DTOs. Private keys, rubric criteria, sibling forms, seeds, source locators and provider payloads are absent from the new public return validators. The report request identifies a server-managed viewer grant, not a client-chosen cohort/epoch; the grant supplies its authorized scope. Reads recheck its scope, revocation, time and deletion state. Report pages reserve the bounded aggregate DTO; there is no public raw-source adapter or self-grant command.

## Frozen report output v2

Report references, disabled receipts, sealed manifests, cell pages and aggregate exports use `learn-v2.measurement-report.v2`. Request queries and source facts remain `learn-v2.measurement-report-query.v1` and `learn-v2.measurement-report-source.v1`; VLG and false-mastery definitions remain v1. Other public APIs retain `learn-v2.public-api.v1`. Old report-output v1 shapes are rejected. These endpoints still return disabled status and perform no write.

`learnReportMetricValidator` in `convex/lib/learnV2MeasurementReportContract.ts` supplies the exact stored/public/exported cell fields. Before a later writer or adapter uses them, `learnReportMetricSchema` and `validateLearnMeasurementReportCells` enforce bounded integers, finite estimates, nested counts, disjoint totals, null/reason states and original-envelope/page bytes. Convex's declared validators enforce the same closed output structure. Cells remain aggregate-only, without learner/assignment/attempt rows or protected payloads.

| Decision requirement | Public cell fields |
| --- | --- |
| #366 §3 disjoint outcomes | `counts.dispositions` contains all eleven closed dispositions; sums reconcile to matured episodes or first-check claims. |
| #366 §§1–2 accepted but unscored endpoints | `counts.acceptedColdSubmissions`, `acceptedClaims`, alongside existing delayed accepted/valid/paired and distinct-learner counts. |
| #366 §3 / #364 §4 originals and replacements | `replacements` retains the original population, linked/accepted/valid/comparable replacement subsets, pinned predeclared policy, `primaryIncludedPairs` and a separate secondary estimate. First-slot false mastery is never replaced by a later pass. |
| #366 §3 / measurement threat table | `instrumentation` retains paste/focus flags, unknown counts and flag/unknown overlap. `sensitivity.excludingFlagged` supplies the predeclared estimate without changing primary outcomes, and uses the same null/reason and precision rules. |
| #366 §3 / #364 §4 assigned/observed balance | `allocations` has fixed order and cold/delayed form buckets for assigned populations and accepted sealed responses. |
| #366 §3 / #364 §6 source exclusions | `sourceAccounting` contains covered/affected/unknown counts for missing T0, unknown exposure, exhausted inventory, purged evidence, replacement, treatment change and outside-help uncertainty. |
| #366 §§1,3 modality separation | `stratum.responseKind` keeps keyed/numeric/ordered/bounded-rubric outcomes distinct from each other and from deterministic/model scorer strata. |
| #366 §3 descriptive-band attrition | `attritionByStartingBand` supplies all four bands' population/accepted/valid/paired columns; `startingBand = all` is explicit rather than overloading unknown. |

The [storage field mapping](learn-v2-c1-storage-contract.md#report-cell-v2) names every nested field, count unit and consistency rule. Later report computation/API tickets consume this closed contract without widening it.

Scorer alias policy `learn-v2.scorer-identity-policy.v2` permits a verified alias only when its `requestedModel` and `configurationDigest` both match the frozen binding; unrelated flat alias lists cannot authorize a different returned model (#380). A valid measurement-only snapshot may carry only `retained_promotion_ineligible` when measurement eligibility is true and mastery eligibility is false; contamination/evidence/unknown exclusions still cannot accompany valid credit. This preserves delayed measurement below Independent without changing the mastery rule (#366 §2 / #364 §5).

## Mastery and compatibility

`acceptMasterySubmissionForOwner` is the sole reserved mastery acceptance hook. Its top-level Convex arguments are a strict object with one required `submission` field. Inside that field, a single assessment requires `version`, `idempotencyKey` and `response`; a final bundle requires `version`, `idempotencyKey`, `teachBack` and `application`. Each response still requires `target`, `expectedRevision` and `payload`. Missing fields, mixed branches, unknown fields and a single formative target are rejected. The original flat arguments are not accepted. The complete wire envelope retains the 64 KiB bound.

```ts
acceptMasterySubmission({ submission: { version, idempotencyKey, response } })
acceptMasterySubmission({ submission: { version, idempotencyKey, teachBack, application } })
```

The helper validates the envelope, unwraps it and forwards the unchanged shared command once to `learnV2Responses.acceptResponseForOwner` in the same mutation, preserving one command key and receipt identity. `scoreMasterySubmissionForOwner` is the reserved scoring-by-submission hook; its internal `getMasterySubmissionScoringState` query authenticates the same caller and returns only disabled status. Neither hook calls the compatibility scorer to pretend a new submission was accepted. C2.1 implements atomic persistence; C5.3 integrates it into the sole mastery/scoring authority.

`convex/learnV2ApiAdapters.ts` exports `learnV2TodayMeasurementApi` and `learnV2CanvasMeasurementApi`. Both reference the same canonical commands and require server-created target IDs. Both expose `masterySubmissionArgs(command)` to wrap the frozen shared command in the required `{ submission: command }` wire shape; its `LearnV2MasterySubmissionArgs` type comes from the registered endpoint. They create no second opportunity, body, scorer or autosave authority. The Canvas/Today compatibility references still point to `submitCanvasResponse` / `learnAdaptive.submitResponse` and `submitMasteryAttempt`, respectively. C5.4/C5.5 later connect delivery and canonical submissions to those entry paths. No frontend is changed here.

Existing V2 compatibility keys retain their original nonempty, at-most-128-code-unit semantics, including legitimate colon-containing keys. New commands use C1.2's 16–128-character URL-safe format. The adaptive attachment/staging format remains unchanged. Existing compatibility actions remain active under their existing gates; they are not new measurement acceptance. `submitMasteryAttempt` now has an explicit return validator for its unchanged legacy result. Legacy read/feedback/privacy repairs remain with C2.2 #425, C4.1 #429 and C5.3 #434; this inactive API does not claim those repairs are implemented.

The baseline payload builder, complete provider request builder and parser are extracted into server-only `server/utils/learn-v2-mastery-scorer.ts`. Production compatibility scoring calls those functions. The frozen compatibility fixture records the original implementation at `6a44987712b27e54fcead4118d635069b975c916`. Tests compare serialized payload, complete request settings, gateway request bytes, normalized verdict bytes and invalid-output errors. Registered Today and Canvas compatibility actions additionally compare the actual mocked dispatch bytes and replay one committed result without redispatch.

The model inherited from published content, legacy automatic routing, prompt, response schema, parser acceptance/rejection, sampling/output/privacy/finite dispatch settings, numerical scoring, threshold 80, transition table, seven local calendar days and ordinary session-wide assistance are unchanged. The existing `recordMasteryAttempt` commit remains the compatibility authority. Immutable scorer bindings/observed receipts belong to C3.2 #427, harness replay to C3.3 #428, and their integration to C5.3 #434. This extraction neither asserts verified live identity nor changes calibration's separate scorer.

## Registration regression guard

`server/utils/convex-registration-contracts.test.ts` imports production Convex modules and captures their definitions through the documented query/mutation/action builders. Every exported public or internal query, mutation and action must have an object/any top-level argument validator. Declared argument and return validator trees are checked recursively through public `kind`, `fields`, `members`, `element`, `key`, `value` and `isOptional` properties, using [asObjectValidator](https://docs.convex.dev/api/modules/values#asobjectvalidator) for field maps. Configuration modules are excluded; HTTP actions have a separate Request/Response contract.

The guard fails on the former top-level union even though Convex-test accepts it. It deliberately avoids `exportArgs()`, `exportReturns()` and validator JSON accessors, which the installed SDK marks internal. It checks declared public validator structures without a backend; it does not replace actual Convex serialization/deployment validation or a browser journey. Existing functions with omitted return validators remain outside return-shape validation.

## Readiness and release

Feature readiness distinguishes `disabled`, `unavailable` and `ready_to_collect`; individual capabilities distinguish `disabled`, `unavailable` and `available`. Protocol state distinguishes `protocol_not_frozen` and `frozen`. The current result is always disabled, `protocol_not_frozen`, `serverUsable: false`, with all capabilities disabled and all real-baseline/day-7/day-30 evidence false. No environment value activates an incomplete handler.

`uiRequired` is always false. Server/CLI readiness can become usable after the non-UI implementation and verification tickets, independently of owner-approved learner/dashboard UI. That readiness is separate from deployment, enrollment, actual baseline capture, live scorer validation, real delayed evidence and teaching release. [Owner protocol #362](https://github.com/wescodess/budds/issues/362) still supplies actual epoch, anchor/windows and enrollment/release decisions; no protocol numbers are selected here. C6.4 #440 owns deterministic collection proof and the combined readiness handoff.

New capabilities remain off. No flags, entitlements, environment, deployment, migration/backfill, enrollment, principal grant, account/key or provider spending is included. The completed C1 draft still requires the orchestrator's final-head aggregate checks and independent review gate; focused tests do not pass that gate.
