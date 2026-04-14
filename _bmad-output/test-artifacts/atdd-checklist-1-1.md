---
stepsCompleted:
  - step-01-preflight-and-context
  - step-02-generation-mode
  - step-03-test-strategy
  - step-04-generate-tests
  - step-05-validate-and-complete
lastStep: step-05-validate-and-complete
lastSaved: '2026-04-09'
workflowType: testarch-atdd
inputDocuments:
  - _bmad-output/implementation-artifacts/1-1-verify-and-harden-authentication-flow.md
  - convex/users.ts
  - convex/schema.ts
  - convex/auth.config.ts
  - server/auth.config.ts
  - nuxt.config.ts
  - app/plugins/convex-auth.client.ts
  - _bmad/tea/agents/bmad-tea/resources/knowledge/data-factories.md
  - _bmad/tea/agents/bmad-tea/resources/knowledge/component-tdd.md
  - _bmad/tea/agents/bmad-tea/resources/knowledge/test-quality.md
  - _bmad/tea/agents/bmad-tea/resources/knowledge/test-levels-framework.md
---

# ATDD Checklist - Epic 1, Story 1.1: Verify & Harden Authentication Flow

**Date:** 2026-04-09
**Author:** palmwine
**Primary Test Level:** Integration (convex-test) + Config Assertion (vitest)

---

## Story Summary

Verify and harden the authentication flow for the Budds Learning Compiler so students can sign in with Google OAuth, have their user record synced to Convex, and be securely routed within the app.

**As a** student
**I want** to sign in with my Google account and be securely routed to the app
**So that** I can access my personal learning workspace without friction

---

## Acceptance Criteria

1. **AC1** — Unauthenticated users visiting `/app/**` are redirected to `/login` with no content flash
2. **AC2** — Authenticated users visiting `/login` are redirected to `/app`
3. **AC3** — Google OAuth sign-in creates or updates user record in Convex `users` table
4. **AC4** — Sign-out ends session, redirects to `/login`, and invalidates Better Auth session
5. **AC5** — Sessions persist for 30 days of inactivity

---

## Test Strategy

### Stack Detection

| Signal | Evidence | Result |
|--------|----------|--------|
| Frontend | `package.json`: vue, nuxt, reka-ui, tailwindcss | Present |
| Backend | `convex/` functions, `server/` Nitro routes | Present |
| **Detected** | | **fullstack** |

### Test Framework

| Tool | Version | Purpose |
|------|---------|---------|
| vitest | 4.1.4 | Test runner (edge-runtime environment) |
| convex-test | 0.0.47 | Convex function testing harness with `withIdentity()` |
| @edge-runtime/vm | 5.0.0 | Edge runtime environment for vitest |

**Note**: No Playwright/Cypress installed. Convex guidelines recommend `convex-test` + `vitest` for function testing. Browser-level E2E tests remain manual.

### Test Level Mapping

| AC | Test Level | Priority | Justification |
|----|------------|----------|---------------|
| AC1 | Config assertion (Unit) | P0 | Route rules validated via source scan; runtime behavior requires E2E |
| AC2 | Config assertion (Unit) | P0 | Auth redirect config validated via source scan |
| AC3 | Integration (convex-test) | P0 | Core data flow: identity → upsert → user record. Critical path for all future stories |
| AC4 | Integration (convex-test) | P0 | Auth gating: getUser must return null when unauthenticated |
| AC5 | Config assertion (Unit) | P1 | Session expiry and route redirect config validated via source scan |

### Duplicate Coverage Guard

- Convex function tests (AC3/AC4): test **data layer** behavior
- Config assertions (AC1/AC2/AC5): test **framework configuration**
- No overlap — different concerns at different levels

---

## Tests Created (GREEN Phase)

**Note:** Story 1.1 is already implemented (status: done). ATDD applied post-implementation — tests validate existing behavior and serve as regression guards. All tests are GREEN.

### Integration Tests (7 tests)

**File:** `convex/users.test.ts` (153 lines)

**AC3: Google OAuth creates or updates user in Convex**

- **Test:** `1.1-INT-001` upsertUser creates a new user record on first login
  - **Status:** GREEN
  - **Verifies:** New user creation with all profile fields (name, email, avatarUrl) from identity

- **Test:** `1.1-INT-002` upsertUser updates existing user record on subsequent login
  - **Status:** GREEN
  - **Verifies:** Profile field update on re-login (name, avatarUrl) without losing email

- **Test:** `1.1-INT-003` upsertUser is idempotent — does not create duplicate records
  - **Status:** GREEN
  - **Verifies:** Same tokenIdentifier returns same document ID across multiple calls

- **Test:** `1.1-INT-004` upsertUser handles missing optional fields gracefully
  - **Status:** GREEN
  - **Verifies:** Minimal identity (no name/email/pictureUrl) → name="Unknown", optional fields undefined

- **Test:** `1.1-INT-005` upsertUser rejects unauthenticated calls
  - **Status:** GREEN
  - **Verifies:** No identity → throws "Unauthenticated" error

**AC4: Sign-out — session invalidation at Convex layer**

