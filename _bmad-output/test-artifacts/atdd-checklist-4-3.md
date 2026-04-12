---
stepsCompleted: ['step-01-preflight-and-context', 'step-02-generation-mode', 'step-03-test-strategy', 'step-04c-aggregate', 'step-05-validate-and-complete']
lastStep: 'step-05-validate-and-complete'
lastSaved: '2026-04-11'
workflowType: 'testarch-atdd'
inputDocuments:
  - '_bmad-output/implementation-artifacts/4-3-model-selection.md'
  - 'app/composables/useChat.ts'
  - 'app/pages/app/chat.vue'
  - 'app/pages/app/folders/[id].vue'
  - 'server/api/rag/chat.post.ts'
  - 'server/api/rag/chat.post.test.ts'
  - 'app/components/ui/dropdown-menu/index.ts'
  - 'tests/component/chat/chat-input.test.ts'
---

# ATDD Checklist - Epic 4, Story 4.3: Model Selection

**Date:** 2026-04-11
**Author:** palmwine
**Primary Test Level:** Component + Server

---

## Story Summary

A power user wants to choose which AI model generates answers so they can balance response quality and speed. The UI uses progressive disclosure: the footer shows only a model name label until clicked, then reveals a DropdownMenu with all available models. The server validates models against an allowlist and falls back to the default when an invalid model is sent.

**As a** power user
**I want** to choose which AI model generates my answers
**So that** I can balance response quality and speed for my needs

---

## Acceptance Criteria

1. Default model `openai/gpt-4o-mini` used when no explicit selection; footer shows model name label only
2. Clicking model name opens DropdownMenu listing all models; default marked "(recommended)"
3. Selected model used for subsequent queries; label updates to reflect selection
4. When selected model is unavailable, server falls back to default; user sees toast notification

---

## Failing Tests Created (RED Phase)

### Server Tests (4 tests)

**File:** `server/api/rag/chat.post.test.ts` (appended to existing file)

- `[P0] should pass valid model through unchanged`
  - **Status:** RED (skipped) — expects `modelFallback` to be undefined for valid models; server currently has no allowlist validation
  - **Verifies:** AC #4 — valid models pass through without fallback

- `[P0] should fallback to default model when invalid model is sent (non-streaming)`
  - **Status:** RED (skipped) — expects `generateCompletion` called with default model and `modelFallback` field in response; server currently passes invalid model through unchanged
  - **Verifies:** AC #4 — invalid model triggers fallback

- `[P0] should emit model-fallback SSE event for invalid model in streaming path`
  - **Status:** RED (skipped) — expects `event: model-fallback` SSE event with `requested`/`actual` fields before the stream; server currently has no fallback logic for streaming
  - **Verifies:** AC #4 — streaming fallback notification

- `[P1] should include modelFallback in non-streaming response for invalid model`
  - **Status:** RED (skipped) — expects `modelFallback` object with `requested` and `actual` fields; server currently returns no fallback metadata
  - **Verifies:** AC #4 — non-streaming fallback response shape

### Component Tests (5 tests)

**File:** `tests/component/chat/model-selector.test.ts` (new file)

- `[P0] should render the current model label by default`
  - **Status:** RED (skipped) — component `ModelSelector.vue` does not exist yet
  - **Verifies:** AC #1 — default state shows only model name label

- `[P0] should show all models when dropdown trigger is clicked`
  - **Status:** RED (skipped) — component does not exist yet
  - **Verifies:** AC #2 — dropdown opens with all models listed

- `[P1] should mark the recommended model with "(recommended)" suffix`
  - **Status:** RED (skipped) — component does not exist yet
  - **Verifies:** AC #2 — recommended model clearly identified

- `[P0] should emit update:modelValue when a model is selected`
  - **Status:** RED (skipped) — component does not exist yet
  - **Verifies:** AC #3 — v-model emits on selection

- `[P1] should prevent interaction when disabled prop is true`
  - **Status:** RED (skipped) — component does not exist yet
  - **Verifies:** AC #3 — selector disabled during loading

---

## Mock Requirements

### Server Test Mocks (existing pattern)

Uses the existing `vi.stubGlobal` pattern from `chat.post.test.ts`:

- `readBody` — returns request body with model field
- `searchDocuments` — returns empty or mock search results
- `generateCompletion` — returns mock completion response
- `generateCompletionStream` — returns mock ReadableStream
- `setResponseHeader` / `sendStream` — captures SSE stream output

No new mock infrastructure needed — all server tests extend the existing mock setup.

---

## Required data-testid Attributes

