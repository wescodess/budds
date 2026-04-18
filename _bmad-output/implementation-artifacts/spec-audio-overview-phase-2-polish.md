---
title: 'Audio Overview (Phase 2 Polish) — Customize dialog, visualizer, sticky mini-player, download'
type: 'feature'
created: '2026-04-17'
status: 'ready-for-dev'
context:
  - 'notebooklm_audio_overview_plan.md'
  - 'DESIGN.md'
  - '_bmad-output/implementation-artifacts/spec-audio-overview-mvp.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** MVP ships with fixed defaults (10 min / beginner / asteria+orion), a static two-orb UI, no download, and playback that dies on navigation. Users want agency over length/complexity/voice, a live visualizer that reinforces "who's talking", persistent playback across folders, and the ability to take the MP3 offline.

**Approach:** Four tightly coupled polish changes: (1) `AudioOverviewCustomize` dialog captures `{ lengthMinutes, complexity, voiceProfile }` before generation and is wired from both CreateVoidDialog and the regenerate CTA; (2) the existing host orbs get AnalyserNode-driven ring-pulse animation with a pure-CSS fallback; (3) a module-singleton playback store plus a root-level `<audio>` element and `StickyMiniPlayer` let playback survive route navigation; (4) `Download` concatenates the per-turn MP3 blobs client-side (naive byte concat — same codec/bitrate) into a single file.

## Boundaries & Constraints

**Always:**
- Playback engine MUST be a single shared singleton mounted at layout root — never duplicate `<audio>` elements across the Player view and the sticky bar. Player view and mini-player both read from the same store.
- `server/api/audio-overview/generate.post.ts` MUST accept `voiceProfile: { hostA: AuraVoice, hostB: AuraVoice }` in the body and validate each against the `AuraVoice` union; fall back to defaults on missing/invalid values.
- Customize dialog is the ONLY entry point to generation — remove the hardcoded `{ lengthMinutes: 10, complexity: 'beginner' }` from `AudioOverviewShell.handleGenerate`.
- Host orbs stay **pure amber/gold circular divs** — never avatars or photos. Ring-pulse is CSS `@keyframes` on layered `::before`/`::after` or absolute-positioned divs animated via `requestAnimationFrame` driven by AnalyserNode FFT magnitude.
- Download concatenates MP3 bytes raw (no re-encode). No new runtime deps (no lamejs, no ffmpeg, no pinia).
- Sticky bar hides when the user is on the folder page matching the active overview's folder (avoid duplicate UI on the same surface) AND when `activeOverviewId === null`.
- All new files use `<ClientOnly>` or `import.meta.client` guards as needed — the store must be SSR-safe (no `window`/`AudioContext` at module load).

**Ask First:**
- Any new env var (none expected — reuses existing AI Gateway config).
- Any change to `convex/schema.ts` or the `audioOverviews` table shape.
- Any edit to `convex/accountDeletion.ts` / `convex/dataExport.ts`.

**Never:**
- No Pinia (not in deps). Shared state lives in a Nuxt module-level `reactive()` exposed via composable.
- No lamejs / Web Audio decode-and-reencode for download. Naive MP3 byte-concat only.
- No duplicate `<audio>` elements playing simultaneously.
- No auto-opening the mini-player on first mount; only when playback has started.
- No `--no-verify`, no `git add -A`/`.`. PR base = `dev`. No Claude attribution.
- No concat of per-turn MP3s on the server (Cloudflare Pages has no ffmpeg).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error Handling |
|---|---|---|---|
| Customize → generate (happy) | Dialog submits `{ 10, 'beginner', {hostA:'asteria', hostB:'orion'} }` | POST body carries `preferences` + `voiceProfile`; task starts; dialog closes | — |
| Customize with only length changed | `{ 20, default, default }` | Body carries new length + default complexity/voices | — |
| Unknown voice in body | `voiceProfile.hostA: 'foo'` | Server substitutes default `asteria`/`orion`; logs warn; continues | No 4xx |
| Visualizer — audio playing | AudioContext created on first user gesture | Active orb scales `1→1.08` with FFT magnitude via `requestAnimationFrame`; inactive orb idle | If `AudioContext` unavailable, fall back to pure-CSS `animate-pulse` rings |
| Visualizer — not yet played | No user gesture yet; AudioContext suspended | Orbs render static (active amber-glow ring only), no console errors | AudioContext `suspend`/`resume` tolerated |
| Sticky — user navigates off folder | Overview playing, user clicks Home | Bar appears fixed bottom, audio keeps playing | — |
| Sticky — user clicks Expand | Bar Expand button | `navigateTo('/app/folders/<folderId>')` | — |
| Sticky — user clicks Close | Bar X button | Pause, clear `activeOverviewId`, bar hides; audio element src cleared | — |
| Download — all URLs present | N turns with fresh Convex URLs | Fetch each URL as `arrayBuffer`, concat into one `Uint8Array`, Blob `audio/mpeg`, trigger `<a download>` | — |
| Download — 1 URL null | `turnUrls[k] === null` | Skip that turn, concat rest, toast warning "Some segments couldn't be loaded; the download is partial" | Still complete; filename unchanged |
| Download — fetch rejects | Network error mid-loop | Abort download, toast error with turn index, no file saved | — |
| Concurrent overviews | User starts a new overview while one is playing | New generation task proceeds normally; store replaces active overview on Shell re-render | No race; store is idempotent per `overviewId` |

