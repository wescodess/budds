---
stepsCompleted: ['step-01-load-context', 'step-02-define-thresholds', 'step-03-gather-evidence', 'step-04-evaluate-and-score', 'step-04e-aggregate-nfr', 'step-05-generate-report']
lastStep: 'step-05-generate-report'
lastSaved: '2026-09-05'
workflowType: 'testarch-nfr-assess'
inputDocuments:
  - _bmad/tea/config.yaml
  - convex/_generated/ai/guidelines.md
  - _bmad-output/project-context.md
  - _bmad-output/planning-artifacts/prd-learn-module.md
  - _bmad-output/planning-artifacts/architecture-learn-module.md
  - _bmad-output/implementation-artifacts/spec-audio-overview-v2.md
  - _bmad-output/implementation-artifacts/spec-durable-audio-overview-job.md
  - _bmad-output/test-artifacts/test-design-architecture.md
  - _bmad-output/test-artifacts/test-design-progress.md
  - _bmad-output/test-artifacts/test-design-qa.md
  - docs/qa/test-plan.md
  - docs/qa/known-limitations.md
  - docs/qa/deployment-guide.md
  - .agents/skills/bmad-testarch-nfr/resources/knowledge/adr-quality-readiness-checklist.md
  - .agents/skills/bmad-testarch-nfr/resources/knowledge/ci-burn-in.md
  - .agents/skills/bmad-testarch-nfr/resources/knowledge/test-quality.md
  - .agents/skills/bmad-testarch-nfr/resources/knowledge/playwright-config.md
  - .agents/skills/bmad-testarch-nfr/resources/knowledge/error-handling.md
---

# NFR Assessment - Budds Production Readiness

**Date:** 2026-09-05
**Scope:** Repository-wide production readiness, with focused treatment of the in-progress Audio Overview v2 production path
**Mode:** Create
**Overall Status:** **FAIL - production release blocked**

> This is an evidence assessment. Local and synthetic evidence will be kept separate from deployed, authenticated, and real-provider evidence. The current dirty worktree is protected baseline work; this workflow will not modify application code or perform cleanup.

## Step 1 - Context and evidence sources

### Requirements loaded

- Product NFRs: 29 Learn-module requirements covering performance, security, scalability, accessibility, integration, and reliability.
- Audio Overview production contract: gates G1-G11, with G1-G10 required and owner acceptance required for G11.
- Architecture and deployment requirements: Nuxt/Convex/Cloudflare topology, provider dependencies, environment contracts, rollback procedures, and post-deployment checks.
- Test architecture: risk-based P0-P2 coverage plans and the 29-criterion ADR quality-readiness rubric.

### Evidence availability

- Implementation: available locally, including Convex, Nitro/server routes, Vue UI, and the standalone Audio Overview Worker.
- Tests and test configuration: available locally for root Vitest, component suites, Convex tests, and Worker tests.
- CI definitions: unavailable. The repository has `.github/ISSUE_TEMPLATE/bug_report.md` but no `.github/workflows/` directory, so there is no repository-hosted CI evidence to gather.
- Deployment and operational guidance: available in `docs/qa/`.
- Production metrics, uptime history, incident history, load-test results, restore-drill evidence, and current deployed probes: not yet established and therefore remain `Unknown` until evidence is gathered.
- Browser automation configuration: `chrome-mcp`; this runtime will use the product-native T3 preview browser if deployed or local browser checks become necessary and available.

### Freshness warning

The April project context and test-design artifacts contain statements that are visibly older than the current implementation (for example, that no test framework or CI exists). They are requirements/history sources, not current-state proof. Current repository evidence takes precedence during scoring.

## Step 2 - NFR categories and thresholds

