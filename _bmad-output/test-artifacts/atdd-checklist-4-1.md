---
stepsCompleted: ['step-01-preflight-and-context', 'step-02-generation-mode', 'step-03-test-strategy', 'step-04c-aggregate', 'step-05-validate-and-complete']
lastStep: 'step-05-validate-and-complete'
lastSaved: '2026-04-11'
workflowType: 'testarch-atdd'
inputDocuments:
  - '_bmad-output/implementation-artifacts/4-1-folder-scoped-rag-chat-with-source-citations.md'
  - '_bmad-output/project-context.md'
  - 'server/api/rag/chat.post.ts'
  - 'server/utils/ai-search.ts'
  - 'convex/documentActions.ts'
  - 'convex/documents.ts'
  - 'app/pages/app/folders/[id].vue'
  - 'app/composables/useDocuments.ts'
---

# ATDD Checklist - Epic 4, Story 4.1: Folder-Scoped RAG Chat with Source Citations

**Date:** 2026-04-11
**Author:** palmwine
**Primary Test Level:** Component + Server Integration

---

## Story Summary

A student wants to ask questions about uploaded materials and see answers with clickable source citations to understand course content and trust AI responses.

**As a** student
**I want** to ask questions about my uploaded materials and see answers with clickable source citations
**So that** I can understand my course content and trust the AI's responses

---

## Acceptance Criteria

1. Chat query sent to `POST /api/rag/chat` with folderId, searchDocuments with userId+folderId, response rendered as ChatMessage
2. Inline CitationBadge components as numbered references, keyboard focusable with correct aria-label
3. Desktop: SourcePanel opens on citation click, scrolls to matching source
4. Mobile: source expands inline below message as expandable chip
5. SourceCard displays citation number, filename, relevance score badge, passage text in monospace
6. ChatInput: Enter sends, Shift+Enter newline, auto-grows, `/` shortcut, empty prevention
7. Empty state when no indexed documents, chat input disabled until documents indexed

**Prerequisite:** folderId metadata in AI Search updated on document move

---

## Failing Tests Created (RED Phase)

### Server Tests (4 tests)

**File:** `server/api/rag/chat.post.test.ts`

- **Test:** `[P0] should return 400 when folderId is missing from request body`
  - **Status:** RED — endpoint does not validate folderId as required
  - **Verifies:** AC #1 — folderId is required for folder-scoped search

- **Test:** `[P0] should pass folderId in searchDocuments filters when provided`
  - **Status:** RED — endpoint does not extract folderId from body and pass to filters
  - **Verifies:** AC #1 — folderId propagated to search layer

- **Test:** `[P0] should call searchDocuments with both userId and folderId filters`
  - **Status:** RED — folderId not wired through from body to searchDocuments
  - **Verifies:** AC #1 — per-user and per-folder isolation

- **Test:** `[P1] should return sources with content, score, and filename in response`
  - **Status:** RED — verifies response contract for citation rendering
  - **Verifies:** AC #1 — response shape for frontend consumption

### Convex Tests (3 tests)

**File:** `convex/documentActions.metadata.test.ts`

- **Test:** `[P0] should call Cloudflare AI Search upsert endpoint with updated folderId`
  - **Status:** RED — `updateDocumentAiSearchMetadata` action does not exist yet
  - **Verifies:** Prerequisite — metadata stays accurate after move

- **Test:** `[P0] should not throw when AI Search API returns an error`
  - **Status:** RED — action does not exist yet
  - **Verifies:** Prerequisite — move succeeds even if AI Search update fails

- **Test:** `[P0] should schedule metadata update when moving a document with status success`
  - **Status:** RED — moveDocument does not schedule metadata update
  - **Verifies:** Prerequisite — only indexed docs trigger metadata refresh

### Component Tests — ChatMessage (5 tests)

**File:** `tests/component/chat/chat-message.test.ts`

- **Test:** `[P0] should render user message with bg-muted and right-aligned`
  - **Status:** RED — ChatMessage.vue does not exist
  - **Verifies:** AC #1 — user variant styling

- **Test:** `[P0] should render assistant message with border and left-aligned`
  - **Status:** RED — ChatMessage.vue does not exist
  - **Verifies:** AC #1 — assistant variant styling

