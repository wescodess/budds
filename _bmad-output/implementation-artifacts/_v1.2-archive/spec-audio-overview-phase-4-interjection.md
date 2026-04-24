---
title: 'Audio Overview (Phase 4 Interjection) — Ask-the-hosts mid-playback'
type: 'feature'
created: '2026-04-17'
status: 'complete'
context:
  - 'notebooklm_audio_overview_plan.md'
  - 'DESIGN.md'
  - '_bmad-output/implementation-artifacts/spec-audio-overview-phase-3-share-ops.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The podcast is linear. A curious listener can pause but can't ask "wait — what does that mean?" and keep listening. The plan's Phase 4 flagship affordance is exactly this: interject with a question, hosts answer inline (2-4 turns), original playback resumes.

**Approach:** A new `audioOverviewInterjections` Convex table + owner-gated `publishOverview`-style mutations; a synchronous `/api/audio-overview/interject` POST that mirrors the Phase-1 pipeline (AI-Search chunks → OpenRouter script → per-turn MeloTTS → Convex `_storage` blobs) but sized to a **mini-script of 2-4 turns**; a new `InterjectModal` with text + optional-voice-via-`SpeechRecognition` input; and a store-level `spliceTurns({afterIndex, ...})` so the store's existing `ended`-listener advance loop plays the answer turns inline before the original next turn. The Ask button is authenticated-owner-only — never on the public `/audio/[token]` page.

## Boundaries & Constraints

**Always:**
- Interjection generation is **synchronous** — one round-trip to `/api/audio-overview/interject`, client shows a single indeterminate spinner + 8s UI safety net. No tasks row (fixed overhead ~5-10s for 3 turns is acceptable blocking latency).
- Reuse the overview's stored `voiceProfile` for TTS — answer hosts must sound like the podcast hosts.
- Reuse existing utilities: `searchDocuments` from `server/utils/ai-search.ts`, `generateCompletion` from `server/utils/ai-gateway.ts`, `synthesizeVoiceWithRetry` + `isAuraVoice` from `server/utils/tts-workers-ai.ts`, the existing `generateTurnUploadUrl` mutation, and Phase-2's best-effort cleanup pattern on mid-pipeline failure.
- Owner-gate every mutation/query that touches an overview row; the interjection row inherits the owner's check (no separate ACL — if you can read the overview, you can read its interjections).
- The Ask button is rendered ONLY on the authenticated `AudioOverviewPlayer`, never on `PublicAudioShell`.
- `SpeechRecognition` usage must feature-detect `window.SpeechRecognition || window.webkitSpeechRecognition`; if unavailable, hide the Speak tab and show a subtle `(voice not supported on this browser)` helper. No polyfills.
- `spliceTurns` inserts into `state.turns` / `state.turnUrls` atomically — both arrays updated in the same tick. Must handle the case where `currentTurnIndex > afterIndex` (already past the insertion point — splice still succeeds, turns just play later).
- All `SpeechRecognition` / `MediaRecorder` / `window` access SSR-gated.

**Ask First:**
- Any new env var (none expected — reuses existing AI Gateway config).
- Any new runtime dep (none expected).
- Any edit to `convex/accountDeletion.ts` / `convex/dataExport.ts` (interjections need cascade-delete parity).

