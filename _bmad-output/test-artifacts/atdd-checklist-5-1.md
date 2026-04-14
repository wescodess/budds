---
stepsCompleted:
  - step-01-preflight-and-context
  - step-02-generation-mode
  - step-03-test-strategy
  - step-04-generate-tests
  - step-05-validate-and-complete
lastStep: 'step-05-validate-and-complete'
lastSaved: '2026-04-12'
workflowType: 'testarch-atdd'
inputDocuments:
  - _bmad-output/implementation-artifacts/5-1-account-deletion-with-cascading-data-cleanup.md
  - _bmad-output/implementation-artifacts/epic-4-retro-2026-04-12.md
  - convex/schema.ts
  - convex/auth.ts
  - convex/conversations.ts
  - convex/documentActions.ts
  - convex/folders.test.ts
  - app/layouts/default.vue
  - server/middleware/auth-proxy.ts
---

# ATDD Checklist — Epic 5, Story 5.1: Account Deletion with Cascading Data Cleanup

**Date:** 2026-04-12
**Author:** palmwine
**Primary Test Level:** Integration (Convex) + Component (Vue)
**Detected Stack:** fullstack (Nuxt 4 + Convex + Better Auth)
**Generation Mode:** AI generation (no recording)
**Execution Mode:** sequential

---

## Story Summary

Allow a signed-in user to delete their account via a destructive-confirmation dialog in the sidebar footer. The confirmation fires Better Auth's `/delete-user` endpoint; a `beforeDelete` hook runs a Convex cascade mutation that removes every per-user storage location (messages, conversations, documents, folders, files, R2 objects, AI Search chunks, user row, Better Auth user). External-service residue (AI Search chunks, R2 objects) is captured in a new `pendingCleanup` table and retried with exponential backoff until empty, meeting NFR13's 24-hour removal guarantee.

**As a** student
**I want to** delete my account and know all my data is permanently removed
**So that** I maintain control over my personal information.

---

## Acceptance Criteria

1. Destructive confirmation dialog opens from the sidebar user menu; confirm button is disabled until the user types `DELETE` or their email (case-insensitive).
2. Confirm triggers `/api/auth/delete-user` → Better Auth `beforeDelete` hook → `deleteAccountCascade` internal mutation → cascade order enumerated in the story; session cleared; redirect to `/`.
3. External-service partial failures go into `pendingCleanup` with exponential backoff retry (cap 10 attempts, max 1h interval; cumulative window ≤ 24h).
4. AI Search + R2 delete paths are idempotent — 404/NotFound treated as success.
5. After deletion, every Convex query returns empty for the deleted `userId`; AI Search returns zero chunks once `pendingCleanup` drains.
6. Schema gets one new table (`pendingCleanup`) and one new index (`messages.by_userId`); additive-only.
7. Isolation invariant: cascade only touches rows where `userId === identity.tokenIdentifier`; no handler accepts `userId` as an argument.

---

## Test Strategy

### Level Selection

| AC | Level              | Rationale                                                                         |
| -- | ------------------ | --------------------------------------------------------------------------------- |
| 1  | Component          | Dialog gating is pure UI; Reka-portal precedent applies (may need `.skip`).       |
| 2  | Convex integration | Cascade contract + ordering; HTTP side covered by a thin component smoke.         |
| 3  | Convex integration | `pendingCleanup` lifecycle — enqueue, retry, attempt counter, removal on success. |
| 4  | Convex integration | Idempotence on simulated 404 from AI Search / R2.                                 |
| 5  | Convex integration | Post-cascade emptiness + cross-user isolation (user B untouched).                 |
| 6  | Convex integration | Schema additivity enforced by `convex-test` + compile-time checks.                |
| 7  | Convex integration | Security boundary — unauthenticated caller rejected.                              |

E2E not authored — Nuxt app has no Playwright runner configured in `package.json`, same precedent as 4.x.

### Priority Distribution

- P0 (13 tests): cascade correctness across all tables, isolation, pendingCleanup enqueue, dialog gating, idempotent delete paths.
- P1 (7 tests): unauthenticated rejection, 404-as-success, retry attempts increment, sidebar menu wiring, navigation after success.

---

## Failing Tests Created (RED Phase)

### Convex Integration Tests — `convex/accountDeletion.test.ts` (14 tests)

**Cascade correctness**
- **[P0] deleteAccountCascade removes all folders/documents/conversations/messages/users rows for the caller** — RED: `api.accountDeletion` module does not exist.
- **[P0] deleteAccountCascade leaves another user's folders/documents/conversations/messages untouched** — RED: mutation missing.
- **[P0] deleteAccountCascade deletes Convex file-storage blobs for every document** — RED: mutation missing (stub `ctx.storage.delete`, assert call count).
- **[P0] deleteAccountCascade deletes the `users` row by `by_tokenIdentifier`** — RED: mutation missing.