- **Test:** `[P0] should parse [1], [2] tokens into CitationBadge components in assistant messages`
  - **Status:** RED — ChatMessage.vue does not exist
  - **Verifies:** AC #2 — citation parsing and rendering

- **Test:** `[P1] should wrap message list in role="log" with aria-label`
  - **Status:** RED — ChatMessage.vue does not exist
  - **Verifies:** AC #1 — accessibility

- **Test:** `[P1] should not render CitationBadges for user messages even if sources provided`
  - **Status:** RED — ChatMessage.vue does not exist
  - **Verifies:** AC #2 — citations only on assistant messages

### Component Tests — CitationBadge (4 tests)

**File:** `tests/component/chat/citation-badge.test.ts`

- **Test:** `[P0] should render the citation index number as a pill`
  - **Status:** RED — CitationBadge.vue does not exist
  - **Verifies:** AC #2 — visual rendering

- **Test:** `[P0] should emit click event with the citation index when clicked`
  - **Status:** RED — CitationBadge.vue does not exist
  - **Verifies:** AC #3, #4 — parent handles panel/inline expansion

- **Test:** `[P0] should have correct aria-label with index and filename`
  - **Status:** RED — CitationBadge.vue does not exist
  - **Verifies:** AC #2 — accessibility contract

- **Test:** `[P0] should be keyboard focusable with role="button"`
  - **Status:** RED — CitationBadge.vue does not exist
  - **Verifies:** AC #2 — keyboard accessibility

### Component Tests — SourceCard (6 tests)

**File:** `tests/component/chat/source-card.test.ts`

- **Test:** `[P0] should render citation number, filename, and passage text`
  - **Status:** RED — SourceCard.vue does not exist
  - **Verifies:** AC #5 — core content rendering

- **Test:** `[P0] should render relevance score as a percentage badge`
  - **Status:** RED — SourceCard.vue does not exist
  - **Verifies:** AC #5 — score display

- **Test:** `[P0] should render passage text in monospace font`
  - **Status:** RED — SourceCard.vue does not exist
  - **Verifies:** AC #5 — monospace styling

- **Test:** `[P0] should have correct aria-label with filename`
  - **Status:** RED — SourceCard.vue does not exist
  - **Verifies:** AC #5 — accessibility

- **Test:** `[P1] should apply highlighted ring/border when highlighted prop is true`
  - **Status:** RED — SourceCard.vue does not exist
  - **Verifies:** AC #3 — active source visual distinction

- **Test:** `[P1] should not apply highlight ring when highlighted is false or absent`
  - **Status:** RED — SourceCard.vue does not exist
  - **Verifies:** AC #3 — default state

### Component Tests — ChatInput (6 tests)

**File:** `tests/component/chat/chat-input.test.ts`

- **Test:** `[P0] should emit submit with trimmed message when Enter is pressed`
  - **Status:** RED — ChatInput.vue does not exist
  - **Verifies:** AC #6 — Enter to send

- **Test:** `[P0] should insert newline on Shift+Enter instead of submitting`
  - **Status:** RED — ChatInput.vue does not exist
  - **Verifies:** AC #6 — Shift+Enter for newline

- **Test:** `[P0] should prevent empty or whitespace-only submissions`
  - **Status:** RED — ChatInput.vue does not exist
  - **Verifies:** AC #6 — input validation

- **Test:** `[P0] should disable textarea and send button when disabled prop is true`
  - **Status:** RED — ChatInput.vue does not exist
  - **Verifies:** AC #7 — progressive availability

- **Test:** `[P1] should disable send button when input is empty`
  - **Status:** RED — ChatInput.vue does not exist
  - **Verifies:** AC #6 — UX guard

- **Test:** `[P1] should expose focus() method via defineExpose`
  - **Status:** RED — ChatInput.vue does not exist
  - **Verifies:** AC #6 — `/` keyboard shortcut support

### Component Tests — SourcePanel (4 tests)

**File:** `tests/component/chat/source-panel.test.ts`

- **Test:** `[P0] should render a SourceCard for each source in the sources array`
  - **Status:** RED — SourcePanel.vue does not exist
  - **Verifies:** AC #3 — panel content

- **Test:** `[P0] should highlight the matching SourceCard when activeCitationIndex changes`
  - **Status:** RED — SourcePanel.vue does not exist
  - **Verifies:** AC #3 — scroll-to-source behavior

