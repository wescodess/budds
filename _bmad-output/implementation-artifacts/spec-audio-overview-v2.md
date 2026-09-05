---
title: 'Deliver the production Audio Overview v2 pipeline'
type: 'feature'
created: '2026-09-03'
status: 'implementation-ready'
source_of_truth: 'docs/plans/podcast-audio-overview-implementation-plan.md'
supersedes: '_bmad-output/implementation-artifacts/spec-durable-audio-overview-job.md'
baseline_commit: '6f2964c'
---

# Audio Overview v2 implementation specification

## Supersession

This specification supersedes the Dia/Aura version-1 compatibility bridge as the definition of production readiness. The bridge remains migration history, and its durable command, authority, cancellation, and Workflow mechanics may be retained when they satisfy this specification. No new production Generation Job may select Dia or Aura, write per-Utterance MP3 media to Convex storage, or publish only the nested version-1 model.

The authoritative product intent remains `docs/plans/podcast-audio-overview-implementation-plan.md` and ADRs 0001-0004. If this specification and the plan differ, the plan wins.

## Required production path

An authenticated Pages command reserves quota and one immutable Generation Job, then starts the standalone Cloudflare Workflow through the `AUDIO_OVERVIEW_WORKFLOW` service binding. The Workflow freezes the exact Source Manifest, produces an Outline and Claim Ledger, writes bounded Scenes and Utterances, jointly renders each Scene with Gemini 2.5 Flash Preview TTS, runs a recorded Quality Gate, and assembles homogeneous PCM into one private R2 WAV Audio Artifact. Convex atomically publishes normalized version-2 metadata; Alignment continues after playback becomes ready.

Provider selection is explicit. `GEMINI_API_KEY` and the versioned Gemini Audio Profile enable production rendering; missing configuration terminal-fails before paid synthesis. Aura is not a fallback, and Dia remains evaluation-only.

## Concrete module map

| Responsibility | Concrete module | Required change or invariant |
|---|---|---|
| Command, ownership, quota, and idempotency | `server/api/audio-overview/generate.post.ts`, `convex/tasks.ts`, `convex/audioOverviewJobs.ts` | Return HTTP 202 quickly; freeze exact owned source revisions; reserve finite quota and budget once. |
| Structured planning | `server/utils/audio-overview-script.ts` | Produce and validate the Outline, Claim Ledger, Scenes, Utterances, emotional intent, delivery intent, and pauses against only the Source Manifest. |
| Normalized persistence | `convex/schema.ts`, `convex/audioOverviewV2.ts` | Store bounded Source Manifest, Scene, Utterance, source-link, Audio Artifact, Quality Gate, and Alignment records. Keep v1 records read-only for compatibility. |
| Durable orchestration | `workers/audio-overview/src/index.ts`, `workers/audio-overview/src/orchestration.ts` | Own paid/stateful checkpoints, deterministic identities, cancellation, bounded retries, Scene-only regeneration, assembly, publication, and post-publication Alignment. |
| Production Audio Renderer | `workers/audio-overview/src/gemini-audio-renderer.ts` | Use the versioned native two-speaker Gemini adapter with two fixed Hosts and no automatic provider fallback. |
| Media validation and assembly | `workers/audio-overview/src/media.ts` | Require mono 24 kHz signed 16-bit little-endian PCM and stream one correct WAV header plus ordered Scene bodies. |
| Quality Gate | `workers/audio-overview/src/quality.ts`, `convex/audioOverviewV2.ts` | Record grounding, speaker, duration, silence, clipping, truncation, tempo, direction-markup, and transcript-divergence evidence before accepting each Scene. |
| Private artifact storage | `workers/audio-overview/wrangler.jsonc`, planned `workers/audio-overview/src/artifact-store.ts` | Use the `AUDIO_ARTIFACTS` private R2 binding and deterministic job/Scene/final keys. Never expose a bucket publicly. |
| Playback and v1 projection | `convex/audioOverviews.ts`, `app/composables/useAudioOverviewStore.ts`, `app/components/audio-overview/AudioOverviewPlayer.vue`, `PublicAudioShell.vue` | Read v1 or v2 through a versioned projection; refresh speaker and Alignment state through Convex subscriptions. |
| Alignment | planned `workers/audio-overview/src/alignment.ts`, `convex/audioOverviewV2.ts` | Start after publication, align recognized words to known Utterances, and persist `pending`, `ready`, or `failed`. |
| Interjections | `server/api/audio-overview/interject.post.ts`, `convex/audioOverviewInterjections.ts` | Use the frozen Source Manifest and a compatible managed voice; store a separate private artifact without rewriting the episode. |
| Legacy evaluation only | `server/utils/tts-dia.ts`, `server/utils/tts-workers-ai.ts`, `server/utils/tts-provider.ts` | Remove from the production Generation Job call graph. Retain only behind explicit evaluation or legacy-read boundaries until removal evidence exists. |

## Acceptance gates

