---
slug: g3-folder-three-pane-revamp
status: ready-for-dev
epic: G3 (post-sprint UI revamp)
is_ui: true
design_screens:
  - stitch:898d1fe0f46e407ca96b88746eb8684d (drawer closed — files list)
  - stitch:da40666b5c4c44ae959b614a8fa60cea (drawer open — hierarchy + files)
reference: docs/screenshots/Screenshot 2026-04-13 at 10.25.19 PM.png
---

# G3 — Folder page three-pane revamp

## Frozen Intent

Restructure the folder page (`/app/folders/:id`) into a three-zone layout that matches the approved Stitch screens:

1. **Fixed left rail (240px, non-resizable)** dedicated to the active folder: Members, Knowledge, and a Voids list (Chats, Flashcards, Quiz). Bottom: `+ New Void` primary action + Settings/Help/Logout affordances.
2. **Right-of-rail drawer (55vw overlay)** that slides from the left rail's right edge over the main content. Contains the folder hierarchy (tree) stacked above the active folder's files list. Toggled by a button in the top bar + `⌘B` shortcut.
3. **Main pane** showing the active folder's files in a card-row list with per-file **status pill** (Indexed / Processing / Queued / Failed) and a **hamburger (kebab) menu** for file options (Open, Rename, Move to…, Download, Delete).

Non-goals:
- Rewriting the global app-layout (`app/layouts/default.vue`). The folder page opts out of the default layout.
- New backend APIs. Folder tree, documents, and voids counts are already in Convex.
- Members invite flow (out of scope; the "Members" entry wires to the existing placeholder view).

## I/O Matrix

| Input | Source | Effect |
|---|---|---|
| `route.params.id` | URL | Active folder id; drives rail counters, drawer highlight, files query |
| `route.query.tab` | URL | `chat \| flashcards \| quiz \| documents` — which void is active |
| Rail void click | User | Updates `?tab=` via `router.replace` (no full nav) |
| Drawer toggle / `⌘B` | User | Opens/closes drawer; persisted via `useLocalStorage('g3.drawer.open')` |
| Folder tree click | User | `navigateTo('/app/folders/:newId')`; drawer stays open |
| File row kebab action | User | Open → preview; Rename → inline; Move to… → existing move dialog; Download → signed URL; Delete → existing confirm dialog |
| `useDocuments(folderId)` | Convex | Files list + status + move/delete mutations (no change) |
| `useFolders()` | Convex | All folders for tree (no change) |

## Code Map

**New files:**
- `app/layouts/folder.vue` — minimal layout: no default sidebar chrome; renders `<FolderShell>` around `<NuxtPage>`.
- `app/components/folder-shell/FolderShell.vue` — three-zone container + drawer toggle + `⌘B` keybinding.
- `app/components/folder-shell/FolderRail.vue` — fixed 240px left rail. Members, Knowledge, Voids nav, bottom actions. Active state driven by `?tab=`.
- `app/components/folder-shell/FolderHierarchyDrawer.vue` — overlay drawer (uses `UiDrawer` or custom positioned panel). Two sections: folder tree (`FolderTree`) on top, active folder's files list (`FolderFilesPanel`) below, divider with `Files in › <name>` + `+ Add files` popover.
- `app/components/folder-shell/FolderTree.vue` — recursive folder tree with chevrons, active highlight, kebab per row (Rename / Move / Delete reuse existing handlers).
- `app/components/folder-shell/FolderFilesPanel.vue` — grouped (Today/Yesterday/This week) compact file rows (tinted-icon tile + two-line metadata + status pill + kebab). Used inside drawer.
- `app/components/folder-shell/FolderFilesList.vue` — main-pane version: table-style layout (Name / Status / Added / Size / •••) per approved screen 1. Reuses status pill + kebab sub-components.
- `app/components/folder-shell/FileStatusPill.vue` — small component rendering the status dot + label with theme tokens.
- `app/components/folder-shell/FileKebabMenu.vue` — dropdown menu (uses `UiDropdownMenu`) with Open / Rename / Move to… / Download / Delete.

