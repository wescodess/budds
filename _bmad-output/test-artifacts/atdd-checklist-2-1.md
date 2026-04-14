---
stepsCompleted:
  - step-01-preflight-and-context
  - step-02-generation-mode
  - step-03-test-strategy
  - step-04-generate-tests
  - step-04c-aggregate
  - step-05-validate-and-complete
lastStep: step-05-validate-and-complete
lastSaved: '2026-04-10'
workflowType: testarch-atdd
inputDocuments:
  - _bmad-output/implementation-artifacts/2-1-create-and-navigate-folder-hierarchy.md
  - convex/folders.ts
  - convex/schema.ts
  - app/components/sidebar/FolderTree.vue
  - app/composables/useFolders.ts
  - app/layouts/default.vue
  - convex/_generated/ai/guidelines.md
---

# ATDD Checklist — Epic 2, Story 2.1: Create and Navigate Folder Hierarchy

**Date:** 2026-04-10
**Author:** palmwine
**Primary Test Level:** Convex Integration + Vue Component

---

## Story Summary

Students need to create course folders up to 3 levels deep and navigate them in a sidebar tree, with active folder highlighting, breadcrumb navigation, and keyboard accessibility.

**As a** student
**I want** to create course folders up to 3 levels deep and navigate them in a tree
**So that** I can organize my materials by semester, course, and topic

---

## Acceptance Criteria

1. Root folder creation → `folders` table record with `parentId: null`, appears in FolderTree
2. Subfolder creation with `parentId` referencing parent, real-time FolderTree update
3. Depth limit: prevent folder creation at depth 4, show "Maximum folder depth (3 levels) reached"
4. FolderTree expand/collapse, navigation to `/app/folders/[id]`, active highlight with `bg-muted`, breadcrumb hierarchy
5. Keyboard navigation: arrow keys, Enter, `role="tree"`, `role="treeitem"`, `aria-expanded`
6. Collapsible shadcn component scaffolded

---

## Failing Tests Created (RED Phase)

### Convex Integration Tests (22 tests)

**File:** `convex/folders.test.ts` (appended to existing file)

- `folders.createSubfolder` (5 tests):
  - **[P0]** should create a subfolder under a parent folder — RED: `api.folders.createSubfolder` not defined
  - **[P0]** should throw for unauthenticated user — RED: function missing
  - **[P0]** should enforce max depth of 3 levels — RED: function missing
  - **[P1]** should allow creating multiple children under the same parent — RED: function missing
  - **[P1]** should not allow creating a subfolder under another user's folder — RED: function missing

- `folders.listChildFolders` (4 tests):
  - **[P0]** should return children of a given parent folder — RED: `api.folders.listChildFolders` not defined
  - **[P0]** should return empty array when parent has no children — RED: function missing
  - **[P0]** should only return children belonging to the authenticated user — RED: function missing
  - **[P1]** should not return grandchildren (only direct children) — RED: function missing

- `folders.getFolder` (4 tests):
  - **[P0]** should return a folder by id for the authenticated owner — RED: `api.folders.getFolder` not defined
  - **[P0]** should return null when folder belongs to a different user — RED: function missing
  - **[P0]** should return null for unauthenticated user — RED: function missing
  - **[P1]** should return subfolder with parentId populated — RED: function missing

- `folders.getFolderAncestors` (5 tests):
  - **[P0]** should return empty array for a top-level folder — RED: `api.folders.getFolderAncestors` not defined
  - **[P0]** should return parent for a depth-2 folder — RED: function missing
  - **[P0]** should return full ancestor chain for a depth-3 folder (root first) — RED: function missing
  - **[P1]** should only return _id and name fields in ancestor objects — RED: function missing
  - **[P1]** should return empty array for unauthenticated user — RED: function missing

- `folders.listAllFolders` (4 tests):
  - **[P0]** should return all folders for authenticated user — RED: uses `createSubfolder` which doesn't exist
  - **[P0]** should be bounded with take(500) — RED: `listAllFolders` still uses `.collect()`
  - **[P0]** should return empty array for unauthenticated user — RED: assertion expects `[]`
  - **[P1]** should not return folders from other users — RED: uses `createSubfolder`

### Component Tests (13 tests)

**File:** `tests/component/sidebar/folder-tree.test.ts` (7 tests)

- `FolderTree — AC4` (4 tests):
  - **[P0]** should render folder names from folders prop — RED: new `activeFolder` prop not implemented
  - **[P0]** should highlight active folder with bg-muted styling — RED: `activeFolder` prop doesn't exist
  - **[P0]** should have role="tree" on tree root — RED: verify reka-ui provides it
  - **[P0]** should have role="treeitem" on folder items — RED: verify reka-ui provides it

- `FolderTree — AC5` (3 tests):
  - **[P1]** should show subfolder creation "+" button (depth < 3) — RED: button not implemented
  - **[P1]** should hide "+" button on level-3 folders — RED: depth enforcement not implemented
  - **[P1]** should have aria-expanded on expandable items — RED: verify reka-ui provides it

