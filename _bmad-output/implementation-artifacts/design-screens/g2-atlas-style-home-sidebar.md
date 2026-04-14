# G2 — Atlas-Style Home Sidebar · Design Proposal

**Reference:** `docs/screenshots/Screenshot 2026-04-12 at 8.35.10 PM.png` (Atlas ChatGPT)
**Design system:** Warm Focus (DESIGN.md)
**Phase:** DESIGN — awaiting approval (no auto-resolve per `feedback_design_first.md`)

---

## Intent

Replace the current wide (`w-64`) sidebar with a compact **icon rail** (`w-14`, ~56px) that mirrors Atlas's left navigation. The rail hosts only the highest-signal entries: brand mark, top nav, **root folders only** (rendered via G1's `FolderBadge`), a create-folder CTA, and footer utilities. Subfolders, recent chats, and the folder tree move out of the rail (Recent Chats → folder page in G3; tree → Knowledge drawer in G4).

This is purely a layout/navigation refactor — no schema, no backend. Consumes G1's shipped `color` + `icon` folder metadata.

---

## Rail anatomy (top → bottom)

```
┌──────┐
│  B   │  Budds logo / home-link (amber on dark) — doubles as Home nav
│      │
│ ░░░  │  ← 1px sidebar-border divider
│      │
│ [📁] │  Root folder 1 — FolderBadge (G1 color+icon), tooltip = folder name
│ [📁] │  Root folder 2
│ [📁] │  ...
│ [📁] │  Root folder N (scrollable if overflow)
│      │
│  +   │  Create folder CTA — FolderPlus icon, tooltip "New folder"
│      │
│  ⋮   │  flex-1 spacer
│      │
│ ☀/🌙 │  Theme toggle
│ 👤   │  User avatar → dropdown (Sign out / Export / Delete account)
└──────┘
```

**Width:** `w-14` (56px) fixed. **No collapse toggle** — this rail is the permanent compact state. The existing `collapsible="icon"` on `<UiSidebar>` stops being meaningful; we drop that prop.

**Active state:** 2px left border in `--primary` amber + `bg-sidebar-accent` tint on the active folder tile, per DESIGN.md sidebar spec. Matches current pattern.

**Hover state:** subtle `bg-sidebar-accent` tint (8% amber).

**Tooltips:** Reka `UiTooltip` (already used by `UiSidebarMenuButton`) — `side="right"`, delay 300ms. Required for every icon-only entry.

---

## Screens

### Screen 1 — Dashboard (home route, `/`)
- Rail (56px, described above) — Home active.
- Main area unchanged: action hub cards + recent chats + general chat.

### Screen 2 — Dashboard w/ root folders populated
- 4–6 root folders rendered as `FolderBadge` tiles in the rail.
- `+` create-folder CTA directly below the last folder (not pinned to bottom — it scrolls with folder list).
- Scroll: if rail folder list overflows, it scrolls (hide scrollbar); header + footer remain pinned.

### Screen 3 — Folder page (`/app/folders/[id]`)
- Rail: the active root folder's tile gets amber left-border. Subfolders **do not** appear in the rail — they belong to the page content (G3).
- Main area: unchanged from current (tabs for Chat/Flashcards/Quiz/Documents). G3 will rework this later.

### Screen 4 — Create folder from rail
- Click `+` → opens existing `FolderFormModal` in `create` mode, `parentId: null` (root).
- No new component.

### Screen 5 — Mobile (`<768px`)
- Rail collapses into a **Sheet overlay** triggered by existing `UiSidebarTrigger` in the header.
- Same content rendered inside the sheet, but expanded to full width with folder names visible next to badges (labels come back when horizontal space is available).

---

## Deltas from current layout

| Area | Before | After |
|---|---|---|
| Sidebar width | `w-64` expanded, `w-[3rem]` collapsed | `w-14` permanent icon rail |
| Nav section | Home + General Chat | Logo acts as Home; General Chat removed from rail |
| Folders section | `SidebarFolderTree` (all folders, nested) | Root folders only, as `FolderBadge` tiles |
| "New folder" CTA | Icon button in group header | First-class `+` tile in rail folder list |
| Recent Chats section | Rendered in expanded sidebar | Removed from rail (moves to G3 folder page) |
| Footer | Avatar + name + dropdown | Icon avatar only (name hidden; dropdown preserved) |
| Theme toggle | Header button | Footer icon above avatar |

**Removed from this spec's scope:**
- Knowledge drawer (G4)
- 3-pane folder page layout (G3)
- Subfolder navigation inside rail

**Kept as-is (not regressing):**
- `FolderFormModal` create/edit flow (G1).
- `UiSidebarProvider` / `UiSidebar` / `UiSidebarMenu` primitives — we restyle them to 56px, we don't rip them out.
- `app/components/sidebar/FolderTree.vue` stays on disk; it's just no longer rendered by `default.vue`. (G4 will re-use it inside the Knowledge drawer.)

---

## Resolved design decisions

1. **General Chat entry** — **DROPPED from rail.** `/chat` route remains accessible (direct nav / deeplink) but gets no dedicated rail icon. Keeps rail minimal and matches Atlas reference.
2. **"+" placement** — **with folder list** (scrolls), matches Atlas reference.
3. **Empty-state** — `+` tile only, with a larger "Create your first folder" tooltip on first hover.

---

## Non-goals

- No schema change.
- No new routes.
- No accessibility regressions: all rail items keyboard-focusable, tooltips serve as accessible labels.
- No animation changes beyond DESIGN.md defaults.