| Category | Evidence-backed release threshold |
| --- | --- |
| 1. Testability & Automation | P0 tests: 100% pass; P1 tests: at least 95% pass; no open high-priority defect; tests deterministic, isolated, explicit, self-cleaning, parallel-safe, under 300 lines and normally under 90 seconds; component tests and all relevant repository-native gates must actually run in CI. |
| 2. Test Data Strategy | Zero cross-user contamination; synthetic/local fixtures must not pollute production data or production metrics; destructive flows require deterministic teardown or verified product cleanup. No numeric completeness threshold is defined. |
| 3. Scalability & Availability | At least 100 concurrent section generations without exceeding documented latency targets; at least 1,000 review items per user without degradation; per-user/per-course cost tracking; queued TTS generation. Availability percentage/SLA is **UNKNOWN**. |
| 4. Disaster Recovery | Frontend and backend rollback procedures must be executable; schema changes must follow backward-compatible expand/migrate/contract sequencing. RTO, RPO, failover objective, immutable-backup policy, and restore-drill cadence are **UNKNOWN**. |
| 5. Security | Zero cross-user access to owned courses, sources, generations, media, reviews, or calendar records; identity derived server-side; calendar/provider tokens remain server-only; secrets absent from source/client bundles/log evidence; input validators on exposed functions/routes; offline cached Learn content encrypted at rest. Vulnerability-count threshold is **UNKNOWN**. |
| 6. Monitorability, Debuggability & Manageability | Audio G10 requires cost telemetry and deployed probes; course generation cost must be tracked per user/course from launch; failures must be attributable across Pages, Convex, Workflow, R2, AI Search, AI Gateway, Workers AI, Gemini, and Google APIs. Numeric RED-metric, trace-coverage, retention, and alert thresholds are **UNKNOWN**. |
| 7. QoS & QoE | Document outline: <=15 s; web outline: <=20 s; JIT section: <=30 s plus <=30 s for audio; pre-fetched section and course/dashboard render: <500 ms; review load: <2 s for 50 items; offline load: <2 s; Learn navigation: <300 ms; failures must show actionable UI and individual engine failures must not block remaining section formats. General API p95/p99 and rate-limit thresholds are **UNKNOWN** outside explicitly bounded workflows. |
| 8. Deployability | Audio G1-G10 pass and owner accepts G11; strict environment validation, Worker/Pages/Convex tests, typechecks, lint, build, CI, deployed probes, and owner-triggered real generation pass; no paid provider calls in CI; v1/v2 compatibility and rollback path verified. Automated rollback-trigger threshold is **UNKNOWN**. |
| 9. Accessibility (product-specific) | WCAG 2.1 AA across Learn interfaces; keyboard navigation, screen-reader support, contrast and focus indicators; transcripts for audio; keyboard recall ratings; text alternatives for progress visuals; zero critical/serious automated accessibility violations at the release gate. |
| 10. AI and Audio Quality (product-specific) | Audio G3-G5 and G11: exact managed renderer contract, fail-closed grounding, bounded scene regeneration, measured quality evidence, and owner-accepted blind bake-off across three representative source sets. Configuration evidence is not acoustic proof. |

### Threshold gaps carried into scoring

- Availability/SLA, production p95/p99 for general APIs, error-rate objective, MTTR, RTO, RPO, failover and restore objectives.
- Monitoring coverage, log/trace retention, alert thresholds, and operational ownership/escalation times.
- Maximum accepted critical/high dependency vulnerabilities and remediation SLA.
- A quantified production load profile for chat, ingestion, RAG/search, upload, export, deletion, realtime subscriptions, and Audio Overview concurrency.

## Step 3 - Evidence gathered

### Fresh repository gate evidence

All commands below were run read-only against branch `feat/audio-overview-hardening` at `6f2964c58c98427f2de0ee3480a6862b96621c9b`. They validate the current checkout only; they do not prove the deployed production environment.

| Evidence | Result | Interpretation |
| --- | --- | --- |
| `pnpm test` | **PASS**: 62 files; 936 passed, 8 skipped; two negative-timeout runtime warnings | Broad unit/Convex coverage is healthy, but the warnings and skipped tests keep this from being a clean release gate. |
| `pnpm --dir workers/audio-overview test` | **PASS**: 7 files; 57 tests | Current Worker logic passes its local suite. |
| `pnpm --dir workers/audio-overview typecheck` | **PASS** | Worker TypeScript is clean in isolation. |
| `pnpm test:component:audio` | **PASS**: 10 files; 38 tests | The focused Audio Overview mounted suite is green. |
| `pnpm test:component` | **FAIL**: 8 files failed; 19 tests failed, 446 passed, 85 skipped; 3 unhandled errors | The general mounted-component gate is red. Failures include missing Convex injection/URL and Nuxt/RouterLink mounting integration; the focused audio config masks broader integration defects. |
| `pnpm typecheck` | **FAIL**: 63 errors across 21 files | The repository does not currently satisfy its TypeScript gate. Errors span dependency/subpath resolution and application model/API mismatches. |
| `pnpm lint` | Exit 0 with **1,095 warnings** across 233 files, 0 errors | Lint is non-blocking and is not a clean maintainability signal; warnings include extensive explicit `any` and unused code. |
| `pnpm build` | **FAIL** during strict environment validation | The local checkout cannot prove a production build because the Audio Overview job secret and Worker launch token are absent. No secret values were requested or exposed. |
| `pnpm audit --prod --json` | **FAIL**: 135 advisories across 1,570 dependencies: 5 critical, 50 high, 65 moderate, 15 low | This is a current registry finding and a release concern. Reachability and exploitability remain untriaged; even packages with dev-oriented names may be present in the production dependency graph. Critical names reported: `@nuxt/devtools`, `better-auth`, `seroval`, `shell-quote`, `tar`. |
| Current-tree secret-pattern scan | No matching tracked/source paths in the bounded scan | Useful negative evidence for the current tree only; it is not a Git-history scan, provider-side secret scan, or rotation proof. |
| `git diff --check` | **PASS** | No whitespace-error evidence in the existing worktree diff. |

### Category evidence inventory