**File:** `tests/component/folders/folder-view.test.ts` (3 tests)

- `FolderView — AC4` (3 tests):
  - **[P0]** should render folder name as heading — RED: page `app/pages/app/folders/[id].vue` doesn't exist
  - **[P0]** should show "Documents will appear here" empty state — RED: page doesn't exist
  - **[P1]** should show "New Subfolder" button — RED: page doesn't exist

**File:** `tests/component/app-shell/folder-breadcrumb.test.ts` (3 tests)

- `App Shell Layout — AC4` (3 tests):
  - **[P0]** should show "Home" link on folder page — RED: breadcrumb not folder-aware
  - **[P0]** should show folder name in breadcrumb for root-level folder — RED: `getFolderAncestors` not wired
  - **[P1]** should show full ancestor hierarchy in breadcrumb — RED: ancestor query not implemented

---

## Data Factories

### Folder Factory (existing — no changes needed)

**File:** `tests/support/factories/folder.factory.ts`

**Exports:**
- `createFolder(overrides?)` — Create single folder with optional overrides (supports `parentId`)
- `createFolders(count, overrides?)` — Create array of folders

Already supports hierarchy testing via `parentId` override.

---

## Mock Requirements

No external service mocking needed. Convex integration tests use `convex-test` with in-memory database. Component tests use `it.skip()` — no mocking required in RED phase.

---

## Required data-testid Attributes

### FolderTree Component (`app/components/sidebar/FolderTree.vue`)

- `folder-tree-item-{id}` — Individual folder tree node (for active state targeting)
- `add-subfolder-{id}` — "+" button for creating subfolder on a specific folder

### Folder View Page (`app/pages/app/folders/[id].vue`)

- `folder-heading` — Folder name heading element
- `folder-empty-state` — Empty state container with "Documents will appear here"
- `new-subfolder-button` — Button to create a new subfolder

### Breadcrumb (`app/layouts/default.vue`)

- `breadcrumb-folder-current` — Current folder name (non-linked) in breadcrumb
- `breadcrumb-folder-{id}` — Ancestor folder links in breadcrumb hierarchy

---

## Implementation Checklist

### Test: createSubfolder mutation (5 tests)

**File:** `convex/folders.test.ts`

**Tasks to make these tests pass:**

- [ ] Add `createSubfolder` mutation to `convex/folders.ts` — args: `{ name: v.string(), parentId: v.id("folders") }`
- [ ] Validate depth ≤ 3 by walking `parentId` chain with `ctx.db.get()` (max 3 iterations)
- [ ] Validate parent folder belongs to authenticated user
- [ ] Validate name (trim, 1-200 chars)
- [ ] Insert folder with `parentId`, `documentCount: 0`, `updatedAt: Date.now()`
- [ ] Run test: `pnpm test -- convex/folders.test.ts`

---

### Test: listChildFolders query (4 tests)

**File:** `convex/folders.test.ts`

**Tasks to make these tests pass:**

- [ ] Add `listChildFolders` query to `convex/folders.ts` — args: `{ parentId: v.id("folders") }`
- [ ] Use `by_userId_and_parentId` index to filter by `userId` and `parentId`
- [ ] Return bounded results with `.take(100)`
- [ ] Run test: `pnpm test -- convex/folders.test.ts`

---

### Test: getFolder query (4 tests)

**File:** `convex/folders.test.ts`

**Tasks to make these tests pass:**

- [ ] Add `getFolder` query to `convex/folders.ts` — args: `{ id: v.id("folders") }`
- [ ] Use `ctx.db.get(args.id)` to fetch folder
- [ ] Return `null` if unauthenticated or folder belongs to different user
- [ ] Run test: `pnpm test -- convex/folders.test.ts`

---

### Test: getFolderAncestors query (5 tests)

**File:** `convex/folders.test.ts`

**Tasks to make these tests pass:**

- [ ] Add `getFolderAncestors` query to `convex/folders.ts` — args: `{ id: v.id("folders") }`
- [ ] Walk `parentId` chain with `ctx.db.get()` up to root (max 3 iterations)
- [ ] Return `{ _id, name }[]` in root-first order
- [ ] Return `[]` for unauthenticated users
- [ ] Run test: `pnpm test -- convex/folders.test.ts`

---

### Test: listAllFolders bounded (4 tests)

**File:** `convex/folders.test.ts`

**Tasks to make these tests pass:**

- [ ] Update `listAllFolders` in `convex/folders.ts` — change `.collect()` to `.take(500)`
- [ ] Run test: `pnpm test -- convex/folders.test.ts`

---

### Test: FolderTree enhancements (7 tests)

**File:** `tests/component/sidebar/folder-tree.test.ts`

**Tasks to make these tests pass:**

