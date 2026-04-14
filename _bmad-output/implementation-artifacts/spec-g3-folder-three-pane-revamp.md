---
slug: g3-folder-three-pane-revamp
status: ready-for-dev
epic: G3 (post-sprint UI revamp)
is_ui: true
design_screens:
  - stitch:898d1fe0f46e407ca96b88746eb8684d (drawer closed — files list)
  - stitch:da40666b5c4c44ae959b614a8fa60cea (drawer open — hierarchy + files)
  - stitch:184ea1190d144db7bc079fab439f4958 (create-void modal — 3-col type picker)
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

**2026-04-14 — Scope refinement: folder-scoped voids + CreateVoidDialog dispatch.**

- **Trigger (user):** "A void is a dedicated space for a type of interaction (chat, flashcard, quiz). Click 'Create void' from the rail → type-picker modal (masonry, like the dashboard block grid). When a void is created it is tied to the folder it was created in and can only be viewed in that folder or have access to the resources (members and knowledge) in that folder."
- **Discovery:** `conversations`, `quizzes`, `flashcardSets` already carry `folderId: v.id('folders')` in `convex/schema.ts`. Folder-scoping is already a schema invariant; no migration, no new FK needed. The gap is purely UX: the rail's `New Void` button currently opens the subfolder modal (`[id].vue:291` → `@new-void="showSubfolderModal = true"`), which is a placeholder misuse.
- **Design approved:** Stitch screen `184ea1190d144db7bc079fab439f4958` (Direction A, 3-col grid, a11y 100/100). Component shipped at `app/components/voids/CreateVoidDialog.vue` with 4 passing tests in `tests/component/voids/create-void-dialog.test.ts`.

### Added tasks

- [ ] T13 — Wire `CreateVoidDialog` into `app/pages/app/folders/[id].vue`:
    - Replace the `@new-void="showSubfolderModal = true"` handler with `@new-void="newVoidOpen = true"`.
    - Render `<CreateVoidDialog v-model:open="newVoidOpen" :folder-name="folder?.name ?? ''" @create="onCreateVoid" />` alongside the existing subfolder modal.
    - `onCreateVoid(type)` dispatches by `VoidType`:
      - `chat` → call `api.conversations.createConversation({ folderId, title: 'New chat' })`; on success, `activeTab = 'chat'` + push `?tab=chat&conversation=<newId>` so the chat view auto-loads the new conversation. Close dialog. Toast `Chat void created`.
      - `flashcards` → `activeTab = 'flashcards'` + push `?tab=flashcards`. Existing flashcards tab handles generator entry. Close dialog. (No mutation at dialog-submit time; `flashcardSets` rows are produced by the generator flow.)
      - `quiz` → `activeTab = 'quiz'` + push `?tab=quiz`. Same rationale as flashcards. Close dialog.
    - On any dispatch failure, `toast.error(unwrapConvexError(e))` and leave the dialog open with submit re-enabled.
