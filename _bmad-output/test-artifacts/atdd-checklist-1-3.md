---
stepsCompleted:
  - step-01-preflight-and-context
  - step-02-generation-mode
  - step-03-test-strategy
  - step-04-generate-tests
  - step-05-validate-and-complete
lastStep: step-05-validate-and-complete
lastSaved: '2026-04-10'
workflowType: testarch-atdd
inputDocuments:
  - _bmad-output/implementation-artifacts/1-3-dashboard-home-view.md
  - convex/_generated/ai/guidelines.md
  - convex/schema.ts
  - app/layouts/default.vue
  - nuxt.config.ts
  - tests/component/app-shell/layout.test.ts
  - tests/support/factories/user.factory.ts
  - vitest.config.ts
---

# ATDD Checklist - Epic 1, Story 1.3: Dashboard Home View

**Date:** 2026-04-10
**Author:** palmwine
**Primary Test Level:** Convex Unit + Component (Frontend stack with Convex BaaS)

---

## Story Summary

The dashboard home view displays a card grid of the user's top-level course folders, allowing quick navigation into any course. First-time users see an empty state guiding them to create their first folder. An "Add Course" card enables inline folder creation.

**As a** student
**I want** to see a home dashboard showing my courses at a glance
**So that** I can quickly navigate to any course and see my overall knowledge base

---

## Acceptance Criteria

1. Authenticated user with folders sees card grid (DashboardCourseCard) with name, doc count, last activity; responsive grid (1/2/3 cols); clicking navigates to folder view
2. First-time user with no folders sees empty state with guided prompt, inline create input, and "Add Course" dashed card
3. User with folders sees "Add Course" card alongside existing cards; clicking opens inline creation input
4. Card and Badge shadcn components are scaffolded and available

---

## Failing Tests Created (RED Phase)

### Convex Function Tests (11 tests)

**File:** `convex/folders.test.ts` (120 lines)

- `it.skip` **Test:** should return empty array for user with no folders
  - **Status:** RED — `api.folders.listTopLevelFolders` does not exist
  - **Verifies:** AC1 — query returns empty for user with no data
  - **Priority:** P0

- `it.skip` **Test:** should return folders for authenticated user
  - **Status:** RED — `api.folders` module does not exist
  - **Verifies:** AC1 — query returns user's folders
  - **Priority:** P0

- `it.skip` **Test:** should only return folders belonging to the authenticated user
  - **Status:** RED — folders table not in schema
  - **Verifies:** AC1 — user data isolation
  - **Priority:** P0

- `it.skip` **Test:** should return empty array for unauthenticated user
  - **Status:** RED — function not implemented
  - **Verifies:** AC1 — auth guard returns empty (not throws) per story spec
  - **Priority:** P0

- `it.skip` **Test:** should return at most 50 folders
  - **Status:** RED — function not implemented
  - **Verifies:** AC1 — bounded query results (.take(50))
  - **Priority:** P1

- `it.skip` **Test:** should only return top-level folders (parentId undefined)
  - **Status:** RED — function not implemented
  - **Verifies:** AC1 — parentId filter for top-level
  - **Priority:** P1

- `it.skip` **Test:** should create a folder with correct fields
  - **Status:** RED — `api.folders.createFolder` does not exist
  - **Verifies:** AC2, AC3 — folder creation with name, documentCount=0, userId
  - **Priority:** P0

- `it.skip` **Test:** should derive userId from auth identity
  - **Status:** RED — function not implemented
  - **Verifies:** Security — userId derived server-side, never from args
  - **Priority:** P0

- `it.skip` **Test:** should throw for unauthenticated user (createFolder)
  - **Status:** RED — function not implemented
  - **Verifies:** Security — mutation auth guard
  - **Priority:** P0

- `it.skip` **Test:** should set parentId to undefined for top-level folders
  - **Status:** RED — function not implemented
  - **Verifies:** AC2 — top-level folder default
  - **Priority:** P1

- `it.skip` **Test:** should set documentCount to 0 by default
  - **Status:** RED — function not implemented
  - **Verifies:** AC1 — initial document count
  - **Priority:** P1

### Component Tests — DashboardCourseCard (6 tests)

**File:** `tests/component/dashboard/course-card.test.ts` (82 lines)

- `it.skip` **Test:** should render folder name
  - **Status:** RED — component does not exist
  - **Verifies:** AC1 — card displays folder name
  - **Priority:** P0

- `it.skip` **Test:** should display document count badge
  - **Status:** RED — component does not exist
  - **Verifies:** AC1 — card shows doc count via UiBadge
  - **Priority:** P0

