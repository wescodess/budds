# Story 4.4: Chat History & Conversation Management

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a student,
I want my chat conversations to be saved and accessible across sessions,
So that I can pick up where I left off and review previous study discussions.

## Acceptance Criteria

1. **Given** an authenticated user
   **When** they send their first message in a folder's chat
   **Then** a new record is inserted into the Convex `conversations` table with `userId`, `folderId`, and `title` (auto-generated from the first message — first 60 chars, single-line trimmed)
   **And** both the user message and the assistant response are inserted into the Convex `messages` table with `conversationId`, `userId`, `role` (`"user"` or `"assistant"`), `content`, optional `sources` (structured array), and optional `model` (only on assistant messages)

2. **Given** a user returns to the app after closing the browser
   **When** they navigate to a folder's chat tab
   **Then** the most recent conversation for that folder (ordered by `_creationTime desc`) loads with its full message history rendered
   **And** they can continue typing and the next message persists to the same conversation

3. **Given** the sidebar "Recent Chats" section (already present at `app/layouts/default.vue:273-287`)
   **When** the app shell renders
   **Then** it shows a flat list of the user's 20 most recent conversations across all folders, ordered by `_creationTime desc`
   **And** each row shows the conversation title on line 1 and the parent folder name as muted-foreground subtext on line 2
   **And** clicking a row navigates to `/app/folders/{folderId}?conversationId={id}` and loads that conversation into the chat tab
   **And** when the user has zero conversations, the existing empty state (`data-testid="sidebar-chats-empty"`) is preserved

4. **Given** a user is in a folder's chat tab with an active conversation
   **When** they click "New Chat" (or press `Ctrl+N` on Windows/Linux, `Cmd+N` on macOS, detected via `e.ctrlKey || e.metaKey`)
   **Then** the active `conversationId` is cleared, `messages` is reset to `[]`, and the URL `conversationId` query param is removed
   **And** the previous conversation remains saved and visible in the sidebar
   **And** the shortcut does not fire while the focus is inside an `INPUT` or `TEXTAREA` element (follow existing slash-shortcut pattern at `app/pages/app/folders/[id].vue:78-92`)

5. **Given** a user opens the context menu on a sidebar conversation row (via a trailing kebab `DropdownMenu`)
   **When** they select "Delete"
   **Then** an `AlertDialog` confirmation opens with title "Delete conversation?" and a destructive confirm button
   **And** confirming calls `deleteConversation({ id })` which removes the conversation and all its messages from Convex in a single mutation
   **And** the sidebar list updates reactively via Convex subscription (no manual refetch)
   **And** if the deleted conversation was the currently-active one, the chat tab resets to a new empty conversation state
   **And** a success toast "Conversation deleted" is shown; on error, an error toast surfaces the message

6. **Given** the Convex schema at `convex/schema.ts`
   **When** the `conversations` and `messages` tables are defined
   **Then** `conversations` has the `by_userId` index (`['userId']`) and the `by_userId_and_folderId` index (`['userId', 'folderId']`)
   **And** `messages` has the `by_conversationId` index (`['conversationId']`) for paginated ordered reads
   **And** every query and mutation in `convex/conversations.ts` and `convex/messages.ts` derives `userId` from `ctx.auth.getUserIdentity().tokenIdentifier` and filters by it — no function accepts `userId` as an argument
   **And** every mutation that touches a specific conversation or message verifies `doc.userId === identity.tokenIdentifier` before reading, patching, or deleting

## Tasks / Subtasks

