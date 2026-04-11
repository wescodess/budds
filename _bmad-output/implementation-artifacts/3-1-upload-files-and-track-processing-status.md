# Story 3.1: Upload Files and Track Processing Status

Status: done

## Story

As a student,
I want to drag and drop PDFs into a folder and see their processing status,
So that I know which materials are ready for AI-powered study.

## Acceptance Criteria

1. **Given** a user viewing a folder at `/app/folders/[id]`
   **When** they drag PDF files onto the FileUploadZone (or click to browse)
   **Then** each file is immediately acknowledged in a file list with "Processing" status (amber spinner)
   **And** the files are validated server-side for type (PDF only) and size (max 50MB)
   **And** invalid files are rejected with a specific error message (e.g., "Only PDF files are supported", "File exceeds 50MB limit")

2. **Given** files are accepted
   **When** the upload completes
   **Then** each file is stored in Convex file storage
   **And** a document record is created in the Convex `documents` table with fields: `userId`, `folderId`, `filename`, `fileId` (storage reference `Id<"_storage">`), `status` ("processing"), `fileSize`, and Convex's `_creationTime` for upload date
   **And** the `documents` table has indexes on `by_userId`, `by_folderId`, and `by_status`

3. **Given** a user viewing a folder with documents
   **When** the document list renders
   **Then** each document shows filename, upload date, processing status, and file size via the FileStatusItem component
   **And** the list updates in real-time via Convex subscription as status changes

4. **Given** the FileUploadZone component on desktop
   **When** rendered
   **Then** it shows a dashed-border drop zone with "Drag PDFs here or browse" text
   **And** the border changes to solid with a subtle background tint on drag-over
   **And** it is keyboard activatable with `role="button"`

5. **Given** the FileUploadZone on mobile
   **When** rendered
   **Then** it shows a tap-to-browse button (no drag-and-drop)

6. **Given** the Progress and Alert shadcn components are needed
   **When** this story is implemented
   **Then** they are already scaffolded and available — no scaffolding required

## Tasks / Subtasks

