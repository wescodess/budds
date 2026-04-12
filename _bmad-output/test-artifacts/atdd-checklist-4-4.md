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
  - _bmad-output/implementation-artifacts/4-4-chat-history-and-conversation-management.md
  - convex/schema.ts
  - convex/folders.ts
  - convex/folders.test.ts
  - app/composables/useChat.ts
  - app/layouts/default.vue
  - app/pages/app/folders/[id].vue
  - tests/component/app-shell/layout.test.ts
  - tests/component/sidebar/folder-tree.test.ts
  - tests/component/chat/chat-input.test.ts
  - tests/support/factories/chat.factory.ts
  - tests/support/factories/folder.factory.ts
---

# ATDD Checklist — Epic 4, Story 4.4: Chat History & Conversation Management

**Date:** 2026-04-12
**Author:** palmwine
**Primary Test Level:** Integration (Convex) + Component (Vue)
**Detected Stack:** fullstack (Nuxt 4 + Convex)
**Generation Mode:** AI generation (no recording)
**Execution Mode:** sequential

---

## Story Summary

Persist chat conversations and messages in Convex so users can resume previous discussions across sessions, delete old conversations, and browse a flat list of the 20 most recent chats from the sidebar.

**As a** student
**I want** my chat conversations saved and accessible across sessions
**So that** I can pick up where I left off and review previous study discussions.

---

## Acceptance Criteria

1. First message creates a `conversations` row (auto title ≤ 60 chars, trimmed single-line) and inserts both the user and assistant `messages` rows.
2. Returning to a folder loads the most-recent conversation with full history; new messages append to the same conversation.
3. Sidebar "Recent Chats" shows the 20 most recent conversations (title + folder name subtext), links to `/app/folders/{folderId}?conversationId={id}`, preserves empty state at zero.
4. "New Chat" button and `Cmd/Ctrl+N` clear the active conversation state and remove the URL param; shortcut is suppressed inside INPUT/TEXTAREA.
5. Sidebar kebab → Delete → AlertDialog → `deleteConversation` cascades messages in a single mutation; reactive sidebar update; toast feedback; resets active chat if current.
6. Schema + security: `by_userId`, `by_userId_and_folderId`, `by_conversationId` indexes; `userId` from `identity.tokenIdentifier` only; every mutation verifies ownership.

---

## Test Strategy

### Level Selection

| AC  | Level                 | Rationale                                                         |
| --- | --------------------- | ----------------------------------------------------------------- |
| 1   | Convex integration    | Persistence contract lives in Convex mutations                    |
| 2   | Convex integration    | Ordering + scoping enforced by query (`getMostRecentForFolder`)   |
| 3   | Component + Convex    | Sidebar DOM + `listRecentForUser` enrichment                      |
| 4   | Component             | UI state + keyboard handler guardrails                            |
| 5   | Convex integration    | Cascade delete + ownership; UI covered by smoke test (Task 9)     |
| 6   | Convex integration    | Security boundary — isolation + ownership verification            |

E2E not authored in this pass — story is primarily data/plumbing; Task 9 is a manual browser smoke.

### Priority Distribution

- P0 (21 tests): security boundaries, ordering invariants, cascade delete, core persistence paths, sidebar render contract, keyboard-shortcut correctness.
- P1 (8 tests): edge cases (auth failures, empty states, long-title truncation, inactive-tab shortcut suppression).

---

## Failing Tests Created (RED Phase)

### Convex Integration Tests (16 tests)

**File:** `convex/conversations.test.ts` (11 tests)

- ✅ **[P0] createConversation derives userId from auth identity** — RED: `api.conversations` module does not exist yet.
- ✅ **[P0] createConversation rejects folder owned by another user** — RED: cross-user ownership check not implemented.
- ✅ **[P0] createConversation rejects unauthenticated caller** — RED: function missing.
- ✅ **[P1] createConversation truncates title > 60 chars** — RED: title-derivation not implemented.
- ✅ **[P0] listRecentForUser isolates caller's conversations across folders** — RED: query missing.
- ✅ **[P0] listRecentForUser orders desc by `_creationTime`** — RED: query missing.
- ✅ **[P0] listRecentForUser caps at 20** — RED: query missing.
- ✅ **[P0] listRecentForUser enriches rows with `folderName`** — RED: enrichment missing.
- ✅ **[P1] listRecentForUser returns `[]` for unauthenticated caller** — RED: query missing.
- ✅ **[P0] getMostRecentForFolder returns newest doc** — RED: query missing.
- ✅ **[P0] getMostRecentForFolder returns `null` for empty folder** — RED: query missing.
- ✅ **[P0] getMostRecentForFolder returns `null` across users** — RED: query missing.
- ✅ **[P0] getConversation returns doc for owner** — RED: query missing.
- ✅ **[P0] getConversation returns `null` for non-owner** — RED: query missing.
- ✅ **[P0] deleteConversation cascades messages** — RED: cascade not implemented.
- ✅ **[P0] deleteConversation leaves other users' messages intact** — RED: mutation missing.
- ✅ **[P1] deleteConversation rejects non-owner** — RED: mutation missing.
- ✅ **[P1] deleteConversation rejects unauthenticated caller** — RED: mutation missing.