| Category | Available evidence | Missing evidence / gap status |
| --- | --- | --- |
| Performance and scalability | Product latency targets exist; local suites complete in seconds; Worker has explicit cost/quality structures. Static inspection found 69 `.collect()` calls across 14 non-test Convex modules, including high-volume quiz, course, export, folder, and flashcard paths. | **CONCERNS**: no production latency metrics, load/stress/soak tests, subscription-payload measurements, provider throughput evidence, or proof of the 100-concurrent-generation and 1,000-review-item targets. Every `.collect()` site requires boundedness review; the count alone does not establish a defect. |
| Security and privacy | Root auth/ownership tests are included in the passing local suite; server-side environment validation distinguishes secrets; a bounded current-tree secret scan found no matches. | **CONCERNS**: dependency audit is red; no DAST, penetration test, client-bundle secret proof, history scan, SBOM, dependency reachability triage, token/storage inspection, or deployed cross-user authorization run is available. Offline Learn encryption evidence is not established. |
| Reliability and data integrity | Root and Worker suites pass locally; docs specify retry, cleanup, rollback, and post-deployment checks. Independent static review identified a concrete false-success path: `convex/documentActions.ts:297-320` returns success when R2/AI Search configuration is absent, while `convex/accountDeletion.ts:391-469` can mark/delete the cleanup record. The same review found exhausted cleanup rows are skipped without a rescue/alert cron (`convex/crons.ts:6-10`), contradicting `docs/qa/known-limitations.md:106-109`. It also found missed calendar events are marked before provider work (`convex/calendarEvents.ts:152-180`) and provider failures only continue/log (`convex/calendarEvents.ts:208-377`), leaving no scheduled record for retry. | **CONCERNS**: no burn-in, chaos/failover test, backup restore drill, incident/error-rate history, idempotency proof under real failures, or deployed cron evidence. The independent agent hit its usage limit after returning these findings, so the findings were locally source-verified but did not receive a completed second-pass report. |
| Maintainability and testability | Substantial current unit coverage exists; focused Worker and Audio Overview suites are green; QA documentation identifies known gaps. | **CONCERNS**: repository typecheck and general component suite fail, lint emits 1,095 warnings, no coverage threshold is enforced, and nine Convex modules plus nine server routes are documented as untested (`docs/qa/test-plan.md:112-147`). There is no E2E suite or CI pipeline. |
| Monitorability and manageability | Cloudflare Worker observability is enabled in `workers/audio-overview/wrangler.jsonc:7`; Audio Overview captures quality/cost evidence structures. | **CONCERNS**: no repository evidence of end-to-end trace propagation, correlation IDs, RED dashboards, Sentry/error aggregation, alert rules, retention policy, on-call ownership, deployed probes, or actual provider-cost reconciliation. |
| Disaster recovery and deployability | Written frontend/backend rollback and post-deployment checks exist in `docs/qa/deployment-guide.md`; strict build-time environment checks block missing Audio Overview secrets. | **CONCERNS**: build is currently blocked locally, CI is absent, and no executed rollback, restore drill, RTO/RPO, production backup inventory, migration rollback proof, or production probe result is available. |
| Accessibility and UX quality | Product requirements call for WCAG 2.1 AA, keyboard support, transcripts, and text alternatives. | **CONCERNS**: no automated accessibility suite, cross-browser E2E evidence, manual assistive-technology record, or deployed performance/interaction evidence is available. |
| AI and audio quality | Local G1-G4 and G6-G8 evidence is documented; focused audio component and Worker suites pass. | **CONCERNS**: the project QA ledger still records G5 FAIL, G9 PARTIAL, G10 FAIL, and G11 FAIL (`docs/qa/test-plan.md:92-110`). No authenticated owner-triggered ready run, cost reconciliation, deployed probe, or blind three-source-set acoustic acceptance is available. |

### Browser and production evidence boundary

`tea_browser_automation` is configured as `chrome-mcp`, not `cli` or `auto`, so the Step 3 browser procedure is not mandatory. A collaborative preview was made available, but the repository exposes only a local `SITE_URL` and no verified production target. No local stack or external provider run was started because that would not prove production and could mutate shared Convex/provider state. Consequently, deployed page performance, authenticated flows, production API behavior, and real-provider audio remain **Unknown**.

## Step 4 - Domain scoring and aggregation

**Execution:** SUBAGENT (4 NFR domains), capability-probed from `tea_execution_mode: auto`. All four isolated JSON handoffs were present and schema-checked before aggregation. Parallel scheduling was used; exact speedup was not measured.

### Risk breakdown