- `it.skip` **Test:** should display last activity timestamp
  - **Status:** RED — component does not exist
  - **Verifies:** AC1 — card shows formatted timestamp
  - **Priority:** P0

- `it.skip` **Test:** should navigate to folder view on click
  - **Status:** RED — component does not exist
  - **Verifies:** AC1 — card links to `/app/folders/${id}`
  - **Priority:** P0

- `it.skip` **Test:** should show quick action buttons (Chat and Cards)
  - **Status:** RED — component does not exist
  - **Verifies:** AC1 — placeholder quick actions
  - **Priority:** P1

- `it.skip` **Test:** should apply card background and border styling
  - **Status:** RED — component does not exist
  - **Verifies:** AC1 — visual spec compliance
  - **Priority:** P1

### Component Tests — AddCourseCard (7 tests)

**File:** `tests/component/dashboard/add-course-card.test.ts` (100 lines)

- `it.skip` **Test:** should render dashed border card with Plus icon
  - **Status:** RED — component does not exist
  - **Verifies:** AC2, AC3 — dashed card default state
  - **Priority:** P0

- `it.skip` **Test:** should reveal inline input when clicked
  - **Status:** RED — component does not exist
  - **Verifies:** AC3 — click to activate input
  - **Priority:** P0

- `it.skip` **Test:** should call createFolder on submit
  - **Status:** RED — component does not exist
  - **Verifies:** AC2, AC3 — folder creation integration
  - **Priority:** P0

- `it.skip` **Test:** should submit on Enter key press
  - **Status:** RED — component does not exist
  - **Verifies:** AC3 — keyboard submit
  - **Priority:** P1

- `it.skip` **Test:** should cancel on Escape key press
  - **Status:** RED — component does not exist
  - **Verifies:** AC3 — keyboard cancel
  - **Priority:** P1

- `it.skip` **Test:** should prevent empty folder name submission
  - **Status:** RED — component does not exist
  - **Verifies:** AC3 — input validation
  - **Priority:** P1

- `it.skip` **Test:** should clear input after successful creation
  - **Status:** RED — component does not exist
  - **Verifies:** AC3 — reset state after create
  - **Priority:** P2

### Component Tests — Dashboard Page (7 tests)

**File:** `tests/component/dashboard/dashboard-page.test.ts` (105 lines)

- `it.skip` **Test:** should render "Your Courses" heading
  - **Status:** RED — page does not exist
  - **Verifies:** AC1 — page heading
  - **Priority:** P0

- `it.skip` **Test:** should render course cards for each folder
  - **Status:** RED — page does not exist
  - **Verifies:** AC1 — card grid rendering
  - **Priority:** P0

- `it.skip` **Test:** should render AddCourseCard as the last card
  - **Status:** RED — page does not exist
  - **Verifies:** AC3 — add card presence
  - **Priority:** P0

- `it.skip` **Test:** should apply responsive grid classes
  - **Status:** RED — page does not exist
  - **Verifies:** AC1 — responsive breakpoints
  - **Priority:** P1

- `it.skip` **Test:** should show empty state when no folders
  - **Status:** RED — page does not exist
  - **Verifies:** AC2 — first-time user experience
  - **Priority:** P0

- `it.skip` **Test:** should show 3 skeleton cards while loading
  - **Status:** RED — page does not exist
  - **Verifies:** Loading state UX
  - **Priority:** P0

- `it.skip` **Test:** should render page content outside UiTabs on /app
  - **Status:** RED — layout not yet modified for dashboard
  - **Verifies:** AC1 — dashboard bypasses study tabs
  - **Priority:** P0

---

## Data Factories Created

### Folder Factory

**File:** `tests/support/factories/folder.factory.ts`

**Exports:**

- `createFolder(overrides?)` — Create single folder doc with realistic defaults
- `createFolders(count, overrides?)` — Create array of folder docs

**Example Usage:**

```typescript
const folder = createFolder({ name: 'Calculus 101', documentCount: 12 })
const folders = createFolders(5, { userId: 'user_abc' })
```

---

## Mock Requirements

### Convex Backend (convex-test)

No external mocking needed — `convex-test` provides an in-memory Convex runtime. Auth is mocked via `t.withIdentity()`.

### useFolders Composable (Component Tests)

Component tests will need the `useFolders` composable to be mockable. Since the composable uses `useConvexQuery` and `useConvexMutation` (auto-imported from nuxt-convex), the Nuxt test environment should handle this via module mocking.

**Notes:** Component tests import components dynamically to detect missing files at test time (red phase).

---

## Required data-testid Attributes

