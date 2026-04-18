# Audio Overview — Implementation Plan

Replicates NotebookLM's "Audio Overview" feature on top of the existing budds infrastructure. Targets a near-$0 unit economic (MeloTTS on Workers Paid) while reusing the quiz-generation pattern end-to-end.

Source PRD: [notebooklm_audio_overview_prd.md.resolved](./notebooklm_audio_overview_prd.md.resolved)

---

## 1. Budget reality check (Workers Paid plan)

Cloudflare Workers AI paid plan gives **10,000 neurons/day free**, then **$0.011 per 1,000 neurons**.

**`@cf/myshell-ai/melotts`** consumes **18.63 neurons per minute of audio**:

| Overview length | Neurons each | Free per day | Cost past free (each) |
|---|---|---|---|
| 5 min  | 93  | **~107** | $0.001 |
| 10 min | 186 | **~53**  | $0.002 |
| 20 min | 373 | **~26**  | $0.004 |

1,000 extra 5-min overviews beyond the free quota ≈ **$1.00**. TTS is effectively free at any realistic user volume; the OpenRouter LLM spend for script generation will dominate long before TTS does.

**Decision:** go MeloTTS-first from day one. Skip the multi-tier fallback from earlier sketches — a single code path means persistent MP3s in R2, `Download` and `Share` work for free, and no WebGPU/transformers.js model loading on the client.

Keep **browser Web Speech API** only as a hard-failure fallback if Workers AI is degraded.

---

## 2. Architecture

```
User clicks "Audio Overview" in FolderShell
  → POST /api/audio-overview/generate  (Nuxt server route)
      → creates task row (existing tasks table)
      → schedules Convex internalAction runAudioOverview
  → Convex action:
      1. Retrieve chunks from Cloudflare AI Search (reuse server/utils/ai-search.ts)
      2. Generate dialogue script via OpenRouter (reuse server/utils/ai-gateway.ts)
      3. Per turn: synthesize via Workers AI MeloTTS, store as _storage blob
      4. Write audioOverviews row with per-turn storage IDs
      5. Mark task complete
  → UI subscribes via useConvexQuery(api.tasks.getTask)
      → when ready, renders <AudioOverviewPlayer/>
```

Reused as-is from the quiz flow (`server/api/quiz/generate.post.ts`):
- tasks table + progress polling
- `aiSearch()` retrieval
- `generateCompletion()` LLM call
- Chunk summarisation strategy (`server/utils/quiz-prompt.ts`)
- `ctx.scheduler.runAfter(0, ...)` async dispatch pattern

Net-new components:
- Script-generation prompt (conversation, not Q&A)
- TTS synthesis per turn
- Per-turn storage + playlist assembly
- Audio player UI + sticky mini-player
- Visualiser + interjection flow

---

## 3. Data model

Add to `convex/schema.ts`:

```ts
audioOverviews: defineTable({
  folderId: v.id("folders"),
  userId: v.id("users"),
  taskId: v.id("tasks"),
  title: v.string(),
  turns: v.array(v.object({
    speaker: v.union(v.literal("host_a"), v.literal("host_b")),
    text: v.string(),
    audioFileId: v.id("_storage"),
    durationMs: v.number(),
  })),
  voiceProfile: v.object({ hostA: v.string(), hostB: v.string() }),
  preferences: v.object({
    lengthMinutes: v.number(),   // 5 | 10 | 20
    complexity: v.union(v.literal("beginner"), v.literal("expert")),
  }),
  totalDurationMs: v.number(),
  sourceDocIds: v.array(v.id("documents")),
}).index("by_folder", ["folderId"])
  .index("by_user", ["userId"]),

audioOverviewInterjections: defineTable({
  audioOverviewId: v.id("audioOverviews"),
  insertedAfterTurnIndex: v.number(),
  question: v.string(),
  answerTurns: v.array(v.object({
    speaker: v.string(),
    text: v.string(),
    audioFileId: v.id("_storage"),
    durationMs: v.number(),
  })),
}).index("by_overview", ["audioOverviewId"]),
```

Per-turn storage (rather than one concatenated MP3) avoids needing `ffmpeg` on Cloudflare Pages — the player swaps `<audio src>` on `ended`. Concat can be added later as a post-processing step if a single downloadable file is needed.

---

## 4. Backend implementation

### 4.1 Script prompt — `server/utils/audio-script-prompt.ts`

Mirrors `server/utils/quiz-prompt.ts`:

1. Pull chunks via `aiSearch(folderId, query)` — top-k set to cover target length (~1,500 words of context per 5 min of output).
2. Summarise per-doc as in quiz flow.
3. Build conversation prompt returning strict JSON:
   ```json
   { "title": "...", "turns": [{ "speaker": "host_a" | "host_b", "text": "..." }, ...] }
   ```