| Domain | Risk | Dominant evidence |
| --- | --- | --- |
| Security | **HIGH** | Unauthenticated caller-scoped R2 debug route; browser-callable Base64-encoded Google OAuth tokens; unencrypted offline Learn data; 5 critical and 50 high dependency advisories; partial instance-local rate limiting. |
| Performance | **HIGH** | No measured proof for any production latency target; no load/stress/soak evidence; review backlog count capped at 500; 69 production `.collect()` calls need boundedness decisions; no resource/cost reconciliation. |
| Reliability | **HIGH** | External cleanup can fail open; exhausted cleanup has no dead-letter rescue; calendar provider failures are not retried; course deletion does not cascade to calendar cleanup; review persistence failures are swallowed; recovery and deployed monitoring proof are absent. |
| Scalability | **HIGH** | The 100-concurrent-generation target is unproven; 1,000-item backlog compliance fails; long-running section generation is client-triggered rather than queue-consumed; rate limits are process-local; per-course cost accounting is absent. |

**Overall risk: HIGH.** Any single HIGH domain makes the aggregate HIGH; all four domains are HIGH.

### Cross-domain risks

| Impact | Domains | Risk |
| --- | --- | --- |
| **CRITICAL** | Security + Reliability | External-data handling can expose storage metadata while destructive cleanup can report completion when provider configuration is absent. |
| **CRITICAL** | Security + Reliability + Scalability | Missing distributed telemetry, alerts, durable admission control, and dead-letter recovery prevents safe detection and containment of overload/provider failures. |
| **CRITICAL** | Security + Reliability | Browser-accessible OAuth tokens, unencrypted offline content, and swallowed review persistence failures create combined confidentiality and data-integrity risk. |
| **HIGH** | Performance + Scalability | Unproven latency, potentially unbounded reads, client-triggered long work, and instance-local limiting can compound under load. |
| **HIGH** | All four | Red typecheck/component/build/dependency gates plus absent CI mean domain controls are not continuously enforced. |

### Compliance and requirement summary

- **FAIL:** G10 Operations; NFR28 calendar consistency; NFR29 SM-2 interval accuracy; external-data cleanup integrity; 1,000 review items per user; per-user/per-course cost tracking.
- **PARTIAL/CONCERN:** GDPR readiness, queued audio TTS, 99.9% SLA readiness, NFR26 progress durability, NFR27 offline attempt durability, and Audio Workflow production durability.
- **UNKNOWN:** SOC 2, HIPAA, PCI-DSS, ISO 27001; general Learn latency targets; the 100-concurrent-generation target; production availability and recovery objectives. `UNKNOWN` is not a pass and no certification is claimed.

### Aggregated decision frontier

The first cleanup frontier is release-blocking correctness and exposure, not cosmetic code cleanup:

1. Remove or production-disable `/api/debug/testR2`; require verified server-derived identity for every storage operation.
2. Make Google OAuth tokens internal-only, encrypt them with managed keys, migrate existing rows, and rotate exposed refresh tokens.
3. Make R2/AI Search deletion fail closed; preserve cleanup work, add dead-letter/rescue/alerting, and prove replay.
4. Replace calendar mark-before-provider behavior with an idempotent retryable state machine; cascade course deletion through durable local and Google cleanup.
5. Stop swallowing SM-2 writes; durably queue failed submissions and surface unpersisted completion state.
6. Triage and remediate the 5 critical and 50 high production dependency advisories with reachability evidence and time-bounded exceptions only.
7. Restore clean repository gates: typecheck, full component suite, build with a safe secret-bearing environment, lint policy, and then mandatory CI.
8. Add distributed rate/admission controls, generation queues, per-course cost accounting, production-like load tests, and correlated operational telemetry.

## Final NFR assessment

### Executive summary

**Assessment:** 5 PASS, 10 CONCERNS, 14 FAIL across the 29 ADR quality-readiness criteria.

**Release blockers:** 7 immediate blocker groups: storage debug exposure, OAuth-token protection, external-cleanup integrity, calendar consistency, review-write durability, critical/high dependency advisories, and red/absent release gates.

**Recommendation:** Do not promote this checkout to production and do not grant a waiver as a single bundle. Resolve the P0 exposure and data-integrity failures first, restore a clean automated gate, then gather deployed security, load, recovery, accessibility, and real-provider Audio Overview evidence. Re-run this assessment before a release decision.

### Performance and scalability assessment

| Area | Status | Threshold | Actual evidence | Required remediation |
| --- | --- | --- | --- | --- |
| Named workflow latency | **CONCERNS** | Outline <=15/20 s; section <=30 s plus audio <=30 s; cached/dashboard <500 ms; review/offline <2 s; navigation <300 ms | No deployed or production-like p50/p95/p99 evidence | Instrument named workflows and run authenticated cold/warm browser and API measurements. |
| Throughput | **FAIL** | 100 concurrent section generations without threshold degradation | No load, stress, soak, provider-throttle, or queue-depth evidence | Define a representative load model and pass a 100-concurrent burst plus sustained soak. |
| Review data scale | **FAIL** | At least 1,000 review items per user without degradation | `getReviewBacklogCount` reads only 500 rows; no 1,000-item test | Replace the truncated count contract and test scheduling/session loading at realistic cardinality. |
| Query boundedness | **CONCERNS** | Production reads bounded by indexed `take`/pagination or a proven domain maximum | 69 `.collect()` calls across 14 non-test Convex modules | Classify every site, document bounded exceptions, paginate/batch the rest, and measure subscription payloads. |
| Resource and cost usage | **CONCERNS** | Per-user/per-course cost tracking; provider and platform resource budgets | Audio has job-scoped budget evidence; course-wide cost, CPU, memory, transfer, and billing reconciliation are absent | Add a course cost ledger, resource baselines, budgets, and alerts. |
| Traffic handling | **FAIL** | Durable queues and authoritative distributed abuse/admission control | Ordinary section generation is client-triggered HTTP; limiter is a process-local `Map`; no global audio concurrency policy | Queue long work, add shared atomic rate/admission control, backpressure, retry and dead-letter policy. |

