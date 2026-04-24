---
title: 'Folder Activity & Task Tracking — Phase 1'
type: 'feature'
created: '2026-04-16'
status: 'in-progress'
baseline_commit: 'cf16e5f'
branch: 'feat/folder-activity-task-tracking-phase-1'
context:
  - DESIGN.md
  - TASKSPLAN.md
---

<frozen-after-approval>

## Intent

**Problem:** Long-running operations (flashcard generation, quiz generation, document indexing) block the UI or are invisible once the user navigates away. There's no cross-cutting view of what's happening in a folder, no way to fire-and-forget a generation, and no cancel/retry surface.

**Approach:** Add a `tasks` table to Convex as the coordination layer. Flashcard generation becomes fire-and-forget: dialog closes immediately, a task row tracks progress, the existing helper sidebar gains a "Tasks" mode alongside "Sources" so users can monitor/cancel/retry from any tab. Three header icons (edit folder, add subfolder, toggle tasks) provide persistent access. Phase 1 covers flashcard generation only; quiz + document-indexing integration deferred.

## Boundaries & Constraints

**Always:**
- Auth on every task endpoint via `ctx.auth.getUserIdentity()`. Tasks are folder-scoped and user-owned.
- Bounded queries with explicit indexes. `listByFolder` returns active + recent (last 30 min completed/failed), capped at 50.
- The helper sidebar is the SINGLE right-side panel for both sources and tasks. A `helperMode` ref at the page level (`'sources' | 'tasks' | null`) controls which content renders. Opening tasks closes sources and vice versa.
- Fire-and-forget: `RoomGenerateDialog` closes immediately after creating a task. The generation runs via a Convex action scheduled by the task-create mutation.
- Cancellation is best-effort: the generation action checks `task.status === 'cancelled'` between steps and rolls back if so.
- Completed tasks auto-dismiss from the UI after 30 seconds unless interacted with. The task row persists in DB for the cleanup cron.
- Header icons (edit, add subfolder, toggle tasks) render in the folder header bar, right-aligned. Tasks icon shows amber badge with count when active tasks exist.

**Ask First:**
- Any schema change beyond the new `tasks` table.
- Integrating quiz generation or document indexing into the task system (Phase 2).
- Changing the ResizablePanelGroup layout for the chat tab's source panel.

**Never:**
- Global (cross-folder) task view in Phase 1.
- Percentage-based progress (use coarse step labels: "Preparing", "Generating", "Archiving", "Complete").
- Task rows as permanent audit log — room version history is the durable record.
- Running generation synchronously in the dialog.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Create task | `tasks.create({folderId, type:'flashcard-generation', title, metadata:{roomId, prompt, cardCount}})` | Inserts task row status=`pending`, schedules generation action, returns `{taskId}` | `Unauthenticated` \| `Folder not found` |
| Update progress | `tasks.updateProgress({taskId, progress:'Generating cards…'})` (internal) | Patches task progress label + `updatedAt` | Task not found → no-op |
| Complete task | `tasks.complete({taskId, result:{roomId, versionId, cardCount}})` (internal) | Sets status=`completed`, `completedAt`, result ref | Task not found → no-op |
| Fail task | `tasks.fail({taskId, error})` (internal) | Sets status=`failed`, error message | Task not found → no-op |
| Cancel task | `tasks.cancel({taskId})` user-facing | Sets status=`cancelled`. Generation action checks between steps and rolls back. | `Unauthenticated` \| `Task not found` |
| Dismiss task | `tasks.dismiss({taskId})` user-facing | Deletes the task row (hard delete) | `Unauthenticated` \| `Task not found` |
| Retry task | `tasks.retry({taskId})` user-facing | Re-creates a new pending task with same metadata, dismisses the failed one | `Unauthenticated` \| `Task not found` \| only works on failed tasks |
| List by folder | `tasks.listByFolder({folderId})` | Returns active + recent tasks (completed/failed < 30 min), newest first, max 50 | Non-owner folder → `[]` |
| Fire-and-forget generate | User clicks Generate in dialog | Dialog calls `tasks.create` → closes immediately. Task appears in helper sidebar with spinner. Generation runs async. On success, Convex subscription delivers new cards to the room. | If generation fails → task.fail sets error; user sees "Failed" in tasks panel with Retry. |
| Cancel mid-generation | User clicks Cancel on a running task | `tasks.cancel` sets status. Generation action reads task before each step — if cancelled, skips remaining work, does NOT archive/insert cards. | If cancel arrives after cards already inserted → no rollback of completed work (best-effort). |
| Helper mode switch | User clicks tasks icon while sources panel is open | `helperMode` flips from `'sources'` to `'tasks'`. Sources panel unmounts, tasks panel mounts in the same slot. | — |
| No tasks | Tasks panel open, no active or recent tasks | Empty state: muted icon + "No active tasks" + helper text | — |
| Cleanup cron | Hourly | Deletes tasks with terminal status older than 24h | — |

</frozen-after-approval>

## Code Map

