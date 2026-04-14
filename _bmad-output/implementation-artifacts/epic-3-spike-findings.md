# Epic 3 Spike Findings

## Spike 1: Convex File Storage + PDF Parsing

### Upload Flow (3-Step Architecture)

1. **Generate upload URL** — Convex mutation calls `ctx.storage.generateUploadUrl()`, returns short-lived URL
2. **Client uploads file** — POST the file blob directly to the generated URL, receives `storageId` (`Id<"_storage">`)
3. **Create document record** — Convex mutation inserts document with `storageId`, schedules ingestion action via `ctx.scheduler.runAfter(0, ...)`

### Storage API by Function Type

| Context | store | get (blob) | getUrl | delete |
|---------|-------|-----------|--------|--------|
| Query | - | - | yes | - |
| Mutation | generateUploadUrl | - | yes | yes |
| Action | yes | yes | yes | yes |

### PDF Parsing

- Use `pdf-parse` (lightweight, text-only extraction) — install: `pnpm add pdf-parse`
- Requires `"use node";` directive at top of action file (Node.js runtime)
- Files with `"use node"` can ONLY contain actions, not queries/mutations
- Flow: `ctx.storage.get(storageId)` → `blob.arrayBuffer()` → `Buffer.from(arrayBuffer)` → `pdfParse(buffer)`

### Key Constraints

- Actions cannot use `ctx.db` directly — must use `ctx.runQuery`/`ctx.runMutation`
- File metadata: query `ctx.db.system.get("_storage", storageId)` instead of deprecated `ctx.storage.getMetadata()`
- Auth pattern unchanged: `ctx.auth.getUserIdentity().tokenIdentifier`

---

## Spike 2: Cloudflare AI Search Upsert

### Current State

- `server/utils/ai-search.ts` implements `searchDocuments()` (read-only)
- API: `POST .../ai-search/instances/{instance}/search` with Bearer token auth
- Response: `{ data: AISearchChunk[] }` where chunks have `id`, `content`, `score`, `attributes`

### Upsert API

Endpoint: `POST .../ai-search/instances/{instance}/documents/upsert`

Request:
```json
{
  "documents": [
    { "id": "docId_chunk_0", "text": "chunk content", "attributes": { ... } }
  ]
}
```

Same auth headers as search (Bearer token).

### Required Metadata Per Chunk

Every chunk MUST carry:
- `userId` — enforces per-user isolation
- `documentId` — links back to Convex document record
- `folderId` — enables folder-scoped search
- `filename` — source traceability for citations

### Isolation Enforcement

**On upsert:** Extract userId from authenticated Convex action context, inject into every chunk's attributes
**On search:** `searchDocuments()` must inject mandatory `userId` filter server-side — client cannot bypass

### Gap: searchDocuments userId filter

Current `searchDocuments()` passes filters through as-is from caller. Must be updated to require `userId` parameter and always inject it into the filter.

---

## Test Patterns for External Services

### Established Pattern (from ai-search.test.ts and ai-gateway.test.ts)

**Mock strategy: stub globals, mock fetch responses**

```typescript
vi.stubGlobal('useRuntimeConfig', vi.fn())
vi.stubGlobal('createError', (opts) => Object.assign(new Error(opts.message), { statusCode: opts.statusCode }))
vi.stubGlobal('fetch', vi.fn())
```

**Test structure:**
1. Mock `useRuntimeConfig` to return test config values
2. Mock `fetch` to return expected API response shape
3. Call the utility function
4. Assert on return value AND on fetch call args (URL, headers, body)
5. Test error paths: missing config, API errors, malformed responses

### Pattern for New Utilities

**`upsertDocumentsToAiSearch` tests should cover:**
- Valid upsert with correct endpoint URL and auth headers
- Chunk metadata (userId, documentId, folderId, filename) passed through correctly
- Missing config throws error
- API error response throws with status text
- Empty chunks array handled gracefully

**Convex action tests (using `convex-test`):**
- `convexTest(schema, modules)` for integration tests
- Test identity: `t.withIdentity(TEST_IDENTITY)`
- Actions that use `ctx.storage` — `convex-test` provides an in-memory storage backend
- Verify status transitions: processing → success, processing → failed

**What NOT to mock:**
- Convex storage in integration tests — `convex-test` handles this natively
- Schema validation — let Convex enforce it

**What to mock:**
- External HTTP calls (Cloudflare AI Search API) — always mock `fetch`
- PDF parsing in unit tests — provide test buffers rather than real PDFs
