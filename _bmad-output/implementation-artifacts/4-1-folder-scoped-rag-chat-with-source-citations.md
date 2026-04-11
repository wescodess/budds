# Story 4.1: Folder-Scoped RAG Chat with Source Citations

Status: review

## Story

As a student,
I want to ask questions about my uploaded materials and see answers with clickable source citations,
so that I can understand my course content and trust the AI's responses.

## Acceptance Criteria

1. **Given** a user in a folder with indexed documents
   **When** they type a question in the chat input and press Enter
   **Then** the query is sent to `POST /api/rag/chat` with the folder's `folderId`
   **And** the server calls `searchDocuments()` with both `userId` and `folderId` filters to retrieve relevant chunks
   **And** the retrieved chunks are assembled into a system prompt and sent to the LLM via AI Gateway
   **And** the response is displayed as a ChatMessage (assistant variant: bordered, left-aligned)

2. **Given** the AI response includes source passages
   **When** the response renders
   **Then** inline CitationBadge components appear as numbered references ([1], [2], etc.) within the response text
   **And** each badge is keyboard focusable with `role="button"` and `aria-label="Source [n] from [filename]"`

3. **Given** a user clicks or taps a CitationBadge
   **When** on desktop (>1024px)
   **Then** the collapsible source panel (w-72) opens on the right showing SourceCard components
   **And** the panel scrolls to the matching source passage
   **And** the matching SourceCard is highlighted

4. **Given** a user clicks a CitationBadge on mobile or tablet (<1024px)
   **When** the citation is tapped
   **Then** the source passage expands inline below the message as an expandable chip

5. **Given** a SourceCard component
   **When** rendered
   **Then** it displays the citation number, filename, relevance score badge, and passage text in monospace font
   **And** it has `aria-label="Source passage from [filename]"`

6. **Given** the user's chat input
   **When** rendered
   **Then** it supports Enter to send, Shift+Enter for newline, auto-grows to max 4 lines
   **And** the `/` keyboard shortcut focuses the input from anywhere in the app
   **And** empty submissions are prevented

7. **Given** a folder with no indexed documents
   **When** the user views the chat tab
   **Then** the chat shows an empty state: "Upload documents to start chatting"
   **And** the chat input is not active until documents are indexed (progressive availability)

## Tasks / Subtasks

- [x] Task 1: Fix folderId metadata in AI Search on document move — P0 prep item from Epic 3 retro (AC: prerequisite for all)
  - [x] Add `updateDocumentAiSearchMetadata` internalAction to `convex/documentActions.ts`
  - [x] Args: `documentId: v.string()`, `userId: v.string()`, `folderId: v.string()`, `filename: v.string()`
  - [x] Read the document's extracted text from R2 using the existing R2 client pattern (`r2Key` from the document record)
  - [x] Call the Cloudflare AI Search upsert endpoint to re-upsert with updated `folderId` attribute (same `documentId` key makes it idempotent)
  - [x] In `convex/documents.ts` `moveDocument` mutation, after patching folderId, schedule `updateDocumentAiSearchMetadata` via `ctx.scheduler.runAfter(0, ...)` only when `doc.status === 'success'`
  - [x] Log but do not throw on failure — move should succeed even if AI Search update fails

