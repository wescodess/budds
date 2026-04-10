---
stepsCompleted:
  - step-01-detect-mode
  - step-02-load-context
  - step-03-risk-and-testability
  - step-04-coverage-plan
  - step-05-generate-output
lastStep: 'step-05-generate-output'
lastSaved: '2026-04-09'
workflowType: 'testarch-test-design'
inputDocuments:
  - _bmad-output/planning-artifacts/prd.md
  - _bmad-output/planning-artifacts/architecture.md
  - _bmad-output/planning-artifacts/epics.md
  - _bmad-output/planning-artifacts/ux-design-specification.md
---

# Test Design for Architecture: Budds Learning Platform

**Purpose:** Architectural concerns, testability gaps, and NFR requirements for review by the dev team. Serves as a contract on what must be addressed before test development begins.

**Date:** 2026-04-09
**Author:** TEA Master Test Architect
**Status:** Architecture Review Pending
**Project:** Budds
**PRD Reference:** `_bmad-output/planning-artifacts/prd.md`
**ADR Reference:** `_bmad-output/planning-artifacts/architecture.md`

---

## Executive Summary

**Scope:** System-level test design for Budds — an EdTech learning platform (Nuxt 4 + Convex + Cloudflare AI Search) covering 7 epics, 45 FRs, and 31 NFRs.

**Business Context:**

- **Problem:** Students manually bridge document comprehension tools (NotebookLM) and study material generators (Quizlet/Anki)
- **GA Target:** V1 launch targeting 500 users in 60 days

**Architecture:**

- **Stack:** Nuxt 4 / Vue 3 / Tailwind 4 / Convex / Cloudflare AI Search + AI Gateway / OpenRouter / Better Auth + SQLite
- **Key Decision:** Per-user document isolation via metadata filtering in Cloudflare AI Search through a single `searchDocuments()` gateway
- **Key Decision:** Convex as sole persistence layer with real-time subscriptions
- **Key Decision:** Better Auth + SQLite retained for V1 (constrains deployment to persistent-filesystem hosts)

**Expected Scale:** 500 concurrent users, 500 docs/user, 3-5x semester traffic spikes

**Risk Summary:**

- **Total risks**: 12
- **High-priority (>=6)**: 2 risks requiring immediate mitigation
- **Test effort**: ~60 test scenarios (~55-90 hours for 1 dev)

---

## Quick Guide

### BLOCKERS - Must Address Before Testing

1. **TC-1: No test infrastructure** — Vitest not installed, no test directory, no CI test step. Must scaffold before any test development. (Owner: Dev)
2. **TC-2: No mock layer for external services** — Cloudflare AI Search, AI Gateway, OpenRouter have no test doubles. Must design mock/stub interfaces. (Owner: Dev)
3. **TC-3: No test data factories** — Convex schema is greenfield with no seed utilities. Must implement `seedTestUser()` and document factories. (Owner: Dev)
4. **TC-4: No programmatic auth for tests** — Better Auth + SQLite has no test session creation bypass. Must implement test auth helper. (Owner: Dev)

**What we need:** Complete these 4 items pre-implementation or test development is blocked.

---

### HIGH PRIORITY - Validate These Recommendations

1. **R-03 (Cascading Deletion, Score 6)** — Design deletion operations with idempotent retries and `pending_cleanup` flag for partial failure recovery. (Owner: Dev, pre-V1 GA)
2. **R-05 (AI Search Unavailability, Score 6)** — Validate graceful degradation patterns for all AI-powered features when Cloudflare AI Search is down. (Owner: Dev, implementation phase)
3. **TC-5 (Ingestion Pipeline Testability)** — Design the ingestion pipeline with injectable dependencies so PDF parser, AI Search client, and Convex mutations are independently testable. (Owner: Dev, during Epic 3)

**What we need:** Review recommendations and approve or suggest changes.

---

### INFO ONLY - No Decisions Needed

