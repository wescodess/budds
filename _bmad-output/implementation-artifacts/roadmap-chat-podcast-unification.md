---
title: 'Chat + Podcast unification — Phase 5 roadmap'
type: 'roadmap'
status: 'proposed'
owner: 'wesleyukadike@gmail.com'
created: '2026-04-18'
precedes:
  - 'spec-audio-overview-phase-5a-foundation.md (to be written)'
  - 'spec-audio-overview-phase-5b-chat-interject.md (to be written)'
  - 'spec-audio-overview-phase-5c-regen-scope-polish.md (to be written)'
---

## Context

Phase 1–4 shipped the Audio Overview feature as a standalone void — its own folder tab, its own modal for mid-playback questions, its own separate chat surface via the Chat void. Users want the two collapsed: listen + type + ask follow-ups without losing state or context. The Interject modal from Phase 4 proved the "ask mid-listen" value, but its modal gate + inline TTS splice is friction-heavy.

Phase 5 unifies Chat and Podcast into a single folder surface. Voids of type Chat and Podcast collapse into layout preferences; asking a question is a first-class chat action that also triggers an audio interjection; directory scope is a folder-level concept shared between chat and generation.

## End-state architecture (north star)

A folder is a **2-pane surface** — Chat + Podcast, side-by-side — plus a sticky mini-player when the user navigates away. The user flips / resizes freely (G3 pattern), persists per-folder.

**Voids:**
- Chat and Podcast are **not** separate void types anymore. "Create Chat Void" and "Create Podcast Void" both route to the same folder surface; the choice only sets `preferredMainPane`.
- Flashcards and Quiz stay as separate void types.

**Reference scope:**
- Every folder has a `referenceScope: Id<'documents'>[]` — the set of docs that count as context.
- Empty = "all docs in this folder + subfolders, recursive."
- Chat queries and podcast generation both consume the scope.
- Customize dialog can override scope per-generation (snapshot on the podcast row).

**Ask → interject-via-chat (the killer move):**
- Player's Ask button focuses the chat input (wherever chat lives) and prepends a reference chip: `🎙 Re: Photosynthesis @ 2:14 · Host B on "chloroplasts…" · biology.pdf`.
- Audio keeps playing — no pause.
- User types + sends → two parallel things:
  1. **Chat response** streams back immediately (~2s). Message shows a clickable badge that jumps podcast playback to 2:14.
  2. **Background interjection** (~10s): interjection prompt with "Oh — I see you had a question about {topic}. You asked [verbatim]. So, [answer]." framing synthesized via existing `/api/audio-overview/interject` pipeline; spliced into the playlist.
- Multiple in-flight questions queue (each acknowledged in order at its own boundary).

**Mobile:**
- No 2-pane. Main view is chat full-screen.
- Sticky mini-player at bottom (Phase 2 sticky reused).
- Tap expand → new route `/app/folders/[id]/podcast` (full player, deep-linkable, back returns to chat).

## Data model diff

```ts
folders: {
  // ...existing fields
  preferredMainPane?: v.union(v.literal('chat'), v.literal('podcast'))
  referenceScope?: v.array(v.id('documents'))  // empty | undefined = all recursive
}

audioOverviews: {
  // ...existing Phase 1–4 fields
  scopeDocIds?: v.array(v.id('documents'))  // snapshot at generation time
}

messages: {
  // ...existing Chat fields
  interjectionContext?: v.object({
    overviewId: v.id('audioOverviews'),
    turnIndex: v.number(),
    timeMs: v.number(),
    quotedText: v.string(),          // truncated turn text
    sourceDocumentId?: v.id('documents'),
    sourceFilename?: v.string(),
    interjectionId?: v.id('audioOverviewInterjections'),  // back-link once generated
  })
}

audioOverviewInterjections: {
  // Phase 4 fields preserved
  chatMessageId?: v.id('messages')  // forward-link back to chat row
}

conversations: {
  // ...existing
  archivedAt?: v.number()  // for multi-chat migration — rows preserved, hidden from UI
}
```

## Phase 5A — Foundation (~1 sprint)

**Scope:** unified 2-pane folder surface, scope picker, mobile route. No interjection-via-chat yet; Ask still opens the Phase-4 modal.

**Deliverables:**
- Folder page refactored to use G3's pane-flip infrastructure for Chat ↔ Podcast. Flashcards/Quiz/Documents tabs stay in their current tab slot (consider folding into helper in 5C).
- `folders.preferredMainPane` + `folders.referenceScope` schema + Convex mutations (`setPreferredMainPane`, `setReferenceScope`).
- `CreateVoidDialog`: Chat/Podcast tiles now set `preferredMainPane` + navigate to folder; no new void entity created.
- `useReferenceScope` composable (folder-scoped) powering:
  - Chat input scope chip + directory picker dialog (reuse existing `ChatDirectoryPicker` if present).
  - Customize dialog's scope field (inherits scope with "Override for this podcast" toggle).
