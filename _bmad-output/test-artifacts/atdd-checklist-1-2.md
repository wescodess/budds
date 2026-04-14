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
  - _bmad-output/implementation-artifacts/1-2-app-shell-layout-with-responsive-navigation.md
  - app/app.vue
  - app/pages/app/chat.vue
  - app/pages/login.vue
  - app/pages/index.vue
  - app/assets/css/tailwind.css
  - vitest.config.ts
  - package.json
  - _bmad/tea/agents/bmad-tea/resources/knowledge/data-factories.md
  - _bmad/tea/agents/bmad-tea/resources/knowledge/component-tdd.md
  - _bmad/tea/agents/bmad-tea/resources/knowledge/test-quality.md
  - _bmad/tea/agents/bmad-tea/resources/knowledge/selector-resilience.md
  - _bmad/tea/agents/bmad-tea/resources/knowledge/test-healing-patterns.md
---

# ATDD Checklist - Epic 1, Story 1.2: App Shell Layout with Responsive Navigation

**Date:** 2026-04-09
**Author:** palmwine
**Primary Test Level:** Component (Vitest + @nuxt/test-utils)

---

## Story Summary

Create a clean, navigable app shell with a persistent sidebar, study mode tabs, breadcrumb navigation, dark/light mode toggle, and responsive behavior across mobile, tablet, and desktop viewports.

**As a** student
**I want** a clean, navigable app shell with sidebar and study mode tabs
**So that** I can move between my folders, chats, and study modes without confusion

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
| vitest | 4.1.4 | Test runner |
| @nuxt/test-utils | **NOT INSTALLED** | Component mounting with Nuxt context |
| happy-dom | **NOT INSTALLED** | DOM environment for component tests |
| @faker-js/faker | **NOT INSTALLED** | Data factory random generation |

**Note**: No Playwright installed. E2E verification via Chrome MCP (interactive). Component tests are the primary automated test level for this UI-focused story.

### Test Level Mapping

| AC | Test Level | Priority | Justification |
|----|------------|----------|---------------|
| AC1 | Component | P0 | Core layout structure — sidebar, tabs, breadcrumb, skip-to-content must render correctly |
| AC2 | Component | P0/P1 | Mobile responsive behavior — sidebar hidden, Sheet overlay, horizontal scroll tabs |
| AC3 | Component | P1/P2 | Tablet layout — sidebar visible, no source panel |
| AC4 | Component | P0/P1 | Dark mode default, theme toggle, semantic HTML landmarks |
| AC5 | Component | P0 | shadcn-nuxt primitives scaffolded and importable |

### Generation Mode

**AI Generation** — Acceptance criteria are clear with standard UI layout patterns. No complex interactions requiring live browser recording.

### Execution Mode

**Sequential** — No subagent runtime available. API tests skipped (no new endpoints in this story).

---

## Acceptance Criteria

1. **AC1** — Desktop (>1024px): persistent sidebar (w-64), study mode tabs (Chat, Flash Cards, Quiz, Documents), breadcrumb, skip-to-content link
2. **AC2** — Mobile (<768px): sidebar hidden, Sheet overlay via menu button, horizontal scroll tabs, mobile breadcrumb with back arrow
3. **AC3** — Tablet (768-1024px): sidebar visible, no source panel
4. **AC4** — Design tokens: Inter/DM Sans fonts, type scale, semantic colors, dark mode default, light/dark toggle, 4.5:1 contrast, semantic HTML landmarks
5. **AC5** — shadcn-nuxt components scaffolded: Button, Tabs, Sheet, Separator, ScrollArea, Skeleton, Sidebar, Breadcrumb, DropdownMenu, Tooltip

---

## Failing Tests Created (RED Phase)

### Component Tests (27 tests)

**File:** `tests/component/app-shell/layout.test.ts` (90 lines)

