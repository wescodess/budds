---
title: 'Move Audio Overview generation to a durable job'
type: 'refactor'
created: '2026-09-02'
status: 'superseded'
superseded_by: '_bmad-output/implementation-artifacts/spec-audio-overview-v2.md'
baseline_commit: '6f2964c'
context:
  - 'docs/adr/0002-durable-audio-generation-workflow.md'
  - 'docs/adr/0003-separate-audio-metadata-and-artifacts.md'
  - 'docs/plans/podcast-audio-overview-implementation-plan.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Folder Audio Overview generation currently runs inside one browser-initiated Nitro request. A reload, disconnect, or Pages runtime interruption can strand a paid generation, lose in-memory cleanup state, and force the user to restart work.

**Approach:** Accept the command quickly, create one idempotent Convex Generation Job, and execute the existing source, script, synthesis, upload, and publication work as retryable Cloudflare Workflow steps. Keep Convex as the authoritative realtime status channel and preserve the existing v1 playback shape while the wider version-2 artifact migration proceeds.

## Boundaries & Constraints

**Always:** Preserve the frozen owned-source manifest, finite quota, one-active-job limit, current voice/preferences contract, exact source allowlist, cancellation checks before paid work, bounded retries, deterministic Workflow/turn identities, owner-scoped cleanup, and atomic final publication. Never persist a user JWT or provider credential in Workflow state. Production starts through a Pages service binding; local development may use an authenticated loopback Worker URL.

**Ask First:** Deploying the standalone Worker, adding the Pages service binding in Cloudflare, changing paid provider credentials, issuing a real paid TTS request, or enabling a version-2 production flag.

**Never:** Hold the browser request open for generation, use `waitUntil` as durability, silently broaden explicit scope, silently fall back to another paid voice provider, restart completed turns, expose arbitrary storage deletion, or migrate course primers/interjections as part of this slice.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Accepted | Owned ready sources and a new idempotency key | HTTP 202 with task/job IDs; realtime task advances through stages | Workflow continues after navigation |
| Duplicate | Same user and idempotency key | Existing job returned; no extra quota, Workflow, TTS, or media | Idempotent success |
| Cancelled | User cancels between steps | No later paid step runs; staged media is deleted | Terminal cancelled state |
| Transient provider error | 429, timeout, or 5xx | Current Workflow step retries with bounded backoff | Fail after retry budget |
| Permanent source/config error | Empty exact scope, unavailable index, invalid script, or missing config | No synthesis starts | Honest terminal failure |
| Duplicate turn delivery | Retry after upload acknowledgement is lost | Existing committed turn result is reused | New orphan upload is discarded |

</frozen-after-approval>

## Code Map

- `convex/audioOverviewJobs.ts` -- capability-secured job lifecycle, checkpoints, upload ownership, cleanup, and idempotent finalization.
- `convex/schema.ts` -- bounded job and staged-turn records plus required indexes.
- `server/api/audio-overview/generate.post.ts` -- short authenticated command that reserves and starts the Workflow.
- `server/api/audio-overview/jobs/step.post.ts` -- narrow per-job capability endpoint for individual Workflow stages.
- `server/utils/audio-overview-job-auth.ts` -- deterministic job capability derivation and hashing.
- `workers/audio-overview/` -- standalone Workflow Worker, configuration, generated binding declarations, and tests.
- `app/components/audio-overview/AudioOverviewShell.vue` -- submits one idempotent command and relies on Convex subscriptions for progress/readiness.

## Tasks & Acceptance

**Execution:**
- [x] `convex/schema.ts`, `convex/audioOverviewJobs.ts`, `convex/tasks.ts` -- add normalized operational job/turn checkpoints and reuse authoritative reservation rules.
- [x] `server/api/audio-overview/generate.post.ts`, `server/api/audio-overview/jobs/step.post.ts` -- split acceptance from generation and expose only capability-authorized stages.
- [x] `workers/audio-overview/*` -- implement deterministic Workflow steps, retry classification, cancellation, failure reporting, service entrypoint, and local configuration.
- [x] `app/components/audio-overview/AudioOverviewShell.vue` -- replace reserve-plus-fire-and-forget behavior with the short accepted command.
- [x] Focused Convex, server, Worker, and mounted component tests -- cover the implemented v1 bridge, authority boundaries, idempotency, and realtime state without polling or refresh.
- [x] Developer/API docs and environment validation -- document local three-process startup and Worker-before-Pages deployment order.
- [ ] Version-2 deterministic private R2 artifact path -- close the upload-acknowledgement ambiguity before claiming orphan-free retries in production.

