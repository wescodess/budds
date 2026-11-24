# C5 scoring input admission and recovery

The [#573 Today pointer amendment](../plans/learn-v2-c1-public-api-contract.md#573-serial-amendment-today-points-to-canvas) introduces no scoring-input loader or scoring identity. With its separate default-off capability and responses enabled, new Today enrollment prepares a Canvas-owned check and returns references only; Canvas grant/seal and saved-ID scoring still use the feeders and recovery callers below. Rollout toggles preserve frozen flow: existing Today checks keep C5 delivery and acceptance, and new Canvas checks retain their pointers and Canvas-only execution during rollback. C6 records `v2_canvas` separately from the actual Today/deep-link entry point. Pointer projection checks routing/lifecycle metadata without assembling family evidence or returning an answer, scoring request, score or feedback; source authority remains mandatory at content and scoring boundaries. Today preparation validates the full publication inventory, uses one temporary enrollment reference and atomically replaces it with the held-out item plan. The ordinary Canvas reference path is unchanged. Existing 64-row admission, exact request bytes and sealed recovery limits remain unchanged. Six/twelve-family native-limit paging, 17/32-claim teaching preparation and toggle controls supplement the unchanged C5 suites and C4 goldens.

`readLearnAssessmentScoringInput` assembles measurement, ordinary session and calibration inputs. Its mode is explicit: publication reserves response space, acceptance checks the actual answer, and recovery checks only the hard serialized transport ceiling after the caller validates ownership, saved pins and revocation. All modes use the actual scorer request builder; calibration supplies its distinct protocol.

Admission remains 64 evidence rows and a 16,000-byte escaped response-growth allowance inside the 48,000-byte request cap. The stored 32-claim and 8-support structural ceilings bound recovery reads independently of current admission. A submitted measurement no longer revalidates the whole family against current publication limits. Its owned item, assignment relationship, source authority, response pins and revocation checks remain in force. Completed work is never repinned.

## Saved-input callers

Every direct caller of `requireSavedLearnScoringInput` uses recovery mode through that loader.

| Caller | Purpose |
| --- | --- |
| `learnV2Mastery.getSealedMasteryScoringInput` | Load the saved answer for execution. |
| `learnV2Mastery.registerSealedMasteryScoring` | Validate the execution receipt against the saved answer. |
| `learnV2Mastery.failSealedMasteryScoring` | Recover the owned job before recording a known failure. |
| `learnV2Mastery.commitSealedMasteryAttempt` | Commit or replay the authoritative attempt. |
| `readSavedLearnScoringState` | Read a saved scoring phase or authoritative result. |
| `reserveSavedLearnScoring` | Recover completion, a receipt or a pending lease before acquiring work. |
| `saveLearnModelScoringResult` | Reconcile provider output against the frozen request. |

`prepareSavedLearnModelScoring` marks inputs from this validated loader as `sealed_response`. Execution preparation then retains privacy, identity, lease and hard transport checks without applying current admission rows. Default C3 preparation of unsealed inputs still enforces the admission row ceiling. Deterministic execution uses the same loaded input and unchanged grading rules.

Ordinary Canvas completion can advance the opportunity's current delivery session revision. Recovery continues to assemble the scoring request from the immutable response context, preserving the accepted content pins while the delivery anchor remains current.

## Publication and acceptance feeders

| Path | Contract enforcement |
| --- | --- |
| `commitSessionContentCandidate`, including generation and retry | Ordinary candidates are checked before instructional cases or content are published. Evidence expands every claim/support pair in scoring order. The request uses the effective published model and legacy automatic routing, matching the closed ordinary scorer resolver. |
| Measurement generation, validation and `publishFamily` | Existing shared row, item-envelope and exact request checks remain. Correct keyed, ordered and numeric answers must fit admission. Validated check-only content envelopes inherit this published item authority. |
| Cold enrollment, delayed due work, retained resolution and reserve replacement | These paths select published held-out items. The owning flow's grant revalidates publication before disclosure; acceptance rechecks the actual answer. Original allocation and first-slot pins remain unchanged. |
| `bindSessionApplication` from Today/session start; Canvas attachment; assessment grant/state/delivery | Unsubmitted ordinary and calibration opportunities pass publication preflight before a grant or available state. Older oversized content returns an explicit bound reason; start rolls back rather than committing its failed binding. Submitted work keeps recovery authority without new admission. |
| `acceptMasterySubmissionForOwner` → `acceptLearnResponseForOwner` → `prepareResponse` | Every new assessment answer checks shared rows and the exact request before any body, seal or scoring job is written, including final bundles and compatibility ingress. Accepted-command replay returns its owned saved receipt without new admission. |
| `submitMasteryAttempt` / `acceptCompatibilityMasterySubmission` | Ordinary compatibility ingress delegates to canonical acceptance. |
| `submitCanvasResponse` | Canvas text and encoded structured staging delegate to canonical acceptance, including ordinary Independent, retained and measurement purposes. Saved-ID `learnAdaptive.submitResponse` uses the recovery callers above. |
| `submitCalibrationAttempt` / `acceptCalibrationSubmission` | C5 ingress delegates to canonical acceptance using the calibration request builder. No current production writer creates a calibration opportunity; an existing owned opportunity receives the same preflight. The original calibration loader remains the scoring-off compatibility path. |
| `learnV2Responses.acceptResponse` | Formative slots only. It rejects assessment targets and cannot feed the saved assessment scorer. |

The original `getMasteryScoringInput` and `getCalibrationScoringInput` belong to the scoring-off compatibility branches. They do not load C5 sealed responses. Their publication, grading and off-state behavior remain unchanged.

## Identity and proof boundary

Parser v2, receipt guard v3 and transport v2 changed the configuration digest from earlier branch configurations. The sealed-input execution distinction also changes the pinned guard implementation hash and configuration digest. C6 uses that digest as its configuration stratum, so these configurations remain distinct. This is accepted before any production scorer inventory exists. Baseline request, payload, parser v1, arithmetic and threshold bytes remain unchanged; no saved identity is rewritten.

Registered controls cover ordinary 64-row publication through scoring with 64 sources, rejection at 65 rows, oversized static requests, canonical and compatibility answer overflow, old published/bound content, Canvas Independent and retained ingress, calibration ingress, and saved sealed/scored recovery above current admission. Recovery also enforces the hard transport cap, and a scored 65-row result survives a lower admission ceiling. Native transaction limits remain enabled in the Today and Canvas fixtures. The responses-off 65-row publication/start control and both unchanged C4 golden suites cover off-state behavior. These are local registered-call and synthetic-provider proofs, not deployed or live-provider evidence.
