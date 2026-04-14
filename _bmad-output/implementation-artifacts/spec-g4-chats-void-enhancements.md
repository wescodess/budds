---
title: 'G4: Chats void enhancements — markdown, thinking, citations, directory picker'
type: 'feature'
created: '2026-04-14'
status: 'ready-for-dev'
context: [DESIGN.md, CLAUDE.md, convex/_generated/ai/guidelines.md]
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Assistant responses render as plaintext (no markdown, no code blocks, no tables), there is no visible "thinking" state before streaming begins, citations lack source previews or a browse-all surface, and users cannot narrow the RAG retrieval scope to specific subfolders or files — the folder query always searches the entire active folder.

**Approach:** Render assistant messages via `@nuxtjs/mdc` with a Warm-Focus Shiki theme and a custom remark plugin that maps `[n]` tokens to an interactive `ChatCitationBadge`. Surface a dedicated `thinking` state in `useChat` between send and first token. Add inline reference chips + "View all references" that opens the existing `ChatSourcePanel` as a right-side helper. Ship a new `ChatDirectoryPicker` (nested tree with tri-state checkboxes, counts, empty/loading states) and wire a `useReferenceScope` composable whose selection is passed to `/api/rag/chat` as an optional `scope` and respected server-side.

## Boundaries & Constraints

**Always:**
- Respect Warm Focus palette and 12px radius; reuse `--primary`, `--card`, `--border`, `--muted-foreground` tokens — no ad-hoc colors.
- Sanitize all assistant-rendered markdown via `rehype-sanitize` — raw HTML is untrusted.
- Reference-scope filtering is enforced server-side in [server/api/rag/chat.post.ts](server/api/rag/chat.post.ts); the client cannot bypass it.
- Streaming path stays SSE; `thinking` is a pure client-side phase between submit and first token.
- `@nuxtjs/mdc` config lives once in [nuxt.config.ts](nuxt.config.ts); chat is the first consumer but the renderer is reusable elsewhere.
- Every `folderId`/`fileId` passed to the chat API must belong to the current `userId` — validated with existing Convex ownership guards.
- All interactive controls expose `aria-label`, `role`, and keyboard affordances; focus rings use `--ring`.

**Ask First:**
- Adding any dep beyond `@nuxtjs/mdc`, `remark-gfm`, `rehype-sanitize`, `shiki` (already pulled transitively by MDC), and `@vueuse/core` (already present) — existing architecture already depends on these or their transitive parents.

**Never:**
- No raw `v-html` on assistant content.
- No virtualization library for the directory tree in this spec — tree rendering is native; if a user has >1000 files in a folder we show a "Too many files — refine with search" hint. (Virtualization deferred.)
- No backend schema migration — use existing `folders.parentId`, `documents.folderId`, `documents.userId`.
- No new auth surface — reuse existing Convex ownership checks.
- No page/section metadata in citation hovercards — backend source records don't carry it. Show filename + relevance + content preview only. (Page/section deferred.)
- Do not delete `app/components/chat/CitationBadge.vue` or `Message.vue`; extend them.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Assistant response has markdown (headings, code blocks, lists, tables, blockquote) | Raw string with GFM tokens | Rendered via MDC; code blocks use Warm-Focus Shiki theme; tables have borders/header row; inline code uses muted surface | Sanitize strips any raw HTML/script; malformed blocks render as plain text |
| Assistant response contains `[1] [2] [3]` citations | String + sources array | Each `[n]` → `ChatCitationBadge` Vue component; hover shows `HoverCard` with filename + % relevance + mono excerpt | If `sources[n-1]` missing → render plain `[n]` text (no pill) |
| User sends query | Before first SSE token arrives | `thinking=true`, renders a `ChatThinkingRow` with pulse dots + model label; `streaming=false` | If fetch errors before first token → `thinking=false`, push error message, toast |
| First SSE token arrives | thinking=true | `thinking=false`, `streaming=true`, content begins appending | If SSE stream aborts mid-response → `streaming=false`, message kept as-is with partial content |
| User hovers inline `[2]` | Message has `sources[1]` | HoverCard shows after 300ms delay with filename + `0.91 relevance` + 3-line excerpt in mono + "Open in knowledge" link | `sources[1]` missing → no hovercard |
| User clicks "View all references →" under bubble | Message has ≥1 source | Opens existing `ChatSourcePanel` in right-side helper layout; panel groups entries by citation number | No sources → link not rendered |
| Directory picker opens | User clicks paperclip icon in Input | Popover anchored above icon; tree renders from Convex subtree query | Query error → tree shows error row with retry |
| Folder expanded | Click chevron | Loads `listSubtree(folderId, depth=1)` result; shows skeleton during load | Children load error → row shows "Couldn't load — retry" |
| Folder checkbox toggled | Unchecked → checked | Mark folder + all descendant files as selected | — |
| File checkbox toggled to the only unchecked file in parent | All other siblings checked | Parent folder flips from indeterminate → checked | — |
| File checkbox toggled off while parent was fully checked | One file unchecked | Parent folder flips from checked → indeterminate | — |
| All files in a folder deselected | Last file unchecked | Folder flips from indeterminate → unchecked; if descendants include folders, propagate up | — |
| Empty folder | 0 files, 0 subfolders | Row rendered with disabled checkbox and italic "No files in this folder" child line | — |
| Loading folder | Subtree query in flight | Row chevron disabled, count replaced with spinner, checkbox disabled | — |
| Scope contains folders + individual files | folderIds=[A], fileIds=[b,c] where b is child of A | Server deduplicates: folder A expands to all its files; b,c from outside A are also included | — |
| Empty scope | Nothing selected | Falls back to current behavior: search whole active folder | — |
| Chat query submitted with scope | `scope={folderIds,fileIds}` in body | Server expands `folderIds` to descendant `documents`, unions with `fileIds`, filters RAG results to that set | Unknown id or not-owned by user → 400 with message |
| Scope chip "x" clicked | Chip removed | Selection updated; if removing a folder, descendant file selections cleared | — |

