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
  - _bmad-output/implementation-artifacts/3-1-upload-files-and-track-processing-status.md
  - _bmad/tea/config.yaml
  - convex/schema.ts
  - convex/folders.ts
  - convex/folders.test.ts
  - app/pages/app/folders/[id].vue
  - tests/support/factories/user.factory.ts
  - tests/support/factories/folder.factory.ts
---

# ATDD Checklist - Epic 3, Story 3.1: Upload Files and Track Processing Status

**Date:** 2026-04-11
**Author:** palmwine
**Primary Test Level:** Convex Integration + Component

---

## Story Summary

Students need to upload PDFs into folders and track their processing status in real-time. This story covers the upload flow (drag-and-drop / file picker), document record creation in Convex, and status display (processing/success/failed).

**As a** student
**I want** to drag and drop PDFs into a folder and see their processing status
**So that** I know which materials are ready for AI-powered study

---

## Acceptance Criteria

1. Drag-and-drop / file browse uploads with immediate "Processing" status, server-side validation (PDF only, 50MB max)
2. Files stored in Convex file storage, document records created with correct fields and indexes
3. Document list shows filename, upload date, status, file size — real-time via Convex subscriptions
4. Desktop: dashed-border drop zone with drag-over visual feedback, keyboard activatable
5. Mobile: tap-to-browse button (no drag-and-drop)
6. Progress and Alert shadcn components already scaffolded

---

## Test Strategy

| AC | Test Level | Priority | Rationale |
|----|-----------|----------|-----------|
| #2 — Document CRUD | Convex Integration | P0 | Data integrity, auth gating |
| #2 — documentCount | Convex Integration | P0 | Denormalized count must stay consistent |
| #3 — Query & listing | Convex Integration | P0 | Core data access pattern |
| #2 — Status updates | Convex Integration | P0 | Story 3.2 dependency |
| #1, #4 — Upload zone | Component | P0 | Primary user interaction |
| #3 — Status display | Component | P0 | User-facing status feedback |
| #5 — Mobile variant | Component | P1 | Responsive behavior |
| #7 — Page integration | Component | P0 | Wiring validation |

**Generation Mode:** AI Generation (clear ACs, standard CRUD + upload patterns)
**Stack Detected:** frontend (Nuxt/Vue + Convex BaaS)
**No E2E tests** — project does not have Playwright/Cypress configured

---

## Failing Tests Created (RED Phase)

### Convex Integration Tests (15 tests)

**File:** `convex/documents.test.ts` (348 lines)

- **Test:** `[P0] generateUploadUrl — should reject unauthenticated user`
  - **Status:** RED — `api.documents` module does not exist
  - **Verifies:** Auth gating on upload URL generation

- **Test:** `[P0] generateUploadUrl — should return URL string for authenticated user`
  - **Status:** RED — `api.documents` module does not exist
  - **Verifies:** Upload URL generation returns valid string

- **Test:** `[P0] createDocument — should create document with correct fields and status processing`
  - **Status:** RED — `api.documents` module does not exist
  - **Verifies:** Document record creation with all required fields

- **Test:** `[P0] createDocument — should reject unauthenticated user`
  - **Status:** RED — `api.documents` module does not exist
  - **Verifies:** Auth gating on document creation

- **Test:** `[P0] createDocument — should reject if folder does not belong to user`
  - **Status:** RED — `api.documents` module does not exist
  - **Verifies:** Folder ownership validation

- **Test:** `[P0] createDocument — should increment folder documentCount`
  - **Status:** RED — `api.documents` module does not exist
  - **Verifies:** Denormalized count consistency

- **Test:** `[P1] createDocument — should update folder updatedAt timestamp`
  - **Status:** RED — `api.documents` module does not exist
  - **Verifies:** Folder timestamp updates on document addition

- **Test:** `[P0] listDocumentsByFolder — should return documents for a given folder`
  - **Status:** RED — `api.documents` module does not exist
  - **Verifies:** Basic document listing

- **Test:** `[P0] listDocumentsByFolder — should return empty array for folder with no documents`
  - **Status:** RED — `api.documents` module does not exist
  - **Verifies:** Empty state handling

- **Test:** `[P0] listDocumentsByFolder — should respect user isolation`
  - **Status:** RED — `api.documents` module does not exist
  - **Verifies:** Cross-user data isolation

