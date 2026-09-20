---
title: 'Calibrate and activate Laya quiz advisory on development'
type: 'feature'
created: '2026-09-20'
status: 'in-progress'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '1dd519f43543efb95eafb705fbb249bedfecb1b9'
context:
  - 'AGENTS.md'
  - 'convex/_generated/ai/guidelines.md'
  - 'docs/plans/laya-cloudflare-container-pilot.md'
  - 'docs/research/laya-quiz-evaluator-deep-dive.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Laya semantic review is implemented but the activation gate accepts only a meaningless evidence string, has no deployment scope, and remains closed. Budds has no reproducible corpus, runner, statistical report, or independently reviewable evidence that the pinned evaluator behaves acceptably on quiz free responses.

**Approach:** Build and run a versioned synthetic calibration for the exact production contract, bind its immutable report to a fail-closed development-only gate, label the learner card as beta, and activate advisory mode on remote `dev` only when the measured development thresholds and operational smoke tests pass. Preserve production as off and require separate human-adjudicated evidence plus explicit authorization before any future production activation.

## Boundaries & Constraints

**Always:** Keep deterministic `isCorrect`, quiz score, mastery, and publication authoritative. Identify synthetic and AI-reviewed labels truthfully; call their metric reference agreement, not human agreement. Use the pinned Laya package, model revision, contract, rubric, snapshot, and model checksum. Bind the report by SHA-256 and verify its contents rather than trusting `passed`. Require the exact `dev` Pages branch, development Convex deployment, and development environment. Keep inputs bounded, secrets server-only, logs redacted, and activation reversible with mode `off`.

**Never:** Treat synthetic evidence as human calibration; import real learner answers without consent and anonymization; use the fake backend as model evidence; expose advisory output as a corrected grade; enable production through an environment-only toggle; reuse production credentials; silently activate if real-model evaluation is incomplete or below the declared development thresholds.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Valid dev evidence | Exact report hash, pinned versions, passing metrics, exact dev identity | Advisory endpoint and beta UI enabled | None |
| Tampered or weak evidence | Hash/version/schema/metric mismatch, fake backend, missing probabilities, unavailable rows | Advisory remains disabled | Strict build explains failed gate |
| Wrong deployment | Production, unknown environment, non-`dev` branch, or wrong Convex URL | Advisory remains disabled even with valid report | Fail closed before provider call |
| Provider unavailable | Valid dev activation but timeout, cold start, quota, or malformed response | Recorded score remains final; advisory is retryable or unavailable | Bounded retry and honest UI |
| Human evidence absent | Synthetic/AI-reviewed corpus only | Development beta may open; production remains structurally impossible | Report and UI retain beta/provenance language |

</frozen-after-approval>

## Code Map

- `workers/laya-evaluator/learningDecisionManifest.json` and `service/app.py` -- canonical labels, bounds, pinned model, and real inference seam; fake backend cannot count as evidence.
- `workers/laya-evaluator/calibration/` -- add a versioned JSONL corpus, thresholds, schemas, and aggregate report without learner text.
- `scripts/evaluate-laya-calibration.mjs` -- add the exact-contract, resumable, bounded evaluator and independent metric calculation.
- `scripts/lib/quiz-semantic-calibration.mjs` -- add pure artifact/hash/version/provenance/threshold validation shared by tests and build validation.
- `convex/quizSemanticActivationManifest.json` -- replace the truthy evidence reference with a structured report path/hash and hard development scope.
- `server/utils/learning-decisions/activation.ts` -- make one fail-closed activation decision from manifest, verified evidence, and deployment identity.
- `scripts/validate-env.mjs`, `nuxt.config.ts`, `server/api/quiz/assess-attempt.post.ts` -- consume the same activation decision for builds, public UI state, and server execution.
- `app/components/quiz/ReviewPanel.vue` -- identify semantic feedback as development beta while preserving score language.
- `workers/laya-evaluator/wrangler.jsonc` and Cloudflare preview configuration -- isolate the dev evaluator, binding, quota, and secrets from production.

## Tasks & Acceptance

**Execution:**
- [ ] Calibration schemas, corpus, thresholds, runner, and focused tests -- generate deterministic evidence from the real pinned evaluator and reject incomplete, synthetic-as-human, or probability-incomplete reports.
- [x] Activation manifest/verifier and tests -- validate path, SHA-256, model/contract pins, sample support, metrics, provenance tier, and an exact development deployment tuple.
- [x] Nuxt/environment/endpoint/UI wiring and regressions -- share one activation result, show beta advisory only on valid dev, and preserve all scoring boundaries and failure states.
- [x] Operations documentation and isolated dev Worker configuration -- document exact secrets, bindings, quota, smoke test, observability, and rollback without changing production.
- [ ] Run the real-model calibration, commit the immutable report, independently review the complete diff, run the full repository gate, deploy remote dev, smoke test, merge to `dev`, and verify the exact remote tip and hosted CI.