**pendingCleanup lifecycle**
- **[P0] deleteAccountCascade enqueues a `kind: 'r2'` pendingCleanup row for every document with an `r2Key`** — RED: table + enqueue logic missing.
- **[P0] deleteAccountCascade enqueues a single `kind: 'ai-search'` sentinel row with `documentId: '__user_bulk__'`** — RED: enqueue logic missing.
- **[P0] deleteAccountCascade also enqueues per-document `kind: 'ai-search'` rows for each `status: 'success' | 'indexing'` document** — RED: backstop logic missing.
- **[P1] drainPendingCleanup removes rows on simulated 404 (both ai-search and r2 kinds)** — RED: action missing.
- **[P1] drainPendingCleanup increments `attempts` + schedules next run on simulated 5xx** — RED: action missing.
- **[P1] drainPendingCleanup stops at `attempts === 10` (no further reschedule)** — RED: cap missing.

**Security boundary**
- **[P0] deleteAccountCascade rejects unauthenticated caller** — RED: mutation missing.
- **[P0] post-cascade queries return empty — listAllFolders, listRecentForUser, listDocumentsByFolder** — RED: mutation missing.

**Idempotence**
- **[P0] deleteUserDataFromAiSearch treats 404 as success (no throw, returns cleanly)** — RED: action missing.
- **[P1] deleteDocumentFromR2 treats NoSuchKey as success on retry** — RED: defensive handling not yet verified; current impl logs but may re-throw in certain paths.

### Component Tests — `tests/component/app-shell/delete-account-dialog.test.ts` (6 tests, `.skip` per Reka-portal precedent)

- **[P0] sidebar user menu exposes `Delete account` item** — RED: menu replaced on this story.
- **[P0] dialog renders with destructive confirm button disabled** — RED: dialog not wired.
- **[P0] typing `DELETE` enables confirm** — RED: gating logic missing.
- **[P0] typing matching email (case-insensitive) enables confirm** — RED: gating logic missing.
- **[P1] confirm POSTs to `/api/auth/delete-user`** — RED: handler missing.
- **[P1] on success, navigates to `/` and shows success toast** — RED: handler missing.

---

## Data Factories Reused

- `tests/support/factories/folder.factory.ts` — folder seeding
- Inline factory for documents/conversations/messages via existing mutations (`api.folders.createFolder`, `api.documentActions.createDocument`, `api.conversations.createConversation`, `api.messages.appendMessage`) — the canonical `convex-test` pattern.

No new factories required.

---

## Fixtures Created

None new. Reuse `TEST_IDENTITY` / `OTHER_IDENTITY` from `convex/conversations.test.ts` and `convex/folders.test.ts`.

---

## Mock Requirements

- `fetch` — stub for Cloudflare AI Search bulk delete + per-document delete endpoints. Simulate `200`, `404`, `500`.
- `S3Client.send` — stub for R2 `DeleteObjectCommand`. Simulate success, `NoSuchKey`, and transient `5xx`.
- `ctx.storage.delete` — no stub needed; `convex-test` satisfies this natively.

Pattern established by `convex/documentActions.test.ts` (existing `fetch` stub convention).

---

## Required `data-testid` Attributes

### Sidebar (`app/layouts/default.vue`)

- `sidebar-user-menu-trigger` — dropdown trigger on the user-footer row (replaces the bare sign-out icon).
- `sidebar-menu-sign-out` — Sign out menu item (preserves existing behavior; tested in layout smoke).
- `sidebar-menu-delete-account` — Delete account menu item (destructive).
- `delete-account-dialog` — `AlertDialog` root.
- `delete-account-confirm-input` — text input used for the gating check.
- `delete-account-confirm-button` — destructive confirm button.
- `delete-account-cancel-button` — cancel button.
- Preserve: `sidebar-sign-out` (if retained as a fallback on small screens; otherwise relocated into the dropdown).

---

## Implementation Checklist

Mapping failing tests → story tasks:

### Convex cascade tests

- [ ] Task 1: Codify cascade audit in Dev Agent Record.
- [ ] Task 2: Add `pendingCleanup` table + `messages.by_userId` index.
- [ ] Task 3: Implement `deleteAccountCascade`, `drainPendingCleanup`, helpers.
- [ ] Task 4: Add `deleteUserDataFromAiSearch` + ensure R2 delete is 404-safe.
- [ ] Run: `pnpm test -- convex/accountDeletion.test.ts`
- [ ] GREEN