**Acceptance Criteria:**
- Given an authorized request, when it is submitted, then one job is accepted within two seconds and generation continues independently of the page.
- Given completed durable steps, when a later step retries, then completed provider calls and uploads are not repeated.
- Given cancellation or terminal failure, when late work returns, then it cannot revive or publish the task.
- Given successful finalization, when Convex publishes the overview, then the existing player receives a ready record through its realtime subscription.

## Spec Change Log

- 2026-09-02: Implemented the v1-compatible durable Workflow bridge, job
  capability boundary, normalized checkpoints, cancellation/cleanup, and local
  three-process development setup. Production Worker deployment and Pages
  binding remain approval-gated.
- 2026-09-03: Corrected the local Wrangler `PAGES_BASE_URL` binding, added
  fail-fast callback URL validation, and replaced unsupported RPC method
  binding with a direct `WorkflowStep.do` wrapper.

## Design Notes

The Workflow owns orchestration and retry timing. Convex owns authority and compare-and-set state. The per-job capability is derived server-side, stored only as a hash in Convex, and cannot authorize any other task. This is a compatibility bridge for current v1 media; the accepted version-2 private R2/WAV model remains a subsequent ticket rather than being weakened here.

The compatibility bridge deliberately terminal-fails an ambiguous provider timeout or 5xx after a one-shot claimed attempt. Retrying that response without provider idempotency could repeat a paid LLM or TTS call. A definite 429 releases the claim for a bounded Workflow retry. Similarly, the current Convex signed-upload endpoint returns a newly allocated `storageId` only after accepting the bytes; if that response is lost, the Workflow cannot identify and delete the possible orphan. Exact duplicate-safe upload recovery therefore requires the deterministic private R2 object key described by ADR 0003. These limits mean the frozen transient-retry and orphan-upload rows are not yet fully satisfied by the v1 bridge.

## Verification

**Commands:**
- `pnpm exec convex codegen && pnpm exec vitest run convex/audioOverviewJobs.test.ts convex/tasks.test.ts convex/audioOverviewCascades.test.ts server/api/audio-overview/generate.post.test.ts server/api/audio-overview/jobs/step.post.test.ts server/utils/ai-gateway.test.ts --reporter=dot` -- authority, idempotency, launch, stage, provider-claim, cancellation, and retention behavior pass.
- `pnpm --dir workers/audio-overview test && pnpm --dir workers/audio-overview typecheck` -- Workflow duplicate/resume/cancellation behavior and Worker types pass without paid calls.
- `pnpm exec vitest run --config vitest.config.component.ts tests/component/audio-overview/audio-overview-shell-job.test.ts` -- mounted command/reload recovery passes.
- `pnpm exec eslint <changed durable-job files>` and `git diff --check` -- zero lint errors and no whitespace errors.
- `pnpm build` -- strict environment validation and production Nuxt build pass with local development credentials.
- `pnpm audio:workflow:dev` -- local Workflow starts and exposes its local inspector.

**Observed:** Focused app/Convex tests (73), Workflow tests (6), and mounted
component tests (2) pass. Worker typecheck, targeted lint, Convex code generation,
and the production Nuxt build pass. The app-wide `vue-tsc` gate remains red on
pre-existing repository-wide alias/dependency/type errors, including the existing
`#convex/api` and `@convex-vue/core` resolution failures; this slice does not claim
that broad gate as green.

## Suggested Review Order

1. Command and job authority: `server/api/audio-overview/generate.post.ts` and `convex/audioOverviewJobs.ts`.
2. Durable orchestration and duplicate delivery: `workers/audio-overview/src/index.ts`, `workers/audio-overview/src/orchestration.ts`, and `server/api/audio-overview/jobs/step.post.ts`.
3. Provider one-shot claims and upload verification: `server/utils/tts-provider.ts`, `server/utils/ai-gateway.ts`, and `convex/audioOverviewJobUploadActions.ts`.
4. User recovery and realtime behavior: `app/components/audio-overview/AudioOverviewShell.vue` and its mounted component tests.
5. Privacy and retention: `convex/accountDeletion.ts`, `convex/crons.ts`, and the cascade tests.
6. Production boundary: ADR 0003 and the unchecked deterministic-R2 follow-up above.