### Security assessment

| Area | Status | Evidence | Required remediation |
| --- | --- | --- | --- |
| Authentication | **CONCERNS** | Google OAuth/Better Auth and server-derived Convex identities exist; no deployed session/revocation/MFA decision evidence | Run deployed session tests and document revocation, lifetime, reauthentication, and MFA scope. |
| Authorization and API security | **FAIL** | `server/api/debug/testR2.post.ts:4-36` accepts caller `userId`/`folderId`, does not require authentication, and reads R2 keys with server credentials | Remove or hard-disable the route outside local development; derive identity server-side; audit deployed access logs if the route has ever been reachable. |
| Data protection | **FAIL** | Calendar tokens are Base64-encoded and `convex/calendarConnections.ts:144-159` returns both tokens through a public authenticated query; offline data is stored directly in IndexedDB/Cache API | Make token operations internal-only, encrypt with managed keys, migrate and rotate; encrypt offline data with explicit logout/account-deletion key lifecycle. |
| Input validation | **CONCERNS** | Convex validators and bounded Audio inputs exist, but several Nitro routes accept weakly typed/unbounded bodies | Add shared runtime schemas and negative/oversized/injection tests for every public handler. |
| Secrets management | **CONCERNS** | Environment validation and current-tree negative scan exist | Add history/provider scans, credential inventory, rotation SLAs, least-privilege review, bundle/log redaction proof, and CI secret scanning. |
| Software supply chain | **FAIL** | Current production audit: 5 critical, 50 high, 65 moderate, 15 low advisories | Establish reachability, upgrade/remove affected packages, create an SBOM, and allow only narrow expiring exceptions. |
| Compliance | **CONCERNS** | GDPR is partial; SOC 2, HIPAA, PCI-DSS and ISO 27001 are unknown, not passed | Establish applicability and control evidence; reconcile privacy/deletion documentation with every processor and storage surface. |

### Reliability and disaster-recovery assessment

| Area | Status | Evidence | Required remediation |
| --- | --- | --- | --- |
| External deletion integrity | **FAIL** | Missing R2/AI Search configuration returns `ok: true`; the pending record and artifact state can then be removed/marked deleted | Fail closed, preserve work, distinguish not-configured/not-found/deleted, add replayable dead-letter state and tests. |
| Cleanup exhaustion | **FAIL** | Rows at 10 attempts are skipped; no cleanup rescue/alert cron exists although the limitation doc claims one | Add periodic bounded rescue, terminal status, alert, manual replay and documented ownership. |
| Calendar consistency | **FAIL** | Events are marked missed before Google work; refresh/create failures only log/continue; course deletion does not invoke durable calendar cleanup | Implement an idempotent outbox/state machine and durable course-calendar cascade covering provider deletion. |
| Review persistence | **FAIL** | `review.vue:106-148` advances and shows completion after SM-2/session mutation failure without using the offline queue | Queue failed writes durably, retry idempotently, and surface unsynced state; test restart and duplicate replay. |
| Audio Workflow fault tolerance | **PASS** | Local durable step retries, bounded reconciliation, cancellation cleanup, failure recording, and 57 passing Worker tests | Preserve these controls; validate failure injection and terminal cleanup in a deployed owner-triggered run. |
| Availability/error rate/MTTR | **CONCERNS** | Targets and measured production history are unknown | Define SLO/error budget/MTTR targets and retain uptime, incident, and recovery evidence. |
| CI burn-in | **FAIL** | No CI exists; local component/typecheck/build gates are red or blocked | Create mandatory CI only after making the full gate clean; then run repeated burn-in with unexpected stderr treated as failure. |
| DR | **FAIL** | Rollback instructions exist, but RTO/RPO, backup inventory, restore drill and failover proof do not | Define RTO/RPO and run recorded rollback/restore/provider-failure drills. |

### Maintainability assessment