**Acceptance Criteria:**
- Given any report tampering, failed threshold, missing probability, fake backend, model drift, or deployment mismatch, when the app builds or evaluates activation, then advisory is disabled with a typed diagnostic and no provider request.
- Given the committed synthetic development corpus and pinned real evaluator, when calibration runs, then the report is reproducible, contains no raw learner data, exposes complete per-label and calibration metrics, and truthfully records provenance.
- Given passing development evidence and exact dev configuration, when an authenticated learner completes an eligible answer, then Laya’s beta advisory appears while the original score remains byte-for-byte unchanged.
- Given production configuration or a future production deploy, when the same manifest is present, then advisory remains impossible without a deliberate code-policy change and human-adjudicated evidence.
- Given mode `off` or the dev binding removed, when a quiz is completed, then ordinary quiz behavior continues and no semantic request is made.

## Implementation Notes

- Added deterministic, grouped-disjoint fit and held-out v1 corpora with 800 rows and 200 references per label in each phase. The generator verifies scenario diversity, exact motivating semantic variants, realistic ambiguous cases, and no normalized tuple overlap. A deterministic multiclass temperature fitter uses fit labels only; its candidate artifact binds the fit corpus, evaluator manifest, package, model revision, and model checksum.
- Strengthened the resumable exact-contract runner to bind phase and every artifact digest, reject duplicate or mismatched cached decisions, make a fresh real-service attestation request on every invocation, enforce request bytes, honor bounded `Retry-After`, and record the explicit operator timeout override. Held-out evidence includes recomputable raw and calibrated confusion/calibration statistics without question, evidence, or learner-answer text; thresholds apply only to calibrated metrics.
- Replaced the truthy evidence switch with one typed verifier shared by strict environment validation, Nuxt public state, and the server endpoint. It checks bytes-on-disk SHA-256, schema, pins, metrics, provenance, and the exact `development` / `preview` / `dev` / development-Convex tuple. Synthetic evidence remains structurally ineligible for production.
- The Python service observes the installed package and model bytes, validates the pinned evaluator manifest and calibrator, preserves the model-selected class, and fails closed if those identities disagree. Raw probabilities are available only in explicit fit mode; normal real inference requires a valid fitted calibrator and returns its digest in the response headers.
- Real-model fit and held-out execution, calibrator/report approval and hash insertion, runtime-sized latency proof, remote deployment, authenticated smoke proof, merge, and hosted CI remain intentionally incomplete. The committed activation manifest and calibrator therefore remain `not-approved` / `not-fitted` and fail closed.
- The first real-model pilot exposed an incorrect integration assumption: Laya's public API evaluates many questions against one shared state, not many unrelated state/question pairs. The evaluator now uses one flat state and one `predict` call per independent item for both decision kinds, with regression coverage against cross-item leakage. An exact-contract, evenly stratified 40-item held-out pilot after that correction reached 27.5% reference agreement and 0.150 macro-F1 (10/10 full, 0/10 partial, 0/10 incorrect, 1/10 uncertain); five eight-item requests completed in 5.81–6.63 seconds. This is a checkpoint capability failure, not a latency or calibration failure. Temperature scaling cannot change the selected class, so the 800-row fit was intentionally not spent and advisory remains closed.
- The pinned typed-decisions checkpoint is specialized for four unrelated workflows. Laya's official model card states that domain capability comes from fine-tuning and documents roughly 4–5 hours on free 2xT4 hardware for its reference workflow. A Budds quiz-grading fine-tune and a newly pinned model artifact are therefore required before this acceptance gate can responsibly pass; that external training run remains outside this change's completed evidence.
- Final release review found that per-field character limits could still overflow Laya's combined state window. The real backend now counts the exact serialized state with the pinned model tokenizer and rejects an item before inference whenever it exceeds the conservative state budget derived from the checkpoint's `max_len` and `head_max_len`; tests prove prediction is never called for an input that would truncate.

## Spec Change Log

## Review Triage Log

## Design Notes

Development thresholds are policy-versioned separately from production eligibility. The initial dev beta may use synthetic and blinded AI-reviewed references, but the gate must record that tier and hard-reject it for production. Real-model execution and operational smoke evidence are required; passing unit tests with the fake backend is not calibration.

## Verification

**Commands:**
- `pnpm laya:quiz-semantic:evaluate` -- exact pinned evaluator completes the frozen corpus and emits a deterministic aggregate report.
- Focused Vitest and Python suites -- corpus, metrics, tamper, deployment-scope, endpoint, retry, UI, and fake-backend rejection cases pass.
- `pnpm verify` and strict synthetic-development `pnpm build` -- full local gate passes at the exact candidate commit.
- Cloudflare/Convex dev inspection plus authenticated quiz smoke test -- correct service binding, matching secrets, beta card, redacted logs, unchanged score, and mode-off rollback are demonstrated.

**Local results (2026-09-20):** focused activation/API/UI tests, Worker Vitest, Python service tests, root and Worker typechecks, lint, 1,515 root unit tests, 501 component tests, 38 audio component tests, 62 audio Worker tests, and all three package audits passed. The first all-in-one component run hit one unrelated chat component timeout; the complete component suite passed immediately on isolated rerun. The preflight remediation adds focused corpus, fitter, report-verifier, runner-resume/attestation, request-limit/retry, endpoint fail-closed, Worker-header, and Python service-identity/calibrator tests. A strict mode-off production build and secret scan passed. A strict advisory validation remains fail closed with `manifest_not_approved`. Real-model fit/held-out evaluation and remote verification are intentionally pending.
