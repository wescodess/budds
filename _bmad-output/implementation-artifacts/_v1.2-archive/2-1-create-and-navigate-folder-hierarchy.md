# Story 2.1: Create and Navigate Folder Hierarchy

Status: done

## Story

As a student,
I want to create course folders up to 3 levels deep and navigate them in a tree,
So that I can organize my materials by semester, course, and topic.

## Acceptance Criteria

1. **Given** an authenticated user
   **When** they create a new folder at the root level
   **Then** a folder record is created in the Convex `folders` table with `userId`, `name`, `parentId: null`, and the folder appears in the sidebar FolderTree
   **And** the `folders` Convex table already exists with fields: `userId`, `name`, `parentId` (optional), with indexes on `userId` and `parentId`

2. **Given** a user viewing a folder
   **When** they create a subfolder inside it
   **Then** the subfolder is created with `parentId` referencing the parent folder
   **And** the FolderTree updates in real-time via Convex subscription

3. **Given** a user attempts to create a folder at depth 4 (great-grandchild)
   **When** they try to add a subfolder inside a 3rd-level folder
   **Then** the creation is prevented with a clear message: "Maximum folder depth (3 levels) reached"

4. **Given** the sidebar FolderTree component
   **When** a user clicks a folder
   **Then** it expands/collapses to show or hide child folders
   **And** clicking a leaf folder navigates to that folder's view at `/app/folders/[id]`
   **And** the active folder is visually highlighted with `bg-muted`
   **And** the breadcrumb updates to show the full hierarchy path

5. **Given** a user navigating with keyboard
   **When** they focus the folder tree
   **Then** arrow keys navigate between items, Enter expands/collapses or selects
   **And** the tree uses `role="tree"` with `role="treeitem"` and `aria-expanded` attributes

6. **Given** the FolderTree component is rendered
   **When** Collapsible shadcn component is needed
   **Then** it is scaffolded and available

## Tasks / Subtasks