</frozen-after-approval>

## Code Map

**New:**
- `app/components/audio-overview/AudioOverviewCustomize.vue` — Dialog with Length (5/10/20), Complexity (beginner/expert), Voices (two rows with `AuraVoice` dropdowns grouped female/male). Emits `submit: { lengthMinutes, complexity, voiceProfile }` + `cancel`.
- `app/components/audio-overview/StickyMiniPlayer.vue` — Fixed-bottom bar (64px), renders when `store.activeOverviewId && !onActiveFolderRoute`. Left: 24px amber orb + title + `Host X · m:ss / m:ss`. Center: 36px play/pause amber button. Right: 120px progress track + Expand + Close. Mobile collapses right cluster.
- `app/composables/useAudioOverviewStore.ts` — Module-singleton store via `reactive()` + `shallowRef` for the `HTMLAudioElement`. Exposes: `activeOverviewId`, `activeFolderId`, `title`, `turns`, `turnUrls`, `currentTurnIndex`, `currentTimeMs`, `totalDurationMs`, `isPlaying`, `playbackRate`, `activeTurn`, `attachAudio(el)`, `loadOverview({overviewId, folderId, title, turns, turnUrls})`, `play()/pause()/togglePlay()`, `skip(deltaMs)/seek(absMs)/setSpeed(rate)`, `dismiss()` (pause + clear state + empty `<audio>.src`). SSR-safe: all `window`/`AudioContext` access gated by `import.meta.client`.
- `app/composables/useAudioOverviewVisualizer.ts` — Attaches `AnalyserNode` to the store's `<audio>` element via `MediaElementAudioSourceNode`. Returns reactive `magnitude: Ref<number>` (0–1) via `requestAnimationFrame`. Resumes `AudioContext` on first user gesture. Lazy — only creates context when the Player view consumes it.
- `app/composables/useAudioOverviewDownload.ts` — `downloadOverview({overviewId, title, turnUrls})`: `Promise.all` fetches each URL as `arrayBuffer`, concat via `Uint8Array(totalLen)`, new `Blob([buf], { type: 'audio/mpeg' })`, `<a download>` trigger, revoke URL. Returns `{ ok, skipped, total }`.
- `app/composables/useAudioOverviewDownload.test.ts` — unit-tests concat util with mocked `fetch`: happy, 1 URL null (skipped), fetch rejects (throws).

**Modified:**
- `server/api/audio-overview/generate.post.ts` — Extend body type with `voiceProfile?: { hostA?: string; hostB?: string }`. Validate against `AuraVoice` union from `server/utils/tts-workers-ai.ts` (export `AURA_VOICES` const set). Unknown voice → fall back to default + `console.warn`. Pass resolved `voiceProfile` to `createWithTurns` as today.
- `app/components/audio-overview/AudioOverviewShell.vue` — Introduce `customizeOpen: Ref<boolean>` + `customizeMode: 'initial' | 'regenerate'`. `handleGenerate()` opens dialog. Dialog `submit` handler performs the existing `createTaskMutation` + `$fetch('/api/audio-overview/generate', …)` with the captured preferences + voiceProfile. Remove hardcoded `{ lengthMinutes: 10, complexity: 'beginner' }`.
- `app/components/audio-overview/AudioOverviewPlayer.vue` — Replace local `useAudioOverviewPlayer()` with `useAudioOverviewStore()`. On mount, call `store.loadOverview(...)`. Remove `<audio ref="audioEl">` and `<audio ref="preloadEl">` — the real `<audio>` lives in `layouts/default.vue`. Attach `useAudioOverviewVisualizer()` for the active-speaker orb; bind its magnitude to a CSS variable driving `transform: scale(1 + var(--mag) * 0.08)` on the orb and opacity/scale on two absolute-positioned ring divs. Enable Download button — `onClick` invokes `useAudioOverviewDownload().downloadOverview({...})`. Remove `Soon` chip from Download; keep `Soon` chip on Share.
- `app/components/audio-overview/AudioOverviewCard.vue` — Add secondary "Customize" ghost button next to the primary Generate button. Generate click now emits a `generate` event that the Shell routes to the Customize dialog (dialog enforces confirmation); the Card itself no longer sends bare `generate` with no preferences.
- `app/layouts/default.vue` — Inside `<ClientOnly>` at root level (sibling to `UiSidebarProvider`), render (a) a global `<audio>` element + preload element bound to `store.attachAudio(...)` once, and (b) `<StickyMiniPlayer />`. Ensure `z-50` and `pointer-events-auto` so it overlays folder content.