- [ ] Add `activeFolder` prop to `FolderTree.vue` — `Id<'folders'> | null`
- [ ] Add `data-testid="folder-tree-item-{id}"` to each `TreeItem`
- [ ] Apply `bg-muted` class when `item._id === activeFolder`
- [ ] Add "+" button (`data-testid="add-subfolder-{id}"`) visible on hover/focus
- [ ] Hide "+" button on level-3 folders (compute depth from tree structure)
- [ ] Verify reka-ui provides `role="tree"`, `role="treeitem"`, `aria-expanded` (may need to remove manual `<div role="tree">` wrapper if duplicate)
- [ ] Run test: `pnpm test:component -- tests/component/sidebar/folder-tree.test.ts`

---

### Test: Folder view page (3 tests)

**File:** `tests/component/folders/folder-view.test.ts`

**Tasks to make these tests pass:**

- [ ] Create `app/pages/app/folders/[id].vue`
- [ ] Show folder name as heading (`data-testid="folder-heading"`)
- [ ] Show empty state "Documents will appear here" (`data-testid="folder-empty-state"`)
- [ ] Add "New Subfolder" button (`data-testid="new-subfolder-button"`)
- [ ] Wire to `useFolders()` composable
- [ ] Run test: `pnpm test:component -- tests/component/folders/folder-view.test.ts`

---

### Test: Folder breadcrumb (3 tests)

**File:** `tests/component/app-shell/folder-breadcrumb.test.ts`

**Tasks to make these tests pass:**

- [ ] Detect `/app/folders/[id]` route in `app/layouts/default.vue`
- [ ] Use `getFolderAncestors` query to build breadcrumb path
- [ ] Show "Home" as linked `UiBreadcrumbLink` pointing to `/app`
- [ ] Show ancestors as linked `UiBreadcrumbLink` elements
- [ ] Show current folder as `UiBreadcrumbPage` (`data-testid="breadcrumb-folder-current"`)
- [ ] Add `UiBreadcrumbSeparator` between items
- [ ] Run test: `pnpm test:component -- tests/component/app-shell/folder-breadcrumb.test.ts`

---

## Running Tests

```bash
# Run all Convex integration tests (includes story 2.1 skipped tests)
pnpm test -- convex/folders.test.ts

# Run all component tests (includes story 2.1 skipped tests)
pnpm test:component

# Run specific component test file
pnpm test:component -- tests/component/sidebar/folder-tree.test.ts

# Run all tests (both suites)
pnpm test && pnpm test:component

# Run with verbose output
pnpm test -- --reporter=verbose convex/folders.test.ts
pnpm test:component -- --reporter=verbose
```

---

## Red-Green-Refactor Workflow

### RED Phase (Complete)

**TEA Agent Responsibilities:**

- All 35 tests written and skipped (`it.skip()`)
- Existing 11 passing tests unaffected (no regressions)
- Factories available (existing `folder.factory.ts` supports `parentId`)
- data-testid requirements documented
- Implementation checklist created

**Verification:**

```
Convex tests: 40 passed | 22 skipped (62 total)
Component tests: 72 skipped (72 total)
Exit code: 0 (no failures)
```

---

### GREEN Phase (DEV Team — Next Steps)

1. Pick one failing test group from the implementation checklist
2. Read the tests to understand expected behavior
3. Implement minimal code to make tests pass
4. Remove `it.skip()` from the target tests
5. Run tests to verify green
6. Check off tasks in implementation checklist
7. Move to next test group

**Recommended order:**
1. Convex backend functions first (`createSubfolder` → `listChildFolders` → `getFolder` → `getFolderAncestors` → bound `listAllFolders`)
2. Then `useFolders` composable updates
3. Then FolderTree component enhancements
4. Then folder view page
5. Then breadcrumb integration
6. Finally, scaffold missing shadcn components

---

### REFACTOR Phase (After All Tests Pass)

1. Verify all 35 tests pass (green)
2. Review for code quality, DRY, performance
3. Run tests after each refactor
4. Ready for code review

---

## Test Execution Evidence

### Initial Test Run (RED Phase Verification)

**Command:** `pnpm test -- --reporter=verbose && pnpm test:component -- --reporter=verbose`

**Results:**

```
Convex Integration Tests:
  Test Files  4 passed (4)
  Tests       40 passed | 22 skipped (62)

Component Tests:
  Test Files  11 skipped (11)
  Tests       72 skipped (72)
```

**Summary:**

- Total new tests: 35 (22 Convex + 13 Component)
- Passing: 0 new (expected)
- Skipped: 35 new (expected — RED phase)
- Existing tests: 40 still passing (no regressions)
- Status: RED phase verified

---

## Notes

- Folder view page test uses dynamic import path (`['~', 'pages', ...].join('/')`) to avoid Vite static import analysis error for non-existent files
- The ARIA role tests (role="tree", role="treeitem", aria-expanded) may already pass once FolderTree accepts the `activeFolder` prop, since reka-ui provides these natively — verify after removing `it.skip()`
- `listAllFolders` currently uses `.collect()` without bounding — the test verifies `.take(500)` is applied

---

**Generated by BMad TEA Agent** — 2026-04-10
