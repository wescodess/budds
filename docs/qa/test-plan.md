# Budds Test Plan

## Test Architecture Overview

Budds uses **Vitest 4** as its test runner across five test layers:

| Layer                     | Config                                    | Environment        | Key Libraries                                                                         |
| ------------------------- | ----------------------------------------- | ------------------ | ------------------------------------------------------------------------------------- |
| Convex integration        | `vitest.config.ts`                        | `edge-runtime`     | `convex-test`, `@faker-js/faker`                                                      |
| Server routes             | `vitest.config.ts`                        | `node`             | Vitest globals, manual stubs                                                          |
| Vue components            | `vitest.config.component.ts`              | `nuxt` (happy-dom) | `@nuxt/test-utils`, `@vue/test-utils`                                                 |
| Audio Overview components | `vitest.config.audio-component.ts`        | `nuxt` (happy-dom) | Mounted v1/v2 playback, realtime, sharing, deletion, alignment, and progress coverage |
| Audio Overview Workflow   | `workers/audio-overview/vitest.config.ts` | Workers runtime    | Renderer, orchestration, media, artifact, interjection, and quality fixtures          |

## How to Run Tests

```bash
# Convex + server tests (edge-runtime / node)
pnpm test

# Watch mode
pnpm test:watch

# Vue component tests (nuxt environment, happy-dom)
pnpm test:component

# Focused mounted Audio Overview tests
pnpm test:component:audio

# Durable Audio Overview Worker tests and typecheck
pnpm audio:workflow:test
pnpm audio:workflow:typecheck

# Component watch mode
pnpm test:component:watch
```

The test scripts use `vitest run` (single pass). Coverage tooling (`@vitest/coverage-v8`) is installed but not wired to a default script.

## Test Categories

### Convex Integration Tests (32 files, edge-runtime)

Located in `convex/*.test.ts` and `convex/lib/*.test.ts`.

Pattern: each test creates a fresh `convexTest(schema, modules)` instance, authenticates via `t.withIdentity()`, and exercises mutations/queries through the typed `api` object. Tests verify CRUD behavior, ownership guards, unauthenticated rejection, and cross-user isolation.

Covered modules:

- `conversations`, `messages`, `folders`, `documents`, `users`
- `flashcardRooms`, `quizzes`, `tasks`, `audioOverviews`, `audioOverviewInterjections`
- `documentActions`, `documentImports`, `accountDeletion`, `dataExport`
- `courses`, `courseSections`, `calendarConnections`, `calendarEvents`
- `learnSchema`, `learnProfile`, `reviewItems`, `contentFlags`, `migrations`
- `lib/sm2` (spaced-repetition algorithm, pure unit tests)

### Server Route Tests (30 files, node)

Located in `server/api/**/*.test.ts` and `server/utils/*.test.ts`.

Pattern: Nitro auto-imports (`readBody`, `createError`, `defineEventHandler`) are stubbed via `vi.stubGlobal`. External dependencies (AI gateway, Convex client) are mocked. Tests validate input validation (400/401/422), happy-path responses, LLM prompt construction, and response parsing.

Covered routes/utils:

- `flashcards/generate.post`, `quiz/generate.post`, `rag/chat.post`
- `audio-overview/generate.post`, `audio-overview/interject.post`, and v2 job/media/public/interjection routes
- `export/me.get`, `course/generate-outline.post`, `course/generate-section.post`
- Utils: `flashcard-prompt`, `quiz-prompt`, `interjection-prompt`, `audio-script-prompt`, `ai-gateway`, `ai-search`, `normalize-assistant-citations`, `session-composition`

### Vue Component Tests (95 files, nuxt/happy-dom)

Located in `tests/component/**/*.test.ts`.

Pattern: components are mounted with `mountSuspended` from `@nuxt/test-utils/runtime`. Tests assert rendered output, user interactions, and emitted events. Some files use ATDD-style naming (`.atdd.test.ts`).

Covered areas: app-shell, chat, dashboard, documents, folders, folder-shell, sidebar, quiz, flashcards, voids, audio-overview, learn, composables.

### Audio Overview Workflow Tests (7 files, Workers runtime)

Located in `workers/audio-overview/src/*.test.ts`.

The suite covers the exact Gemini model and fixed Hosts, native two-speaker requests, bounded Workflow retries and cancellation, private R2 artifact identity, PCM/WAV assembly, interjection rendering, and deterministic Quality Gate fixtures. It does not replace a paid real-provider run or acoustic listening evidence.

## Coverage Summary

As of 2026-09-05, the root suite passes 69 files with 1,008 tests passed and 8 skipped. The general mounted component suite passes 74 files (13 skipped) with 432 tests passed and 85 skipped. The focused mounted Audio Overview suite passes 10 files with 38 tests, and the Worker suite passes 7 files with 62 tests plus its standalone TypeScript check.

