---
stepsCompleted:
  - step-01-preflight-and-context
  - step-02-generation-mode
  - step-03-test-strategy
  - step-04-generate-tests
  - step-05-validate-and-complete
lastStep: step-05-validate-and-complete
lastSaved: '2026-04-11'
workflowType: testarch-atdd
inputDocuments:
  - _bmad-output/implementation-artifacts/3-2-document-ingestion-pipeline-with-per-user-isolation.md
  - convex/documents.ts
  - convex/documents.test.ts
  - convex/schema.ts
  - server/utils/ai-search.ts
  - server/utils/ai-search.test.ts
  - _bmad/tea/workflows/testarch/bmad-testarch-atdd/resources/knowledge/data-factories.md
  - _bmad/tea/workflows/testarch/bmad-testarch-atdd/resources/knowledge/test-quality.md
---

# ATDD Checklist - Epic 3, Story 3.2: Document Ingestion Pipeline with Per-User Isolation

**Date:** 2026-04-11
**Author:** palmwine
**Primary Test Level:** Integration (Convex action) + Unit (Server utility)

---

## Story Summary

Uploaded PDF documents are automatically processed and indexed for AI search with strict per-user isolation, so students can ask questions about their materials and get accurate, source-cited answers.

**As a** student
**I want** my uploaded documents to be automatically processed and indexed for AI search
**So that** I can ask questions about my materials and get accurate, source-cited answers

---

## Acceptance Criteria

1. PDF binary retrieved from storage → text extracted → upserted to Cloudflare AI Search with metadata (userId, documentId, folderId, filename) → status updated to "success"
2. Empty/image-only PDF → status "failed" with reason "No extractable text detected — scanned or image-only PDF"
3. Any ingestion failure → status "failed" with specific reason string
4. `searchDocuments()` always injects `userId` filter server-side — cannot be omitted or overridden
5. User B search never includes User A's documents
6. Real-time UI update via Convex subscription (already wired from Story 3.1)

---

## Failing Tests Created (RED Phase)

### Integration Tests — Convex Action (8 tests)

**File:** `convex/documentActions.test.ts` (185 lines)

- **Test:** `[P0] should extract text from PDF and update status to success`
  - **Status:** RED (skipped) — `convex/documentActions.ts` does not exist yet
  - **Verifies:** AC1 — full ingestion pipeline from PDF to success status

- **Test:** `[P0] should upsert to Cloudflare AI Search with correct metadata`
  - **Status:** RED (skipped) — `convex/documentActions.ts` does not exist yet
  - **Verifies:** AC1 — upsert request body includes userId, documentId, folderId, filename

- **Test:** `[P0] should fail with reason when PDF has no extractable text`
  - **Status:** RED (skipped) — `convex/documentActions.ts` does not exist yet
  - **Verifies:** AC2 — empty text produces specific failure reason

- **Test:** `[P0] should fail with error details when AI Search API returns error`
  - **Status:** RED (skipped) — `convex/documentActions.ts` does not exist yet
  - **Verifies:** AC3 — API error status code included in failure reason

- **Test:** `[P1] should fail when file is not found in storage`
  - **Status:** RED (skipped) — `convex/documentActions.ts` does not exist yet
  - **Verifies:** AC3 — missing file produces specific failure reason

- **Test:** `[P1] should include authorization header in AI Search request`
  - **Status:** RED (skipped) — `convex/documentActions.ts` does not exist yet
  - **Verifies:** AC1 — Bearer token and Content-Type headers sent correctly

- **Test:** `[P0] should schedule ingestDocument action after document creation`
  - **Status:** RED (skipped) — scheduler call not added to `createDocument` yet
  - **Verifies:** AC1 — `createDocument` triggers ingestion via `ctx.scheduler.runAfter(0, ...)`

- **Test:** `[P0] should pass correct args to scheduled ingestDocument`
  - **Status:** RED (skipped) — scheduler call not added to `createDocument` yet
  - **Verifies:** AC1 — scheduled action receives documentId, fileId, userId, folderId, filename

### Unit Tests — Server Utility (3 tests)

**File:** `server/utils/ai-search.test.ts` (added to existing, 3 new tests)

- **Test:** `[P0] should always inject userId into filters`
  - **Status:** RED (skipped) — `searchDocuments` does not accept `userId` parameter yet
  - **Verifies:** AC4, AC5 — userId is always present in filters sent to API

- **Test:** `[P0] should merge userId with caller-provided filters`
  - **Status:** RED (skipped) — `searchDocuments` does not accept `userId` parameter yet
  - **Verifies:** AC4 — caller filters merged (not replaced) with userId