- [ ] T14 — Extend `tests/component/voids/create-void-dialog.test.ts` with a "disabled submit stays disabled during in-flight submit" assertion (guards against double-submit on chat path).
- [ ] T15 — Add page-level integration test or expand an existing folder-page smoke to assert: clicking `[data-testid="rail-new-void"]` opens `[data-testid="create-void-dialog"]` and the old subfolder modal stays closed.
- [ ] T16 — Delete the now-orphaned `showSubfolderModal` wiring **only if** no other call site depends on it; otherwise, leave subfolder creation on its own dedicated trigger (not the rail's Create Void). Verify by grep of `showSubfolderModal` usage.

### Added AC

11. Clicking `New Void` in the rail opens `CreateVoidDialog` populated with the active folder's name in the title. The subfolder modal does **not** open.
12. With no type selected, the primary CTA is disabled. Selecting a type enables the CTA and updates its label (`Create chat void` / `Create flash cards void` / `Create quiz void`). Unselected cards dim to 60% opacity; selected card shows the amber 1.5px border + dot indicator.
13. Submitting with `type=chat` creates a conversation under `folderId` and navigates to `?tab=chat&conversation=<newId>`. Submitting with `flashcards` or `quiz` switches `?tab=` only (no row created at submit time — deferred to each type's generator surface).
14. On mutation failure the dialog stays open, submit is re-enabled, and a toast with the unwrapped error is shown.
15. No schema change lands in this spec. `convex/schema.ts` is untouched. Any future multi-type unified `voids` table is explicitly deferred.

### Non-goals (this amendment)

- Unified `voids` table migration.
- Unified `listVoids(folderId)` query. The rail continues to sum counts from the three typed tables.
- Members enforcement (voids already implicitly "inherit members" via `folderId` ownership; no explicit membership table yet).
- Changes to the Flashcards / Quiz generator UX — out of scope; this amendment only routes into their existing entry points.

**2026-04-14 (b) — Scope refinement: rail lists individual folder-scoped voids.**

- **Trigger (user):** "In the sidebar, in the voids section, we only want to see voids created and attached to the folder we currently are in. If no voids show CTA and the create button below should be hidden."
- **Change:** `FolderShellRail` no longer renders three fixed type rows (Chats / Flashcards / Quiz) with counts. It now renders one row per individual void instance belonging to the current folder, sorted by `_creationTime` desc, with the type icon (chat = `MessageSquare`, flashcards = `Layers`, quiz = `ClipboardList`) and the void title. Conversations are filtered to the current `folderId`; flashcard sets and quizzes are already scoped by `api.*.listByFolder({ folderId })`.
- **Empty state:** when the folder has zero voids, the rail renders an inline dashed-border empty block with copy "No voids in this folder yet." and a primary `Create your first void` button (`data-testid="rail-voids-empty-cta"`). In compact mode the empty state collapses to a single `+` square icon button (`data-testid="rail-voids-empty-compact"`).
- **Bottom CTA:** the persistent `+ New Void` footer button (`data-testid="rail-new-void"`) is hidden when the list is empty (the inline CTA takes over) and shown when at least one void exists.

### Added tasks

- [ ] T17 — `FolderShellRail`: add `activeConversationId?: string | null` prop and `select-void: [{ type, id }]` emit. Replace the type-count items with `v-for` over `voids`. Add empty-state block + compact variant. Wrap bottom `+ New Void` with `v-if="hasVoids"`.
- [ ] T18 — `FolderShell`: thread the new prop and event straight through to the parent page.
- [ ] T19 — `[id].vue`: implement `onSelectVoid({ type, id })`. For `chat`, update `?tab=chat&conversationId=<id>`. For `flashcards`/`quiz`, switch `?tab=` and strip the stale `conversationId`.
- [ ] T20 — Update `tests/component/folder-shell/folder-shell-rail.test.ts` for the new structure (empty-state block, compact `+` button, per-instance rows, hidden bottom CTA when empty). Defer until the rail test file is revisited.

### Added AC

16. When the current folder has zero chat / flashcard / quiz rows, the rail shows the inline empty-state CTA and hides the bottom `+ New Void` footer button.
17. When the current folder has one or more voids, the rail lists each void on its own row (chat rows show conversation title, flash card rows show set title, quiz rows show quiz title), the bottom `+ New Void` footer button is visible, and the inline empty state is not rendered.
18. Clicking a void row switches `?tab=` to that void's type and, for chat rows, loads that specific conversation via `?conversationId=<id>`. Clicking a flashcard or quiz row switches the tab only.
19. The active row highlight follows the URL: a chat row is active iff `?tab=chat` **and** `?conversationId=<row-id>`; a flashcards or quiz row is active iff `?tab=` matches its type (current iteration — single-active row per non-chat type is acceptable until the flashcards/quiz generators produce addressable `?id=` surfaces).
