# Technology and Brownfield Reality Review

**Target:** `ARCHITECTURE-SPINE.md`
**Review date:** 2026-09-20
**Reviewer:** GPT-5.6 architecture/reality pass
**Review intent:** validate named technology/version claims and pressure-test the spine against the current repository before implementation.

## Verdict

**Partial reflection; not implementation-ready yet.** The spine is a strong
architectural direction and its existing V2 authority/evidence conventions are
well aligned with the repository. The technology seed is mostly accurate, but
the artifact currently mixes verified brownfield facts with future contracts
that are not yet represented in schema, export/deletion registries, routes, or
operations. Several of those omissions allow separately built epics to make
incompatible choices. Resolve the P1 findings below before treating the spine
as the implementation contract.

## Technology reality

| Spine claim | Repository evidence | Result |
|---|---|---|
| Nuxt `^4.5.2`, Vue `^3.5.42`, TypeScript `^5.7.2` | `package.json:63,69,92`; lockfile resolves Nuxt 4.5.2, Vue 3.5.42, TypeScript 5.9.3 | **Accurate as package declarations.** The TypeScript value is a range, not the installed lockfile version; call this out if reproducibility matters. |
| Cloudflare Pages Nitro preset with Node compatibility | `nuxt.config.ts:41-45` (`cloudflare_pages`, `nodeCompat: true`) | **Accurate.** |
| Convex `1.45.0` | `package.json:57`; lockfile has `convex@1.45.0` | **Accurate.** Convex is the current authority boundary. |
| Better Auth `1.6.30`; `@convex-dev/better-auth ^0.12.5`; `tokenIdentifier` | `package.json:41,54`; `convex/auth.config.ts`; `convex/lib/learnV2Access.ts:49-53,61-71` | **Accurate.** The Better Auth package is patched in `package.json:114-116`; preserve that patch assumption in build/release docs. |
| Vitest `^4.1.11`, Playwright `^1.57.0`, `convex-test ^0.0.56` | `package.json:84,86,94`; worker packages separately use Vitest `^4.1.4` | **Accurate for the root app.** Worker test versions are different and should not be implied by the root seed. |
| Cloudflare AI Gateway/OpenRouter is server-only | Private runtime values are empty/publicly excluded in `nuxt.config.ts:92-119`; gateway adapter is server-side in `server/utils/ai-gateway.ts`; V2 actions also use provider fetches | **Directionally accurate.** The spine should name the application-owned adapter and canonical request contract; otherwise an epic may call the gateway directly from a Nitro route or Convex action with different policy/version fields. |
| R2 protected evidence | Existing document/source objects use S3-compatible R2 credentials and object keys (`convex/documentActions.ts:35-41`; `convex/learnV2Sources.ts:858-879`). Worker R2 bindings in `workers/audio-overview/wrangler.jsonc` are for audio artifacts, not Learn source evidence. | **Partially accurate.** Specify whether adaptive evidence uses the existing S3-compatible Convex path, a Worker binding, or both. Do not infer a new Worker R2 binding from the diagram. |
| Cloudflare Workers are an external boundary | `workers/audio-overview` and `workers/laya-evaluator` are real Worker deployments; their Wrangler versions/configuration are separate from Pages (`workers/*/package.json`, `wrangler.jsonc`) | **Accurate but underspecified.** The adaptive slice currently has no Worker route or binding. Keep Workers optional unless a named adaptive provider requires one. |
| `@opentelemetry/api ^1.9.1` is available | `package.json:48` | **Dependency only.** No tracer/exporter/instrumentation usage was found. Do not represent this as operational observability; semantic event rows are application-owned and still need an emission/readout plan. |

The deployment diagram is broadly compatible with `nuxt.config.ts` and the
existing `/api/learn-v2/**` guarded Nitro routes, but it should distinguish the
Pages/Nitro auth proxy from the Convex auth site. The repository's release
checklist also says to promote through Cloudflare Pages Git integration, while
the root `deploy` script invokes `wrangler@4.128.0`; the spine should name one
supported production path and make the other explicitly non-canonical.

## Findings that block implementation readiness

### P1 — Adaptive entitlement and gate are future-only, not a brownfield seam