No new `data-testid` attributes are required for this story. The `ModelSelector` component uses the existing `DropdownMenu` component which provides its own accessibility attributes (`role="menuitem"`, etc.). The trigger button is discoverable via `wrapper.find('button')`.

---

## Implementation Checklist

### Test: `[P0] should pass valid model through unchanged`

**File:** `server/api/rag/chat.post.test.ts`

**Tasks to make this test pass:**

- [ ] Create `server/utils/models.ts` with model value allowlist and `DEFAULT_MODEL` constant
- [ ] In `server/api/rag/chat.post.ts`, import the allowlist and validate `body.model` against it
- [ ] If model is valid, pass it through unchanged (no `modelFallback` in response)
- [ ] Remove `test.skip` → run test: `pnpm test -- --run server/api/rag/chat.post.test.ts`
- [ ] Test passes (green phase)

---

### Test: `[P0] should fallback to default model when invalid model is sent (non-streaming)`

**File:** `server/api/rag/chat.post.test.ts`

**Tasks to make this test pass:**

- [ ] In `server/api/rag/chat.post.ts`, when `body.model` is NOT in the allowlist, replace it with `DEFAULT_MODEL`
- [ ] Add `modelFallback: { requested: originalModel, actual: DEFAULT_MODEL }` to the non-streaming JSON response
- [ ] Remove `test.skip` → run test: `pnpm test -- --run server/api/rag/chat.post.test.ts`
- [ ] Test passes (green phase)

---

### Test: `[P0] should emit model-fallback SSE event for invalid model in streaming path`

**File:** `server/api/rag/chat.post.test.ts`

**Tasks to make this test pass:**

- [ ] In the streaming branch of `chat.post.ts`, when model is invalid, emit `event: model-fallback\ndata: {"requested":"...","actual":"..."}\n\n` before the sources event
- [ ] Ensure `generateCompletionStream` is called with the default model, not the invalid one
- [ ] Remove `test.skip` → run test: `pnpm test -- --run server/api/rag/chat.post.test.ts`
- [ ] Test passes (green phase)

---

### Test: `[P1] should include modelFallback in non-streaming response for invalid model`

**File:** `server/api/rag/chat.post.test.ts`

**Tasks to make this test pass:**

- [ ] Verify the `modelFallback` response field includes both `requested` and `actual` keys
- [ ] This test overlaps with the fallback test above; should pass once fallback logic is implemented
- [ ] Remove `test.skip` → run test: `pnpm test -- --run server/api/rag/chat.post.test.ts`
- [ ] Test passes (green phase)

---

### Test: `[P0] should render the current model label by default`

**File:** `tests/component/chat/model-selector.test.ts`

**Tasks to make this test pass:**

- [ ] Create `app/constants/models.ts` with models array and `DEFAULT_MODEL`
- [ ] Create `app/components/chat/ModelSelector.vue` with `modelValue` prop
- [ ] Render a button showing the current model's label from the constants array
- [ ] Remove `it.skip` → run test: `pnpm test:component -- --run tests/component/chat/model-selector.test.ts`
- [ ] Test passes (green phase)

---

### Test: `[P0] should show all models when dropdown trigger is clicked`

**File:** `tests/component/chat/model-selector.test.ts`

**Tasks to make this test pass:**

- [ ] Wire the button as a `DropdownMenuTrigger` inside a `DropdownMenu`
- [ ] Render `DropdownMenuItem` for each model in the constants array
- [ ] Remove `it.skip` → run test: `pnpm test:component -- --run tests/component/chat/model-selector.test.ts`
- [ ] Test passes (green phase)

---

### Test: `[P1] should mark the recommended model with "(recommended)" suffix`

**File:** `tests/component/chat/model-selector.test.ts`

**Tasks to make this test pass:**

- [ ] In the dropdown items, append " (recommended)" to the label of the model with `recommended: true`
- [ ] Remove `it.skip` → run test: `pnpm test:component -- --run tests/component/chat/model-selector.test.ts`
- [ ] Test passes (green phase)

---

### Test: `[P0] should emit update:modelValue when a model is selected`

**File:** `tests/component/chat/model-selector.test.ts`

**Tasks to make this test pass:**

- [ ] Add `@click` handler to each `DropdownMenuItem` that emits `update:modelValue` with the model value
- [ ] Remove `it.skip` → run test: `pnpm test:component -- --run tests/component/chat/model-selector.test.ts`
- [ ] Test passes (green phase)

---

### Test: `[P1] should prevent interaction when disabled prop is true`

**File:** `tests/component/chat/model-selector.test.ts`

**Tasks to make this test pass:**

