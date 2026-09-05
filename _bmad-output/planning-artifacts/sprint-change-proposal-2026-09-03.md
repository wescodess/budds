---
title: 'Course-correct Audio Overview implementation to the accepted production plan'
date: '2026-09-03'
status: approved
scope: major
trigger: 'The durable v1 bridge stalls at provider selection and still routes production generation through Dia or Aura.'
source_of_truth: 'docs/plans/podcast-audio-overview-implementation-plan.md'
approval_evidence: 'Owner directed that audio generation and the entire podcast feature follow the implementation plan.'
---

# Sprint Change Proposal: Audio Overview v2

## 1. Issue summary

The current branch successfully moves Audio Overview execution out of the browser request and into a durable Cloudflare Workflow, but it preserves the legacy generation plane. A live job reaches 10%, retrieves indexed source content, and then fails because the configured Dia service is unavailable. Selecting Aura instead would make the job move again, but would violate the accepted production decision.

The master plan and ADRs require Gemini 2.5 Flash Preview TTS as a versioned, native two-speaker Audio Renderer; frozen source evidence; Scene-level rendering and quality checks; homogeneous PCM; a lossless WAV Audio Artifact in private R2; normalized Convex records; post-publication Alignment; and separate Interjection artifacts. The current bridge implements only the durable-job portion of that target.

Change category: failed compatibility approach plus an explicit owner requirement to implement the original architecture rather than extend the temporary bridge.

## 2. Impact analysis

### Epic and story impact

- The standalone Audio Overview epic remains viable, but its remaining v2 work is now required before generation is considered ready.
- Learn Epic 3, especially Story 3.5, depends on the same `/api/audio-overview/generate` engine. Course primers must reuse the corrected engine and must not introduce a parallel TTS path.
- Existing v1 overviews remain playable and deletable through the legacy projection. They are not bulk-migrated.
- Interjections remain a later stage of this correction, but cannot be called complete until they use the frozen source scope, a compatible managed voice, and a separate artifact.

### Artifact conflicts

- `_bmad-output/implementation-artifacts/spec-durable-audio-overview-job.md` describes an intentionally incomplete compatibility bridge. It remains useful as completed migration history, but no longer defines production readiness.
- `docs/plans/podcast-audio-overview-implementation-plan.md` and ADRs 0001-0004 remain authoritative.
- The Learn PRD and architecture continue to require reuse of the existing Audio Overview API. No Learn-specific renderer is added.
- The player UX is preserved; its data source expands to a v2 playback projection with explicit Alignment state.

### Technical impact

- Replace Dia/Aura production selection with a versioned Gemini renderer and an explicit configuration error when unavailable. No silent paid-provider fallback.
- Replace per-turn rendering with jointly rendered 1-3 minute Scenes.
- Add Source Manifest, Scene, Utterance, Audio Artifact, Alignment, and quality-evidence records in Convex.
- Bind private R2 to the Workflow and publish deterministic WAV objects assembled from mono 24 kHz 16-bit PCM.
- Move orchestration substance into the Workflow boundary; Pages endpoints remain narrow authenticated adapters where required.
- Preserve authority, quota, idempotency, cancellation, retries, and existing v1 reads.

## 3. Recommended approach

Use a direct adjustment plus expand-and-contract migration. Retain the correct durable Workflow and authority work, stop extending the Dia/Aura bridge, and implement v2 behind the existing command endpoint. Do not roll back the Workflow; do not reduce the product goal.

Effort: high. Risk: high until provider fixtures, media validation, and end-to-end playback pass. The work should be delivered in dependency order so no paid synthesis happens before source, cancellation, and idempotency boundaries are established.

## 4. Detailed changes

### Production Audio Renderer

OLD: `dia | aura-1` is chosen at runtime, Dia may collapse an episode into one item, and Aura renders saved turns independently.

NEW: `gemini-2.5-flash-preview-tts` is the production renderer behind an `AudioRenderer` adapter and versioned Audio Profile. Each Scene supplies both named speakers, fixed voices, scene context, emotional arc, delivery direction, and transcript. Missing Gemini configuration fails honestly before script or synthesis. Dia remains evaluation-only; Aura is not a silent fallback.

### Grounding and dialogue

OLD: live retrieval chunks flow directly into a flat dialogue prompt, with source indexes attached to turns.

NEW: the job freezes a Source Manifest with source revision/hash/display metadata, creates an Outline and Claim Ledger, then creates bounded Scenes and Utterances whose claims resolve only to that manifest.

### Media and persistence

OLD: per-turn MP3-like bytes are uploaded to Convex storage and projected into nested `audioOverviews.turns`.

NEW: every Scene is validated as mono 24 kHz 16-bit PCM, quality-gated, and stored as retry-safe staged media. The Workflow streams one valid WAV Audio Artifact to a deterministic private R2 key, stores its checksum/evidence, and atomically publishes normalized v2 metadata. V1 playback remains supported.

### Alignment and interjections

OLD: per-turn transcription timings are nested and failures are treated as skipped; Interjections use live retrieval and legacy renderers.

NEW: playback becomes ready before Alignment. Alignment records move through `pending`, `ready`, or `failed` and align ASR timing to known Utterances. Interjections use the frozen manifest, create a separate artifact, and never rewrite the canonical episode.

## 5. Implementation handoff

Classification: major. Product intent and architecture are already approved by the owner; implementation is routed to the development and architecture agents on `feat/audio-overview-hardening`.

Success criteria:

1. No new production generation references Dia/Aura or silently changes providers.
2. A configured job progresses through manifest, planning, Scene rendering, Quality Gate, WAV assembly, R2 publication, and asynchronous Alignment.
3. Retries do not repeat completed provider calls or publish duplicate artifacts.
4. Existing v1 overviews remain playable/deletable.
5. Contract, authority, Workflow resume, provider fixture, media validity, mounted realtime, and end-to-end lifecycle tests pass without a paid call in CI.
6. Local startup reports Gemini/R2/Workflow readiness honestly; real provider proof is performed only through an owner-triggered generation.

## Change checklist

- [x] Triggering implementation identified: durable Audio Overview bridge after the 10% provider-selection failure.
- [x] Core problem and live evidence recorded.
- [x] Current and future epic impact assessed.
- [x] PRD, architecture, UX, spec, environment, testing, and deployment impacts assessed.
- [x] Direct adjustment, rollback, and MVP reduction considered; direct adjustment selected.
- [x] Specific before/after changes and success criteria defined.
- [x] Owner approval recorded from the explicit instruction to follow the master plan.
- [N/A] Sprint status changes: no Learn epic IDs are added, removed, or reordered.