4. System prompt enforces:
   - **Source grounding**: every factual claim must trace to a provided chunk; explicit "don't fabricate" rule.
   - **Persona**: host_a = expert, host_b = curious learner asking clarifying questions.
   - **Word-count target** derived from `lengthMinutes × 150 wpm` ± 10%.
   - **Complexity** level (beginner vs expert) gates jargon density.
   - **Natural disfluencies**: allows `[laughs]`, `[pauses]`, contractions — MeloTTS handles these as plain text cues.
5. Call `generateCompletion()` with `google/gemini-2.5-flash` (cheap, high context) or `deepseek/deepseek-chat-v3`.

### 4.2 Convex action — `convex/audioOverviewActions.ts`

```ts
export const runAudioOverview = internalAction({
  args: { taskId, folderId, userId, preferences, voiceProfile },
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.tasks.setProgress, { taskId: args.taskId, progress: 5, label: "Retrieving sources" });
    const chunks = await fetchChunks(ctx, args.folderId, args.preferences.lengthMinutes);

    await ctx.runMutation(internal.tasks.setProgress, { taskId: args.taskId, progress: 25, label: "Writing dialogue" });
    const script = await generateScript(chunks, args.preferences);

    const turns: TurnRecord[] = [];
    for (const [i, turn] of script.turns.entries()) {
      const progress = 30 + Math.round((i / script.turns.length) * 60);
      await ctx.runMutation(internal.tasks.setProgress, { taskId: args.taskId, progress, label: `Synthesizing turn ${i + 1}/${script.turns.length}` });
      const audioBytes = await synthesizeMeloTTS(turn.text, args.voiceProfile[turn.speaker === "host_a" ? "hostA" : "hostB"]);
      const fileId = await ctx.storage.store(new Blob([audioBytes], { type: "audio/mpeg" }));
      turns.push({ ...turn, audioFileId: fileId, durationMs: estimateDurationMs(turn.text) });
    }

    const overviewId = await ctx.runMutation(internal.audioOverviews.create, {
      folderId: args.folderId, userId: args.userId, taskId: args.taskId,
      title: script.title, turns, voiceProfile: args.voiceProfile,
      preferences: args.preferences,
      totalDurationMs: turns.reduce((s, t) => s + t.durationMs, 0),
      sourceDocIds: chunks.map(c => c.documentId),
    });

    await ctx.runMutation(internal.tasks.markComplete, { taskId: args.taskId, resultRef: overviewId });
  },
});
```

### 4.3 TTS wrapper — `server/utils/tts-melotts.ts`

Thin REST call to Workers AI:

```
POST https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/ai/run/@cf/myshell-ai/melotts
Authorization: Bearer {CLOUDFLARE_WORKERS_AI_TOKEN}
Body: { "prompt": "...", "lang": "en" }
Response: { result: { audio: base64 } }
```

Two distinct voices for host_a / host_b via speaker IDs exposed by the model. Returns `Uint8Array` of MP3.

Routed through the existing Cloudflare AI Gateway (reuse `server/utils/ai-gateway.ts` gateway URL) so TTS calls get the same analytics/caching/retry behaviour as LLM calls.

### 4.4 Server route — `server/api/audio-overview/generate.post.ts`

Mirrors `server/api/quiz/generate.post.ts`:

```
Body: { folderId, preferences: { lengthMinutes, complexity }, voiceProfile }
→ auth check via convex-token middleware
→ create task (runMutation internal.tasks.create, type: "audio_overview")
→ runAction internal.audioOverviewActions.runAudioOverview
→ return { taskId }
```

### 4.5 Share route — `server/api/audio-overview/[id]/share.get.ts`

Optional Phase 3 endpoint: generates a signed, 24h-TTL URL to a public playback page at `/audio/[id]`. ACL check against folder membership; public token stored in `audioOverviews.shareToken`.

---

## 5. Frontend

### 5.1 File layout

```
app/components/audio-overview/
  AudioOverviewCard.vue          # Studio-panel entry point (generate + preferences)
  AudioOverviewCustomize.vue     # Length / complexity / voice picker
  AudioOverviewGenerating.vue    # Task progress bound to useConvexQuery
  AudioOverviewPlayer.vue        # Main player surface
  HostVisualizer.vue             # Two pulsing orbs
  StickyMiniPlayer.vue           # Lives in layouts/default.vue
  InterjectModal.vue             # Join / discuss flow

app/composables/
  useAudioOverviewPlayer.ts      # Playlist engine (per-turn swap)
  useAudioOverviewStore.ts       # Pinia store — survives route changes
```

### 5.2 `useAudioOverviewPlayer` — playlist engine

Since turns are stored as separate MP3s:

