---
title: 'Audio Overview (Phase 1 MVP) — NotebookLM-style conversational podcast Void'
type: 'feature'
created: '2026-04-17'
status: 'ready-for-dev'
context:
  - 'docs/archive/plans/audio-overview-v1-implementation-plan.md'
  - 'DESIGN.md'
  - 'convex/_generated/ai/guidelines.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Folders hold rich indexed content but no way to passively consume it. Students want to listen to their notes like NotebookLM's Audio Overview — two AI hosts discussing their sources.

**Approach:** Add an **Audio Overview** Void type. `CreateVoidDialog` gets a 4th tile; a Nuxt server route pulls folder chunks (`searchDocuments`), asks OpenRouter (AI Gateway) for a two-host dialogue script, synthesizes each turn with Cloudflare Workers AI `@cf/myshell-ai/melotts`, uploads MP3 blobs to Convex `_storage` via signed upload URLs, and writes an `audioOverviews` row referencing per-turn storage IDs. Client subscribes to the existing `tasks` reactive query; when ready the folder renders `AudioOverviewShell`, which plays turns sequentially through a single `<audio>` element.

## Boundaries & Constraints

**Always:**
- Follow the **quiz-generation pattern** exactly: Nuxt route owns the whole pipeline, progress via `ConvexHttpClient` → `api.tasks.setProgress`, final mutation inserts the row, `api.tasks.markComplete` at the end, `api.tasks.markFailed` on error.
- Every new Convex function validates auth via `ctx.auth.getUserIdentity()` and folder ownership; never accept `userId` as an arg.
- Audio stored as `audio/mpeg` Blob in Convex `_storage`; turn rows reference `v.id('_storage')`.
- Task type string: `'audio-overview-generation'`. Progress labels: `Retrieving sources…`, `Writing dialogue…`, `Synthesizing turn {i}/{n}…`.
- Script system prompt enforces **source grounding** (explicit "don't fabricate" rule) and returns strict JSON only.
- UI matches the approved Stitch screens (card in folder's Void area, two host **orbs as pure amber/gold circular divs — no avatars/photos**, amber scrubber, central amber play button, ±15s skip, speed pill, source pills). `Download` / `Share` rendered as ghost buttons with muted `Soon` chips (disabled, Phase 2).
- Use existing Ui primitives (`UiDialog`, `UiButton`, etc.).
- Server reads env via `readConfiguredRuntimeValue` and fails closed on missing config.

**Ask First:**
- Any new Convex env var (none expected — TTS reuses the existing AI Gateway config).
- Any change to `tasks` or `folders` schema (none expected).
- Any edit to `convex/accountDeletion.ts` or `convex/dataExport.ts`.

**Never:**
- No Convex `internalAction` for the synthesis loop — Nuxt route owns orchestration.
- No client-side concat to single MP3, sticky mini-player, visualizer (waveform/AnalyserNode), customize dialog, download, share, or interjection — all Phase 2+.
- No `"use node"` anywhere (default runtime only).
- No PR targeting `main` — base = `dev`. No Claude attribution.
- No `--no-verify`, no `git add -A`/`.`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error Handling |
|---|---|---|---|
| Happy path | Folder with ≥1 `success` doc | Task progresses through the 3 labels, completes with `{ overviewId }`; UI swaps Generating → Player via reactivity | — |
| Empty folder | 0 indexed docs | POST → `422` `Not enough indexed content for an audio overview`; CreateVoidDialog disables the tile with tooltip | Task, if created, marked failed |
| Script parses empty | LLM returns 0 valid turns | Fail task, return `502` | — |
| TTS 5xx / timeout | Single turn fetch fails | Per-turn retry 3× with 500/1000/2000 ms backoff; then fail task with turn index | — |
| Turn text too long | Turn > 1800 chars | Soft-split at sentence boundary preserving speaker | If no boundary, truncate + log |
| User cancels mid-run | `task.status === 'cancelled'` | Loop checks before each turn synth, aborts, no overview row inserted | Orphan blobs accepted for MVP |
| Player turn swap | `<audio>` `ended` on turn i | Advance index, set `src` to i+1, preload i+1 500ms before i ends | If next URL fetch fails, stop + surface inline error |
| Scrub across turns | Drag to absolute ms S | Prefix-sum `durationMs` to find turn, swap src, seek within | Clamp to last turn on overshoot |

</frozen-after-approval>

## Code Map

**New:**
- `convex/schema.ts` — add `audioOverviews` table: `folderId`, `userId`, `taskId`, `title`, `status: 'generating'|'ready'|'failed'`, `turns: Array<{speaker: 'host_a'|'host_b', text, audioFileId: Id<'_storage'>, durationMs, sourceIndex?}>`, `voiceProfile: {hostA, hostB}`, `totalDurationMs`. Indexes: `by_userId`, `by_folderId`, `by_userId_and_folderId`.
- `convex/audioOverviews.ts` — `createWithTurns` (mutation), `listByFolder` / `getWithTurns` / `getTurnUrls` (queries), `deleteOverview` (mutation), `generateTurnUploadUrl` (mutation → `storage.generateUploadUrl()`, auth-gated).
- `server/api/audio-overview/generate.post.ts` — full pipeline (auth → task → chunks → script → per-turn TTS + upload + createWithTurns → markComplete).
- `server/utils/audio-script-prompt.ts` — `buildAudioScriptPrompt(chunks, options)` + `parseAudioScriptResponse(raw)`; zod schema `{ title, turns: [{ speaker, text, sourceIndex }] }`.
- `server/utils/tts-melotts.ts` — `synthesizeMeloTTS({ text, lang })` → AI Gateway `@cf/myshell-ai/melotts`, returns `Uint8Array`; `synthesizeWithRetry` wraps it.
- `app/components/voids/CreateVoidDialog.vue` — add `'audio-overview'` to `VoidType`, 4th tile (icon `Headphones`, subtitle "Two AI hosts discuss this folder"). Disable when folder has 0 `success` docs.
- `app/components/audio-overview/AudioOverviewShell.vue` — state machine: Card | Generating | Player based on `listByFolder` + `listByFolder` tasks.
- `app/components/audio-overview/AudioOverviewCard.vue` — ready state per Stitch design.
- `app/components/audio-overview/AudioOverviewGenerating.vue` — generating state; 3-step checklist derived from `task.progress`; Cancel wired to `api.tasks.cancel`.
- `app/components/audio-overview/AudioOverviewPlayer.vue` — player void per Stitch design; consumes `useAudioOverviewPlayer`.
- `app/composables/useAudioOverviewPlayer.ts` — `currentTurnIndex`, `isPlaying`, `currentTimeMs`, `totalDurationMs`, `play/pause/skip(deltaMs)/seek(absMs)/setSpeed`; preloads `turns[i+1]`.
- `app/pages/app/folders/[id].vue` — render `AudioOverviewShell` when active void type is `audio-overview`.

**Tests (new):**
- `convex/audioOverviews.test.ts` — auth + ownership + scope for every public function.
- `server/utils/audio-script-prompt.test.ts` — prompt shape + parser valid/invalid/empty/trailing-comma cases.

## Tasks & Acceptance

**Execution:**
- [ ] `convex/schema.ts` — add `audioOverviews` table + indexes
- [ ] `convex/audioOverviews.ts` — implement all mutations + queries
- [ ] `convex/audioOverviews.test.ts` — auth/ownership tests
- [ ] `server/utils/audio-script-prompt.ts` — build + parse with zod
- [ ] `server/utils/audio-script-prompt.test.ts` — edge-case tests (mirror `quiz-prompt.test.ts`)
- [ ] `server/utils/tts-melotts.ts` — TTS wrapper + retry
- [ ] `server/api/audio-overview/generate.post.ts` — full pipeline
- [ ] `app/components/voids/CreateVoidDialog.vue` — add 4th tile + disabled-empty-folder state
- [ ] `app/components/audio-overview/AudioOverviewCard.vue`
- [ ] `app/components/audio-overview/AudioOverviewGenerating.vue`
- [ ] `app/components/audio-overview/AudioOverviewPlayer.vue` (pure circular orbs — no photos)
- [ ] `app/components/audio-overview/AudioOverviewShell.vue`
- [ ] `app/composables/useAudioOverviewPlayer.ts`
- [ ] `app/pages/app/folders/[id].vue` — wire `audio-overview` void type
- [ ] **[R1 amend]** `app/components/voids/CreateVoidDialog.vue` — fail-safe disabled check: `(props.indexedCount ?? 0) === 0` (not `?? 1`)
- [ ] **[R1 amend]** `server/api/audio-overview/generate.post.ts` — always call `failTask` on any thrown error reaching the outer catch (remove 422/502 skip); enforce `MAX_TURNS=50` slice + `MIN_TURNS=3` floor; track uploaded storage IDs and best-effort delete on mid-pipeline failure
- [ ] **[R1 amend]** `convex/audioOverviews.ts` — add `deleteOrphanTurnBlob` auth-gated mutation that deletes a single `_storage` ID without requiring a referencing overview row
- [ ] **[R1 amend]** `app/components/audio-overview/AudioOverviewShell.vue` — select active task by `_creationTime desc` (newest first)
- [ ] **[R1 amend]** `app/composables/useAudioOverviewPlayer.ts` — on final-turn `ended`, set `currentAudioTimeSec` to the turn's full duration (not `0`)
- [ ] **[R1 amend]** `app/components/audio-overview/AudioOverviewPlayer.vue` — resolve source filenames via `useDocuments` to render real document names in source pills

**Acceptance Criteria:**
- Given a folder with ≥1 `success` document, when the user selects Audio Overview in `CreateVoidDialog` and submits, then a `audio-overview-generation` task runs through the 3 progress labels and completes with an `audioOverviews` row containing ≥3 storage audio blobs; the folder UI auto-swaps Generating → Player via Convex reactivity.
- Given a `ready` overview, when the user presses Play, then turns play back-to-back with no audible gap >500 ms; `±15s` works across turn boundaries; scrubbing seeks correctly; speed selector changes `audio.playbackRate`.
- Given 0 indexed docs, when `CreateVoidDialog` opens, then the Audio Overview tile is disabled with a tooltip.
- Given a running task, when the user clicks Cancel in the generating card, then `api.tasks.cancel` fires, the server aborts before the next turn, and no overview row is inserted.
- Given MeloTTS returns 5xx, the server retries up to 3× with backoff before failing the task with the turn index.
- `pnpm typecheck` + `pnpm test` pass (including the two new test files). No new lint errors.

## Spec Change Log

### Round 1 loopback (2026-04-17)

**Findings:** edge-case-hunter FAIL (3 critical), blind-hunter FAIL (3 critical), acceptance-auditor PASS. Consolidated critical fixes — all user-visible correctness or storage-leak risks the spec already flagged but implementation didn't fence.

**Amended:**
- **Boundary: `CreateVoidDialog` disabled default** — when `indexedCount` prop is `undefined` (SSR/early-render), the tile MUST default to **disabled** (fail-safe), not enabled. Change `(props.indexedCount ?? 1)` → `(props.indexedCount ?? 0)` in the disabled check.
- **Always-fail-on-error** — `server/api/audio-overview/generate.post.ts` outer catch must call `failTask` on ANY thrown error that reaches it (including 422 and 502), not skip them. Previous logic left tasks stuck in `running` when the pipeline threw 502 ("no valid turns"), causing the Shell to show Generating forever after reload.
- **Turn-count cap + floor** — after `splitOversizedTurns`, enforce `MAX_TURNS=50` (slice) and `MIN_TURNS=3` (fail task with explanatory error if fewer). Prevents unbounded cost/time from rogue LLM output AND enforces the AC's "≥3 storage audio blobs" guarantee.
- **Orphan blob cleanup on pipeline failure** — track all uploaded `_storage` IDs; on any throw after the first upload, best-effort delete each before re-raising. Add a new Convex mutation `audioOverviews.deleteOrphanTurnBlob` (auth-gated, deletes a single `_storage` ID without requiring an overview row).
- **Shell picks newest task, not first** — `AudioOverviewShell.activeTask` must select by `_creationTime desc` (not `.find(first)`), so a retry after a failure tracks the new task rather than the stale one.
- **Player final-turn display** — when the final turn's `ended` event fires, set `currentAudioTimeSec` to that turn's full duration (not `0`), so `currentTimeMs === totalDurationMs` on completion. Prevents the cosmetic "rewind to start of last turn" jump.
- **Source pills show filenames** — `AudioOverviewPlayer` must resolve `overview.sourceDocumentIds` against the folder's documents (via `useDocuments`) to render real filenames, not placeholder `source 1, 2, 3`.

**Newly deferred:**
- **Convex storage URL expiry during long pauses** (→ `deferred-work.md`): `getTurnUrls` returns URLs with ~30-min TTL. If the user pauses for an hour, a null inline error appears in the player but no auto-refresh. Acceptable MVP behavior; add a re-fetch on `play()` attempt in Phase 2.
- **AbortSignal for mid-turn TTS cancellation** (→ `deferred-work.md`): `synthesizeWithRetry` can consume up to ~10–30s of user-perceived cancel-wait time before the outer loop's `isTaskCancelled` check runs again. Acceptable MVP; plumb a shared AbortSignal through `synthesizeMeloTTS` and `fetch` in Phase 2.
- **Scrubber floating-point boundary edge case** (→ `deferred-work.md`): theoretical; user-unreachable given 10 ms clamp. Noted.

**KEEP (worked well, do not re-derive):**
- The Nuxt-route-owns-pipeline architecture (quiz pattern). Reviewers validated auth, cancel path, progress labels, retry backoff, test coverage all match spec.
- All Task files + ACs are evidenced in code per acceptance-auditor; loopback only amends behavior around edge-cases, not architecture.


## Design Notes

- Architecture mirrors `server/api/quiz/generate.post.ts` verbatim — keep env + AI Gateway config in the Nuxt runtime where they already live.
- Per-turn upload: (1) `generateTurnUploadUrl` → (2) POST MP3 bytes → `{ storageId }` → (3) pass all `{audioFileId: storageId}` into `createWithTurns`.
- `durationMs` estimate = `Math.ceil(text.length / 14) * 1000` (~150 wpm). Drives scrubber math only; active-turn progress is read from real `<audio>`.
- Voice defaults (non-configurable in MVP): `hostA = { lang: 'en' }` expert, `hostB = { lang: 'en', pitch: -0.05 }` learner. Treat Workers AI speaker params as best-effort; if API only returns one voice, use a small `pitch`/`playbackRate` nudge on host_b.
- Script budget: 10 min × ~150 wpm ≈ 1,500 words; LLM target 24–40 turns, ~alternating speakers, 1–4 sentences per turn.
- Chunk retrieval seed: `'key concepts, definitions, discussions, and themes'`, `max_num_results: 20`, `score_threshold: 0.05`. Fall back to `fetchFolderDocs` when <2 chunks returned (same pattern as quiz).
- Deferred (Phase 2+): customize dialog, sticky mini-player, client-side concat + download, share / public page, audio visualizer, interjection, per-user quota, precise duration via ffprobe, voice variety. See `deferred-work.md` under `audio-overview-mvp`.

## Verification

**Commands:**
- `pnpm typecheck` — expected: 0 errors
- `pnpm test` — expected: all pass, including both new test files
- `pnpm test:component` — expected: pass (never concurrent with `pnpm build`)

**Manual (dev server on :3002):**
- Folder with indexed PDF → CreateVoidDialog shows 4 tiles, Audio Overview enabled. Submit → task progresses → Player appears ~2–4 min later.
- Play → pure circular orbs switch active treatment on turn boundaries; ±15s works across boundaries; scrub seeks; speed works.
- Empty folder → tile disabled with tooltip.
- Cancel mid-generation → task `cancelled`, no overview row.