- `app/pages/app/folders/[id]/podcast.vue` — mobile expand route that mounts the full Player standalone.
- Chat-triggered generation / podcast-triggered generation both pass `scopeDocIds` to the existing `/api/audio-overview/generate.post.ts` (server honors).
- Storage of `audioOverviews.scopeDocIds` at generation (pass-through to `createWithTurns` mutation).

**Out of scope for 5A:**
- Ask button still opens the Phase-4 InterjectModal (removal is 5B).
- Multi-chat migration (5C).
- Regen scope pre-fill intersection logic (5C).
- Sidebar void counter simplification (5C).

**Risks:**
- G3 layout was built for Chat + Citations (helper). Adding a third content type (Podcast) as a helper-pane option requires extending the helper-pane content slot to be switchable. Expect meaningful refactor in `FolderShell` / pane-resolver.
- Scope picker + existing `useReferenceScope` may need harmonization — it was built for chat only, may not cleanly separate "folder default" from "per-query override."
- Mobile expand route needs the full Player without the folder layout chrome — `layout: false` pattern from Phase 3 `/audio/[token]` is the template.

## Phase 5B — Chat-interject integration (~1 sprint)

**Scope:** the Ask flow routes through chat, not a modal. Background audio interjection keeps the Phase 4 pipeline.

**Deliverables:**
- Chat input accepts optional `interjectionContext` metadata (reference chip above input).
- Player's `request-ask` emit writes the chip state to the current chat input (whichever pane hosts chat).
- Chat send endpoint (likely `server/api/chat/...`) detects `interjectionContext` on outbound message and:
  - Generates chat text answer (normal flow).
  - **Concurrently** POSTs to `/api/audio-overview/interject` with the same question + context.
- Interjection prompt updated with framing: `"Oh — I see you had a question about {topic}. You asked {verbatim}. {answer}"`.
- `messages.interjectionContext` written when the chat-side answer persists.
- Chat history badge renders above the user message: `🎙 Asked while listening to "{overview.title}" @ {formatMs} · {topic}`. Click → `store.seek(timeMs)` + ensure podcast pane visible.
- `audioOverviewInterjections.chatMessageId` back-link populated.
- Multi-question queueing: each pending interjection gets its own audio synth; splice at asked-moment boundaries (already tolerated by `spliceTurns`).
- **Delete** `app/components/audio-overview/InterjectModal.vue`. Remove the modal from `AudioOverviewShell`.

**Out of scope for 5B:**
- Migration of existing multi-chat folders (5C).
- Regenerate scope intersection (5C).
- Sidebar counter simplification (5C).

**Risks:**
- "Queue" semantics: if Q1's audio is mid-synth and Q2 arrives, splicing Q1 at boundary X while Q2 is still synthesizing requires careful ordering. Options: serialize on server, or use `insertedAfterTurnIndex` to thread each one independently. Recommend the latter — simpler, matches Phase 4 splice semantics.
- Chat text answer vs audio ack drift: if the chat answers "X is Y" at t=2s and the audio says "actually X is Z" at t=10s (same prompt, different completion temperature), the user sees contradictions. Mitigation: server generates the chat answer FIRST, then reuses the same completion text for the audio synth's answer portion. The audio adds only the "oh, I see..." framing around the shared answer body.
- Deep-link click-to-seek assumes the podcast pane is mounted. If the user is on mobile / a different folder, click → navigate + seek.

## Phase 5C — Regen scope + polish + migration (~1 sprint)

**Scope:** the tidying pass. Historic data migration, regen scope UX, sidebar cleanup, tests.

**Deliverables:**
- Regenerate flow reads prior podcast's `scopeDocIds`, computes intersection with currently-existing docs, pre-selects in Customize picker. Banner if the intersection is partial: `"{n} of {m} docs from the previous podcast are no longer in this folder — they'll be excluded."`.
- Multi-chat migration script: for each folder with >1 conversation row, sets `archivedAt: Date.now()` on all but the most-recent. UI respects `archivedAt` by hiding. Migration is a one-off Convex mutation invocation, idempotent.
- Sidebar void counter: show unified `[chat icon] [podcast icon]` badges per folder instead of separate counts.
- End-to-end tests:
  - Ask while listening → chat answer + audio splice.
  - Regen with stale scope → intersection banner.
  - Multi-chat folder migration → older chats hidden but rows preserved.
  - Mobile expand route deep-link.
- Deferred-work items audit: close any Phase 2/3/4 items that this refactor retires.