| Area | Status | Actual evidence | Required remediation |
| --- | --- | --- | --- |
| Test coverage | **CONCERNS** | 936 root tests and focused suites pass, but no coverage percentage/threshold; nine Convex modules and nine server routes are documented untested | Generate coverage, set risk-weighted thresholds, cover high-risk routes/crons, and add E2E. |
| Code quality | **FAIL** | 63 type errors across 21 files; 19 general component failures; 1,095 lint warnings | Fix correctness/toolchain errors first, then component mounting/injection failures, then ratchet warning budgets. |
| Technical debt | **CONCERNS** | No duplication/debt metric; unbounded-query candidates and red gates provide concrete debt signals | Baseline debt/duplication, assign ownership, and prevent new debt in CI. |
| Documentation | **CONCERNS** | Useful deployment/QA docs exist, but at least the cleanup-cron claim conflicts with code and older test-design artifacts are stale | Correct known inaccuracies and add freshness/owner markers to operational docs. |
| Test quality | **FAIL** | Full component suite has 3 unhandled errors; passing Convex runs emit transaction/timeout warnings; no independent test-review report | Eliminate unexpected stderr/unhandled errors, add failure-injection and mounted E2E coverage, then run `bmad-testarch-test-review`. |

### Custom NFR assessments

| NFR | Status | Evidence | Release requirement |
| --- | --- | --- | --- |
| Accessibility | **FAIL** | WCAG 2.1 AA requirements exist; no automated scan, assistive-technology record, keyboard matrix, or cross-browser E2E proof | Pass zero-critical/serious automation plus manual keyboard, screen-reader, contrast, focus, transcript and text-alternative checks. |
| AI and Audio quality | **FAIL** | Local Worker/audio suites pass, but G5, G10 and G11 fail and G9 is partial | Complete authenticated create-through-interject, cost reconciliation, deployed probes, measured acoustic evidence and owner-accepted three-source blind bake-off. |
| Deployability | **FAIL** | Strict environment validation works, but local build is blocked, full gates are red, CI absent and rollback unpracticed | Pass the complete secret-bearing release gate without exposing secrets, then deployed smoke/probe/rollback checks. |

## Quick wins

1. **Production-disable `/api/debug/testR2`** - Security - CRITICAL - 0.5 day - Backend
   - Delete the route or guard it with a fail-closed development-only condition and server-derived identity; add an unauthenticated regression test.
2. **Make cleanup dependencies build-blocking** - Reliability/Security - CRITICAL - 0.5-1 day - Backend/Ops
   - Align environment validation with destructive cleanup so missing R2/AI Search configuration cannot be interpreted as deletion success.
3. **Correct the cleanup-cron documentation** - Reliability - HIGH - <0.5 day - Tech writer/Backend
   - Remove the claim that pending external cleanup is retried hourly until the actual rescue cron exists.
4. **Surface failed review persistence** - Reliability/UX - HIGH - 0.5-1 day for the visible-state guard - Frontend
   - Stop presenting unqualified completion when either mutation fails; the durable offline-queue implementation remains a larger follow-up.

## Recommended actions

### Immediate - before any production promotion

1. **Close storage and token exposure paths** - CRITICAL - 3-6 days - Backend/Security/Ops
   - Remove the R2 debug surface; internalize and encrypt calendar tokens; migrate existing records and rotate refresh tokens.
   - Validation: unauthenticated/two-user tests fail closed, client bundle/API cannot retrieve provider tokens, migration rollback is tested, and rotated tokens work only server-side.
2. **Repair destructive cleanup semantics** - CRITICAL - 2-4 days - Backend/Ops
   - Fail closed on missing config, retain retryable rows, add terminal/dead-letter state, rescue cron, alerts and manual replay.
   - Validation: injected missing-config, 404, 429, 5xx, timeout and exhausted-retry cases preserve correct state and complete exactly once after recovery.
3. **Make calendar lifecycle durable** - CRITICAL - 3-5 days - Backend
   - Use an idempotent outbox/state machine for rescheduling and deletion; wire course deletion to local and Google cleanup.
   - Validation: token refresh/provider failures retry without duplicate events; course deletion eventually removes both stores or exposes actionable terminal state.
4. **Protect SM-2 writes** - CRITICAL - 1-3 days - Frontend/Backend
   - Route failed review/session mutations into the existing durable offline mechanism and show unsynced state.
   - Validation: offline, rejected mutation, refresh/restart and duplicate replay tests yield one persisted rating and accurate intervals.
5. **Triage the production dependency graph** - CRITICAL - 1-3 days for triage; upgrades separately estimated - Security/Platform
   - Resolve reachability and upgrade paths for every critical/high advisory; generate SBOM and expiring exception records.
   - Validation: mandatory audit policy passes or each remaining exception proves non-reachability, owner and expiry.
6. **Restore a clean release gate** - CRITICAL - 3-7 days - Full-stack/QA
   - Clear typecheck errors, general component failures/unhandled errors, unexpected test stderr and build validation in an approved secret-bearing environment; define a lint-warning ratchet.
   - Validation: one documented command set passes twice from clean installs before CI is made mandatory.

### Short term - next release candidate