- **Test:** `1.1-INT-006` getUser returns null for unauthenticated requests
  - **Status:** GREEN
  - **Verifies:** Cleared auth → no user data returned

- **Test:** `1.1-INT-007` getUser returns user only for the authenticated identity
  - **Status:** GREEN
  - **Verifies:** User A's record not visible to User B (identity isolation)

### Config Assertion Tests (6 tests)

**File:** `convex/users.test.ts` (same file, AC5 describe block)

**AC5: Session persistence — configuration assertions**

- **Test:** `1.1-UNIT-001` server auth config sets session expiresIn to 30 days
  - **Status:** GREEN
  - **Verifies:** `expiresIn: 60 * 60 * 24 * 30` present in `server/auth.config.ts`

- **Test:** `1.1-UNIT-002` server auth config sets session updateAge to 1 day
  - **Status:** GREEN
  - **Verifies:** `updateAge: 60 * 60 * 24` present in `server/auth.config.ts`

- **Test:** `1.1-UNIT-003` nuxt config protects /app/** for authenticated users
  - **Status:** GREEN
  - **Verifies:** `routeRules['/app/**']` has `auth: 'user'`

- **Test:** `1.1-UNIT-004` nuxt config sets /login as guest-only route
  - **Status:** GREEN
  - **Verifies:** `routeRules['/login']` has `auth: 'guest'`

- **Test:** `1.1-UNIT-005` nuxt config redirects logout to /login
  - **Status:** GREEN
  - **Verifies:** `auth.redirects.logout` = `/login`

- **Test:** `1.1-UNIT-006` nuxt config redirects guest to /app
  - **Status:** GREEN
  - **Verifies:** `auth.redirects.guest` = `/app`

---

## Data Factories Created

### Identity Factory (inline)

**File:** `convex/users.test.ts` (lines 9-16)

**Exports:** `TEST_IDENTITY` constant with full Google OAuth identity shape

**Usage:**

```typescript
const TEST_IDENTITY = {
  tokenIdentifier: 'https://localhost:3002|google-oauth2|12345',
  subject: 'google-oauth2|12345',
  issuer: 'https://localhost:3002',
  name: 'Test Student',
  email: 'student@example.com',
  pictureUrl: 'https://example.com/avatar.jpg',
}
```

**Note:** `convex-test` uses `t.withIdentity()` to inject auth context — no external factory library needed. Identity variants are created inline with spread overrides per test-quality patterns.

---

## Fixtures Created

### convex-test Harness (inline)

**File:** `convex/users.test.ts` (line 7)

**Pattern:** Each test creates a fresh `convexTest(schema, modules)` instance — full isolation with no shared state. `convex-test` manages its own in-memory database per test instance. No explicit cleanup needed.

```typescript
const t = convexTest(schema, modules)
const asUser = t.withIdentity(TEST_IDENTITY)
```

---

## Mock Requirements

N/A — `convex-test` provides a complete in-memory Convex runtime. No external services need mocking for Story 1.1's testable surface.

---

## Required data-testid Attributes

### Login Page (`app/pages/login.vue`)

- `sign-in-google` — Google OAuth sign-in button (for future E2E automation)

### Chat Page Header (`app/pages/app/chat.vue`)

- `sign-out-button` — Sign-out button (for future E2E automation)

---

## Implementation Checklist

Story 1.1 is already implemented. All tests are GREEN. No implementation tasks remain.

### Previously Completed (Reference)

- [x] Convex `users` table schema with `tokenIdentifier` index
- [x] `upsertUser` mutation deriving identity from `ctx.auth.getUserIdentity()`
- [x] `getUser` query with auth gating
- [x] Convex auth config (`convex/auth.config.ts`) with `getAuthConfigProvider()`
- [x] Client plugin wiring Convex auth to Better Auth session
- [x] Route rules protecting `/app/**` and `/login`
- [x] Session config (30-day expiry, 1-day rolling update)
- [x] Sign-out redirect to `/login`

---

## Running Tests

```bash
# Run all tests for this story
pnpm test

# Run in watch mode
pnpm test:watch

# Run specific test file
pnpm vitest run convex/users.test.ts

# Run with verbose output
pnpm vitest run --reporter=verbose
```

---

## Red-Green-Refactor Workflow

### RED Phase — N/A (post-implementation)

Story 1.1 was implemented before ATDD was applied. Tests were written against existing implementation.

### GREEN Phase (Complete)

- All 13 tests pass
- Tests validate all 5 acceptance criteria at appropriate levels
- No false positives (tests genuinely exercise implementation)

### REFACTOR Phase — Recommendations

1. **Extract identity factory**: If future stories need similar auth test patterns, extract `TEST_IDENTITY` and helpers into `convex/test-utils.ts`
2. **Add Playwright for E2E**: When browser-level testing is prioritized, add Playwright to automate the manual E2E checklist below

---

## Manual E2E Acceptance Tests (Browser)

These require a running app (`pnpm dev` + `npx convex dev`) and cannot be automated with convex-test.

### AC1: Unauthenticated route protection

- [x] Open incognito → navigate to `/app/chat` → redirected to `/login` *(Chrome MCP: verified — redirected to `/login?redirect=/app/chat`)*
- [x] No protected content flash during redirect *(Chrome MCP: a11y snapshot shows only login page elements — "Sign in" heading + "Continue with Google" button)*
- [x] Direct navigation to any `/app/**` subpath redirects to `/login` *(Chrome MCP: `/app` also redirects to `/login?redirect=/app/chat`)*

### AC2: Authenticated user on login page

- [ ] While logged in → navigate to `/login` → redirected to `/app/chat` *(Requires real Google OAuth — cannot automate without credentials)*

### AC3: Full OAuth flow (browser)

- [ ] Click "Sign in with Google" → complete OAuth → redirected to `/app/chat` *(Requires real Google OAuth)*
- [ ] Check Convex dashboard: user record exists with correct tokenIdentifier, name, email, avatarUrl *(Requires real OAuth)*

### AC4: Sign-out flow (browser)

- [ ] Click sign-out button → redirected to `/login` *(Requires authenticated session first)*
- [ ] After sign-out → navigate to `/app` → stays on `/login` (session invalidated) *(Requires authenticated session first)*

### AC5: Session persistence (browser)

- [x] `/api/auth/get-session` returns `null` when unauthenticated *(Chrome MCP: verified via evaluate_script + network inspection)*
- [x] No cookies set for unauthenticated visitors *(Chrome MCP: `document.cookie` returns empty string)*
- [ ] Close browser tab → reopen → navigate to `/app` → still authenticated *(Requires authenticated session)*
- [ ] Confirm session cookie has ~30-day expiry in DevTools → Application → Cookies *(Requires authenticated session)*

---

## Next Steps

1. **Run manual E2E tests** against running app to complete full AC coverage
2. **Consider Playwright setup** as a separate story for automating browser-level tests
3. **Reuse test patterns** from this story for Story 1.2+ (Convex function tests + config assertions)
4. **JWKS bootstrap** must be completed before Convex auth works (see story Dev Notes)

---

## Knowledge Base References Applied

- **data-factories.md** — Factory patterns with overrides for identity objects; `convex-test` `withIdentity()` fulfills the factory role
- **component-tdd.md** — Red-Green-Refactor cycle adapted for post-implementation validation
- **test-quality.md** — Deterministic tests, explicit assertions in test bodies, isolated test instances, no hard waits
- **test-levels-framework.md** — Integration level for service/DB interactions (Convex functions), Unit level for config assertions; avoided E2E for logic testable at lower levels

See `_bmad/tea/agents/bmad-tea/resources/tea-index.csv` for complete knowledge fragment mapping.

---

## Chrome MCP E2E Verification Evidence (2026-04-09)

**Tool:** Chrome MCP (`mcp__chrome-mcp__*`)
**Method:** Isolated browser contexts via `new_page(isolatedContext=...)`

| Check | Result | Evidence |
|-------|--------|----------|
| `/app/chat` unauthenticated → redirect | PASS | URL: `http://localhost:3002/login?redirect=/app/chat` |
| `/app` unauthenticated → redirect | PASS | URL: `http://localhost:3002/login?redirect=/app/chat` (via `/app` → `/app/chat` → `/login`) |
| Login page structure | PASS | a11y snapshot: heading "Sign in" + button "Continue with Google" |
| `/api/auth/get-session` unauthenticated | PASS | Returns `null` (status 200) |
| No cookies when unauthenticated | PASS | `document.cookie` returns empty string |
| Root `/` accessible without auth | PASS | No redirect, status 200 |
| Network requests on login | PASS | 2x `GET /api/auth/get-session` (200) — session check on page load |

**Screenshot:** `_bmad-output/test-artifacts/screenshots/ac1-unauthenticated-redirect.png`

**Remaining (requires real Google OAuth):** AC2 (authenticated redirect), AC3 (full OAuth flow), AC4 (sign-out), AC5 (session cookie expiry)

---

## Test Execution Evidence

### Test Run (GREEN Phase Verification)

**Command:** `pnpm test`

**Results:**

```
 RUN  v4.1.4 /Users/wesleyukadike/Desktop/budds

 Test Files  1 passed (1)
      Tests  13 passed (13)
   Start at  20:42:09
   Duration  197ms (transform 41ms, setup 0ms, import 57ms, tests 21ms, environment 29ms)
```

**Summary:**

- Total tests: 13
- Passing: 13
- Failing: 0
- Duration: 197ms
- Status: GREEN phase verified

---

## Risks & Assumptions

| Risk | Impact | Mitigation |
|------|--------|------------|
| JWKS bootstrap not complete | Convex auth returns null for all users | One-time setup documented in story Dev Notes |
| No browser E2E automation | Route redirect behavior untested at runtime | Manual checklist + consider Playwright story |
| Config assertions via source scan | Refactoring config format could break regex | Tests match actual Nuxt/Better Auth config patterns |
| `convex-test` API changes | Tests may break on major version bumps | Pin `convex-test@0.0.47` in devDependencies |

---

**Generated by BMad TEA Agent** — 2026-04-09