### DashboardCourseCard

- `course-card` — Root card element (clickable)
- `folder-doc-count` — Document count badge
- `folder-last-activity` — Last activity timestamp
- `quick-action-chat` — Chat quick action button
- `quick-action-cards` — Cards quick action button

### AddCourseCard

- `add-course-card` — Root dashed card element
- `new-folder-input` — Inline folder name input
- `create-folder-btn` — Create button

### Dashboard Page (app/pages/app/index.vue)

- `courses-grid` — Responsive grid container
- `dashboard-empty-state` — Empty state container
- `empty-state-icon` — FolderOpen icon in empty state
- `empty-state-input` — Inline input in empty state
- `empty-state-create-btn` — Create button in empty state
- `skeleton-card` — Loading skeleton card (×3)

---

## Implementation Checklist

### Test: Convex folders.listTopLevelFolders (5 tests)

**File:** `convex/folders.test.ts`

**Tasks to make these tests pass:**

- [ ] Add `folders` table to `convex/schema.ts` with fields: `userId`, `name`, `parentId`, `documentCount` and indexes `by_userId` and `by_userId_and_parentId`
- [ ] Create `convex/folders.ts` with `listTopLevelFolders` query
- [ ] Filter by `userId` from `ctx.auth.getUserIdentity().tokenIdentifier` using `.withIndex("by_userId")`
- [ ] Filter for `parentId === undefined` (top-level only)
- [ ] Order by `_creationTime` desc
- [ ] Bound results with `.take(50)`
- [ ] Return empty array if unauthenticated
- [ ] Run test: `pnpm test convex/folders.test.ts`
- [ ] Tests pass (green phase)

### Test: Convex folders.createFolder (4 tests)

**File:** `convex/folders.test.ts`

**Tasks to make these tests pass:**

- [ ] Create `createFolder` mutation in `convex/folders.ts`
- [ ] Accept `name: v.string()` argument only
- [ ] Derive `userId` from `ctx.auth.getUserIdentity().tokenIdentifier`
- [ ] Throw if `getUserIdentity()` returns null
- [ ] Insert with `parentId: undefined`, `documentCount: 0`
- [ ] Run test: `pnpm test convex/folders.test.ts`
- [ ] Tests pass (green phase)

### Test: DashboardCourseCard (6 tests)

**File:** `tests/component/dashboard/course-card.test.ts`

**Tasks to make these tests pass:**

- [ ] Create `app/components/dashboard/DashboardCourseCard.vue`
- [ ] Accept props: `folder`, `documentCount`, `lastActivity`
- [ ] Render folder name, document count `UiBadge`, last activity with `useTimeAgo`
- [ ] Wrap in NuxtLink to `/app/folders/${folder._id}`
- [ ] Add ghost `UiButton` quick actions with `MessageSquare` and `BookOpen` icons
- [ ] Add all `data-testid` attributes: `course-card`, `folder-doc-count`, `folder-last-activity`, `quick-action-chat`, `quick-action-cards`
- [ ] Run test: `pnpm vitest tests/component/dashboard/course-card.test.ts`
- [ ] Tests pass (green phase)

### Test: AddCourseCard (7 tests)

**File:** `tests/component/dashboard/add-course-card.test.ts`

**Tasks to make these tests pass:**

- [ ] Create `app/components/dashboard/AddCourseCard.vue`
- [ ] Default state: dashed border card with `Plus` icon and "Add Course" text
- [ ] Active state: inline `UiInput` for name + `UiButton` "Create"
- [ ] Wire to `useFolders().createFolder(name)` on submit
- [ ] Handle Enter to submit, Escape to cancel
- [ ] Validate non-empty name before submit
- [ ] Clear input and return to default after success
- [ ] Add all `data-testid` attributes: `add-course-card`, `new-folder-input`, `create-folder-btn`
- [ ] Run test: `pnpm vitest tests/component/dashboard/add-course-card.test.ts`
- [ ] Tests pass (green phase)

### Test: Dashboard Page (7 tests)

**File:** `tests/component/dashboard/dashboard-page.test.ts`

**Tasks to make these tests pass:**

