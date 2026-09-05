# Audio Overview implementation plan

Status: implementation-ready
Date: 2026-09-02

## Planning artifacts

- [Completed Wayfinder map](https://github.com/wescodess/budds/issues/135)
- [Implementation specification](https://github.com/wescodess/budds/issues/144)
- [First unblocked implementation ticket](https://github.com/wescodess/budds/issues/145)
- Domain vocabulary: `CONTEXT.md`
- Accepted architecture decisions: `docs/adr/0001-0004`

## Executive decision

Budds can deliver a polished, two-host Audio Overview at very low cost, but NotebookLM-level quality, zero production cost, and private document processing cannot all be guaranteed at once.

The recommended production path is to retain the existing Audio Overview experience while replacing the current Dia/Aura generation plane with Gemini 2.5 Flash Preview TTS native two-speaker rendering. A standalone Cloudflare Worker owns the durable Workflow and is invoked by the existing Pages application through a service binding. Final audio is stored privately in Cloudflare R2.

For a ten-minute episode, the estimated TTS cost is approximately $0.15 at standard pricing or $0.075 through batch generation. Including script generation and optional transcript alignment, the working estimate is $0.16-$0.19 per ten-minute episode. Batch is an opt-in economy mode because its turnaround can extend to 24 hours.

## Existing product surface

Budds already contains a substantial Audio Overview product:

- Two-host script generation.
- 5, 10, and 20-minute formats.
- Complexity and voice controls.
- Generation progress and task state.
- Playback, seeking, speed control, download, sharing, public pages, and a mini-player.
- Transcript synchronization and follow-up interjections.
- Joint-dialogue Dia rendering with a per-turn Aura fallback.

The frontend and user journey should be preserved. The primary work is in provider integration, durable orchestration, source grounding, persistence, security, and quality assurance.

## Current blockers

### Dia wire contract

The TypeScript Dia client posts JSON and expects JSON containing base64 audio, duration, request ID, and word timings. The Python service returns raw `audio/mpeg` bytes and does not implement the cancellation route called by the client. The current client therefore attempts to parse MP3 bytes as JSON.

The configured Dia health endpoint was unavailable during the audit, and its associated cloud project reported a suspended state.

### Dialogue quality

The current Dia implementation passes long multi-turn chunks, permits non-strict alternation, has no stable initial voice prefix, supplies continuation audio without its matching transcript, and slows completed audio using a fixed tempo transform. These choices work against consistent voices and natural pacing.

The complete joint episode is persisted as a single Host A turn, so speaker highlighting and transcript synchronization cannot accurately represent Host B.

### Authority and operational correctness

- The orphan-blob deletion mutation authenticates the caller without proving ownership of the storage object.
- Daily generation quota has been changed to infinity and is not enforced authoritatively at the generation boundary.
- Rate limiting uses process-local memory and is ineffective across serverless isolates.
- A selected document scope can expand to all folder documents through fallback retrieval.
- Long-running generation remains coupled to the initiating HTTP connection and lacks durable idempotent execution.
- MP3 download assembly performs byte concatenation rather than proper media concatenation or transcoding.
- Transcription runs on the generation critical path and failures are silently reduced to missing timings.

### Convex data shape

Audio turns and word timings are large nested arrays inside an Audio Overview document. Interjection history is similarly nested. These collections should become bounded, indexed records so longer episodes do not approach document limits or rewrite large documents on every update.

## Target architecture

1. An authenticated server-authoritative mutation validates scope, reserves quota and budget, computes an idempotency key, and creates an immutable Generation Job.
2. A standalone Cloudflare Workflow Worker loads the exact Source Manifest, creates a grounded Outline and Claim Ledger, writes the Dialogue Script, renders Scenes, evaluates audio, assembles the artifact, and publishes the result. The Pages application invokes it through a service binding.
3. Gemini native two-speaker TTS renders coherent 1-3 minute scenes using two fixed voices and a versioned Audio Profile.
4. The Audio Renderer returns homogeneous mono 24 kHz 16-bit PCM Scenes. The Workflow streams a correct WAV header and the ordered PCM bodies into a lossless final Audio Artifact in private R2; it does not transcode or concatenate MP3 files.
5. Convex stores job state, entitlements, source mappings, scene metadata, utterances, alignment records, sharing state, and audit evidence.
6. The Audio Overview becomes playable as soon as the artifact is ready. Transcription and alignment continue asynchronously and update the player when available.

## Canonical generation pipeline

### Source manifest

Build a frozen manifest containing only the user-selected sources, their revisions, content hashes, and display references. Every downstream claim must resolve to this manifest. A folder-wide fallback must never silently broaden an explicit selection.

### Outline and claim ledger

Generate an episode outline with learning objectives, narrative progression, planned source coverage, and a claim ledger. Verify that the intended duration and requested complexity have sufficient grounded material before dialogue writing begins.

### Structured dialogue

Represent each utterance with:

- Scene identity.
- Speaker identity.
- Spoken text.
- Supporting source identities.
- Emotional and delivery intent.
- Optional pause-after guidance.

Use distinct host roles and a whole-episode emotional arc. Do not require canned filler, laughter, agreement, or recap quotas. Delivery instructions guide synthesis and must not become spoken markup.

### Scene rendering

Render both speakers jointly within each scene. Do not synthesize saved turns independently. Reuse the same voices and versioned Audio Profile across all scenes. Retry only the failed scene, never a completed episode indiscriminately.

### Automated quality gate

Evaluate every scene for:

- Missing or unsupported claims.
- Speaker count and speaker consistency.
- Duration outside the requested tolerance.
- Excessive silence, clipping, truncation, or tempo drift.
- Spoken direction markup.
- Transcript divergence beyond the accepted threshold.

Reject and regenerate only the scene that fails.

### Assembly and publication

Validate homogeneous PCM metadata for every Scene, then stream a correct WAV header and the ordered PCM bodies into the final R2 Audio Artifact. Store checksums and immutable generation evidence, then atomically publish the ready state in Convex. Compressed export remains behind an Audio Assembler interface and is outside the first production release.

### Alignment

Run transcription after publication. Align recognized words to the known script rather than treating ASR output as the source of truth. Persist timing records independently from utterances and expose explicit `pending`, `ready`, and `failed` alignment states.

### Interactive follow-up

An Interjection pauses playback, retrieves evidence from the frozen source scope, creates a grounded short answer, renders it with a compatible managed voice, and resumes the original timeline. It is a separate artifact and must not rewrite the canonical episode.

## Cost controls

- Default to standard Gemini rendering for interactive turnaround.
- Offer batch rendering only as an explicit economy option.
- Use paid provider requests for private user content; the Gemini free tier may use submitted data for product improvement.
- Enforce daily and per-job limits on the server.
- Reserve estimated spend before starting and reconcile actual spend at completion.
- Cache only when ownership and privacy policy permit, using source, profile, script, and provider-version hashes.
- Store replayable audio in R2 to benefit from its free egress and storage allowance.

## Open-source posture

Do not invest further in the current Dia 1.6 deployment as the default production route. Keep the provider interface so a future open model can be evaluated without changing the product contract.

Dia2 is a candidate for later evaluation because it supports streaming dialogue and word timestamps, but its current long-form and voice-stability constraints require scene-level testing. Self-hosting becomes attractive only when usage volume, privacy requirements, or negotiated infrastructure make the operating burden worthwhile.

## Verification strategy

Before implementation, conduct a blind bake-off using three representative Budds source sets and the same target scripts:

1. NotebookLM reference output.
2. Gemini 2.5 Flash Preview TTS.
3. Corrected Dia or Dia2 output.

Score naturalness, emotional range, interruptions and pauses, voice consistency, factual fidelity, listening fatigue, generation latency, failure rate, and total cost. The bake-off confirms the provider choice; it does not block authority, orchestration, data-model, or storage corrections.

Implementation acceptance must include:

- Contract tests at the generation API boundary.
- Server-authority tests for ownership, scope, quota, and idempotency.
- Workflow retry and resume tests.
- Provider contract tests with deterministic fixtures.
- Mounted player tests proving speaker and transcript updates without refresh.
- Media validity checks after assembly and download.
- End-to-end tests for create, cancel, retry, play, align, share, delete, and interject.
- Public endpoint probes after deployment.

## Recommended sequence

1. Repair storage deletion authority and reinstate authoritative quota enforcement.
2. Introduce normalized Generation Job, Scene, Utterance, and Alignment records behind compatibility reads.
3. Implement the Gemini two-speaker provider and blind quality fixture.
4. Deploy a standalone Cloudflare Workflow Worker and invoke it from Pages through a service binding, with idempotent retries and cancellation.
5. Publish lossless WAV media through private R2 and replace invalid MP3 byte concatenation with streamed PCM assembly.
6. Add grounded outline, claim-ledger, and scene-quality gates.
7. Move transcript alignment off the readiness critical path.
8. Rebuild Interjections on the frozen source scope and compatible voice contract.
9. Migrate existing Audio Overviews, remove legacy Dia assumptions, and run complete acceptance gates.

## Cost and provider references

- [Gemini speech generation](https://ai.google.dev/gemini-api/docs/speech-generation)
- [Gemini 2.5 Flash Preview TTS](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-preview-tts)
- [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Gemini Batch API](https://ai.google.dev/gemini-api/docs/batch-api)
- [Cloudflare Workflows](https://developers.cloudflare.com/workflows/)
- [Cloudflare Workflows pricing](https://developers.cloudflare.com/workflows/reference/pricing/)
- [Calling Workflows from Pages](https://developers.cloudflare.com/workflows/build/call-workflows-from-pages/)
- [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- [Dia](https://github.com/nari-labs/dia)
- [Dia2](https://github.com/nari-labs/dia2)
- [RunPod serverless pricing](https://docs.runpod.io/serverless/pricing)

## Initial audit evidence

- Focused audio-domain tests: 76 passed.
- Full test run: 745 passed, 8 skipped, and 2 failed because the daily cap was infinite instead of ten.
- Type checking could not start because the local installation lacked `vue-tsc`.
- No direct integration tests covered the complete generation route, Dia wire contract, Whisper alignment, or synchronized transcript behavior.