1. **Add mandatory CI and burn-in** - HIGH - 2-4 days - Platform/QA
   - Run install, audit/secret scan, typecheck, lint budget, root/Worker/component tests, build, coverage and artifact retention; forbid paid provider calls.
2. **Add shared admission control and durable generation queues** - HIGH - 5-10 days - Backend/Platform
   - Replace process-local limits; queue course/audio work with per-tenant/global budgets, backpressure, age/depth metrics and dead letters.
3. **Instrument the production path** - HIGH - 4-7 days - Platform/Backend
   - Correlate Pages, Convex, Workflow, R2, AI Search, AI providers and Google APIs; emit RED and cost metrics with actionable alerts.
4. **Run production-like assurance suites** - HIGH - 3-6 days - QA/Performance/Security
   - Execute 100-concurrent load/soak, 1,000-review-item performance, DAST/two-user auth, security headers, accessibility and cross-browser flows.

### Longer-term governance

1. **Establish SLO and recovery governance** - MEDIUM - 3-5 days plus drills - Product/Ops
   - Set availability, error budget, p95/p99, MTTR, RTO/RPO, backup/restore cadence and incident ownership.
2. **Complete Audio Overview evidence** - HIGH - provider-dependent - Owner/QA/Audio engineering
   - Run deployed probes, authenticated real generation, cost reconciliation, create-through-interject and blind three-source listening acceptance.
3. **Ratchet query and maintainability debt** - MEDIUM - incremental - Backend/QA
   - Resolve the 69 `.collect()` candidates by domain cardinality and enforce coverage, duplication and warning budgets without a destabilizing bulk rewrite.

## Monitoring hooks

- [ ] **External cleanup:** queue depth, oldest age, retries, terminal failures and replay result; alert on any terminal row or oldest age >1 hour. Owner: Backend/Ops. Deadline: before production re-review.
- [ ] **Calendar:** refresh/create/delete failure rates, pending age and duplicate-event detection; alert on any terminal failure or 3 failures for one user in 15 minutes. Owner: Backend/Ops. Deadline: before production re-review.
- [ ] **Generation RED/cost:** request rate, errors, duration, queue wait/depth, provider 429/5xx, token/audio/storage cost per user/course. Owner: Platform/AI. Deadline: before load testing.
- [ ] **Security:** audit access to storage/admin/debug routes, dependency/secret scan deltas and token-rotation failures. Owner: Security/Platform. Deadline: before CI becomes required.
- [ ] **Client durability:** unsynced review-attempt count/age and replay conflicts, without logging study content or tokens. Owner: Frontend/Backend. Deadline: before offline acceptance.
- [ ] **Availability:** authenticated synthetic probes for login landing, Convex read, source-to-chat and private audio range access. Owner: QA/Ops. Deadline: before release candidate.

## Fail-fast mechanisms

- [ ] Missing R2/AI Search deletion configuration returns a typed failure and never advances deletion state. Owner: Backend. Effort: 0.5-1 day.
- [ ] Shared rate/admission limits reject overload with explicit retry metadata before paid/provider work starts. Owner: Platform. Effort: 3-5 days.
- [ ] Runtime schemas reject caller identity, oversized histories, invalid counts/ranges and malformed identifiers at every public route. Owner: Backend/Security. Effort: 2-4 days.
- [ ] CI blocks on critical/high dependency policy, secret detection, typecheck, component unhandled errors, build failure and unexpected test stderr. Owner: Platform/QA. Effort: 2-4 days after gate fixes.
- [ ] Post-deploy smoke failures stop promotion and initiate the practiced rollback procedure. Owner: Ops. Effort: 2-3 days plus drill.

## Evidence gaps

| Gap | Owner | Deadline | Required evidence | Impact |
| --- | --- | --- | --- | --- |
| Verified deployed target and authenticated smoke matrix | QA/Ops | Before release candidate | Recorded login, Convex, upload, chat, calendar and audio probe results | Cannot establish production behavior. |
| Named-workflow latency and 100-concurrent load/soak | Performance/Backend | Before scalability sign-off | Reproducible scripts plus p50/p95/p99, errors, saturation and queue metrics | Performance/scalability targets remain unproven. |
| 1,000-review-item dataset | QA/Backend | Before scalability sign-off | Session/backlog/scheduling timings and correctness assertions | NFR13 currently fails. |
| Security assurance | Security | Before production re-review | DAST, two-user authorization matrix, headers/CORS, client-bundle and Git-history/provider secret scans | Exposure and authorization risks remain uncertain. |
| Coverage and independent test review | QA | Before CI gate approval | Coverage report and `bmad-testarch-test-review` findings | Risk-weighted test sufficiency is unknown. |
| Uptime/error/MTTR/SLO history | Product/Ops | Before availability commitment | Approved SLO/error budget and retained production measurements | No defensible SLA claim. |
| Backup, restore, failover and rollback drill | Ops/Backend | Before DR sign-off | Inventory, RTO/RPO and timestamped successful drill record | Recovery capability is unproven. |
| Accessibility | QA/UX | Before release candidate | Automated WCAG report plus keyboard/screen-reader/cross-browser checklist | WCAG 2.1 AA is unproven. |
| Actual generation cost and resource usage | Platform/AI | Before scale approval | Per-course ledger and reconciled provider invoice/resource metrics | Unit economics and budget enforcement are unknown. |
| Audio production acceptance | Owner/Audio QA | Before Audio Overview launch | Ready-state generation, G9/G10 evidence, measured acoustics and accepted blind bake-off | G5/G9/G10/G11 remain incomplete. |

