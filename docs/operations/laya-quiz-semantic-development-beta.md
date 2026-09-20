# Laya quiz semantic development beta

This runbook activates the learner-facing advisory card only on the Cloudflare Pages `dev` preview backed by the development Convex deployment. The recorded quiz score remains authoritative. The committed policy makes the same synthetic evidence structurally ineligible for production.

> Current gate status: closed. After correcting the evaluator to give each unrelated item its own Laya state, an evenly stratified 40-item real-checkpoint pilot reached 27.5% reference agreement and 0.150 macro-F1, below the unchanged 0.80 and 0.75 development thresholds. Do not deploy the Worker, set advisory mode, or approve the manifest until a quiz-domain fine-tuned checkpoint passes the full fit/held-out process below. Temperature scaling cannot repair wrong selected labels.

## Fixed development identity

- Application environment: `development`
- Pages environment: `preview`
- Pages branch: `dev`
- Convex URL: `https://cautious-elephant-39.convex.cloud`
- Worker: `budds-laya-evaluator-dev`
- Model: `laya==0.3.3`, revision and weight checksum pinned in `learningDecisionManifest.json`

## Secrets, variables, binding, and quota

Set `LAYA_EVALUATOR_TOKEN` as an encrypted secret on the evaluator Worker. Set the identical value as the Pages secret `NUXT_LAYA_EVALUATOR_TOKEN`; never put it in public runtime config. Set `NUXT_QUIZ_ASSESSMENT_WRITE_SECRET` as a separate Pages secret of at least 32 characters. Do not reuse production credentials.

The `dev` Pages project must bind `LAYA_EVALUATOR` to `budds-laya-evaluator-dev`. The Worker keeps `workers_dev` disabled, permits one `standard-2` container, serializes inference, and has a development-only `LAYA_DAILY_ALLOWANCE=150` so the 100 exact-contract batches fit with bounded retry headroom. Restore a lower allowance after calibration if desired. A local URL is allowed only for operator calibration and must not replace the Pages service binding in the dev smoke test.

Set these non-secret Pages variables for the `dev` preview:

```text
NUXT_APPLICATION_ENVIRONMENT=development
NUXT_LEARNING_DECISION_MODE=advisory
NUXT_LEARNING_DECISION_PROVIDER=laya
NUXT_QUIZ_SEMANTIC_ACTIVATION_MANIFEST=quiz-semantic-advisory.v1
NUXT_PUBLIC_CONVEX_URL=https://cautious-elephant-39.convex.cloud
```

Cloudflare supplies `CF_PAGES_ENVIRONMENT=preview` and `CF_PAGES_BRANCH=dev`. Strict build validation rejects any mismatch before provider traffic can be enabled.

## Fit, evaluate, and approve immutable evidence

Run the real image, not `LAYA_FAKE_BACKEND=1`. Calibration may use the explicit 120-second operator timeout because local CPU inference has exceeded the unchanged 12-second application and 11-second container deadlines. That override is recorded in every artifact and is not operational-parity evidence.

First start the service in its explicit calibration-only raw-fit mode, then fit the deterministic probability calibrator from `fit.v1.jsonl`:

```sh
LAYA_CALIBRATION_URL=https://<private-operator-endpoint> \
LAYA_CALIBRATION_TOKEN=<development-secret> \
LAYA_CALIBRATION_GENERATED_AT=<fixed-ISO-8601-time> \
LAYA_CALIBRATION_PHASE=fit \
LAYA_CALIBRATION_TIMEOUT_MS=120000 \
pnpm laya:quiz-semantic:evaluate
```

Independently review the generated `probability-calibrator.candidate.json`, pin its exact SHA-256 in the activation manifest, install those exact bytes into the service, and restart in normal calibrated mode. Then run the same command with `LAYA_CALIBRATION_PHASE=heldout`. Do not fit or tune against held-out labels.

The frozen fit and held-out corpora each contain 800 deterministic synthetic references with 200 cases for every label and disjoint scenario/text groups. `pnpm laya:quiz-semantic:corpus` verifies both files still match their committed generator. The runner enforces support, the 32,000-byte request ceiling, bounded retries (including clamped `Retry-After`), exact-contract batches, unique resume IDs, exact resume provenance, and a fresh service attestation request on every invocation. It rejects fake-backend or mismatched model/calibrator headers and incomplete probability distributions. The held-out report records recomputable raw and calibrated statistics without question, evidence, or learner-answer text, and applies unchanged policy thresholds only to calibrated held-out metrics. Independently review the candidate and emitted SHA-256; confirm its fit, held-out, evaluator-manifest, calibrator, and threshold hashes match the activation manifest. Only then may a reviewer replace the pending report, set the activation manifest to `approved`, add `advisory` to `allowedModes`, and copy the exact report digest into `evidence.sha256`.

## Smoke test and observability

1. Confirm the Worker deployment and Pages binding are the development resources above.
2. Build the `dev` candidate with strict validation and the exact environment tuple.
3. Sign in to the `dev` Pages preview, complete a quiz containing a free-response answer, and record the score payload before advisory processing.
4. Confirm the card says `Development beta · AI-reviewed` and `not a corrected grade`; compare the post-advisory score payload byte-for-byte with the recorded score.
5. Exercise exact semantic variants including `culture and opportunities`, `opportunities & cultures`, reordered/plural/punctuation equivalents, and the committed partial, lexical-negation, and uncertain near misses. Record the advisory result without treating it as a corrected grade.
6. Submit an application-sized batch of eight eligible answers under the unchanged 12-second client and 11-second container boundaries. Record latency and timeout behavior separately from the 120-second calibration override; calibration success alone does not prove runtime readiness.
7. Confirm logs contain request ID, digest, model revision, status, timings, and counters only. Search explicitly for the test question, answer, and source excerpt; none may appear.
8. Exercise a timeout or temporarily remove the binding. The score must remain final and the card must show a retryable or unavailable state.

## Rollback

Set `NUXT_LEARNING_DECISION_MODE=off` and rebuild the `dev` preview, or remove the `LAYA_EVALUATOR` binding. Ordinary quiz completion must continue and no semantic provider request may occur. Do not alter production configuration. Future production activation requires human-adjudicated evidence and a deliberate code-policy change; changing environment variables alone cannot enable it.
