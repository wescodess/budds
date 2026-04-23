---
title: 'Audio Overview (Phase 3 Share + Ops) — Public /audio/[token], share modal, soft quota'
type: 'feature'
created: '2026-04-17'
status: 'complete'
context:
  - 'notebooklm_audio_overview_plan.md'
  - 'DESIGN.md'
  - '_bmad-output/implementation-artifacts/spec-audio-overview-phase-2-polish.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** An owner can generate a Phase-2 audio overview but has no way to let anyone else hear it, and nothing protects us from a runaway generator script hitting OpenRouter dozens of times in a minute.

**Approach:** Three coordinated changes. (1) **Publishing:** add an opaque `shareToken` + `publishedAt` to `audioOverviews`; owner-gated `publishOverview` / `unpublishOverview` mutations; public (auth-less) `getByShareToken` / `getTurnUrlsByShareToken` queries that return a minimal projection (no userId/folderId/taskId). (2) **Public surface:** a read-only `/audio/[token]` page that reuses the Phase-2 playback engine (store + visualizer + Download) with generate/regenerate/customize/history stripped, and a new `ShareDialog` wired to the Player's Share button (replacing the "Soon" chip). (3) **Soft quota:** `users.audioOverviewQuota = { date, count }` + `getDailyQuota` / `incrementDailyQuota`; the Customize-submit path blocks at cap with a rose banner and a toast warning at ≥80%.

## Boundaries & Constraints

**Always:**
- The share URL uses the opaque token (`/audio/<32-hex>`), never a raw Convex id. Tokens are capability bearers — the public queries MUST skip `ctx.auth.getUserIdentity()` and authenticate on the token alone.
- Public queries return a **minimal projection**: `{ title, turns, voiceProfile, totalDurationMs, sourceDocumentIds, publishedAt }` for `getByShareToken`, and `(string|null)[]` for `getTurnUrlsByShareToken`. Never leak `userId`, `folderId`, `taskId`, `model`, or `preferences`.
- Token generation uses `crypto.getRandomValues(new Uint8Array(16))` → lowercase hex (32 chars). Collision check: query by `by_shareToken` before insert; retry on (theoretical) collision.
- `publishOverview` and `unpublishOverview` auth-gate on overview ownership exactly like `deleteOverview` does today. `publishOverview` on an already-published row is idempotent — returns the existing token.
- The Public Player reuses `useAudioOverviewStore` via `loadOverview` with the data from the public query. NO Share button on the public page (no resharing from public view). NO regenerate / customize / history.
- `/audio/[token]` is a **public, unauthenticated** route. Confirm this is implicit given the existing `routeRules` (which only guard `/`, `/chat`, `/app/**`, `/login`). Add a Nitro cache rule `/audio/**: { swr: 300 }` to cap repeated HTML-shell hits.
- Quota is a **client-surfaced soft cap**. Client reads `getDailyQuota()` and refuses submit if `used >= cap`. Server-side `incrementDailyQuota` runs alongside the task-create mutation but does NOT enforce the cap — it only tracks usage. Cap default: **10 per UTC day**.
- Quota toast fires exactly once per session when `used` first crosses 80% of cap on a successful submit. Use `vue-sonner` via dynamic import.
- All `window`/`crypto.getRandomValues` access on the client gated by `import.meta.client`. Server-owned code paths can use `globalThis.crypto`.

**Ask First:**
- Any change to the `users` table shape beyond the new `audioOverviewQuota` field.
- Any new Convex env var (none expected).
- Any edit to `convex/accountDeletion.ts` / `convex/dataExport.ts` (quota field needs export parity).