- `[P0] should render a persistent sidebar on desktop viewport` — RED: `~/layouts/default.vue` does not exist
- `[P0] should render Folders group with empty state placeholder in sidebar` — RED: layout not implemented
- `[P0] should render Recent Chats group with empty state placeholder in sidebar` — RED: layout not implemented
- `[P0] should render study mode tabs with Chat, Flash Cards, Quiz, Documents` — RED: layout not implemented
- `[P0] should render breadcrumb navigation in the header area` — RED: layout not implemented
- `[P0] should render skip-to-content link as the first focusable element` — RED: layout not implemented
- `[P1] should render sign-out button in sidebar footer` — RED: layout not implemented
- `[P1] should render user avatar and name in sidebar footer` — RED: layout not implemented
- `[P1] should render main content area with slot for page content` — RED: layout not implemented
- `[P0] should use aside element for sidebar` — RED: semantic HTML not implemented
- `[P0] should use main element for content area` — RED: semantic HTML not implemented
- `[P0] should use nav elements for navigation sections` — RED: semantic HTML not implemented

**File:** `tests/component/app-shell/responsive.test.ts` (70 lines)

- `[P0] should hide sidebar by default on mobile` — RED: layout not implemented
- `[P0] should render a menu button that opens sidebar as Sheet overlay on mobile` — RED: layout not implemented
- `[P1] should allow horizontal scrolling of study mode tabs on mobile` — RED: layout not implemented
- `[P1] should render breadcrumb with back arrow on mobile` — RED: layout not implemented
- `[P1] should render sidebar as visible on tablet breakpoint` — RED: layout not implemented
- `[P2] should not render source panel on tablet breakpoint` — RED: layout not implemented
- `[P0] should render sidebar with w-64 width on desktop` — RED: layout not implemented
- `[P0] should fill remaining width with main content on desktop` — RED: layout not implemented

**File:** `tests/component/app-shell/theme-toggle.test.ts` (40 lines)

- `[P0] should use dark mode as the default theme` — RED: theme toggle not implemented
- `[P0] should render a dark/light mode toggle button` — RED: toggle not implemented
- `[P1] should switch to light mode when toggle is clicked` — RED: toggle not implemented
- `[P1] should switch back to dark mode when toggle is clicked again` — RED: toggle not implemented

**File:** `tests/component/app-shell/study-mode-tabs.test.ts` (60 lines)

- `[P0] should render tabs with correct role attributes` — RED: tabs not implemented
- `[P0] should set Chat as the default active tab` — RED: tabs not implemented
- `[P1] should show placeholder content for Flash Cards tab` — RED: tabs not implemented
- `[P1] should show placeholder content for Quiz tab` — RED: tabs not implemented
- `[P1] should show placeholder content for Documents tab` — RED: tabs not implemented
- `[P0] should use primary amber accent for active tab indicator` — RED: tabs not implemented

**File:** `tests/component/app-shell/breadcrumb.test.ts` (50 lines)

- `[P0] should render breadcrumb with Home segment linking to /app` — RED: breadcrumb not implemented
- `[P1] should render breadcrumb segments as clickable links` — RED: breadcrumb not implemented
- `[P0] should have UiSidebar component available for rendering` — RED: shadcn not scaffolded
- `[P0] should have UiTabs component available for rendering` — RED: shadcn not scaffolded
- `[P0] should have UiBreadcrumb component available for rendering` — RED: shadcn not scaffolded
- `[P1] should have UiSidebarTrigger component for mobile menu` — RED: shadcn not scaffolded

### API Tests (0 tests)

No API endpoints are created by this story. The Convex `getUser` query already exists from Story 1.1.

---

## Data Factories Created

### User Factory

**File:** `tests/support/factories/user.factory.ts`

**Exports:**

- `createUser(overrides?)` — Create single user with optional overrides
- `createUsers(count)` — Create array of users

**Example Usage:**

```typescript
const user = createUser({ name: 'Test Student' })
const users = createUsers(5)
```

---

## Fixtures Created

No Playwright fixtures needed — tests use Vitest component mounting via `@nuxt/test-utils`. The `mountSuspended()` helper handles component setup/teardown automatically.

---

## Mock Requirements

### Auth Session Mock

The layout renders user data (avatar, name) from Convex `getUser` query and provides `signOut()` from `useUserSession()`. Component tests will need:

- **`useUserSession()`** — Mock returning `{ loggedIn: true, signOut: vi.fn() }`
- **Convex `getUser` query** — Mock returning user factory data

**Notes:** These are Nuxt auto-imported composables. Mock via `vi.mock()` or `@nuxt/test-utils` mock helpers. Exact mock patterns depend on `@nuxt/test-utils` version installed.

---

## Required data-testid Attributes

### App Shell Layout (`app/layouts/default.vue`)