1. **Test strategy**: ~60 scenarios split across API (primary), E2E (critical paths), and Unit (pure logic)
2. **Tooling**: Vitest + Playwright for E2E
3. **CI/CD**: PR (<15 min) / Nightly (full suite) / Weekly (performance + accessibility)
4. **Coverage**: 19 P0, 27 P1, 14 P2 scenarios with risk-based classification
5. **Quality gates**: P0 = 100%, P1 >= 95%, zero cross-user data leakage

---

## For Architects and Devs

### Risk Assessment

**Total risks identified**: 12 (2 high-priority >= 6, 6 medium, 4 low)

#### High-Priority Risks (Score >= 6)

| Risk ID | Category | Description | P | I | Score | Mitigation | Owner | Timeline |
|---|---|---|---|---|---|---|---|---|
| **R-03** | **DATA** | Cascading deletion incomplete — orphaned chunks in AI Search after document/account deletion | 2 | 3 | **6** | Idempotent deletion with retry; `pending_cleanup` flag; integration test verifying zero orphans across all storage systems | Dev | Pre-V1 GA |
| **R-05** | **OPS** | Cloudflare AI Search unavailable — chat, quiz, flash card generation all fail simultaneously | 2 | 3 | **6** | Graceful degradation (user-actionable error, no data loss); monitoring via AI Gateway dashboard | Dev | Implementation |

#### Medium-Priority Risks (Score 3-5)

| Risk ID | Category | Description | P | I | Score | Mitigation | Owner |
|---|---|---|---|---|---|---|---|
| R-02 | TECH | Ingestion pipeline fails silently — documents stuck in "processing" | 2 | 2 | 4 | Timeout detection; retry logic in Convex action | Dev |
| R-06 | BUS | LLM cost runaway before V1.1 rate limiting | 2 | 2 | 4 | Smart model defaults; per-model cost tracking | Dev/Ops |
| R-10 | BUS | WCAG accessibility gaps in custom components | 2 | 2 | 4 | ARIA attributes per UX-DR specs; axe-core scanning | Dev |
| R-12 | PERF | Folder-scoped search returns irrelevant results | 2 | 2 | 4 | Chunking strategy tuning; query reformulation | Dev |

#### Low-Priority Risks (Score 1-3)

| Risk ID | Category | Description | P | I | Score | Action |
|---|---|---|---|---|---|---|
| R-01 | SEC | Per-user isolation bypass | 1 | 3 | 3 | Monitor — single enforcement point mitigates |
| R-04 | SEC | Auth session bypass to protected routes | 1 | 3 | 3 | Monitor — route middleware + server-side validation |
| R-07 | TECH | PDF text extraction fails for non-standard PDFs | 3 | 1 | 3 | Monitor — graceful failure with actionable message |
| R-08 | TECH | SSE streaming connection drops mid-response | 2 | 1 | 2 | Monitor — non-streaming fallback exists |
| R-09 | OPS | Convex unavailable | 1 | 3 | 3 | Monitor — managed BaaS with high availability |
| R-11 | OPS | SQLite auth DB corrupted or lost | 1 | 3 | 3 | Monitor — persistent-filesystem host; post-V1 migration |

---

### Testability Concerns and Architectural Gaps

#### Blockers to Fast Feedback

| Concern | Impact | What Architecture Must Provide | Owner | Timeline |
|---|---|---|---|---|
| **No test framework** | All testing blocked | Vitest setup, test directory structure, CI integration | Dev | Pre-Epic 1 |
| **No external service mocks** | Integration tests flaky or impossible | Mock/stub interfaces for AI Search, AI Gateway, OpenRouter | Dev | Pre-Epic 3 |
| **No test data factories** | Slow, fragile test setup | Convex seed utilities (`seedTestUser`, `seedFolder`, `seedDocument`) | Dev | Pre-Epic 2 |
| **No test auth bypass** | Every test requires full OAuth flow | Programmatic session creation for test environments | Dev | Pre-Epic 1 |