**Modified files:**
- `app/pages/app/folders/[id].vue` — opt into `definePageMeta({ layout: 'folder' })`; replace outer wrapper + tabs chrome with content that renders inside the `FolderShell` main slot. Keep Chat / Flashcards / Quiz / Documents views but drive `activeTab` from `?tab=` only (rail owns the tab switch). When `activeTab === 'documents'` the main pane shows `<FolderFilesList>`; other tabs render the current void UIs unchanged. Remove the old in-page `UiTabsList` row (rail + URL replace it).
- `app/components/documents/FileStatusItem.vue` — extract status-pill + kebab into the new shared components; delegate to `FileStatusPill` + `FileKebabMenu`. Keep public props stable.

**Read-only references:**
- `app/composables/useDocuments.ts`, `useFolders.ts`, `useChat.ts` — no changes.
- `convex/documents.ts`, `convex/folders.ts` — no changes.

## Tasks

- [ ] T1 — Create `folder` layout + `FolderShell` container with grid (`grid-cols-[240px_1fr]`), `⌘B` shortcut, and `useLocalStorage` drawer-open state.
- [ ] T2 — Build `FolderRail`:
    - `Members` + `Knowledge` section
    - Voids section: Chats (count from recent conversations), Flashcards (count from `useFlashcards`), Quiz (count from `useQuizzes`)
    - Active state from `?tab=` (documents = Knowledge active, chat = Chats active, etc.)
    - `+ New Void` primary pill + Settings/Help/Logout ghost icons
- [ ] T3 — Build `FolderHierarchyDrawer` positioned absolute left:240px, width:55vw, full-height overlay with dim/backdrop on the remaining main area. Close on outside click, `Escape`, or toggle.
- [ ] T4 — Build `FolderTree` (recursive, collapsible sections, active highlight, per-row kebab reusing `handleRename` / `handleDeleteRequest` / `handleNewSubfolder`).
- [ ] T5 — Build `FolderFilesPanel` (grouped-by-date rows for the drawer) reusing `FileStatusPill` + `FileKebabMenu`.
- [ ] T6 — Build `FolderFilesList` (main-pane table-style) with header row, status column, kebab column.
- [ ] T7 — Extract `FileStatusPill` + `FileKebabMenu`. Map existing statuses: `indexed → green "Indexed"`, `processing → amber "Processing"`, `pending/queued → muted "Queued"`, `failed → red "Failed"`.
- [ ] T8 — Wire `app/pages/app/folders/[id].vue` into the new shell. Remove the in-page tabs UI; drive `activeTab` purely from `?tab=`. When `tab=documents`, render `<FolderFilesList>` in the main pane; other tabs keep their existing void content (Chat / Flashcards / Quiz).
- [ ] T9 — Drawer toggle button in main-pane top bar + keyboard hint kbd badge.
- [ ] T10 — Responsive: below `lg` (1024px), rail collapses to 64px icon-only; drawer becomes a full-width sheet.
- [ ] T11 — Component tests: `FolderRail.test.ts` (active state), `FolderHierarchyDrawer.test.ts` (toggle, ⌘B, outside-click), `FolderFilesList.test.ts` (status chip mapping, kebab emits). Use `@nuxt/test-utils` + `mountSuspended`.
- [ ] T12 — Manual smoke: upload → processing pill → indexed pill; open drawer, switch folders; rename / move / delete via kebab; rail void nav updates `?tab=` without reload.

## Acceptance Criteria

1. Folder page uses `layout: 'folder'`; default app sidebar is not rendered on this route.
2. Left rail is exactly 240px wide, not resizable, remains visible when the drawer is open.
3. Voids list in the rail shows Chats, Flashcards, Quiz with live counts; clicking a void updates `?tab=` in the URL without a full navigation.
4. Drawer opens anchored to the right edge of the rail (left:240px), width 55vw, overlays the main content with a dimmed backdrop. Toggled by the top-bar button and `⌘B`. Outside-click / `Escape` closes it.
5. Drawer top half is the folder tree with the active folder highlighted in amber; bottom half is the active folder's files list, grouped by Today / Yesterday / This week.
6. Each file row (both in drawer panel and main list) shows the correct status pill — Indexed (green), Processing (amber), Queued (muted), Failed (destructive).
7. Each file row has a kebab menu with Open / Rename / Move to… / Download / Delete. Delete and Move reuse the existing confirm + picker dialogs.
8. Visual parity with the approved Stitch screens — warm-focus dark palette, rounded-xl cards, amber active accents, Inter type.
9. Below 1024px: rail collapses to icon rail, drawer becomes a full-width sheet; no horizontal scroll.
10. All component tests pass; lint, typecheck, and existing tests stay green.

## Spec Change Log

_empty_
