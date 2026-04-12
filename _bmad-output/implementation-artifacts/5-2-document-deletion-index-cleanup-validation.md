# Story 5.2: Document Deletion Index Cleanup Validation

Status: review

## Story

As a student,
I want to be confident that deleting a document fully removes it from search,
So that deleted materials never appear in my AI chat responses.

## Acceptance Criteria

1. **Given** a user has an indexed document (`status: 'success'`) in a folder
   **When** they invoke `documents.deleteDocument` (the Story 3.3 deletion flow — delete button in the folder file list)
   **Then** the Convex `documents` row is removed synchronously inside the mutation
   **And** the document's Convex file-storage blob is removed (`ctx.storage.delete(doc.fileId)`)
   **And** the owning folder's `documentCount` is decremented (floored at 0) and `updatedAt` refreshed
   **And** a `pendingCleanup` row is enqueued with `kind: 'ai-search'`, `documentId = String(doc._id)`, `userId = doc.userId`, `attempts: 0` (the exact row shape introduced in Story 5.1 — reused, not a parallel table)
   **And** if `doc.r2Key` was set a second `pendingCleanup` row is enqueued with `kind: 'r2'`, the same `documentId`, and `r2Key: doc.r2Key`
   **And** `ctx.scheduler.runAfter(0, internal.accountDeletion.drainPendingCleanup, { userId })` is invoked so the retry worker begins immediately

2. **Given** the AI Search chunk removal attempt during that drain returns a transient failure (5xx or network)
   **When** `drainPendingCleanup` processes the row
   **Then** `attempts` is incremented (`recordRetry`) and the drain reschedules itself with the shared `backoffMs(attempts)` helper (base 30s, cap 1h, MAX_ATTEMPTS 10) — the same helper/path Story 5.1 already ships
   **And** the per-document row persists until the external call succeeds (or returns 404) or `attempts === MAX_ATTEMPTS`
   **And** the document record's *absence* from Convex is unaffected — the user's view of deletion is immediate and irreversible

3. **Given** the AI Search chunk removal attempt returns HTTP `404` (chunk already gone from the provider)
   **When** `drainPendingCleanup` processes the row
   **Then** the result is treated as success (`ok: true`) and the `pendingCleanup` row is removed via `removePendingCleanup`
   **And** no further reschedule occurs for that row

