# Laya Cloudflare Container Pilot

Status: implementation complete; production activation pending
Owner: Budds platform
Date: 2026-09-19
Baseline: `feefbe4e47637928ec3ddb72d890ece594fa4b38`

## Outcome

Budds will gain an on-demand, self-hosted typed-decision service for evaluating generated learning material. The first provider is Laya running on CPU in a Cloudflare Container, but every product feature will call a provider-neutral application interface. A future Laya replacement, hosted API, or ensemble must be implementable as a new adapter without changing quiz, Learn, flashcard, chat, or podcast feature code.

The pilot begins with generated-quiz validation in shadow mode. Its output is observable but cannot publish, reject, grade, or otherwise change a user-visible result. This proves accuracy, latency, cold-start behavior, memory fit, and cost before Budds assigns the service authority or integrates it across more features.

## Architecture

```text
Quiz generation
  -> canonical typed-decision client
     -> configured provider adapter
        -> Laya adapter
           -> private Pages service binding + bearer token
              -> Cloudflare Worker
                 -> named singleton Container
                    -> Python evaluation API
                       -> pinned Laya checkpoint on CPU
```

There are three deliberate trust boundaries:

1. Product features use only canonical request and result types.
2. The Laya adapter is the only Nuxt-side code that knows Laya's transport contract.
3. The Worker authenticates, validates, budgets, and routes requests before the model process sees them.

## Provider-neutral contract

The feature-facing API is `evaluateTypedDecision`. Its first canonical request kind is a bounded `quiz_quality` batch containing a request ID, input digest, questions, options, and stated answers. The request union can gain other feature-owned decision kinds later without exposing a provider wire contract. Laya maps this first kind to its internal `choice` primitive. The canonical result is a discriminated union:

- `completed`: normalized answers/distributions, confidence where supported, provider identity, model version, protocol version, and timings.
- `unavailable`: a stable reason such as disabled, timeout, busy, over-budget, invalid-response, or provider-error, plus retryability where useful.

Feature code must not import Laya DTOs or inspect Laya-native fields. Adapter selection is configuration-driven. Shadow/advisory/enforced mode belongs to the canonical policy layer, although only `off` and `shadow` are enabled in this pilot. Provider errors are data returned to the shadow caller, not endpoint failures.

## Container topology and cost controls

- Add a separately deployed Worker under `workers/laya-evaluator`; do not alter the Nuxt Cloudflare Pages deployment.
- Route all work to one stable instance ID, `budds-shadow-v1`, with `max_instances: 1`.
- Begin with `standard-2` (1 vCPU, 6 GiB memory, 12 GB disk) and a 60-second idle timeout.
- Serialize model inference. Reject excess concurrency with `429` and `Retry-After` instead of creating more containers.
- Enforce a configurable UTC daily request allowance in Worker-owned durable storage. This is a safety guard, not a Cloudflare billing cap.
- Keep Workers development URLs disabled. Production traffic arrives through a Pages service binding, with a matching server-only bearer secret as defense in depth.
- Emit only request IDs, hashes, status, model revision, load/inference latency, and counters. Never log source text, learner state, question text, options, or raw model output.

## Model service

The image uses Python 3.11 on `linux/amd64`, runs as a non-root user, and exposes one standard-library HTTP service on port 8080. It provides:

- `GET /health/live`: process is accepting HTTP.
- `GET /health/ready`: model is loaded and its revision matches the configured pin.
- `POST /v1/evaluate`: strict bounded request validation and normalized response.

The HTTP server binds before model loading finishes so Container port readiness is not blocked by a large checkpoint load. Evaluation returns a controlled retryable warming response until ready. A process-level lock serializes CPU inference across request threads.

The production image pins `laya==0.3.3` and the typed-decisions checkpoint revision `f9ab0b228f0fc0f14d873dbc99038f135c2da1b2`. Hugging Face's revision metadata reports the 842,609,220-byte `model.safetensors` SHA-256 as `4fa56de72383a9d3efa9cfa78955733c81b9fc8067a587ca4beb82c78107a24e`. Weights and tokenizer are downloaded during the image build, verified, and bundled; runtime Hugging Face/network access is disabled. The CPU Torch and top-level inference dependency versions are exact-pinned and must pass the real image build before deployment.

