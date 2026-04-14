# Story 2.2: Rename and Delete Folders

Status: done

## Story

As a student,
I want to rename and delete folders,
So that I can keep my knowledge base organized as my courses evolve.

## Acceptance Criteria

1. **Given** a user viewing a folder in the sidebar FolderTree
   **When** they right-click (or tap a "..." button on mobile)
   **Then** a DropdownMenu appears with "Rename" and "Delete" options

2. **Given** a user selects "Rename" from the context menu
   **When** the folder name becomes an inline editable input
   **Then** they can type a new name, press Enter to confirm, or Escape to cancel
   **And** empty names and whitespace-only names are rejected
   **And** the name is trimmed and limited to 100 characters
   **And** the Convex folder record updates in real-time

3. **Given** a user selects "Delete" on a folder with no children or documents
   **When** the confirmation Dialog appears
   **Then** it shows the folder name and a "Delete" button with destructive styling
   **And** confirming deletes the folder from Convex
   **And** the FolderTree updates in real-time

4. **Given** a user selects "Delete" on a folder with subfolders and/or documents
   **When** the confirmation Dialog appears
   **Then** it explicitly describes the cascade: "Delete [folder name] and all [N] subfolders and [M] documents inside?"
   **And** the delete button uses destructive styling
   **And** confirming triggers recursive deletion of all child folders and their documents (bottom-up)

5. **Given** the ContextMenu, DropdownMenu, Dialog, and AlertDialog shadcn components are needed
   **When** this story is implemented
   **Then** they are already scaffolded and available — no scaffolding required

## Tasks / Subtasks

