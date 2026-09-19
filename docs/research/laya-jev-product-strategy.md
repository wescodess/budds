# Laya and Jev strategy for Budds

Date: 2026-09-19
Status: Product and architecture recommendation; no runtime integration has been implemented

## Decision

If Budds adopts one of these systems first, adopt **Jev in a measured shadow-mode pilot**.

Jev matches Budds' highest-value unresolved problems: deciding whether evidence supports a claim, judging a response against a bounded rubric, identifying ambiguity, and exposing uncertainty to application code. It also fits the existing TypeScript and hosted-provider architecture better than Laya. Jev must not replace the models that write chat answers, cards, quizzes, scripts, or lessons; it does not generate prose.

Retain **Laya as a phase-two option for shared concept tagging and request routing**. Its open Apache-2.0 weights and local inference are attractive for privacy and high volume, but Budds would need to operate a separate Python inference service and create a Budds-specific calibration set. The released models are too new and too weakly validated on education tasks to make authoritative learning decisions today.

The product opportunity is not five separate integrations. It is one learning-intelligence layer:

1. Every source, message, card, question, podcast claim, objective, and attempt can be linked to stable concept IDs.
2. Fast classification can suggest those links and route work.
3. Typed judgments can assess support, ambiguity, or demonstrated understanding.
4. Existing Budds code remains authoritative for access, evidence, publication, score arithmetic, state transitions, schedules, and billing. Bounded model judgments may be inputs, but never own those outcomes.

## What the products actually are

### Jev

Jev is TypeSafe's hosted, proprietary System One model. It receives text or structured textual state and answers predefined `choice`, ordinal `score`, and probabilistic yes/no (`noul`) questions. It returns typed answers, probability distributions, and confidence rather than text. Several questions can be evaluated independently against the same state in one request. TypeSafe explicitly recommends decomposing broad judgments and combining them in application code ([introduction](https://docs.typesafe.ai/introduction), [System One concepts](https://docs.typesafe.ai/concepts/system-one)).

