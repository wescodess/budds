# Folder Activity & Task Tracking Plan

## Summary
Add a unified task-tracking system at the folder level that surfaces all long-running operations — flashcard generation, quiz generation, document indexing — in a single persistent UI strip. Users can monitor multiple concurrent jobs, see real-time progress, and take action (cancel, retry, dismiss) without leaving their current void.

Today each operation handles progress in isolation: document indexing shows a status dot in the files list, flashcard generation locks the modal, quiz generation shows a shimmer. There is no cross-cutting view and no way to fire-and-forget a generation while continuing to work.

## Key Changes

### Data model
- Add a `tasks` table in Convex.
  Fields: `userId`, `folderId`, `type` (union: `flashcard-generation` | `quiz-generation` | `document-indexing`), `status` (union: `pending` | `running` | `completed` | `failed` | `cancelled`), `title`, `progress` (optional 0–100), `metadata` (type-specific payload — roomId, quizId, documentId, prompt, cardCount, etc.), `result` (optional — what was produced: roomId + versionId for flashcards, quizId for quiz), `error` (optional failure message), `createdAt`, `updatedAt`, `completedAt`.
- Index: `by_userId_and_folderId` for the folder-scoped subscription, `by_status` for cleanup cron.

### Convex API surface
- `tasks.listByFolder({ folderId })` — live query, returns active + recent (last 30 min completed/failed) tasks for the folder, newest first. Bounded to 50.
- `tasks.create({ folderId, type, title, metadata })` — inserts a pending task, returns `{ taskId }`.
- `tasks.updateProgress({ taskId, progress, status? })` — called by the generation worker to push progress.
- `tasks.complete({ taskId, result })` — marks completed + sets result reference.
- `tasks.fail({ taskId, error })` — marks failed with error message.
- `tasks.cancel({ taskId })` — marks cancelled; the generation worker checks for cancellation between steps.
- `tasks.dismiss({ taskId })` — removes completed/failed tasks from the visible list (soft delete or hard delete).
- `tasks.retry({ taskId })` — re-enqueues a failed task as pending with same metadata.

### Generation flow changes
Current flow (flashcards): dialog open → call `/api/flashcards/generate` → wait → call `generateRoomCards` mutation → close dialog on success.

New flow:
1. User clicks "Generate deck" in the dialog.
2. Client calls `tasks.create({ folderId, type: 'flashcard-generation', title: 'Generating 12 cards…', metadata: { roomId, prompt, cardCount } })`.
3. Dialog closes immediately. Activity strip shows the new task with a spinner.
4. Client (or a Convex action scheduled by the create mutation) calls the generation endpoint.
5. Generation endpoint calls back `tasks.updateProgress` as work progresses (e.g., "Fetching documents…", "Generating cards…", "Archiving previous deck…").
6. On success: `tasks.complete({ taskId, result: { roomId, versionId, cardCount } })`. Activity strip shows a success state with a "View" link. Convex subscription on the room auto-updates the card list.
7. On failure: `tasks.fail({ taskId, error })`. Activity strip shows error with "Retry" action.

Same pattern for quiz generation and document indexing (document indexing already has status on the document row — this unifies it under the activity strip while preserving the per-file dot for inline context).

### UI

#### Activity strip
- Location: inside `FolderShell`, between the tab bar and the tab content. Visible across all tabs (chat, flashcards, quiz, documents).
- Collapsed by default when no active tasks. Auto-expands when a task is created.
- Each task row: type icon (Sparkles for flashcards, ListChecks for quiz, FileUp for indexing) + title + progress bar or spinner + status label + action buttons (Cancel while running, Retry/Dismiss on failure, Dismiss/View on completion).
- Max visible rows: 3. If more, "+N more" link expands to show all.
- Completed tasks auto-dismiss after 30 seconds unless the user interacts.
- Design: warm-focus palette. Active tasks get a subtle amber left border. The strip uses `bg-card/40` with `border-b border-border/60` to separate from tab content without competing visually.

#### Flashcard generation changes
- `RoomGenerateDialog` closes immediately on submit. No more "Generating…" button lock — the dialog's job is to collect params, not to wait.
- `RoomShell` shows a small inline banner below the mode switch if a generation task is running for this room: "Generating 12 cards… [Cancel]". This is a secondary indicator for users already in the room — the activity strip is the primary.
- On completion, if the user is still viewing the room, the Convex subscription delivers new cards automatically. A toast confirms "12 cards generated".

#### Document indexing changes
- When a document is uploaded and enters "processing" status, a task row is also created in the activity strip. The existing status dot on the file row is preserved for inline context, but the strip provides the cross-cutting view.
- Alternatively, don't duplicate — only show document indexing in the strip if the user navigated away from the Documents tab. Use a `metadata.showInStrip` flag or infer from tab context.

#### Quiz generation changes
- Same fire-and-forget pattern as flashcards. Dialog closes, strip tracks, quiz appears when done.

### Cancellation
- `tasks.cancel` sets `status: 'cancelled'`. The generation action checks `tasks.get(taskId).status` between major steps (before calling AI, before archiving, before inserting cards). If cancelled, it rolls back partial work and returns early.
- UI shows "Cancelling…" briefly, then the task row dismisses.
- For document indexing, cancellation is not supported (Cloudflare pipeline is fire-and-forget). The cancel button is hidden for `document-indexing` type tasks.

### Cleanup
- A scheduled Convex cron runs every hour: deletes tasks with `status in ['completed', 'cancelled', 'failed']` older than 24 hours. Keeps the table bounded.
- Alternatively, use `completedAt + 24h < now` as the filter.

## Test Plan
- Convex tests:
  - task CRUD (create, update, complete, fail, cancel, dismiss, retry),
  - listByFolder returns only the caller's tasks for the specified folder,
  - retry re-creates with same metadata,
  - cancel sets status,
  - cleanup cron deletes old completed tasks.
- Integration tests:
  - flashcard generation creates a task, updates progress, completes with result,
  - failed generation creates a failed task with error message,
  - cancellation mid-generation rolls back partial cards.
- Component tests:
  - activity strip renders task rows with correct icons and status,
  - auto-expand on task creation, auto-dismiss on completion after timeout,
  - Cancel/Retry/Dismiss button interactions,
  - strip hidden when no tasks.
- Manual smoke:
  - generate flashcards → dialog closes → strip shows progress → cards appear → strip auto-dismisses,
  - trigger two generations concurrently (flashcard + quiz) → both visible in strip,
  - cancel a running generation → strip shows cancelled then dismisses,
  - fail a generation (e.g., by having no indexed documents) → strip shows error + retry.

## Assumptions and Defaults
- Phase 1 covers flashcard generation only. Quiz and document indexing integration is Phase 2.
- The activity strip is folder-scoped — no global "all folders" task view in Phase 1.
- Progress granularity is coarse (3–4 steps: "Preparing", "Generating", "Archiving", "Complete") rather than percentage-based. Fine-grained progress requires streaming from the AI endpoint, which is deferred.
- Task rows are ephemeral — they are not a permanent audit log. The room's version history serves as the durable record of what was generated.
- The `tasks` table is lightweight — no large payloads in metadata. The actual generated card data flows through the existing `generateRoomCards` mutation, not through the task row.
- Cancellation is best-effort. If the AI call already completed, cancellation only prevents the archival/insertion step.
