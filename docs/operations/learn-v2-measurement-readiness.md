# C6.4 deterministic collection handoff

This is synthetic application evidence for [#440](https://github.com/wescodess/budds/issues/440), based on `dev` at `dc75b527`. It is not baseline capture, a release decision, or permission to collect. Report computation is `learn-v2.report-code.c6.2.v9`, report/source versions remain v3/v4, and `checkSurface` remains separate from teaching flow.

**The full #440 exit is blocked.** The registered commands expose two underlying boundaries below. No production code, contract, schema, export implementation, deletion implementation, flag default or application UI is changed by this proof. The draft must not be marked ready on the strength of passing tests alone.

## Command proof

Run from the repository root with Node 24 and local dependencies:

```sh
source ~/.budds-orchestrator/ci-env.sh && pnpm exec vitest run convex/learnV2Measurement.e2e.test.ts --maxWorkers=1
```

The fixture accepts synthetic T0/source/Blueprint/plan inputs and an explicitly synthetic frozen protocol. Family generation, validation and publication run through the registered item commands. Teaching publication uses `commitSessionContentCandidate`. Enrollment, grants, canonical acceptance, score reservation/execution/commit and replay use the existing server commands. Provider responses are in-memory adapters. They never write submissions, attempts, mastery, claims or report facts. Unknown and assisted scenarios inject explicitly synthetic adverse exposure inputs before real acceptance; they do not forge an accepted response or verdict.

The three collection cohorts contain 50 distinct learners each: five copies of ten scenarios. They cover gain, negative gain, non-returners, absent cold, missed day 7, failed day 7, below-Independent day 30, a failed first check followed by a day-30 pass, unknown assistance, actual contamination inputs and accepted-but-unscored work. The original first-slot failure remains authoritative after a later pass. Acceptance replays and conflicting answer commands preserve the original response. Three distinct assigned case pins and the scorer pins are checked against the accepted records.

For Today on its original surface, the journey also delivers unchanged teaching, commits ordinary first Independent through the real scorer, and follows the frozen first delayed slot. Today with Canvas checks and Canvas teaching have cold/delayed/report proofs; their complete teaching/first-Independent journeys remain blocked below. No fixture-written claim fills either gap.

The virtual clock enters both windows and invokes the registered one-minute #572 cron. It drains the actual durable queue and scheduled workers, then closes unanswered original slots. It does not call a substitute due-work implementation. Native Convex transaction limits remain enabled. Report scheduling needs a finite 4,000-iteration test-runner drain for these larger cohorts; each production continuation keeps its existing page limits.

Independent numerical expectations per 50-learner cohort are:

| Metric | Original denominator | Observed | Point | All-eligible bounds |
| --- | --- | --- | --- | --- |
| Day-7 VLG | 50 episodes | 20 pairs | 25 percentage points | [0, 70] |
| Day-30 VLG | 50 episodes | 35 pairs | 400/7 percentage points | [30, 70] |
| First-next-check false mastery, original Today surface | 50 claims | 25 checked, 10 failed | 2/5 | [1/5, 7/10] |

All-eligible points remain null because outcomes are missing. Both episode and learner weightings are asserted. The ten day-7 contributions have four observed gains, `100, -100, 100, 0`; five missing delayed endpoints with cold zero contribute [0,100], and absent cold contributes [-100,100]. Their sum divided by ten gives [0,70]. At day 30 seven observed gains sum to 400; two missing delayed endpoints contribute [0,100] each, and absent cold contributes [-100,100], giving [30,70]. Repeating each scenario five times changes counts without changing these means or bounds. False mastery has ten confirmed failures, 25 unresolved claims, and the original 50-claim denominator. A later pass changes none of them.

The report starts from the approved synthetic owner roster, reads the real bounded fact source, pins owner watermarks, extracts multiple source pages, computes and seals through the registered scheduled services, and reads multiple audited aggregate pages. A separate mixed 20-learner report checks four distinct groups: Today/Today, Today/Canvas, Canvas/Canvas, and a second observed scorer upstream on Today/Today. Its four day-7 cells each retain five observed pairs and gain 100. The two observed identities under the same frozen Today/Today binding retain unknown population and null all-eligible points/bounds; the other two groups retain their complete five-episode denominators and [100,100] bounds. They cannot pool by flow, surface or scorer identity.

The exact retained normalized inputs are replayed by the actual Node CLI in a temporary directory and removed afterwards. CLI cells must equal the online published cells. Offline output must retain `sourceAdmission: pending`, `viewerGrant: unverified_offline`, `realObservations: unverified_offline`, and `baselineCapture: unproven`. Synthetic replay never upgrades source provenance.

Controls cover anonymous and different-issuer direct report/export/download requests, legacy unaudited-query refusal, owned metadata exports, foreign export authorization, answer/private-scoring canaries, immutable scorer replay without another dispatch, post-watermark response integrity invalidation, and physical source purge. Invalidated online readers withhold aggregates; retained snapshot inputs are never presented as current authority. The explicit disclosure inventory assigns all 142 currently declared surfaces to an owner and regression suites. That inventory test checks completeness and existing test files; the mapped suites supply behavioral evidence. Every owned measurement table must appear in the export inventory and survive the exhaustive bounded account-deletion test. The global due-work cursor and withheld access-audit table have their existing separate policies.

Retained operational/outcome queries keep their fixture-only versions. Experiment assignment remains `learn-adaptive.experiment-assignment.v1` with the authenticated learner as its unit. Existing metric suites remain separate from C6.

## Underlying blockers

1. **Bound Today first-Independent commit fails storage validation.** `convex/lib/learnV2Measurement.ts` includes the frozen `checkSurface` on the claim stratum. `convex/lib/learnV2MeasurementStorage.ts:375` omits it from the stored `independent_claim_v2.stratum` validator, although the report-source validator accepts it. A real cold check, unchanged Today teaching and ordinary application score reproduce the failed claim insert. The scoring transaction rolls back the attempt/mastery/claim; the proof asserts that rollback. This is a contract/#574 correction for the serial owner, outside #440's hot-file ownership. The regression asserts the current rejection explicitly and must become a successful claim/report journey when the owner fixes it. A green regression is not a green first-Independent path.
2. **Canvas post-seal teaching continuation is pending #535/#576.** Current enabled Canvas commands retain the sealed check rather than delivering its subsequent ordinary lesson/practice and first-Independent application; the proof checks that `getPostSealTeaching` returns `unavailable / disabled` after a scored cold submission. Canvas cold and delayed scoring/reporting are exercised, but the complete Canvas teaching/first-check chain is unproven. See also the collection blockers [#559](https://github.com/wescodess/budds/issues/559) and [#560](https://github.com/wescodess/budds/issues/560). This proof does not toggle response capabilities off, hand-write an ordinary attempt, or fabricate a claim to get past that boundary.

Both blockers require their owning implementation and a subsequent deterministic full-chain run. Independent review and its ledger at the final PR head remain with the orchestrator. No review-gate pass is claimed here.

## Local validation record

Dependencies were missing. `pnpm install --offline --frozen-lockfile` succeeded without downloads. The first `npx nuxi prepare` before dependency installation failed because the local Nuxt CLI was unavailable; after installation, `source ~/.budds-orchestrator/ci-env.sh && npx nuxi prepare` passed.

| Command | Result |
| --- | --- |
| `source ~/.budds-orchestrator/ci-env.sh && pnpm build` | Passed; artifact secret scan passed. |
| Focused suites below | Passed: 18 files, 1,398 tests. |
| Phase A Canvas regression below | Initial run: 71 passed and one unchanged five-second mount timeout. Isolated rerun: all 72 passed, including UUID/fallback command keys and retry-key reuse. |
| Deterministic command proof | Seven distinct cases passed in isolated partitions: three 50-learner collection/report/CLI journeys, mixed identity/flow/surface report with source purge, bound-claim rejection/rollback, disclosure inventory and table deletion. |
| `source ~/.budds-orchestrator/ci-env.sh && pnpm verify` | Pending. |
| `source ~/.budds-orchestrator/ci-env.sh && pnpm verify:learn-v2-beta` | Pending. |

Exact focused command:

```sh
source ~/.budds-orchestrator/ci-env.sh && pnpm exec vitest run --maxWorkers=2 convex/learnV2C5ReportsIntegration.test.ts convex/learnV2MeasurementDueWork.test.ts convex/learnV2MeasurementReports.test.ts convex/learnV2MeasurementStorage.test.ts convex/learnV2AssessmentDisclosure.test.ts convex/learnV2TodayDelivery.test.ts convex/learnV2CanvasContract.test.ts convex/learnV2TodayPointers.test.ts convex/learnV2Responses.test.ts convex/learnV2ResponsePurge.test.ts convex/learnV2PersonalExport.test.ts convex/learnV2ExportExposure.test.ts convex/learnV2TeachingReads.test.ts convex/learnV2DisclosureOffParity.test.ts scripts/learn-v2-measurement-report.test.ts shared/learn-v2-measurement-report.test.ts shared/learn-adaptive-operational-metrics.test.ts shared/learn-adaptive-outcome-metrics.test.ts
source ~/.budds-orchestrator/ci-env.sh && pnpm exec vitest run --maxWorkers=1 --config vitest.config.component.ts tests/component/learn-adaptive/ready-session-canvas.test.ts
```

## Pending owner work before collection

All items below remain pending; fixtures approve none of them.

- Resolve the two server blockers above and rerun the complete command proof for both teaching flows and both Today check surfaces.
- Approve and implement learner UI under #361, #441 and #442; approve reporting presentation under #367. Verify the integrated browser/device experience separately.
- Preserve and approve the real baseline SHA and protocol under #362 before Phase D reaches participants. Choose/freeze epoch, anchor, timezone, half-open day-7/day-30 windows, replacement policy, cohort, enrollment interval, sample and release boundary; protect follow-up.
- Separately authorize deployment and environment configuration. Decide whether any migration/backfill is required; this change performs neither.
- Approve actual flags, Learn/adaptive entitlements and participant enrollment. Defaults remain off. A prospective catalogue/history basis is not evidence about earlier uninstrumented teaching.
- Approve the pilot manifest, participant reach, provider/scorer inventory, verified observed identities, form/scorer validation, service accounts and any required keys through their established private process.
- Provision the real verified application principal and scoped viewer grant. The production report approval catalogue remains empty; repository ownership grants no application or raw-input access. Resolve #564 before another viewer is admitted.
- Separately approve inference spend, quotas and any live provider/privacy canaries. No provider spend, production grant, flag, deployment or data operation is part of this change.
- Run approved privacy/export/deletion/revocation canaries in the intended environment and test deployed cron timing, receipt retention and production contention. Local transactional tests prove none of those infrastructure properties.
- Run independent review and required checks at the final PR head, record the ledger, and make the owner release decision.

Real cold baseline capture is unproven for Today/Today, Today/Canvas and Canvas/Canvas. Real day-7 and day-30 outcomes are separately unproven for each of those groups. Real first-next-check false mastery is also unproven for every group. A fixture score, successful replay, passing test or later horizon cannot satisfy another flow's or horizon's real-attempt learning exit.
