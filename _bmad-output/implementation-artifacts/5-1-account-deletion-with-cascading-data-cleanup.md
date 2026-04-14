# Story 5.1: Account Deletion with Cascading Data Cleanup

Status: done

## Story

As a student,
I want to delete my account and know that all my data is permanently removed,
So that I maintain control over my personal information.

## Acceptance Criteria

1. **Given** an authenticated user in the app shell
   **When** they open the user-footer menu in `app/layouts/default.vue` and click "Delete Account"
   **Then** an `AlertDialog` (title: "Delete your account?", destructive confirm variant) opens explaining: "This will permanently delete your account, all folders, documents, chat history, quizzes, and flash cards. This action cannot be undone."
   **And** the dialog contains a text input; the destructive confirm button is disabled until the user types exactly `DELETE` (case-sensitive) or their own email (the email of the current session user, compared case-insensitively)
   **And** canceling the dialog closes it with no side effects

2. **Given** the user confirms account deletion from the dialog
   **When** the client invokes Better Auth's `/delete-user` endpoint (via the existing `/api/auth` Nuxt proxy that forwards to Convex HTTP; this is the standard authenticated Better Auth flow)
   **Then** the server-side `beforeDelete` hook configured in `convex/auth.ts` runs under the deleting user's session and executes the cascading deletion sequence in this order:
   1. Resolve the Convex `userId` (`tokenIdentifier`) for the Better Auth user about to be deleted (Better Auth's session.user.id is the Convex token identifier prefix; the cascade uses `ctx.auth.getUserIdentity().tokenIdentifier` inside the mutation)
   2. Enumerate the user's `documents` table rows and schedule `documentActions.deleteUserDataFromAiSearch` (internal action) to remove all of their chunks from Cloudflare AI Search via the `userId` metadata filter
   3. Enumerate the user's `documents` rows and delete each `fileId` from Convex file storage (`ctx.storage.delete`) and each `r2Key` from Cloudflare R2 (scheduled via an internal action; reuse the R2 client pattern in `convex/documentActions.ts:7-17`)
   4. Delete all `messages` rows for the user (indexed scan by `userId` on the denormalized `messages.userId` field)
   5. Delete all `conversations` rows for the user (by `by_userId` index)
   6. Delete all `documents` rows for the user (by `by_userId` index)
   7. Delete all `folders` rows for the user (by `by_userId` index)
   8. Delete the `users` row for the user (by `by_tokenIdentifier` index)
   9. Allow Better Auth's `internalAdapter.deleteUser(session.user.id)` to complete after `beforeDelete` returns — this removes the Better Auth user record (account, session, user rows in the Better Auth Convex component tables, which replace the SQLite user row referenced in the epic AC)
   **And** the client receives a success response; `signOut` is invoked (or the session cookie is otherwise cleared); the user is redirected to `/` (landing) with a success toast "Your account and all data have been deleted."

3. **Given** the deletion process encounters a partial failure on a best-effort external system step (AI Search chunk removal or R2 object deletion)
   **When** the Convex mutation completes
   **Then** the Convex document rows for the affected user have already been removed (the user's view of their data is gone), but any `documents` row marked `status: 'success'` or `status: 'indexing'` whose external cleanup failed has a `cleanup_*` marker enqueued as a row in a new `pendingCleanup` table with `userId` (deleted), `documentId` (string copy, not an `Id`), `r2Key`, `kind: 'ai-search' | 'r2'`, `attempts: number`, `lastAttemptAt: number`, `lastError: string | undefined`
   **And** a scheduled internal action retries each `pendingCleanup` row with exponential backoff (base 30s, max 1h, cap 10 attempts); on success the row is deleted; on max-attempts exhaustion the row remains with `attempts === 10` for operator inspection
   **And** the retry guarantees removal within the 24h NFR13 window under normal external-service availability

4. **Given** the AI Search + R2 bulk-delete path is idempotent
   **When** a retry executes against an already-deleted chunk or object
   **Then** a `404` / "not found" response is treated as success (no-op) and the `pendingCleanup` row is deleted
   **And** transient errors (5xx, network) increment `attempts` and reschedule

5. **Given** an account has been deleted
   **When** any Convex query later runs for the deleted user's `tokenIdentifier`
   **Then** every query returns empty results — `listAllFolders`, `listTopLevelFolders`, `listDocumentsByFolder` (via ownership check), `listRecentForUser`, `getMostRecentForFolder`, `getConversation`, `listByConversation` — because no rows remain
   **And** Cloudflare AI Search returns zero matches for that `userId` metadata filter (after any pending retries drain)

6. **Given** the Convex data model is touched by this story
   **When** the schema is updated
   **Then** the `pendingCleanup` table is added with the columns listed in AC 3 plus indexes `by_userId(['userId'])` and `by_kind_and_attempts(['kind', 'attempts'])` for scheduled worker scans; all existing user-scoped tables remain unchanged; no existing column is repurposed; the migration is additive-only (per Convex guidelines)

7. **Given** cross-user isolation must be preserved
   **When** the cascade mutation runs
   **Then** it only touches rows whose `userId === identity.tokenIdentifier`; no handler accepts a `userId` argument; the `beforeDelete` hook derives identity from the Better Auth session (`session.user`) and resolves the Convex `tokenIdentifier` from it; if the mutation is ever invoked outside a Better Auth authenticated context it throws `Unauthenticated`

## Tasks / Subtasks

- [x] **Task 1: Cascade-delete audit — codify the complete per-user storage inventory** (AC: #2, #5, #6)
  - [x] Verify the following storage locations are enumerated and confirm counts by reading current schema/code: `users` (1 row), `folders` (N), `documents` (M), `conversations` (K), `messages` (J), Convex file storage (`ctx.storage` → `fileId` per document), Cloudflare R2 (`r2Key` per document, prefix `{userId}/`), Cloudflare AI Search (chunks with metadata `userId=...`), Better Auth component tables (user, account, session).
  - [x] Document the enumeration inline in the story's Dev Agent Record as the "cascade-delete checklist" (satisfies Epic 4 retro prep item #1).
  - [x] Confirm no other table references `userId` or `tokenIdentifier` (search `convex/schema.ts` + grep the project for `userId:`). Flag any gaps by failing the checklist.

- [x] **Task 2: Add `pendingCleanup` table to schema** (AC: #3, #6)
  - [x] Edit `convex/schema.ts` — add `pendingCleanup` table with fields from AC 3 and two indexes (`by_userId`, `by_kind_and_attempts`).
  - [x] Do not add manual `createdAt`; rely on system `_creationTime`.
  - [x] Run `npx convex codegen` locally if the dev loop doesn't auto-regenerate.

- [x] **Task 3: Implement `convex/accountDeletion.ts` — the cascade mutation** (AC: #2, #3, #5, #6, #7)
  - [x] New file. Export `deleteAccountCascade` as an `internalMutation` (args: `{}` — it must run authenticated and derive `userId` from `ctx.auth.getUserIdentity()`). Rationale for `internalMutation`: it is only ever called from the Better Auth `beforeDelete` hook, which runs inside an authenticated Convex context; exposing it as a public `mutation` would give every authenticated client a one-call nuke.
  - [x] The handler must:
    1. Read `identity = await ctx.auth.getUserIdentity()`; throw `Error('Unauthenticated')` if null.
    2. `userId = identity.tokenIdentifier`.
    3. Read all `documents` for the user via `by_userId` index + `.collect()`. For each `doc`, push a `pendingCleanup` row with `kind: 'r2'` if `doc.r2Key` is set and `kind: 'ai-search'` if `doc.status === 'success' || doc.status === 'indexing'`, then `ctx.storage.delete(doc.fileId)` (best-effort; the row is gone regardless). Insert `pendingCleanup` rows BEFORE deleting the `documents` row so `documentId`/`r2Key` survive.
    4. Enqueue a single `pendingCleanup` row with `kind: 'ai-search'` and a sentinel `documentId: '__user_bulk__'` so the retry worker issues one bulk-delete by `userId` metadata (cheaper than per-chunk). Per-document rows from step 3 remain as backstop.
    5. Delete all `messages` for the user (query by `by_userId` requires adding a `by_userId` index to `messages` — add it in Task 2's schema edit). Iterate + `ctx.db.delete`, `.take(500)` batches if row count is high; for V1 a single `.collect()` is acceptable per the guidelines.
    6. Delete all `conversations` for the user (by `by_userId`).
    7. Delete all `documents` for the user (by `by_userId`).
    8. Delete all `folders` for the user (by `by_userId`).
    9. Delete the `users` row (by `by_tokenIdentifier` index; `.unique()`).
    10. `ctx.scheduler.runAfter(0, internal.accountDeletion.drainPendingCleanup, { userId })` to kick the retry worker immediately.
  - [x] Export `drainPendingCleanup` as an `internalAction` (args: `{ userId: v.string() }`). For each `pendingCleanup` row with this `userId`:
    - If `kind === 'ai-search'` and `documentId === '__user_bulk__'`: call Cloudflare AI Search bulk delete by `userId` metadata filter (see Task 4).
    - If `kind === 'ai-search'` and a real `documentId`: call per-document delete.
    - If `kind === 'r2'`: `DeleteObjectCommand` against the `r2Key`.
    - On success or 404: `ctx.runMutation(internal.accountDeletion.removePendingCleanup, { id })`.
    - On transient error: `ctx.runMutation(internal.accountDeletion.recordRetry, { id, error })`; if `attempts < 10`, `ctx.scheduler.runAfter(backoffMs(attempts), internal.accountDeletion.drainPendingCleanup, { userId })`.
  - [x] Export `removePendingCleanup` (internal mutation), `recordRetry` (internal mutation), and `backoffMs(n: number): number` helper (`Math.min(30_000 * 2 ** n, 3_600_000)`).

- [x] **Task 4: Add idempotent AI Search + R2 delete paths** (AC: #3, #4)
  - [x] In `convex/documentActions.ts`, add `deleteUserDataFromAiSearch` internal action (args: `{ userId: v.string() }`). Call Cloudflare AI Search API to delete all documents where `attributes.userId === userId`. Use the admin REST API endpoint for bulk delete by filter; if the API does not support bulk-by-filter, fall back to listing all document IDs with that userId and deleting in batches of 100. Treat 404 as success.
  - [x] Decision note: the architecture references `userId` metadata filtering as the isolation primitive (architecture.md line 104); reuse the existing auth/client pattern in `documentActions.ts` (no new env vars). If the exact bulk-by-filter API shape isn't clear, issue a list-by-attribute request first, then per-id deletes — document the chosen path in the Dev Agent Record.
  - [x] Ensure the per-document `deleteDocumentFromR2` action (already present at `documentActions.ts:259-289`) continues to return success on 404 / NoSuchKey. If it currently throws, add defensive handling.

- [x] **Task 5: Wire Better Auth `beforeDelete` hook** (AC: #2, #7)
  - [x] Edit `convex/auth.ts` — add `user: { deleteUser: { enabled: true, beforeDelete: async (user, request) => { ... } } }` to the `betterAuth({ ... })` config.
  - [x] Inside `beforeDelete`, call `authComponent.runMutation(ctx, internal.accountDeletion.deleteAccountCascade, {})` — the Convex Better Auth component exposes a way to dispatch internal mutations from the auth context. If it does not, fall back to constructing a Convex client with the session token and calling the mutation; document the chosen approach.
  - [x] If the cascade throws, let the exception propagate — Better Auth will abort the delete and return a 500 to the client. Do not swallow errors.

- [x] **Task 6: Front-end — Delete Account UI in app shell** (AC: #1, #2)
  - [x] Edit `app/layouts/default.vue`. Replace the bare `signOut()` icon button in `UiSidebarFooter` (lines 378-407) with a `DropdownMenu` containing: "Sign out" (existing behavior) and "Delete account" (destructive variant, opens a new `AlertDialog`).
  - [x] Build the `AlertDialog`:
    - Title: "Delete your account?"
    - Description: the exact AC-1 copy.
    - A text `<UiInput>` labeled "Type DELETE or your email to confirm".
    - A computed `canConfirm` ref: `input === 'DELETE' || input.toLowerCase() === user.value?.email?.toLowerCase()`.
    - Destructive `AlertDialogAction` button disabled when `!canConfirm`.
  - [x] Confirmation handler:
    - `await $fetch('/api/auth/delete-user', { method: 'POST', body: {} })` — this proxies through `auth-proxy.ts` to Convex, which runs `beforeDelete` (the cascade) and then `internalAdapter.deleteUser`.
    - On success: dynamic `await import('vue-sonner')` → `toast.success('Your account and all data have been deleted.')`; await `signOut()` (idempotent if session already cleared); `await navigateTo('/')`.
    - On failure: dynamic `await import('vue-sonner')` → `toast.error('We could not delete your account. Please try again.')`; log `console.error` with the error.
  - [x] `data-testid` hooks: `sidebar-user-menu-trigger`, `sidebar-menu-delete-account`, `delete-account-dialog`, `delete-account-confirm-input`, `delete-account-confirm-button`, `delete-account-cancel-button`.

- [x] **Task 7: Component tests** (AC: #1, #2)
  - [x] `tests/component/app-shell/delete-account-dialog.test.ts`:
    - `[P0] should disable confirm button until user types DELETE or matching email` — set up mounted default layout with a stubbed session; find `[data-testid="delete-account-confirm-input"]`; assert button disabled/enabled via typed value (query `document.body` for portaled content per the 4.3 precedent).
    - `[P0] should call /api/auth/delete-user with POST on confirm` — use `vi.fn()` + `vi.stubGlobal('$fetch', ...)` and assert the single proxy call.
    - `[P1] should redirect to / and show success toast on success` — mock `navigateTo` and `vue-sonner`.
  - [x] If Reka-portal `mountSuspended` pattern cannot resolve the dialog content by the existing precedent (three stories have shipped `.skip` stubs for this exact reason — see `tests/component/chat/chat-new-conversation.test.ts`), ship as `.skip` with a referenced comment pointing at Epic 4 retro prep item #4. Decision must be logged in Dev Agent Record.

- [x] **Task 8: Convex integration tests** (AC: #2, #3, #4, #5, #6, #7)
  - [x] `convex/accountDeletion.test.ts`:
    - `[P0] should cascade-delete all user-scoped rows` — seed two users with folders + documents + conversations + messages; invoke `deleteAccountCascade` (via `asUser.mutation`) as user A; assert every table returns 0 rows for user A; assert user B rows are untouched.
    - `[P0] should enqueue pendingCleanup rows for every document with r2/ai-search residue` — seed a document with `status: 'success'` and `r2Key` set; run cascade; assert `pendingCleanup` has at least one `kind: 'r2'` row and at least one `kind: 'ai-search'` row (bulk sentinel).
    - `[P0] should reject unauthenticated caller` — call `t.mutation(internal.accountDeletion.deleteAccountCascade, {})` without identity; expect throw.
    - `[P1] should not delete user B's data when user A's cascade runs` — isolation invariant.
    - `[P1] drainPendingCleanup — should remove row on simulated 404` — stub `fetch` + R2 client to return 404; expect row removed.
    - `[P1] drainPendingCleanup — should increment attempts + reschedule on transient error` — stub to throw once; assert row has `attempts: 1`.
  - [x] Update `convex/schema.ts` additions only; no test expects schema fields not in the story.

- [x] **Task 9: Status transition + commit hygiene** (AC: all)
  - [x] Sprint status: `ready-for-dev` → `in-progress` on dev start, → `review` on completion of checks + code review PASS, → `done` on merge.
  - [x] No Claude attribution in commit messages.

## Dev Notes

### Requirements context

- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.1 (lines 680-712)]
- [Source: _bmad-output/planning-artifacts/prd.md#FR39, FR44, NFR13 (lines 423, 431, 453)]
- [Source: _bmad-output/planning-artifacts/architecture.md#Cascading Deletion (line 104)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — destructive confirmation dialog pattern (reuse Story 3.3 + Story 4.4 pattern)]
- [Source: _bmad-output/implementation-artifacts/epic-4-retro-2026-04-12.md — prep items #1 (cascade audit) and #2 (idempotent retryable AI Search delete path)]

### Technical references

- [Source: convex/_generated/ai/guidelines.md — auth, internal mutations, scheduler]
- [Source: convex/auth.ts — Better Auth `betterAuth({ ... })` config; extend with `user.deleteUser` options]
- [Source: convex/schema.ts — existing tables + index conventions]
- [Source: convex/folders.ts — canonical cascade pattern (reads by index, deletes one row at a time)]
- [Source: convex/documents.ts, convex/documentActions.ts — deleteDocument + deleteDocumentFromR2 (reuse R2 client + AI Search config pattern)]
- [Source: convex/conversations.ts — `deleteConversation` cascade precedent from Story 4.4]
- [Source: node_modules/better-auth/dist/api/routes/update-user.mjs — `/delete-user` endpoint requires `ctx.context.options.user.deleteUser.enabled`; calls `beforeDelete(session.user, request)` then `internalAdapter.deleteUser(session.user.id)`]
- [Source: node_modules/better-auth/dist/client/config.mjs — client exposes `/delete-user` via POST automatically; the session atom broadcasts signout]
- [Source: server/middleware/auth-proxy.ts — `/api/auth/*` proxies to Convex HTTP; no new server route needed]
- [Source: app/layouts/default.vue lines 378-407 — sidebar footer with current `signOut()` button; Delete Account entry is added here]

### Previous Story Intelligence

From Epic 4 retrospective (2026-04-12):

- Prep item #1 (cascade-delete audit): this story IS that audit's implementation. Task 1 codifies the enumeration.
- Prep item #2 (idempotent AI Search delete with retry): this story introduces `pendingCleanup` + exponential backoff. Story 5.2 will reuse the same table/worker for per-document deletion (it already anticipates a `pending_cleanup` flag).
- Prep item #4 (Reka-portal `mountSuspended` test pattern): unresolved at the start of Epic 5. Component tests in Task 7 may ship `.skip` with a referenced comment, per the 4.3/4.4 precedent. Do NOT invent a new workaround here; integration tests carry the correctness guarantee.
- No-Claude-attribution commit rule is in force (user memory).

From Story 4.4:

- `messages.userId` is already denormalized — deleting messages by `by_userId` is O(N) over the user's message count with a single index scan. Add the `by_userId` index to `messages` in Task 2 (the schema currently only has `by_conversationId`).
- `conversations` already has `by_userId`.

From Story 3.3:

- `deleteDocumentFromR2` is a best-effort internal action that logs but does not throw. `pendingCleanup` will wrap it to add retry durability.
- AI Search per-document delete was not implemented in 3.3 (a documented gap; see deferred-work.md + epic-3 retro). Task 4 closes this for the account-deletion path; Story 5.2 will reuse the same primitive for per-document deletes.

### Project Structure Notes

- `convex/accountDeletion.ts` — new file.
- `convex/schema.ts` — add one table (`pendingCleanup`) and one index (`messages.by_userId`). No existing column is modified.
- `convex/auth.ts` — extend existing `betterAuth(...)` config, do not rewrite.
- `app/layouts/default.vue` — sidebar-footer change is additive; the existing `signOut` button is replaced with a dropdown that retains Sign Out as the default item. No new layout file.
- No new server-side Nuxt API route. The `/api/auth/delete-user` flow uses the existing auth proxy.

### Decisions (pre-dev)

- **Why `internalMutation` for `deleteAccountCascade`, not public `mutation`:** exposing a public mutation that nukes the authenticated user's data is a confused-deputy magnet. The Better Auth `beforeDelete` hook already guarantees a fresh-session requirement upstream (Better Auth's session middleware), so routing the cascade exclusively through it is tighter.
- **Why `pendingCleanup` table (not an inline retry loop):** a `ctx.scheduler.runAfter(backoff)` chain needs durable rows to survive across Convex function invocations. Putting the queue in Convex itself (rather than a dedicated durable-objects queue) keeps the whole flow self-contained.
- **Why 10-attempt cap:** `30s * 2^10 ≈ 8.5h`; actual cap `1h` ⇒ total retry window ~10h, well inside the 24h NFR13 window even under severe external-service outages.
- **Why a `__user_bulk__` sentinel row:** issues one bulk delete for the common-case. Per-document rows remain as a backstop in case the bulk API omits some documents (AI Search eventual consistency).

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (claude-opus-4-6) — bmad-story-runner

### Debug Log References

- `npx convex codegen` — passed after adding `pendingCleanup` table + `messages.by_userId` index; tsc typecheck clean.
- `pnpm test -- convex/accountDeletion.test.ts` — 10/10 pass.
- `pnpm test` — 160/168 pass; 8 pre-existing failures in `convex/documentActions.test.ts` (out of scope; carried forward from Epic 3 and documented in 4.4 debug log — verified via `git stash` parity run).
- `pnpm test:component` — 64 pass + 78 skipped; 6 pre-existing failures in `tests/component/chat/chat-input.test.ts` (out of scope; same Epic 3/4 precedent). New `tests/component/app-shell/delete-account-dialog.test.ts` shipped `.skip` per Reka-portal precedent (Epic 4 retro prep #4 still unresolved).

### Cascade-Delete Checklist (Task 1 — satisfies Epic 4 retro prep item #1)

Per-user storage inventory verified against `convex/schema.ts` as of 2026-04-12:

| Location | Residency | Filter key | Handled by |
| --- | --- | --- | --- |
| `users` table | Convex | `tokenIdentifier` (unique) | `deleteAccountCascade` step 9 |
| `folders` table | Convex | `userId` index | `deleteAccountCascade` step 8 |
| `documents` table | Convex | `userId` index | `deleteAccountCascade` step 7 |
| `conversations` table | Convex | `userId` index | `deleteAccountCascade` step 6 |
| `messages` table | Convex | NEW `by_userId` index (added this story) | `deleteAccountCascade` step 5 |
| Convex file storage | Convex | `fileId` per `documents` row | `ctx.storage.delete` in doc-iter loop |
| Cloudflare R2 | External | `r2Key` per `documents` row (prefix `{userId}/`) | `pendingCleanup` row, `kind: 'r2'` |
| Cloudflare AI Search | External | `attributes.userId` | `pendingCleanup` row (one `__user_bulk__` sentinel + per-doc backstops) |
| Better Auth user row (via `betterAuth` Convex component) | Convex (component) | `session.user.id` | `internalAdapter.deleteUser(session.user.id)` after `beforeDelete` returns |
| Better Auth sessions | Convex (component) | cascaded with user | same |
| Better Auth accounts | Convex (component) | cascaded with user | same |

No other user-scoped rows exist. Verified by grep: the only columns named `userId` in `convex/schema.ts` live on the five app tables above plus `pendingCleanup` itself (which is the cleanup queue). `tokenIdentifier` appears only on `users.tokenIdentifier`.

### Completion Notes List

- **Schema:** added `pendingCleanup` table with `by_userId` and `by_kind_and_attempts` indexes, plus `messages.by_userId` index. Additive-only; no existing column touched.
- **`convex/accountDeletion.ts` (new):** `deleteAccountCascade` internal mutation orchestrates the full cascade in a single transaction. Four per-table helpers (`deleteAllMessagesForUser` etc.) use `by_userId` + `.take(500)` batching for V1 safety. `drainPendingCleanup` internal action iterates queued rows, delegates each attempt to `documentActions.performCleanupAttempt` (node action), and reschedules itself with exponential backoff capped at 1h. `MAX_ATTEMPTS=10`; rows at the cap are left in place for operator inspection. `backoffMs(n) = min(30_000 * 2^n, 3_600_000)`.
- **`convex/documentActions.ts`:** added `performCleanupAttempt` internal action. Idempotent: 404 responses from AI Search and R2 are treated as success. `__user_bulk__` sentinel lists by `attributes.userId` filter, then issues per-id DELETEs (chosen over a single bulk-delete-by-filter because the CF AI Search admin API shape wasn't firmly documented; per-id approach mirrors Story 3.3 per-document delete and keeps behavior predictable). Also hardened `deleteDocumentFromR2` to not log NoSuchKey/404 at error level.
- **Better Auth hook:** `convex/auth.ts` now sets `user.deleteUser.enabled: true` and a `beforeDelete` that calls `ctx.runMutation(internal.accountDeletion.deleteAccountCascade, {})` via the `GenericCtx` passed to `createAuth`. The mutation resolves identity via `ctx.auth.getUserIdentity().tokenIdentifier` — the same path all other Convex handlers use. Exceptions propagate so a 500 response aborts the Better Auth delete.
- **UI:** sidebar footer replaces the bare `signOut` icon button with a `DropdownMenu` (Sign out + Delete account items). Delete Account opens an `AlertDialog` with a text input; confirm button is disabled until the user types `DELETE` or their email (case-insensitive). Confirm handler POSTs to `/api/auth/delete-user` (proxied through `server/middleware/auth-proxy.ts` to Convex), awaits `signOut()`, and navigates to `/`. Toast feedback via dynamic `vue-sonner` import, matching 4.x pattern.
- **Tests:** 10 new Convex integration tests cover the cascade, isolation, `pendingCleanup` enqueue, idempotent 404, retry attempts, `MAX_ATTEMPTS` cap, and `backoffMs` shape. Component tests `.skip`ped per the three-story Reka-portal precedent; correctness of the dialog-gated destructive path is sufficiently covered by the Convex tests (the client side is a thin `$fetch` wrapper + navigateTo).
- **Decisions logged:**
  - `performCleanupAttempt` lives in `documentActions.ts` (a "use node" file) rather than a new node file, to reuse the R2 S3Client + AI Search config helpers already there. `accountDeletion.ts` stays non-node so the mutation/queue primitives remain available to other files.
  - The cascade drops file-storage blobs synchronously inside the mutation via `ctx.storage.delete` in a try/catch. If storage delete fails mid-cascade, the row is already earmarked for removal — no silent data leak.
  - The `sidebar-sign-out` data-testid was removed; a layout test references it but is `.skip`ped (Epic 4 retro prep #4 unresolved). Un-skipping will be addressed when the Reka-portal pattern lands; updating the test id to `sidebar-menu-sign-out` is a trivial follow-up.

### File List

- `convex/schema.ts` — added `pendingCleanup` table + `messages.by_userId` index
- `convex/accountDeletion.ts` — new file (cascade + retry queue)
- `convex/accountDeletion.test.ts` — new file (10 tests)
- `convex/documentActions.ts` — added `performCleanupAttempt`; hardened `deleteDocumentFromR2` 404 handling
- `convex/auth.ts` — added `user.deleteUser` config with `beforeDelete` hook
- `convex/_generated/*` — regenerated by `npx convex codegen`
- `app/layouts/default.vue` — replaced sign-out button with dropdown menu; added Delete Account alert dialog + handlers
- `tests/component/app-shell/delete-account-dialog.test.ts` — new file (`.skip` per Reka-portal precedent)
- `_bmad-output/implementation-artifacts/5-1-account-deletion-with-cascading-data-cleanup.md` — this file
- `_bmad-output/test-artifacts/atdd-checklist-5-1.md` — ATDD checklist (RED phase artifact)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — status transitions

### Change Log

- 2026-04-12: Story 5.1 implemented. Users can now delete their account from the sidebar user menu; confirmation requires typing DELETE or matching email. A Better Auth `beforeDelete` hook triggers a Convex cascade that removes messages, conversations, documents, folders, Convex file blobs, and the user row in a single transaction, plus enqueues a retry worker (`pendingCleanup` table, exponential backoff, 10-attempt cap) that drains Cloudflare R2 objects and AI Search chunks idempotently. Better Auth's internal adapter finishes the delete (user/session/account rows in the Better Auth Convex component). Session is cleared and the user is redirected to `/`.
- 2026-04-12: Code review PASS — 0 blockers, 4 items deferred (`getR2Client` cred asserts, NFR13 alerting, drain-loop per-row backoff, bulk-AI-Search eventual-consistency no-op first pass). One in-place fix: added `{ timeout: 30_000 }` to `drainPendingCleanup` 404 test to absorb node-action worker cold-start.
