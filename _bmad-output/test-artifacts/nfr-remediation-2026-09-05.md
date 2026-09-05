---
date: '2026-09-05'
scope: 'Production audit remediation implemented in the current worktree'
status: 'LOCAL GATES PASS - PRODUCTION RELEASE STILL BLOCKED'
baselineAssessment: '_bmad-output/test-artifacts/nfr-assessment.md'
---

# NFR remediation evidence

This addendum records changes made after the repository-wide NFR assessment. It does not replace the original evidence snapshot. The original assessment remains the baseline; this document distinguishes current local evidence from work that requires a deployed environment, provider credentials, production data, or owner approval.

## Implemented remediation

### Security and privacy

- Restricted the R2 diagnostic route to authenticated development/non-production use and added route-level tests.
- Replaced browser-readable Google OAuth credentials with server-only encrypted token access using AES-256-GCM. New token writes are encrypted and legacy values are migrated when used.
- Limited localhost Better Auth trusted origins to non-production environments.
- Replaced process-local generation limits with Convex-backed per-user rate-limit buckets. Callers now use stable route identifiers, so query strings cannot create new buckets.
- Converted calendar disconnect and cleanup primitives to internal Convex functions; removed the unused public calendar-event creation function.
- Encrypted offline Learn payloads and audio at rest, including key creation, rotation/lifecycle behavior, and regression coverage.
- Expanded personal-data export coverage and redacted calendar credentials and Audio Overview share tokens.

### Reliability and data integrity

- Made document external cleanup fail closed, preserved failed cleanup work, and added scheduled rescue processing.
- Made review submission durable and idempotent through the offline queue instead of swallowing failed SM-2 writes.
- Changed normal course deletion to a provider-first action: Google events are deleted before local course records, and provider failure preserves the local course for retry.
- Changed account deletion to disconnect Google first and reject direct backend deletion while a calendar connection remains.
- Paginated calendar disconnect across provider and local records and covered a 205-event case.
- Expanded account-deletion cascades to include attempt answers, rate-limit buckets, more than 50 Audio Overview job turns, and orphan/in-progress Audio Overview v2 episodes.
- Resumed bounded episode deletion automatically when a previously failed R2 artifact cleanup later succeeds.

### Build, dependency, and test health

- Upgraded Nuxt, Vue, Convex, Better Auth, Vitest, Vite, and related dependencies; corrected the `nuxt-convex` package patch and lockfile hash.
- Added a repository-owned `pnpm verify` gate and a GitHub Actions workflow with parallel suites, strict synthetic build configuration, audits, artifacts, a scheduled ten-pass burn-in, and an aggregate gate.
- Made test-log pipelines explicitly use `pipefail`, so `tee` cannot mask a failing test process on a runner with different shell defaults.
- Added Cloudflare native Node compatibility to Nitro. The generated `dist/nitro.json` records `cloudflare.nodeCompat: true`; the Pages environment must keep the matching `nodejs_compat` deployment flag.

## Current local evidence

| Gate | Result |
| --- | --- |
| `npx convex codegen` | PASS; bindings generated and functions uploaded to configured preview/dev deployment `cautious-elephant-39` |
| `pnpm verify` | PASS |
| ESLint ratchet | PASS: 0 errors, exactly 1,094 warnings |
| Application typecheck | PASS |
| Root Vitest | PASS: 957 passed, 8 skipped |
| Nuxt component suite | PASS: 430 passed, 85 skipped |
| Audio component suite | PASS: 38 passed |
| Audio Workflow Worker typecheck/tests | PASS: 57 passed |
| Root dependency audit | PASS: no known vulnerabilities |
| Worker dependency audit | PASS: no known vulnerabilities |
| Strict synthetic Cloudflare Pages build | PASS: 11.9 MB output |
| `git diff --check` | PASS |

The total local test result is 1,482 passed and 93 skipped. The lint gate is a no-regression ratchet, not a claim of lint cleanliness.

An independent fresh-context review found no P0 regression and reran 111 focused hardening tests successfully. It identified the CI pipe-status issue corrected above and confirmed the large-account and provider-compensation P1 gaps listed below.

## Remaining release blockers

1. Existing Base64 calendar tokens have not been migrated in production and exposed refresh tokens have not been rotated. Lazy migration on use is not fleet-wide migration proof.
2. Calendar sync/reschedule compensation deletes are still best-effort. A durable Google cleanup outbox with retry and terminal alerting is still required for provider failures after partial work.
3. Account deletion and personal-data export still use large monolithic Convex operations with unbounded reads. Large-account transaction, response-size, and timeout behavior is unproven.
4. The export contains application metadata and document blobs, but not binary Audio Overview artifacts. The intended portability contract for those binaries needs an explicit product decision.
5. The GitHub Actions workflow has not completed its first remote run, and `CI gate` is not yet configured as a required branch-protection check.
6. No production deployment, authenticated smoke test, real Google/Gemini/Cloudflare provider run, load/soak test, restore drill, or monitoring/alert verification was performed.
7. Accessibility and cross-browser acceptance remain unproven in an automated or deployed browser environment.
8. The application still carries 1,094 legacy lint warnings and dependency compatibility debt around the deprecated `@onmax/nuxt-better-auth` integration, despite a clean vulnerability audit.

## Release decision

The repository is substantially safer and its local release gates are green, but it is not yet evidence-backed as production-ready. Promotion should remain blocked until the production migration/rotation, durable provider compensation, first remote CI/branch-protection activation, and deployed provider/operational checks are completed.