- **Test:** `[P0] should not allow caller to override userId filter`
  - **Status:** RED (skipped) — `searchDocuments` does not accept `userId` parameter yet
  - **Verifies:** AC4, AC5 — server-side userId always takes precedence

---

## Mock Requirements

### Cloudflare AI Search Upsert API

**Endpoint:** `POST https://api.cloudflare.com/client/v4/accounts/{accountId}/ai-search/instances/{instance}/documents/upsert`

**Success Response:**
```json
{ "success": true }
```

**Failure Response (503):**
```json
"Service Unavailable"
```

**Notes:** Mocked via `vi.stubGlobal('fetch', ...)` in Convex action tests. Actions use `process.env` for config (CF_ACCOUNT_ID, CLOUDFLARE_AI_SEARCH_INSTANCE, CLOUDFLARE_AI_SEARCH_TOKEN).

---

## Implementation Checklist

### Test: `[P0] should extract text from PDF and update status to success`

**File:** `convex/documentActions.test.ts`

**Tasks to make this test pass:**

- [ ] Create `convex/documentActions.ts` with `"use node";` directive
- [ ] Run `pnpm add pdf-parse` and `pnpm add -D @types/pdf-parse`
- [ ] Implement `ingestDocument` as `internalAction` with args: `documentId`, `fileId`, `userId`, `folderId`, `filename`
- [ ] Retrieve PDF via `ctx.storage.get(fileId)` → `blob.arrayBuffer()` → `Buffer.from()` → `pdfParse()`
- [ ] On success, upsert to Cloudflare AI Search and call `updateDocumentStatus` with `status: 'success'`
- [ ] Remove `test.skip()` and run: `pnpm test -- convex/documentActions.test.ts`

---

### Test: `[P0] should upsert to Cloudflare AI Search with correct metadata`

**File:** `convex/documentActions.test.ts`

**Tasks to make this test pass:**

- [ ] Build upsert request body: `{ documents: [{ id: documentId, text: extractedText, attributes: { userId, documentId, folderId, filename } }] }`
- [ ] POST to Cloudflare AI Search upsert endpoint with `Authorization: Bearer {token}`
- [ ] Read config from `process.env.CF_ACCOUNT_ID`, `process.env.CLOUDFLARE_AI_SEARCH_INSTANCE`, `process.env.CLOUDFLARE_AI_SEARCH_TOKEN`
- [ ] Remove `test.skip()` and run: `pnpm test -- convex/documentActions.test.ts`

---

### Test: `[P0] should fail with reason when PDF has no extractable text`

**File:** `convex/documentActions.test.ts`

**Tasks to make this test pass:**

- [ ] After `pdfParse(buffer)`, check if `result.text` is empty or whitespace-only
- [ ] If empty, call `updateDocumentStatus` with `status: 'failed'` and `failureReason: 'No extractable text detected — scanned or image-only PDF'`
- [ ] Return early (do not call Cloudflare API)
- [ ] Remove `test.skip()` and run: `pnpm test -- convex/documentActions.test.ts`

---

### Test: `[P0] should fail with error details when AI Search API returns error`

**File:** `convex/documentActions.test.ts`

**Tasks to make this test pass:**

- [ ] Wrap entire action handler in try/catch
- [ ] On fetch failure (non-ok response), call `updateDocumentStatus` with `status: 'failed'` and include HTTP status in `failureReason`
- [ ] Remove `test.skip()` and run: `pnpm test -- convex/documentActions.test.ts`

---

### Test: `[P1] should fail when file is not found in storage`

**File:** `convex/documentActions.test.ts`

**Tasks to make this test pass:**

- [ ] Check `ctx.storage.get(fileId)` result for null
- [ ] If null, throw `new Error('File not found in storage')` (caught by outer try/catch, which calls `updateDocumentStatus`)
- [ ] Remove `test.skip()` and run: `pnpm test -- convex/documentActions.test.ts`

---

### Test: `[P0] should schedule ingestDocument action after document creation`

**File:** `convex/documentActions.test.ts`

**Tasks to make this test pass:**

- [ ] In `convex/documents.ts`, import `internal` from `./_generated/api`
- [ ] After `ctx.db.insert(...)` in `createDocument`, add `await ctx.scheduler.runAfter(0, internal.documentActions.ingestDocument, { documentId: docId, fileId: args.fileId, userId, folderId: args.folderId, filename: args.filename })`
- [ ] Run `npx convex dev` to regenerate types
- [ ] Remove `test.skip()` and run: `pnpm test -- convex/documentActions.test.ts`

---

### Test: `[P0] should always inject userId into filters`

**File:** `server/utils/ai-search.test.ts`

**Tasks to make this test pass:**