**Never:**
- No Convex `internalAction` — the Nuxt route owns orchestration, same as Phase 1.
- No voice cloning or per-turn voice override — always use `overview.voiceProfile`.
- No persisting the user's raw audio blob — only the transcribed question text. Browser `SpeechRecognition` already does the transcription client-side.
- No retry/queue UI if the synchronous request times out — show an error toast and let the user re-ask.
- No PR targeting `main`. No Claude attribution. No `--no-verify`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error Handling |
|---|---|---|---|
| Happy text submit | `{ overviewId, afterIndex: 5, question: 'What is ATP?' }` | Server returns `{ interjectionId, answerTurnCount: 3, turns: [...], totalDurationMs }`; client `spliceTurns` at 5; playback resumes | — |
| Voice submit | User records, SpeechRecognition yields transcript | Transcript fills textarea; user clicks Ask to submit same flow as text | If recognition errors, toast + stay in Speak state |
| SpeechRecognition unsupported | `window.SpeechRecognition` undefined | Speak tab hidden; text-only with helper copy | — |
| Empty question | `question.trim().length === 0` | Client disables submit; server rejects 400 | Defense in depth |
| Oversized question | `question.length > 500` | Client caps textarea + counter turns rose; server truncates to 500 | No 4xx |
| Unowned overview | `ctx.db.get(overviewId).userId !== userId` | Server 404 | — |
| Overview not ready | `overview.status !== 'ready'` | Server 409 `Audio overview is not ready` | — |
| Empty indexed content | `searchDocuments` returns 0 chunks, folder has no docs | Server 422 `Not enough context to answer` | — |
| LLM returns 0 valid turns | Parser rejects response | Server 502 | — |
| Any turn TTS fails after 3 retries | `synthesizeVoiceWithRetry` throws | Best-effort cleanup of already-uploaded blobs; 502 | — |
| `afterIndex` out of range | `afterIndex < 0` or `> overview.turns.length` | Clamp server-side to `[0, overview.turns.length]` | — |
| Splice while playing turn=5, afterIndex=5 | Current turn's `ended` event fires after splice | Advances into inserted turns naturally | — |
| Splice while currentTurnIndex=8, afterIndex=5 | Already past insertion point | Splice succeeds; inserted turns play only if user scrubs back | — |
| 8s UI timeout exceeded | Server still processing | Toast error "Still thinking — please try again in a moment"; modal stays open; **no** retry-queue | Server may still succeed and write the row; client-side orphan is tolerable for MVP |
| User submits new interjection while one in flight | Button is disabled (client-side) | — | — |
| User closes modal mid-flight | AbortController aborts `fetch` | Client drops result; server continues and orphans the row (acceptable) | — |

</frozen-after-approval>

## Code Map

**New:**
- `convex/schema.ts` — add `audioOverviewInterjections` table: `audioOverviewId: v.id('audioOverviews')`, `userId: v.string()`, `insertedAfterTurnIndex: v.number()`, `question: v.string()`, `answerTurns: v.array(v.object({ speaker: 'host_a'|'host_b', text, audioFileId: v.id('_storage'), durationMs, sourceIndex? }))`, `model?: v.string()`. Indexes: `by_audioOverview`, `by_userId`.
- `convex/audioOverviewInterjections.ts` — `create` mutation (auth + owner-of-overview gate), `listByOverview` query (auth + owner), `deleteInterjection` mutation (auth + owner; cleans up `_storage` blobs best-effort). Import `requireAuth` from `audioOverviews.ts` or re-implement in-file.
- `convex/audioOverviewInterjections.test.ts` — auth + ownership for every public fn; create happy path + answerTurns shape; listByOverview ordering.
- `server/utils/interjection-prompt.ts` — `buildInterjectionPrompt({ question, overviewTitle, voiceProfile, chunks })` returning `ChatMessage[]`; `parseInterjectionResponse(raw)` with zod; schema mirrors `audio-script-prompt` but targets **2-4 turns** and folds the question into the system prompt as required context.
- `server/utils/interjection-prompt.test.ts` — prompt shape, parser happy/empty/trailing-comma cases.
- `server/api/audio-overview/interject.post.ts` — full pipeline. Body: `{ overviewId, insertedAfterTurnIndex, question }`. Auth via `getConvexTokenIdentifier`. Fetches overview via `api.audioOverviews.getWithTurns`, validates ready + ownership, pulls chunks via `searchDocuments` keyed to the overview's `sourceDocumentIds` (fallback to folder-docs if empty), calls LLM, synthesizes each turn using `overview.voiceProfile`, uploads blobs via `generateTurnUploadUrl`, then `audioOverviewInterjections.create`. Returns `{ interjectionId, answerTurnCount, turns: [{speaker, text, audioUrl, durationMs}], totalDurationMs }` (turns include freshly-signed URLs so the client can splice without a second round-trip). Best-effort blob cleanup on mid-pipeline failure.
- `app/components/audio-overview/InterjectModal.vue` — modal per approved design. Props: `{ open, overviewId, afterIndex, voiceProfile }`. Emits: `update:open`, `submitted: { interjectionId, turns, turnUrls }`. Three internal states: `idle` (mode toggle + text/voice input), `listening` (voice active), `submitting` (indeterminate spinner, 8s safety net). `navigator.userAgent` never checked; feature-detect `SpeechRecognition` only.
- `app/composables/useAudioOverviewStore.ts` — add `spliceTurns({ afterIndex, turns, turnUrls })` to the factory's return. Guards: `afterIndex` clamped to `[-1, state.turns.length-1]`; arrays spliced in one Vue-reactive mutation via `state.turns.splice(i, 0, ...newTurns)` + parallel `state.turnUrls.splice(...)`.
- `convex/_generated` updates via schema.

