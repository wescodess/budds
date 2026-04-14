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

# Test Design for QA: Budds Learning Platform

**Purpose:** Test execution recipe for the dev/QA team. Defines what to test, how to test it, and what is needed from other teams.

**Date:** 2026-04-09
**Author:** TEA Master Test Architect
**Status:** Draft
**Project:** Budds

**Related:** See Architecture doc (`test-design-architecture.md`) for testability concerns and architectural blockers.

---

## Executive Summary

**Scope:** System-level test design covering 7 epics (V1 + V1.1), 45 functional requirements, and 31 non-functional requirements for the Budds learning platform.

**Risk Summary:**

- Total Risks: 12 (2 high-priority score >= 6, 6 medium, 4 low)
- Critical Categories: DATA (cascading deletion), OPS (service availability)

**Coverage Summary:**

- P0 tests: ~19 (security invariants, core pipeline, critical data operations)
- P1 tests: ~27 (important features, integrations, accessibility)
- P2 tests: ~14 (edge cases, secondary flows)
- P3 tests: 0
- **Total**: ~60 tests (~55-90 hours with 1 developer)

---

## Not in Scope

| Item | Reasoning | Mitigation |
|---|---|---|
| **Rate limiting** | Deferred to V1.1; manual monitoring for V1 | Cost tracked via Cloudflare AI Gateway dashboard |
| **Admin dashboard** | No admin UI in V1 | Use Cloudflare + Convex dashboards directly |
| **Cross-folder search** | Not in V1 scope | Users search within folder context only |
| **Spaced repetition** | Future feature | Flash cards use simple sequential review |
| **Load/stress testing** | Solo dev, 500-user target; managed services handle scaling | Monitor via service dashboards during semester peaks |

---

## Dependencies & Test Blockers

### Dev Dependencies (Pre-Implementation)

**Source:** See Architecture doc "Quick Guide" for detailed context

1. **Test framework setup** — Dev — Pre-Epic 1
   - Install Vitest, configure for Nuxt 4, create test directory structure
   - Add `test` script to package.json, integrate into CI (GitHub Actions)

2. **External service mock layer** — Dev — Pre-Epic 3
   - Mock interfaces for Cloudflare AI Search, AI Gateway, OpenRouter
   - Enables isolated testing of ingestion pipeline and RAG chat

3. **Test data factories** — Dev — Pre-Epic 2
   - Convex seed utilities: `seedTestUser()`, `seedFolder()`, `seedDocument()`
   - Auto-cleanup for parallel test safety

4. **Test auth helper** — Dev — Pre-Epic 1
   - Programmatic session creation without OAuth flow
   - Enables fast authenticated test setup

### QA Infrastructure Setup

1. **Test Data Factories** — Dev
   - User factory with unique emails (faker-based)
   - Folder factory with configurable depth
   - Document factory with pre-indexed state (bypassing real ingestion for unit/integration tests)
   - Auto-cleanup via test teardown

2. **Test Environments**
   - Local: `pnpm test` with Vitest, Convex dev instance
   - CI/CD: GitHub Actions with Vitest + Playwright

**Example factory pattern:**

```typescript
import { test, expect } from 'vitest';
import { ConvexTestClient } from 'convex/testing';

test('folder depth validation rejects depth 4', async () => {
  const client = new ConvexTestClient();
  const userId = 'test-user-001';

  const root = await client.mutation('folders:create', { userId, name: 'Semester', parentId: null });
  const l2 = await client.mutation('folders:create', { userId, name: 'Course', parentId: root });
  const l3 = await client.mutation('folders:create', { userId, name: 'Topic', parentId: l2 });

  await expect(
    client.mutation('folders:create', { userId, name: 'TooDeep', parentId: l3 })
  ).rejects.toThrow('Maximum folder depth');
});
```

---

## Risk Assessment

**Full risk details in Architecture doc. This section summarizes QA-relevant coverage.**

### High-Priority Risks (Score >= 6)

| Risk ID | Category | Description | Score | QA Test Coverage |
|---|---|---|---|---|
| **R-03** | DATA | Cascading deletion — orphaned chunks after delete | **6** | Integration test: create user + docs, delete account, assert zero records in Convex + zero chunks in AI Search |
| **R-05** | OPS | AI Search unavailable — all AI features fail | **6** | Integration test: mock AI Search failure, verify user-actionable error returned, no data loss |

### Medium/Low-Priority Risks