4. **Given** a user deletes an entire folder that contains one or more documents (Story 2.2's `folders.deleteFolder`)
   **When** the cascade runs
   **Then** every `documents` row with `folderId === id` is enumerated and, for each, the same cleanup sequence as AC 1 executes (enqueue `pendingCleanup` rows for `ai-search` and `r2` as applicable; delete Convex storage blob; delete the `documents` row) before the folder row itself is deleted
   **And** the return shape changes from `{ deletedFolders, deletedDocuments: 0 }` to `{ deletedFolders, deletedDocuments }` with the real count
   **And** descendant sub-folders are also enumerated and their documents receive the same treatment (bottom-up order preserved from the existing implementation)
   **And** a single `drainPendingCleanup` is scheduled per cascade (not once per document) — pass the folder owner's `userId` once
   **And** cross-user isolation is preserved: descendants and their documents are filtered on `userId === identity.tokenIdentifier`

5. **Given** any document deletion or folder cascade runs with `CF_ACCOUNT_ID` / `CLOUDFLARE_AI_SEARCH_INSTANCE` / `CLOUDFLARE_AI_SEARCH_TOKEN` unset
   **When** the drain worker picks up the enqueued `ai-search` rows
   **Then** `performCleanupAttempt` returns `{ ok: true }` (no-op) — matching the existing behavior for account-deletion — and the row is dequeued without error (prevents a queue of unprocessable rows in dev/offline environments)
   **And** no Cloudflare HTTP call is made

6. **Given** a document is in `status: 'processing'` (ingestion not yet complete, no `r2Key`, no AI Search chunks)
   **When** the user deletes it
   **Then** no `pendingCleanup` rows are enqueued (there is nothing to clean externally)
   **And** the `documents` row and file-storage blob are still removed synchronously
   **And** no `drainPendingCleanup` is scheduled (the enqueue check guards the scheduler call, to avoid spurious worker runs for the common processing-delete case)

7. **Given** cross-user isolation must hold
   **When** `documents.deleteDocument` or `folders.deleteFolder` runs
   **Then** every affected row is re-validated against `identity.tokenIdentifier` (the existing pattern in both handlers) — no handler accepts `userId` as an argument; no `pendingCleanup` row is enqueued with a different user's `userId`

## Tasks / Subtasks

- [x] **Task 1: Extract a shared "enqueue document cleanup" helper** (AC: #1, #4, #5, #6, #7)
  - [x] In `convex/accountDeletion.ts`, export a new internal helper `enqueueDocumentCleanup(ctx, { userId, documentId, status, r2Key })` typed as `async (ctx: MutationCtx, args: { userId: string; documentId: string; status: Doc<'documents'>['status']; r2Key?: string }) => { r2Enqueued: boolean; aiSearchEnqueued: boolean }`.
  - [x] The helper inserts a `kind: 'r2'` row iff `r2Key` is set, and a `kind: 'ai-search'` row iff `status === 'success' || status === 'indexing'`. It returns whether each side enqueued so callers can decide whether to schedule the drain.
  - [x] Refactor `deleteAccountCascade` (the 5.1 code path) to call this helper inside its `for (const doc of documents)` loop — the enqueue logic is currently inlined and will otherwise drift. The bulk `__user_bulk__` sentinel row stays inline in `deleteAccountCascade` because only account deletion uses it.
  - [x] Decision note: the helper lives in `accountDeletion.ts` so both `documents.ts` and `folders.ts` can import it via `internal`-free direct import (both are non-node mutation files, same module system). Keeping the cleanup schema knowledge in one file prevents the "parallel retry mechanism" failure mode called out in the story prompt.

- [x] **Task 2: Patch `documents.deleteDocument` to use the durable queue** (AC: #1, #5, #6, #7)
  - [x] Edit `convex/documents.ts`:
    1. Keep the existing authentication + ownership check.
    2. Replace the inline `if (doc.status === 'success' || doc.status === 'indexing') { ctx.scheduler.runAfter(0, internal.documentActions.deleteDocumentFromR2, ...) }` block with a call to `enqueueDocumentCleanup(ctx, { userId, documentId: String(doc._id), status: doc.status, r2Key: doc.r2Key })`.
    3. If the helper returns `r2Enqueued || aiSearchEnqueued`, schedule `internal.accountDeletion.drainPendingCleanup` with `runAfter(0)` and `{ userId }`.
    4. Preserve the existing `documentCount` decrement on the folder and `ctx.storage.delete(doc.fileId)` + `ctx.db.delete(args.id)` sequence.
    5. Remove the no-longer-reachable `internal.documentActions.deleteDocumentFromR2` scheduler call — the action itself remains in `documentActions.ts` (it is still referenced by nothing after this patch, so also mark it as removable in a follow-up deferred item; do **not** delete it in this story to avoid widening the blast radius mid-cascade-refactor).

- [x] **Task 3: Fix the `folders.deleteFolder` cascade to actually delete documents** (AC: #4, #7)
  - [x] Edit `convex/folders.ts`:
    1. Inside `deleteFolder`'s handler, after `const descendants = await collectDescendants(...)`, build the full list of folder ids in delete order: `const folderIds = [...descendants.map(d => d._id), args.id]`. (Children first so FK-like ordering is preserved; the existing descendant walk yields children-before-parents via DFS append.)
    2. Before deleting any folder rows, query each folder's documents via `by_folderId` index (requires no schema change — `by_folderId` already exists on `documents`). For each `doc`:
       - Call `enqueueDocumentCleanup(ctx, { userId, documentId: String(doc._id), status: doc.status, r2Key: doc.r2Key })`.
       - `await ctx.storage.delete(doc.fileId)` (wrapped in try/catch — best-effort, same pattern as 5.1).
       - `await ctx.db.delete(doc._id)`.
       - Increment a local `deletedDocuments` counter.
    3. After all document cleanup: iterate `folderIds` bottom-up (the existing `for (let i = descendants.length - 1; i >= 0; i--)` loop + the root delete) and `ctx.db.delete` each folder id.
    4. If `deletedDocuments > 0`, schedule `internal.accountDeletion.drainPendingCleanup` once with `{ userId }`.
    5. Return `{ deletedFolders: descendants.length + 1, deletedDocuments }`.
  - [x] Ownership guard: because `collectDescendants` already scopes by `userId` (it queries `by_userId_and_parentId`), descendants are guaranteed this-user. Per-document query via `by_folderId` returns only this user's docs because folder ownership was already validated — double-verify by checking `doc.userId === userId` in the loop (defensive).

- [x] **Task 4: Convex integration tests — `documents.deleteDocument`** (AC: #1, #2, #3, #5, #6, #7)
  - [x] New describe block in `convex/documents.test.ts` (or a new `convex/documents.deletion.test.ts` if the file grows past a reasonable size — choose whichever keeps diffs minimal):
    - `[P0] deleteDocument enqueues pendingCleanup ai-search row for status:'success' document` — seed via `asUser.mutation(api.documents.createDocument, ...)`, patch the row to `status: 'success'` + `r2Key` via `t.run`, call `deleteDocument`, assert exactly one `ai-search` row and one `r2` row exist in `pendingCleanup` with matching `documentId` and `userId`.
    - `[P0] deleteDocument enqueues no pendingCleanup rows for status:'processing' document` — default path after `createDocument`; assert `pendingCleanup` count is 0, documents row is gone, file blob is gone.
    - `[P0] deleteDocument removes documents row + storage blob synchronously` — before/after `ctx.db.system.get(fileId)` and `ctx.db.get(docId)` assertions.
    - `[P0] deleteDocument rejects unauthenticated caller` — parallel to the 5.1 pattern.
    - `[P0] deleteDocument rejects cross-user delete` — user A's doc; user B's mutation call; expect throw.
    - `[P1] deleteDocument decrements folder documentCount` — seed doc, assert pre-count, delete, assert post-count.
    - `[P1] deleteDocument writes userId into the pendingCleanup row matching the caller identity` — isolation invariant at the queue row level.
  - [x] No `fetch` stubs required for these tests — they only check the Convex-side enqueue contract, not the drain attempt. Drain idempotence is covered by the existing 5.1 tests (which already pass `fetch → 404` and assert `pendingCleanup` rows are removed); a redundant check here adds no coverage.

- [x] **Task 5: Convex integration tests — `folders.deleteFolder` cascade** (AC: #4, #7)
  - [x] New describe block in `convex/folders.test.ts`:
    - `[P0] deleteFolder cascades: deletes all documents in folder + enqueues their cleanup` — seed a folder with two docs (one `success` + `r2Key`, one `processing`); call `deleteFolder`; assert documents rows gone; assert `pendingCleanup` has exactly one `ai-search` row and one `r2` row (both from the success doc); assert return shape `{ deletedFolders: 1, deletedDocuments: 2 }`.
    - `[P0] deleteFolder cascades to descendant folders' documents` — seed root folder with a child subfolder; put a `success` doc in each; call `deleteFolder` on the root; assert all four (2 folders + 2 docs) are gone; assert 2 `ai-search` rows + 2 `r2` rows in `pendingCleanup`; assert return shape `{ deletedFolders: 2, deletedDocuments: 2 }`.
    - `[P0] deleteFolder does not touch other users' documents` — seed user A and user B each with a folder+doc; call `deleteFolder` as user A on user A's folder; assert user B's doc, folder, and `pendingCleanup` are untouched.
    - `[P1] deleteFolder on empty folder schedules no drainer` — spy via `pendingCleanup` emptiness; acceptable proxy: assert `pendingCleanup` remains empty.

- [x] **Task 6: Regression — ensure existing Story 5.1 tests still pass after the `enqueueDocumentCleanup` refactor** (AC: all)
  - [x] Run `pnpm test -- convex/accountDeletion.test.ts`; all 10 tests must remain green. The shared helper must produce byte-identical `pendingCleanup` row shapes to what 5.1 was inserting inline.

- [x] **Task 7: Dev Notes — close the Story 3.3 deferred item** (AC: #1, #2, #3)
  - [x] Add a note to `_bmad-output/implementation-artifacts/deferred-work.md`: under the 3.3 deferred list, prefix the "**`deleteDocument` does not remove document from Cloudflare AI Search index**" bullet with `**~~...~~**` (markdown strikethrough) and append `— Resolved in Story 5.2 (2026-04-12) via durable `pendingCleanup` queue.`. Do not remove the entry; the strike-through preserves audit history (matches the "Resolved during Epic N retrospective prep" convention at the top of `deferred-work.md`).

- [x] **Task 8: Status transition + commit hygiene** (AC: all)
  - [x] Sprint status: `ready-for-dev` → `in-progress` on dev start; → `review` on completion of checks + code review PASS; → `done` on merge.
  - [x] No Claude attribution in commit messages.

## Dev Notes

### Requirements context

- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.2 (lines 714-736)]
- [Source: _bmad-output/planning-artifacts/prd.md#FR39, FR44, NFR13 (lines 423, 431, 453)]
- [Source: _bmad-output/planning-artifacts/architecture.md — Cascading Deletion + userId metadata isolation primitive (line 104)]

### Technical references

- [Source: convex/accountDeletion.ts — `pendingCleanup` row shape, `drainPendingCleanup`, `backoffMs`, `MAX_ATTEMPTS=10` — all reused]
- [Source: convex/documentActions.ts — `performCleanupAttempt(kind, userId, documentId, r2Key)` — already idempotent; already treats missing CF creds as `{ ok: true }` (AC #5 is satisfied by existing code; this story only asserts the guarantee and adds coverage)]
- [Source: convex/documents.ts — existing `deleteDocument` + `internal.documentActions.deleteDocumentFromR2` pattern being replaced]
- [Source: convex/folders.ts — existing `deleteFolder` cascade missing document delete (bug inherited from Epic 2 when documents didn't exist yet)]
- [Source: convex/schema.ts — `pendingCleanup` + `documents.by_folderId` indexes used by this story. No schema changes.]

### Previous Story Intelligence

From Story 5.1 (2026-04-12):
- `pendingCleanup` table introduced with `by_userId` and `by_kind_and_attempts` indexes.
- `drainPendingCleanup` internal action + exponential backoff worker is already wired and covered by 10 integration tests. This story extends its producers, not its consumers.
- `performCleanupAttempt` idempotent: 404/NoSuchKey → `{ ok: true }`; missing CF config → `{ ok: true }`; transient 5xx/network → `{ ok: false; error }` with retry.
- `enqueueDocumentCleanup` is being factored out of the inline loop in `deleteAccountCascade` — Task 1's acceptance test is that the existing 5.1 test suite still passes with zero behavioral diff.

From Story 3.3 (2026-04-11):
- `deleteDocument` deletes the Convex row + file blob + schedules `deleteDocumentFromR2` (R2 only). AI Search chunk removal was never implemented — captured as a deferred item in `deferred-work.md` under the "Deferred from: code review of story-3.2" heading ("deleteDocument does not remove document from Cloudflare AI Search index"). This story closes that gap.
- `deleteDocumentFromR2` in `convex/documentActions.ts` remains as a legacy primitive; after this story no callers reference it. Removal is out of scope (see Task 2 rationale).

From Story 2.2 (Epic 2 folders):
- `deleteFolder` currently returns `deletedDocuments: 0` — at the time of Epic 2 no `documents` table existed. After Epic 3 landed, the cascade became stale. This story fixes that latent bug.

### Project Structure Notes

- `convex/accountDeletion.ts` — add one exported helper `enqueueDocumentCleanup`; refactor inline enqueue in `deleteAccountCascade` to call it. Do not change the helper's side-effect shape — the 5.1 tests assert specific row counts.
- `convex/documents.ts` — swap one inline scheduler call for `enqueueDocumentCleanup` + conditional drain scheduling.
- `convex/folders.ts` — expand `deleteFolder` to iterate each folder's documents. No new index needed; `documents.by_folderId` exists.
- `convex/schema.ts` — **no change**. Story is behavior-only on existing tables.
- `convex/documentActions.ts` — **no change**. `performCleanupAttempt` already handles the per-document case correctly (it differentiates `__user_bulk__` from real doc ids).
- No UI changes. Story 3.3's delete UI in `app/pages/app/folders/[id].vue` already calls `api.documents.deleteDocument`; the behavior change is purely server-side.

### Decisions (pre-dev)

- **Why extract a helper instead of inlining the enqueue in two more places:** three callers (`deleteAccountCascade`, `documents.deleteDocument`, `folders.deleteFolder`) now need identical enqueue logic. Inlining risks divergence, which is exactly the "parallel retry mechanism" failure mode the story prompt called out.
- **Why keep `deleteDocumentFromR2` in the codebase even though nothing calls it after this story:** deleting it widens the diff and the symbol is `internal`-only. A follow-up cleanup (single-line file removal) is safer as a separate commit. Captured in a deferred item.
- **Why not use the `__user_bulk__` sentinel for folder cascades:** bulk sentinel targets all of a user's AI Search chunks matching `attributes.userId`. A folder cascade must not remove chunks from other folders the user still owns. Per-document enqueue is the correct primitive.
- **Why conditionally schedule the drain:** most per-doc deletes will be for `processing` documents (user corrects a mistake before ingestion completes) — scheduling a drain for zero rows is wasted scheduler traffic.

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (claude-opus-4-6) — bmad-story-runner

### Debug Log References

- `npx convex codegen` — clean; no schema changes required.
- `pnpm test -- convex/accountDeletion.test.ts` — 10/10 pass (5.1 regression check after `enqueueDocumentCleanup` extraction).
- `pnpm test -- convex/documents.test.ts convex/folders.test.ts convex/accountDeletion.test.ts` — 96/96 pass.
- `pnpm test` — 170/178 pass; 8 pre-existing failures in `convex/documentActions.test.ts` (carried from Epic 3, documented in 4.4 and 5.1 debug logs — verified parity).
- `pnpm test:component` — 64 pass + 78 skipped + 6 pre-existing failures in `tests/component/chat/chat-input.test.ts` (matches 5.1 debug log exactly; no UI changes in this story).
- No `typecheck` script present in `package.json`; Convex codegen's embedded tsc covers the server side (clean).

### Completion Notes List

- **Shared helper:** added `enqueueDocumentCleanup(ctx, { userId, documentId, status, r2Key })` to `convex/accountDeletion.ts`. Inserts a `pendingCleanup` row per applicable kind (`r2` iff `r2Key`, `ai-search` iff `status ∈ { success, indexing }`). Returns `{ r2Enqueued, aiSearchEnqueued }` so callers can decide whether to schedule the drain.
- **`deleteAccountCascade` refactor:** the inline enqueue loop inside `deleteAccountCascade` now delegates to `enqueueDocumentCleanup`. Byte-identical row shape confirmed by the 10-test 5.1 regression suite.
- **`documents.deleteDocument` gap closure:** replaces the direct `internal.documentActions.deleteDocumentFromR2` scheduler call with `enqueueDocumentCleanup` + a conditional `internal.accountDeletion.drainPendingCleanup` schedule. Processing-status deletes enqueue nothing and trigger no drainer. Also wrapped the `ctx.storage.delete(doc.fileId)` call in a try/catch for parity with the account-deletion path.
- **`folders.deleteFolder` cascade:** enumerates each folder's documents via `by_folderId`, runs `enqueueDocumentCleanup` + `ctx.storage.delete` + `ctx.db.delete` per doc, then deletes folders bottom-up. Returns accurate `{ deletedFolders, deletedDocuments }`. A single `drainPendingCleanup` is scheduled per cascade when any cleanup was enqueued. Cross-user safety is enforced by `collectDescendants`'s `by_userId_and_parentId` filter plus a defensive `doc.userId !== userId` skip.
- **Missing-CF-config behavior:** validated by reading `performCleanupAttempt` — when `getAiSearchConfig()` returns null it short-circuits to `{ ok: true }` and the row is dequeued. No new code required for AC #5; the guarantee is inherited from 5.1.
- **Two pre-existing tests updated (not new):** the `documents.deleteDocument` test file had three tests asserting the old scheduler target (`documentActions:deleteDocumentFromR2`). Rewrote their predicates to target the new `accountDeletion:drainPendingCleanup` scheduler entry. Assertion intent is preserved: "a cleanup job is scheduled when applicable; no job otherwise."
- **`deleteDocumentFromR2` kept in place:** after this story no caller references it. Deletion is a safe one-liner but is out of scope to preserve a narrow diff; captured as a deferred item.
- **Deferred item closure:** struck through the Story 3.3 deferred bullet ("`deleteDocument` does not remove document from Cloudflare AI Search index") and annotated with the resolution pointer to 5.2. Entry preserved for audit history (matches the "Resolved during..." convention at the top of `deferred-work.md`).

### Decisions (dev)

- **Helper lives in `accountDeletion.ts`:** consolidates all cleanup-schema knowledge in one file. Alternative (a new `convex/cleanup.ts`) would fragment the pattern and create a circular import risk with `documents.ts` and `folders.ts`. `accountDeletion.ts` is not a "use node" file, so importing it from two other non-node mutation files is clean.
- **`folders.deleteFolder` order:** per-document cleanup runs before folder-row deletes so each `documents` row is still resolvable when its cleanup is enqueued. Folder rows delete bottom-up (descendants first) to preserve the existing invariant.
- **Conditional drainer schedule in both callers:** avoids a spurious scheduler entry for the common case of deleting a processing-status document (which has nothing to clean externally). In `folders.deleteFolder` the guard is `anyCleanupEnqueued` (any doc in the cascade had r2/ai-search residue).
- **Folder `documentCount` not touched in cascade:** the folder rows are deleted entirely, so patching their count mid-cascade is dead work. For individual doc deletes (`documents.deleteDocument`) the count is still decremented.

### File List

- `convex/accountDeletion.ts` — added exported `enqueueDocumentCleanup` helper; refactored `deleteAccountCascade` to use it.
- `convex/documents.ts` — rewired `deleteDocument` to use the durable `pendingCleanup` queue + `drainPendingCleanup` scheduler; wrapped `ctx.storage.delete` in try/catch.
- `convex/folders.ts` — fixed `deleteFolder` cascade to enumerate and delete all documents (including descendant folders'); enqueue cleanup rows; return accurate `deletedDocuments`.
- `convex/documents.test.ts` — added 6 new tests (`describe('documents.deleteDocument')`); updated 3 pre-existing tests to target the new scheduler entry name.
- `convex/folders.test.ts` — added 4 new tests (`describe('folders.deleteFolder cascade (story 5.2)')`).
- `_bmad-output/implementation-artifacts/5-2-document-deletion-index-cleanup-validation.md` — this file.
- `_bmad-output/test-artifacts/atdd-checklist-5-2.md` — ATDD checklist (RED-phase artifact).
- `_bmad-output/implementation-artifacts/deferred-work.md` — struck-through the 3.3 gap bullet.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — status transitions.

### Change Log

- 2026-04-12: Story 5.2 implemented. Per-document and folder-cascade delete paths now enqueue `pendingCleanup` rows for Cloudflare AI Search chunk removal (previously missing) and Cloudflare R2 object deletion (previously a fire-and-forget scheduler call). Both share a new `enqueueDocumentCleanup` helper in `convex/accountDeletion.ts`; both schedule the existing `drainPendingCleanup` worker from Story 5.1. `folders.deleteFolder` now correctly returns the number of deleted documents (was `0` — an Epic 2-era bug revealed once Epic 3 added a real `documents` table). Closes the Story 3.3 deferred AI-Search-cleanup gap.