A fake backend implements the same internal evaluator protocol without importing Torch. All CI service tests use it, making the gate deterministic and independent of model downloads, Docker, GPU availability, and third-party uptime.

## Input and failure policy

The outer Worker rejects every external route except `POST /v1/evaluate`, uses constant-time token comparison, caps raw body size before JSON parsing, rejects unknown fields, and validates the protocol/model revision. Health endpoints exist only inside the Container lifecycle boundary. Initial quiz-shadow limits are conservative: at most 20 items per batch, eight options per item, 1,200 characters per question, 400 characters per answer or option, and a 32 KB request body.

The Nuxt client applies a short deadline. Disabled configuration, timeout, warming, saturation, allowance exhaustion, malformed provider output, and all provider 5xx responses fail open in shadow mode. The quiz result and persistence path must remain byte-for-byte semantically equivalent to the pre-pilot behavior.

## Delivery phases

### Phase 1 — contracts and deterministic tests

Create the canonical types, provider interface, dispatching client, and Laya adapter with injected transport. Prove provider swapping, disabled mode, deadlines, retryable failures, malformed output handling, and redaction. No feature uses a provider-specific type.

### Phase 2 — Worker and fake model service

Create the isolated Worker package, Container configuration, strict transport schemas, authentication, named routing, concurrency/daily guards, and Python API. Test every public failure path and the fake backend locally. Add license/model provenance.

### Phase 3 — quiz shadow integration

Invoke the canonical client only after a quiz has parsed successfully. Use a bounded batch and wait only within the configured deadline. Do not alter generated questions, quiz persistence, response payload, publication, or deterministic scoring. Record only sanitized operational telemetry; defer database persistence of model judgments until a separate data-retention design is approved.

### Phase 4 — repository and deployment readiness

Add server-only runtime configuration, `.env.example` documentation, environment validation, secret scanning coverage, root scripts, and hosted CI jobs for Worker and fake-backend tests. Document local development, service binding, matching secrets, dry-run/deploy/rollback procedures, allowance controls, and how to disable the pilot instantly.

### Phase 5 — measured activation (separate authorization)

After code review and local gates, build the real image with Docker, confirm peak memory and cold/warm latency, and deploy the isolated Worker. Bind it to a non-production Pages environment first. Production activation requires explicit authorization, matching secrets, an initial low daily allowance, and dashboard/alert review. Laya remains shadow-only until a labeled Budds evaluation set demonstrates acceptable calibration and error rates.

## Test and release gates

- Canonical contract and adapter unit tests pass with no Laya dependency in feature code.
- Worker tests cover authentication, method/route closure, body limits, schema rejection, singleton routing, saturation, daily allowance, and retryable upstream failures.
- Python tests cover liveness versus readiness, validation, warming, serialization, fake predictions, and redacted errors.
- Quiz regression tests prove evaluator success and every failure class leave the existing response and persistence behavior unchanged.
- Root `pnpm verify` includes or invokes the new deterministic gates.
- Wrangler dry-run accepts the container configuration.
- A real Docker image build verifies the model checksum and offline startup before any deployment.
- Independent review finds no high- or medium-severity correctness, security, privacy, cost-control, or provider-coupling issue.

## Rollback

The immediate rollback is configuration-only: set the decision mode to `off` or remove the Pages service binding. Because the integration is fail-open and non-authoritative, quiz generation continues. The isolated Worker can then be rolled back or deleted without a Nuxt/Convex data migration. No production data cleanup is expected because this pilot does not store raw evaluations.

## Explicitly deferred

- Enforced automatic rejection or grading.
- Learn mastery, flashcard, chat, and podcast integration.
- Jev or another provider adapter.
- Fine-tuning or training Laya.
- Persisted evaluation datasets or learner-facing explanations.
- Multi-instance autoscaling, always-on hosting, or GPU inference.
- Production deployment and traffic activation without a separate go/no-go decision.