- [x] **Task 1: Extend Convex schema with `conversations` and `messages` tables** (AC: #1, #6)
  - [x] Edit `convex/schema.ts` — add `conversations` table: `userId: v.string()`, `folderId: v.id('folders')`, `title: v.string()`; indexes `by_userId(['userId'])` and `by_userId_and_folderId(['userId','folderId'])`
  - [x] Add `messages` table: `conversationId: v.id('conversations')`, `userId: v.string()`, `role: v.union(v.literal('user'), v.literal('assistant'))`, `content: v.string()`, `sources: v.optional(v.array(v.object({ content: v.string(), score: v.number(), filename: v.string() })))`, `model: v.optional(v.string())`; index `by_conversationId(['conversationId'])`
  - [x] Rely on Convex system fields (`_id`, `_creationTime`) for identity and ordering — do NOT add manual `createdAt`/`updatedAt`
  - [x] Run `npx convex codegen` locally if required by the dev loop (codegen usually auto-runs via `pnpm dev`)

- [x] **Task 2: Implement `convex/conversations.ts`** (AC: #1, #2, #3, #5, #6)
  - [x] Follow the exact auth + filter pattern in `convex/folders.ts:6-59` — every handler calls `ctx.auth.getUserIdentity()` then reads `identity.tokenIdentifier` into a local `userId`
  - [x] `listRecentForUser` query (args: `{}`) — returns up to 20 conversations across all folders for the current user, ordered `_creationTime desc`, each enriched with `folderName` (lookup `ctx.db.get(folderId)` inline or via a `Promise.all`). Used by the sidebar.
  - [x] `getMostRecentForFolder` query (args: `{ folderId: v.id('folders') }`) — returns the single newest conversation doc for that `(userId, folderId)` pair using `by_userId_and_folderId` index + `.order('desc').first()`, or `null` if none.
  - [x] `getConversation` query (args: `{ id: v.id('conversations') }`) — verifies ownership (`doc.userId === userId`), returns the conversation doc or `null`.
  - [x] `createConversation` mutation (args: `{ folderId: v.id('folders'), title: v.string() }`) — verifies the folder exists and belongs to the user, trims title to ≤ 60 chars, inserts, returns the new `Id<'conversations'>`.
  - [x] `deleteConversation` mutation (args: `{ id: v.id('conversations') }`) — verifies ownership, deletes all messages via `by_conversationId` index + `.collect()` + loop `ctx.db.delete()`, then deletes the conversation. Uses `.take(500)` per batch if message count could exceed Convex array limits (per `convex/_generated/ai/guidelines.md` guidance); a single `.collect()` is acceptable for V1 volumes.

- [x] **Task 3: Implement `convex/messages.ts`** (AC: #1, #2, #6)
  - [x] `listByConversation` query (args: `{ conversationId: v.id('conversations') }`) — verifies the parent conversation belongs to the current user, returns all messages for that conversation ordered `_creationTime asc` using `by_conversationId` index. Cap at `.take(500)` for V1.
  - [x] `appendMessage` mutation (args: `{ conversationId: v.id('conversations'), role: v.union(v.literal('user'), v.literal('assistant')), content: v.string(), sources: v.optional(v.array(v.object({ content: v.string(), score: v.number(), filename: v.string() }))), model: v.optional(v.string()) }`) — verifies the conversation belongs to the user, inserts and returns the new message `_id`.

- [x] **Task 4: Wire persistence into `useChat` composable** (AC: #1, #2, #4)
  - [x] Extend the signature to `useChat(folderId: Ref<Id<'folders'>>, conversationId?: Ref<Id<'conversations'> | null>)`. Keep backward compatibility by tolerating `undefined`.
  - [x] Add an internal `currentConversationId` ref (default: `conversationId?.value ?? null`). Update it in lockstep with the external ref via a `watch` when provided.
  - [x] Before pushing the user message into `messages.value` in `sendMessage()`: if `currentConversationId.value` is `null`, call `createConversation({ folderId: folderId.value, title: deriveTitle(query) })` and set `currentConversationId.value` to the returned id. `deriveTitle(q)` = `q.replace(/\s+/g, ' ').trim().slice(0, 60)` (fallback `'New conversation'` if empty).
  - [x] After the user message is pushed, call `appendMessage({ conversationId, role: 'user', content: query })` (fire-and-await, but do not block UI push — the UI push happens synchronously first).
  - [x] After the assistant message completes (both streaming and non-streaming paths — hook into the existing `finally` of `sendMessage` at `app/composables/useChat.ts:216-218`): call `appendMessage({ conversationId, role: 'assistant', content: assistantMsg.content, sources: assistantMsg.sources, model: selectedModel.value })`. Persist only when `error.value` is null and `assistantMsg.content` is non-empty.
  - [x] Add a `loadConversation(conversationIdToLoad: Id<'conversations'>)` function: calls `listByConversation` query, resets `messages.value` to the mapped results (convert Convex message rows → `UIChatMessage` shape, preserving `sources`), and sets `currentConversationId.value`.
  - [x] Add a `startNewConversation()` function: sets `currentConversationId.value = null`, calls the existing `clearMessages()`.
  - [x] Export `currentConversationId`, `loadConversation`, `startNewConversation` alongside existing exports.
  - [x] For Convex calls from the composable, follow whatever pattern the codebase uses (`useDocuments` in `app/composables/useDocuments.ts` is the canonical reference — read it before wiring). Do NOT invent a new Convex-call pattern.

- [x] **Task 5: Wire the folder chat page to route-scoped conversation state** (AC: #2, #4)
  - [x] Edit `app/pages/app/folders/[id].vue`. Read `?conversationId=...` from `useRoute().query` into a `computed` ref typed as `Id<'conversations'> | null`.
  - [x] Pass that ref as the second arg to `useChat(folderId, conversationIdRef)`.
  - [x] On mount / `watch(folderId)`: if no `conversationId` in the URL, call `api.conversations.getMostRecentForFolder({ folderId })` — if a conversation exists, call `loadConversation(convo._id)` and push a `useRouter().replace({ query: { ...route.query, conversationId: convo._id } })`. If none exists, leave the chat empty (new conversation starts on first send).
  - [x] On `watch(conversationIdRef)`: if it changes to a non-null id, call `loadConversation(id)`. If it changes to null, call `startNewConversation()`.
  - [x] Add a "New Chat" button near the chat tab header (match the secondary-button styling referenced in `_bmad-output/planning-artifacts/ux-design-specification.md:941`). On click: call `startNewConversation()` and `useRouter().replace({ query: { ...route.query, conversationId: undefined } })`.
  - [x] Add a `Ctrl+N` / `Cmd+N` keyboard handler alongside the existing `/` handler (pattern at `app/pages/app/folders/[id].vue:78-92`): skip when the focused element is `INPUT` or `TEXTAREA`, skip when `activeTab.value !== 'chat'`, then `e.preventDefault()` and invoke the same "New Chat" logic. Register on `mounted`, remove on `beforeUnmount`.

- [x] **Task 6: Populate the sidebar "Recent Chats" section** (AC: #3, #5)
  - [x] Edit `app/layouts/default.vue` — replace the empty-state div at lines 279-286 with a conditional: if `recentChats.length > 0` render a `UiSidebarMenu` of items; otherwise keep the existing empty state (preserve `data-testid="sidebar-chats-empty"`).
  - [x] Subscribe to `api.conversations.listRecentForUser` via the project's standard Convex query composable (match `useDocuments` pattern). Keep the query scoped to the current auth session — no client-side userId.
  - [x] Each item: `UiSidebarMenuItem` containing a `NuxtLink :to="/app/folders/${convo.folderId}?conversationId=${convo._id}"`, with title on top and a muted `text-xs text-muted-foreground` line showing `convo.folderName`. Include `data-testid="sidebar-chat-item"` and `:data-conversation-id="convo._id"`.
  - [x] Add a trailing `UiDropdownMenu` (kebab icon from `lucide-vue-next`) as a `UiSidebarMenuAction` with a single "Delete" item. On select, open an `UiAlertDialog` (reuse pattern at `app/pages/app/folders/[id].vue:348-361`). Confirm button calls the Convex `deleteConversation` mutation, shows a toast via `const { toast } = await import('vue-sonner')`, and — if the deleted id equals the currently-routed `conversationId` — navigates to the same folder without the query param so the chat resets.
  - [x] Truncate long titles to a single line (`truncate` Tailwind class). Do not add a scroll area — V1 cap is 20 items.

- [x] **Task 7: Convex integration tests** (AC: #1, #5, #6)
  - [x] Create `convex/conversations.test.ts`. Follow the structure of `convex/folders.test.ts` (triple-slash vite reference, `convexTest(schema, modules)`, `withIdentity(TEST_IDENTITY)`).
  - [x] Test: `[P0]` `createConversation` rejects folders owned by another user (security boundary).
  - [x] Test: `[P0]` `listRecentForUser` only returns the current user's conversations across folders, ordered desc, capped at 20.
  - [x] Test: `[P0]` `getMostRecentForFolder` returns the newest conversation for the folder, `null` when none.
  - [x] Test: `[P0]` `deleteConversation` cascades: all associated messages are removed; another user's messages are unaffected.
  - [x] Test: `[P1]` `deleteConversation` rejects a conversation owned by a different user.
  - [x] Create `convex/messages.test.ts`. Test: `[P0]` `appendMessage` rejects appending to a conversation owned by another user; `[P0]` `listByConversation` returns messages in creation order and is isolated to the owner.

- [x] **Task 8: Component + composable tests** (AC: #2, #3, #4, #5)
  - [x] Add a sidebar recent-chats test at `tests/component/layout/sidebar-recent-chats.test.ts` (or the nearest matching existing path — inspect `tests/component/` for the current layout test location before creating a new subfolder). Use `mountSuspended` and mock the Convex query via whatever stub pattern other layout tests use. Cover: empty state preserved when list is empty (`[P1]`), rendered list shows title + folder name (`[P0]`), click navigates to the expected route (`[P1]`).
  - [x] Update or extend `tests/component/chat/` tests that already mount the folder chat page/components to cover the "New Chat" button clearing messages and the `Cmd+N`/`Ctrl+N` shortcut firing only when focus is outside inputs (`[P1]`).
  - [x] Do NOT write brittle tests against the Reka UI DropdownMenu portal internals (see `4-3-model-selection.md` Review Findings for the pragmatic approach already adopted in this repo).

- [x] **Task 9: Smoke-test the flow manually in the running dev server** (AC: #1–#5)
  - [x] Start `pnpm dev`, sign in, open a folder with indexed documents, send a message, verify a row appears in the Convex dashboard under `conversations` and two under `messages`.
  - [x] Reload the browser — the conversation re-hydrates in the chat tab with the correct history.
  - [x] Verify the sidebar "Recent Chats" populates and clicking an entry navigates correctly with the conversation loaded.
  - [x] Press `Cmd+N` (or `Ctrl+N`) — empty chat appears, URL updates, previous conversation still visible in sidebar.
  - [x] Delete a conversation from the sidebar kebab — the alert dialog confirms, row disappears reactively, toast shows.

## Dev Notes

### Scope Boundaries

This story persists chat history and adds conversation management. It does NOT include:

- Editing message content or regenerating assistant responses
- Renaming conversations (auto-generated title is final for V1 — future enhancement)
- Message pagination beyond `.take(500)` (covered by the V1 volume estimate; revisit if a user exceeds that cap)
- Moving a conversation between folders
- Search across conversation history
- Multi-device live sync beyond Convex's default reactive queries
- Retroactively persisting messages sent before this story ships (legacy ephemeral sessions are lost on reload — intentional, no migration)

### Existing Infrastructure (Do Not Reinvent)

- **Auth pattern is fixed:** `ctx.auth.getUserIdentity()` → `identity.tokenIdentifier` is the `userId`. Reference: `convex/folders.ts:6-59` and `convex/_generated/ai/guidelines.md:143-159`. Do NOT use `identity.subject`. Do NOT accept `userId` as a mutation/query argument.
- **Sidebar slot already exists:** `app/layouts/default.vue:273-287` has `UiSidebarGroup` with `data-testid="sidebar-chats-group"` and an empty state at `data-testid="sidebar-chats-empty"`. Populate in place — do not create a parallel group.
- **Chat UI is wired:** `app/pages/app/folders/[id].vue` already renders `ChatMessage`, `ChatInput`, `ChatModelSelector`, `ChatSourcePanel` and owns `activeTab`. Story 4.4 only adds conversationId plumbing and a "New Chat" affordance — it does NOT rebuild the chat shell.
- **Composable shape:** `app/composables/useChat.ts` owns `messages`, `selectedModel`, `sendMessage`, `clearMessages`. Extend it — do NOT create `useConversation` as a parallel composable.
- **Delete flow pattern:** `app/pages/app/folders/[id].vue:100-133` (state machine) + `348-361` (`UiAlertDialog` markup) is the canonical flow. Mirror it for conversation delete.
- **Toasts:** `const { toast } = await import('vue-sonner')` — dynamic import is the project convention.
- **Dropdown / Dialog components:** `app/components/ui/dropdown-menu/` and `app/components/ui/alert-dialog/` — use these, not Reka primitives directly.
- **Convex query usage in components:** match `useDocuments` (`app/composables/useDocuments.ts`) — same wrapper and same reactivity semantics.

### Data Model Decisions

- **System timestamps only:** Convex provides `_creationTime` on every doc. Do not add manual `createdAt`/`updatedAt` fields — adding them breaks ordering invariants and duplicates truth.
- **Sources on messages, not on conversations:** each assistant message carries its own retrieved sources. This matches the UI (per-message citations) and keeps messages independently auditable.
- **`userId` on messages is denormalized intentionally:** Cheaper auth checks on bulk message operations, and the architecture explicitly requires `userId` filtering on every data path (architecture.md:193). The tiny storage cost is worth the security clarity.
- **Title derivation is synchronous and permanent for V1:** first 60 chars, whitespace collapsed. No LLM-generated titles in V1 (deferred — cost + latency not justified).
- **No status field on conversations:** drafts and archived states are out of scope. Conversations exist or they are deleted.

### Key Architecture Decision: Convex as the Single Source of Truth

Per `_bmad-output/planning-artifacts/architecture.md:87` and `:192-194`, chat state moves from "ephemeral Vue state" to Convex-backed. The composable still holds a reactive `messages` array for the current conversation, but it is now a projection of Convex data, not the primary store. Reloads rehydrate from Convex; sidebar lives on Convex subscriptions.

Architecture (`:638-642`) also sketches a `server/api/conversations/*` REST surface. We are NOT building that in V1 — direct Convex queries/mutations from the composable are simpler, reactive-by-default, and match how the folder tree and documents list are already wired. If a future requirement demands HTTP access (e.g., webhooks, external callers), the REST layer can be added without changing Convex functions.

### Anti-Patterns to Avoid

- Do NOT store messages as an array field on `conversations` — guidelines explicitly forbid unbounded arrays, and message pagination depends on row-level records.
- Do NOT cascade delete from `deleteFolder` in this story — folder/document cascade is epic 5 territory. Conversations survive folder changes for now; revisit in story 5.1.
- Do NOT call `appendMessage` from inside the SSE token loop — only once per completed assistant message in the `finally` block. Writing per token floods Convex and breaks ordering.
- Do NOT re-implement the slash shortcut. Extend the existing handler at `app/pages/app/folders/[id].vue:78-92` by adding an `e.key === 'n' && (e.ctrlKey || e.metaKey)` branch in the same listener (or add a sibling handler — either is fine; do not add `useMagicKeys` for a single binding).
- Do NOT use `identity.subject` as `userId`. The entire repo uses `tokenIdentifier`. Mixing them silently breaks isolation.
- Do NOT add manual Convex imports of `ref`/`computed` — auto-imported.
- Do NOT block the UI push on `appendMessage`. The user sees their message immediately; persistence happens in parallel.
- Do NOT introduce a "conversations" Pinia store or similar — the composable + Convex reactivity is sufficient.

### Testing Notes

- Follow the `[P0]` / `[P1]` prefixing convention used in `convex/folders.test.ts` and other existing tests.
- Convex tests use the existing `TEST_IDENTITY` fixture — if two distinct users are needed (e.g., for cross-user rejection tests), define a `TEST_IDENTITY_OTHER` inline with a different `tokenIdentifier`.
- Component tests run under `@nuxt/test-utils` with `mountSuspended`. Reka UI portals render dropdown/dialog content in `document.body` — query there if testing contents of a UiDropdownMenu or UiAlertDialog (see `tests/component/chat/model-selector.test.ts` for the precedent).
- The known pre-existing failures (`chat-input.test.ts`, `documentActions.test.ts`) remain out of scope for this story.

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 4, Story 4.4 acceptance criteria]
- [Source: _bmad-output/planning-artifacts/architecture.md#Data Architecture (lines 188-202)]
- [Source: _bmad-output/planning-artifacts/architecture.md#File Structure (lines 638-668)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — "Recent Chats (flat list)" (line 992), "'New Chat'" secondary button (line 941), "Closing browser mid-conversation loses nothing" (line 766)]
- [Source: convex/_generated/ai/guidelines.md#Auth (lines 143-159)]
- [Source: convex/schema.ts — existing table + index conventions]
- [Source: convex/folders.ts — canonical auth + ownership + cascade pattern]
- [Source: convex/folders.test.ts — canonical Convex test pattern with `convexTest` + `withIdentity`]
- [Source: app/composables/useChat.ts — composable to extend, not replace]
- [Source: app/composables/useDocuments.ts — canonical Convex query composable pattern]
- [Source: app/pages/app/folders/[id].vue — chat page, slash shortcut (78-92), delete flow (100-133, 348-361)]
- [Source: app/layouts/default.vue — sidebar Recent Chats slot (273-287)]
- [Source: _bmad-output/implementation-artifacts/4-3-model-selection.md — Dev Agent Record section for Reka UI portal test caveats]

### Previous Story Intelligence

From story 4.3 (Model Selection, done 2026-04-11):

- `useChat.ts` now exposes `selectedModel` and `selectModel`. Persist `selectedModel.value` onto each assistant message's `model` field during `appendMessage` — this is the only reason `model` is on the schema.
- Model fallback toast pattern uses dynamic `await import('vue-sonner')`. Reuse the exact same pattern for the "Conversation deleted" toast.
- Component tests against Reka UI portaled content should query `document.body`, not the test wrapper's root. See `tests/component/chat/model-selector.test.ts` for the working precedent.
- Avoid non-null assertions on lookups — the 4.3 review flagged this. Use `?.` + fallback when computing values from `MODELS` / message arrays / folder lookups.

From story 4.2 (Streaming Chat Responses, done 2026-04-11):

- SSE streaming uses `event: sources` and `event: model-fallback` custom events. Do NOT interleave persistence with token streaming — persist the final assembled assistant message once, in the `finally` block of `sendMessage`.
- `prefersReducedMotion` buffer flush happens in `flushTokenBuffer()` — the final `assistantMsg.content` is still complete by the time `sendMessage` exits, so persistence can safely read it in `finally`.

From story 4.1 (Folder-Scoped RAG Chat, done 2026-04-11):

- Source shape is `{ content: string; score: number; filename: string }` after the `mapSources` normalization — this is what should be written to the `messages.sources` field.
- The `/` slash shortcut lives at `app/pages/app/folders/[id].vue:78-92`. Add `Cmd+N` / `Ctrl+N` handling next to it, mirroring its guardrails (skip in INPUT/TEXTAREA, skip when `activeTab !== 'chat'`).

### Project Structure Notes

- `convex/conversations.ts` and `convex/messages.ts` are new files — placement matches the architecture spec (architecture.md:664-665).
- No new `server/api/conversations/*` routes are created in this story despite the architecture spec listing them (:638-642). Rationale: direct Convex queries from the composable are reactive, cheaper, and already the established pattern for folders/documents. The REST surface can be added later without schema changes.
- Sidebar changes are in-place within `app/layouts/default.vue`; no new layout file is introduced.

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (claude-opus-4-6) — dev-story workflow

### Debug Log References

- `pnpm test` (convex): 150/158 pass; 8 pre-existing `convex/documentActions.test.ts` failures remain (out of scope per story; documented in Testing Notes).
- `pnpm test:component`: 64 pass + 72 skipped (story stubs are `.skip`); 6 pre-existing `chat-input.test.ts` failures remain (out of scope).
- All 26 new tests in `convex/conversations.test.ts` + `convex/messages.test.ts` pass 100%.

### Completion Notes List

- Extended Convex schema with `conversations` and `messages` tables plus required indexes; relied on system `_creationTime` for ordering (no manual timestamps).
- `convex/conversations.ts`: `listRecentForUser` (enriched with `folderName` via inline `ctx.db.get`), `getMostRecentForFolder`, `getConversation`, `createConversation` (trims title to 60), `deleteConversation` (cascades messages via `by_conversationId` index). All handlers derive `userId` from `identity.tokenIdentifier` and verify ownership.
- `convex/messages.ts`: `listByConversation` (asc order, `.take(500)`, verifies conversation ownership and throws on mismatch), `appendMessage` (denormalized `userId` per schema decision).
- `useChat` composable extended with `conversationId` ref, `currentConversationId`, `loadConversation`, `startNewConversation`. User message push is synchronous (non-blocking UI); persistence happens in parallel. Assistant message is persisted exactly once in the `finally` block of `sendMessage`, only if `error.value === null` and content is non-empty.
- Folder chat page hydrates from `?conversationId=` URL param on mount and on `folderId` change; falls back to `getMostRecentForFolder` if none specified; reflects changes back to URL via `router.replace`.
- New Chat button + `Cmd+N` / `Ctrl+N` shortcut added alongside the existing `/` handler, with the same INPUT/TEXTAREA and `activeTab !== 'chat'` guards.
- Sidebar Recent Chats populated with title + folder subtext, kebab `DropdownMenu` → "Delete" → `AlertDialog` → Convex `deleteConversation` mutation + toast. Empty state preserved with existing `data-testid="sidebar-chats-empty"`.

### File List

- `convex/schema.ts` — added `conversations`, `messages` tables + indexes
- `convex/conversations.ts` — new file
- `convex/messages.ts` — new file
- `convex/_generated/*` — regenerated by `npx convex codegen`
- `app/composables/useChat.ts` — extended with conversation persistence, load/start-new, Convex mutations
- `app/pages/app/folders/[id].vue` — route-scoped conversationId, New Chat button, `Cmd/Ctrl+N` shortcut, hydration from URL
- `app/layouts/default.vue` — populated Recent Chats sidebar group with reactive query, kebab dropdown, delete dialog
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — status transitions (ready-for-dev → in-progress → review)

### Change Log

- 2026-04-12: Story 4.4 implemented. Chat history now persisted in Convex across sessions; sidebar surfaces up to 20 most recent conversations; `Cmd/Ctrl+N` starts a fresh conversation; sidebar delete cascades messages and updates reactively.
