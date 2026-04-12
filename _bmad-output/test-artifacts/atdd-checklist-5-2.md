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
  - _bmad-output/implementation-artifacts/5-2-document-deletion-index-cleanup-validation.md
  - _bmad-output/implementation-artifacts/5-1-account-deletion-with-cascading-data-cleanup.md
  - convex/accountDeletion.ts
  - convex/documents.ts
  - convex/folders.ts
  - convex/documentActions.ts
  - convex/schema.ts
---

# ATDD Checklist — Epic 5, Story 5.2: Document Deletion Index Cleanup Validation

**Date:** 2026-04-12
**Primary Test Level:** Integration (Convex)
**Detected Stack:** Convex mutations + integration tests via `convex-test`
**Generation Mode:** AI generation (no recording)

## Story Summary

Close the gap flagged in Story 3.3: `deleteDocument` must remove the document's chunks from the Cloudflare AI Search index in addition to the Convex row, file blob, and R2 object. Reuse the durable `pendingCleanup` + `drainPendingCleanup` + `backoffMs` primitives introduced in Story 5.1 so external-service failures are retried with exponential backoff. Extend the same fix to the folder-cascade delete path (currently returns `deletedDocuments: 0` from an Epic 2 era bug).

## Acceptance Criteria

1. `deleteDocument` enqueues `pendingCleanup` rows for AI Search (per-doc) and R2 (if `r2Key` set), schedules the drain, and removes the Convex row + file blob synchronously.
2. Transient failures increment `attempts` and reschedule via `backoffMs`.
3. 404 responses dequeue the row (idempotent).
4. `deleteFolder` cascades to all its documents (and descendant folders' documents) using the same enqueue helper; returns accurate `deletedDocuments`.
5. Missing CF config → drain no-ops cleanly.
6. Processing-status deletes enqueue nothing and schedule no drain.
7. Cross-user isolation: no row is ever enqueued with a foreign `userId`.

## Test Strategy

| AC | Level              | Rationale                                                                      |
| -- | ------------------ | ------------------------------------------------------------------------------ |
| 1  | Convex integration | Contract test on the enqueue side; no fetch stubs needed.                      |
| 2  | Convex integration | Already covered by `accountDeletion.test.ts` drain tests (reused primitive).   |
| 3  | Convex integration | Already covered by `accountDeletion.test.ts` drain tests (reused primitive).   |
| 4  | Convex integration | Folder cascade coverage — new tests in `folders.test.ts`.                      |
| 5  | Convex integration | Already implicitly covered (`performCleanupAttempt` short-circuits).           |
| 6  | Convex integration | New test in `documents.test.ts` — processing-status enqueue-nothing assertion. |
| 7  | Convex integration | Cross-user delete rejection + row-userId assertion.                            |

E2E skipped — no Playwright runner configured, same precedent as 4.x/5.1.

## Priority Distribution

- P0 (5 tests): enqueue contract for success/indexing/processing, cross-user rejection, folder cascade correctness, folder cascade isolation.
- P1 (3 tests): folder descendant cascade, documentCount decrement, empty-folder no-drain.

## Failing Tests Created (RED Phase)

### `convex/documents.test.ts` (new describe block: `deleteDocument`)

- **[P0] enqueues ai-search + r2 pendingCleanup rows for indexed document** — RED: `deleteDocument` currently schedules `internal.documentActions.deleteDocumentFromR2` directly; no `pendingCleanup` insert happens.
- **[P0] enqueues no pendingCleanup rows for processing document** — RED: same reason; current behavior is already no-enqueue, but there is no test asserting this invariant; the new test pins it.
- **[P0] removes documents row + file blob synchronously** — probably green today but worth pinning.
- **[P0] rejects unauthenticated caller** — green today; pins the invariant.
- **[P0] rejects cross-user delete** — green today; pins the invariant.
- **[P1] decrements folder documentCount** — green today.
- **[P1] pendingCleanup row carries caller's userId, not the document's** (belt-and-suspenders — they're identical by ownership guard, but the test asserts it).

### `convex/folders.test.ts` (new describe block: `deleteFolder cascade`)

- **[P0] cascades to folder's documents and enqueues their cleanup** — RED: current implementation returns `deletedDocuments: 0` and leaves docs in place.
- **[P0] cascades to descendant folders' documents** — RED: same.
- **[P0] does not touch another user's folder/documents** — pins isolation.
- **[P1] empty-folder deleteFolder enqueues no pendingCleanup rows** — RED-ish: current passes but only by accident (it never enqueues at all). The new implementation must still pass.

## Mock Requirements

- None. All tests operate on the Convex-side enqueue contract; `fetch` stubs are not needed.
- Drain idempotence + transient-failure handling are already covered by `accountDeletion.test.ts` — re-asserting them in this story's test file would be redundant.

## Required `data-testid` Attributes

None. No UI changes.

## Red-Green-Refactor Workflow

### RED Phase — Complete (this document)

- `documents.test.ts` new tests fail on missing `pendingCleanup` rows.
- `folders.test.ts` new tests fail on `deletedDocuments: 0` + orphaned documents.

### GREEN Phase — Dev

1. Task 1 — extract `enqueueDocumentCleanup` helper.
2. Task 2 — wire `documents.deleteDocument` to the helper + drain scheduler.
3. Task 3 — fix `folders.deleteFolder` cascade.
4. Run `pnpm test -- convex/documents.test.ts convex/folders.test.ts convex/accountDeletion.test.ts` — all green.

### REFACTOR Phase — after green

- Consider deleting the orphaned `deleteDocumentFromR2` action (captured in deferred items — out of scope here).

## Notes

- All new tests live in existing files (`documents.test.ts` and `folders.test.ts`) via new `describe` blocks. Avoid creating new test files purely to reduce import/config overhead.
- `pendingCleanup` rows use `documentId: v.string()` (not `v.id('documents')`) — callers must `String(doc._id)`. Test assertions should compare against `String(docId)`.

---

**Generated by BMad TEA Agent** — 2026-04-12