| Gate | Passing evidence |
|---|---|
| G1 Authority | Contract and Convex tests prove ownership, exact scope, immutable revision/hash capture, finite quota/budget reservation, one active job, and idempotent duplicate submission. |
| G2 Durability | Workflow tests prove resume after interruption, cancellation before paid work, deterministic step/object identities, bounded retry, and no repeat of accepted provider work. |
| G3 Renderer | Fixture tests prove the exact Gemini model, native two-speaker configuration, stable versioned Audio Profile, PCM contract, performance directions, explicit configuration failure, and no Dia/Aura fallback. |
| G4 Grounding | Tests reject unknown sources/claims, unsupported claims, broadened explicit scope, missing Hosts, and direction markup inside spoken text. |
| G5 Scene Quality | Deterministic fixtures exercise every recorded Quality Gate check and prove that only a failed Scene regenerates within a bounded attempt count. |
| G6 Media and privacy | Media tests validate WAV headers, PCM homogeneity, duration, checksum, R2 deterministic keys, private binding use, cleanup, and range-capable playback/download. No MP3 byte concatenation remains. |
| G7 Publication | Convex tests prove that all Scenes passed before one atomic v2 publication and that Alignment starts as `pending` after the Audio Artifact is playable. |
| G8 Compatibility and realtime | Mounted tests prove v1 and v2 playback, speaker changes, Alignment updates, share/delete behavior, and reload recovery without polling or refresh. |
| G9 Interjection | End-to-end tests prove frozen-scope retrieval, separate artifact ownership, compatible Host identity, pause/resume, and an unchanged canonical Audio Artifact. |
| G10 Operations | Local env validation passes; Worker/Pages/Convex tests, typechecks, lint, build, deployment probes, cost telemetry, and owner-triggered real generation pass. CI uses no paid provider call. |
| G11 Listening | A blind bake-off records naturalness, emotion, pauses, voice consistency, fidelity, fatigue, latency, failures, and cost for three representative source sets. |

## Master-plan traceability

Every section of the source plan has an implementation owner and a release gate.

| Plan section | Module mapping | Gate |
|---|---|---|
| Planning artifacts | This specification, `CONTEXT.md`, ADRs 0001-0004, and linked GitHub map/spec/task | G10 |
| Executive decision | `gemini-audio-renderer.ts`, `index.ts`, `artifact-store.ts`, `wrangler.jsonc` | G2, G3, G6 |
| Existing product surface | Versioned playback projection and current Audio Overview Vue surfaces | G8 |
| Current blockers | Provider isolation, structured planning, server authority, deterministic artifacts, and normalized records | G1-G7 |
| Current blockers: Dia wire contract | Production call graph excludes `tts-dia.ts` | G3 |
| Current blockers: dialogue quality | `audio-overview-script.ts`, `gemini-audio-renderer.ts`, Scene records | G3-G5 |
| Current blockers: authority and operational correctness | generation route, tasks/jobs authority, Workflow checkpoints, deterministic R2 keys | G1, G2, G6 |
| Current blockers: Convex data shape | normalized schema and `audioOverviewV2.ts` | G7, G8 |
| Target architecture | Pages command, Workflow, Gemini adapter, normalized Convex model, private R2, asynchronous Alignment | G1-G8 |
| Canonical generation pipeline | `orchestration.ts` composes the manifest, plan, render, gate, assemble, publish, and Alignment modules | G1-G9 |
| Source manifest | tasks/jobs reservation and normalized manifest records | G1, G4 |
| Outline and claim ledger | `audio-overview-script.ts`, normalized source links | G4 |
| Structured dialogue | `audio-overview-script.ts`, Scene and Utterance records | G3-G5 |
| Scene rendering | Workflow orchestration and `gemini-audio-renderer.ts` | G2, G3, G5 |
| Automated quality gate | `quality.ts` and persisted Scene Quality Gate records | G4, G5 |
| Assembly and publication | `media.ts`, `artifact-store.ts`, `audioOverviewV2.ts` | G6, G7 |
| Alignment | `alignment.ts`, normalized Alignment records, realtime projection | G7, G8 |
| Interactive follow-up | interjection route/model and separate R2 artifact | G9 |
| Cost controls | `audioOverviewPolicy.ts`, reservation state, renderer telemetry, deterministic cache keys | G1, G10 |
| Open-source posture | legacy renderer boundary and explicit evaluation flag only | G3 |
| Verification strategy | provider/media/authority/Workflow/component/E2E suites and deployed probes | G1-G11 |
| Recommended sequence | dependency order below | G1-G10 |
| Cost and provider references | ADR 0001 plus version-pinned adapter/config documentation | G3, G10 |
| Initial audit evidence | superseded baseline retained in the plan and v1 bridge spec; new evidence appended here only after reruns | G10 |

## Dependency order

1. Finish authority and frozen source revision/hash capture.
2. Finish normalized v2 records and versioned compatibility reads.
3. Complete the Gemini fixture adapter and listening fixture.
4. Move the complete generation pipeline into durable Workflow steps.
5. Add deterministic private R2 Scene/final artifact writes and streamed WAV assembly.
6. Complete Outline, Claim Ledger, and all Scene Quality Gate checks.
7. Publish before asynchronous Alignment.
8. Rebuild Interjections against the frozen Source Manifest.
9. Prove v1 compatibility, then remove legacy production generation callers.
10. Run G1-G11 and enable production only after owner-triggered real-provider proof.

## Definition of ready

The implementation is ready for production only when G1-G10 pass and the owner accepts G11. A job reaching 10%, a successful script response, a successful provider request, or a locally playable fixture does not by itself satisfy production readiness.

## Change log

- 2026-09-03: Owner direction made the master plan authoritative for the entire Audio Overview feature. This specification superseded the Dia/Aura v1 bridge as the production implementation contract.