- Maintain `currentTurnIndex`, single `<audio>` element.
- On `ended`, advance index and set `src` to next turn's signed URL (via `api.audioOverviews.getTurnUrl`).
- Expose `currentTimeMs` as `sum(turns[0..i-1].durationMs) + audio.currentTime * 1000`.
- Scrubbing: compute which turn a target position falls in, swap src, seek within that turn.
- Skip ±15s: delegate to the scrub logic.
- Speed: `audio.playbackRate`.

### 5.3 `HostVisualizer.vue`

- Web Audio API `AnalyserNode` wired to the `<audio>` element.
- Two orbs — host_a / host_b — driven by `@vueuse/core` `useRafFn`.
- Active speaker (`turns[currentTurnIndex].speaker`) pulses with frequency magnitude; inactive orb at low amplitude idle.
- No canvas lib — CSS `scale` + `filter: blur()` on two `<div>`s is enough.

### 5.4 `StickyMiniPlayer.vue`

- Rendered in `layouts/default.vue` so it survives route changes (solves PRD §3.4).
- Reads from the Pinia store. Shows: play/pause, title, current turn's speaker chip, progress bar.
- Clicking expands back to the full player surface.

### 5.5 `InterjectModal.vue` (Phase 4)

- Text input + mic button (reuse browser `SpeechRecognition` — $0).
- Submitting: pause main playback, POST to `/api/audio-overview/interject` with `{ audioOverviewId, insertedAfterTurnIndex, question }`.
- Server generates a 2–4 turn mini-script (same prompt, with the question injected and current-context chunk snippet), synthesises, returns `interjectionId`.
- Client queues the interjection's turns into the playlist at the insertion point and resumes.

---

## 6. Realtime / multi-tasking UX

- Single `<audio>` element lives in the layout, not the page — navigation never pauses playback.
- Progress during generation piggybacks on the existing `tasks` reactive query (`useConvexQuery(api.tasks.getTask)`) — no new SSE or WebSocket plumbing.
- Convex's reactive query model means once the `audioOverviews` row is inserted, the UI hot-swaps from `AudioOverviewGenerating` to `AudioOverviewPlayer` automatically.

---

## 7. Phased rollout

### Phase 1 — MVP (1 sprint)
Tables, action, script prompt, MeloTTS synth, generating state, basic player (play/pause/scrub/speed), per-turn swap. No visualiser, no sticky player, no interjection.

Acceptance: user can generate a 5-min overview from a folder and play it back in the Studio panel.

### Phase 2 — Polish (1 sprint)
Download (fetch all turn MP3s → client-side concat via Web Audio API → encode via `lamejs`, dynamic import), visualiser orbs, sticky mini-player, pre-generation customise dialog (length / complexity / voices).

Acceptance: downloaded MP3 plays end-to-end; playback survives navigation; customise preferences round-trip.

### Phase 3 — Share + ops (≤1 sprint)
Public `/audio/[id]` page with signed URL, share modal, per-user daily quota on `users.audioOverviewQuota` (soft cap — we're nowhere near Workers AI limits, but protects against runaway LLM cost).

### Phase 4 — Interjection
Text + voice input, mini-script generation, playlist insertion, resume.

---

## 8. Environment variables

Already present — no new secrets needed:

- `CLOUDFLARE_ACCOUNT_ID` — for Workers AI REST endpoint
- `CLOUDFLARE_AI_GATEWAY_ID`, `CLOUDFLARE_AI_GATEWAY_API_KEY` — route TTS through the same gateway
- `OPENROUTER_API_KEY` — script generation

Optionally add `CLOUDFLARE_WORKERS_AI_TOKEN` if you want a narrower-scoped token just for Workers AI (recommended).

---

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| MeloTTS voice variety limited | Verify available speaker IDs before shipping; if only one voice, use speaker embedding + slight pitch shift on one host, or evaluate Aura-1 for host_b |
| Long scripts overflow LLM context | Reuse quiz chunking — summarise per-doc first, feed summaries to script model |
| Workers AI transient 5xx during multi-turn synth | Per-turn retry with backoff; fail task only if a turn fails 3× |
| R2 egress from popular shares | 24h signed URL TTL + rate-limit `/audio/[id]` route |
| Client clock drift on per-turn swap causes audible gaps | Preload `turns[i+1]` via a hidden `<audio preload="auto">` 500ms before the current ends |
| Runaway LLM spend (OpenRouter) | Per-user daily quota + cost ceiling alert; script-prompt token budget enforced at call site |

---

## 10. Next step

Before coding: draft Stitch designs in the current theme for the four key surfaces:

1. `AudioOverviewCard` (entry point in FolderShell action panel)
2. `AudioOverviewCustomize` (length / complexity / voice dialog)
3. `AudioOverviewPlayer` (main surface with visualiser)
4. `StickyMiniPlayer` (bottom-anchored persistent control)

Per the design-first convention, these should be refined in the existing DESIGN.md foundation before the tech spec is written.
