---
title: 'G2 — Atlas-style home sidebar (compact icon rail)'
type: 'refactor'
created: '2026-04-13'
status: 'ready-for-dev'
context:
  - 'DESIGN.md — Warm Focus design system (sidebar tokens, type scale, sidebar nav pattern)'
  - '_bmad-output/implementation-artifacts/design-screens/g2-atlas-style-home-sidebar.md — approved DESIGN proposal'
  - '_bmad-output/implementation-artifacts/deferred-work.md — G2/G3/G4 deferral context'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The current `<UiSidebar collapsible="icon">` shell in `app/layouts/default.vue` is a wide (`w-64`) panel hosting Home + General Chat nav, the full nested folder tree, Recent Chats, and a verbose user footer. Reference `Screenshot 2026-04-12 at 8.35.10 PM.png` (Atlas) shows the desired direction — a permanent, very narrow icon rail. Today's sidebar is too noisy, hides folder identity behind a generic tree, and doesn't take advantage of G1's per-folder color/icon metadata.

**Approach:** Replace the layout sidebar with a permanent ~56px icon rail. Rail contents top-to-bottom: Budds logo (also `Home` link), root folders only — rendered as G1 `FolderBadge` tiles — a `+` create-folder CTA at the end of that list, then a footer with theme toggle and user-avatar dropdown. Subfolders, recent chats, the General Chat nav entry, and the nested folder tree are removed from the rail (they belong to G3/G4 or stay accessible via direct routing). Mobile: rail collapses to a sheet overlay where labels reappear.

## Boundaries & Constraints

**Always:**
- Width fixed at `w-14` (56px). No collapse toggle — this rail IS the compact state.
- Render only **root folders** (`folder.parentId == null`) in the rail. Source from `useFolders().allFolders`.
- Each rail tile (logo, folder, `+`, footer button) MUST have a Reka `UiTooltip` with `side="right"` providing the accessible label.
- Active folder tile: 2px left border `--primary` + `bg-sidebar-accent` tint, per DESIGN.md sidebar-nav pattern. Same pattern for active Home (`/`) on logo.
- All folder tiles route to `/app/folders/<id>`. Logo routes to `/`.
- `+` opens existing `FolderFormModal` in `create` mode with `parentId: null`.
- Footer dropdown preserves Sign out / Export my data / Delete account items + their existing `data-testid`s.
- Mobile (`<768px`): existing `UiSidebarTrigger` opens a Sheet showing the same items with text labels visible to the right of each badge/icon.
- Use Tailwind utilities only — no `<style>` blocks (DESIGN.md "don't").

**Ask First:**
- Adding any new external dependency.
- Removing any `data-testid` other than the ones explicitly listed under **Never** below as "drop without replacement".
- Changing folder data shape or routes.

**Never:**
- No new Convex queries or schema changes.
- No persistence of rail state (it has no expand/collapse).
- No subfolder rendering, no Recent Chats section, no General Chat nav entry, no Knowledge drawer (all G3/G4 scope).
- Do not delete `app/components/sidebar/FolderTree.vue` — G4 reuses it. Just stop rendering it from `default.vue`.
- No animation beyond Tailwind defaults; no pulsing, no marketing copy.
- Do NOT use `git add -A` / `.` when committing.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First load, no folders | `allFolders == []` | Rail shows logo, `+` tile, footer. Tooltip on `+` reads "Create your first folder". No empty-state text block. | N/A |
| Folders loading | `allFoldersLoading == true` | Rail shows logo, 3 × `UiSkeleton` tile placeholders (28px, rounded-[10px]) where folders will appear, `+` and footer. | N/A |
| Mixed roots + subfolders | `allFolders` has both | Render only entries where `parentId == null`, ordered as returned by `listAllFolders`. | N/A |
| Active root folder | `route.path == /app/folders/<rootId>` | That tile gets the active border+tint. Other tiles inactive. | N/A |
| Active subfolder | route is `/app/folders/<subId>` | The **root ancestor's** tile gets the active state (walk up `parentId` chain in `allFolders`). | If ancestor missing, no tile is active. |
| Click `+` | rail | `FolderFormModal` opens in create mode, `parentId: null`. | Existing modal error handling. |
| Mobile sheet | viewport `<768px` | `UiSidebarTrigger` opens sheet; sheet renders rail items with labels next to icons. | N/A |
| Logo click on `/` | already home | Active state stays; no nav. | N/A |