Component tests are run separately and not included in the default `pnpm test` run.

No coverage thresholds are currently enforced in CI.

## Audio Overview v2 Acceptance Status

This table records implementation evidence against `docs/plans/podcast-audio-overview-implementation-plan.md`; it is not a production-readiness declaration.

| Gate                          | Status  | Remaining evidence                                                                                                                    |
| ----------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| G1 Authority                  | PASS    | —                                                                                                                                     |
| G2 Durability                 | PASS    | —                                                                                                                                     |
| G3 Renderer                   | PASS    | —                                                                                                                                     |
| G4 Grounding                  | PASS    | —                                                                                                                                     |
| G5 Scene Quality              | FAIL    | Reliable acoustic speaker-count and cross-scene Host-identity evidence; tempo/truncation evidence beyond framing and duration proxies |
| G6 Media and privacy          | PASS    | —                                                                                                                                     |
| G7 Publication                | PASS    | —                                                                                                                                     |
| G8 Compatibility and realtime | PASS    | —                                                                                                                                     |
| G9 Interjection               | PARTIAL | One authenticated create-through-interject E2E run                                                                                    |
| G10 Operations                | FAIL    | Actual provider-cost reconciliation, CI/deployed probes, and an owner-triggered real generation                                       |
| G11 Listening                 | FAIL    | Blind three-source-set bake-off accepted by the owner                                                                                 |

Conceptual-course audio primers remain fail-closed until they launch and attach the same durable v2 Workflow. Standard rendering is wired locally; Batch economy mode and real-provider evidence remain release work.

## Testing Gaps

### Convex modules without tests (8 files)

| File                         | Risk                                             |
| ---------------------------- | ------------------------------------------------ |
| `convex/auth.ts`             | Auth setup; tested indirectly via identity stubs |
| `convex/http.ts`             | HTTP action router; hard to unit-test            |
| `convex/crons.ts`            | Scheduled jobs                                   |
| `convex/archiveMultiChat.ts` | Bulk archive mutation                            |
| `convex/courseSourceDocs.ts` | Course-source linking                            |
| `convex/sourceExtractors.ts` | Document parsing helpers                         |
| `convex/folderIcons.ts`      | Static data                                      |
| `convex/folderPalette.ts`    | Static data                                      |

### Server routes without tests (8 files)

| Route                             | Priority                   |
| --------------------------------- | -------------------------- |
| `chat/general.post`               | High -- main chat endpoint |
| `rag/search.post`                 | High -- document search    |
| `quiz/topics.post`                | Medium                     |
| `calendar/connect.get`            | Medium -- OAuth flow       |
| `calendar/callback.get`           | Medium -- OAuth callback   |
| `calendar/sync.post`              | Medium                     |
| `calendar/disconnect.post`        | Low                        |
| `learn/section-cache-payload.get` | Low                        |

### Other gaps

- Component coverage remains partial. Mobile and global components have minimal or no dedicated tests.
- **No E2E tests** -- end-to-end flows (login, folder creation, chat, quiz taking) are not automated.
- **CI is configured**, but current GitHub run health must be checked before release.
- **No coverage threshold enforcement.**

## Manual Testing Checklist

These areas require manual QA and cannot be fully automated with the current stack:

- [ ] Google OAuth login flow (redirect, callback, session creation)
- [ ] File upload and document processing pipeline (PDF, URL import)
- [ ] Real-time chat with AI (streaming responses, citation rendering)
- [ ] Owner-triggered Audio Overview generation through the durable Workflow and Gemini renderer
- [ ] Revision-frozen grounding, per-scene quality evidence, private WAV range playback, realtime alignment, cancellation, and separate interjection playback
- [ ] Three-source-set blind listening bake-off covering naturalness, emotion, pauses, voice consistency, fidelity, fatigue, latency, failures, and cost
- [ ] Flashcard practice session with spaced-repetition scheduling
- [ ] Quiz generation from folder content and quiz-taking flow
- [ ] Course creation, outline generation, and section content generation
- [ ] Calendar connection (Google Calendar OAuth) and event sync
- [ ] Offline mode (service worker caching, offline quiz retakes, sync on reconnect)
- [ ] Mobile responsive layout and touch interactions
- [ ] Cross-browser compatibility (Chrome, Safari, Firefox)
- [ ] Account deletion and data export (GDPR flows)
- [ ] Folder management (create, rename, delete, icon/color selection)
- [ ] Dark/light theme switching
- [ ] Breadcrumb navigation across nested routes
- [ ] Content flagging workflow
