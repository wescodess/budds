---
title: 'Folder metadata + Create/Edit Folder modal (G1)'
type: 'feature'
created: '2026-04-13'
status: 'complete'
baseline_commit: 'e628f3264ad90f9ac5f7f997ddfd4133df318a83'
context:
  - 'DESIGN.md — warm-dark palette, amber primary, 12px radius, dropdown + modal conventions'
  - '_bmad-output/implementation-artifacts/deferred-work.md — G2/G3/G4 deferred'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Folders today carry only `name` + `parentId` + `documentCount`. Creation is an inline text input in three different call sites (dashboard, folder page, sidebar tree) with no modal, no description, no visual identity. Users can't distinguish folders at a glance and the UX reads like a first-draft.

**Approach:** Extend the `folders` table with `description`, `color`, `icon`. Ship a single reusable `FolderFormModal` (Create and Edit modes) that replaces every inline-create call site and introduces a first-class edit flow with a Danger Zone. Folder renders (sidebar tree + dashboard cards) consume color + icon. Color list = 20 named preset swatches; icon list = curated lucide subset grouped into 6 categories. Icon tint follows the selected color.

## Boundaries & Constraints

**Always:**
- Single shared source of truth for palette + icon catalog (`convex/folderPalette.ts` + `convex/folderIcons.ts`, imported server-side *and* via the existing `#convex/` alias client-side).
- `color` and `icon` values stored as **string keys** (e.g. `"iris"`, `"atom"`) — never hex or SVG. Keys validated against the catalog on every mutation.
- All three new fields are `v.optional()` at the schema level for safe deploy; mutations apply server-side defaults (`color: "slate-tide"`, `icon: "folder"`, `description: ""`) when absent.
- Existing folders backfilled to those defaults via a one-off `internalMutation` runnable from the Convex dashboard (documented in spec).
- Modal uses VeeValidate + Zod (already wired). Name required, 1–100 chars; description optional, 0–280 chars.
- Icon color in UI is derived purely from `folder.color` — do not store a separate icon color.
- Preserve existing rename/delete UX in FolderTree (out of scope to rewrite).