</frozen-after-approval>

## Code Map

- `app/layouts/default.vue` -- Replace `<UiSidebar>` body. Remove General Chat nav item, `SidebarFolderTree` render, Recent Chats group, `recentChats` data wiring, and `collapsible="icon"` prop. Width becomes `w-14`. Active-root resolution uses existing `currentFolderData` + `allFolders` ancestor walk (extract helper). Keep `FolderFormModal`, theme toggle, footer dropdown intact.
- `app/components/sidebar/HomeRail.vue` -- NEW. Renders the rail body: logo, root folder tiles (`FolderBadge` size="md", wrapped in tooltip + active-border), skeleton + empty handling, `+` create CTA. Emits `create` and `select-folder(id)` (or uses `<NuxtLink>` directly). Width-agnostic: parent owns the `w-14`.
- `app/components/folders/FolderBadge.vue` -- No change; consumed by `HomeRail`.
- `app/components/sidebar/FolderTree.vue` -- Untouched. Stops being imported from layout.
- `tests/component/app-shell/layout.test.ts` -- Update assertions: rail width, presence of new `data-testid="sidebar-home-rail"`, root-folder tiles only, no Recent Chats group, no General Chat link.
- `tests/component/app-shell/sidebar-recent-chats.test.ts` -- DELETE (Recent Chats section removed from rail).
- `tests/component/app-shell/responsive.test.ts` -- Update mobile-sheet assertions to expect labels next to badges.
- `tests/component/sidebar/home-rail.test.ts` -- NEW. Cover empty / loading / mixed roots+subs / active-root / active-via-subfolder / `+` opens modal.

## Tasks & Acceptance

**Execution:**
- [ ] `app/components/sidebar/HomeRail.vue` -- create the rail component per Code Map. Logo `<NuxtLink to="/">` showing "B" wordmark in DM Sans bold amber. Folder list renders only `parentId == null`. `+` button uses `FolderPlus` icon, emits `create`. Footer slot left to layout.
- [ ] `app/layouts/default.vue` -- swap sidebar body to `<SidebarHomeRail>`, drop unused imports (`Sparkles`, `MessagesSquare`, `MessageSquare` if unused after, `FolderOpen` likewise) and Recent Chats state (`recentChatsData`, `recentChats`, `deleteConversationMutation`, `showDeleteConvoDialog`, `convoToDelete`, `handleDeleteConversationRequest`, `executeDeleteConversation`, the recent-chats template block, the chat delete dialog). Drop General Chat nav `<UiSidebarMenuItem>`. Drop `collapsible="icon"` prop and the collapsed-state theme-toggle button. Width to `w-14`. Active-folder resolution: helper `resolveActiveRootId(routeFolderId, allFolders) → string | null`.
- [ ] `tests/component/sidebar/home-rail.test.ts` -- new test file covering the I/O matrix scenarios above.
- [ ] `tests/component/app-shell/layout.test.ts` -- update to match new rail shape. Drop assertions on Recent Chats, General Chat nav, collapsed theme toggle.
- [ ] `tests/component/app-shell/sidebar-recent-chats.test.ts` -- delete.
- [ ] `tests/component/app-shell/responsive.test.ts` -- update mobile sheet expectations.

**Acceptance Criteria:**
- Given a signed-in user on `/`, when the layout mounts, then the sidebar is exactly 56px wide, shows logo + each root folder as a `FolderBadge` tile + a `+` tile + footer (theme toggle, avatar dropdown), and contains no General Chat link, no Recent Chats list, no nested subfolder tree.
- Given the user navigates to `/app/folders/<subId>` where `<subId>` has a root ancestor `<rootId>`, when the rail re-renders, then the tile for `<rootId>` shows the active state and no other tile is active.
- Given the user clicks `+`, when the modal opens, then `FolderFormModal` is in create mode with no `parentId`.
- Given viewport `<768px`, when the user opens the sidebar via `UiSidebarTrigger`, then the sheet shows each rail item with its name label rendered alongside the badge/icon.
- Given `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm test:component` are run, all four pass.

## Spec Change Log

## Verification

**Commands:**
- `pnpm lint` -- expected: zero errors
- `pnpm typecheck` -- expected: zero errors
- `pnpm test:component` -- expected: all component tests pass (incl. new `home-rail.test.ts`)
- `pnpm test` -- expected: all server/integration tests pass