- **Test:** `[P0] listDocumentsByFolder — should reject unauthenticated user`
  - **Status:** RED — `api.documents` module does not exist
  - **Verifies:** Auth gating on document queries

- **Test:** `[P1] listDocumentsByFolder — should order documents by _creationTime desc`
  - **Status:** RED — `api.documents` module does not exist
  - **Verifies:** Newest-first ordering

- **Test:** `[P0] updateDocumentStatus — should update status to success`
  - **Status:** RED — `internal.documents` module does not exist
  - **Verifies:** Status transition for ingestion pipeline

- **Test:** `[P0] updateDocumentStatus — should update status to failed with reason`
  - **Status:** RED — `internal.documents` module does not exist
  - **Verifies:** Failed status with failure reason

- **Test:** `[P1] deleteDocument — should decrement folder documentCount`
  - **Status:** RED — `api.documents` module does not exist
  - **Verifies:** Count decrement stub for Story 3.3

### Component Tests (14 tests)

**File:** `tests/component/documents/file-upload-zone.test.ts` (120 lines)

- **Test:** `[P0] should render drop zone with drag text on desktop`
  - **Status:** RED — `FileUploadZone.vue` does not exist
  - **Verifies:** AC #4 — desktop drop zone rendering

- **Test:** `[P0] should have role="button" and be keyboard activatable`
  - **Status:** RED — component does not exist
  - **Verifies:** AC #4 — ARIA accessibility

- **Test:** `[P0] should have file input that accepts PDF only`
  - **Status:** RED — component does not exist
  - **Verifies:** AC #1 — file type restriction

- **Test:** `[P0] should emit upload event with valid PDF files`
  - **Status:** RED — component does not exist
  - **Verifies:** AC #1 — valid file acceptance

- **Test:** `[P0] should reject non-PDF files`
  - **Status:** RED — component does not exist
  - **Verifies:** AC #1 — invalid file rejection

- **Test:** `[P0] should reject files exceeding 50MB`
  - **Status:** RED — component does not exist
  - **Verifies:** AC #1 — size limit enforcement

- **Test:** `[P1] should show dashed border on initial render`
  - **Status:** RED — component does not exist
  - **Verifies:** AC #4 — visual design

- **Test:** `[P1] should be disabled when disabled prop is true`
  - **Status:** RED — component does not exist
  - **Verifies:** Disabled state behavior

**File:** `tests/component/documents/file-status-item.test.ts` (88 lines)

- **Test:** `[P0] should render processing state with spinner and filename`
  - **Status:** RED — `FileStatusItem.vue` does not exist
  - **Verifies:** AC #3 — processing state display

- **Test:** `[P0] should render success state with check icon`
  - **Status:** RED — component does not exist
  - **Verifies:** AC #3 — success state display

- **Test:** `[P0] should render failed state with error message`
  - **Status:** RED — component does not exist
  - **Verifies:** AC #3 — failed state with reason

- **Test:** `[P1] should format file size in KB for small files`
  - **Status:** RED — component does not exist
  - **Verifies:** AC #3 — file size formatting

- **Test:** `[P1] should format file size in MB for large files`
  - **Status:** RED — component does not exist
  - **Verifies:** AC #3 — file size formatting

- **Test:** `[P1] should have aria-live="polite" on status region`
  - **Status:** RED — component does not exist
  - **Verifies:** AC #3 — screen reader support

**File:** `tests/component/documents/folder-documents.test.ts` (80 lines)

- **Test:** `[P0] should render FileUploadZone component`
  - **Status:** RED — `useDocuments` composable does not exist
  - **Verifies:** AC #7 — upload zone integrated into page

- **Test:** `[P0] should render document list with FileStatusItem components`
  - **Status:** RED — composable does not exist
  - **Verifies:** AC #7 — document list rendering

- **Test:** `[P0] should show empty state with upload zone when no documents`
  - **Status:** RED — composable does not exist
  - **Verifies:** AC #7 — empty state with upload zone

---

## Data Factories Created

### Document Factory

**File:** `tests/support/factories/document.factory.ts`

**Exports:**

- `createDocument(overrides?)` — Create single document with optional overrides
- `createDocuments(count, overrides?)` — Create array of documents

**Example Usage:**