- `convex/schema.ts` -- ADD `tasks` table with fields: userId, folderId, type, status, title, progress, metadata, result, error, createdAt, updatedAt, completedAt; indexes: by_userId_and_folderId, by_status
- `convex/tasks.ts` -- NEW: create, updateProgress, complete, fail, cancel, dismiss, retry, listByFolder
- `convex/tasks.test.ts` -- NEW: convex-test suite for all I/O rows
- `convex/crons.ts` -- NEW or AMEND: hourly cleanup of terminal tasks > 24h
- `convex/flashcardRooms.ts` -- AMEND: `generateRoomCards` becomes an internal mutation called by the generation action; new `runFlashcardGeneration` action orchestrates: create task → fetch AI → call generateRoomCards → complete/fail task
- `app/composables/useTasks.ts` -- NEW: `useConvexQuery(api.tasks.listByFolder)` + cancel/dismiss/retry mutation wrappers
- `app/components/folders/FolderTasksPane.vue` -- NEW: tasks list panel (running/completed/failed cards with progress, cancel, retry, dismiss, view). Same `aside` pattern as FolderHelperPane.
- `app/components/folders/FolderHelperPane.vue` -- AMEND or KEEP: sources pane stays as-is; the page-level mode switch selects which pane renders
- `app/pages/app/folders/[id].vue` -- AMEND: (1) add `helperMode` ref replacing `sourcePanelOpen`, (2) add 3 header icons (edit, add subfolder, toggle tasks) with badge, (3) lift ResizablePanelGroup to wrap UiTabs so helper pane works across all tabs, (4) wire flashcard generation to fire-and-forget via tasks.create
- `app/components/flashcards/RoomGenerateDialog.vue` -- AMEND: on submit, call tasks.create + close immediately instead of awaiting generate()
- `app/components/flashcards/RoomShell.vue` -- AMEND: small inline banner "Generating…" when a running task targets this roomId (secondary indicator)
- `app/composables/useFlashcardRooms.ts` -- AMEND: remove the synchronous generate() flow; generation now goes through tasks
- `tests/component/folders/folder-tasks-pane.test.ts` -- NEW: tasks list rendering, cancel/retry/dismiss interactions, empty state
- `tests/component/folders/folder-header-icons.test.ts` -- NEW: 3 icons render, badge shows count, toggle opens tasks pane

## Tasks & Acceptance

**Execution:**
- [ ] `convex/schema.ts` -- add `tasks` table with indexes
- [ ] `convex/tasks.ts` -- implement 8 endpoints (create, updateProgress, complete, fail, cancel, dismiss, retry, listByFolder)
- [ ] `convex/tasks.test.ts` -- convex-test suite covering every I/O row
- [ ] `convex/crons.ts` -- hourly cleanup cron for terminal tasks > 24h
- [ ] `convex/flashcardRooms.ts` -- refactor generation into a scheduled action (`runFlashcardGeneration`) that creates task → generates → completes/fails task
- [ ] `app/composables/useTasks.ts` -- folder-scoped tasks subscription + mutation wrappers
- [ ] `app/components/folders/FolderTasksPane.vue` -- tasks panel with running/completed/failed cards
- [ ] `app/pages/app/folders/[id].vue` -- add helperMode ref, 3 header icons, lift ResizablePanelGroup, wire fire-and-forget generation
- [ ] `app/components/flashcards/RoomGenerateDialog.vue` -- close immediately on submit, create task instead of awaiting
- [ ] `app/components/flashcards/RoomShell.vue` -- inline "Generating…" banner when task targets this room
- [ ] `app/composables/useFlashcardRooms.ts` -- remove synchronous generate flow
- [ ] component tests for FolderTasksPane + header icons
- [ ] run `pnpm test` + `pnpm test:component` -- zero new failures

**Acceptance Criteria:**
- Given a user clicking "Generate deck" in the flashcard room, when submitted, then the dialog closes immediately and a task row appears in the tasks panel with a spinner and "Generating…" label.
- Given a running generation task, when the user clicks Cancel, then the task status becomes cancelled and no new cards are inserted into the room.
- Given a failed generation task, when the user clicks Retry, then a new task is created with the same parameters and the failed task is dismissed.
- Given the folder header, when tasks are active, then the tasks icon shows an amber badge with the count.
- Given the tasks panel open, when a generation completes, then the task row transitions to completed state with a "View" link and auto-dismisses after 30 seconds.
- Given the helper sidebar showing sources, when the user clicks the tasks header icon, then the sidebar switches to show tasks (and vice versa).
- Given `pnpm test` and `pnpm test:component`, when run, then zero new failures.

## Spec Change Log

## Design Notes

- `helperMode` replaces `sourcePanelOpen`. Value `'sources'` = existing behavior. Value `'tasks'` = tasks pane. Value `null` = helper closed. Citation clicks set `helperMode = 'sources'`. Tasks icon toggles `helperMode` between `'tasks'` and `null`.
- The `ResizablePanelGroup` that currently wraps only the chat tab content needs to lift to wrap the entire `UiTabs` so the helper pane persists across tab switches. The main panel is `UiTabs`; the helper panel renders `FolderHelperPane` or `FolderTasksPane` based on mode.
- Generation action flow: `tasks.create` mutation inserts the task + calls `ctx.scheduler.runAfter(0, internal.flashcardRooms.runFlashcardGeneration, {taskId, roomId, folderId, prompt, cardCount})`. The action fetches AI, calls `generateRoomCards` internal mutation, then `tasks.complete`. On error: `tasks.fail`.
- Auto-dismiss: `FolderTasksPane` tracks `completedAt` per task; a `setTimeout` removes it from the visible list 30s after completion. The task row stays in DB until the cleanup cron.

## Verification

**Commands:**
- `pnpm test` -- expected: all Convex tests pass
- `pnpm test:component` -- expected: all component tests pass
- `pnpm convex dev --once` -- expected: schema + functions deploy cleanly