| Risk ID | Category | Description | Score | QA Test Coverage |
|---|---|---|---|---|
| R-01 | SEC | Per-user isolation bypass | 3 | Two-user isolation test: User B search returns zero User A docs |
| R-02 | TECH | Ingestion stuck in "processing" | 4 | Verify status transitions; test timeout detection |
| R-04 | SEC | Unauthenticated access to protected routes | 3 | E2E: unauthenticated request to `/app/**` returns redirect |
| R-06 | BUS | LLM cost runaway | 4 | Verify default model selection; cost tracking via API |
| R-07 | TECH | PDF extraction fails for non-standard PDFs | 3 | Test with scanned PDF, verify "failed" status with reason |
| R-08 | TECH | SSE connection drops | 2 | Test streaming fallback to non-streaming endpoint |
| R-10 | BUS | WCAG gaps in custom components | 4 | axe-core scan on FolderTree, ChatMessage, FlashCard |

---

## Entry Criteria

- [ ] Vitest + Playwright configured and running in CI
- [ ] Test data factories ready (seedTestUser, seedFolder, seedDocument)
- [ ] Test auth helper operational (programmatic session creation)
- [ ] External service mock layer available for Cloudflare AI Search
- [ ] Convex schema deployed to dev instance
- [ ] Pre-implementation blockers resolved (see Dependencies)

## Exit Criteria

- [ ] All P0 tests passing (100%)
- [ ] All P1 tests passing (>= 95%)
- [ ] No open high-priority bugs
- [ ] Per-user isolation verified with zero cross-contamination
- [ ] Cascading deletion verified across all storage systems
- [ ] axe-core reports zero critical/serious accessibility violations

---

## Test Coverage Plan

**P0/P1/P2/P3 = priority and risk level (what to focus on if time-constrained), NOT execution timing. See Execution Strategy for when tests run.**

### P0 (Critical)

**Criteria:** Blocks core functionality + High risk + No workaround

| Test ID | Requirement | Test Level | Risk Link | Notes |
|---|---|---|---|---|
| **1.1-INT-001** | Google OAuth creates Convex user record | API | R-04 | Auth flow integrity |
| **1.1-E2E-001** | Unauthenticated `/app/**` access redirected | E2E | R-04 | Security boundary |
| **2.1-INT-001** | Create root folder in Convex | API | — | Core data operation |
| **2.1-INT-002** | Create subfolder with parentId | API | — | Hierarchy integrity |
| **2.2-INT-003** | Cascading folder deletion (bottom-up) | API | R-03 | Data integrity |
| **3.1-INT-001** | Upload valid PDF, document record created | API | — | Pipeline entry point |
| **3.1-INT-002** | Reject non-PDF file | API | — | Input validation |
| **3.1-INT-004** | Upload uses userId from session, not body | API | R-01 | Security invariant |
| **3.2-INT-001** | Full ingestion: PDF → AI Search with metadata | API | R-02 | Core pipeline |
| **3.2-INT-003** | User B search never returns User A docs | API | R-01 | **Critical isolation** |
| **3.3-INT-001** | Document deletion cascades across all systems | API | R-03 | Zero orphans |
| **3.3-INT-003** | Deleted doc chunks absent from searches | API | R-03 | Orphan verification |
| **4.1-INT-001** | RAG chat with folder + user scoping | API | R-01, R-05 | Core feature |
| **4.4-INT-001** | Chat history persists across sessions | API | — | NFR30 |
| **4.4-INT-003** | Conversation queries filter by userId | API | R-01 | Security invariant |
| **5.1-INT-001** | Account deletion cascades all systems | API | R-03 | NFR13 |
| **5.1-INT-002** | Post-deletion queries return empty | API | R-03 | Zero residual data |
| **6.1-INT-001** | Generate quiz from folder docs | API | R-01 | V1.1 core |
| **7.1-INT-001** | Generate flash cards from folder docs | API | R-01 | V1.1 core |

**Total P0:** ~19 tests

---

### P1 (High)

**Criteria:** Important features + Medium risk + Common workflows