- `skip-to-content` — Skip-to-content accessibility link (first focusable element)
- `app-sidebar` — Main sidebar container (aside element)
- `sidebar-folders-group` — Folders section in sidebar
- `sidebar-folders-empty` — Empty state placeholder for folders
- `sidebar-chats-group` — Recent Chats section in sidebar
- `sidebar-chats-empty` — Empty state placeholder for chats
- `sidebar-sign-out` — Sign-out button in sidebar footer
- `sidebar-user-avatar` — User avatar display in sidebar footer
- `sidebar-user-name` — User name display in sidebar footer
- `sidebar-trigger` — Mobile hamburger menu button
- `sidebar-sheet` — Mobile Sheet overlay for sidebar
- `breadcrumb-nav` — Breadcrumb navigation container
- `breadcrumb-mobile` — Mobile-specific breadcrumb with back arrow
- `breadcrumb-back` — Back arrow button in mobile breadcrumb
- `tabs-container` — Study mode tabs container
- `theme-toggle` — Dark/light mode toggle button
- `main-content` — Main content area (also used as `id` for skip-to-content target)
- `source-panel` — Source panel (should NOT exist on tablet — negative test)

**Implementation Example:**

```vue
<a data-testid="skip-to-content" href="#main-content" class="sr-only focus:not-sr-only">
  Skip to content
</a>
<UiSidebar data-testid="app-sidebar">
  <!-- sidebar content -->
</UiSidebar>
<main id="main-content" data-testid="main-content">
  <UiBreadcrumb data-testid="breadcrumb-nav" />
  <UiTabs data-testid="tabs-container" />
  <slot />
</main>
```

---

## Implementation Checklist

### Pre-requisite: Install Component Test Dependencies

**Tasks:**

- [ ] Install: `pnpm add -D @nuxt/test-utils @vue/test-utils happy-dom @faker-js/faker`
- [ ] Update `vitest.config.ts` to include `tests/component/**/*.test.ts` with `happy-dom` environment
- [ ] Verify tests are discoverable: `pnpm vitest run tests/component/ --reporter=verbose`
- [ ] All 27 tests should be discovered and SKIPPED (all use `it.skip()`)

**Estimated Effort:** 0.5 hours

---

### Test: Layout renders sidebar with semantic HTML (AC1, AC4)

**File:** `tests/component/app-shell/layout.test.ts`

**Tasks to make this test pass:**

- [ ] Scaffold shadcn components: `pnpm dlx shadcn-vue@latest add button tabs sheet separator scroll-area skeleton sidebar breadcrumb dropdown-menu tooltip badge card avatar`
- [ ] Create `app/layouts/default.vue` with `<UiSidebarProvider>` + `<UiSidebar>` structure
- [ ] Add `<aside>` landmark via `<UiSidebar>` component
- [ ] Add Folders group with `data-testid="sidebar-folders-group"` and empty state
- [ ] Add Recent Chats group with `data-testid="sidebar-chats-group"` and empty state
- [ ] Add sign-out button in sidebar footer using `signOut()` from `useUserSession()`
- [ ] Add user avatar/name display using Convex `getUser` query
- [ ] Add `<main id="main-content">` content area with `<slot />`
- [ ] Add `<nav>` elements for navigation sections
- [ ] Add required data-testid attributes: `app-sidebar`, `sidebar-folders-group`, `sidebar-folders-empty`, `sidebar-chats-group`, `sidebar-chats-empty`, `sidebar-sign-out`, `sidebar-user-avatar`, `sidebar-user-name`, `main-content`
- [ ] Remove `it.skip` → `it` for passing tests
- [ ] Run test: `pnpm vitest run tests/component/app-shell/layout.test.ts`

**Estimated Effort:** 3 hours

---

### Test: Responsive sidebar behavior (AC1, AC2, AC3)

**File:** `tests/component/app-shell/responsive.test.ts`

**Tasks to make this test pass:**

