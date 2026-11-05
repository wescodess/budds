# Phase C1 storage contract

Storage version: `learn-v2.measurement-storage.v1`. Implements the storage and enumeration slice of [C1.1](https://github.com/wescodess/budds/issues/421) in [Spec C1](https://github.com/wescodess/budds/issues/413). Shared command validators/types (C1.2) and the disabled public API/mastery extension (C1.3) remain pending. This document does not freeze a baseline protocol or complete the spec.

The accepted resolutions on [responses](https://github.com/wescodess/budds/issues/363#issuecomment-6651831618), [items/exposure](https://github.com/wescodess/budds/issues/364#issuecomment-6651739355), [reports](https://github.com/wescodess/budds/issues/366#issuecomment-6652156993), [disclosure](https://github.com/wescodess/budds/issues/373#issuecomment-6651824980) and [scorer identity](https://github.com/wescodess/budds/issues/380#issuecomment-6651838342) govern this contract. The original orchestrator brief is unchanged.

## Ownership and pins

All 24 collections require `userId`, `storageVersion`, `createdAt`, and `by_userId`. All reads and cleanup use pages/batches of at most eight. The registry is `shared/learn-v2-measurement-storage-manifest.ts`; storage validators live only under `convex/lib/learnV2MeasurementStorage.ts`, with tables/indexes in `convex/schema.ts`.

V2 scope requires the Void, Blueprint revision, objective, Blueprint record revision, assessment-contract version/digest and depth. Context is discriminated: calibration, a planned measurement with complete plan pins, or a session with complete plan/session/content/generator pins and optional complete Canvas attribution. Standalone diagnostics require their owned thread/activity and revisions, with no invented V2 anchors. Child rows repeat their aggregate anchor for indexed cleanup.

Measurement item pins require the item/revision/prompt digest, stable case, family/revision/form/equivalence, novelty policy, private scoring-spec revision/digest, support manifest and publication validation. Published available items and available scoring specs require their payloads; purged revisions preserve identity with unavailable evidence. Candidate/quarantined inventory may be assembled before its validation/spec exists. Ordinary application and calibration opportunities use their existing content/assessment authority and do not acquire a measurement-family identity.

Admission is absent in this slice. Every new storage capability is false. Admitted assignment shapes require frozen protocol, allocation, scorer and scheduling pins; considered/unmeasurable rows can remain `protocol_not_frozen`. A full allocation has three distinct case slots for cold/day 7/day 30; a two-case allocation declares one delayed horizon. Consistency, numeric/byte limits, semantic uniqueness and command validation are enforced by the following serial contracts before any writer can be enabled.

## Collection policy matrix

`M` means an explicit metadata allowlist in both direct Convex and HTTP ZIP export; it withholds prompts, keys, rubrics, solutions, private evidence, seeds, fingerprints and scorer payloads. `R` exports the owned canonical answer once after checking its submission, aggregate and current evidence. `W` enumerates a bounded page but exports no grant rows. Every row is removed by account deletion; report runs additionally drain their indexed children across the source-owner roster.

Indexes below omit the common `userId` prefix. Dotted fields use underscores in index names. The registry lists every exact field order.

| Collection | Principal fields / parent | Additional indexed reads | Export | Retention and aggregate/source behavior |
| --- | --- | --- | --- | --- |
| `learnAssessmentCatalogs` | Catalogue revision, instrumentation epoch, positive/unknown history basis | Owner guard | M | Owner inventory; survives Void/thread removal |
| `learnAssessmentCases` | Stable case key, scenario/solution fingerprints, usage class, identity validation | Case key; scenario and solution fingerprints | M | Owner inventory; reservation survives retirement and aggregate deletion |
| `learnMeasurementFamilies` | Capability, equivalence descriptor/version, core/total form counts, validation/lifecycle | Family key + revision; Void; Blueprint + objective | M | Void history; support loss marks unavailable |
| `learnMeasurementItems` | Family/revision/form, case, prompt/stimulus, response spec, scoring/publication pins | Family + revision + form; item key + revision; case; Void | M | Void child; source invalidation removes protected prompt/stimulus |
| `learnMeasurementScoringSpecs` | Item/revision, typed private key/rubric, derivation, scorer binding | Item + revision; Void | M | Void child; source invalidation removes private payload/solution |
| `learnMeasurementClaims` | Item/scoring spec, ordered stimulus/key/rubric/solution claims | Item + order; scoring spec; Void | M | Void child; protected claim text is purgeable |
| `learnMeasurementSupports` | Claim/item/spec, exact snapshot/excerpt/source/support/verifier pins | Claim; item; snapshot + invalidation; excerpt + invalidation; Void | M | Reverse source registration; unavailable tombstones survive source loss |
| `learnMeasurementValidations` | Typed subject/revision/digest, decision/check, validator/harness/corpus/watermark | Each subject kind; Void | M | Void child; no generator self-attestation shortcut |
| `learnMeasurementAssignments` | Prospective epoch/flow/history; admitted frozen family/allocation/protocol/scorer | Assignment key; Void; epoch + creation; Blueprint + objective | M | Void history, including unmeasurable/not-admitted episodes |
| `learnAssessmentOpportunities` | One lifecycle, purpose, assessment/scorer pins, grant/submission/result, replacement, first-check claim | Void; session; assignment + horizon; delayed-check key; submission; phase + due; claim key + check sequence | M | Void child; no second measurement or Canvas lifecycle |
| `learnAssessmentExposures` | Stable case/item, grant/delivery/known/possible/unknown fact, denied-help distinction | Case + server time; opportunity; delivery-receipt hash; Void; thread | M | Non-content owner inventory; detach deleted aggregate/wrapper, preserve consumption |
| `learnResponseSlots` | Ungraded stage, actual prompt/block/delivery pins, one accepted submission | Void; session; standalone thread; slot key | M | Owning Void or standalone thread; no scoring lifecycle |
| `learnResponses` | Append-only acceptance, typed target, digest/confidence, frozen assistance/validity, current availability | Opportunity; slot; Void; session; standalone thread | M | Owner learning history; source loss changes current availability, preserving acceptance facts |
| `learnResponseBodies` | Submission, owning aggregate, one typed payload/digest/byte count | Submission; Void; standalone thread | R | Owner learning history; entire dependent body purged on source loss |
| `learnResponseEvidenceLinks` | Submission and normalized snapshot/document/folder dependency | Submission; Void; thread; each source variant + invalidation | M | Exact source cleanup; no answer-text search |
| `learnResponseIntegrityEvents` | Submission, event sequence, later integrity fact/policy/source sequence | Submission + sequence; Void; thread | M | Owner history; separate from frozen acceptance snapshot |
| `learnResponseCommandReceipts` | Key/request digests, safe accepted reference or rejected reason | Key hash; Void; thread; expiry | M | Accepted receipts follow history; rejection rows require expiry, policy is 90 days |
| `learnScoringExecutions` | Submission/opportunity/job/dispatch, intended binding, observed identity, verdict/usage/commit | Submission; opportunity; job + dispatch ordinal; Void | M | Void-owned private scoring history; requested identity never substitutes for observed identity |
| `learnMeasurementReportFacts` | Append-only owner sequence, immutable scalar source snapshots, separate Independent claim/check sequences | Sequence; epoch + sequence; Void; assignment; opportunity; submission; claim key + claim sequence | M | Void-owned source history; no attempt-only denominator discovery |
| `learnMeasurementSourceWatermarks` | Owner source sequence, due-work coverage, history coverage | Owner + sequence | M | Owner read-model guard; no growing watermark array |
| `learnMeasurementReportRuns` | Requester, approved scope/epoch/protocol, cutoff/roster/input digests, extraction/cursor/counters/version/precision | Status + creation; epoch + cutoff | M | Snapshot retained with owner; source-owner invalidation marks dependent runs stale |
| `learnMeasurementReportRows` | Source owner, run/sequence/watermark, typed scalar episode/claim snapshot | Run + sequence; owner + run + sequence; Void; assignment + horizon; invalidation | M | Source-owner and requester-run descendants; no response/item/scorer payloads |
| `learnMeasurementReportCells` | Requester/run, metric/horizon/stratum, counts/nulls/bounds/status | Run + sequence; owner + run + sequence; run + cell key | M | Requester/run descendants; aggregate API/export remains later work |
| `learnMeasurementReportViewerGrants` | Verified principal binding, approved cohort/epoch, grant/revocation/expiry | Cohort + epoch; expiry | W | Server-managed, default deny; no provisioning or public self-grant |

History follows the owning aggregate/account rather than a new 90-day response expiry. Operational rejection expiry is the exception. There are no unbounded history arrays; family children, responses, executions, facts, source-owner watermarks and report output rows are normalized. Source manifests and response/report payloads have the declared finite ceilings in `LEARN_MEASUREMENT_STORAGE_LIMITS`; the next validators own their command-time enforcement.

## Compatibility and cleanup boundaries

Legacy `masteryAttempts.kind` remains optional and keeps `calibration`, `independent_application`, and `retained_transfer` meanings. The new `measurement_cold` and `measurement_delayed` branches require complete measurement pins; delayed scores require horizon 7 or 30. Optional ordinary-attempt additions include canonical response/execution references, requested/returned identities, frozen assistance/validity and separate first-claim/check sequences. `scorerModel` keeps its historical meaning. No old score or absent field is rewritten.

Sessions/content/jobs gain optional assessment references; jobs can pin family/item/validation/scorer bindings. Canonical V2 measurement events have a separate taxonomy/version and optional Canvas attribution. The old representative-completion reader rejects that taxonomy until its later adapter exists, preserving old event/hash semantics. No event writer is enabled.

Both export enumerations include all new tables, the HTTP list now includes the existing adaptive and calendar collections, and ZIP manifest version 10 declares the withheld categories. Private new attempt/job bindings are excluded from legacy export spreads. Existing legacy export behavior otherwise remains; completing the broader legacy disclosure/response-alias purge is the later privacy ticket's responsibility.

Existing retention entry points invoke the new bounded source, excerpt, document, folder, Void and standalone-thread registrations. Account deletion invalidates source-owner report snapshots and drains requester-run descendants before deleting the run. Removing a Canvas wrapper preserves V2-owned response history; removing a Void retains only the separate owner case/exposure inventory needed to prevent reuse. No owner exposure row survives completed account deletion.

This slice supplies storage/enumeration and conservative cleanup of the introduced payloads. Full runtime disclosure, integrity-event/fact emission during purge, legacy aliases/fingerprints, export exposure authorization, scoring/read races and privacy completion remain required before new admission. It supplies no collection/enrollment/scoring commands, migration/backfill, principal grant, provider invocation or UI. Protocol, rollout, live scorer validation and real cold/day-7/day-30 learning evidence remain owner-controlled and unproven.

## Verification scope

`convex/learnV2MeasurementStorage.test.ts` uses the full current Convex module map and a typed fixture with an owned row in every new collection. It exercises direct export, issuer isolation, every registered index, source and aggregate discovery/cleanup, first-check sequences, legacy/new attempt validation and complete bounded account deletion. The ZIP test delegates to the real Convex export queries and inspects the decoded archive for retained work and private-payload canaries.

Focused regressions and typechecks are recorded in the draft PR. Exact `pnpm verify`, `pnpm verify:learn-v2-beta`, full browser/build suites and the independent review gate remain unrun at this storage head, pending coordination of the completed C1 merge unit. Fixtures establish application boundaries only.