## ADR quality-readiness score

| Category | Criteria met | PASS | CONCERNS | FAIL | Overall |
| --- | ---: | ---: | ---: | ---: | --- |
| 1. Testability & Automation | 3/4 | 3 | 1 | 0 | **CONCERNS** |
| 2. Test Data Strategy | 2/3 | 2 | 0 | 1 | **FAIL** |
| 3. Scalability & Availability | 0/4 | 0 | 3 | 1 | **FAIL** |
| 4. Disaster Recovery | 0/3 | 0 | 0 | 3 | **FAIL** |
| 5. Security | 0/4 | 0 | 1 | 3 | **FAIL** |
| 6. Monitorability, Debuggability & Manageability | 0/4 | 0 | 1 | 3 | **FAIL** |
| 7. QoS & QoE | 0/4 | 0 | 2 | 2 | **FAIL** |
| 8. Deployability | 0/3 | 0 | 2 | 1 | **FAIL** |
| **Total** | **5/29 (17%)** | **5** | **10** | **14** | **FAIL - significant gaps** |

Scoring uses evidence only. A criterion is “met” only when it is PASS; missing critical release evidence is FAIL, while an unknown numeric threshold without a contradictory implementation is CONCERNS.

## Gate YAML snippet

```yaml
nfr_assessment:
  date: '2026-09-05'
  story_id: null
  feature_name: 'Budds production readiness and Audio Overview v2'
  adr_checklist_score: '5/29'
  domain_risk:
    security: 'HIGH'
    performance: 'HIGH'
    reliability: 'HIGH'
    scalability: 'HIGH'
  categories:
    testability_automation: 'CONCERNS'
    test_data_strategy: 'FAIL'
    scalability_availability: 'FAIL'
    disaster_recovery: 'FAIL'
    security: 'FAIL'
    monitorability: 'FAIL'
    qos_qoe: 'FAIL'
    deployability: 'FAIL'
    accessibility: 'FAIL'
    ai_audio_quality: 'FAIL'
  overall_status: 'FAIL'
  critical_issues: 7
  high_priority_issues: 4
  medium_priority_issues: 3
  concerns: 10
  blockers: true
  quick_wins: 4
  evidence_gaps: 10
  recommendations:
    - 'Close storage and OAuth-token exposure paths.'
    - 'Repair cleanup, calendar, and review-write durability.'
    - 'Restore a clean mandatory release gate before deployed/load evidence.'
```

## Related artifacts

- PRD: `_bmad-output/planning-artifacts/prd-learn-module.md`
- Architecture: `_bmad-output/planning-artifacts/architecture-learn-module.md`
- Audio Overview specs: `_bmad-output/implementation-artifacts/spec-audio-overview-v2.md`, `_bmad-output/implementation-artifacts/spec-durable-audio-overview-job.md`
- Test design: `_bmad-output/test-artifacts/test-design-architecture.md`, `_bmad-output/test-artifacts/test-design-progress.md`, `_bmad-output/test-artifacts/test-design-qa.md`
- QA evidence: `docs/qa/test-plan.md`, `docs/qa/known-limitations.md`, `docs/qa/deployment-guide.md`
- Fresh local command results and four domain handoffs are summarized in Steps 3-4. No production metrics, logs, CI artifacts or deployed browser traces were available.

## Validation and sign-off

- Template sections are populated or explicitly marked unknown/not available.
- All numeric thresholds are sourced from project artifacts or marked **UNKNOWN**; no SLA, compliance certification or production capacity was inferred.
- PASS claims are limited to current local evidence, particularly Audio Workflow fault-tolerance implementation.
- CONCERNS/FAIL findings have specific owners, evidence targets, deadlines and remediation paths.
- No Playwright CLI session was launched; there is no CLI browser session to clean up.
- Prerequisites are incomplete: a verified deployed target, production metrics/logs, CI, coverage, burn-in, recovery drills and real-provider evidence are absent. Their absence is reflected in FAIL/CONCERNS rather than silently passing validation.

**NFR assessment status: FAIL - blocker for release.**

**Next workflow:** remediate the P0 blockers and restore the repository gate, then run `bmad-testarch-test-review` followed by `bmad-testarch-trace`; re-run `bmad-testarch-nfr` before a release gate decision.