- [x] Task 1: Extend Convex `folders` backend with subfolder support (AC: #1, #2, #3)
  - [x] Add `createSubfolder` mutation to `convex/folders.ts` — accepts `name` (string) and `parentId` (Id<"folders">), validates depth ≤ 3 by walking `parentId` chain, enforces same auth pattern as `createFolder`
  - [x] Add `listChildFolders` query to `convex/folders.ts` — takes `parentId` (Id<"folders">), returns children for the authenticated user using `by_userId_and_parentId` index
  - [x] Add `getFolder` query — takes `id` (Id<"folders">), returns the folder if it belongs to the authenticated user (for breadcrumb building)
  - [x] Add `getFolderAncestors` query — takes `id` (Id<"folders">), walks the `parentId` chain up to root, returns ordered array of `{ _id, name }` for breadcrumb display
  - [x] Update `listAllFolders` query — this already exists and returns all user folders unbounded with `.collect()`. Consider bounding with `.take(500)` for safety

- [x] Task 2: Update `useFolders` composable with subfolder support (AC: #1, #2, #3)
  - [x] Add `createSubfolder(name: string, parentId: Id<"folders">)` function wrapping the new mutation
  - [x] Ensure `listAllFolders` query data is available for the FolderTree (it loads all folders to build the tree client-side)
  - [x] Add `getFolder` and `getFolderAncestors` query bindings for the folder view page

- [x] Task 3: Integrate FolderTree into the sidebar (AC: #1, #4, #5)
  - [x] In `app/layouts/default.vue`, replace the empty state placeholder in the Folders sidebar group with the existing `SidebarFolderTree` component
  - [x] Wire `SidebarFolderTree` to `useFolders()` composable — pass `folders` (from `listAllFolders`) as prop
  - [x] Show the empty state only when `folders` is empty/null and not loading
  - [x] Add "New Folder" button in the sidebar Folders group header to create root-level folders

- [x] Task 4: Enhance FolderTree with active state and depth-aware creation (AC: #2, #3, #4)
  - [x] Add `activeFolder` prop to `FolderTree.vue` — highlight the active folder with `bg-muted` based on current route param
  - [x] Add inline subfolder creation UI: a small "+" button appears on hover/focus of a folder node, opens inline input for subfolder name
  - [x] Enforce depth limit client-side: hide the "+" button on level-3 folders, show toast "Maximum folder depth (3 levels) reached" if attempted programmatically
  - [x] Ensure reka-ui `TreeRoot`/`TreeItem` provides proper `role="tree"`, `role="treeitem"`, and `aria-expanded` attributes (verify — reka-ui Tree handles this natively)

- [x] Task 5: Create folder view page at `/app/folders/[id]` (AC: #4)
  - [x] Create `app/pages/app/folders/[id].vue` — renders inside the default layout (app shell)
  - [x] Page shows folder name as heading, with a placeholder "Documents will appear here" empty state
  - [x] Add "New Subfolder" button that opens inline input for creating a child folder
  - [x] Page uses `useFolders()` composable for data

- [x] Task 6: Update breadcrumb to show folder hierarchy path (AC: #4)
  - [x] In `app/layouts/default.vue`, detect when on `/app/folders/[id]` route
  - [x] Use `allFolders` data to compute breadcrumb: Home > Ancestor1 > Ancestor2 > Current
  - [x] Each ancestor is a `UiBreadcrumbLink` navigating to its folder, current folder is `UiBreadcrumbPage`
  - [x] Add `UiBreadcrumbSeparator` between items

- [x] Task 7: Scaffold any missing shadcn components (AC: #6)
  - [x] Check if `Collapsible` component exists in `app/components/ui/` — scaffold if missing: `pnpm dlx shadcn-vue@latest add collapsible`
  - [x] Check if `Toast` / `Sonner` component exists for depth-limit messages — scaffold if missing
  - [x] Verify `DropdownMenu` is available (already scaffolded) for future context menu use in Story 2.2

### Review Findings

- [x] [Review][Decision] `useFolders()` changed from async to sync — Verified: all 3 callers already use sync form. No breaking change.
- [x] [Review][Decision] Breadcrumb ancestors duplicates server query — Resolved: removed `getFolderAncestors` query and `ancestors` from `useFolderDetail`. Client-side computation from `allFolders` is the single source of truth.
- [x] [Review][Patch] `createSubfolder` emit in FolderTree never handled — Fixed: added `@create-subfolder` handler in `default.vue` with `handleCreateSubfolder`.
- [x] [Review][Patch] No error handling on mutation calls — Fixed: added try/catch with `toast.error()` in both `handleCreateFolder` and `handleCreateSubfolder`.
- [x] [Review][Patch] Folder detail page shows "New Subfolder" button at depth 3 — Fixed: added `v-if="folderDepth < 3"` guard using computed depth from `allFolders`.
- [x] [Review][Patch] `ancestors` from `useFolderDetail` fetched but never used — Fixed: removed `ancestors` from `useFolderDetail` and deleted `getFolderAncestors` query + 5 tests.
- [x] [Review][Patch] Ancestor-walking loops lack cycle protection — Fixed: added `Set`-based visited guard in `createSubfolder` mutation and `folderAncestors` computed.
- [x] [Review][Patch] `data-selected:bg-muted` removed — Fixed: restored `data-selected:bg-muted` class on TreeItem alongside route-based highlight.
- [x] [Review][Defer] `allFolders` fetched unconditionally in layout for all `/app/**` routes — deferred, pre-existing architectural choice; acceptable per spec since FolderTree always needs this data in the sidebar

## Dev Notes

### Architecture Compliance

**Existing FolderTree component:** A `SidebarFolderTree.vue` already exists at `app/components/sidebar/FolderTree.vue`. It uses reka-ui `TreeRoot` and `TreeItem` with proper tree structure building. This component was created in Story 1.3 but NOT wired into the sidebar layout — the sidebar still shows the "No folders yet" empty state. This story must wire it in and enhance it.

**Convex `folders` table already exists** in `convex/schema.ts` with fields: `userId` (string), `name` (string), `parentId` (optional id), `documentCount` (number), `updatedAt` (optional number), plus `by_userId` and `by_userId_and_parentId` indexes. The `createFolder` mutation and `listTopLevelFolders`/`listAllFolders` queries already exist in `convex/folders.ts`. Do NOT recreate these — extend them.

**Depth enforcement:** The architecture specifies a 3-level hierarchy (adjacency list with `parentId`). Depth validation MUST be server-side in the Convex mutation — walk the `parentId` chain to count depth before inserting. Client-side validation is cosmetic only (hide "+" on level 3).

**Auth pattern:** All Convex functions derive `userId` from `ctx.auth.getUserIdentity().tokenIdentifier` — NEVER accept userId as a function argument. The existing functions already follow this pattern.

**Real-time updates:** Convex subscriptions via `useConvexQuery` automatically push updates when data changes. The FolderTree will re-render when new folders are created because `listAllFolders` query result changes.

**Routing:** New folder pages at `/app/folders/[id]` are automatically auth-protected by the existing `routeRules` config (`'/app/**'` requires auth). The default layout wraps these pages — the tabs should be visible when inside a folder (unlike the dashboard which hides them).

### Technical Requirements

- **Convex auth pattern:** `const identity = await ctx.auth.getUserIdentity(); if (!identity) throw new Error("Unauthenticated"); const userId = identity.tokenIdentifier;`
- **Convex depth check in mutation:** Walk `parentId` chain with `ctx.db.get()` — max 3 iterations (O(depth) is fine for max depth 3)
- **No `<style>` blocks** — Tailwind utility classes exclusively
- **No manual Vue API imports** — Nuxt auto-imports `ref`, `computed`, `watch`, etc.
- **pnpm only** — never npm or yarn
- **Co-locate interfaces** in the files that use them — no `types/` directory
- **No barrel files** — Nuxt auto-imports handle component discovery
- **Use `.withIndex()` not `.filter()`** for Convex queries
- **Use `.take(n)` not `.collect()`** for bounded queries (except `listAllFolders` which may need `.collect()` but should be bounded to `.take(500)`)

### File Structure

Files to create:
- `app/pages/app/folders/[id].vue` — Folder view page

Files to modify:
- `convex/folders.ts` — Add `createSubfolder`, `listChildFolders`, `getFolder`, `getFolderAncestors` functions; bound `listAllFolders` with `.take(500)`
- `app/composables/useFolders.ts` — Add subfolder creation, ancestor query bindings
- `app/components/sidebar/FolderTree.vue` — Add `activeFolder` prop, inline subfolder creation, depth-aware "+" button
- `app/layouts/default.vue` — Wire FolderTree into sidebar, update breadcrumb for folder routes

Files to NOT modify:
- `convex/schema.ts` — Schema already has all required fields and indexes
- `app/pages/app/index.vue` — Dashboard page stays as-is
- `app/pages/app/chat.vue` — Chat stays unaffected
- `nuxt.config.ts` — No config changes needed
- `app/assets/css/tailwind.css` — All tokens already defined

### Previous Story (1-3) Intelligence

**What was established:**
- `convex/folders.ts` has `listTopLevelFolders`, `listAllFolders`, `createFolder` — extend, don't recreate
- `convex/schema.ts` has `folders` table with `userId`, `name`, `parentId`, `documentCount`, `updatedAt` fields plus `by_userId` and `by_userId_and_parentId` indexes
- `app/composables/useFolders.ts` uses `useConvexQuery` and `useConvexMutation` — the `useFolders()` function is `async` and uses `await useConvexQuery()`
- `app/components/sidebar/FolderTree.vue` exists using reka-ui `TreeRoot`/`TreeItem` — builds tree from flat folder array client-side
- `app/layouts/default.vue` has sidebar with Folders group (still showing empty state placeholder) and breadcrumb nav
- Dashboard page at `app/pages/app/index.vue` works with course cards and AddCourseCard
- `DashboardCourseCard` navigates to `/app/folders/${folder._id}` — will stop 404-ing once this story creates the page

**Review findings carried forward from Epic 1 retro:**
- `useFolders` composable wraps `useConvexMutation` in `import.meta.client` check for SSR safety — preserve this pattern
- reka-ui Tree component provides accessible tree with keyboard nav and ARIA attributes — confirmed working, leverage rather than rebuild
- `updatedAt` field already added to folders schema (retro action item completed)
- `documentCount` denormalized field always shows 0 — acceptable until Epic 3

**Critical pattern from 1-3:** The composable `useFolders()` is async (returns a Promise). The dashboard page uses `await useFolders()`. New code consuming this composable must also `await` it or handle the async pattern correctly.

### Existing FolderTree Component Analysis

The current `FolderTree.vue` (`app/components/sidebar/FolderTree.vue`):
- Takes `folders: Doc<'folders'>[] | null` as prop
- Emits `select` event with `folderId`
- Builds tree from flat array using `parentId` mapping
- Uses `TreeRoot` and `TreeItem` from reka-ui with `expanded` v-model
- Shows `ChevronRight` (rotates 90° on expand), `FolderOpen`/`Folder` icons
- Navigates to `/app/folders/${item._id}` on click
- Indentation: `paddingLeft: (level - 1) * 12 + 8 px`
- Has proper keyboard nav via reka-ui (arrow keys, enter)
- Missing: `activeFolder` highlight, inline subfolder creation, depth-aware "+" button

### Keyboard Navigation (from UX spec)

Arrow keys navigate between items in the folder tree, Enter expands/collapses or selects. reka-ui `TreeRoot`/`TreeItem` handles this natively — verify ARIA attributes:
- `TreeRoot` should provide `role="tree"` (note: current component adds a `<div role="tree">` wrapper — may need to remove if reka-ui already provides it to avoid duplicate roles)
- `TreeItem` should provide `role="treeitem"` and `aria-expanded`

### Breadcrumb Specification

| Route | Breadcrumb |
|---|---|
| `/app` | Home (non-linked, `UiBreadcrumbPage`) |
| `/app/folders/{id}` (root folder) | Home > Folder Name (linked Home, non-linked current) |
| `/app/folders/{id}` (nested) | Home > Parent > Child (all linked except current) |
| `/app/chat` | Home (linked) |

### Anti-Patterns to Avoid

- Do NOT accept `userId` as a Convex function argument — derive from `ctx.auth.getUserIdentity()`
- Do NOT use `.filter()` in Convex queries — use `.withIndex()`
- Do NOT use unbounded `.collect()` — use `.take(n)` or bound results
- Do NOT manually import Vue APIs — auto-imports active
- Do NOT create `types/` directory — co-locate interfaces
- Do NOT use `<style>` blocks — Tailwind only
- Do NOT add Pinia/Vuex — composables only
- Do NOT create barrel files — Nuxt auto-imports
- Do NOT create a new FolderTree from scratch — enhance the existing `app/components/sidebar/FolderTree.vue`
- Do NOT recreate existing Convex functions — extend `convex/folders.ts`
- Do NOT duplicate ARIA roles — if reka-ui provides `role="tree"` on `TreeRoot`, remove the manual `<div role="tree">` wrapper
- Do NOT accept depth as a client-provided argument — always compute server-side
- Do NOT use `ctx.db.query().filter()` for depth checking — use `ctx.db.get(parentId)` in a loop (max 3 iterations)

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 2, Story 2.1]
- [Source: _bmad-output/planning-artifacts/architecture.md — Data Architecture (adjacency list), Frontend Architecture (composables, component boundaries), Naming Patterns, Structure Patterns]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — FolderTree component spec, Keyboard shortcuts, Breadcrumb navigation, Sidebar tree pattern]
- [Source: _bmad-output/project-context.md — Framework-Specific Rules, Code Quality Rules, Language-Specific Rules, Anti-Patterns]
- [Source: _bmad-output/implementation-artifacts/1-3-dashboard-home-view.md — Dev Notes, File List, Review Findings]
- [Source: _bmad-output/implementation-artifacts/epic-1-retro-2026-04-10.md — Epic 2 Preparation Plan, Technical Debt]
- [Source: convex/_generated/ai/guidelines.md — Schema, Query, Mutation, Auth Guidelines]
- [Source: app/components/sidebar/FolderTree.vue — Existing tree component using reka-ui]
- [Source: convex/folders.ts — Existing folder queries and mutations]
- [Source: convex/schema.ts — Existing folders table schema]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- Breadcrumb tests required mocking `useRoute` and `useFolders` because `mountSuspended` redirects to `/login` (auth middleware) and `nuxt-convex`'s `useConvexQuery` doesn't support a `'skip'` pattern for conditional queries.
- Layout breadcrumb computes ancestor chain from `allFolders` data (already loaded for the FolderTree) instead of making separate `getFolderAncestors` Convex queries — avoids the conditional query problem.

### Completion Notes List

- All 7 tasks complete, all 35 ATDD tests GREEN (22 Convex integration + 13 component)
- No regressions: 62 Convex tests pass, 13 component tests pass (59 pre-existing skipped)
- Convex backend: `createSubfolder` with server-side depth validation (max 3), `listChildFolders`, `getFolder`, `getFolderAncestors`, and `listAllFolders` bounded with `.take(500)`
- FolderTree enhanced: `activeFolder` prop with `bg-muted` highlight, `data-testid` attributes, depth-aware "+" button (hidden on level 3), ARIA roles via reka-ui
- Folder view page created at `/app/folders/[id]` with heading, empty state, and "New Subfolder" button
- Breadcrumb shows full hierarchy (Home > ancestors > current) using computed data from `allFolders`
- Sidebar wired with FolderTree, conditional empty state, and root folder creation
- Collapsible and Sonner (toast) components scaffolded; vue-sonner dependency added

### File List

**Created:**
- `app/pages/app/folders/[id].vue` — Folder view page
- `app/components/ui/collapsible/index.ts` — Collapsible shadcn re-export
- `app/components/ui/sonner/Sonner.vue` — Sonner toast component
- `app/components/ui/sonner/index.ts` — Sonner barrel export
- `tests/component/sidebar/folder-tree.test.ts` — FolderTree component tests (7)
- `tests/component/folders/folder-view.test.ts` — Folder view page tests (3)
- `tests/component/app-shell/folder-breadcrumb.test.ts` — Breadcrumb tests (3)

**Modified:**
- `convex/folders.ts` — Added `createSubfolder`, `listChildFolders`, `getFolder`, `getFolderAncestors`; bounded `listAllFolders` with `.take(500)`
- `convex/folders.test.ts` — Unskipped 22 ATDD tests (all now GREEN)
- `app/composables/useFolders.ts` — Added `createSubfolder`, `allFolders`, `useFolderDetail` composable
- `app/components/sidebar/FolderTree.vue` — Added `activeFolder` prop, `data-testid`, depth-aware "+" button, `bg-muted` active highlight
- `app/layouts/default.vue` — Wired FolderTree into sidebar, added folder breadcrumb hierarchy, added Sonner toaster, added "New Folder" button
- `package.json` — Added `vue-sonner` dependency

### Change Log

- 2026-04-10: Implemented Story 2.1 — Create and Navigate Folder Hierarchy (all 7 tasks, 35 ATDD tests GREEN)