**Never:**
- No hard cap in the server route — quota stays a client soft cap per plan §7.
- No auth.getUserIdentity() calls inside `getByShareToken` or `getTurnUrlsByShareToken` — these are public by design.
- No raw `Id<'audioOverviews'>` in the share URL.
- No PR targeting `main` — base = `dev`. No Claude attribution. No `--no-verify`, no `git add -A/.`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error Handling |
|---|---|---|---|
| Publish happy path | Owner clicks "Create share link" | Mutation generates token, writes `shareToken` + `publishedAt`; dialog shows URL + Copy | — |
| Re-publish idempotent | `shareToken` already set | Return existing token; no schema change | — |
| Unpublish | Owner clicks "Unshare" | `shareToken = undefined`, `publishedAt = undefined`; dialog flips to unshared state | — |
| Public load happy | GET /audio/abcdef... with valid token | Page renders title, orbs, blockquote, bar, sources; plays on click | — |
| Public load invalid token | `getByShareToken('invalid')` → null | Page shows "This link is no longer active" empty state with Budds CTA | 404-like inline |
| Public load after unshare | Token valid at link creation but owner unshared | Same null-state as invalid | — |
| Token collision on publish | Query `by_shareToken` finds existing | Retry with fresh random bytes (max 5 attempts) | Throw on 5x collision (never happens in practice) |
| Download on public page | Button click | Same flow as Phase-2 — concat turn URLs via the public `getTurnUrlsByShareToken` | Toast warns on partial / failed |
| Quota under cap | `used = 3, cap = 10` | Submit proceeds; `incrementDailyQuota` sets `used = 4` | — |
| Quota at 80% | `used = 8, cap = 10` post-increment | Soft warning toast fires once: "Heads up — 8 of 10 audio overviews used today" | — |
| Quota at cap | `used >= cap` pre-submit | Dialog shows rose banner + disabled Generate; toast error; no task created | — |
| Quota date rollover | Stored `date` < today UTC | `getDailyQuota` returns `{ used: 0, cap: 10 }`; next increment resets count to 1 | — |
| Two tabs racing past cap | Both read `used = 9` | Soft cap is client-side — both can submit to 10 and 11. Acceptable for MVP. | — |

</frozen-after-approval>

## Code Map

**New:**
- `convex/audioOverviews.ts` — extend: add `publishOverview(id)` mutation (generates token, writes token+publishedAt, idempotent), `unpublishOverview(id)` mutation, `getByShareToken(token)` public query (minimal projection), `getTurnUrlsByShareToken(token)` public query. Token util `generateShareToken()`: 16 random bytes → hex via `globalThis.crypto.getRandomValues`.
- `convex/users.ts` — add `getDailyQuota()` query returning `{ used, cap, date, resetsAtLocalMidnightHint?: null }` (client computes localization); `incrementDailyQuota()` mutation that sets `audioOverviewQuota = { date: todayUtcYmd, count: count + 1 }` or resets if `date` stale; tests — auth-gated, date rollover.
- `convex/schema.ts` — extend `audioOverviews` with `shareToken?: v.string()` + `publishedAt?: v.number()` + `.index('by_shareToken', ['shareToken'])`. Extend `users` with `audioOverviewQuota?: v.object({ date: v.string(), count: v.number() })`.
- `app/components/audio-overview/AudioOverviewShareDialog.vue` — modal per approved design. Props: `{ open, overviewId, shareToken?: string, publishedAt?: number }`. Emits: `update:open`, `publish`, `unpublish`. Two states: **unshared** (primary "Create share link" button) and **shared** (URL input with inline Copy button, plays-count placeholder, Unshare ghost button).
- `app/pages/audio/[token].vue` — public route. Fetches `api.audioOverviews.getByShareToken` + `api.audioOverviews.getTurnUrlsByShareToken`; loads into store via `loadOverview`; renders a **read-only** Player variant — no regenerate/customize/history/delete/share. Minimal header (Budds wordmark + "Open in Budds" CTA for logged-in users). Footer: "Create your own audio overview in Budds →".
- `app/components/audio-overview/PublicAudioShell.vue` — the read-only Player body extracted from `AudioOverviewPlayer.vue`. Reuses the store, ring-pulse orbs, scrubber, skip/speed, Download. No history menu, no Customize, no Share, no Delete.
- `convex/audioOverviews.test.ts` — extend: publish/unpublish auth + idempotency + token shape; `getByShareToken` returns correct projection + null on invalid; `getTurnUrlsByShareToken` validates token; projection does NOT leak `userId`/`folderId`.
- `convex/users.test.ts` — extend: `getDailyQuota` date rollover; `incrementDailyQuota` ownership + sequencing.

