# Story: prep-3-5-fix-baseline-test-failures

## Status: done

## Description
Fix pre-existing test failures on the dev baseline. Zero baseline failures in `pnpm test` and `pnpm test:component`. Tests that cannot be fixed due to major architectural changes are `.skip`'d with a comment linking to deferred-work.md.

## Tasks
- [x] Fix `server/utils/audio-script-prompt.test.ts` Convex test failure
- [x] Fix `tests/component/documents/file-upload-zone.test.ts` (4 failures)
- [x] Fix `tests/component/folder-shell/folder-shell.test.ts` (1 failure, CSS shorthand)
- [x] Fix `tests/component/folder-shell/file-row.test.ts` (2 failures, icon-only buttons)
- [x] Fix `tests/component/app-shell/folder-breadcrumb.test.ts` (1 failure, href path)
- [x] Fix `tests/component/chat/chat-message.test.ts` (5 failures, async markdown)
- [x] Fix `tests/component/chat/reference-scope-rules.test.ts` (2 failures, expose API)
- [x] Fix `tests/component/documents/move-to-folder-dialog.test.ts` (3 failures, portal)
- [x] Triage and skip tests requiring major rewrites
- [x] Run full test suites to verify zero failures
- [x] Commit, push, open PR

## Acceptance Criteria
- [x] `pnpm test` passes with zero failures
- [x] `pnpm test:component` passes with zero failures
- [x] Skipped tests have clear comments explaining why

## Dev Agent Record

### Decisions

1. **audio-script-prompt test**: The production code intentionally strips all parenthesized content in default mode for TTS safety. Updated test to match production behavior and added two new test cases for `preserveExpressions` mode.

2. **FileUploadZone tests**: Component was updated to support multiple file types (PDF, DOCX, XLSX, TXT, MD, CSV, HTML, PNG, JPG, WEBP, GIF) beyond just PDFs. Updated test assertions to match current multi-file-type behavior.

3. **Page-level tests (folder-view, folder-documents, folder-chat-layout)**: These mount the full `[id].vue` page which now uses `provideFolderPageContext()` — a composable that internally creates Convex WebSocket connections and composes 15+ dependencies. The mock surface required exceeds what `mockNuxtImport` can provide (Nuxt route objects need `matched`, `meta`, etc.). Skipped with recommendation to rewrite as isolated component tests.

4. **QuizTab tests (4 skipped)**: QuizShell was refactored to auto-select the first quiz on load (showing QuizActiveView) instead of rendering an inline card list. The card-menu, delete-flow, shimmer, and list-rendering tests test an API that no longer exists. Skipped.

5. **FolderFormModal touch-focus test**: The `createSharedComposable(useGestureGuards)` singleton evaluates `useMediaQuery` only once per module lifecycle. `vi.resetModules()` + `mockMatchMedia()` doesn't reliably reset the singleton in the test environment. Skipped.

6. **reference-scope-rules**: Changed from `expose()` + type-cast to returning scope from setup function directly, fixing access via `wrapper.vm`.

7. **file-row swipe tests**: Buttons changed from text labels to icon-only with `aria-label`. Updated assertions to check `aria-label` attributes instead of `.text()`.

8. **move-to-folder-dialog**: Dialog portals content to document.body. Updated tests to use `attachTo: document.body` and `document.querySelector` instead of `wrapper.find`.

9. **folder-breadcrumb**: Home link uses `href="/"` not `href="/app"`. Updated selector.

10. **folder-shell CSS**: Happy-dom renders `flex` shorthand as longhand properties. Updated assertion from `flex: 0 0 calc(...)` to `flex-basis: calc(...)`.

### File List
- `server/utils/audio-script-prompt.test.ts`
- `tests/component/documents/file-upload-zone.test.ts`
- `tests/component/documents/folder-documents.test.ts`
- `tests/component/documents/move-to-folder-dialog.test.ts`
- `tests/component/folders/folder-form-modal.test.ts`
- `tests/component/folders/folder-view.test.ts`
- `tests/component/folder-shell/folder-shell.test.ts`
- `tests/component/folder-shell/file-row.test.ts`
- `tests/component/app-shell/folder-breadcrumb.test.ts`
- `tests/component/chat/chat-message.test.ts`
- `tests/component/chat/reference-scope-rules.test.ts`
- `tests/component/chat/folder-chat-layout.test.ts`
- `tests/component/quiz/quiz-tab.test.ts`

### Change Log
- Fixed 1 Convex test failure (audio-script-prompt parenthesis stripping)
- Fixed 17 component test failures across 8 files
- Skipped 15 tests across 5 files that require major mock/component rewrites
- Added 2 new test cases for `sanitizeTurnForSpeech` preserveExpressions mode
- Zero test failures in both `pnpm test` (512 pass) and `pnpm test:component` (285 pass)