**Tests (new):**
- `app/composables/useAudioOverviewDownload.test.ts` (vitest, component config).

## Tasks & Acceptance

**Execution:**
- [ ] `app/composables/useAudioOverviewStore.ts` — implement singleton, SSR-safe, all player operations
- [ ] `app/composables/useAudioOverviewVisualizer.ts` — AnalyserNode wiring with pure-CSS fallback on failure
- [ ] `app/composables/useAudioOverviewDownload.ts` — naive byte-concat download
- [ ] `app/composables/useAudioOverviewDownload.test.ts` — unit tests (happy / null-URL / fetch-reject)
- [ ] `app/components/audio-overview/AudioOverviewCustomize.vue` — dialog per approved Stitch design
- [ ] `app/components/audio-overview/StickyMiniPlayer.vue` — sticky bar per approved Stitch design; route-aware visibility
- [ ] `server/api/audio-overview/generate.post.ts` — accept + validate `voiceProfile` in body
- [ ] `server/utils/tts-workers-ai.ts` — export `AURA_VOICES` const set for validation reuse
- [ ] `app/components/audio-overview/AudioOverviewPlayer.vue` — read from store; ring-pulse visualizer; enable Download; keep Share "Soon"
- [ ] `app/components/audio-overview/AudioOverviewCard.vue` — add "Customize" ghost; Generate triggers dialog via Shell
- [ ] `app/components/audio-overview/AudioOverviewShell.vue` — host Customize dialog; route all generation through it; remove hardcoded prefs
- [ ] `app/layouts/default.vue` — mount global `<audio>` + `<StickyMiniPlayer />` inside `<ClientOnly>`; attach to store once
- [ ] `app/composables/useAudioOverviewPlayer.ts` — DELETE after Player migrates to store (single consumer, safe cleanup)
- [ ] **[R1 amend]** `app/app.vue` — move global `<audio>` + `<audio>` preload + `<StickyMiniPlayer />` from `layouts/default.vue` here so they mount on all routes (folder page uses `folder` layout)
- [ ] **[R1 amend]** `app/layouts/default.vue` — remove the moved mini-player + audio elements
- [ ] **[R1 amend]** `app/composables/useAudioOverviewStore.ts` — gate `loadOverview` with `import.meta.client` early-return; null-URL bail in `seek()`; fold visualizer into the store (module-level `AudioContext` + source cache keyed by element; reactive `magnitude: Ref<number>` driven by RAF started on play, stopped on pause)
- [ ] **[R1 amend]** `app/composables/useAudioOverviewVisualizer.ts` — DELETE (folded into store)
- [ ] **[R1 amend]** `app/components/audio-overview/AudioOverviewPlayer.vue` — update to read `magnitude` from store; gate watcher with `import.meta.client`; add `turns.length === turnUrls.length` guard before `loadOverview`
- [ ] **[R1 amend]** `app/composables/useAudioOverviewDownload.ts` — `Promise.allSettled`; include index in rejection; 0-byte = skipped; update types + tests
- [ ] **[R1 amend]** `tests/component/audio-overview/download.test.ts` — extend for parallel behavior, 0-byte = skipped, error-with-index
- [ ] **[R1 amend]** `app/components/audio-overview/StickyMiniPlayer.vue` — validate folder via `useFolders` on Expand; dismiss + toast + home on missing

**Acceptance Criteria:**
- Given a folder with ≥1 indexed doc, when the user clicks Generate on the Card, then the Customize dialog opens with defaults `10 min / Beginner / asteria+orion`; submitting sends those fields in the POST body; the Shell swaps to Generating.
- Given an overview is playing in Folder A and the user navigates to Folder B, then the StickyMiniPlayer appears at the viewport bottom, audio keeps playing without interruption, and clicking the bar's Expand routes back to Folder A.
- Given the Player is mounted, when playback starts, then the active-speaker orb visibly pulses in time with the audio; if `AudioContext` cannot be created the orb falls back to a pure-CSS pulse and no console errors are thrown.
- Given a ready overview, when the user clicks Download, then a single `audio/mpeg` file named `<title>.mp3` downloads and plays end-to-end in a standard audio player.
- Given the body carries a `voiceProfile` with an unknown voice name, then the server substitutes the default voice, logs a warning, and proceeds — no 4xx.