| Test ID | Requirement | Test Level | Risk Link | Notes |
|---|---|---|---|---|
| **1.1-E2E-002** | Auth user on `/login` redirected to `/app` | E2E | — | UX |
| **1.1-INT-002** | Sign-out invalidates session | API | — | Session lifecycle |
| **1.2-E2E-001** | App shell: sidebar, tabs, breadcrumbs | E2E | — | Layout |
| **1.2-E2E-003** | Skip-to-content link first focusable | E2E | R-10 | WCAG |
| **1.3-E2E-001** | Dashboard shows course cards | E2E | — | Navigation |
| **2.1-INT-003** | Reject folder at depth 4 | API | — | Business rule |
| **2.1-E2E-001** | FolderTree keyboard navigation | E2E | R-10 | WCAG tree |
| **2.2-INT-001** | Rename folder, reject empty names | API | — | CRUD |
| **2.2-INT-002** | Delete empty folder | API | — | Simple delete |
| **3.1-INT-003** | Reject file > 50MB | API | — | Size limit |
| **3.1-E2E-001** | FileUploadZone drag-and-drop + status | E2E | — | UX |
| **3.2-INT-002** | Scanned PDF → "failed" with reason | API | R-07 | Graceful failure |
| **3.2-INT-004** | Status "success" after ingestion, real-time UI | API | — | State machine |
| **3.3-INT-002** | Move document between folders | API | — | Cross-system update |
| **4.1-E2E-001** | ChatMessage with CitationBadge + SourceCard | E2E | — | Source traceability |
| **4.2-INT-001** | Streaming SSE, first token < 1s | API | R-08 | NFR2 |
| **4.2-INT-002** | SSE failure → non-streaming fallback | API | R-08 | Degradation |
| **4.3-INT-001** | Default model; model switch persists | API | — | Model logic |
| **4.3-INT-002** | Unavailable model → fallback + notification | API | R-05 | NFR27 |
| **4.4-INT-002** | New conversation, delete conversation | API | — | CRUD |
| **5.1-INT-003** | Partial deletion failure → retry within 24h | API | R-03 | NFR13 |
| **5.2-INT-001** | Post-doc-delete search excludes chunks | API | R-03 | Orphan check |
| **6.1-INT-002** | Quiz generation < 10s | API | — | NFR6 |
| **6.1-INT-003** | Quiz questions include source citations | API | — | Traceability |
| **6.2-E2E-001** | Take quiz: MC + free response, scoring | E2E | R-10 | User journey |
| **7.1-INT-002** | Flash card generation < 10s | API | — | NFR6 |
| **7.2-E2E-001** | Card flip, navigation, keyboard | E2E | R-10 | User journey |

**Total P1:** ~27 tests

---

### P2 (Medium)

**Criteria:** Secondary features + Low risk + Edge cases

| Test ID | Requirement | Test Level | Risk Link | Notes |
|---|---|---|---|---|
| **1.1-INT-003** | Session expiry after 30 days inactivity | API | — | NFR11 |
| **1.2-E2E-002** | Mobile: sidebar as Sheet overlay | E2E | — | Responsive |
| **1.2-E2E-004** | Dark/light mode, 4.5:1 contrast | E2E | R-10 | NFR22 |
| **1.3-E2E-002** | First-time user empty state | E2E | — | Onboarding |
| **2.2-E2E-001** | Delete folder confirmation dialog | E2E | — | UX safety |
| **4.1-E2E-002** | Empty folder: chat disabled, empty state | E2E | — | Progressive |
| **4.1-E2E-003** | Chat input: Enter/Shift+Enter, `/` shortcut | E2E | — | UX |
| **4.2-E2E-001** | Streaming response with cursor animation | E2E | — | Perceived perf |
| **5.3-INT-001** | Data export generates package | API | — | FR42 |
| **5.3-E2E-001** | Terms and privacy pages render (SSR) | E2E | — | FR45 |
| **6.3-INT-001** | Edit quiz question, view previous quizzes | API | — | CRUD |
| **7.2-E2E-002** | prefers-reduced-motion: instant flip | E2E | R-10 | WCAG |
| **7.3-INT-001** | Edit/delete flash cards, view sets | API | — | CRUD |
| **CC-INT-004** | Convex unavailable: queued writes, error msg | API | R-09 | NFR26 |

**Total P2:** ~14 tests

---

## Execution Strategy

**Philosophy:** Run everything in PRs unless there's significant infrastructure overhead. Vitest with parallelization handles 60+ tests well within 15 minutes.

### Every PR: Vitest + Playwright Tests (~10-15 min)

All functional tests (P0, P1, P2) — unit, API integration, and E2E:

- Parallelized via Vitest workers
- E2E tests via Playwright (auth, isolation, UI journeys)
- Total: ~60 tests

**Why run in PRs:** Fast feedback, no expensive infrastructure

### Nightly: Full Suite + Accessibility (~30 min)