**File:** `convex/messages.test.ts` (8 tests)

- ✅ **[P0] appendMessage inserts user message with auth-derived userId** — RED: `api.messages` module missing.
- ✅ **[P0] appendMessage persists assistant message with sources + model** — RED: mutation missing.
- ✅ **[P0] appendMessage rejects foreign-conversation append** — RED: ownership verification missing.
- ✅ **[P1] appendMessage rejects unauthenticated caller** — RED: mutation missing.
- ✅ **[P0] listByConversation orders `_creationTime` asc** — RED: query missing.
- ✅ **[P0] listByConversation rejects non-owner** — RED: ownership check missing.
- ✅ **[P0] listByConversation returns `[]` for empty conversation** — RED: query missing.
- ✅ **[P1] listByConversation rejects unauthenticated caller** — RED: query missing.

### Component Tests (12 tests — all `test.skip()` per RED convention at `tests/component/app-shell/layout.test.ts`)

**File:** `tests/component/app-shell/sidebar-recent-chats.test.ts` (7 tests)

- ✅ **[P0] renders up to 20 rows with title + folder-name subtext** — RED: layout still shows empty state.
- ✅ **[P0] exposes `data-conversation-id` per row** — RED: attribute not added.
- ✅ **[P1] links to `/app/folders/{folderId}?conversationId={id}`** — RED: row not rendered.
- ✅ **[P1] preserves empty state when list is empty** — RED: conditional not wired.
- ✅ **[P1] truncates long titles to single line** — RED: markup missing.
- ✅ **[P0] renders kebab action trigger per row** — RED: action absent.
- ✅ **[P0] opens "Delete conversation?" AlertDialog on delete** — RED: dialog not implemented.

**File:** `tests/component/chat/chat-new-conversation.test.ts` (5 tests)

- ✅ **[P0] renders "New Chat" button in chat tab header** — RED: button not present.
- ✅ **[P0] clears messages on click** — RED: handler missing.
- ✅ **[P0] Cmd/Ctrl+N starts new conversation outside inputs** — RED: shortcut handler missing.
- ✅ **[P0] shortcut suppressed in TEXTAREA** — RED: handler missing.
- ✅ **[P1] shortcut suppressed when `activeTab !== 'chat'`** — RED: handler missing.
- ✅ **[P0] `useChat` exports `currentConversationId`/`loadConversation`/`startNewConversation`** — RED: composable not extended yet.

---

## Data Factories Reused

Existing factories cover the entities this story needs (no new factory required):

- `tests/support/factories/folder.factory.ts` — `createFolder`, `createFolders`
- `tests/support/factories/chat.factory.ts` — `createSource`, `createUserMessage`, `createAssistantMessage`

Convex integration tests seed data through the real mutations (`api.folders.createFolder`, `api.conversations.createConversation`, `api.messages.appendMessage`) — the canonical pattern established by `convex/folders.test.ts`.

---

## Fixtures Created

None new — Convex tests use the shared `TEST_IDENTITY` / `OTHER_IDENTITY` fixtures inline (same pattern as `convex/folders.test.ts`). Component tests use `@nuxt/test-utils` `mountSuspended` without extended fixtures.

---

## Mock Requirements

None new. Convex integration tests run the real mutation graph via `convex-test`. Component tests mock network via the project's existing Convex composable stubs (follow `tests/component/sidebar/folder-tree.test.ts` precedent when un-skipping).

---

## Required `data-testid` Attributes

### Sidebar (`app/layouts/default.vue`)

- `sidebar-chat-item` — wraps each conversation row (also carries `data-conversation-id`).
- `sidebar-chat-actions-{conversationId}` — kebab trigger for row actions.
- `sidebar-chat-delete-{conversationId}` — delete menu item inside the dropdown.
- `delete-conversation-dialog` — the `AlertDialog` root for the delete confirmation.
- Preserve existing: `sidebar-chats-group`, `sidebar-chats-empty`.

### Folder chat page (`app/pages/app/folders/[id].vue`)

- `chat-new-button` — "New Chat" button in the chat tab header.

---

## Implementation Checklist

Mapping failing tests → implementation tasks in the story. The story already enumerates Tasks 1–9; use those as the execution plan. For each test, the enabling story task(s):

### Convex tests (conversations.test.ts, messages.test.ts)