AD-8 requires `users.learnAdaptiveExperienceEntitlement` and a conjunctive
V2-plus-adaptive gate on every adaptive query, mutation, action, job admission,
and route. Current `users` has only `learnV2Entitlement`
(`convex/schema.ts:5-22`), and the live access helper only checks
`LEARN_V2_ENABLED`, deletion tombstones, and V2 entitlement
(`convex/lib/learnV2Access.ts:40-53`). This is a valid new decision, but the
spine does not state the exact schema type, entitlement grant/revoke owner,
public status shape, Nitro wrapper behavior, or how adaptive rollback maps to
existing V2 navigation.

**Close by:** add a canonical gate contract (including default-deny parsing,
identity source, tombstone behavior, route status, and maintenance exceptions),
name the one grant/revoke command, and require an access matrix test before
any adaptive route or Convex function lands. Every epic must cite this gate,
not reimplement it.

### P1 — Export and account deletion are not closed over the required tables

AD-10 says every new table has explicit bounded export/deletion traversal, but
the required adaptive tables (`learningThreads`, activities, artifacts,
decisions, events, command receipts, and optional claims) are not in the
current export table union/dispatch (`convex/dataExport.ts:45-57,212-238,314-317`)
or the V2 deletion order (`convex/accountDeletion.ts:85-88`). The existing
V2 pattern is good: paginated owner export and child-before-parent deletion.
However, prose alone will let an epic add a table without updating both
registries, leaving retained learner data inaccessible or undeleted.

**Close by:** define a single adaptive table manifest (owner index, export
redaction policy, deletion order, and parent dependencies) that is consumed by
both export and deletion, or make the two registries mandatory acceptance
criteria with a compile/test assertion. Specify R2/object cleanup for artifacts
and evidence as well as Convex rows. Add a test that creates one row in every
adaptive table, exports it, starts deletion, and proves no owner-linked row or
object remains after completion.

### P1 — Mastery uniqueness is not enforceable as stated

AD-3 says `masteryRecords` has “exactly one” owner + blueprint revision +
objective projection and requires a three-part index with `.unique()`. The
current table has optional `blueprintRevisionId` and only separate indexes
(`convex/schema.ts:1349`); Convex indexes do not enforce uniqueness. A
check-then-insert/update race can still create duplicate projections. Legacy
unscoped rows are also present by design.

**Close by:** specify the migration and write protocol: a required canonical
key (for example a deterministic projection key or a dedicated ownership row),
how legacy rows are quarantined/read-only, and how concurrent creation is
serialized. Add a schema/index validator and a concurrency test. Do not claim
“exactly one” based on `.unique()` alone.

### P1 — Adaptive job ownership and dispatch table are ambiguous

AD-1 says jobs are leased/checkpointed/retried, while AD-5 says standalone
threads may not dispatch provider work until a V2 reference exists. The current
`learnJobs` table requires `learningVoidId` and has V2-specific expected
revision fields (`convex/schema.ts:1469`), and current cron recovery is
explicitly V2 job-type based (`convex/crons.ts:17-21`). The spine does not say
whether adaptive provider work reuses `learnJobs` after V2 admission, adds a
thread-aware job table, or introduces a new job type/cron/recovery handler.

**Close by:** choose one canonical job substrate and specify required foreign
keys, expected revisions, lease/checkpoint states, retry limits, ambiguous
outcome reconciliation, cron ownership, and deletion/export behavior. If
reusing `learnJobs`, state the legal `learningVoidId`/thread relationship and
how non-factual activities are prohibited from dispatch. If adding a table,
add it to the manifest in the preceding finding.

### P1 — Provider port is named, but the executable adapter contract is not

The repository already has separate server-side gateway code and V2 provider
actions; generated blueprint/session/mastery paths persist provider model and
request metadata. The spine's `JOB -> PORT` diagram and AD-9 correctly reject
direct client/provider behavior, but do not define the canonical port module,
request envelope, provider identity/model/policy version fields, response
schema validation, or the source of quota reservation. This is enough for two
epics to choose different gateway URLs, fallback rules, or timeout semantics.

**Close by:** name the shared port interface and the one admission/dispatch
owner. Require bounded input/output schemas, provider/model/policy IDs,
request digest, timeout, pre/post-dispatch outcome classes, quota reservation,
and reconciliation key. Explicitly decide whether adaptive providers use the
existing `server/utils/ai-gateway.ts` adapter or a Convex action port, and how
secrets are supplied in each runtime.

### P1 — Operational envelope has no numeric pilot limits or SLOs