**Out of scope for 5C (explicitly deferred to Phase 6+):**
- Tabs unification (Flashcards / Quiz / Documents as helper-pane swappable content).
- User-level preferred pane (today's answer = per-folder only).
- Archived chat recovery UI (rows are preserved; no UI to reach them).
- Scope picker for Flashcards / Quiz generation (only Chat + Podcast in Phase 5).

**Risks:**
- Migration is destructive-to-UI even if rows are preserved. Need a dry-run pass and a reversible marker (the `archivedAt` timestamp is nullable — can be cleared).
- Sidebar change touches the home dashboard + folder sidebar — visual regression risk on every folder list.

## Locked assumptions (from 2026-04-18 design alignment)

1. Voids of type Chat and Podcast collapse fully. Both "Create" buttons remain but only set `preferredMainPane`.
2. Interject stays — repurposed through chat. InterjectModal deleted. Server interjection pipeline reused.
3. Reference chip in chat input is **metadata** (option b) — not visible prefix in the textarea, not ephemeral focus-only.
4. Directory picker scope is recursive into subfolders.
5. Scope is shared between chat + podcast; Customize dialog can override per-generation.
6. Mobile: chat full-screen + sticky mini-player; expand opens `/app/folders/[id]/podcast` route.
7. Regen pre-fills intersection of old scope ∩ current docs; banner if partial.
8. Multi-chat migration: most-recent kept, others `archivedAt`-marked and UI-hidden. Rows preserved (no data deletion).
9. Folder scope persisted in DB (`folders.referenceScope`), not localStorage — cross-device.
10. "Topic" in chat badge = quoted text + source filename chip (both).
11. Badge click → deep-link podcast to timestamp.
12. Chat answer + audio ack are independent in timing (chat streams immediately, audio lands when ready). Server reuses chat's answer text as the audio's answer body to avoid drift.
13. Multiple questions in flight → queue all, each acknowledged at its asked-moment boundary.
14. Flip is purely visual. Audio never pauses on flip.
15. Per-folder `preferredMainPane` (not per-user global).

## Out of scope for entire Phase 5

- **Voice-to-text in chat input.** Phase 4 `SpeechRecognition` infra is deleted with the modal. Could return as a future enhancement.
- **Chat citations pane consolidation.** The existing "right helper = citations" pattern from G3 keeps working — Podcast replaces citations only when the user explicitly chooses podcast-in-helper. Citations fall back to inline with chat messages (status quo).
- **Audio interjection cancellation from chat.** If the user deletes their chat message mid-audio-synth, we don't cancel the audio. Orphan interjection row gets cleaned up on folder delete (existing cascade). Acceptable.
- **Podcast-initiated chat.** Hosts saying "ask us something" is narrative, not a programmatic affordance. The mic / keyboard is user-initiated only.
- **Cross-folder references.** Scope is always folder-scoped. "Pull context from Folder A while generating Folder B's podcast" is out.
- **Moving Flashcards/Quiz into the 2-pane model.** They stay as separate tabs for now.

## Open questions (non-blocking — flag if any are wrong)

- **Archive timestamp vs boolean:** I chose `archivedAt?: v.number()` (nullable epoch) so an admin could timestamp-diff. A simple boolean `archived: v.boolean()` works too. Either way rows are preserved. Defaulting to timestamp.
- **Interjection framing copy:** "Oh — I see you had a question about {topic}. You asked [verbatim]. So, [answer]." is my suggested template. If you want a different voice (more formal / more casual), pin it before 5B starts.
- **Mobile expand route UX:** `/app/folders/[id]/podcast` mounts the full player standalone. Do we want a visible "← Back to chat" chevron in the header, or rely on the browser back button? I'd vote both — explicit chevron + back works.
- **Scope picker default when folder is empty:** 0 indexed docs → what does the picker show? I'd render an empty-state "Upload something first" CTA that links to the Documents tab. OK?

## Execution plan

Three independent PRs against `dev`:
- 5A: `feat/audio-overview-phase-5a-foundation`
- 5B: `feat/audio-overview-phase-5b-chat-interject`
- 5C: `feat/audio-overview-phase-5c-regen-scope-polish`

Each PR ships on its own and unblocks the next. 5A is useful standalone (unified layout + scope picker, even if Ask still goes through the old modal). 5B removes the modal. 5C tidies.

Each PR will go through standard quick-flow: DESIGN → approval → CLARIFY → SPEC → IMPLEMENT → REVIEW → COMMIT → PR → MERGE. Review rounds expected given cross-cutting scope — budget 1 loopback per PR.

Total calendar: ~3 sprints if sequential, ~2 if 5A and 5C overlap on tail end (5C starts once 5A merges).