## Spec Change Log

### R1 (2026-04-17) — post-review loopback

Adversarial review (2 FAIL, 1 PASS) found 8 defects warranting amendment. Fixes:

1. **[R1 amend] layout coverage** — `app/pages/app/folders/[id].vue` uses `definePageMeta({ layout: 'folder' })`, not `default`. Global `<audio>` + StickyMiniPlayer must move from `layouts/default.vue` into `app/app.vue` (outside `<NuxtLayout>`) so they render on all routes.
2. **[R1 amend] SSR safety** — `loadOverview` in `useAudioOverviewStore.ts` must `return` early under SSR; Player's watcher must also be `import.meta.client`-gated.
3. **[R1 amend] visualizer singleton** — Fold visualizer into `useAudioOverviewStore.ts` so the `AudioContext` + `MediaElementAudioSourceNode` are created ONCE per element via a module-level cache; delete `useAudioOverviewVisualizer.ts`. Store exposes `magnitude: Ref<number>`; Player reads it directly.
4. **[R1 amend] seek null-URL handling** — `seek()` must bail when target index has null URL (do not swap src, do not set currentTime on old src).
5. **[R1 amend] watcher misalignment guard** — Player watcher must no-op when `turns.length !== turnUrls.length`.
6. **[R1 amend] download parallelism + error index** — `concatMp3Segments` uses `Promise.allSettled` with per-index results; rejects include `{ index, reason }`.
7. **[R1 amend] zero-byte segment** — Treat `buf.byteLength === 0` as skipped; propagate in skipped count.
8. **[R1 amend] deleted-folder expand** — `StickyMiniPlayer.handleExpand` validates the folder exists via `useFolders().allFolders` before navigating; on missing → `dismiss()` + toast + `navigateTo('/')`.

**Deferred (explicit KEEP decisions):**
- Dismiss-race (blind-hunter #3) unreachable: sticky bar hides when `onActiveFolderRoute` so the Player and mini-player never coexist visually. Re-load on folder return is correct behavior.
- Safari `currentTime` on src-less element (blind-hunter #5 variant) — narrow browser + sequence; guarded by early return when target URL is null, which also covers the initial-load case. Full cross-browser hardening belongs in Phase 3.
- Stale `timeupdate` fire after `dismiss()` (edge-case #7) — cosmetic; `el.load()` inside dismiss cancels pending events before the next tick. Not user-visible.


## Design Notes

Naive MP3 byte-concat works because every turn comes from the same `@cf/deepgram/aura-1` endpoint → identical sample rate (24 kHz), bitrate, and frame format. Standard players tolerate concatenated MP3 frames. This is the same approach NotebookLM exports use client-side. If a user complains about total-duration metadata in their player of choice, the Phase 3 fix is to dynamic-import `lamejs` and re-encode — deferred until a real complaint.

Store singleton via module-level `reactive()` is the Nuxt-idiomatic alternative to Pinia when only one instance is ever needed. SSR safety is maintained by gating `window`/`AudioContext`/`new Audio()` access behind `import.meta.client`. The `<audio>` element lives in the layout template so HMR/teardown on the Player component does not reset playback state.

Visualizer uses `MediaElementAudioSourceNode` (not `createMediaStreamSource`) — one source per element, so the store owns it. The graph is `source → analyser → destination`. FFT size 256, `smoothingTimeConstant 0.8`. Magnitude derived from `getByteFrequencyData` averaged over the lower 32 bins (speech fundamental band). Budget: 1 RAF/frame while playing; cancel when paused.

## Verification

**Commands:**
- `pnpm test` — expect: all green, including new `useAudioOverviewDownload.test.ts`
- `pnpm test:component` — expect: same pre-existing baseline of failures (30 from G2/G3 deferred); no new regressions
- Manual: open a folder, generate an overview via Customize (pick 5 min + expert + luna/perseus), wait for ready, play, navigate to Home — sticky bar should appear. Click Download — file should download and play locally. Click Expand — navigate back to folder.

**Manual checks:**
- DevTools → check only ONE `<audio>` element in DOM at any time (should be the one in `layouts/default.vue`).
- Visualizer: paused → orb static. Playing → orb pulses. Active speaker switch at turn boundary → glow moves to other card.
- Download: saved file total duration ≈ sum of turn durations ± frame-sync slop (a few hundred ms is acceptable).