```typescript
const doc = createDocument({ filename: 'notes.pdf', status: 'success' })
const docs = createDocuments(5, { folderId: 'folder_123' })
```

---

## Fixtures Created

N/A — This project uses `convex-test` with `convexTest(schema, modules)` and `@nuxt/test-utils` with `mountSuspended`. No custom Playwright/Cypress fixtures needed.

---

## Mock Requirements

N/A — Convex integration tests use the in-memory `convex-test` runtime which provides real storage via `t.run(ctx => ctx.storage.store(...))`. Component tests use `mockNuxtImport` to mock composables.

---

## Required data-testid Attributes

### FileUploadZone.vue

- `role="button"` with `tabindex="0"` on the drop zone container
- `aria-label="Upload PDF files"` on the drop zone
- Hidden `<input type="file" accept="application/pdf">` element
- `border-dashed` class on the drop zone border

### FileStatusItem.vue

- `.animate-spin` class on the processing spinner icon
- `aria-live="polite"` on the status region

### Folder Detail Page ([id].vue)

- `FileUploadZone` component rendered above document list
- `FileStatusItem` components rendered for each document

---

## Implementation Checklist

### Test: generateUploadUrl + createDocument

**File:** `convex/documents.test.ts`

**Tasks to make these tests pass:**

- [ ] Add `documents` table to `convex/schema.ts` with fields: `userId`, `folderId`, `filename`, `fileId`, `status`, `fileSize`, `failureReason`
- [ ] Add indexes: `by_userId`, `by_folderId`, `by_userId_and_folderId`, `by_status`
- [ ] Create `convex/documents.ts`
- [ ] Implement `generateUploadUrl` mutation (auth-gated, calls `ctx.storage.generateUploadUrl()`)
- [ ] Implement `createDocument` mutation (auth-gated, validates folder ownership, sets status: 'processing', increments documentCount)
- [ ] Run test: `pnpm test -- convex/documents.test.ts`

### Test: listDocumentsByFolder

**File:** `convex/documents.test.ts`

**Tasks to make these tests pass:**

- [ ] Implement `listDocumentsByFolder` query (auth-gated, uses `by_userId_and_folderId` index, ordered by `_creationTime` desc)
- [ ] Run test: `pnpm test -- convex/documents.test.ts`

### Test: updateDocumentStatus (internal)

**File:** `convex/documents.test.ts`

**Tasks to make these tests pass:**

- [ ] Implement `updateDocumentStatus` as `internalMutation` (updates status and optional failureReason)
- [ ] Run test: `pnpm test -- convex/documents.test.ts`

### Test: deleteDocument (stub)

**File:** `convex/documents.test.ts`

**Tasks to make these tests pass:**

- [ ] Implement `deleteDocument` mutation stub (auth-gated, decrements folder documentCount)
- [ ] Run test: `pnpm test -- convex/documents.test.ts`

### Test: FileUploadZone component

**File:** `tests/component/documents/file-upload-zone.test.ts`

**Tasks to make these tests pass:**

- [ ] Create `app/components/documents/FileUploadZone.vue`
- [ ] Implement drop zone with dashed border, "Drag PDFs here or browse" text
- [ ] Add hidden file input with `accept="application/pdf"`
- [ ] Add `role="button"`, `tabindex="0"`, `aria-label="Upload PDF files"`
- [ ] Implement file validation (PDF type, 50MB max) and emit `upload` with valid files
- [ ] Add disabled prop support with `aria-disabled`
- [ ] Run test: `pnpm test:component -- tests/component/documents/file-upload-zone.test.ts`

### Test: FileStatusItem component

**File:** `tests/component/documents/file-status-item.test.ts`

**Tasks to make these tests pass:**

- [ ] Create `app/components/documents/FileStatusItem.vue`
- [ ] Implement processing state: amber `Loader2` with `.animate-spin`, filename, formatted size
- [ ] Implement success state: green `CheckCircle2`, filename, size, date
- [ ] Implement failed state: red `XCircle`, filename, failureReason
- [ ] Add `aria-live="polite"` on status region
- [ ] Implement file size formatting (KB/MB)
- [ ] Run test: `pnpm test:component -- tests/component/documents/file-status-item.test.ts`

### Test: Folder detail page integration

**File:** `tests/component/documents/folder-documents.test.ts`