- **Test:** `[P1] should emit close when close button is clicked`
  - **Status:** RED — SourcePanel.vue does not exist
  - **Verifies:** AC #3 — panel dismissal

- **Test:** `[P1] should not render when open prop is false`
  - **Status:** RED — SourcePanel.vue does not exist
  - **Verifies:** AC #3 — collapsible behavior

---

## Data Factories Created

### Source / ChatMessage Factory

**File:** `tests/support/factories/chat.factory.ts`

**Exports:**

- `createSource(overrides?)` — Create a single source with content, score, filename
- `createSources(count, overrides?)` — Create array of sources
- `createChatMessage(overrides?)` — Create a chat message with random role
- `createAssistantMessage(overrides?)` — Create assistant message with citation tokens and sources
- `createUserMessage(overrides?)` — Create user message without sources

---

## Required data-testid Attributes

### ChatMessage Component
- `chat-message` — Outer wrapper for each message (carries role-specific classes)

### ChatInput Component
- `textarea` element (standard HTML, no testid needed)
- `button` element for send (standard HTML)

### SourcePanel Component
- `source-panel` — Panel container for visibility checks
- `source-panel-close` — Close button for the panel

### SourceCard Component
- `aria-label="Source passage from [filename]"` — Card container (ARIA selector, no testid needed)

### CitationBadge Component
- `role="button"` + `aria-label="Source [n] from [filename]"` — Badge element (ARIA selectors)

---

## Implementation Checklist

### Task 1: Add `updateDocumentAiSearchMetadata` action (Prerequisite)

**Tests:** `convex/documentActions.metadata.test.ts` — 3 tests

- [ ] Add `updateDocumentAiSearchMetadata` internalAction to `convex/documentActions.ts`
- [ ] Read extracted text from R2 using existing R2 client pattern
- [ ] Call Cloudflare AI Search upsert endpoint with updated folderId attribute
- [ ] Log but do not throw on failure
- [ ] Update `moveDocument` in `convex/documents.ts` to schedule metadata update for `status === 'success'` docs
- [ ] Remove `test.skip` from Convex tests
- [ ] Run: `pnpm test convex/documentActions.metadata.test.ts`

### Task 2: Add folderId parameter to `POST /api/rag/chat` (AC #1)

**Tests:** `server/api/rag/chat.post.test.ts` — 4 tests

- [ ] Add `folderId` as required body parameter in `server/api/rag/chat.post.ts`
- [ ] Return 400 if folderId is missing or empty
- [ ] Pass `{ folderId: body.folderId }` to searchDocuments filters
- [ ] Remove `test.skip` from server tests
- [ ] Run: `pnpm test server/api/rag/chat.post.test.ts`

### Task 3: Create ChatMessage.vue (AC #1, #2)

**Tests:** `tests/component/chat/chat-message.test.ts` — 5 tests

- [ ] Create `app/components/chat/ChatMessage.vue`
- [ ] Props: `role`, `content`, `sources?`
- [ ] User variant: `bg-muted`, right-aligned
- [ ] Assistant variant: `border`, left-aligned, with inline CitationBadges
- [ ] Parse `[N]` tokens in assistant content, render CitationBadge components
- [ ] Add `data-testid="chat-message"` and `aria-label` per message
- [ ] Remove `it.skip` from ChatMessage tests
- [ ] Run: `pnpm test:component tests/component/chat/chat-message.test.ts`

### Task 4: Create CitationBadge.vue (AC #2, #3, #4)

**Tests:** `tests/component/chat/citation-badge.test.ts` — 4 tests

- [ ] Create `app/components/chat/CitationBadge.vue`
- [ ] Props: `index`, `filename`
- [ ] Emits: `click(index)`
- [ ] Render as `<button>` pill with `role="button"`, `aria-label="Source [n] from [filename]"`
- [ ] Remove `it.skip` from CitationBadge tests
- [ ] Run: `pnpm test:component tests/component/chat/citation-badge.test.ts`

### Task 5: Create SourceCard.vue (AC #5)

**Tests:** `tests/component/chat/source-card.test.ts` — 6 tests