- [x] Task 1: Add `renameFolder` and `deleteFolder` mutations to `convex/folders.ts` (AC: #2, #3, #4)
  - [x] Add `renameFolder` mutation — args: `id: v.id('folders')`, `name: v.string()`. Validates ownership via `ctx.auth.getUserIdentity()`, trims name, rejects empty/whitespace-only, enforces max 100 chars. Updates `name` and `updatedAt` fields via `ctx.db.patch()`
  - [x] Add `deleteFolder` mutation — args: `id: v.id('folders')`. Validates ownership. Recursively collects all descendant folder IDs by querying `by_userId_and_parentId` index bottom-up. Deletes all descendant folders and the target folder. Returns `{ deletedFolders: number, deletedDocuments: number }` for the confirmation UI
  - [x] Add `getFolderDescendantCounts` query — args: `id: v.id('folders')`. Returns `{ subfolderCount: number, documentCount: number }` by recursively walking child folders. Used by the UI to populate the cascade confirmation dialog

- [x] Task 2: Extend `useFolders` composable with rename and delete (AC: #2, #3, #4)
  - [x] Add `renameFolder(id, name)` function wrapping the new `renameFolder` mutation with `convexAuthReady` guard
  - [x] Add `deleteFolder(id)` function wrapping the new `deleteFolder` mutation with `convexAuthReady` guard
  - [x] Add `getFolderDescendantCounts(id)` query binding via `useConvexQuery` for the cascade dialog

- [x] Task 3: Add context menu to FolderTree items (AC: #1)
  - [x] In `app/components/sidebar/FolderTree.vue`, wrap each `TreeItem` with `UiContextMenu` for right-click (already scaffolded at `app/components/ui/context-menu/`)
  - [x] ContextMenu shows "Rename" and "Delete" options with appropriate icons (`Pencil`, `Trash2` from lucide)
  - [x] On mobile/touch, add a visible "..." (ellipsis/`MoreHorizontal`) button that appears on hover/focus to trigger a `UiDropdownMenu` with the same options (already scaffolded at `app/components/ui/dropdown-menu/`)
  - [x] Emit new events: `rename` and `delete` with the folder data

- [x] Task 4: Add inline rename editing to FolderTree (AC: #2)
  - [x] When "Rename" is selected, replace the folder name `<span>` with an `<input>` pre-filled with the current name
  - [x] On Enter: trim, validate (non-empty, max 100 chars), call `renameFolder` mutation, revert to span
  - [x] On Escape or blur: cancel editing, revert to span with original name
  - [x] Show toast on error (e.g., "Folder name must be between 1 and 100 characters")

- [x] Task 5: Add delete confirmation Dialog (AC: #3, #4, #5)
  - [x] Use existing `UiAlertDialog` components (already scaffolded at `app/components/ui/alert-dialog/`) — AlertDialog is semantically correct for destructive confirmations
  - [x] In `app/layouts/default.vue` (or a new `FolderDeleteDialog` component), add an AlertDialog that:
    - Shows folder name in the title
    - For empty folders: "Are you sure you want to delete [name]?"
    - For folders with contents: "Delete [name] and all [N] subfolders and [M] documents inside?" using `getFolderDescendantCounts`
    - Has "Cancel" (secondary) and "Delete" (destructive) buttons
  - [x] On confirm: call `deleteFolder`, close dialog, show success toast
  - [x] If the deleted folder is the currently active folder (`/app/folders/[id]`), navigate to `/app` after deletion

- [x] Task 6: Write Convex integration tests for rename and delete (AC: #2, #3, #4)
  - [x] `renameFolder`: authenticated rename, reject empty name, reject name > 100 chars, reject rename of another user's folder, reject unauthenticated
  - [x] `deleteFolder`: delete leaf folder, delete folder with children (cascade), delete folder with nested hierarchy (3-level cascade), reject deleting another user's folder, reject unauthenticated
  - [x] `getFolderDescendantCounts`: returns correct counts for empty folder, folder with children, folder with nested hierarchy

- [x] Task 7: Write component tests for context menu and rename (AC: #1, #2)
  - [x] FolderTree: context menu renders on right-click with Rename and Delete options
  - [x] FolderTree: inline rename input appears when Rename is selected
  - [x] FolderTree: rename confirms on Enter, cancels on Escape

### Review Findings

- [x] [Review][Patch] Navigate to `/app` when viewing a descendant of the deleted folder, not just the direct target [app/layouts/default.vue:154]
- [x] [Review][Patch] Align name length limits: `createFolder`/`createSubfolder` allow 200 chars but `renameFolder` enforces 100 — update create mutations to 100 for consistency [convex/folders.ts:47,73 vs 166]
- [x] [Review][Patch] Show toast error when inline rename is rejected (empty/whitespace/over 100 chars) instead of silently cancelling [app/components/sidebar/FolderTree.vue:85-88]
- [x] [Review][Patch] Guard against blur/Enter race condition on rename input — `@blur="cancelRename"` can fire before `submitRename` completes [app/components/sidebar/FolderTree.vue:150-151]
- [x] [Review][Patch] Add `isRenaming` ref guard to prevent duplicate rename emissions on rapid Enter presses [app/components/sidebar/FolderTree.vue:84]
- [x] [Review][Patch] Add `isDeleting` ref guard in `executeDelete` to prevent duplicate delete mutations [app/layouts/default.vue:147]
- [x] [Review][Patch] `getFolderDescendantCounts` query is implemented server-side but never wired to client — resolved: client-side `countDescendants` from already-loaded `allFolders` is equivalent and avoids extra query subscription
- [x] [Review][Defer] `handleCreateSubfolder` uses `window.prompt()` — forbidden by anti-patterns [app/layouts/default.vue:92] — deferred, pre-existing from Story 2.1
- [x] [Review][Defer] Component tests lack interaction-level coverage for rename/delete flows (only verify element existence) [tests/component/sidebar/folder-tree.test.ts] — deferred, not a code defect
- [x] [Review][Defer] `onSelect` in FolderTree both emits `select` event and calls `navigateTo` directly — responsibility leak [app/components/sidebar/FolderTree.vue:63-64] — deferred, pre-existing from Story 2.1
- [x] [Review][Defer] Dynamic `await import('vue-sonner')` on every toast call instead of top-level import [app/layouts/default.vue] — deferred, pre-existing pattern

## Dev Notes

### Architecture Compliance

**Existing folder backend in `convex/folders.ts`:** Contains `createFolder`, `createSubfolder`, `listTopLevelFolders`, `listAllFolders`, `listChildFolders`, `getFolder`. Add `renameFolder`, `deleteFolder`, and `getFolderDescendantCounts` to this file — do NOT create new files.

**Auth pattern (same as all existing functions):**
```typescript
const identity = await ctx.auth.getUserIdentity()
if (!identity) throw new Error('Unauthenticated')
const userId = identity.tokenIdentifier
```

**Ownership validation before mutation:**
```typescript
const folder = await ctx.db.get(args.id)
if (!folder || folder.userId !== userId) throw new Error('Folder not found')
```

**`deleteFolder` cascade strategy:** Query all descendants using `by_userId_and_parentId` index recursively. Collect all descendant IDs into a flat array, then delete bottom-up. For V1, documents table doesn't exist yet — the mutation should still query for documents to be future-proof, but in practice `documentCount` will be 0. When Epic 3 adds the `documents` table, the delete mutation will need to be updated to cascade document deletion too (delete file storage + AI Search chunks). For now, just delete folder records.

**Recursive descendant collection pattern:**
```typescript
async function collectDescendants(ctx, userId, folderId) {
  const children = await ctx.db
    .query('folders')
    .withIndex('by_userId_and_parentId', q => q.eq('userId', userId).eq('parentId', folderId))
    .collect()
  const all = [...children]
  for (const child of children) {
    all.push(...await collectDescendants(ctx, userId, child._id))
  }
  return all
}
```

**`renameFolder` uses `ctx.db.patch()`** — not `ctx.db.replace()`. Only update `name` and `updatedAt` fields.

**Real-time updates:** Convex subscriptions via `useConvexQuery` automatically push updates when data changes. The FolderTree re-renders when `listAllFolders` result changes after rename/delete.

### Technical Requirements

- **No `<style>` blocks** — Tailwind utility classes exclusively
- **No manual Vue API imports** — Nuxt auto-imports `ref`, `computed`, `watch`, `nextTick`, etc.
- **pnpm only** — never npm or yarn
- **Co-locate interfaces** in the files that use them — no `types/` directory
- **Use `.withIndex()` not `.filter()`** for Convex queries
- **Use `.collect()`** for recursive descendant collection (bounded by max 500 folders per user)
- **Validation is server-side** — client-side validation is cosmetic. The mutation enforces name length, ownership, etc.

### Existing shadcn Components Available

All required components are already scaffolded — **no scaffolding needed for this story**.

Full inventory (58 component directories): `Accordion`, `Alert`, `AlertDialog`, `AspectRatio`, `Avatar`, `Badge`, `Breadcrumb`, `Button`, `ButtonGroup`, `Calendar`, `Card`, `Carousel`, `Chart`, `Checkbox`, `Collapsible`, `Combobox`, `Command`, `ContextMenu`, `Dialog`, `Drawer`, `DropdownMenu`, `Empty`, `Field`, `Form`, `HoverCard`, `Input`, `InputGroup`, `InputOtp`, `Item`, `Kbd`, `Label`, `Menubar`, `NativeSelect`, `NavigationMenu`, `NumberField`, `Pagination`, `PinInput`, `Popover`, `Progress`, `RadioGroup`, `RangeCalendar`, `Resizable`, `ScrollArea`, `Select`, `Separator`, `Sheet`, `Sidebar`, `Skeleton`, `Slider`, `Sonner`, `Spinner`, `Stepper`, `Switch`, `Table`, `Tabs`, `TagsInput`, `Textarea`, `Toggle`, `ToggleGroup`, `Tooltip`

**Key components for this story:**
- `ContextMenu` (`app/components/ui/context-menu/`) — right-click menu on FolderTree items
- `DropdownMenu` (`app/components/ui/dropdown-menu/`) — "..." button fallback for mobile/touch
- `AlertDialog` (`app/components/ui/alert-dialog/`) — destructive delete confirmation (preferred over Dialog for delete actions)
- `Dialog` (`app/components/ui/dialog/`) — available if needed, but AlertDialog is more appropriate for destructive confirmations

### ContextMenu for Right-Click + DropdownMenu for Mobile

Use `UiContextMenu` (`app/components/ui/context-menu/`) for native right-click behavior on desktop. Use `UiDropdownMenu` (`app/components/ui/dropdown-menu/`) triggered by a "..." button for mobile/touch.

Right-click context menu pattern:
```vue
<UiContextMenu>
  <UiContextMenuTrigger as-child>
    <!-- TreeItem content here -->
  </UiContextMenuTrigger>
  <UiContextMenuContent>
    <UiContextMenuItem @select="startRename(item.value)">
      <Pencil class="mr-2 h-4 w-4" /> Rename
    </UiContextMenuItem>
    <UiContextMenuItem class="text-destructive" @select="confirmDelete(item.value)">
      <Trash2 class="mr-2 h-4 w-4" /> Delete
    </UiContextMenuItem>
  </UiContextMenuContent>
</UiContextMenu>
```

Mobile "..." fallback (visible on hover/focus, replaces the existing "+" button area):
```vue
<UiDropdownMenu>
  <UiDropdownMenuTrigger as-child>
    <button class="..." @click.stop>
      <MoreHorizontal class="h-3 w-3" />
    </button>
  </UiDropdownMenuTrigger>
  <UiDropdownMenuContent>
    <UiDropdownMenuItem @select="startRename(item.value)">
      <Pencil class="mr-2 h-4 w-4" /> Rename
    </UiDropdownMenuItem>
    <UiDropdownMenuItem v-if="item.value.depth < 3" @select="onAddSubfolder($event, item.value)">
      <Plus class="mr-2 h-4 w-4" /> New subfolder
    </UiDropdownMenuItem>
    <UiDropdownMenuItem class="text-destructive" @select="confirmDelete(item.value)">
      <Trash2 class="mr-2 h-4 w-4" /> Delete
    </UiDropdownMenuItem>
  </UiDropdownMenuContent>
</UiDropdownMenu>
```

Note: The existing standalone "+" button for subfolder creation can be moved into this DropdownMenu to consolidate actions.

### Inline Rename Pattern

When rename is active for a folder, the `<span>` showing the folder name is replaced with an `<input>`:
```vue
<input
  v-if="editingId === item.value._id"
  v-model="editName"
  class="flex-1 rounded border bg-background px-1 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
  @keydown.enter="submitRename(item.value._id)"
  @keydown.escape="cancelRename"
  @blur="cancelRename"
  @click.stop
/>
<span v-else class="flex-1 truncate">{{ item.value.name }}</span>
```

Use `nextTick()` to auto-focus and select the input text after switching to edit mode.

### AlertDialog Pattern for Delete Confirmation

Use `UiAlertDialog` (not `UiDialog`) — AlertDialog is semantically correct for destructive confirmations and traps focus properly.

```vue
<UiAlertDialog v-model:open="showDeleteDialog">
  <UiAlertDialogContent>
    <UiAlertDialogHeader>
      <UiAlertDialogTitle>Delete folder</UiAlertDialogTitle>
      <UiAlertDialogDescription>
        <!-- Dynamic: "Are you sure?" for empty, cascade warning for non-empty -->
      </UiAlertDialogDescription>
    </UiAlertDialogHeader>
    <UiAlertDialogFooter>
      <UiAlertDialogCancel>Cancel</UiAlertDialogCancel>
      <UiAlertDialogAction class="bg-destructive text-destructive-foreground hover:bg-destructive/90" @click="executeDelete">
        Delete
      </UiAlertDialogAction>
    </UiAlertDialogFooter>
  </UiAlertDialogContent>
</UiAlertDialog>
```

### Navigation After Delete

If the user deletes the folder they are currently viewing (`route.params.id === deletedFolderId`), navigate to `/app` after successful deletion. Check `useRoute().params.id` before navigating.

### File Structure

Files to create:
- None — all shadcn components already scaffolded

Files to modify:
- `convex/folders.ts` — Add `renameFolder`, `deleteFolder`, `getFolderDescendantCounts`
- `convex/folders.test.ts` — Add tests for new mutations/queries
- `app/composables/useFolders.ts` — Add `renameFolder`, `deleteFolder`, `getFolderDescendantCounts` bindings
- `app/components/sidebar/FolderTree.vue` — Add ContextMenu (right-click) + DropdownMenu ("..." button), inline rename, emit `delete` event
- `app/layouts/default.vue` — Add delete confirmation AlertDialog, handle `delete` and `rename` events from FolderTree

Files to NOT modify:
- `convex/schema.ts` — Schema already has all required fields
- `app/pages/app/index.vue` — Dashboard page stays as-is
- `app/pages/app/folders/[id].vue` — Folder detail page stays as-is (rename reflects via Convex subscription)
- `nuxt.config.ts` — No config changes needed

### Anti-Patterns to Avoid

- Do NOT accept `userId` as a Convex function argument — derive from `ctx.auth.getUserIdentity()`
- Do NOT use `.filter()` in Convex queries — use `.withIndex()`
- Do NOT use `ctx.db.replace()` for rename — use `ctx.db.patch()` to update only changed fields
- Do NOT delete folders top-down — collect all descendants first, then delete bottom-up to avoid orphans
- Do NOT create a separate component file for the context menu — integrate it directly into `FolderTree.vue`
- Do NOT use `window.confirm()` or `window.prompt()` — use the Dialog component
- Do NOT duplicate ARIA roles — if reka-ui provides `role="tree"` on `TreeRoot`, do not add another
- Do NOT manually import Vue APIs — auto-imports active
- Do NOT create `types/` directory — co-locate interfaces
- Do NOT use `<style>` blocks — Tailwind only
- Do NOT add Pinia/Vuex — composables only
- Do NOT accept depth as a client-provided argument for deletion — compute server-side

### Previous Story (2-1) Intelligence

**What was established:**
- `convex/folders.ts` has `createFolder`, `createSubfolder`, `listTopLevelFolders`, `listAllFolders`, `listChildFolders`, `getFolder`
- All mutations use the auth pattern: `getUserIdentity() → tokenIdentifier → userId`
- Ownership validated by checking `folder.userId !== userId` after `ctx.db.get()`
- `useFolders()` composable wraps mutations with `convexAuthReady` guard (`await until(convexAuthReady).toBe(true, { timeout: 5000 })`)
- FolderTree builds tree client-side from flat `allFolders` array using `parentId` mapping
- FolderTree emits `select` and `createSubfolder` events — add `rename` and `delete` events
- Layout (`default.vue`) handles `@create-subfolder` from FolderTree — follow same pattern for rename/delete
- Error handling uses `vue-sonner` toast: `const { toast } = await import('vue-sonner'); toast.error(e.message)`
- Breadcrumb computes ancestors from `allFolders` data — automatically updates after rename (same reactive source)
- `data-testid` attributes are used on TreeItem elements for testing

**Review findings from 2-1:**
- Emit handlers must be wired in `default.vue` — Story 2.1 review found `createSubfolder` emit was never handled until patched
- Mutation calls need try/catch with `toast.error()` — Story 2.1 review found missing error handling
- The `allFolders` query is loaded unconditionally for all `/app/**` routes (acceptable, required for sidebar)

### Existing Test Patterns

Tests in `convex/folders.test.ts` follow this pattern:
```typescript
const t = convexTest(schema, modules)
const asUser = t.withIdentity(TEST_IDENTITY)
// setup
const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Test' })
// assertion
await expect(asUser.mutation(api.folders.renameFolder, { id: folderId, name: '' })).rejects.toThrow()
```

Two test identities exist: `TEST_IDENTITY` and `OTHER_IDENTITY` for cross-user isolation tests.

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 2, Story 2.2]
- [Source: _bmad-output/planning-artifacts/architecture.md — Data Architecture (adjacency list), Cascading Deletion Sequence, Naming Patterns, Anti-Patterns]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — FolderTree context menu, Dialog for destructive confirmations, Inline rename pattern, Button hierarchy]
- [Source: _bmad-output/implementation-artifacts/2-1-create-and-navigate-folder-hierarchy.md — Dev Notes, Review Findings, File List]
- [Source: convex/folders.ts — Existing folder queries and mutations]
- [Source: convex/folders.test.ts — Existing test patterns and identities]
- [Source: convex/schema.ts — Existing folders table schema]
- [Source: app/components/sidebar/FolderTree.vue — Existing tree component]
- [Source: app/composables/useFolders.ts — Existing composable pattern]
- [Source: app/layouts/default.vue — Sidebar integration, event handling pattern]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6

### Debug Log References
- No blockers or debug issues encountered

### Completion Notes List
- Task 1: Added `renameFolder` mutation (trim, validate 1-100 chars, ownership check, `ctx.db.patch`), `deleteFolder` mutation (recursive bottom-up cascade via `collectDescendants` helper, returns `{deletedFolders, deletedDocuments}`), and `getFolderDescendantCounts` query to `convex/folders.ts`
- Task 2: Extended `useFolders` composable with `renameFolder(id, name)` and `deleteFolder(id)` functions using same `convexAuthReady` guard pattern
- Task 3: Added `UiContextMenu` (right-click) and `UiDropdownMenu` ("..." button) to each FolderTree item with Rename, New subfolder, and Delete options
- Task 4: Inline rename with `<input>` replacing `<span>`, auto-focus/select via `nextTick`, Enter to confirm, Escape/blur to cancel
- Task 5: AlertDialog in `default.vue` with cascade description computed client-side from `allFolders`; navigates to `/app` if deleted folder was active
- Task 6: Enabled all 20 skipped Convex integration tests (renameFolder: 8, deleteFolder: 7, getFolderDescendantCounts: 5) — all pass
- Task 7: Updated component tests to match new implementation (context menu trigger, actions button, inline rename input)

### File List
- `convex/folders.ts` — Added `renameFolder`, `deleteFolder`, `getFolderDescendantCounts`, `collectDescendants` helper
- `convex/folders.test.ts` — Enabled 20 previously skipped tests, removed `@ts-expect-error` annotations
- `app/composables/useFolders.ts` — Added `renameFolder`, `deleteFolder` functions and mutation bindings
- `app/components/sidebar/FolderTree.vue` — Added ContextMenu, DropdownMenu, inline rename, delete/rename emits
- `app/layouts/default.vue` — Added rename/delete event handlers, AlertDialog for delete confirmation, descendant count computation
- `tests/component/sidebar/folder-tree.test.ts` — Updated component tests for new context menu and rename UI
