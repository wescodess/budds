# Story 1.3: Dashboard Home View

Status: done

## Story

As a student,
I want to see a home dashboard showing my courses at a glance,
So that I can quickly navigate to any course and see my overall knowledge base.

## Acceptance Criteria

1. **Given** an authenticated user with existing folders
   **When** they navigate to `/app`
   **Then** they see a card grid of their top-level folders (DashboardCourseCard) showing folder name, document count, and last activity timestamp
   **And** cards are displayed in a responsive grid (1 column mobile, 2 tablet, 3 desktop)
   **And** clicking a course card navigates to that folder's view

2. **Given** a first-time user with no folders
   **When** they navigate to `/app`
   **Then** they see an empty state with a guided prompt: "Start by creating a course folder"
   **And** an inline folder name input with a create button is displayed
   **And** an "Add Course" card with a dashed border variant is visible

3. **Given** a user with existing folders
   **When** they view the dashboard
   **Then** an "Add Course" card is visible alongside their existing course cards
   **And** clicking it opens an inline folder creation input

4. **Given** the dashboard view
   **When** Card and Badge shadcn components are needed
   **Then** they are scaffolded and available for the DashboardCourseCard component

## Tasks / Subtasks

- [x] Task 1: Define Convex `folders` table schema and queries (AC: #1, #2, #3)
  - [x] Add `folders` table to `convex/schema.ts` with fields: `userId` (string), `name` (string), `parentId` (optional id), `documentCount` (number, default 0), plus `by_userId` and `by_userId_and_parentId` indexes
  - [x] Create `convex/folders.ts` with `listTopLevelFolders` query — filters by authenticated user's `tokenIdentifier` and `parentId === undefined`, ordered by `_creationTime` desc, returns up to 50 folders
  - [x] Create `createFolder` mutation — accepts `name` (string), derives `userId` from `ctx.auth.getUserIdentity()`, sets `parentId: undefined` and `documentCount: 0`
  - [x] Validate auth in both functions: return empty array / throw if `getUserIdentity()` returns null

- [x] Task 2: Create `useFolders` composable (AC: #1, #2, #3)
  - [x] Create `app/composables/useFolders.ts`
  - [x] Use the auto-imported `useConvexQuery` (from `@convex-vue/core` via nuxt-convex) to bind `api.folders.listTopLevelFolders` — this returns `{ data, error, isLoading }` where `data` is a reactive ref
  - [x] Use the auto-imported `useConvexMutation` for `api.folders.createFolder` — this returns `{ mutate, error, isLoading }` where `mutate(args)` is the function to call with `{ name }` argument object
  - [x] Wrap `mutate` in a `createFolder(name: string)` helper that calls `mutate({ name })` and handles errors with try/catch
  - [x] Expose `folders` (from `data`), `isLoading`, `createFolder`, and `isCreating` (from mutation's `isLoading`)

- [x] Task 3: Remove `/app` → `/app/chat` redirect and create dashboard page (AC: #1, #2)
  - [x] In `nuxt.config.ts`, replace `'/app': { redirect: '/app/chat' }` with `'/app': { auth: 'user' as const }` to keep auth protection without the redirect
  - [x] Create `app/pages/app/index.vue` as the dashboard home view
  - [x] Page uses the default layout (app shell from Story 1.2) — do NOT add `layout: false`
  - [x] In `app/layouts/default.vue`, render `<slot />` OUTSIDE the `<UiTabs>` when on the dashboard route (`useRoute().path === '/app'`). Wrap the tabs + tab content in a `v-if="route.path !== '/app'"` and render `<slot />` with `v-else` so dashboard content is not trapped inside the Chat TabsContent. This is the cleanest approach — study mode tabs are folder-scoped, not relevant on the dashboard.
  - [x] Use `useFolders()` composable for data in the dashboard page

- [x] Task 4: Build DashboardCourseCard component (AC: #1, #3)
  - [x] Create `app/components/dashboard/DashboardCourseCard.vue`
  - [x] Props: `folder` (Convex folder doc), `documentCount` (number), `lastActivity` (number, `_creationTime`)
  - [x] Renders: folder name (body emphasis: DM Sans 500, 14px), document count badge (`UiBadge`), last activity timestamp (caption: Inter 500, 12px, `--muted-foreground`), formatted with `useTimeAgo` from VueUse
  - [x] Card styling: `--card` background (#292524), `--border` 1px border, `--radius-lg` (12px), `p-4` padding, hover state with slight elevation/border brightening
  - [x] Click navigates to `/app/folders/${folder._id}` (will 404 until Epic 2 — acceptable)
  - [x] Quick action icons: Chat and Cards (non-functional placeholders — use `UiButton` ghost variant with `MessageSquare` and `BookOpen` icons)

- [x] Task 5: Build AddCourseCard component (AC: #2, #3)
  - [x] Create `app/components/dashboard/AddCourseCard.vue`
  - [x] Default state: dashed border card with `Plus` icon and "Add Course" text, same dimensions as DashboardCourseCard
  - [x] Active state: clicking reveals an inline `UiInput` for folder name + `UiButton` "Create" button
  - [x] On submit: calls `useFolders().createFolder(name)`, clears input, returns to default state
  - [x] Handle enter key to submit, escape key to cancel
  - [x] Validation: prevent empty folder name submission

- [x] Task 6: Build empty state for first-time users (AC: #2)
  - [x] In `app/pages/app/index.vue`, when `folders` array is empty and not loading, show centered empty state
  - [x] Heading: "Start by creating a course folder" (DM Sans 600, 18px)
  - [x] Inline folder name input with create button (reuse or compose with AddCourseCard logic)
  - [x] `FolderOpen` icon above the heading (muted, large: h-16 w-16 opacity-40)

- [x] Task 7: Assemble dashboard grid layout (AC: #1, #2, #3)
  - [x] In `app/pages/app/index.vue`, render responsive card grid: `grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6`
  - [x] Map `folders` to DashboardCourseCard components
  - [x] Always render AddCourseCard as the last card in the grid (when folders exist)
  - [x] Loading state: show 3 skeleton cards (`UiSkeleton` matching card dimensions) while `isLoading` is true
  - [x] Page heading: "Your Courses" (24px DM Sans 700) above the grid, with `p-6` padding on the container

- [x] Task 8: Update sidebar breadcrumb for dashboard (AC: #1)
  - [x] When on `/app` (dashboard), breadcrumb should show "Home" as the current page (non-linked) rather than a link
  - [x] Update `app/layouts/default.vue` breadcrumb to detect current route and render `UiBreadcrumbPage` for current location vs `UiBreadcrumbLink` for parent locations

- [x] Task 9: Scaffold any missing shadcn components (AC: #4)
  - [x] Verify `Card` and `Badge` shadcn components exist in `app/components/ui/` (they were scaffolded in Story 1.2)
  - [x] If `Progress` component is needed for future use, scaffold it: `pnpm dlx shadcn-vue@latest add progress`
  - [x] Verify `Input` component exists (scaffolded in Story 1.2)

## Dev Notes

### Architecture Compliance

**Routing change:** `/app` currently redirects to `/app/chat` via `routeRules` in `nuxt.config.ts`. This redirect MUST be removed. Instead, `app/pages/app/index.vue` becomes the dashboard and `/app` resolves to it via Nuxt file-based routing. Chat remains at `/app/chat`. The app shell layout from Story 1.2 wraps both pages — the study mode tabs in the layout header allow switching between Chat/Flash Cards/Quiz/Documents once inside a folder context (future stories).

**Convex schema expansion:** The `folders` table is the first data table beyond `users`. Follow Convex guidelines strictly:
- Derive `userId` server-side from `ctx.auth.getUserIdentity().tokenIdentifier` — NEVER accept userId as a function argument
- All queries MUST filter by userId
- Use `v.optional(v.id("folders"))` for `parentId` to support nested folders later (Epic 2)
- Use indexes, not `.filter()`, for queries
- Use `.take(50)` instead of `.collect()` to bound results
- Read `convex/_generated/ai/guidelines.md` before writing any Convex code

**nuxt-convex integration:** Use `useConvexQuery` and `useConvexMutation` from the `nuxt-convex` module (v0.0.6). This is an early module — check its actual API before assuming patterns. The existing `useRag.ts` composable does NOT use Convex queries (it uses `$fetch` to Nitro routes), so there's no prior pattern to follow. This is the first composable using Convex real-time queries.

**Component placement:** Dashboard components go in `app/components/dashboard/` — Nuxt auto-imports them. The `DashboardCourseCard` renders a `UiCard` with a `UiBadge` for document count. Follow the component boundary rule: dashboard components only communicate through `useFolders()` composable.

**The "Void" concept:** Per DESIGN.md, the main content area is the Void — a dedicated workspace. The dashboard is the entry point BEFORE entering a Void. It shows course cards, not study content. Study mode tabs (Chat, Flash Cards, Quiz, Documents) are folder-scoped Voids that activate AFTER navigating into a folder. For the dashboard page, the tab bar in the layout header should either be hidden or visually inactive since no folder is selected.

### Technical Requirements

- **Convex auth pattern:** `const identity = await ctx.auth.getUserIdentity(); if (!identity) throw new Error("Unauthenticated"); const userId = identity.tokenIdentifier;`
- **Convex schema fields cannot start with `_`** — use `userId` not `_userId`. System fields `_id` and `_creationTime` are automatic.
- **No `<style>` blocks** — Tailwind utility classes exclusively
- **No manual Vue API imports** — Nuxt auto-imports `ref`, `computed`, `watch`, etc.
- **`$fetch` for Nitro API calls**, `useConvexQuery`/`useConvexMutation` for Convex data
- **pnpm only** — never npm or yarn
- **Co-locate interfaces** in the files that use them — no `types/` directory
- **No barrel files** — Nuxt auto-imports handle component discovery

### File Structure

Files to create:
- `convex/folders.ts` — Folder queries and mutations (`listTopLevelFolders`, `createFolder`)
- `app/composables/useFolders.ts` — Reactive folder data composable
- `app/pages/app/index.vue` — Dashboard home view page
- `app/components/dashboard/DashboardCourseCard.vue` — Course card component
- `app/components/dashboard/AddCourseCard.vue` — Add new course card with inline input

Files to modify:
- `convex/schema.ts` — Add `folders` table definition
- `nuxt.config.ts` — Replace `'/app': { redirect: '/app/chat' }` with `'/app': { auth: 'user' as const }` (keep auth, remove redirect)
- `app/layouts/default.vue` — Update breadcrumb to detect current route; conditionally render `<slot />` outside tabs when on dashboard route

Files to NOT modify:
- `app/pages/app/chat.vue` — Chat stays as-is, unaffected
- `app/composables/useRag.ts` — No changes needed
- `server/*` — No Nitro API routes needed (Convex handles data)
- `convex/auth.config.ts` — Already configured
- `app/assets/css/tailwind.css` — All tokens already defined

### Previous Story (1-2) Intelligence

**What was established:**
- App shell layout in `app/layouts/default.vue` with `UiSidebarProvider` + `UiSidebar` + `UiSidebarInset`
- Sidebar has Folders and Recent Chats groups (empty state placeholders)
- Study mode tabs (Chat, Flash Cards, Quiz, Documents) in the layout header
- `activeTab` ref is decoupled from router — by design for placeholder tabs (Review finding from 1-2)
- `<slot />` only renders inside the Chat `TabsContent` — correct for now, needs refactoring when dashboard bypasses tabs
- Dark/light mode toggle using `useColorMode` from VueUse
- Card, Badge, Avatar, Input, Skeleton components already scaffolded in `app/components/ui/`
- `useUserSession()` provides `signOut()`, `user` (with `name`, `image`)
- SidebarProvider uses `useCookie` for SSR-safe open/closed state persistence

**Review findings to carry forward:**
- `SidebarProvider.vue` was patched to use `useCookie` instead of `document.cookie` for SSR safety
- `Sidebar.vue` renders as `<aside>` after review fix
- Font preconnect hints added in layout via `useHead`
- Deferred items: `activeTab` decoupled from router, `<slot />` only in Chat tab — both relevant to this story

**Critical implication for this story:** The current layout renders `<slot />` (page content) ONLY inside the Chat `UiTabsContent`. The dashboard page (`app/pages/app/index.vue`) will render inside this slot. For this story, the dashboard content will appear within the Chat tab's content area. This is acceptable for now — future stories will refactor the tab/void architecture when folder-scoped navigation is implemented. Alternatively, the developer can render the `<slot />` outside the tabs when on the dashboard route (check `useRoute().path`) — this is the cleaner approach.

### DashboardCourseCard Specification (from UX Design)

| Attribute | Detail |
|---|---|
| Purpose | Card on the home dashboard representing a course/folder |
| Props | `folder: Folder`, `documentCount: number`, `lastStudied?: Date` |
| States | Default, hover (elevated), empty (dashed "Add Course" variant) |
| Actions | Click to navigate into folder. Quick action buttons: Chat, Cards |
| Content | Course name, document count badge, last activity timestamp |
| Styling | `--card` bg, `--border` 1px, `--radius-lg`, `p-4`, no shadow |
| Hover | Slight border brightening or subtle elevation |

### Responsive Grid Breakpoints

| Breakpoint | Tailwind | Columns | Notes |
|---|---|---|---|
| < 768px | Default | 1 column | Stacked cards, full width |
| 768-1024px | `md:` | 2 columns | Two-column grid |
| > 1280px | `xl:` | 3 columns | Three-column grid |

### Empty State Design

| State | Content | Action |
|---|---|---|
| No folders (first-time user) | "Start by creating a course folder" with `FolderOpen` icon | Inline folder name input + create button |
| Has folders | Card grid + AddCourseCard at end | Click AddCourseCard to create inline |
| Loading | 3 skeleton cards matching card dimensions | N/A |

### Critical Anti-Patterns to Avoid

- Do NOT accept `userId` as a Convex function argument — derive from `ctx.auth.getUserIdentity()`
- Do NOT use `.filter()` in Convex queries — use `.withIndex()`
- Do NOT use `.collect()` without bounds — use `.take(n)`
- Do NOT manually import Vue APIs — auto-imports active
- Do NOT create `types/` directory — co-locate interfaces
- Do NOT use `<style>` blocks — Tailwind only
- Do NOT add Pinia/Vuex — composables only
- Do NOT create barrel files — Nuxt auto-imports
- Do NOT create Nitro API routes for folder CRUD — use Convex directly
- Do NOT hardcode folder navigation URLs that don't exist yet — navigate to `/app/folders/${id}` (will 404 until Epic 2, that's fine)
- Do NOT disable or remove study mode tabs from the layout — they're layout-level, not page-level
- Do NOT add loading spinners — use skeleton cards matching the layout pattern

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 1, Story 1.3]
- [Source: _bmad-output/planning-artifacts/architecture.md — Frontend Architecture, Component Architecture, State Management, Convex Integration]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — Dashboard Home, DashboardCourseCard, Empty States, Responsive Layout]
- [Source: _bmad-output/project-context.md — Framework-Specific Rules, Code Quality Rules, Language-Specific Rules]
- [Source: DESIGN.md — Cards, Spacing, Typography, Color Tokens]
- [Source: _bmad-output/implementation-artifacts/1-2-app-shell-layout-with-responsive-navigation.md — Dev Notes, Review Findings, File List]
- [Source: convex/_generated/ai/guidelines.md — Schema, Query, Mutation, Auth Guidelines]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

None — clean implementation with no blockers.

### Completion Notes List

- Task 1: Added `folders` table to Convex schema with `by_userId` and `by_userId_and_parentId` indexes. Created `convex/folders.ts` with `listTopLevelFolders` query (index-based, auth-filtered, bounded to 50) and `createFolder` mutation (server-derived userId). All 11 pre-scaffolded tests enabled and passing.
- Task 2: Created `useFolders` composable using `useConvexQuery` and `useConvexMutation` auto-imports from nuxt-convex. Exposes reactive `folders`, `isLoading`, `createFolder`, and `isCreating`.
- Task 3: Replaced `/app` redirect with auth-only route rule. Created `app/pages/app/index.vue` as dashboard. Updated default layout to render `<slot />` outside `UiTabs` when on dashboard route via `isDashboard` computed.
- Task 4: Created `DashboardCourseCard` (`app/components/dashboard/CourseCard.vue`) with folder name, document count badge, `useTimeAgo` timestamp, and ghost quick-action buttons (Chat, Cards). Navigates to `/app/folders/${id}`.
- Task 5: Created `AddCourseCard` (`app/components/dashboard/AddCourseCard.vue`) with dashed border default state, inline input active state, enter/escape key handling, and empty name validation. Supports `inline` prop for empty state usage.
- Task 6: Empty state in dashboard page shows FolderOpen icon, heading, and inline AddCourseCard when no folders exist.
- Task 7: Dashboard page renders responsive grid (1/2/3 columns), skeleton loading state (3 cards), and AddCourseCard as last grid item.
- Task 8: Breadcrumb shows `UiBreadcrumbPage` (non-linked "Home") on dashboard, `UiBreadcrumbLink` on sub-pages.
- Task 9: All required shadcn components (Card, Badge, Input, Skeleton) already scaffolded — no action needed.

### Review Findings

- [x] [Review][Patch] #1 All `data-testid` attributes missing from dashboard components and page — fixed, added all 12+ test IDs
- [x] [Review][Patch] #2 `useFolders` composable uses raw `useConvex().onUpdate`/`.mutation` instead of `useConvexQuery`/`useConvexMutation` — fixed, rewrote with proper nuxt-convex composables
- [x] [Review][Patch] #3 Quick action buttons missing `aria-label` / sr-only text — fixed, added `<span class="sr-only">` to both buttons
- [x] [Review][Patch] #4 `inputRef` typed as `HTMLInputElement` but bound to `UiInput` component — fixed, access `$el` from component instance
- [x] [Review][Patch] #5 Double-submit race: `submit()` doesn't guard against `isCreating` — fixed, added early return guard
- [x] [Review][Patch] #6 No error handling on Convex subscription failure — fixed via useConvexQuery which handles errors internally
- [x] [Review][Patch] #7 Pervasive `any` types in `useFolders` — fixed, uses `Doc<'folders'>` type from Convex generated types
- [x] [Review][Patch] #8 No server-side folder name validation — fixed, added trim + length check (1-200 chars) in mutation
- [x] [Review][Patch] #9 Folder name `<p>` in CourseCard missing `truncate` class — fixed
- [x] [Review][Defer] #10 `documentCount` denormalized field has no increment/decrement mechanism — will show stale data until Epic 3 [convex/schema.ts] — deferred, pre-existing design decision for Epic 3
- [x] [Review][Defer] #11 `lastActivity` shows `_creationTime` not actual last activity — no `updatedAt` field in schema [convex/schema.ts, CourseCard.vue:14] — deferred, data model gap to address in Epic 2/3
- [x] [Review][Defer] #12 SSR hydration mismatch: server renders skeletons, client immediately switches to empty/grid state [app/composables/useFolders.ts:9-19] — deferred, nuxt-convex SSR story needs broader resolution

### Change Log

- 2026-04-10: Implemented Story 1.3 — Dashboard Home View with Convex folders backend, responsive course card grid, empty state, and breadcrumb updates.

### File List

New files:
- `convex/folders.ts`
- `app/composables/useFolders.ts`
- `app/pages/app/index.vue`
- `app/components/dashboard/CourseCard.vue`
- `app/components/dashboard/AddCourseCard.vue`

Modified files:
- `convex/schema.ts` (added folders table)
- `nuxt.config.ts` (replaced /app redirect with auth rule)
- `app/layouts/default.vue` (conditional slot rendering, breadcrumb update)
- `convex/folders.test.ts` (enabled all .skip tests)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (status update)