The table has qualitative rules (“bounded queries/fanout”, “provider
timeouts”, “bounded retries”, “no implicit paid fallback”), but no timeout,
max attempts, lease duration, queue age, fanout/page size, payload/token/byte
limits, per-user/product quota, or alert threshold. Existing V2 code uses
concrete constants and five-minute cron recovery (`convex/crons.ts:17-21`), so
leaving the adaptive values open invites incompatible defaults per epic.

**Close by:** set Phase 0 pilot defaults and owner-visible thresholds, or mark
each value as a named deferred decision with a revisit gate. At minimum bind
provider timeout and max attempts, job lease/recovery cadence, query/page and
canvas bounds, daily/provider budget, and metrics definitions for ready versus
preparation latency. Separate synthetic/local proof from live quota/spend proof.

## Additional consistency risks

1. **Source representation fork.** AD-4 permits either existing V2
   `sessionContentClaims`/supports or new `learnActivityClaims`. That is a
   reasonable migration option, but it is a divergence point. Decide per
   activity class (or define one adapter) before Phase 1; otherwise each
   primitive can choose a different provenance path and deletion/invalidation
   semantics.
2. **Activity identity and replacement.** AD-1 mentions immutable
   `planRevision`, mutable `responseRevision`, and activity-plan replacement,
   but the required table list does not name the exact fields or a boundary
   identifier. Bind the activity identity, plan boundary, response revision,
   expected-revision CAS, and replacement relationship once so resume/history
   and event consumers agree.
3. **Event retention/PII.** AD-7 says telemetry omits raw learner answers and
   private evidence, while AD-10 requires bounded retention, but no event
   schema, payload allowlist, TTL/purge policy, or export redaction is fixed.
   Create the semantic event taxonomy/version contract and retention class as
   shared seed; `@opentelemetry/api` being installed is not a substitute.
4. **Source invalidation scope.** AD-6 says source deletion marks affected
   evidence unavailable while retaining attempts. Existing
   `learnV2Retention` has a concrete purge seam, but the adaptive spine does
   not state how activity plans, artifacts, cached fallbacks, and already
   emitted feedback are reclassified. Add the state transition and
   user-facing recovery behavior.
5. **Access maintenance exception.** AD-8 says export/deletion retain their
   established maintenance authority, but it should explicitly include source
   purge and pending external/R2 cleanup. Existing account deletion intentionally
   bypasses normal V2 access while tombstones deny new work
   (`convex/accountDeletion.ts:85-88`, `convex/lib/learnV2Access.ts:44-53`).
   Preserve that distinction for adaptive rows and provider cleanup.
6. **Version wording.** The seed uses caret ranges for Nuxt, Vue, TypeScript,
   Vitest, and Playwright. If the architecture is intended to be a reproducible
   contract, record package declaration plus lockfile resolution policy, and
   include the patched Better Auth/nuxt-convex packages. The current root and
   Worker Wrangler versions also differ; name the supported deployment tool per
   target.

## Verified strengths to preserve

- The existing V2 additive model is real: the schema labels V2 rows as
  deliberately additive and isolated (`convex/schema.ts:1328-1330`), matching
  AD-2.
- Identity derivation through Convex auth and `tokenIdentifier` is already
  implemented in the access boundary, matching AD-1 and the Convex project
  guidance.
- Existing V2 provider jobs already distinguish pre-dispatch retry from
  post-dispatch ambiguity and recover them on a cron, providing a concrete
  brownfield pattern for the adaptive job decision.
- Existing export redaction and child-before-parent deletion are mature seams;
  adaptive work should extend those seams rather than invent a parallel data
  lifecycle.
- The repository has a real semantic V2 source/evidence model and purge seam;
  AD-4/AD-6 can build on it if the optional claims fork is resolved explicitly.

## Required acceptance conditions for an implementation-ready spine

The spine is ready to hand to independently built epics when it has, either as
ADs or explicitly inherited contracts:

1. the adaptive gate and entitlement schema/route contract;
2. one adaptive job substrate and provider-port interface;
3. a mastery projection uniqueness/migration protocol;
4. a shared adaptive table manifest covering schema indexes, export, deletion,
   object cleanup, and source invalidation;
5. numeric pilot bounds and failure/reconciliation states; and
6. one canonical activity claims/provenance representation, activity identity,
   event payload/retention contract, and replacement/resume semantics.

Until those are fixed, the document is a useful direction and mostly faithful
technology snapshot, but only a **partial** reflection of the plan and current
implementation reality.