- [ ] Desktop (>1024px / `lg:`): sidebar persistent, visible, w-64
- [ ] Tablet (768-1024px / `md:`): sidebar persistent, visible
- [ ] Mobile (<768px): sidebar hidden by default
- [ ] Add `<UiSidebarTrigger>` (hamburger menu) that opens sidebar as Sheet overlay on mobile
- [ ] Sheet closes on outside tap or explicit close
- [ ] Main content fills remaining width
- [ ] No source panel rendered at any breakpoint (future story)
- [ ] Add required data-testid attributes: `sidebar-trigger`, `sidebar-sheet`, `source-panel` (should not exist)
- [ ] Remove `it.skip` → `it` for passing tests
- [ ] Run test: `pnpm vitest run tests/component/app-shell/responsive.test.ts`

**Estimated Effort:** 2 hours

---

### Test: Dark/light mode toggle (AC4)

**File:** `tests/component/app-shell/theme-toggle.test.ts`

**Tasks to make this test pass:**

- [ ] Use `useColorMode()` from VueUse (`@vueuse/core` already installed)
- [ ] Add toggle button with `data-testid="theme-toggle"` in sidebar header or footer
- [ ] Dark mode as default — `.dark` class on `<html>` element
- [ ] Toggle switches between dark/light by adding/removing `.dark` class
- [ ] Respect `prefers-color-scheme` for initial state if no stored preference
- [ ] Remove `it.skip` → `it` for passing tests
- [ ] Run test: `pnpm vitest run tests/component/app-shell/theme-toggle.test.ts`

**Estimated Effort:** 1 hour

---

### Test: Study mode tabs (AC1, AC2)

**File:** `tests/component/app-shell/study-mode-tabs.test.ts`

**Tasks to make this test pass:**

- [ ] Add `<UiTabs>` component with `role="tablist"` in main content header
- [ ] Four tabs: Chat, Flash Cards, Quiz, Documents with `role="tab"`
- [ ] Chat as default active tab with `aria-selected="true"`
- [ ] Flash Cards, Quiz, Documents show "Coming soon" placeholder content
- [ ] Active tab uses bottom border accent in `--primary` amber
- [ ] On mobile: tabs container has `overflow-x: auto` for horizontal scrolling
- [ ] Arrow key navigation supported (built into Reka UI Tabs)
- [ ] Add required data-testid: `tabs-container`
- [ ] Remove `it.skip` → `it` for passing tests
- [ ] Run test: `pnpm vitest run tests/component/app-shell/study-mode-tabs.test.ts`

**Estimated Effort:** 1.5 hours

---

### Test: Breadcrumb navigation and shadcn availability (AC1, AC5)

**File:** `tests/component/app-shell/breadcrumb.test.ts`

**Tasks to make this test pass:**

- [ ] Add `<UiBreadcrumb>` component with `data-testid="breadcrumb-nav"` in header
- [ ] Static breadcrumb showing "Home" linking to `/app`
- [ ] On mobile: show back arrow + current page name
- [ ] Breadcrumb segments are clickable links
- [ ] Verify UiSidebar, UiTabs, UiBreadcrumb, UiSidebarTrigger render without errors
- [ ] Add required data-testid: `breadcrumb-nav`, `breadcrumb-mobile`, `breadcrumb-back`
- [ ] Remove `it.skip` → `it` for passing tests
- [ ] Run test: `pnpm vitest run tests/component/app-shell/breadcrumb.test.ts`

**Estimated Effort:** 1 hour

---

### Test: Chat page refactor (AC1) — Manual Verification

**No automated test file.** Verify manually or via Chrome MCP:

- [ ] Remove `layout: false` from `app/pages/app/chat.vue`
- [ ] Remove sign-out button and header chrome from chat.vue (moved to layout)
- [ ] Keep chat message list, input area, and source citation display
- [ ] Model selector stays in chat content area (chat-specific)
- [ ] Verify `useRag()` composable still works in new layout structure
- [ ] Update `app/app.vue` to wrap `<NuxtPage />` with `<NuxtLayout>`
- [ ] Add `definePageMeta({ layout: false })` to `app/pages/login.vue` and `app/pages/index.vue`

**Estimated Effort:** 1 hour

---

## Running Tests

```bash
# Run all component tests for this story
pnpm vitest run tests/component/app-shell/

# Run specific test file
pnpm vitest run tests/component/app-shell/layout.test.ts

# Run tests in watch mode (see changes live)
pnpm vitest tests/component/app-shell/

# Run with verbose reporter
pnpm vitest run tests/component/app-shell/ --reporter=verbose

# Debug specific test (with console output)
pnpm vitest run tests/component/app-shell/layout.test.ts --reporter=verbose
```