- Full test suite with extended timeouts
- axe-core accessibility audit on all interactive pages
- Ingestion pipeline with larger PDFs (50-page stress test)

**Why defer:** Longer execution, broader coverage validation

### Weekly: Performance Benchmarks (~60 min)

- Chat response latency benchmarks (NFR1, NFR2)
- Ingestion throughput benchmarks (NFR4)
- Folder navigation rendering benchmarks (NFR5)
- Full WCAG audit with manual screen reader validation

**Why defer:** Infrastructure overhead, infrequent validation sufficient

---

## QA Effort Estimate

| Priority | Count | Effort Range | Notes |
|---|---|---|---|
| P0 | ~19 | ~20-30 hours | Includes mock layer setup, data factories, isolation tests |
| P1 | ~27 | ~25-40 hours | E2E tests need more setup; streaming + accessibility |
| P2 | ~14 | ~10-20 hours | Edge cases, secondary validation |
| **Total** | **~60** | **~55-90 hours** | **1 developer, integrated with feature development** |

**Assumptions:**

- Includes test design, implementation, debugging, CI integration
- Excludes ongoing maintenance (~10% effort)
- Assumes test infrastructure (factories, mocks, auth helper) is ready

---

## Implementation Planning Handoff

| Work Item | Owner | Dependencies/Notes |
|---|---|---|
| Scaffold Vitest + Playwright config | Dev | Pre-Epic 1; unblocks all testing |
| Build Convex test data factories | Dev | Pre-Epic 2; depends on schema finalization |
| Implement test auth helper | Dev | Pre-Epic 1; enables fast authenticated test setup |
| Build Cloudflare AI Search mock | Dev | Pre-Epic 3; enables ingestion + chat testing |
| Implement `pending_cleanup` deletion pattern | Dev | Pre-V1 GA; mitigates R-03 |

---

## Interworking & Regression

| Service/Component | Impact | Regression Scope | Validation |
|---|---|---|---|
| **Cloudflare AI Search** | All RAG features depend on it | Search relevance, per-user isolation | Two-user isolation test on every PR |
| **Convex** | All data persistence | Schema changes, query performance | Convex type-check on every PR |
| **Cloudflare AI Gateway** | LLM routing for chat, quiz, flash cards | Model availability, cost tracking | Model fallback test |
| **Better Auth** | Authentication for all protected routes | Session management, OAuth flow | Auth redirect E2E test on every PR |

---

## Appendix A: Code Examples & Tagging

**Vitest Tags for Selective Execution:**

```typescript
import { describe, test, expect } from 'vitest';

// P0 critical test
describe('per-user isolation', () => {
  test('@P0 @Security User B search never returns User A documents', async () => {
    const userA = await seedTestUser({ email: 'usera@test.com' });
    const userB = await seedTestUser({ email: 'userb@test.com' });

    await seedDocument({ userId: userA.id, folderId: userA.folderId, filename: 'secret.pdf' });

    const results = await searchDocuments({ userId: userB.id, query: 'secret' });

    expect(results).toHaveLength(0);
  });
});

// P1 integration test
describe('folder management', () => {
  test('@P1 @Integration reject folder creation at depth 4', async () => {
    const user = await seedTestUser();
    const root = await createFolder({ userId: user.id, name: 'L1', parentId: null });
    const l2 = await createFolder({ userId: user.id, name: 'L2', parentId: root.id });
    const l3 = await createFolder({ userId: user.id, name: 'L3', parentId: l2.id });

    await expect(
      createFolder({ userId: user.id, name: 'L4', parentId: l3.id })
    ).rejects.toThrow('Maximum folder depth');
  });
});
```

**Run specific tags:**

```bash
# Run only P0 tests
pnpm vitest run --reporter=verbose -t "@P0"

# Run only security tests
pnpm vitest run --reporter=verbose -t "@Security"

# Run all tests in PR (default)
pnpm vitest run
```

---

## Appendix B: Knowledge Base References

- **Risk Governance**: `risk-governance.md` — Risk scoring methodology (P x I, 1-9 scale)
- **Test Levels Framework**: `test-levels-framework.md` — E2E vs API vs Unit selection criteria
- **Test Quality**: `test-quality.md` — Definition of Done (no hard waits, <300 lines, <1.5 min, self-cleaning)
- **ADR Quality Readiness**: `adr-quality-readiness-checklist.md` — 8-category NFR assessment framework

---

**Generated by:** BMad TEA Agent
**Workflow:** `bmad-testarch-test-design`