**Modified:**
- `app/components/audio-overview/AudioOverviewPlayer.vue` — replace disabled "Soon"-chipped Share button with a real button that opens `AudioOverviewShareDialog`. Read current `overview.shareToken` + `overview.publishedAt`; pass to dialog.
- `app/components/audio-overview/AudioOverviewShell.vue` — (a) on `handleCustomizeSubmit`, call `getDailyQuota()` first; if `used >= cap`, open the Customize dialog with a rose banner (add prop `quotaState: { used, cap } | null`); otherwise call `incrementDailyQuota()` alongside the existing `createTaskMutation`. (b) Fire 80%-warning toast once per session via a `sessionStorage` flag keyed by `audio-overview-quota-warning-<yyyy-mm-dd>`.
- `app/components/audio-overview/AudioOverviewCustomize.vue` — add optional `quotaState: { used, cap } | null` prop; when present and `used >= cap`, render the rose banner (Clock icon + "Your quota resets at midnight…"), grey out the Length/Complexity/Voices groups, disable Generate.
- `nuxt.config.ts` — add `'/audio/**': { swr: 300 }` in `routeRules`.

## Tasks & Acceptance

**Execution:**
- [ ] `convex/schema.ts` — extend audioOverviews with shareToken + publishedAt + `by_shareToken` index; extend users with `audioOverviewQuota`
- [ ] `convex/audioOverviews.ts` — `publishOverview`, `unpublishOverview`, `getByShareToken`, `getTurnUrlsByShareToken`, token util
- [ ] `convex/audioOverviews.test.ts` — publish/unpublish/getByShareToken tests
- [ ] `convex/users.ts` — `getDailyQuota`, `incrementDailyQuota`
- [ ] `convex/users.test.ts` — quota rollover + ownership tests
- [ ] `app/components/audio-overview/AudioOverviewShareDialog.vue` — per approved Stitch design (both states)
- [ ] `app/components/audio-overview/PublicAudioShell.vue` — read-only Player body, store-driven
- [ ] `app/pages/audio/[token].vue` — public page + invalid-token empty state + minimal header/footer
- [ ] `app/components/audio-overview/AudioOverviewPlayer.vue` — wire Share button + dialog; remove "Soon" chip
- [ ] `app/components/audio-overview/AudioOverviewShell.vue` — quota pre-check + increment + 80% toast
- [ ] `app/components/audio-overview/AudioOverviewCustomize.vue` — accept quotaState, render rose banner + disabled Generate at cap
- [ ] `nuxt.config.ts` — `/audio/**` routeRule with swr: 300

**Acceptance Criteria:**
- Given an owner on the Player, when they click Share on an unshared overview, then the dialog opens showing "Create share link"; clicking it mutates the overview (shareToken + publishedAt set), flips the dialog to the shared state, and exposes a `https://<origin>/audio/<token>` URL with a Copy button.
- Given a valid share URL, when anyone (auth or not) visits `/audio/<token>`, then the page renders the read-only Player (orbs, blockquote, scrubber, play, Download) without any generate/regenerate/customize/history/share controls. The source projection MUST NOT include userId/folderId/taskId.
- Given a URL for an unshared or never-shared overview, when visited, then the page shows an inline "This link is no longer active" state with a "Create your own audio overview" CTA and does not throw.
- Given a user at `used = 9, cap = 10`, when they submit Customize, then the task is created and `used` increments to 10; a `toast.warning` informing them of remaining quota fires once per local day.
- Given a user at `used >= cap`, when they open Customize, then the dialog shows a rose banner + disabled Generate + "Generate (quota reached)" label; no task can be created from the UI.