#### Architectural Improvements Needed

1. **Ingestion pipeline decomposition**
   - **Current problem**: Pipeline spans Nitro → Convex → Cloudflare with no isolation points
   - **Required change**: Injectable dependencies for PDF parser, AI Search client, and status mutations
   - **Impact if not fixed**: Cannot test ingestion stages independently; full integration required for every test
   - **Owner**: Dev
   - **Timeline**: During Epic 3 implementation

2. **Cascading deletion coordination**
   - **Current problem**: Multi-system deletion (AI Search + Convex file storage + Convex records) has no transaction guarantee
   - **Required change**: Idempotent retry pattern with `pending_cleanup` flag for partial failure recovery
   - **Impact if not fixed**: Orphaned data across systems; user trust violation
   - **Owner**: Dev
   - **Timeline**: Before V1 GA

### Testability Assessment Summary

#### What Works Well

- Single enforcement point (`searchDocuments()`) for per-user isolation — excellent for testing the security invariant
- Convex real-time subscriptions provide deterministic UI state updates
- Clear API surface via Nitro server routes with typed schemas
- Well-defined document status state machine (`uploading → processing → success | failed`)
- shadcn-nuxt headless components (Reka UI) have built-in ARIA semantics

#### Accepted Trade-offs

- **Better Auth + SQLite for V1** — constrains deployment to persistent-filesystem hosts and complicates test auth. Acceptable because auth migration is planned post-V1 and the current auth works.
- **No rate limiting until V1.1** — manual cost monitoring via Cloudflare dashboards. Acceptable at 500-user scale.

---

### Risk Mitigation Plans (High-Priority Risks >= 6)

#### R-03: Cascading Deletion Incomplete (Score: 6) - HIGH

**Mitigation Strategy:**

1. Implement idempotent deletion functions for each system (AI Search, Convex file storage, Convex records)
2. Add `pending_cleanup` flag to document records for tracking incomplete deletions
3. Implement background retry for failed cleanup steps
4. Account deletion orchestrator that sequences all deletion steps with error handling per step

**Owner:** Dev
**Timeline:** Before V1 GA
**Status:** Planned
**Verification:** Integration test creates user with documents, deletes account, asserts zero records across all three storage systems

#### R-05: Cloudflare AI Search Unavailability (Score: 6) - HIGH

**Mitigation Strategy:**

1. Wrap all AI Search calls in error handling that returns user-actionable messages
2. Ensure no data loss when AI Search is unavailable (uploads still work, just not searchable)
3. Monitor AI Search health via Cloudflare AI Gateway dashboard

**Owner:** Dev
**Timeline:** During implementation
**Status:** Planned
**Verification:** Integration test simulates AI Search failure, verifies error message returned and no data corruption

---

### Assumptions and Dependencies

#### Assumptions

1. Cloudflare AI Search supports metadata filtering for per-user document isolation at the query level
2. Convex actions can reliably call Cloudflare AI Search APIs within the action execution time limit
3. PDF text extraction library (pdf-parse) handles standard academic PDFs reliably

#### Dependencies

1. **Vitest + Playwright setup** — Required before any test development
2. **Convex schema finalization** — Required before test data factories can be built
3. **Cloudflare AI Search multi-tenant validation** — Required before Epic 3 implementation

#### Risks to Plan

- **Risk**: Solo developer means test infrastructure competes with feature development for time
  - **Impact**: Test development may lag behind feature development
  - **Contingency**: Prioritize P0 tests that validate security invariants (isolation, auth); defer P2/P3

---

**Next Steps for Dev Team:**

1. Review Quick Guide blockers and prioritize test infrastructure setup
2. Assign timelines for high-priority risk mitigations (R-03, R-05)
3. Validate assumptions about Cloudflare AI Search capabilities
4. Refer to companion QA doc (`test-design-qa.md`) for test scenarios and coverage plan