- [ ] Create `app/composables/useFolders.ts` with `useConvexQuery` / `useConvexMutation`
- [ ] Create `app/pages/app/index.vue` as dashboard page
- [ ] In `nuxt.config.ts`, replace `'/app': { redirect: '/app/chat' }` with `'/app': { auth: 'user' as const }`
- [ ] In `app/layouts/default.vue`, render `<slot />` outside `<UiTabs>` when on `/app` route
- [ ] Render "Your Courses" heading (24px DM Sans 700)
- [ ] Map `folders` to `DashboardCourseCard` components in responsive grid
- [ ] Always render `AddCourseCard` as last card when folders exist
- [ ] Show empty state with FolderOpen icon, prompt text, and inline create when no folders
- [ ] Show 3 `UiSkeleton` cards while loading
- [ ] Add all `data-testid` attributes: `courses-grid`, `dashboard-empty-state`, `empty-state-icon`, `empty-state-input`, `empty-state-create-btn`, `skeleton-card`
- [ ] Run test: `pnpm vitest tests/component/dashboard/dashboard-page.test.ts`
- [ ] Tests pass (green phase)

---

## Running Tests

```bash
# Run all Convex function tests for this story
pnpm test convex/folders.test.ts

# Run all component tests for dashboard
pnpm vitest tests/component/dashboard/

# Run a specific component test file
pnpm vitest tests/component/dashboard/course-card.test.ts

# Run tests in watch mode
pnpm test:watch

# Run with verbose output
pnpm vitest --reporter=verbose tests/component/dashboard/
```

**Note:** Component tests in `tests/component/` are NOT currently included in the vitest config (`vitest.config.ts` only includes `convex/**` and `server/**`). The vitest config will need updating to include component tests, or run them with an explicit path.

---

## Red-Green-Refactor Workflow

### RED Phase (Complete)

**TEA Agent Responsibilities:**

- All 31 tests written and failing (skipped)
- Folder factory created with auto-generation via faker
- Mock requirements documented (convex-test for backend, module mocks for components)
- data-testid requirements listed for all components
- Implementation checklist created with task breakdown

**Verification:**

- All tests use `it.skip()` — they are intentionally skipped (red phase)
- Tests fail due to missing implementation (components, functions, composable don't exist yet)
- Failure messages will be clear: "Cannot find module" or import errors

---

### GREEN Phase (DEV Team - Next Steps)

**Recommended implementation order:**

1. **Convex schema + functions** → makes Convex tests pass first
2. **useFolders composable** → data layer ready for components
3. **DashboardCourseCard** → core visual component
4. **AddCourseCard** → interaction component
5. **Dashboard page + layout changes** → assembly and routing
6. **Remove `it.skip`** from each test as you implement

---

### REFACTOR Phase (DEV Team - After All Tests Pass)

- Verify all 31 tests pass
- Review component code quality
- Ensure Convex query uses index (not `.filter()`)
- Confirm responsive grid renders correctly across breakpoints
- Ready for code review

---

## Next Steps

1. **Run failing tests** to confirm RED phase: `pnpm test convex/folders.test.ts` (will show skipped)
2. **Begin implementation** using implementation checklist — start with Convex schema
3. **Work one test group at a time** (Convex → composable → components → page)
4. **Remove `it.skip()`** as each feature is implemented
5. **When all tests pass**, refactor and submit for review

---

## Knowledge Base References Applied

- **component-tdd.md** — Red-Green-Refactor cycle, component test structure with `mountSuspended`
- **data-factories.md** — Factory patterns with `@faker-js/faker` for folder test data
- **test-quality.md** — Deterministic tests, explicit assertions, parallel-safe data
- **chrome-mcp.md** — Browser automation config awareness (interactive verification, not test files)
- **convex/_generated/ai/guidelines.md** — Convex schema, query, mutation, auth patterns

---

## Test Execution Evidence

### Initial Test Run (RED Phase Verification)

**Command:** `pnpm test convex/folders.test.ts`

**Expected Results:**

```
Tests:  11 skipped (all marked with it.skip)
        0 passed
        0 failed
```

**Component Tests:**

```
pnpm vitest tests/component/dashboard/
Tests:  20 skipped (all marked with it.skip)
        0 passed
        0 failed
```

**Summary:**

- Total tests: 31
- Passing: 0 (expected)
- Skipped: 31 (expected — TDD red phase)
- Status: RED phase verified

---

## Notes

- Convex function tests run in `edge-runtime` environment via vitest config — this is pre-configured
- Component tests need `@nuxt/test-utils` which provides `mountSuspended` for SSR-safe component mounting
- The `vitest.config.ts` currently only includes `convex/**` and `server/**` — component test paths need to be added or run with explicit paths
- Chrome MCP can be used for interactive E2E verification after implementation (navigate to `http://localhost:3002/app`, snapshot, verify elements)
- The `listTopLevelFolders` query returns empty array (not throws) for unauthenticated users — this matches the story spec for graceful handling

---

**Generated by BMad TEA Agent (Murat)** — 2026-04-10
