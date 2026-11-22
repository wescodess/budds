# C4.1 disclosure handoff

Implements [C4.1 #429](https://github.com/wescodess/budds/issues/429) in the single [C4 #416](https://github.com/wescodess/budds/issues/416) merge unit. Base: `9ab2f688745935410b68cbaced3b81724bb2f3b0`. C4.3 #431 and C4.2 #430 remain to be added to this branch and draft PR. This document is an implementation handoff, not review approval or a release decision.

## Boundary

`resolveAssessmentDisclosureContext` authenticates the token identifier and reconstructs ownership, purpose, lifecycle, grant, immutable assessment/context pins and current source access. Same-owner references and historical wrappers confer no additional permission. Canvas pins retain their additional adaptive access conjunction. Feature flags cannot create a grant. Queries create no grants or exposure records.

Fixed DTO construction omits objective assessment contracts, private scoring, solution/sibling payloads, private locators, provider details and arbitrary nested snapshots. Calibration redisclosure requires exactly one persisted grant for the objective/revision and matching contract, prompt and public-projection digests. `disclosureDigest` defines the deterministic serialization used by that reader; later delivery writers must use the same helper and field order. A changed contract is unavailable rather than an implicit new delivery.

Canonical history preserves permitted learner response bodies through the shared `projectAttemptHistory` contract. Legacy response text requires intact declared source dependencies. Scored history exposes bounded outcome scalars; persisted criterion, feedback and rubric JSON is never replayed. A learner answer equal to the private key remains learner work and does not add any server-key field. Source loss withholds dependent bodies immediately. Genuine learner-authored artifact fields and unrelated standalone diagnostic responses remain available.

Contextual source/evidence reads suppress content while an unsealed held-out check is relevant. An assessment-bound activity cannot expose teaching from its reserved case after scoring. Malformed plans use the existing safe fallback; stored fallback text is never the recovery path. Source/plan command replays project bounded receipts. Router writes, decisions and command keys are unchanged; its response is rebuilt from the verified persisted decision.

The contextual gate reads at most nine opportunity rows for its bounded Void check; more than eight is an unknown scope and returns neutral metadata. Missing/stale grants, unknown purpose, source loss and invalid pins also fail closed. No schema/shared/API change was required or made. No new writer, migration, flag activation, deployment or provider call was introduced.

## Endpoint inventory

The executable inventory is `ASSESSMENT_DISCLOSURE_READS` in `convex/lib/learnV2AssessmentDisclosure.ts`. The registered-response matrix checks equality with its driver list and runs all listed endpoints/aliases across no grant, open, sealed-pending, scored, replaced and revoked states, plus unauthenticated, foreign and different-issuer references. Failure cases also inspect serialized responses after source loss, stale pins, unknown purpose and wrong grants.

| Registered endpoint | Public projection | Return validator |
| --- | --- | --- |
| `learnV2Journey.listHub` | hub summary | `listHub.returns` |
| `learnV2Journey.getMission` | journey | `journeyValidator` |
| `learnV2Journey.getCurrentMission` | journey | `journeyValidator` |
| `learnV2Journey.getSessionCandidate` | session selection | `getSessionCandidate.returns` |
| `learnV2Blueprints.getBlueprintMap` | map summary | `mapSummary` |
| `learnV2Blueprints.getBlueprintGenerationJob` | job status | `getBlueprintGenerationJob.returns` |
| `learnV2Lifecycle.getLearningVoid` | Void summary | `voidSummary` |
| `learnV2Lifecycle.listLearningVoids` | Void summary page | `voidSummary` |
| `learnV2Lifecycle.getBlueprintRevision` | Blueprint summary | `blueprintSummary` |
| `learnV2Plans.getPlanPreview` | schedule summary | `planSummary` |
| `learnV2Sources.getSource` | source summary | `sourceSummary` |
| `learnV2Sources.listSources` | source summary page | `sourceSummary` |
| `learnV2Sources.listSourceReview` | contextual source review | `listSourceReview.returns` |
| `learnAdaptive.getThread` | thread summary | `adaptiveThreadSummary` |
| `learnAdaptive.getMemory` | owner memory | `getMemory.returns` |
| `learnAdaptive.listThreadHistory` | thread summary page | `listThreadHistory.returns` |
| `learnAdaptive.listResumeCandidates` | resume summaries | `listResumeCandidates.returns` |
| `learnAdaptive.listPromotionProposals` | proposal summaries | `proposalSummary` |
| `learnAdaptive.listThreadArtifacts` | learner artifacts | `artifactSummary` |
| `learnAdaptive.listThreadContributions` | contribution attribution page | `contributionSummary` |
| `learnAdaptive.inspectContributionSource` | source revision status | `inspectContributionSource.returns` |
| `learnAdaptive.getArtifactCanvas` | validated artifact primitive | `getArtifactCanvas.returns` |
| `learnAdaptive.getReflectionCanvas` | validated reflection primitive | `getReflectionCanvas.returns` |
| `learnAdaptiveEvidence.getThreadActivityEvidence` | contextual evidence | `evidenceFields` |
| `learnAdaptiveEvidence.getActivityEvidence` | contextual evidence, internal alias | `evidenceFields` |
| `learnAdaptiveRecovery.getDiagnosticCanvas` | validated diagnostic primitive and own work | `getDiagnosticCanvas.returns` |
| `learnAdaptiveDrafts.getThreadDraft` | learner draft | `adaptiveDraftSummary` |
| `learnAdaptiveClarifications.getInitialDecision` | fixed clarification template | `getInitialDecision.returns` |
| `learnAdaptiveRouting.decideNextActivity` | verified routing decision receipt | `commandReturn` |
| `learnAdaptiveRouting.replayDecision` | verified routing decision replay | `decisionValueValidator` |

Additional bounded receipts use `sourceReceipt` for `registerCandidate`, `prepareFetchedSourceForReview`, `prepareFolderSourceForReview`, `acceptSource`, `rejectSource`, `markUnavailable`; `schedulingReceipt` for `createPlanPreview`, `editPlanPreview`, `acceptPlanPreview`, `markExpiredSessionsMissed`, `markStudySessionMissed`, `reflowFutureIncomplete`; `conversionSummary` for `convertContributionToActivity`; and the declared `submitResponse.returns` for adaptive scoring admission. Existing suites exercise these command boundaries; the new suite separately injects private future fields into a persisted scheduling receipt.

Helper seams are covered through their registered consumers: `journey`, `mapProjection`, `planProjection`, `sourceProjection`, `projectThread`, `representativeCompletion`, `loadContributionSource` and `readActivityEvidence`. They do not add alternate public registrations.

## Other ticket owners

`ASSESSMENT_DISCLOSURE_OTHER_OWNERS` records the complete remaining named surface inventory from decision #373, including transport aliases and internal-only/status-only seams.

- C5.4 #435: Today and session-content entry, start and retry reads/receipts.
- C5.5 #436: Canvas attachment, entry, submission and ready-Canvas helper.
- C5.3 #434: mastery scoring, score feedback and assistance, including replay.
- C2.1 #424: response state/acceptance and calibration command persistence. Existing calibration receipts remain references/status.
- C5.1 #432 with C5.4 #435: the disabled canonical assessment read/state/delivery endpoints. Their existing C1 contract is unchanged.
- C2.2 #425: direct export pages, auxiliary answer/source/document reads and the ZIP handler.
- C4.2 #430: help, retrieval, streaming and stored assistant replay authorization.
- C4.3 #431: legacy Quiz/offline and teaching/index/cache/audio/share producers. No legacy transport is adopted as measurement authority here.

Ownership explicitly includes `learnAdaptiveRecovery.ts`, `learnAdaptiveDrafts.ts`, `learnAdaptiveClarifications.ts` and `learnAdaptiveRouting.ts`, in addition to the original eight files. Changes in those four files are confined to disclosure projection, response validation and read-time integrity checks. Routing decisions, persistence and idempotency writes remain unchanged.

## Client compatibility and required integration

| Field | Change | Existing consumer / effect |
| --- | --- | --- |
| `map.objectives[].assessmentContract` | Removed in both Journey and Blueprint maps. | `app/composables/useLearnV2Journey.ts:102` and `:219`, `app/components/learn-v2/LearningTrail.vue:55` and `:152`, `app/utils/learn-v2-map-editor.ts:37`. The inspector/editor currently assumes criteria exist; it needs separately scoped adaptation before merge. No placeholder rubric is fabricated. |
| `calibration.items[].rubric` | Removed permanently. `prompt` is null without an exact grant; authorized delivery is also returned as `assessment`. | No direct `rubric`/`items[].prompt` consumer found. Current calibration page uses the composable's objective capability and safe attempt IDs. The delivery writer/integration still belongs to the runtime owners. |
| `plan.*.inputSnapshot` | Re-serialized scheduling preferences only; objectives and arbitrary nested fields omitted. Invalid snapshots are absent. | `useLearnV2Journey.ts:185` retains its existing preference wire fields. Valid availability/time/deadline preferences survive. |
| `plan.*.resultSnapshot` | Re-serialized status, closed reason codes and alternative codes only. Invalid snapshots are absent. | `useLearnV2Journey.ts:111` and `app/utils/learn-v2-plan-result.ts`; the fields they read remain. |
| Raw attempts and snapshots | Private rubric, criterion, feedback, source-pin and provider fields removed. Canonical work is under `work`; valid legacy learner text stays under `response`. | Journey consumers use attempt IDs/objective IDs and mastery state. No consumer of the removed raw history JSON was found. |
| Source title/excerpt/domain/locator expansions | Withheld during relevant open/unknown assessment context or access loss; public URLs are sanitized. Unknown source failure detail becomes a neutral code. | `useLearnV2Journey.ts:94` and source review cards already handle absent content. No UI is changed. |
| Evidence claim text/locator | Unavailable after access loss; some unavailable historical reads now have `claims: []`. | `app/components/learn-adaptive/EvidenceDrawer.vue` handles the empty/unavailable state. |
| Adaptive purpose/fallback | Unverifiable plans lose generated purpose text; the existing safe fallback replaces the stored fallback. Valid ordinary fields remain. | `DiagnosticCanvas.vue`, `ArtifactWorkspace.vue`, `ReflectionNextMove.vue` and memory/history consumers retain their existing response shapes. |
| Blueprint provider metadata / internal row fields | Removed from summary DTOs. | No application consumer of generation request/model/provider fields found. Tests inspect their persisted server records instead. |

## Validation

All commands use `.github/workflows/test.yml` CI placeholder environment, `VITEST_MAX_WORKERS=1` and default test deadlines. Dependencies were installed once using `pnpm install --frozen-lockfile --prefer-offline`; all packages came from cache. Disk was checked throughout and remained above 5 GiB during the recorded work.

Recorded validation, all with exit code 0:

| Check | Result |
| --- | --- |
| Explicit affected Convex suites | 27 files, 348 tests passed, including the 25 new disclosure tests. |
| Explicit shared and registration suites | 11 files, 217 tests passed. Combined unit invocation: 38 files, 565 tests. |
| `pnpm test:component tests/component/learn-v2 tests/component/learn-adaptive` | 26 files, 336 tests passed. |
| `pnpm typecheck` | Passed. |
| `pnpm typecheck:convex` | Passed, including validation of 557 index names. |
| ESLint on all 16 changed TypeScript files, `--max-warnings 0` | Passed, zero warnings. |
| `git diff --check` | Passed. |

The final local logs are `/tmp/budds-c41-final-unit.log`, `/tmp/budds-c41-final-component.log`, `/tmp/budds-c41-final-typecheck.log`, `/tmp/budds-c41-final-typecheck-convex.log` and `/tmp/budds-c41-final-eslint.log`. The component setup emits its existing Convex URL warning; it uses fixtures and all tests pass. These fixtures establish application behavior only. They do not establish that the known live map-editor consumer has been adapted.

No `pnpm verify`, aggregate feature gates, build, browser/Playwright run, independent review, production acceptance or real-learning claim is included. The orchestrator still owns the final-head checks and review gate for the completed C4 merge unit. Keep this PR draft until the remaining C4 work and client integration are handled.