The direct API is `POST /v1/systemone`; TypeSafe provides a JavaScript SDK. OpenRouter also lists Jev 1.13, currently at $0.042 per million input tokens, free output, and a 32K context window ([TypeSafe quick start](https://docs.typesafe.ai/introduction/quickstart), [OpenRouter model page](https://openrouter.ai/typesafe/jev-1.13/)). TypeSafe's launch latency and calibration results are vendor claims, not Budds evidence ([launch article](https://typesafe.ai/blog/introducing-system-one-models-and-jev)). A typed result can still be wrong.

Jev is text-only. Audio, images, and video must first become trustworthy text or structured state. It cannot write a chat response, learner explanation, rationale, card, question, or podcast script. If Budds shows explanatory prose after a Jev decision, that prose must come from deterministic reason codes or a separately grounded generative step.

### Laya

Laya is a very new open-source Python package and set of self-hosted decision checkpoints. Like Jev, it exposes `choice`, `score`, and probabilistic yes/no decisions rather than prose. Its current checkpoints include an English ModernBERT-large model, a multilingual mmBERT model, and a typed-decisions checkpoint; contexts are only 512 or 1,024 tokens ([repository and model table](https://github.com/NandhaKishorM/laya#model-routing-three-checkpoints-one-call), [PyPI package](https://pypi.org/project/laya/)). Code and weights are Apache-2.0.

Published latency and Jev-comparison numbers are author-reported. The project itself says its Jev comparison was not run under identical conditions, its base checkpoints perform poorly on the typed-decisions suite, multilingual routing is essential, and calibration still has important limitations ([benchmarks](https://github.com/NandhaKishorM/laya#benchmarks)). Laya is therefore a candidate to evaluate, not a production-quality claim we can inherit.

## Comparison for Budds

| Dimension | Jev | Laya | Budds implication |
| --- | --- | --- | --- |
| Best role | Bounded judgment with uncertainty | High-volume classification, routing, tagging | Jev first; Laya later |
| Integration | Hosted HTTP/TypeScript SDK; also listed on OpenRouter | Python/PyTorch service with downloaded weights | Jev is much closer to the current Nuxt/Cloudflare stack |
| Context | 32K on OpenRouter; verify direct API limits before implementation | 512–1,024 tokens | Laya requires aggressively bounded excerpts |
| Data boundary | Third-party hosted processing | Can be self-hosted | Laya may win where local processing is a hard requirement |
| Maturity | Early access, proprietary | Beta, released this week, open source | Neither may be authoritative without Budds evaluations |
| Output | Typed values and probabilities, no prose | Typed values and probabilities, no prose | Keep existing generative models |
| Main risk | Vendor/privacy dependency and unproven education calibration | New infrastructure plus domain fine-tuning/calibration | Start in shadow mode |

Privacy is a release gate. TypeSafe says customer inputs are not used to train model weights, but its public policy permits service-provider processing and US processing and says the service is not directed at children under 18 ([privacy policy](https://typesafe.ai/legal/privacy-policy), [customer agreement](https://typesafe.ai/legal/mca)). Before production learner data is sent, Budds must confirm retention, subprocessors, deletion, region, DPA coverage, and the intended age population for either direct TypeSafe or OpenRouter routing.

## Cohesive architecture

Add one server-owned decision boundary, not provider calls scattered through feature routes.

```text
source/evidence + user action
          |
          v
  bounded decision request
  - tenant/user scope
  - stable concept IDs
  - evidence revision IDs
  - question-schema version
          |
          +---- Jev adapter: support, ambiguity, rubric judgment
          |
          +---- Laya adapter later: routing, taxonomy, duplicate candidates
          v
  LearningSignal ledger
  - provider/model/version
  - typed result + full distribution/confidence
  - input digest and evidence IDs
  - shadow/advisory/enforced mode
  - deterministic policy outcome
          |
          v
 existing feature-specific validator and state machine
```

The shared contract should contain `signalKind`, `subjectType`, `subjectId`, `conceptIds`, `evidenceRevisionIds`, `questionSchemaVersion`, `provider`, `model`, `modelVersion`, typed answers, distributions/confidence, `inputDigest`, `mode`, and timestamps. It should not contain model-authored rationale because neither product generates one.

The canonical concept taxonomy is the cohesion mechanism. A learner should see one concept's evidence, chat questions, cards, quiz performance, podcast moments, and Learn mastery history as related activity—not five unrelated products. Models may suggest mappings; user edits and stable application IDs must win.

## Feature recommendations

### Chat

Current folder chat retrieves scoped evidence, constructs cited context, and uses the existing generative gateway to stream prose (`server/api/rag/chat.post.ts`). Keep that flow.

Use Jev first for:

- A pre-generation answerability signal: `supported`, `partially_supported`, or `unsupported`, based only on retrieved excerpts. Low confidence should cause a visible clarification or “not enough evidence” state, not a fabricated answer.
- A post-generation shadow check that the answer's individual claims are supported by cited excerpts. Initially log disagreements; do not delay streaming or silently remove answers.
- A typed intent decision only where it changes safe product behavior, such as `ask`, `summarize`, `compare`, or `create_practice`.

Use Laya later to classify high-volume intents, language, concept IDs, and whether retrieval is required. Do not use either model to write the response or invent citations.

UX outcome: chat can say what it knows, show when the folder lacks support, and offer a relevant next action—“make cards,” “quiz me,” or “add this to my learning plan”—linked to the same concepts.

Pilot gate: on a blinded set of grounded and unanswerable folder questions, answerability precision at least 95%, false refusal below 10%, and no cross-folder evidence. Race the remote preflight against a 300–500 ms budget; on timeout, continue the normal grounded flow with preflight marked unavailable. Measure and cap first-token latency separately before enabling it for users.

### Flashcards

Current generation retrieves folder content, parses generated card JSON, attaches source provenance, and persists a room (`server/api/flashcards/generate.post.ts`). Review quality is learner-selected and scheduling is deterministic SM-2 (`convex/reviewItems.ts`). Preserve both.

Use Jev first between parsing/provenance attachment and persistence to judge each candidate as `supported`, `unsupported`, or `ambiguous`. Put uncertain cards in an editable review lane; never let the model rewrite the card or source.

Use Laya later to suggest concept IDs, card shape (`definition`, `process`, `comparison`, `application`), and duplicate candidates. These tags can power mixed practice and links to related quiz and Learn work.

Do not let either model replace the learner's review rating or directly change the SM-2 schedule. Optional semantic answer feedback can come later, clearly labeled as AI feedback and unable to mutate the schedule.

Pilot gate: at least 95% support precision in an independent sample, no model call able to persist content, p95 added deck-generation time under two seconds, and at least 80% of surfaced uncertain cards accepted or edited rather than ignored.

### Quiz

Current generation retrieves folder content, parses questions, records canonical answers and source chunks, then persists them (`server/api/quiz/generate.post.ts`). Current attempt scoring is deterministic equality, including normalized free response (`convex/quizzes.ts`).

Use Jev first as a pre-publication audit: question supported by evidence, canonical answer entailed, distractors unambiguous, and difficulty within the requested band. Surface flagged items in the existing editor rather than silently deleting them.

Use Laya later to tag concept coverage and cognitive level, detect likely duplicates, and propose a balanced distribution before generation. The user controls the final topic and difficulty mix.

After the publication audit is proven, Jev can provide separate semantic feedback for free responses: `fully_correct`, `partially_correct`, `incorrect`, or `uncertain`. During the first release it must not alter the canonical score. Multiple-choice and true/false stay deterministic.

Pilot gate: at least 95% evidence-support precision, false blocking below 10%, zero changes to deterministic scores, and at least 85% agreement with human labels before semantic feedback is shown as more than advisory.

### Podcast / Audio Overview

This is the best technical shadow pilot. Budds already requires scripts to link supported claims and utterances to frozen evidence, parses the claim ledger, and verifies entailment before publication (`server/utils/audio-overview-script.ts`, `server/api/audio-overview/jobs/step.post.ts`, `convex/audioOverviewV2.ts`).

Use Jev to shadow the existing utterance-entailment verifier with independent yes/no probabilities and compare the resulting derived claim bindings. The input is the script text plus frozen quotes—not audio. Keep the current parser, narrowly scoped frozen-evidence repair path, job leases, idempotency, budget reservations, and publication gate authoritative.

Only after evaluation should Jev replace or complement the expensive generative verifier. Uncertain decisions route to the current verifier or user/human review; preserve the narrowly scoped frozen-evidence repair fallback where its existing preconditions apply. This produces a safe cascade: cheap bounded judge first, slower reasoning model only for ambiguous cases.

Use Laya later to tag transcript chunks by concept, segment purpose, repetition, and likely teaching value. It must not decide evidence entailment until a Budds-specific model is calibrated.

UX outcome: fewer unsupported spoken claims, faster generation, transparent “from your sources” moments, and podcast segments that connect directly to cards, quiz questions, and Learn objectives.

Pilot gate: run at least 1,000 historical claim/evidence pairs; require at least 99% recall on currently rejected unsupported claims, at least 95% precision on accepted support, stable calibration by confidence band, and zero publication decisions from shadow output.

### Learn V2

Learn V2 already has the right authority boundary. It rejects unavailable or conflicted evidence, pins accepted revisions, leases provider jobs, validates generated session content, scores rubric criteria, recomputes scores in code, and performs mastery/scheduling transitions server-side (`convex/learnV2SessionContent.ts`, `convex/learnV2MapCalibration.ts`, `convex/learnV2Mastery.ts`, `shared/learn-v2-mastery.ts`).

Use Jev in shadow mode at two existing judgment seams:

- Session-content claim entailment against pinned evidence.
- Calibration and mastery criterion decisions against the accepted assessment contract and the learner response.

Ask one atomic question per criterion. Persist the complete probability distribution and schema/model version, then let existing code recompute the score and apply thresholds. Low confidence, provider failure, changed evidence, or a revision conflict must continue to fail closed. Jev must never mutate lifecycle state, declare mastery, schedule a review, or relax evidence/rights checks.

Use Laya later for objective-to-concept mapping, misconception tags, prerequisite-gap classification, and routing the next practice format. Treat those as recommendations; the accepted blueprint, pinned session, and deterministic mastery state remain authoritative.

UX outcome: faster calibrated feedback, visible uncertainty, remediation that follows the learner's misconception across chat/cards/quiz/podcast, and no weakening of the evidence-first mastery contract.

Pilot gate: on a stratified, human-labeled set of criterion decisions, at least 90% agreement overall, at least 95% recall for incorrect/unsupported responses, expected calibration error at or below 0.05 after any Budds-owned calibration, no authoritative state changes in shadow mode, and 100% fail-closed behavior under timeouts and revision conflicts.

## Recommended delivery sequence

### Phase 0 — Evaluation foundation

- Define the provider-neutral decision and `LearningSignal` contracts.
- Create versioned question schemas and a redacted evaluation corpus from consented or synthetic examples.
- Add direct-TypeSafe and/or OpenRouter Jev adapters behind a hard feature flag; do not reuse the prose-oriented `generateCompletion` abstraction as if the protocols were identical.
- Add cost, latency, confidence-band, disagreement, and provider-failure telemetry without logging raw learner content.
- Resolve privacy, minors, retention, DPA, and provider-route questions.

### Phase 1 — No-authority shadow trials

- Podcast utterance entailment and the resulting derived claim bindings.
- Learn V2 session evidence and mastery criteria.
- Compare Jev with the existing verifier, deterministic results, and a human adjudication sample.

### Phase 2 — User-visible quality controls

- Flashcard and quiz evidence review lanes.
- Chat answerability and clarification states.
- Keep all decisions advisory until feature-specific acceptance gates pass.

### Phase 3 — Cross-product learning graph

- Introduce stable concept IDs and connect content/activity across all five surfaces.
- Evaluate Laya on Budds' own taxonomy in offline mode.
- Operate Laya only if its measured quality, privacy benefit, and total infrastructure cost beat a Jev or deterministic alternative.

### Phase 4 — Calibrated cascades

- Promote only individually validated judgments from shadow to enforced mode.
- Route uncertain Jev/Laya results to the existing reasoning model or human/user review.
- Recalibrate and roll back by schema/model version; never use a floating provider alias for an authoritative decision.

## What not to do

- Do not replace chat, content generation, explanations, or scripts with either model.
- Do not call probability “truth,” or vendor calibration “Budds calibration.”
- Do not let a model directly update score arithmetic, mastery state, schedules, evidence rights, or publication state. Any rubric verdict remains a bounded, versioned input to server-owned policy.
- Do not create five provider adapters or five unrelated taxonomies.
- Do not use Laya's default checkpoint confidence for production automation without domain evaluation and calibration.
- Do not send production learner data until the contractual/privacy gate is resolved.
- Do not expose internal confidence as a decorative percentage unless the UX tells the learner what decision it applies to and what happens when it is uncertain.

## Final recommendation

**Choose Jev first, as a provider-neutral shadow judge.** Start with podcast and Learn V2 because their existing evidence and scoring boundaries make correctness measurable without changing user outcomes. Then apply the proven adapter to flashcard/quiz publication quality and chat answerability.

**Do not deploy Laya yet.** Run it offline after Budds has a stable concept taxonomy and labeled corpus. If it earns its place, use it as the private, inexpensive classifier that connects the product; keep Jev or existing reasoning models for bounded judgments that need longer context and better measured uncertainty.