**Modified:**
- `app/components/audio-overview/AudioOverviewPlayer.vue` — add 'Ask' ghost pill (Mic icon) to the header action row, to the left of Customize. Disabled while `props.interjectionInFlight === true`. Emits `request-ask`.
- `app/components/audio-overview/AudioOverviewShell.vue` — host `InterjectModal`; listen for Player `request-ask`; state `interjectionInFlight: ref<boolean>`; on modal's `submitted`, call `store.spliceTurns(...)` and auto-resume playback.
- `app/components/audio-overview/AudioOverviewCard.vue` — no changes (Ask button is on Player only).
- `app/components/audio-overview/PublicAudioShell.vue` — no changes (no Ask button; confirmed by the public-only-read constraint).

## Tasks & Acceptance

**Execution:**
- [ ] `convex/schema.ts` — add audioOverviewInterjections + indexes
- [ ] `convex/audioOverviewInterjections.ts` — create / listByOverview / deleteInterjection
- [ ] `convex/audioOverviewInterjections.test.ts` — auth + ownership + happy path
- [ ] `server/utils/interjection-prompt.ts` — buildInterjectionPrompt + parse
- [ ] `server/utils/interjection-prompt.test.ts` — prompt + parser tests (mirror audio-script-prompt)
- [ ] `server/api/audio-overview/interject.post.ts` — full pipeline
- [ ] `app/composables/useAudioOverviewStore.ts` — spliceTurns
- [ ] `app/components/audio-overview/InterjectModal.vue` — 3-state modal
- [ ] `app/components/audio-overview/AudioOverviewPlayer.vue` — Ask ghost pill, in-flight disabled state
- [ ] `app/components/audio-overview/AudioOverviewShell.vue` — host modal, wire splice + resume

**Acceptance Criteria:**
- Given an owner on the Player mid-playback at turn 5, when they click Ask, type a question, and submit, then within ~10s the server returns 2-4 answer turns, `spliceTurns` inserts them at afterIndex=5, the modal closes, and audio resumes — the next turn the user hears is the interjection's first answer turn.
- Given a browser with `SpeechRecognition`, when the user picks Speak and records "What does chloroplast mean?", then the live transcript fills the textarea and submitting follows the same flow as text input.
- Given a browser without `SpeechRecognition`, when the modal opens, then only the Type tab is shown with the helper "(voice not supported on this browser)".
- Given a public listener on `/audio/[token]`, the Ask button is NOT rendered anywhere on the page.
- Given a request for an unowned overview or status != 'ready', the server responds 404/409 and the interjection row is not created.

## Spec Change Log

### R1 (2026-04-17) — post-review loopback