- [ ] Add `userId: string` as required field in `AISearchParams` interface
- [ ] Inside `searchDocuments()`, always merge `userId` into filters: `const filters = { ...params.filters, userId: params.userId }`
- [ ] Ensure `ai_search_options.filters` always includes userId even when no other filters provided
- [ ] Remove `test.skip()` and run: `pnpm test -- server/utils/ai-search.test.ts`

---

### Test: `[P0] should merge userId with caller-provided filters`

**File:** `server/utils/ai-search.test.ts`

**Tasks to make this test pass:**

- [ ] Ensure `filters` object spreads caller filters first, then adds `userId` (so userId cannot be overridden)
- [ ] Remove `test.skip()` and run: `pnpm test -- server/utils/ai-search.test.ts`

---

### Test: `[P0] should not allow caller to override userId filter`

**File:** `server/utils/ai-search.test.ts`

**Tasks to make this test pass:**

- [ ] Confirm the merge order is `{ ...params.filters, userId: params.userId }` (userId last, wins over caller)
- [ ] Remove `test.skip()` and run: `pnpm test -- server/utils/ai-search.test.ts`

---

## Running Tests

```bash
# Run all tests (including new skipped tests)
pnpm test

# Run only convex action tests
pnpm test -- convex/documentActions.test.ts

# Run only AI search server utility tests
pnpm test -- server/utils/ai-search.test.ts

# Run tests in watch mode
pnpm test:watch

# Run with verbose output
pnpm test -- --reporter=verbose
```

---

## Red-Green-Refactor Workflow

### RED Phase (Complete)

**TEA Agent Responsibilities:**

- All 11 tests written and skipped (RED)
- Mock requirements documented (Cloudflare AI Search upsert API)
- Implementation checklist created mapping tests to code tasks

**Verification:**

```
Test Files  5 passed | 1 skipped (6)
     Tests  89 passed | 11 skipped (100)
```

All 11 new tests are skipped — they will fail when un-skipped because:
- `convex/documentActions.ts` does not exist yet (8 tests)
- `searchDocuments` does not accept `userId` parameter yet (3 tests)

---

### GREEN Phase (DEV Team - Next Steps)

**Recommended implementation order:**

1. Install `pdf-parse` dependency
2. Create `convex/documentActions.ts` with `ingestDocument` internal action
3. Un-skip and pass: PDF extraction + status update test
4. Un-skip and pass: Cloudflare upsert metadata test
5. Un-skip and pass: Empty text handling test
6. Un-skip and pass: API error handling test
7. Un-skip and pass: Missing file test
8. Un-skip and pass: Auth header test
9. Add scheduler call to `createDocument` in `convex/documents.ts`
10. Un-skip and pass: Scheduling tests
11. Modify `searchDocuments` in `server/utils/ai-search.ts` to require `userId`
12. Un-skip and pass: userId enforcement tests

---

### REFACTOR Phase (After All Tests Pass)

1. Verify all 100 tests pass (89 existing + 11 new)
2. Review error messages for clarity
3. Ensure no duplicate code between action and server utility
4. Run `pnpm test` one final time

---

## Next Steps

1. **Run failing tests** to confirm RED phase: `pnpm test`
2. **Begin implementation** following the order in GREEN phase above
3. **Work one test at a time** (un-skip → implement → verify green)
4. **Set Convex env vars** via `npx convex env set CF_ACCOUNT_ID ...` etc.
5. **When all tests pass**, manually update story status in sprint-status.yaml

---

## Knowledge Base References Applied

- **data-factories.md** — Factory pattern with `@faker-js/faker` for test data generation
- **test-quality.md** — Deterministic, isolated, explicit test design principles
- **test-healing-patterns.md** — Mock patterns for external API calls

---

## Test Execution Evidence

### Initial Test Run (RED Phase Verification)

**Command:** `pnpm test`

**Results:**

```
Test Files  5 passed | 1 skipped (6)
     Tests  89 passed | 11 skipped (100)
  Duration  315ms
```

**Summary:**

- Total tests: 100
- Passing: 89 (existing)
- Skipped: 11 (new RED phase tests)
- Status: RED phase verified

---

## Notes

- `convex/documentActions.ts` MUST use `"use node";` directive — it uses `pdf-parse` which requires Node.js `Buffer` API
- The existing `convex/documents.ts` MUST NOT get a `"use node"` directive — it has queries and mutations
- `userId` in the ingestion action comes from the mutation that schedules it (derived from `ctx.auth.getUserIdentity().tokenIdentifier`), NOT from client input
- Cloudflare AI Search handles chunking/embedding — send full document text as single document
- AC6 (real-time UI update) is already covered by Story 3.1 Convex subscriptions — no new test needed

---

**Generated by BMad TEA Agent** - 2026-04-11