## Spec Change Log

### R1 (2026-04-17) — post-review loopback

Adversarial review (2 FAIL blind-hunter + edge-case-hunter; 1 PASS acceptance-auditor). 8 unique defects consolidated. Fixes:

1. **[R1 amend] Drop `'skip'` sentinel from Shell's getWithTurns subscription** — not supported by nuxt-convex. Instead extend `listByFolder` projection with `shareToken` + `publishedAt`; Shell reads them off `activeOverview` and passes to dialog as props.
2. **[R1 amend] Public page singleton collision** — refactor `useAudioOverviewStore.ts` to expose a `createAudioOverviewPlayback()` factory. The module-level `useAudioOverviewStore` stays the singleton wrapper (owner use). `PublicAudioShell.vue` creates its own **local** instance via the factory and owns its own `<audio>` element — never touches the global singleton.
3. **[R1 amend] Sticky bar on /audio/**** — `StickyMiniPlayer.vue` visibility guard also hides when `route.path.startsWith('/audio/')`. Defense-in-depth.
4. **[R1 amend] Strict token regex** — `getByShareToken` / `getTurnUrlsByShareToken` reject anything not matching `/^[0-9a-f]{32}$/` (implies the upper-bound check).
5. **[R1 amend] Publish status gate** — `publishOverview` throws when `overview.status !== 'ready'`.
6. **[R1 amend] ShareDialog Copy-timer leak** — track timeout handle; `clearTimeout` on unshare, close, and subsequent copies.
7. **[R1 amend] Quota-increment visibility** — `console.warn` on mutation failure in the Shell's submit handler.
8. **[R1 amend] Fold filenames into getByShareToken** — projection now returns `{title, turns, voiceProfile, totalDurationMs, sourceDocumentIds, sourceFilenames, publishedAt}`. Delete `getPublicSourceFilenames`; update `PublicAudioShell` accordingly.


## Design Notes

Token-based share URLs match how Notion/Linear handle public docs: capability-bearer, opaque, revocable by owner. We skip HMAC / signed URLs because Convex `_storage.getUrl()` already returns short-lived, signed URLs — the token guards the **resolution step**, not the blob URL itself. If a non-owner harvests a turn URL, it expires like any Convex storage URL (~30 min) and can't be re-minted without the token.

Quota lives on `users` (not a separate table) because it's a single `{ date, count }` pair per user, always written when the user acts. Stale-date check is a simple string comparison; `date` uses `new Date().toISOString().slice(0, 10)` (UTC). Using UTC avoids timezone drift at the storage layer; the "resets at midnight" copy is local-time advisory only.

The public Player body is extracted into `PublicAudioShell.vue` (not just an auth prop on `AudioOverviewPlayer.vue`) because the host component's props, Convex queries, and state machine are auth-gated — a conditional inside would bloat the file by ~200 lines with `v-if` branches. Two components sharing the same `useAudioOverviewStore()` backbone keeps both lean.

Collision retry on token generation is defensive — 128 bits has 3.4e38 space — but the cost of a single retry query is one indexed lookup, and the cost of an accidental collision is catastrophic (leaking another user's overview), so the safety is worth it.

## Verification

**Commands:**
- `pnpm test` — expect: all green, including new Convex tests for publish/unpublish/getByShareToken/getDailyQuota
- `pnpm test:component` — expect: baseline unchanged (30 pre-existing failures)
- Manual: publish a folder's overview, copy the link, open in an incognito window → plays. Unshare → same link shows empty state.
- Manual: generate 10 overviews in a single day → 11th open of Customize shows rose banner + disabled Generate.
- Manual: scrub/skip/play on `/audio/<token>` — behaves identically to the authenticated Player.
- DevTools: response from `getByShareToken` contains NO `userId`/`folderId`/`taskId` fields.

**Manual checks:**
- Nitro: hitting `/audio/<token>` twice within 5 min should serve the cached HTML shell the second time (no new Convex query for the HTML layer — the token resolution still fires client-side).
