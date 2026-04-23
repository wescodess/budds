---
slug: g4-folder-knowledge-tree
status: ready-for-dev
design_ref: c1412121785a40699f471fcc93a18346
---

# G4 — Folder Knowledge Tree (Pane A)

## Frozen Intent
Replace the Pane A "Knowledge tree (G4)" placeholder with a real knowledge tree: a search input at top, collapsible Subfolders section, collapsible Documents section, and a sticky footer with "New subfolder" and "Upload file" actions. All data comes from existing `useFolders` and `useDocuments` composables — no new queries.

## Boundaries
- **Always:** Live-filter via local text match; open subfolder via `router.push` to `/app/folders/<id>`; reuse existing `createSubfolder`, `uploadFiles`, `deleteDocument`, `moveDocument`.
- **Ask first:** Drag-and-drop reordering or cross-folder drag (defer to G5+).
- **Never:** Introduce new Convex queries/mutations, modify folder schema, or touch Pane B/C.

## I/O Matrix
| Input | Expected |
|---|---|
| Pane renders with 0 subfolders + 0 docs | Subfolders section collapses to an empty hint; Documents section shows "Drop files here or click upload"; footer buttons visible. |
| Type in search | Subfolders + Documents lists filter (case-insensitive, by name). Non-matching sections show "No matches". |
| Click subfolder row | Router navigates to `/app/folders/<subfolder._id>`. |
| Click "+ New subfolder" (footer or section) | Opens existing `FoldersCreateFolderModal` preseeded with `parentId = current folder._id`. |
| Click "+ Upload file" (footer or section) | Opens hidden file input; on select, calls `uploadFiles(files, currentFolderId)`. |
| Click row ⋯ menu on subfolder | `Rename` (emits `edit-subfolder`) / `Delete` (emits `delete-subfolder`). |
| Click row ⋯ menu on document | `Move` (emits `move-document`) / `Delete` (calls `deleteDocument`). |
| Section header chevron | Toggle collapsed/expanded (local state, not persisted). |
| Empty folder + dashed drop zone | Clickable → same upload flow. |
| `folder` prop is `null` | Renders skeleton placeholders. |

## Code Map
- `app/components/folders/FolderKnowledgeTree.vue` (new) — the pane body.
- `app/components/folders/FolderContextPane.vue` — replace placeholder section with `<FoldersFolderKnowledgeTree …/>`, add emits `new-subfolder` / `upload-files` / `open-subfolder`.
- `app/pages/app/folders/[id].vue` — bind `subfolders` (derived from `allFolders.value.filter(f => f.parentId === folderId.value)`), pass `documents`, wire handlers.
- `tests/component/folders/folder-knowledge-tree.test.ts` (new) — P0 coverage.

## Tasks
- [ ] Add `FolderKnowledgeTree.vue` with search input, two collapsible sections, sticky footer
- [ ] Wire `FolderContextPane` to host it
- [ ] Bind real data in `[id].vue`
- [ ] Component tests (render, filter, empty, emit)
- [ ] `pnpm test:component tests/component/folders/`

## AC
- Replaces the placeholder; data-testid `folder-knowledge-tree` present.
- Search filters both sections live.
- Clicking a subfolder navigates.
- Footer "New subfolder" and "Upload file" both trigger the correct paths.
- All existing folder tests still pass.