- [ ] Add `disabled` prop to `ModelSelector.vue`
- [ ] When disabled, set the trigger button's `disabled` attribute
- [ ] Remove `it.skip` → run test: `pnpm test:component -- --run tests/component/chat/model-selector.test.ts`
- [ ] Test passes (green phase)

---

## Running Tests

```bash
# Run all server tests (includes model validation)
pnpm test -- --run server/api/rag/chat.post.test.ts

# Run model-selector component tests only
pnpm test:component -- --run tests/component/chat/model-selector.test.ts

# Run all component tests
pnpm test:component

# Run all tests (server + convex)
pnpm test

# Watch mode for server tests
pnpm test:watch -- server/api/rag/chat.post.test.ts

# Watch mode for component tests
pnpm test:component:watch -- tests/component/chat/model-selector.test.ts
```

---

## Red-Green-Refactor Workflow

### RED Phase (Complete)

**TEA Agent Responsibilities:**

- All 9 tests written and skipped (4 server + 5 component)
- Tests follow existing project patterns (`vi.stubGlobal` for server, `mountSuspended` for component)
- Implementation checklist created mapping each test to code tasks
- No new fixtures or factories needed (server tests use existing mock pattern, component tests use `mountSuspended`)

**Verification:**

- Server tests: `pnpm test` — 8 passed, 4 skipped
- Component tests: `pnpm test:component -- --run tests/component/chat/model-selector.test.ts` — 5 skipped
- All new tests are skipped as expected (RED phase confirmed)

---

### GREEN Phase (DEV Team - Next Steps)

**DEV Agent Responsibilities:**

1. **Start with Task 1** from story spec: Create `app/constants/models.ts` with shared model definitions
2. **Task 2**: Add `selectedModel` ref and `selectModel()` to `useChat.ts`
3. **Task 3**: Create `ModelSelector.vue` component — remove `it.skip` from component tests as you go
4. **Task 4**: Wire ModelSelector into `app/pages/app/folders/[id].vue`
5. **Task 5**: Add server-side allowlist validation in `server/api/rag/chat.post.ts` — remove `test.skip` from server tests
6. **Task 6**: Handle model fallback on the client in `useChat.ts`
7. **Run tests after each task** to verify incremental GREEN progress

**Key Principles:**

- One test at a time (remove `test.skip`/`it.skip`, implement, verify green)
- Minimal implementation first
- Run tests frequently for immediate feedback

---

### REFACTOR Phase (After All Tests Pass)

1. Verify all 9 tests pass (green phase complete)
2. Replace inline models array in `app/pages/app/chat.vue` with shared constant import
3. Ensure no model duplication across files
4. Code review for consistency with existing patterns

---

## Next Steps

1. **Share this checklist and failing tests** with the dev workflow
2. **Run failing tests** to confirm RED phase: `pnpm test -- --run server/api/rag/chat.post.test.ts`
3. **Begin implementation** using the story tasks (1 through 8) as guide
4. **Work one test at a time** (remove skip → implement → verify green)
5. **When all tests pass**, refactor for quality
6. **When refactoring complete**, update story status to 'done' in sprint-status.yaml

---

## Knowledge Base References Applied

- **data-factories.md** — Not needed for this story (server tests use inline mock data matching existing patterns)
- **component-tdd.md** — Red-Green-Refactor cycle applied; component tests use `mountSuspended` pattern
- **test-quality.md** — One assertion focus per test, explicit assertions in test body, deterministic tests

---

## Test Execution Evidence

### Initial Test Run (RED Phase Verification)

**Server Tests:**

```
pnpm test -- --run server/api/rag/chat.post.test.ts

 Test Files  1 passed (1)
      Tests  8 passed | 4 skipped (12)
   Duration  168ms
```

**Component Tests:**

```
pnpm test:component -- --run tests/component/chat/model-selector.test.ts

 Test Files  1 skipped (1)
      Tests  5 skipped (5)
   Duration  562ms
```

**Summary:**

- Total tests: 9 (4 server + 5 component)
- Passing: 0 new (expected)
- Skipped: 9 (expected — RED phase)
- Status: RED phase verified

---

## Notes

- No E2E tests generated — project uses Vitest, not Playwright/Cypress for testing
- Server tests extend existing `chat.post.test.ts` describe blocks using the same `vi.stubGlobal` pattern
- Component tests follow the `mountSuspended` + dynamic import pattern from `chat-input.test.ts`
- The `DropdownMenu` component from `app/components/ui/dropdown-menu` provides built-in keyboard navigation and ARIA attributes

---

**Generated by BMad TEA Agent** - 2026-04-11
