# C6.4 deterministic collection handoff

This is synthetic application evidence for [#440](https://github.com/wescodess/budds/issues/440). The branch merged `dev` at `b601b532` with normal merge commit `9c5f259f`, including #582 (`e1ef707a`), #581 (`eaa835f2`) and #576 (`b601b532`). The report code remains `learn-v2.report-code.c6.2.v9`, report/source versions remain v3/v4, and `checkSurface` remains separate from teaching flow. **The complete #440 exit remains blocked by the Canvas continuation below.** This document grants no collection or release permission. No production code, schema, default capability, export/deletion implementation or UI is changed by this proof.

## Registered proof

Run from the repository root with the local CI environment:

```sh
source ~/.budds-orchestrator/ci-env.sh && pnpm exec vitest run convex/learnV2Measurement.e2e.test.ts --maxWorkers=1
```

Accepted T0/source/Blueprint/plan inputs and the frozen protocol are explicitly synthetic. Family generation, validation and publication use registered item commands. Teaching publication uses `commitSessionContentCandidate`; the existing instructional registration service binds the published blocks to the accepted source. Enrollment, grants, canonical acceptance, score reservation/execution/commit and replay use real server commands. Provider and semantic-validation adapters supply fixture verdicts without a second persistence path. No fixture inserts a submission, attempt, mastery record or Independent claim into these journeys. Unknown and assisted scenarios inject declared adverse exposure inputs before real acceptance; they do not forge responses or scores.

There are three 30-learner cohorts: Today/Today, Today/Canvas and Canvas/Canvas. Each contains three learners for each scenario: gain, negative gain, non-returner, absent cold, missed day 7, below-Independent day 30, failed first next check followed by a day-30 pass, unknown assistance, assisted work and accepted-but-unscored work. Both day-7 and day-30 windows run through the registered #572 one-minute cron, durable work queue and scheduled workers. Native Convex transaction limits remain enabled. Snapshot scheduling uses a finite 4,000-iteration test-runner drain; production continuation page limits stay unchanged.

The bound Today regression now expects a successful canonical Independent commit, safe replay, exactly one stored `independent_claim_v2`, the original day-7 link and back-reference, an Independent mastery record and unchanged teaching content. Its start/deliver/commit order and storage assertions match #582's adapted regression. Registered instructional journeys deliver the unchanged lesson while ready, then start the ordinary application before canonical acceptance; browser command ordering remains a separate owner UI check. Both Today cohorts commit their claims through the real scoring transaction and feed them into C6; the failure followed by later pass keeps the original failed slot authoritative.

The positive Today proofs invoke the registered post-seal teaching query, `publishFeedback`, `openPractice`, both help kinds when eligible, and formative response acceptance/replay. They check publication after scoring, separate practice, help replay, unchanged accepted-check records and unchanged instructional content. Ordinary Independent completion is followed by the same runtime rather than a prelinked fixture attempt. Practice responses never substitute for an Independent claim. Every Today learner uses real measurement commands and commits a real Independent claim. Runtime delivery/replay is checked once per scenario. Three repetitions keep the smallest nonempty missing-data bound subset at six learners, above the five-learner publication threshold; two repetitions would suppress that required cell. The separate mixed report retains five learners per flow/surface/scorer group. The bound cohort also reads #581 pointer v2 topic/timing at cold, day 7 and day 30.

Independent numerical expectations for each 30-learner collection cohort are:

| Metric | Original denominator | Observed | Point | All-eligible bounds |
| --- | --- | --- | --- | --- |
| Day-7 VLG | 30 episodes | 12 pairs | 25 percentage points | [0, 70] |
| Day-30 VLG | 30 episodes | 21 pairs | 400/7 percentage points | [30, 70] |
| First-next-check false mastery, each Today surface | 30 claims | 15 checked, 6 failed | 2/5 | [1/5, 7/10] |

Both episode and learner weightings are asserted. Missing outcomes keep all-eligible point estimates null. At day 7 the observed gains per ten scenarios are `100, -100, 100, 0`; five missing delayed endpoints with cold zero contribute [0,100], and absent cold contributes [-100,100]. At day 30 seven observed gains sum to 400; two missing delayed endpoints contribute [0,100] each and absent cold contributes [-100,100]. Repeating each scenario three times preserves these means and bounds. False mastery retains six confirmed failures and 15 unresolved claims over the original 30 claims; a later pass replaces none of them.

The trusted report starts from the approved synthetic owner roster, pins owner watermarks, reads multiple bounded source pages, seals through the scheduled snapshot services and reads multiple audited aggregate pages. The actual Node CLI replays retained normalized inputs from a temporary file, and its cells must equal the online cells. Offline readiness remains `sourceAdmission: pending`, `viewerGrant: unverified_offline`, `realObservations: unverified_offline` and `baselineCapture: unproven`.

A separate mixed 20-learner snapshot distinguishes Today/Today, Today/Canvas, Canvas/Canvas and a second observed scorer upstream under the same Today/Today configuration. Its four day-7 groups each retain five pairs and gain 100. The two observed identities under one frozen binding keep unknown population and null all-eligible bounds; the other groups retain their five-episode denominators and [100,100] bounds. Flow, check surface and scorer identity cannot pool.

Controls retain anonymous and different-issuer direct-RPC/export/download rejection, unaudited legacy-query refusal, owned metadata exports, foreign export-authorization rejection, private-answer/scoring canaries, immutable case/scorer/acceptance pins and scorer replay without another dispatch. Integrity invalidation and physical source purge stale online reports while retained snapshot inputs remain frozen.

The inventory checks all 142 original disclosure surfaces, the four post-seal channels and the topic-bearing Today pointer read declared in the C4 audit: 147 explicit owner/test mappings. Every measurement table must remain in export/deletion enumeration. The separate account-deletion control seeds one sentinel per owned collection; those sentinels never enter the collection reports or CLI. The global due-work cursor and withheld access-audit table retain their separate policies. Operational/outcome metrics remain fixture-only and experiment assignment remains authenticated-learner v1.

## Remaining application boundary

**The original Canvas session still cannot deliver its post-cold teaching or reach first Independent.** The registered control starts from the same accepted plan/session as family generation, publishes teaching revision 1, calls `prepareCanvasSession`, accepts and scores the cold response, and invokes all three post-seal teaching/publication/preparation commands. Scoring succeeds, but feedback, lesson and practice remain null. `openPractice` reports `disclosure_unknown`; trying to start the original teaching revision after cold closure throws `Study session is not ready`. No Independent application or claim is created.

`prepareCanvasSessionForOwner` creates cold-only content revision 2 on that original session. The post-seal resolver falls back to the measurement generation job's session and requires exactly one publication; this real session has both revisions. Its current started-content pin also points to the cold publication. The isolated #576 Canvas fixture uses a separate instructional session, so its positive runtime tests do not establish this original-session continuation. The proof preserves this registered failure instead of relinking a generation job, inserting another opportunity/claim, switching capabilities off or substituting Today teaching for Canvas.

The Canvas cohort still verifies cold/day-7/day-30 collection, exact VLG accounting and report/CLI parity. It has no Independent claims and publishes no false-mastery cells; that omission is **not** a zero false-mastery rate. Full Canvas teaching/Independent/first-next-check proof requires the owning runtime/Canvas correction. Existing standalone runtime tests cover their supported Canvas fixture and the post-Independent completion allowance separately. The direct ordinary-application command in the registered control rejects with `Learn assessment opportunity unavailable`; only the canonical cold attempt remains.

## Validation at the updated branch

Only the requested focused files and both typechecks run on this shared machine, sequentially with one test worker. Build, full `pnpm verify` and `pnpm verify:learn-v2-beta` are reserved for the owner's exact runner at the final head. Earlier results at `5d228a4d` are historical: its full verification did not pass, including an isolated scorer-harness A9 timeout. They confer no pass at this head.

The current focused evidence covers **1,382 tests across 16 files**, including eight distinct command-proof cases, plus both typechecks. Each file/process ran alone with one test worker.

| File or check | Result |
| --- | --- |
| `convex/learnV2Measurement.e2e.test.ts` | 8 distinct cases passed in five isolated partitions |
| `convex/learnV2MeasurementReportContract.test.ts` | 7 passed |
| `convex/learnV2MeasurementReports.test.ts` | 82 passed; full isolated rerun after two 5-second timeouts |
| `convex/learnV2C5ReportsIntegration.test.ts` | 13 passed; full isolated rerun after one 30-second timeout |
| `shared/learn-v2-measurement-report.test.ts` | 75 passed |
| `scripts/learn-v2-measurement-report.test.ts` | 52 passed |
| `convex/learnV2TodayDelivery.test.ts` | 143 passed |
| `convex/learnV2TodayPointers.test.ts` | 355 passed |
| `convex/learnV2CanvasContract.test.ts` | 94 passed |
| `convex/learnV2PostSealRuntime.test.ts` | 73 passed |
| `convex/learnV2PostSealTransitions.test.ts` | 46 passed; full isolated rerun after one 5-second timeout |
| `convex/learnV2PostSealTeaching.test.ts` | 215 passed |
| `convex/learnV2PostSealStorage.test.ts` | 23 passed |
| `convex/learnV2DisclosureOffParity.test.ts` | 77 passed |
| `server/api/disclosure-off-parity.test.ts` | 47 passed |
| `tests/component/learn-adaptive/ready-session-canvas.test.ts` | 72 passed |
| `pnpm typecheck` | Passed |
| `pnpm typecheck:convex` | Passed; 643 index names validated |

The eight proof cases include the registered negative Canvas continuation control. Its pass records the remaining application failure; it does not satisfy the Canvas teaching/Independent exit.

The initial 50-learner Today proof cases exhausted 180-second and 300-second limits; isolated 180-second Today retries also timed out. The final 30-learner fixtures preserve every required scenario and the minimum-five publication sets, and the cohort-case budget is 300 seconds. The report-service, C5/C6 integration and post-seal transition files had the timeouts listed above; each complete file passed its isolated rerun without changing its existing deadline. No initial timeout is reported as a pass.

Exact passing commands, each executed separately and sequentially:

```sh
source ~/.budds-orchestrator/ci-env.sh && pnpm exec vitest run convex/learnV2MeasurementReportContract.test.ts --maxWorkers=1
source ~/.budds-orchestrator/ci-env.sh && pnpm exec vitest run convex/learnV2MeasurementReports.test.ts --maxWorkers=1
source ~/.budds-orchestrator/ci-env.sh && pnpm exec vitest run convex/learnV2C5ReportsIntegration.test.ts --maxWorkers=1
source ~/.budds-orchestrator/ci-env.sh && pnpm exec vitest run shared/learn-v2-measurement-report.test.ts --maxWorkers=1
source ~/.budds-orchestrator/ci-env.sh && pnpm exec vitest run scripts/learn-v2-measurement-report.test.ts --maxWorkers=1
source ~/.budds-orchestrator/ci-env.sh && pnpm exec vitest run convex/learnV2TodayDelivery.test.ts --maxWorkers=1
source ~/.budds-orchestrator/ci-env.sh && pnpm exec vitest run convex/learnV2TodayPointers.test.ts --maxWorkers=1
source ~/.budds-orchestrator/ci-env.sh && pnpm exec vitest run convex/learnV2CanvasContract.test.ts --maxWorkers=1
source ~/.budds-orchestrator/ci-env.sh && pnpm exec vitest run convex/learnV2PostSealRuntime.test.ts --maxWorkers=1
source ~/.budds-orchestrator/ci-env.sh && pnpm exec vitest run convex/learnV2PostSealTransitions.test.ts --maxWorkers=1
source ~/.budds-orchestrator/ci-env.sh && pnpm exec vitest run convex/learnV2PostSealTeaching.test.ts --maxWorkers=1
source ~/.budds-orchestrator/ci-env.sh && pnpm exec vitest run convex/learnV2PostSealStorage.test.ts --maxWorkers=1
source ~/.budds-orchestrator/ci-env.sh && pnpm exec vitest run convex/learnV2DisclosureOffParity.test.ts --maxWorkers=1
source ~/.budds-orchestrator/ci-env.sh && pnpm exec vitest run server/api/disclosure-off-parity.test.ts --maxWorkers=1
source ~/.budds-orchestrator/ci-env.sh && pnpm exec vitest run --config vitest.config.component.ts tests/component/learn-adaptive/ready-session-canvas.test.ts --maxWorkers=1
source ~/.budds-orchestrator/ci-env.sh && pnpm exec vitest run convex/learnV2Measurement.e2e.test.ts --maxWorkers=1 -t 'registered collection, scheduler, bounded report and CLI: today$'
source ~/.budds-orchestrator/ci-env.sh && pnpm exec vitest run convex/learnV2Measurement.e2e.test.ts --maxWorkers=1 -t 'registered collection, scheduler, bounded report and CLI: today_canvas$'
source ~/.budds-orchestrator/ci-env.sh && pnpm exec vitest run convex/learnV2Measurement.e2e.test.ts --maxWorkers=1 -t 'registered collection, scheduler, bounded report and CLI: canvas$'
source ~/.budds-orchestrator/ci-env.sh && pnpm exec vitest run convex/learnV2Measurement.e2e.test.ts --maxWorkers=1 -t 'one trusted snapshot separates'
source ~/.budds-orchestrator/ci-env.sh && pnpm exec vitest run convex/learnV2Measurement.e2e.test.ts --maxWorkers=1 -t 'bound Today|Canvas cold scoring|every disclosure|all measurement tables'
source ~/.budds-orchestrator/ci-env.sh && pnpm typecheck
source ~/.budds-orchestrator/ci-env.sh && pnpm typecheck:convex
```

Independent review and its final-head ledger remain required under [review-gate](../../.agents/skills/review-gate/SKILL.md); no gate pass is claimed here.

## Pending owner work before collection

All items below remain pending; synthetic approvals authorize none of them.

- Complete any remaining application boundary above and require the complete deterministic proof at the final head.
- Approve and implement learner UI under #361, #441 and #442 and reporting presentation under #367; verify the integrated browser/device journeys separately.
- Preserve and approve the real baseline SHA and protocol under #362 before Phase D reaches participants. Freeze epoch, anchor, timezone, half-open day-7/day-30 windows, replacement policy, cohort, enrollment interval, sample and release boundary; protect follow-up.
- Separately authorize deployment, environment configuration and any required migration/backfill.
- Approve actual flags, Learn/adaptive entitlements and participant enrollment. Defaults remain off. Prospective fixture history establishes no earlier teaching history.
- Approve the pilot manifest, participant reach, provider/scorer inventory, verified observed identities, form/scorer validation, service accounts and required keys through the established private process.
- Provision the verified application principal and scoped viewer grant. The production report approval catalogue remains empty; repository ownership grants no application or raw-input access. Resolve #564 before admitting another viewer.
- Separately approve inference spend, quotas and live provider/privacy canaries. This change performs no provider spend, production grant, flag change, deployment or data operation.
- Run approved privacy/export/deletion/revocation canaries in the intended environment. Verify deployed cron timing, receipt retention and production contention separately.
- Run the owner's full verification and beta checks and record independent review at the final PR head before the release decision.

Native limits on these 30-owner collection cohorts and the 20-owner mixed report do not establish the 600-owner/64-MiB maximum under production load. Real cold baseline capture, real day-7 outcomes, real day-30 outcomes and real first-next-check false mastery are separately unproven for Today/Today, Today/Canvas and Canvas/Canvas. Fixture scores, replay, passing checks and later horizons cannot satisfy another flow's or horizon's real-attempt learning exit.