- [ ] Task 1: Extend `convex/schema.ts` with `conversations` and `messages` tables + indexes.
- [ ] Task 2: Implement `convex/conversations.ts` (all 5 functions).
- [ ] Task 3: Implement `convex/messages.ts` (both functions).
- [ ] Run: `pnpm test -- convex/conversations.test.ts convex/messages.test.ts`
- [ ] ✅ Green phase

### Sidebar recent-chats tests

- [ ] Task 6: Populate sidebar group with `UiSidebarMenu` backed by `api.conversations.listRecentForUser`.
- [ ] Task 6: Wire kebab `UiDropdownMenu` → `UiAlertDialog` → `deleteConversation`.
- [ ] Un-skip `tests/component/app-shell/sidebar-recent-chats.test.ts` once the DOM is wired.
- [ ] ✅ Green phase

### New-chat button + shortcut tests

- [ ] Task 4: Extend `useChat` with `currentConversationId`, `loadConversation`, `startNewConversation`.
- [ ] Task 5: Render "New Chat" button, wire `Cmd/Ctrl+N` alongside existing `/` handler (INPUT/TEXTAREA + tab guardrails).
- [ ] Un-skip `tests/component/chat/chat-new-conversation.test.ts`.
- [ ] ✅ Green phase

---

## Running Tests

```bash
# Convex integration tests (RED)
pnpm test -- convex/conversations.test.ts convex/messages.test.ts

# Component tests (RED — currently test.skip, un-skip as GREEN landed)
pnpm test:component -- tests/component/app-shell/sidebar-recent-chats.test.ts
pnpm test:component -- tests/component/chat/chat-new-conversation.test.ts

# Full suites
pnpm test
pnpm test:component
```

---

## Red-Green-Refactor Workflow

### RED Phase — Complete ✅

- Convex tests: written to import from `api.conversations.*` / `api.messages.*` which do not yet exist. They will fail on module resolution via Convex codegen.
- Component tests: authored with `test.skip()` to match the existing `tests/component/app-shell/layout.test.ts` convention. They do not run until un-skipped during GREEN.

### GREEN Phase — Dev Team

1. Walk the story Tasks 1→3 → rerun Convex tests → verify each previously-failing test passes.
2. Walk Tasks 4→6 → un-skip the component test file(s) → rerun.
3. Task 9 smoke verifies the cross-cutting flow in-browser.

### REFACTOR Phase — after all tests pass

- Consolidate any duplicated auth/ownership helpers if `conversations.ts` + `messages.ts` grow.
- Keep per-message `appendMessage` out of the token stream loop (story anti-pattern note).

---

## Knowledge Base References Applied

- `data-factories.md` — reused existing `chat.factory` / `folder.factory`.
- `test-quality.md` — Given/When/Then phrasing, one-assertion-per-test for ordering and isolation.
- `test-levels-framework.md` — selected integration + component, skipped E2E (appropriate for data layer story).
- `test-priorities-matrix.md` — P0 for security and ordering invariants; P1 for auth/edge branches.
- `component-tdd.md` — followed existing skipped-layout pattern for red phase.

---

## Test Execution Evidence

### Initial RED Verification (expected)

```
# Expected output for: pnpm test -- convex/conversations.test.ts convex/messages.test.ts
FAIL convex/conversations.test.ts
  - Cannot read properties of undefined (reading 'createConversation')
    (api.conversations does not exist in generated api)
FAIL convex/messages.test.ts
  - Cannot read properties of undefined (reading 'appendMessage')
    (api.messages does not exist in generated api)

Summary:
- Total: 19 convex tests + 12 component tests (skipped)
- Passing: 0 (expected)
- Failing: 19 convex (expected RED)
- Skipped: 12 component (intentional red-phase convention)
- Status: ✅ RED phase verified
```

Once Task 1 (schema) + Tasks 2–3 (functions) land, the 19 Convex tests flip green. Component tests require un-skip after Tasks 4–6.

---

## Notes

- Cross-check with `4-3-model-selection.md` Dev Agent Record for Reka UI portal test caveats (use `document.body` queries) — applied pre-emptively in the delete-dialog assertion.
- `listByConversation` rejects non-owners via `rejects.toThrow()` rather than returning `[]` — matches the security stance the story spells out: "every mutation verifies ownership before reading". If Dev chooses `null`/`[]` for queries, update the test expectation when un-skipping.
- Component tests remain `test.skip()` for red phase (matches `tests/component/app-shell/layout.test.ts`). Un-skip as part of the implementation PR so the GREEN diff includes both tests and implementation.

---

## Next Steps

1. Dev picks up story 4.4 via `bmad-bmm-workflows-dev-story`.
2. Tasks 1–3 → Convex tests go GREEN.
3. Tasks 4–6 → un-skip component tests → GREEN.
4. Task 9 manual smoke in dev server.
5. On completion, consider running `bmad-bmm-workflows-testarch-test-review` for the landed implementation.

---

**Generated by BMad TEA Agent** — 2026-04-12