### Better Auth hook

- [ ] Task 5: Extend `convex/auth.ts` with `user.deleteUser.enabled` + `beforeDelete`.
- [ ] Manual smoke (no test runner wires Better Auth end-to-end in this repo).

### Dialog UI tests

- [ ] Task 6: Replace sidebar-footer sign-out button with dropdown + Delete Account dialog.
- [ ] Task 7: Write component tests in `tests/component/app-shell/delete-account-dialog.test.ts`; may ship `.skip` per Reka precedent.
- [ ] Un-skip once Reka-portal pattern resolves (Epic 4 retro prep item #4).

### Full suite verification

- [ ] `pnpm test` — all green (or pre-existing failures only).
- [ ] `pnpm test:component` — all green (or pre-existing failures only; new tests `.skip` acceptable).

---

## Running Tests

```bash
# Convex integration (RED on first run)
pnpm test -- convex/accountDeletion.test.ts

# Full Convex suite (verify no regressions in existing tests)
pnpm test

# Component (RED, .skip-ed on first run)
pnpm test:component -- tests/component/app-shell/delete-account-dialog.test.ts

# Full component suite
pnpm test:component
```

---

## Red-Green-Refactor Workflow

### RED Phase — Complete (this document)

- Convex tests will fail on module resolution for `api.accountDeletion.*`.
- Component tests authored with `test.skip()` per the 4.3/4.4 Reka-portal precedent.

### GREEN Phase — Dev Team

1. Walk Tasks 1→4 → rerun `convex/accountDeletion.test.ts` → 14 tests flip green.
2. Task 5 (Better Auth hook) wired — manually verify via a scratch session in dev mode.
3. Task 6 + 7 — un-skip component tests if Reka portal resolves; otherwise leave `.skip` with referenced comment.

### REFACTOR Phase — after green

- Consider extracting shared "delete all user-scoped rows in table T" helper if Story 5.2 or future stories need partial reuse.
- Ensure `pendingCleanup` fields and backoff helper remain exported for reuse by Story 5.2's per-document path.

---

## Knowledge Base References Applied

- `data-factories.md` — reused existing factories; no new ones.
- `test-quality.md` — Given/When/Then per AC; one invariant per test.
- `test-levels-framework.md` — integration + component; no E2E (no runner configured).
- `test-priorities-matrix.md` — P0 for cascade correctness, isolation, idempotence; P1 for retry edges and navigation.
- `component-tdd.md` — `.skip` for Reka-portal content until prep item #4 resolves.

---

## Test Execution Evidence

### Initial RED Verification (expected)

```
# Expected output for: pnpm test -- convex/accountDeletion.test.ts
FAIL convex/accountDeletion.test.ts
  - Cannot read properties of undefined (reading 'deleteAccountCascade')
    (api.accountDeletion does not exist in generated api)

Summary:
- Total: 14 convex tests + 6 component tests (skipped)
- Passing: 0 (expected)
- Failing: 14 convex (expected RED)
- Skipped: 6 component (intentional red-phase convention)
- Status: ✅ RED phase verified
```

Once Tasks 2–4 land, the 14 Convex tests flip green. Component tests are un-skipped after Tasks 6–7 if the Reka portal pattern is resolved in this story, otherwise they ship `.skip` with a referenced comment.

---

## Notes

- `beforeDelete` hook is executed inside Better Auth's authenticated endpoint; it receives `session.user` and a request. The cascade must run under a Convex context that has the user's identity — this is why `deleteAccountCascade` is an `internalMutation` called from `authComponent.runMutation(ctx, ...)` (or the equivalent the Better Auth component exposes).
- `pendingCleanup` intentionally uses a `userId: v.string()` column rather than a reference to `users`, since the `users` row will be deleted before the worker drains.
- AI Search API shape: if the API does not support bulk delete by attribute, the worker issues an attribute-filter list followed by per-id deletes; the `__user_bulk__` sentinel row is consumed once the list returns zero items.
- Do not stub `authComponent` — it is only touched by Task 5 and not reachable by `convex-test`.

---

## Next Steps

1. Dev picks up story 5.1 via `bmad-bmm-workflows-dev-story`.
2. Tasks 1–4 → Convex cascade tests go GREEN.
3. Task 5 wires Better Auth hook; manual browser smoke validates end-to-end.
4. Tasks 6–7 → sidebar UI + component tests.
5. On completion, run `bmad-bmm-workflows-code-review` for the landed implementation.

---

**Generated by BMad TEA Agent** — 2026-04-12