**Ask First:**
- Removing the inline "New Subfolder" input inside `[id].vue` (it's been there since Epic 2 and may be muscle memory).
- Any change to `folders` table indexes.

**Never:**
- G2/G3/G4 work (Atlas rail, 3-pane layout, Knowledge drawer) — deferred.
- Arbitrary / free-form hex colors.
- Per-user custom icon uploads.
- Migration scripts that rewrite `_id` or break references.
- Tailwind arbitrary hex classes at folder render sites — all colors must resolve via the palette module.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Create folder, full form | `{name: "Quantum Physics", description: "…", color: "iris", icon: "atom", parentId?: Id}` | Folder row inserted with all fields; `updatedAt = now`; modal closes; toast "Folder created". | N/A |
| Create folder, only name filled | `{name: "Scratch"}` | Server defaults `color: "slate-tide"`, `icon: "folder"`, `description: ""`. | N/A |
| Create folder, invalid color key | `{color: "hotpink"}` | Mutation throws `ConvexError("Invalid color: hotpink")`; modal shows inline error under Color field. | Form stays open; other fields preserved. |
| Create folder, invalid icon key | `{icon: "tardis"}` | Mutation throws `ConvexError("Invalid icon: tardis")`. | Same as above. |
| Edit folder, change color only | `{id, color: "jade"}` | `updateFolder` patches `color` + `updatedAt`; sidebar + dashboard re-render instantly. | N/A |
| Edit folder, delete via Danger Zone | Click Delete → confirm dialog → confirm | Existing `deleteFolder` mutation runs (cascade). Modal closes; route to parent or dashboard. | Toast error if delete fails. |
| Backfill existing folders | Run `internalMutation:backfillFolderDefaults` | Every folder missing `color`/`icon`/`description` gets defaults. Idempotent (skips already-defaulted rows). | Logs count patched. |
| Name > 100 chars | Form submit | Zod blocks client-side; server also rejects. | Inline error "Max 100 characters". |
| Description > 280 chars | Form submit | Zod blocks client-side; server rejects. | Inline error. |

</frozen-after-approval>

## Code Map

- `convex/schema.ts` — add `description/color/icon` as `v.optional(v.string())` to `folders`.
- `convex/folderPalette.ts` — **NEW.** Export `FOLDER_COLORS` (20 entries `{key, name, hex}`), `FOLDER_COLOR_KEYS` (string literal union), `DEFAULT_COLOR_KEY = "slate-tide"`, `isValidColorKey()`.
- `convex/folderIcons.ts` — **NEW.** Export `FOLDER_ICON_GROUPS` (6 groups × curated lucide names, ~48 total), `FOLDER_ICON_KEYS`, `DEFAULT_ICON_KEY = "folder"`, `isValidIconKey()`.
- `convex/folders.ts` — extend `createFolder` + `createSubfolder` args with optional `description/color/icon`; add new `updateFolder` mutation (partial patch). Add `internalMutation` `backfillFolderDefaults`.
- `convex/folders.test.ts` — extend existing suite + new cases per I/O Matrix.
- `app/components/folders/FolderFormModal.vue` — **NEW.** Props `{mode: 'create' | 'edit', parentId?: Id, folder?: Doc<'folders'>, open: boolean}`. Emits `update:open`. Uses Form primitives + UiSelect for color + UiCombobox (searchable) for icon. Icon grid groups come from `FOLDER_ICON_GROUPS`; icon tint derives from selected color hex.
- `app/components/folders/ColorSelect.vue` — **NEW.** UiSelect wrapper: trigger = swatch + fancy name + hex; content = list of 20.
- `app/components/folders/IconSelect.vue` — **NEW.** UiCombobox wrapper: trigger = tinted icon tile + icon name; content = search input + grouped grid; icons rendered in current color's hex.
- `app/components/folders/FolderBadge.vue` — **NEW.** Small presentational: renders a color-tinted tile with the folder's icon. Used by FolderTree + dashboard cards.
- `app/composables/useFolders.ts` — add `updateFolder(id, patch)`; expand `createFolder`/`createSubfolder` signatures.
- `app/pages/app/folders/[id].vue` — replace inline `showNewSubfolder` input with `FolderFormModal` in create mode.
- `app/layouts/default.vue` — replace dashboard-level `showNewFolderInput` with `FolderFormModal`. Wire edit entry point on folder right-click / FolderTree menu.
- `app/components/sidebar/FolderTree.vue` — render `FolderBadge` (icon + color) instead of generic `FolderOpen`. Add "Edit" menu item next to existing Rename/Delete that opens `FolderFormModal` in edit mode. `requestEdit` must call `cancelRename()` before emitting so an in-place rename race can't leak state into the modal. **"New subfolder" (dropdown + context menu) must emit a `new-subfolder(parentId)` event for the parent to open `FolderFormModal` in create mode with that `parentId`** — remove the inline rename-in-place subfolder input (`creatingParentId`, `newSubfolderName`, `submitCreateSubfolder`, `cancelCreateSubfolder`, the `data-subfolder-input` block) so every "New subfolder" CTA routes through the modal (AC1).
- `app/components/dashboard/AddCourseCard.vue` — replace the inline `UiInput` + create button with a trigger that opens `FolderFormModal` in create mode (dashboard-level, no `parentId`).
- `app/components/dashboard/CourseCard.vue` — widen the `course` prop to carry `color?: string` + `icon?: string`; render `FolderBadge` in the card header so dashboard cards show the same identity as sidebar nodes.
- `app/components/dashboard/FolderPickerDialog.vue` — render `FolderBadge` next to each folder row so the picker matches the rest of the UI (no generic folder icon).
- `app/assets/css/tailwind.css` — declare `--color-folder-<key>` CSS vars for the 20 palette entries under `:root` + `.dark` (same values; vibrant palette works on both).
- `tests/support/factories/folder.factory.ts` — default new fields.
- `tests/component/folders/folder-form-modal.test.ts` — **NEW.** Render + VeeValidate wiring; create + edit mode.
- `tests/component/sidebar/folder-tree.test.ts` — extend to assert `FolderBadge` renders with selected color/icon.

## Tasks & Acceptance

**Execution:**
- [x] `convex/folderPalette.ts` — create module per palette table below.
- [x] `convex/folderIcons.ts` — create module with the 6 grouped lucide names (~48 total) per DESIGN.md + approved screens.
- [x] `convex/schema.ts` — add three `v.optional(v.string())` fields to `folders`.
- [x] `convex/folders.ts` — extend `createFolder` / `createSubfolder` (apply defaults + validate against catalogs); add `updateFolder`; add `backfillFolderDefaults` internalMutation.
- [x] `convex/folders.test.ts` — cover happy path + all validation failures + backfill idempotency.
- [x] `app/assets/css/tailwind.css` — add `--color-folder-*` CSS vars.
- [x] `app/components/folders/FolderBadge.vue` — tinted tile renderer.
- [x] `app/components/folders/ColorSelect.vue` + `IconSelect.vue` — dropdowns per approved screens.
- [x] `app/components/folders/FolderFormModal.vue` — unified create/edit modal; Zod schema; Danger Zone in edit mode calls existing `deleteFolder`.
- [x] `app/composables/useFolders.ts` — wire `updateFolder`; widen create signatures.
- [x] `app/pages/app/folders/[id].vue` — swap inline subfolder input for modal trigger.
- [x] `app/layouts/default.vue` — swap dashboard create input for modal trigger; add edit entry.
- [x] `app/components/sidebar/FolderTree.vue` — use `FolderBadge`; wire Edit menu.
- [x] `tests/support/factories/folder.factory.ts` — add `color/icon/description` defaults.
- [x] `tests/component/folders/folder-form-modal.test.ts` — create/edit render + validation.
- [x] `tests/component/sidebar/folder-tree.test.ts` — assert badge rendering.
- [x] `app/components/dashboard/AddCourseCard.vue` — swap inline input + button for `FolderFormModal` trigger (dashboard create).
- [x] `app/components/dashboard/CourseCard.vue` — extend prop type with `color`/`icon`, render `FolderBadge` in the card header.
- [x] `app/components/dashboard/FolderPickerDialog.vue` — render `FolderBadge` next to each folder row.
- [x] `convex/folders.ts` — upgrade `normalizeName` / `normalizeDescription` to throw `ConvexError` (not plain `Error`) so client surfaces inline form errors consistently.
- [x] `app/components/sidebar/FolderTree.vue` — in `requestEdit`, call `cancelRename()` before emitting `edit` to avoid a rename-in-place race when the Edit menu item is chosen mid-rename.
- [x] `app/components/folders/FolderFormModal.vue` — reset form only on the `open` false→true edge (remove reset on every `props.folder` change) so edits in-flight aren't wiped by unrelated reactivity.
- [x] `app/components/folders/IconSelect.vue` — clear the `search` input when the popover closes (`watch(open, v => { if (!v) search.value = '' })`).
- [x] `app/components/sidebar/FolderTree.vue` — remove the inline "new subfolder" flow; emit `new-subfolder(parentId)` from the dropdown and context-menu items so the parent opens `FolderFormModal` in create mode. Delete `creatingParentId`, `newSubfolderName`, `submitCreateSubfolder`, `cancelCreateSubfolder`, and the `data-subfolder-input` input block.
- [x] `app/layouts/default.vue` — listen for `@new-subfolder` on `FolderTree`; set `folderModalParentId` + open `FolderFormModal` in create mode (mirror the existing root "New folder" wiring, just with a `parentId` seeded).
- [x] `app/components/dashboard/AddCourseCard.vue` — make the non-inline root keyboard-activatable: use `<button type="button">` (preferred) or add `role="button" tabindex="0" @keydown.enter.space.prevent="openModal"`.
- [x] `app/components/folders/FolderFormModal.vue` — in addition to the open-edge reset, also watch `() => props.folder?._id` so swapping the target folder while the modal stays open reseeds name/description/color/icon from the new folder.
- [x] `app/components/folders/FolderFormModal.vue` — in the submit catch block, unwrap `ConvexError` messages: strip the `[CONVEX M(...)]` / `ConvexError:` prefix before passing to the toast so the user sees the raw "Folder name must be…" text (honors the I/O Matrix "inline error" contract for the validation-failure rows).

**Acceptance Criteria:**
- Given a user clicks any "New folder" or "New Subfolder" CTA, when the trigger fires, then `FolderFormModal` opens with empty fields and Name focused.
- Given the modal is open in create mode with name + color + icon selected, when the user submits, then a folder is inserted with those exact values and the modal closes.
- Given the user opens the Icon dropdown, when the Color selection is "iris", then every icon tile in the dropdown renders in `#8b5cf6`.
- Given an existing folder without a color, when viewed anywhere (sidebar, dashboard), then it renders with the `slate-tide` default — never a broken/empty icon.
- Given the user opens a folder's Edit modal, when they change color or icon, then the sidebar tree + dashboard cards update within one reactive tick.
- Given the user triggers Delete inside the edit modal's Danger Zone, when they confirm, then the existing cascade `deleteFolder` runs and the modal closes.
- Given the `backfillFolderDefaults` internalMutation is run, when it executes twice, then the second run patches zero rows.

## Spec Change Log

**2026-04-13 — bad_spec loopback from step-04 review.**
- **Trigger:** Acceptance auditor found three dashboard surfaces that still use the pre-G1 UX — `AddCourseCard.vue` (inline input), `CourseCard.vue` (generic icon, no color), `FolderPickerDialog.vue` (generic folder icon). This violates AC1 ("any 'New folder' CTA opens `FolderFormModal`") and AC4 ("folder renders anywhere show color+icon") on the dashboard.
- **Root cause:** Original Code Map only listed the sidebar + folder detail page as render/create call sites; the dashboard route was not audited.
- **Amended:** Added the three dashboard files to Code Map + Tasks; added four targeted patches (ConvexError upgrade, FolderTree rename-race, FolderFormModal reset-on-open-edge, IconSelect search clear) surfaced by blind-hunter + edge-case reviewers.
- **KEEP (do not rewrite):** `convex/folderPalette.ts`, `convex/folderIcons.ts`, `convex/schema.ts` folders migration, `convex/folders.ts` (except the normalize helpers), `FolderFormModal.vue` (except reset watcher), `ColorSelect.vue`, `IconSelect.vue` (except search reset), `FolderBadge.vue`, `useFolders.ts`, `tailwind.css` palette vars, existing tests, `pages/app/folders/[id].vue` + `layouts/default.vue` modal wiring, factories. Only touch the files listed in the unchecked tasks above.
- **Deferred findings** captured in `deferred-work.md`: backfill 2000-row cap, `updateFolder` lost-update race, `useFolders` SSR stub + dual signatures, lucide PascalCase drift silent fallback, IconSelect synonym search, unsaved-changes guard, description whitespace-trim policy, icon-catalog duplicate assertion.

**2026-04-13 (round 2) — second bad_spec loopback from step-04 review.**
- **Trigger:** Acceptance auditor found `FolderTree.vue` still renders a legacy inline rename-in-place "New subfolder" input via the dropdown and context-menu items — AC1 ("any 'New folder' or 'New Subfolder' CTA opens `FolderFormModal`") is violated in the sidebar tree. Also: `AddCourseCard` non-inline root is `<div>`+`@click`, not keyboard-activatable (a11y regression from the round-1 migration). `FolderFormModal` still doesn't reseed when `props.folder` changes while modal stays open. `ConvexError` messages reach the toast with `[CONVEX M(...)]` wrapping.
- **Amended:** Code Map extended for `FolderTree` (remove inline subfolder flow, emit `new-subfolder(parentId)`) and `default.vue` (listen + open modal with parentId). New unchecked tasks: FolderTree migration, default.vue wiring, AddCourseCard a11y, FolderFormModal folder-id watcher, ConvexError unwrap.
- **KEEP (do not rewrite):** Everything previously built and currently working — schemas, catalogs, mutations body, ColorSelect, IconSelect, FolderBadge, useFolders, tailwind vars, tests, factories, CourseCard/FolderPickerDialog/pages/[id].vue already using the modal, the normalize → ConvexError change, the existing open-edge reset watcher, `cancelRename()` call in `requestEdit`, IconSelect search clear. Only touch the files listed in the new unchecked tasks.
- **Deferred findings (round 2):** `getFolderDescendantCounts` returns 0 (pre-existing bug), `CourseCard` quick-action buttons announced to a11y but no-op (pre-existing), `resolveIcon` memoization, hex-format brittleness in IconSelect tint, `index.vue` `as any` / `?? 0` defensive cast cleanup. Appended to `deferred-work.md`.

## Design Notes

**Palette (20 preset colors, string keys):**

| key | name | hex |
|---|---|---|
| `ember` | Ember | `#f59e0b` |
| `ochre` | Ochre | `#d97706` |
| `saffron` | Saffron | `#eab308` |
| `persimmon` | Persimmon | `#ef4444` |
| `sangria` | Sangria | `#be123c` |
| `coral` | Coral | `#fb7185` |
| `rose-quartz` | Rose Quartz | `#ec4899` |
| `orchid` | Orchid | `#d946ef` |
| `iris` | Iris | `#8b5cf6` |
| `indigo-ink` | Indigo Ink | `#6366f1` |
| `lagoon` | Lagoon | `#0ea5e9` |
| `cerulean` | Cerulean | `#2563eb` |
| `teal-bloom` | Teal Bloom | `#14b8a6` |
| `jade` | Jade | `#10b981` |
| `mantis` | Mantis | `#84cc16` |
| `moss` | Moss | `#65a30d` |
| `mocha` | Mocha | `#92400e` |
| `dune` | Dune | `#a16207` |
| `slate-tide` | Slate Tide | `#475569` |
| `graphite` | Graphite | `#374151` |

**Icon groups (lucide keys, stored as plain strings):**
- `study` — book-open, notebook-pen, graduation-cap, library, pencil, highlighter, bookmark, brain-cog
- `subjects` — calculator, atom, microscope, flask-conical, landmark, globe-2, palette, music, code-2, languages
- `objects` — backpack, briefcase, folder, file-stack, clipboard-list, lightbulb, coffee
- `symbols` — star, heart, flag, target, flame, zap, rocket, trophy, medal, gem
- `nature` — leaf, tree-pine, sun, moon, cloud, sprout, mountain, wind
- `misc` — compass, map, key, puzzle, shapes, sparkles

**Migration approach (documented, not automated):**
1. Deploy schema with optional fields — no read breaks.
2. From Convex dashboard, invoke `internalMutation:backfillFolderDefaults`.
3. (No field becomes required; optionality is permanent to keep future migrations simple.)

**Approved screens driving UX (Stitch project `2926819289448574055`):**
- `0cd699e0…` — home sidebar + CTA
- `791c356c…` — modal with Color dropdown open
- `561a63ff…` — modal with Icon dropdown open (violet tint)
- `b59f85b7…` — filled, dropdowns closed side-by-side
- `e242222…` — home sidebar after create
- `8c47178a…` — edit modal with Danger Zone

## Verification

**Commands:**
- `pnpm test` — Convex + server tests, expected: all green including new `folders.test.ts` cases.
- `pnpm test:component` — component tests, expected: new `folder-form-modal.test.ts` green + updated `folder-tree.test.ts` green.
- `pnpm build` — expected: zero TS errors (strict mode).

**Manual checks:**
- Create a folder with each preset color; confirm sidebar badge color matches hex.
- Edit a folder, swap icon while keeping color — only icon changes; color tint persists.
- Reload page after backfill — legacy folders render with `slate-tide` + `folder` defaults, no layout shift.
- Try the icon dropdown with each of the 20 colors — tint should follow in real time.