- [ ] Create `app/components/chat/SourceCard.vue`
- [ ] Props: `index`, `filename`, `content`, `score`, `highlighted?`
- [ ] Display citation number, filename, score as UiBadge percentage, passage in `font-mono`
- [ ] `aria-label="Source passage from [filename]"`
- [ ] Highlighted state applies `ring` class
- [ ] Remove `it.skip` from SourceCard tests
- [ ] Run: `pnpm test:component tests/component/chat/source-card.test.ts`

### Task 6: Create ChatInput.vue (AC #6)

**Tests:** `tests/component/chat/chat-input.test.ts` — 6 tests

- [ ] Create `app/components/chat/ChatInput.vue`
- [ ] Props: `disabled?`, `placeholder?`
- [ ] Emits: `submit(message)`
- [ ] `<textarea>` with auto-grow (1 to max 4 lines)
- [ ] Enter sends, Shift+Enter inserts newline
- [ ] Empty/whitespace submissions prevented
- [ ] Send button disabled when input empty
- [ ] Expose `focus()` via `defineExpose`
- [ ] Remove `it.skip` from ChatInput tests
- [ ] Run: `pnpm test:component tests/component/chat/chat-input.test.ts`

### Task 7: Create SourcePanel.vue (AC #3)

**Tests:** `tests/component/chat/source-panel.test.ts` — 4 tests

- [ ] Create `app/components/chat/SourcePanel.vue`
- [ ] Props: `sources`, `activeCitationIndex`, `open`
- [ ] Emits: `close`
- [ ] Collapsible panel, `w-72`, slides in
- [ ] Render SourceCard per source, highlight active, scroll into view
- [ ] Close button with `data-testid="source-panel-close"`
- [ ] Remove `it.skip` from SourcePanel tests
- [ ] Run: `pnpm test:component tests/component/chat/source-panel.test.ts`

### Task 8: Create useChat composable + wire folder page (AC #1, #7)

- [ ] Create `app/composables/useChat.ts`
- [ ] Accepts `folderId: Ref<string>`, manages messages/loading/error state
- [ ] `sendMessage()` calls `$fetch('/api/rag/chat', ...)` with folderId
- [ ] Default model: `'openai/gpt-4o-mini'`
- [ ] `hasIndexedDocuments` computed from useDocuments
- [ ] Add UiTabs to `app/pages/app/folders/[id].vue` (Chat + Documents tabs)
- [ ] Chat tab: ChatMessage list + ChatInput, empty state when no indexed docs
- [ ] Desktop: SourcePanel, Mobile: inline expansion
- [ ] Register `/` keyboard shortcut for ChatInput focus

---

## Running Tests

```bash
# Run all server + Convex tests for this story
pnpm test server/api/rag/chat.post.test.ts convex/documentActions.metadata.test.ts

# Run all component tests for this story
pnpm test:component tests/component/chat/

# Run a specific component test file
pnpm test:component tests/component/chat/chat-message.test.ts

# Run all tests in watch mode
pnpm test:watch
pnpm test:component:watch
```

---

## Red-Green-Refactor Workflow

### RED Phase (Complete)

- 32 tests written across 8 test files (all with `test.skip` / `it.skip`)
- 1 factory file created (`chat.factory.ts`)
- Tests cover all 7 acceptance criteria + prerequisite
- P0: 22 tests, P1: 10 tests

### GREEN Phase (DEV Team)

1. Pick one failing test from the implementation checklist (start with Task 1 — prerequisite)
2. Read the test to understand expected behavior
3. Implement minimal code to make the test pass
4. Remove `test.skip` / `it.skip` from that test
5. Run the test to verify it passes
6. Move to next test and repeat

### REFACTOR Phase (After All Tests Pass)

1. Verify all tests pass
2. Review code quality (Tailwind classes, composable patterns, error handling)
3. Run full test suite: `pnpm test && pnpm test:component`
4. Commit passing tests

---

## Notes

- This project uses **Vitest** (not Playwright/Cypress) for all test levels. Component tests use `@nuxt/test-utils` with `mountSuspended` and happy-dom
- No E2E browser tests — UI behavior validated at the component level
- The chat endpoint already returns `sources` in the response; Task 2 adds folderId as required and passes it explicitly to searchDocuments filters
- The UiTabs component is already scaffolded (`app/components/ui/tabs/`)
- Story 4.2 (streaming), 4.3 (model selection), and 4.4 (chat persistence) are out of scope

---

**Generated by BMad TEA Agent** - 2026-04-11