**Tasks to make these tests pass:**

- [ ] Create `app/composables/useDocuments.ts` with `uploadFiles`, `documents` query binding
- [ ] Update `app/pages/app/folders/[id].vue` to import `useDocuments`
- [ ] Add `FileUploadZone` above document list
- [ ] Render `FileStatusItem` for each document
- [ ] Wire `@upload` handler to `useDocuments().uploadFiles()`
- [ ] Run test: `pnpm test:component -- tests/component/documents/folder-documents.test.ts`

---

## Running Tests

```bash
# Run all Convex integration tests for documents
pnpm test -- convex/documents.test.ts

# Run all component tests for documents
pnpm test:component -- tests/component/documents/

# Run a specific component test file
pnpm test:component -- tests/component/documents/file-upload-zone.test.ts

# Run all tests (integration + existing)
pnpm test

# Run all component tests
pnpm test:component
```

---

## Red-Green-Refactor Workflow

### RED Phase (Complete)

**TEA Agent Responsibilities:**

- All 29 tests written and failing
- Document factory created with auto-generated data
- Mock patterns documented (mockNuxtImport for composables)
- data-testid / ARIA requirements listed
- Implementation checklist created

**Verification:**

```
Convex Integration: 15 tests — 11 FAILED, 4 PASSED (false positive on auth rejection)
Component Tests:    14 tests — 14 FAILED
Total:              29 tests in RED phase
```

All tests fail because the implementation does not exist yet (TDD red phase). Failures are caused by missing modules, not test bugs.

---

### GREEN Phase (DEV Team — Next Steps)

1. Start with **Convex schema + documents.ts** (Tasks 1-3 from story)
2. After schema deploys, run `pnpm test -- convex/documents.test.ts` — tests should transition from module-not-found errors to meaningful assertion failures
3. Implement one function at a time until all Convex tests pass
4. Then create **components** (FileUploadZone, FileStatusItem)
5. Then create **useDocuments composable** and wire up the folder page
6. Run component tests after each component is created

---

### REFACTOR Phase (After All Tests Pass)

1. Verify all 29 tests pass
2. Review for code quality (Tailwind-only styles, no `<style>` blocks)
3. Ensure Convex anti-patterns are avoided (no `.filter()`, no `userId` as args)
4. Run full test suite: `pnpm test && pnpm test:component`

---

## Notes

- The 4 "passing" auth rejection tests in the Convex integration suite are false positives — they pass because the missing module throws an error which satisfies `rejects.toThrow()`. Once `convex/documents.ts` exists, they will test actual auth gating behavior.
- `updateDocumentStatus` uses `internal.documents.updateDocumentStatus` (internal mutation) — not exposed to clients. The ingestion pipeline (Story 3.2) will call it.
- `deleteDocument` is a stub for Story 3.3 — only the documentCount decrement is tested here.
- No E2E tests generated — project does not have Playwright or Cypress configured. Browser testing can be added in a future sprint if needed.

---

## Knowledge Base References Applied

- **data-factories.md** — Factory pattern for `document.factory.ts` with faker-based random data
- **component-tdd.md** — Component test patterns adapted for Vue/Nuxt `mountSuspended`
- **test-quality.md** — Deterministic tests, explicit assertions, isolation per test
- **test-levels-framework.md** — Integration tests for persistence/auth, component tests for UI behavior
- **test-priorities-matrix.md** — P0 for auth gating and data integrity, P1 for formatting and visual details

---

## Test Execution Evidence

### Initial Test Run (RED Phase Verification)

**Convex Integration:**

```
pnpm test -- convex/documents.test.ts

Test Files  1 failed (1)
     Tests  11 failed | 4 passed (15)
  Duration  1.56s

Error: Could not find module for: "documents"
```

**Component Tests:**

```
pnpm test:component -- tests/component/documents/

Test Files  3 failed (3)
     Tests  14 failed (14)
  Duration  13.39s

Error: Cannot find module '~/components/documents/FileUploadZone.vue'
Error: Cannot find module '~/components/documents/FileStatusItem.vue'
```

**Summary:**

- Total tests: 29
- Passing: 4 (false positive auth rejections)
- Failing: 25 (expected)
- Status: RED phase verified

---

**Generated by BMad TEA Agent** — 2026-04-11