- [x] Task 1: Add `documents` table to Convex schema (AC: #2)
  - [x] Add `documents` table in `convex/schema.ts` with fields: `userId: v.string()`, `folderId: v.id('folders')`, `filename: v.string()`, `fileId: v.id('_storage')`, `status: v.union(v.literal('processing'), v.literal('success'), v.literal('failed'))`, `fileSize: v.number()`, `failureReason: v.optional(v.string())`
  - [x] Add indexes: `by_userId` (`['userId']`), `by_folderId` (`['folderId']`), `by_userId_and_folderId` (`['userId', 'folderId']`), `by_status` (`['status']`)

- [x] Task 2: Create `convex/documents.ts` with upload mutations and queries (AC: #2, #3)
  - [x] Add `generateUploadUrl` mutation — calls `ctx.storage.generateUploadUrl()`, returns short-lived URL. Auth-gated: validates `ctx.auth.getUserIdentity()` before generating
  - [x] Add `createDocument` mutation — args: `folderId: v.id('folders')`, `filename: v.string()`, `fileId: v.id('_storage')`, `fileSize: v.number()`. Derives `userId` from `ctx.auth.getUserIdentity().tokenIdentifier`. Validates folder ownership (folder.userId === userId). Creates record with `status: 'processing'`. Returns `Id<'documents'>`
  - [x] Add `listDocumentsByFolder` query — args: `folderId: v.id('folders')`. Auth-gated, returns documents for the folder owned by the authenticated user using `by_userId_and_folderId` index. Ordered by `_creationTime` desc
  - [x] Add `updateDocumentStatus` internal mutation — args: `id: v.id('documents')`, `status`, `failureReason: v.optional(v.string())`. Used by the ingestion pipeline (Story 3.2) to update status. Internal-only, not exposed to clients

- [x] Task 3: Increment/decrement `documentCount` on folders (AC: #2)
  - [x] In `createDocument` mutation, after inserting the document, `ctx.db.patch(args.folderId, { documentCount: folder.documentCount + 1, updatedAt: Date.now() })`
  - [x] Export a `deleteDocument` mutation stub that decrements `documentCount` — full implementation in Story 3.3, but the decrement mechanism should exist

- [x] Task 4: Create `useDocuments` composable (AC: #2, #3)
  - [x] Create `app/composables/useDocuments.ts`
  - [x] Bind `generateUploadUrl` mutation via `useConvexMutation(api.documents.generateUploadUrl)`
  - [x] Bind `createDocument` mutation via `useConvexMutation(api.documents.createDocument)`
  - [x] Bind `listDocumentsByFolder` query via `useConvexQuery(api.documents.listDocumentsByFolder, computed(() => ({ folderId })))` — reactive to folderId
  - [x] Implement `uploadFiles(files: File[], folderId)` function: for each file, validate client-side (PDF type, 50MB size), call `generateUploadUrl`, POST file blob to the URL, call `createDocument` with the returned `storageId`. Use `convexAuthReady` guard pattern from `useFolders.ts`
  - [x] Track upload state: `uploading: Ref<boolean>`, `uploadProgress: Ref<Map<string, 'pending' | 'uploading' | 'done' | 'error'>>` per filename

- [x] Task 5: Create `FileUploadZone.vue` component (AC: #1, #4, #5)
  - [x] Create `app/components/documents/FileUploadZone.vue`
  - [x] Props: `folderId: Id<'folders'>`, `disabled?: boolean`
  - [x] Emits: `upload(files: File[])`
  - [x] Desktop: dashed-border drop zone with `Upload` icon and "Drag PDFs here or browse" text. On drag-over: solid border with `bg-primary/5` tint. Hidden file input triggered on click
  - [x] Mobile: `UiButton` with "Upload PDFs" text (no drag-and-drop)
  - [x] `role="button"`, `tabindex="0"`, `aria-label="Upload PDF files"`, keyboard activatable (Enter/Space opens file picker)
  - [x] File input accepts `.pdf` only (`accept="application/pdf"`)
  - [x] On file selection: validate each file (type check, 50MB max), emit `upload` with valid files, show toast for rejected files with specific reason

- [x] Task 6: Create `FileStatusItem.vue` component (AC: #3)
  - [x] Create `app/components/documents/FileStatusItem.vue`
  - [x] Props: `filename: string`, `status: 'processing' | 'success' | 'failed'`, `fileSize: number`, `createdAt: number`, `failureReason?: string`
  - [x] Processing state: amber `Loader2` spinner (animate-spin), filename, size formatted (KB/MB)
  - [x] Success state: green `CheckCircle2` icon, filename, size, upload date
  - [x] Failed state: red `XCircle` icon, filename, error message from `failureReason`
  - [x] Use `aria-live="polite"` on the status region so screen readers announce status changes

- [x] Task 7: Integrate upload zone and document list into folder detail page (AC: #1, #3, #4)
  - [x] Update `app/pages/app/folders/[id].vue` to import `useDocuments` composable
  - [x] Add `FileUploadZone` above the document list area
  - [x] Replace the empty state placeholder with a conditional: show `FileUploadZone` + empty message when no documents, show `FileUploadZone` + document list when documents exist
  - [x] Render `FileStatusItem` for each document from `listDocumentsByFolder` query (real-time via Convex subscription)
  - [x] Wire `@upload` handler: call `useDocuments().uploadFiles(files, folderId)`, show toast on error

- [x] Task 8: Write Convex integration tests (AC: #1, #2, #3) — ATDD: tests pre-written by TEA agent
  - [x] `generateUploadUrl`: rejects unauthenticated, returns URL string for authenticated user
  - [x] `createDocument`: creates document with correct fields, sets status to 'processing', increments folder `documentCount`, rejects if folder doesn't belong to user, rejects unauthenticated
  - [x] `listDocumentsByFolder`: returns documents for folder, returns empty for folder with no documents, respects user isolation (User A can't see User B's documents), rejects unauthenticated
  - [x] `updateDocumentStatus`: updates status to 'success', updates status to 'failed' with reason

- [x] Task 9: Write component tests (AC: #4, #5, #6) — ATDD: tests pre-written by TEA agent
  - [x] FileUploadZone: renders drop zone with correct text, renders mobile button variant, accepts PDF files, rejects non-PDF files
  - [x] FileStatusItem: renders processing state with spinner, renders success state with check icon, renders failed state with error message
  - [x] Folder detail page: renders upload zone and document list

## Dev Notes

### Convex Upload Flow (3-Step Pattern)

From spike findings — every file upload follows this sequence:
1. **Generate upload URL** — `generateUploadUrl` mutation calls `ctx.storage.generateUploadUrl()`, returns short-lived URL
2. **Client uploads file** — `fetch(uploadUrl, { method: 'POST', body: file, headers: { 'Content-Type': file.type } })` — returns `{ storageId }`
3. **Create document record** — `createDocument` mutation inserts document with the `storageId` as `fileId`

The upload happens client-side directly to Convex storage (no Nuxt server route needed). The Convex mutation handles auth and validation.

### Schema Design

```typescript
documents: defineTable({
  userId: v.string(),
  folderId: v.id('folders'),
  filename: v.string(),
  fileId: v.id('_storage'),
  status: v.union(v.literal('processing'), v.literal('success'), v.literal('failed')),
  fileSize: v.number(),
  failureReason: v.optional(v.string()),
})
  .index('by_userId', ['userId'])
  .index('by_folderId', ['folderId'])
  .index('by_userId_and_folderId', ['userId', 'folderId'])
  .index('by_status', ['status'])
```

### Auth Pattern (same as folders.ts)

```typescript
const identity = await ctx.auth.getUserIdentity()
if (!identity) throw new Error('Unauthenticated')
const userId = identity.tokenIdentifier
```

### File Storage Guidelines

- `ctx.storage.generateUploadUrl()` — only available in mutations
- `ctx.storage.get(storageId)` — returns Blob, only available in actions
- `ctx.storage.getUrl(storageId)` — returns signed URL, available in queries and mutations
- `ctx.storage.delete(storageId)` — available in mutations and actions
- File metadata: `ctx.db.system.get(storageId)` returns `{ _id, _creationTime, contentType, sha256, size }`
- Do NOT use deprecated `ctx.storage.getMetadata()`

### File Validation

- Client-side validation is cosmetic — always validate server-side in the mutation
- PDF type: check `contentType` from storage metadata after upload, or rely on client `accept` attribute + server check
- Size limit: 50MB (52,428,800 bytes). Check `file.size` client-side, verify via storage metadata server-side
- The `generateUploadUrl` mutation is auth-gated but doesn't validate file type — validation happens in `createDocument` after the blob is stored

### documentCount Denormalization

The `folders` table has a `documentCount` field that was created with default 0 in Epic 1. This story wires up the increment. Pattern:
```typescript
const folder = await ctx.db.get(args.folderId)
await ctx.db.patch(args.folderId, {
  documentCount: folder.documentCount + 1,
  updatedAt: Date.now(),
})
```

### Real-Time Updates

Convex subscriptions via `useConvexQuery` push updates automatically when document records change. The document list re-renders when `listDocumentsByFolder` result changes after upload or status update. No polling needed.

### Existing Composable Pattern (from useFolders.ts)

```typescript
const mutation = import.meta.client
  ? useConvexMutation(api.documents.createDocument)
  : { mutate: async (_args: any) => {}, isLoading: ref(false) }

const convexAuthReady = import.meta.client
  ? useNuxtApp().$convexAuthReady as Ref<boolean>
  : ref(true)

async function uploadFiles(files: File[], folderId: Id<'folders'>) {
  await until(convexAuthReady).toBe(true, { timeout: 5000 })
  // ... upload logic
}
```

### Story 3.2 Boundary

This story creates documents with `status: 'processing'` but does NOT implement the ingestion pipeline. Story 3.2 will:
- Add a `"use node"` action file (`convex/documentActions.ts`) for PDF parsing
- Schedule the ingestion action via `ctx.scheduler.runAfter(0, ...)` from `createDocument`
- Update document status to 'success' or 'failed' via `updateDocumentStatus`
- Upsert chunks to Cloudflare AI Search

The `updateDocumentStatus` internal mutation is created in this story so the schema and status transitions are ready for Story 3.2.

### Anti-Patterns to Avoid

- Do NOT accept `userId` as a function argument — derive from `ctx.auth.getUserIdentity()`
- Do NOT use `.filter()` in Convex queries — use `.withIndex()`
- Do NOT put `"use node"` in files with queries/mutations — Node actions go in separate files
- Do NOT use `ctx.db` inside actions — use `ctx.runQuery`/`ctx.runMutation`
- Do NOT create a Nuxt server API route for upload — Convex file storage handles it directly
- Do NOT use `<style>` blocks — Tailwind utility classes only
- Do NOT manually import Vue APIs — Nuxt auto-imports
- Do NOT use `window.prompt()` or `window.confirm()` — use shadcn components

### Existing shadcn Components Available

All needed components are already scaffolded — no new scaffolding required. Key components for this story:
- `Progress` (`app/components/ui/progress/`) — upload progress bar if needed
- `Alert` (`app/components/ui/alert/`) — file validation error messages
- `Badge` (`app/components/ui/badge/`) — status labels
- `Button` (`app/components/ui/button/`) — browse/upload trigger
- `Spinner` (`app/components/ui/spinner/`) — processing indicator
- `Skeleton` (`app/components/ui/skeleton/`) — loading states

### Test Patterns

Convex integration tests follow the pattern in `convex/folders.test.ts`:
```typescript
const t = convexTest(schema, modules)
const asUser = t.withIdentity(TEST_IDENTITY)
const folderId = await asUser.mutation(api.folders.createFolder, { name: 'Test' })
// Test document creation
const docId = await asUser.mutation(api.documents.createDocument, {
  folderId,
  filename: 'test.pdf',
  fileId: storageId, // from t.storage.store(blob)
  fileSize: 1024,
})
```

`convex-test` provides in-memory storage — use `t.storage.store()` to get a `storageId` for tests.

Component tests use `@nuxt/test-utils` with `mountSuspended`:
```typescript
import { mountSuspended } from '@nuxt/test-utils/runtime'
const wrapper = await mountSuspended(FileStatusItem, {
  props: { filename: 'test.pdf', status: 'processing', fileSize: 1024, createdAt: Date.now() }
})
expect(wrapper.text()).toContain('test.pdf')
```

### Project Structure Notes

- Convex functions: `convex/documents.ts` (new file — queries and mutations only)
- Composable: `app/composables/useDocuments.ts` (new file)
- Components: `app/components/documents/FileUploadZone.vue`, `app/components/documents/FileStatusItem.vue` (new directory and files)
- Page: `app/pages/app/folders/[id].vue` (modify existing)
- Tests: `convex/documents.test.ts` (new), `tests/component/documents/` (new directory)

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 3, Story 3.1]
- [Source: _bmad-output/planning-artifacts/architecture.md — Document Storage, Upload Flow, File Validation]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — FileUploadZone, FileStatusItem]
- [Source: _bmad-output/implementation-artifacts/epic-3-spike-findings.md — Convex File Storage + PDF Parsing spike]
- [Source: convex/_generated/ai/guidelines.md — File Storage, Schema, Function Registration]
- [Source: convex/schema.ts — Current schema with folders table]
- [Source: convex/folders.ts — Auth pattern, mutation pattern]
- [Source: app/composables/useFolders.ts — Composable pattern with convexAuthReady]
- [Source: app/pages/app/folders/[id].vue — Current folder detail page]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

N/A — no blocking issues encountered.

### Completion Notes List

- ATDD workflow: 29 tests pre-written by TEA agent in RED phase, all transitioned to GREEN
- Convex integration: 15/15 tests passing — schema, mutations, queries, internal mutation, delete stub
- Component tests: 14/14 tests passing — FileUploadZone (8), FileStatusItem (6)
- Page integration tests: 3/3 tests passing — upload zone rendered, document list rendered, empty state handled
- No regressions: full existing test suite (89 integration + 34 component) passes
- Added `defineOptions({ name })` to both components for Nuxt auto-import compatibility with `findComponent({ name })` test pattern

### File List

- `convex/schema.ts` — modified: added `documents` table with 4 indexes
- `convex/documents.ts` — new: generateUploadUrl, createDocument, listDocumentsByFolder, updateDocumentStatus (internal), deleteDocument (stub)
- `app/composables/useDocuments.ts` — new: uploadFiles, documents query binding, upload progress tracking
- `app/components/documents/FileUploadZone.vue` — new: drag-and-drop upload zone with PDF validation
- `app/components/documents/FileStatusItem.vue` — new: processing/success/failed status display
- `app/pages/app/folders/[id].vue` — modified: integrated FileUploadZone + FileStatusItem + useDocuments

### Review Findings

- [x] [Review][Patch] No server-side file validation in `createDocument` — added `ctx.db.system.get()` check for contentType and size; uses verified `metadata.size` instead of client-reported fileSize
- [x] [Review][Patch] `deleteDocument` doesn't delete stored file blob — added `ctx.storage.delete(doc.fileId)` before DB record deletion
- [x] [Review][Patch] `useDocuments` skips `.error.value` check after mutations — added defensive error checks consistent with `useFolders.ts` pattern
- [x] [Review][Patch] Mobile FileUploadZone shows drop zone instead of button — added responsive variant: UiButton on mobile (`sm:hidden`), drop zone on desktop (`hidden sm:flex`)
- [x] [Review][Patch] `uploadProgress` map key collision on duplicate filenames — key changed to `${name}-${size}-${lastModified}`
- [x] [Review][Defer] `updateDocumentStatus` doesn't clear `failureReason` on non-failure transitions [convex/documents.ts:74-79] — deferred, pre-existing design limitation
- [x] [Review][Defer] `folderDepth` defaults to 1 while `allFolders` loads [app/pages/app/folders/[id].vue:15] — deferred, pre-existing from Epic 2

### Change Log

- 2026-04-11: Implemented Story 3.1 — upload files and track processing status. Added documents table, Convex CRUD, upload composable, FileUploadZone and FileStatusItem components, and folder page integration. All 29 ATDD tests pass.
- 2026-04-11: Code review completed — 5 patches, 2 deferred, 2 dismissed.