---

## Red-Green-Refactor Workflow

### RED Phase (Complete)

**TEA Agent Responsibilities:**

- All 27 component tests written and skipped (`it.skip()`)
- User data factory created with faker-based generation
- Mock requirements documented for `useUserSession()` and Convex `getUser`
- 18 `data-testid` attributes listed for DEV team
- Implementation checklist created with effort estimates

**Verification:**

- Tests cannot run (vitest config excludes `tests/component/`)
- `@nuxt/test-utils` not installed (import would fail)
- `~/layouts/default.vue` does not exist (component import would fail)
- All failures are due to missing implementation, not test bugs

---

### GREEN Phase (DEV Team — Next Steps)

**DEV Agent Responsibilities:**

1. Install test dependencies: `pnpm add -D @nuxt/test-utils @vue/test-utils happy-dom @faker-js/faker`
2. Update `vitest.config.ts` to include component tests
3. Scaffold shadcn components via CLI
4. Create `app/layouts/default.vue` with full app shell structure
5. Pick one failing test at a time, implement minimal code to make it pass
6. Remove `it.skip` from that test, run it, verify GREEN
7. Move to next test and repeat

**Key Principles:**

- One test at a time
- Minimal implementation (don't over-engineer)
- Run tests frequently
- Use implementation checklist as roadmap

---

### REFACTOR Phase (DEV Team — After All Tests Pass)

1. Verify all 27 tests pass
2. Review code quality — Tailwind utility classes only (no `<style>` blocks)
3. Ensure no manual Vue API imports (Nuxt auto-imports)
4. Verify semantic HTML landmarks pass accessibility checks
5. Verify contrast ratios in both light and dark mode
6. Run all tests after each refactor
7. Do not change test behavior (only implementation)

---

## Next Steps

1. **Review this checklist** with the dev team
2. **Install test dependencies** as first DEV task
3. **Run failing tests** to confirm RED phase: `pnpm vitest run tests/component/app-shell/`
4. **Begin implementation** using the checklist as guide
5. **Work one test at a time** (red -> green for each)
6. **When all tests pass**, refactor code for quality
7. **When refactoring complete**, update story status to 'done' in sprint-status.yaml

---

## Knowledge Base References Applied

- **data-factories.md** — Factory patterns using `@faker-js/faker` for user data generation with overrides
- **component-tdd.md** — Red-Green-Refactor workflow, component mounting, accessibility assertions
- **test-quality.md** — Deterministic tests, isolation, one assertion per test, no hard waits
- **selector-resilience.md** — data-testid priority, ARIA roles, semantic selectors
- **test-healing-patterns.md** — Common failure patterns and diagnostic signatures

See `tea-index.csv` for complete knowledge fragment mapping.

---

## Test Execution Evidence

### Initial Test Run (RED Phase Verification)

**Command:** `pnpm vitest run tests/component/app-shell/`

**Results:**

```
 RUN  v4.1.4 /Users/wesleyukadike/Desktop/budds

No test files found, exiting with code 1

filter: tests/component/app-shell/
include: convex/**/*.test.ts, server/**/*.test.ts
```

**Summary:**

- Total tests: 27 (across 5 files)
- Discovered: 0 (vitest config excludes `tests/component/`)
- Status: RED phase verified — tests cannot even be discovered

**Expected Failure Chain:**

1. `vitest.config.ts` `include` pattern does not cover `tests/component/**`
2. `@nuxt/test-utils` package not installed → `Cannot find module '@nuxt/test-utils/runtime'`
3. `~/layouts/default.vue` does not exist → `Cannot find module '~/layouts/default.vue'`
4. `@faker-js/faker` not installed → `Cannot find module '@faker-js/faker'`

---

## Notes

- This story creates **no API endpoints** — all tests are at the Component level
- Chrome MCP (`tea_browser_automation: chrome-mcp`) is configured for interactive E2E verification but not used for automated test generation
- The model selector dropdown should **remain** in `chat.vue` (chat-specific, not shell chrome)
- Sidebar CSS tokens (`--sidebar`, `--sidebar-foreground`, etc.) are already defined in `tailwind.css`
- Both light and dark theme tokens already exist in `tailwind.css` — no new token work needed

---

**Generated by BMad TEA Agent** — 2026-04-09