Adversarial review: blind-hunter FAIL (1C+3M+2Min), edge-case-hunter FAIL (4M+2Min), acceptance-auditor PASS (5/5). 7 unique defects consolidated. Fixes:

1. **[R1 amend] Splice preservation** — `loadOverview` must NOT reassign `state.turns`/`state.turnUrls` when `isSameOverview && spliceApplied` is true. Track a module-level `spliceApplied` flag per factory instance; set `true` in `spliceTurns`, reset in `dismiss` and on different-overview load. URL refresh beyond the splice boundary is deferred.
2. **[R1 amend] Real in-flight window** — `InterjectModal` emits a second event `submit-start: { question }` when the API call begins; `AudioOverviewShell` listens and sets `interjectionInFlight=true` + `interjectionQuestion=question`. Clear both after splice + resume. The Player banner now renders during the actual fetch.
3. **[R1 amend] Fix store tautology** — replace `state.currentTurnIndex >= insertAt && insertAt <= state.currentTurnIndex` with a single `>= insertAt` check and correct the comment.
4. **[R1 amend] Snapshot afterIndex at Ask time** — `Shell.handleRequestAsk` captures `store.currentTurnIndex.value` into a local ref `pendingAskAfterIndex`; `InterjectModal` receives that stable value, not the reactive live index. Scrubbing during the modal flow no longer shifts the splice target.
5. **[R1 amend] Wire AbortController to cancel + unmount** — lift the modal's AbortController into a ref scoped to the component. Cancel button becomes enabled during submit and aborts the fetch. Modal unmount also aborts. Close flow clears the pending request.
6. **[R1 amend] SpeechRecognition double-tap race** — before calling `r.stop()` in `stopRecognition`, null out `r.onend`, `r.onresult`, `r.onerror` so stale events from prior sessions can't reach the live status state.
7. **[R1 amend] Extend timeout + enable Cancel** — raise the safety-net timeout to 20s (worst-case 4-turn synth). Cancel stays enabled during submit and aborts via the shared AbortController.

**Deferred (explicit KEEP):**
- Clamp-range drift across route/mutation/store (no functional break today; normalize when someone next edits a clamp). Logged to `deferred-work.md`.
- LLM speaker-order validation — voices map per-turn so non-host-A-first responses render correctly. Not a defect.


## Design Notes

The synchronous-route choice trades server pressure for UX simplicity. A 3-turn interjection is roughly 3× (LLM call) + 3× (Aura TTS ~1-3s each) + 3× (Convex blob upload). Empirically that's 5-10s — a single spinner with an 8s UI safety net is acceptable for a one-shot user-initiated action. If the route ever regresses past 12s P95 we move to a tasks-row pattern and poll.

Playlist splice uses mutable `Array.prototype.splice` on the reactive arrays because Vue's reactivity wrapper tracks array-length changes. The `ended` listener's `currentTurnIndex + 1` advances naturally into the inserted block. No separate "interjection" mode in the store — the playlist is just a flat array that happens to have inserted turns.

`SpeechRecognition` is event-based; we use `continuous=true, interimResults=true` to get the live transcript. On error (`no-speech`, `aborted`) we fail gracefully by filling the textarea with whatever partial transcript we captured and flipping back to Type mode. No analytics, no retries — the user clicks the mic again.

## Verification

**Commands:**
- `pnpm test` — expect: all green, +interjection tests (~8 new)
- `pnpm test:component` — expect: baseline unchanged

**Manual checks:**
- DevTools: only one `<audio>` element per surface. After splice, `state.turns.length` increased by answerTurnCount.
- Network: POST /api/audio-overview/interject body includes `overviewId`, `insertedAfterTurnIndex`, `question`. Response includes `turns[].audioUrl`.
- Public route `/audio/<token>`: no Ask button in DOM (query-select for `[data-testid="audio-overview-ask-btn"]` → not found).