</frozen-after-approval>

## Code Map

- `package.json` -- add `@nuxtjs/mdc`, `remark-gfm`, `rehype-sanitize`, `shiki` as needed deps
- `nuxt.config.ts` -- register `@nuxtjs/mdc`, configure Shiki theme + remark/rehype plugins
- `assets/shiki/warm-focus-dark.json` -- custom VS Code theme for code block syntax highlighting (amber keywords, mint strings, muted comments, #1c1917 bg)
- `app/utils/remark-citations.ts` -- remark plugin that rewrites text nodes matching `/\[(\d+)\]/g` into a custom `cite` MDX-ish node
- `app/components/chat/Message.vue` -- replace regex parser with `<MDC :value :components="{ cite: ChatCitationBadge }"/>`
- `app/components/chat/CitationBadge.vue` -- wrap in Reka `HoverCard` showing filename + relevance + excerpt + "Open in knowledge"
- `app/components/chat/ThinkingRow.vue` -- new — pulse dots + "Thinking…" label + model name chip
- `app/components/chat/ReferenceChips.vue` -- new — 2–3 source preview chips + "View all references →"
- `app/components/chat/SourcePanel.vue` -- adapt to group by citation number; accept `open`, `close()`, `activeCitationIndex`
- `app/components/chat/DirectoryPicker.vue` -- new — header, search, tree body, footer; uses `useReferenceScope` + Convex folder/subtree query
- `app/components/chat/DirectoryPickerRow.vue` -- new — row primitive (chevron, icon, name, count pill, tri-state checkbox)
- `app/components/chat/ReferenceScopeStrip.vue` -- new — chip strip above the chat input
- `app/components/chat/Input.vue` -- add paperclip trigger button (left of model selector) that toggles the DirectoryPicker popover
- `app/composables/useReferenceScope.ts` -- new — `{ folderIds, fileIds, toggleFolder(id), toggleFile(id,parentId), clear(), chips, counts, isEmpty }`
- `app/composables/useChat.ts` -- add `thinking` ref; set `thinking=true` before fetch, flip to `false` on first token or error; accept optional `scope` in `sendMessage`
- `app/pages/app/folders/[id].vue` -- render chat void layout with helper panel slot
- `convex/folders.ts` -- add `listSubtree(folderId)` query returning `{ subfolders: [{id, name, fileCount, descendantFileCount}], files: [{id, filename, size, mimeType}] }` scoped by `userId`
- `server/api/rag/chat.post.ts` -- accept optional `scope?: { folderIds?: Id<'folders'>[]; fileIds?: Id<'documents'>[] }`; validate ownership; expand folderIds to descendant documents; union with fileIds; filter RAG retrieval
- `tests/component/chat/Message.markdown.nuxt.test.ts` -- markdown + citation rendering cases from I/O matrix
- `tests/component/chat/ThinkingRow.nuxt.test.ts` -- renders when `thinking=true`, hidden otherwise, respects `prefers-reduced-motion`
- `tests/component/chat/DirectoryPicker.nuxt.test.ts` -- tri-state propagation, empty folder, loading skeleton, deselect cascade
- `tests/component/chat/ReferenceScopeStrip.nuxt.test.ts` -- chip removal, Clear all, + Add references
- `convex/folders.test.ts` -- extend for `listSubtree` ownership + shape
- `server/api/rag/chat.post.test.ts` -- extend: scope ownership enforcement + folder expansion + empty-scope fallback

## Tasks & Acceptance

**Execution:**
- [ ] `package.json` + `nuxt.config.ts` -- install `@nuxtjs/mdc`, `remark-gfm`, `rehype-sanitize`; register module with sanitize + Shiki theme -- enables markdown pipeline
- [ ] `assets/shiki/warm-focus-dark.json` -- author custom theme matching DESIGN.md palette -- keeps code blocks on-brand
- [ ] `app/utils/remark-citations.ts` -- implement text-node rewriter `[n]` → custom `cite` node with `index` attr -- bridges plaintext citations to Vue components
- [ ] `app/components/chat/CitationBadge.vue` -- add Reka `HoverCard`; accept `filename`, `score`, `excerpt`; 300ms open delay -- satisfies hover-snippet AC
- [ ] `app/components/chat/Message.vue` -- swap regex parser for `<MDC :value="content" :components="{ cite: ChatCitationBadge }" tag="div">`; preserve streaming cursor; wrap in `prose-chat` Tailwind styles -- core markdown rendering
- [ ] `app/components/chat/ThinkingRow.vue` -- pulse dots + "Thinking…" + model chip; honor `prefers-reduced-motion` -- visible wait state
- [ ] `app/components/chat/ReferenceChips.vue` -- first 3 source chips + "View all references →" emitting `open-references` -- under-bubble surface
- [ ] `app/components/chat/SourcePanel.vue` -- adapt to group entries by citation number; open/close controlled; width ~40% viewport -- all-references helper
- [ ] `app/composables/useReferenceScope.ts` -- selection state + tri-state computation + chip summary -- single source of truth for scope
- [ ] `convex/folders.ts` -- `listSubtree` query (ownership-checked, returns 1-level subfolders with recursive descendantFileCount + direct files) -- picker data source
- [ ] `app/components/chat/DirectoryPickerRow.vue` -- row primitive (chevron, icon, name, count pill, tri-state checkbox, loading/empty states) -- reusable tree leaf
- [ ] `app/components/chat/DirectoryPicker.vue` -- header ("Reference scope" + counter + Clear), search filter, lazy subtree expansion, footer ("Cancel" / "Use as context") -- picker UI per screen c28492de
- [ ] `app/components/chat/ReferenceScopeStrip.vue` -- chip strip above input; chip removal; "+ Add references" trigger; "Clear all" -- visible scope per screen 6a7ec821
- [ ] `app/components/chat/Input.vue` -- add paperclip icon button + Reka `Popover` anchoring `ChatDirectoryPicker` -- picker entry point
- [ ] `app/composables/useChat.ts` -- add `thinking` ref; set before fetch, flip on first token or error; include optional `scope` in POST body -- wire state + backend call
- [ ] `server/api/rag/chat.post.ts` -- accept `scope` param; validate owner; expand folderIds to documents; union with fileIds; apply as filter to RAG retrieval; empty → existing whole-folder path -- enforce scope server-side
- [ ] `app/pages/app/folders/[id].vue` -- render `ChatThinkingRow` when `thinking`; render `ChatReferenceChips` below each assistant message; open `ChatSourcePanel` as right helper slot on "View all references" -- page wiring
- [ ] Unit + component tests per I/O matrix cells -- cover happy paths + every edge case row

**Acceptance Criteria:**
- Given an assistant message containing `##`, `**bold**`, fenced code, table, blockquote, and `[1] [2]`, when rendered, then MDC produces semantic HTML, the code block uses the Warm-Focus Shiki theme, `[1]` and `[2]` become interactive `ChatCitationBadge` components, and no raw HTML from the model leaks through.
- Given the user submits a query, when the fetch is in flight and no token has yet arrived, then `thinking=true` and `ChatThinkingRow` is visible with the pulse animation unless `prefers-reduced-motion` is set (static text then).
- Given the first SSE token arrives, when it is appended, then `thinking` flips to `false`, `streaming` to `true`, and `ChatThinkingRow` is removed without layout shift.
- Given an assistant message has 5 sources, when rendered under the bubble, then 3 chip previews are shown with a "+2 more" affordance and "View all references →" is aligned right.
- Given "View all references" is clicked, when the helper panel opens, then `ChatSourcePanel` shows entries grouped by citation index with filename, relevance, mono excerpt, "Open in knowledge" action, close X.
- Given the user hovers an inline `[2]` for 300ms, when `sources[1]` exists, then a `HoverCard` shows filename + `0.xx relevance` + 3-line excerpt + "Open in knowledge" link; if `sources[1]` is missing the pill renders as plain text and no hovercard appears.
- Given the user clicks the paperclip icon in the input, when the popover opens, then the directory picker mounts, `listSubtree` is called for the active root folder, and the tree renders with lazy expansion.
- Given a folder with some descendants selected, when its checkbox state is computed, then it is `indeterminate`; toggling it to `checked` selects every descendant file; toggling to `unchecked` deselects every descendant file.
- Given the user has selected one subfolder and one orphan file, when they submit, then `/api/rag/chat` receives `scope: { folderIds: [...], fileIds: [...] }` and the server restricts retrieval to the union of descendant files + orphan files belonging to the caller.
- Given the scope is empty, when the user submits, then the server behaves identically to before this spec (retrieval across the active folder).
- Given a file or folder id in `scope` does not belong to the caller, when the server validates, then it returns 400 with a descriptive error — no partial retrieval leaks.
- Given a folder contains no files or subfolders, when rendered, then the row shows a disabled checkbox and an italic muted "No files in this folder" child; the folder is not selectable.
- Given a folder's subtree is loading, when rendered, then the row shows a spinner in place of the count pill and its checkbox is disabled.
- Given `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm test:component` are run, when complete, then all pass.
- Given all new interactive elements, when navigated by keyboard only, then every control is reachable, focus-visible with amber ring, and has a screen-reader-readable label.

## Design Notes

**Reference screens (approved 2026-04-14, stitch project `2926819289448574055`):**
- `e1f5dd4cfe7d437c92844f85178defb2` — chat void with markdown + thinking
- `a0194c5dde06409abb14834eb0fd7c03` — citation pills + hovercard
- `dc26d3464bbf41339b8a816a9f5adcf6` — all-references helper panel
- `c28492deec024512946b955d518ec06f` — directory picker (standalone)
- `6a7ec821b9f04aad80079092dfcb8f7a` — directory picker in chat input context

**Remark citation plugin sketch:**
```ts
// app/utils/remark-citations.ts
export function remarkCitations() {
  return (tree: any) => {
    visit(tree, 'text', (node, index, parent) => {
      const re = /\[(\d+)\]/g
      // split node.value; replace matches with { type: 'cite', data: { hName: 'cite', hProperties: { index: n } } }
    })
  }
}
```

**Tri-state computation:** `computed(() => childrenSelected.length === 0 ? 'off' : childrenSelected.length === descendantCount ? 'on' : 'indeterminate')` — keep logic in `useReferenceScope`, not in the component.

**Why MDC over markdown-it:** first-class Nuxt SSR, Shiki theming, sanitize baked in, and Vue-component mapping from a single module — no custom glue.

## Verification

**Commands:**
- `pnpm lint` -- expected: no errors
- `pnpm typecheck` -- expected: no errors
- `pnpm test` -- expected: `convex/folders.test.ts` + `server/api/rag/chat.post.test.ts` extensions pass
- `pnpm test:component` -- expected: all new `tests/component/chat/*` pass
- `pnpm build` -- expected: production bundle builds (run only after `test:component` completes — never concurrent per project invariant)

**Manual checks:**
- Open a chat in a folder with ≥2 indexed PDFs; submit "summarize this folder with bullet points and a code snippet" → verify markdown + thinking → first token → streaming → citations with hovercard.
- Open directory picker; expand a folder; toggle partial selection; confirm parent goes indeterminate; submit — verify server log shows `scope` honored.
- Keyboard-only nav through picker: Tab/Shift-Tab reaches every row; Space toggles checkbox; Enter expands folder; Esc closes popover.

## Spec Change Log