- [x] Task 2: Add folderId parameter to `POST /api/rag/chat` (AC: #1)
  - [x] In `server/api/rag/chat.post.ts`, add `folderId` as a required body parameter
  - [x] Pass `folderId` in the `filters` object to `searchDocuments()`: `{ folderId: body.folderId }`
  - [x] The existing userId enforcement in `searchDocuments()` merges both filters automatically
  - [x] Return `sources` array in the response with each source's `content`, `score`, and `attributes.filename`

- [x] Task 3: Create `ChatMessage.vue` component in `app/components/chat/` (AC: #1, #2)
  - [x] Props: `role: 'user' | 'assistant'`, `content: string`, `sources?: Source[]`
  - [x] User variant: `bg-muted` background, right-aligned
  - [x] Assistant variant: `border` + left-aligned, with inline CitationBadges
  - [x] Parse `[1]`, `[2]`, etc. tokens in assistant content and render as `CitationBadge` components
  - [x] Wrap the message list container in `role="log"` with `aria-label` per message

- [x] Task 4: Create `CitationBadge.vue` component in `app/components/chat/` (AC: #2, #3, #4)
  - [x] Props: `index: number`, `filename: string`
  - [x] Emits: `click(index: number)`
  - [x] Renders as an inline `<button>` styled as a small numbered pill (e.g., `[1]`)
  - [x] `role="button"`, `aria-label="Source [n] from [filename]"`, keyboard focusable
  - [x] On click, emit the citation index for the parent to handle (open panel on desktop, expand inline on mobile)

- [x] Task 5: Create `SourceCard.vue` component in `app/components/chat/` (AC: #5)
  - [x] Props: `index: number`, `filename: string`, `content: string`, `score: number`, `highlighted?: boolean`
  - [x] Display: citation number, filename, relevance score as `UiBadge` (e.g., "87%"), passage text in `font-mono`
  - [x] `aria-label="Source passage from [filename]"`
  - [x] When `highlighted`, apply a ring/border accent to visually distinguish the active source

- [x] Task 6: Create `SourcePanel.vue` component in `app/components/chat/` (AC: #3)
  - [x] Props: `sources: Source[]`, `activeCitationIndex: number | null`, `open: boolean`
  - [x] Emits: `close`
  - [x] Collapsible panel on the right side, `w-72`, slides in with transition
  - [x] Renders a `SourceCard` for each source
  - [x] When `activeCitationIndex` changes, scroll the matching SourceCard into view and set its `highlighted` prop
  - [x] Close button at top of panel

- [x] Task 7: Create `ChatInput.vue` component in `app/components/chat/` (AC: #6)
  - [x] Props: `disabled?: boolean`, `placeholder?: string`
  - [x] Emits: `submit(message: string)`
  - [x] `<textarea>` that auto-grows from 1 line to max 4 lines based on content
  - [x] Enter sends (calls emit), Shift+Enter inserts newline
  - [x] Empty/whitespace-only submissions prevented
  - [x] Expose a `focus()` method via `defineExpose` for the `/` keyboard shortcut
  - [x] Send button (primary style) on the right, disabled when input is empty

- [x] Task 8: Create `useChat` composable in `app/composables/useChat.ts` (AC: #1, #7)
  - [x] Accepts `folderId: Ref<string>` parameter
  - [x] Manages reactive state: `messages: Ref<ChatMessage[]>`, `loading: Ref<boolean>`, `error: Ref<string | null>`
  - [x] `sendMessage(query: string)` function: appends user message, calls `$fetch('/api/rag/chat', { method: 'POST', body: { query, model: DEFAULT_MODEL, folderId } })`, appends assistant message with sources
  - [x] Default model: `'openai/gpt-4o-mini'` (cheapest reasonable default — Story 4.3 adds model selection UI)
  - [x] `clearMessages()` function to reset conversation
  - [x] `hasIndexedDocuments` computed from `useDocuments` — check if any documents have `status === 'success'`
  - [x] Interface: `ChatMessage { role: 'user' | 'assistant'; content: string; sources?: Source[] }` and `Source { content: string; score: number; filename: string }`

- [x] Task 9: Add tab structure and chat view to `app/pages/app/folders/[id].vue` (AC: #1, #3, #4, #7)
  - [x] Scaffold `UiTabs` shadcn component if not already available
  - [x] Add `UiTabs` with two tabs: "Chat" (default active) and "Documents"
  - [x] "Documents" tab contains existing upload zone + document list (move existing content into this tab)
  - [x] "Chat" tab contains the chat interface: `ChatMessage` list in a `UiScrollArea`, `ChatInput` at bottom fixed
  - [x] On desktop (>1024px), render `SourcePanel` to the right of the chat area
  - [x] On mobile (<1024px), hide SourcePanel — citations expand inline below messages as expandable chips
  - [x] Use `useMediaQuery` from VueUse to detect breakpoint: `useMediaQuery('(min-width: 1024px)')`
  - [x] Register global `/` keyboard shortcut via `onKeydown` to focus the ChatInput (only when chat tab is active and not typing in another input)
  - [x] Wire `useChat(folderId)` composable — pass the route param `folderId`
  - [x] Empty state in chat tab: when `!hasIndexedDocuments`, show centered message "Upload documents to start chatting" with a muted icon, and disable the ChatInput
  - [x] Chat placeholder text: "Ask about your [folderName] materials..."
  - [x] Auto-scroll chat to bottom on new messages via `nextTick` + `scrollIntoView`

- [x] Task 10: Write server tests for folderId enforcement in chat endpoint (AC: #1)
  - [x] Test: chat request with valid folderId passes folderId in searchDocuments filters
  - [x] Test: chat request without folderId returns 400 error
  - [x] Test: searchDocuments called with both userId and folderId filters
  - [x] Follow existing test pattern in `server/utils/ai-search.test.ts`: stub globals, mock fetch

- [x] Task 11: Write component tests for ChatMessage, CitationBadge, SourceCard, ChatInput (AC: #2, #5, #6)
  - [x] ChatMessage: renders user vs assistant variants correctly, assistant messages contain CitationBadges when sources present
  - [x] CitationBadge: renders index number, emits click with index, has correct aria-label
  - [x] SourceCard: renders filename, score, content in monospace, highlighted state applies ring
  - [x] ChatInput: Enter triggers submit emit, Shift+Enter inserts newline, empty submission prevented, disabled state
  - [x] Follow existing component test pattern: `@nuxt/test-utils` with `mountSuspended`

- [x] Task 12: Write Convex test for `updateDocumentAiSearchMetadata` action (AC: prerequisite)
  - [x] Test: action calls correct Cloudflare AI Search upsert endpoint with updated folderId
  - [x] Test: action does not throw on API failure (logs instead)
  - [x] Test: `moveDocument` schedules metadata update only for `status === 'success'` documents
  - [x] Follow existing pattern in `convex/documentActions.test.ts`

## Dev Notes

### Scope Boundaries

This story implements **non-streaming, folder-scoped RAG chat** with citation UI components. It does NOT include:
- Streaming responses (Story 4.2)
- Model selection UI (Story 4.3 — use hardcoded default model)
- Chat history persistence to Convex (Story 4.4 — messages live in Vue reactive state only, lost on refresh)
- Conversation management (Story 4.4)

### P0 Prerequisite: folderId Metadata Fix

The Epic 3 retro identified a P0 prep item: when `moveDocument` runs, the `folderId` attribute in Cloudflare AI Search is not updated. Folder-scoped search depends on this attribute being accurate. Task 1 fixes this before the chat feature is wired up.

The approach: use the existing R2 key stored on the document record to retrieve the extracted text, then re-upsert to AI Search with updated folderId. The upsert endpoint is idempotent by document ID.

### Existing Code to Modify

- `server/api/rag/chat.post.ts` — add required `folderId` body param, pass to searchDocuments filters
- `convex/documentActions.ts` — add `updateDocumentAiSearchMetadata` internalAction (Node.js runtime, `"use node"`)
- `convex/documents.ts` — update `moveDocument` to schedule metadata update for `status === 'success'` docs
- `app/pages/app/folders/[id].vue` — add tab structure, mount chat interface in Chat tab

### New Files to Create

- `app/components/chat/ChatMessage.vue`
- `app/components/chat/CitationBadge.vue`
- `app/components/chat/SourceCard.vue`
- `app/components/chat/SourcePanel.vue`
- `app/components/chat/ChatInput.vue`
- `app/composables/useChat.ts`

### Citation Parsing Strategy

The LLM system prompt must instruct the model to include inline numbered references like `[1]`, `[2]` corresponding to source chunks. The ChatMessage component parses the response content string, splits on `[N]` patterns, and renders `CitationBadge` components inline within the text flow.

System prompt addition for chat.post.ts:
```
When citing sources, use inline numbered references like [1], [2], etc. corresponding to the provided source passages. Each number maps to the source passage at that index.
```

### Responsive Citation Pattern

- **Desktop (>1024px):** CitationBadge click opens/scrolls the SourcePanel (side panel, w-72). Multiple sources visible simultaneously for comparison.
- **Mobile (<1024px):** CitationBadge click toggles an expandable chip directly below the message showing the source passage inline. Only one source expanded at a time (accordion behavior).

Use `useMediaQuery('(min-width: 1024px)')` from VueUse to switch between panel and inline modes.

### Default Model

Use `'openai/gpt-4o-mini'` as the default model for all chat requests in this story. The existing `chat.post.ts` endpoint already handles the `model` parameter. Story 4.3 adds the model selection UI.

### Existing Patterns to Follow

- **Convex actions with external APIs:** Follow `ingestDocument` in `convex/documentActions.ts` — `"use node"` directive, read env vars from `process.env`, use `ctx.runMutation` for DB updates
- **Composable pattern:** Follow `useDocuments.ts` — accepts reactive folderId, uses `$fetch` for API calls, manages loading/error refs
- **Component pattern:** Follow `FileStatusItem.vue` — Tailwind classes, `cn()` utility, emit pattern, no `<style>` blocks
- **Test pattern (server):** Follow `server/utils/ai-search.test.ts` — `vi.stubGlobal` for runtime config and fetch
- **Test pattern (component):** Follow `tests/component/documents/file-status-item.test.ts` — `mountSuspended`, `mockNuxtImport`
- **Test pattern (Convex):** Follow `convex/documentActions.test.ts` — `convexTest(schema, modules)`, `t.withIdentity()`

### Anti-Patterns to Avoid

- Do NOT use `.filter()` in Convex queries — use `.withIndex()`
- Do NOT put `"use node"` in `convex/documents.ts` — it has queries and mutations (actions go in `documentActions.ts`)
- Do NOT call Cloudflare APIs from client code — always proxy through Nitro server routes
- Do NOT add `<style>` blocks — Tailwind utility classes only
- Do NOT manually import Vue APIs (`ref`, `computed`, `watch`, `onMounted`) — they are auto-imported
- Do NOT create a `types/` directory — co-locate interfaces in the files that use them
- Do NOT trust userId from request body — extract from auth session via `getConvexTokenIdentifier(event)`
- Do NOT add model selection UI — that is Story 4.3

### Tab Implementation Notes

The folder page currently shows documents directly. This story restructures it with `UiTabs`:
- Scaffold tabs: `npx shadcn-vue@latest add tabs` (if not already available)
- "Chat" tab is the default active tab
- "Documents" tab contains the existing file upload zone and document list (move, don't duplicate)
- Future stories (4.3, V1.1) will add more tabs (Quiz, Flash Cards)
- Tab state is local (no URL sync needed for now — Story 4.4 may add URL-based tab routing)

### Empty State Logic

```typescript
const hasIndexedDocuments = computed(() =>
  documents.value?.some(d => d.status === 'success') ?? false
)
```

When `!hasIndexedDocuments`:
- Chat tab shows centered empty state with muted icon and "Upload documents to start chatting"
- ChatInput is rendered but with `disabled` prop — visually indicates the feature exists but isn't available yet
- When a document finishes indexing, the chat becomes active automatically (Convex subscription triggers re-evaluation)

### Project Structure Notes

All new chat components go in `app/components/chat/` — consistent with existing `app/components/documents/` and `app/components/folders/` directories. The composable goes in `app/composables/useChat.ts` following the `use{Feature}.ts` pattern.

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 4, Story 4.1 acceptance criteria]
- [Source: _bmad-output/planning-artifacts/architecture.md — API Communication Patterns, Frontend Architecture, Per-User Isolation]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — ChatMessage, CitationBadge, SourceCard component specs, responsive layout]
- [Source: _bmad-output/implementation-artifacts/epic-3-retro-2026-04-11.md — P0 prep items for Epic 4]
- [Source: _bmad-output/implementation-artifacts/3-3-delete-documents-and-move-between-folders.md — moveDocument pattern, AI Search metadata gap]
- [Source: _bmad-output/implementation-artifacts/epic-3-spike-findings.md — Cloudflare AI Search upsert API, test patterns]
- [Source: server/api/rag/chat.post.ts — Current chat endpoint implementation]
- [Source: server/utils/ai-search.ts — searchDocuments() with userId enforcement]
- [Source: app/composables/useRag.ts — Existing chat composable pattern]
- [Source: app/pages/app/folders/[id].vue — Current folder page structure]
- [Source: convex/_generated/ai/guidelines.md — Convex function patterns]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

None

### Completion Notes List

- All 12 tasks implemented following ATDD RED→GREEN cycle
- 32 ATDD tests enabled and passing (7 server/Convex + 25 component)
- Task 1: Added `updateDocumentAiSearchMetadata` internalAction to fix folderId in AI Search on document move
- Task 2: Added folderId as required param to `POST /api/rag/chat`, passed to searchDocuments filters
- Tasks 3-7: Created 5 chat UI components (ChatMessage, CitationBadge, SourceCard, SourcePanel, ChatInput)
- Task 8: Created `useChat` composable with folder-scoped RAG integration and default model `openai/gpt-4o-mini`
- Task 9: Restructured folder page with UiTabs (Chat default, Documents), responsive citation layout, `/` keyboard shortcut
- Tasks 10-12: All ATDD tests enabled and passing
- Fixed 4 regression tests in folder-view and folder-documents test files (tab restructure required `flushPromises()` + `useChat` mock)
- Pre-existing failures in `convex/documentActions.test.ts` (8 tests, pdf-parse vs unpdf mock mismatch) documented but not in scope

### File List

New files:
- `app/components/chat/ChatMessage.vue`
- `app/components/chat/CitationBadge.vue`
- `app/components/chat/SourceCard.vue`
- `app/components/chat/SourcePanel.vue`
- `app/components/chat/ChatInput.vue`
- `app/composables/useChat.ts`
- `convex/documentActions.metadata.test.ts`
- `server/api/rag/chat.post.test.ts`
- `tests/component/chat/chat-message.test.ts`
- `tests/component/chat/citation-badge.test.ts`
- `tests/component/chat/source-card.test.ts`
- `tests/component/chat/source-panel.test.ts`
- `tests/component/chat/chat-input.test.ts`
- `tests/support/factories/chat.factory.ts`
- `_bmad-output/test-artifacts/atdd-checklist-4-1.md`

Modified files:
- `convex/documentActions.ts` — added `updateDocumentAiSearchMetadata` internalAction
- `convex/documents.ts` — `moveDocument` schedules AI Search metadata update for `status === 'success'` docs
- `server/api/rag/chat.post.ts` — added folderId validation, citation system prompt, sources in response
- `app/pages/app/folders/[id].vue` — restructured with UiTabs, chat interface, responsive citations
- `tests/component/folders/folder-view.test.ts` — adapted for tab structure, added useChat/useDocuments mocks
- `tests/component/documents/folder-documents.test.ts` — adapted for tab structure, added useChat mock
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — status updates
- `_bmad-output/implementation-artifacts/4-1-folder-scoped-rag-chat-with-source-citations.md` — task checkboxes, status, dev record
