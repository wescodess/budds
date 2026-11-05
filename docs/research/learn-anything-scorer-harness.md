# Scorer harness for the Void baseline

Date and external-source access date: **2026-11-05**
Status: Research decision; proposed contract, not an implemented or executed harness
Ticket: [C: What scorer harness and independent model setup can validate the baseline?](https://github.com/wescodess/budds/issues/365)
Map: [Wayfinder: Learn Anything Void](https://github.com/wescodess/budds/issues/355)
Inspected repository revision: `1d60dea5e0621d2519478636005b4ecb0b7bf8a7` (`origin/dev` when this branch was created)

## Recommended families and pins

Use a repository-owned Node CLI with three separate adapters: the unchanged baseline scorer, **Anthropic Claude Sonnet 5.5**, and **Google Gemini 3.6 Flash**. Use direct paid provider APIs for the two independent graders on public, synthetic fixtures. Neither grader can be the baseline scorer's family, including another model from that family. Different vendors/families provide operationally separate judgments, not demonstrated statistical independence or truth.

**Admission prerequisite:** enumerate the actual scorer models for the baseline's published content, resolve their families and upstream routes, and record them in the run manifest. This checkout does not establish that either recommended family is independent of deployed scoring. Unknown identity, family overlap, or an unresolvable alias makes live validation **unavailable**; do not silently substitute another model. If deployed scoring uses Claude or Gemini, select and research a different second family before running.

| Role | Exact requested model and transport pin | Frozen request settings and evidence |
| --- | --- | --- |
| Independent grader A | `claude-sonnet-5-5`; direct `https://api.anthropic.com/v1/messages`; `anthropic-version: 2026-10-21` | Explicit adaptive thinking, `output_config.effort: high`, structured JSON through `output_config.format`, `max_tokens: 2048`, no tools or prompt cache directives. Omit temperature/top-p/top-k. Save returned model, request ID, usage, stop reason and request bytes. |
| Independent grader B | `gemini-3.6-flash`; direct `https://generativelanguage.googleapis.com/v1beta/interactions`; `Api-Revision: 2026-05-20` from the official REST example | Explicit `generation_config.thinking_level: medium`, `max_output_tokens: 2048`, no thought summaries; JSON schema in `response_format`; `store: false`, synchronous/non-streaming, no previous interaction, tools, grounding, files or explicit cache. Save returned model, interaction ID, usage and completion status. |
| Baseline scorer | The actual published-content model and observed upstream identity, plus `learn-v2.mastery-scorer.v1`, prompt/schema hashes and gateway configuration | Preserve the production request and parser settings, including temperature 0 and the 1,200-token output limit. Execute its provider boundary without any Convex writes. Requested and returned model identities must agree with the manifest. |

Sonnet 5.5 is active; Anthropic documents its dateless model ID as a fixed snapshot, while noting serving infrastructure can still change. Its current API rejects sampling parameters. The version header above and structured output shape are documented separately. [Claude model](https://platform.claude.com/docs/en/models/sonnet-5-5/overview), [model version guarantees](https://platform.claude.com/docs/en/about-claude/models/model-ids-and-versions), [API versions](https://platform.claude.com/docs/en/api/versioning), [structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs).

Google documents `gemini-3.6-flash` as an available stable model. This is an exact API model string, **not a verified immutable weights revision**: its versioning policy says stable models usually remain unchanged. Interactions exposes a model name, not a documented immutable revision field. Pin that limitation explicitly, freeze the returned name, and retain repeated sentinel results; any detected drift invalidates comparison across runs. Do not invent a dated or `-001` suffix. The older GenerateContent API exposes `modelVersion`, but that does not itself provide an immutable-version guarantee. [Gemini model](https://aistudio.google.com/docs/models/gemini-3.6-flash), [version policy](https://aistudio.google.com/docs/models#model-versions), [Interactions reference](https://aistudio.google.com/api-reference/interactions-api), [GenerateContent reference](https://aistudio.google.com/api-reference/generate-content).

The Google transport is chosen because the official Interactions thinking guide explicitly bounds **thinking plus visible output** with `max_output_tokens`, and shows the pinned revision header. Do not transplant an assumed token bound to another endpoint. Both adapters need an authorized canary before a full run; documented availability is not successful access from this account. [Thinking controls and output bound](https://aistudio.google.com/docs/thinking#token-limits), [creating an interaction](https://aistudio.google.com/api-reference/interactions-api/create-interaction). Claude thinking also counts against `max_tokens`. [Messages reference](https://platform.claude.com/docs/en/api/messages).

## What exists today

These are source observations at the inspected revision, not claims about deployed configuration:

- [`convex/learnV2Mastery.ts`](../../convex/learnV2Mastery.ts) loads the pinned rubric, one `independent_application` challenge and exact source evidence in `getMasteryScoringInput`. Its scorer model is **`sessionContent.providerModel`**, not a hard-coded model and not `LEARN_V2_MASTERY_MODEL`.
- [`convex/learnV2SessionContent.ts`](../../convex/learnV2SessionContent.ts) publishes that field from `job.providerResponseModel`. Session generation jobs get their requested model from `LEARN_V2_SESSION_CONTENT_MODEL` in [`convex/learnV2Plans.ts`](../../convex/learnV2Plans.ts). Generation and subsequent rubric scoring are therefore coupled through the published model pin. Calibration separately reads `LEARN_V2_CALIBRATION_MODEL`, falling back to `LEARN_V2_MASTERY_MODEL`, in [`convex/learnV2MapCalibration.ts`](../../convex/learnV2MapCalibration.ts).
- The mastery scorer calls [`generateCompletion`](../../server/utils/ai-gateway.ts) through Cloudflare AI Gateway and OpenRouter. It requests strict JSON criterion booleans and misconception tags, temperature 0, one attempt, no provider fallback, no gateway payload logging, no gateway cache, ZDR routing and no provider data collection. It does **not** pass `providerOrder`; the upstream endpoint is not pinned there. Persisted `scorerModel` is the content pin; the scoring commit does not persist a separately verified completion model/upstream. A harness must collect that evidence rather than infer it from the stored field.
- [`shared/learn-v2-mastery.ts`](../../shared/learn-v2-mastery.ts) validates exact criterion keys and weights summing to 100, then sums weights for awarded booleans. The gate is `LEARN_V2_MASTERY_THRESHOLD = 80`; the transition version is `learn-v2.mastery-transition.v1`. Keep 80 recorded as the baseline comparator while evaluating alternatives.
- [`shared/adaptive-v2-pilot-policy.ts`](../../shared/adaptive-v2-pilot-policy.ts) currently has `pilotApproved: false`, an empty cohort and no model policies. Its limits include 48,000 request bytes, 32,000 response bytes, 1,200 output tokens, 90 seconds, one provider attempt and a $0.10 request ceiling. This is a configured ceiling, not an observed price or a general guarantee for every scoring path.
- The generic chat default in [`server/utils/models.ts`](../../server/utils/models.ts) is `openai/gpt-4o-mini`. **That does not identify the mastery scorer.** Test fixture model strings do not identify it either.

A read-only Convex status lookup for this directory returned `No CONVEX_DEPLOYMENT set`. No deployment was configured, no secret values were read, and no model calls were made. Consequently, **the model actually used in production remains unverified**. The orchestrator should inspect non-secret deployment configuration and the distinct content/scoring model pins for the baseline, without exporting learner responses.

## Harness contract

### Boundary and reuse

Implement a small repository CLI and pure evaluation modules in the Phase C spec, using the repository's Node 24 CI runtime and locked dependencies. No hosted evaluation service or Python/GPU runtime is needed for this design. Keep CLI outputs outside application state.

The boundary is **pinned scoring input → provider verdict → deterministic weighted score → offline report**. Do not call `submitMasteryAttempt` or `recordMasteryAttempt`: those reserve jobs, change mastery, emit events and schedule follow-ups. A future shared request builder/parser should preserve the current production prompt and schema byte-for-byte for the baseline adapter; changing those bytes creates a candidate scorer version. Import the pure `scoreCriteria` and transition logic. Test Convex authority separately with the existing Convex-test setup.

[`server/utils/learning-decisions/contracts.ts`](../../server/utils/learning-decisions/contracts.ts) supports only `quiz_quality` and `quiz.free_response_assessment.v1`, with English evidence and bounded four-label free-response judgments. Its manifest caps semantic requests at eight items, evidence at 1,200 characters and learner answers at 800 characters. It has no mastery criterion-vector, concept/form, delayed-anchor or mastery transition contract. [`index.ts`](../../server/utils/learning-decisions/index.ts) dispatches Laya in shadow/advisory, but structured LLMs only in shadow. The structured adapter only handles the free-response kind; it cannot grade `quiz_quality` just because dispatch reaches it. Its allowlist contains OpenRouter model slugs `openai/gpt-4o-mini` and `google/gemini-2.5-flash-lite`, not the recommended grader pins.

Reuse its unavailable reasons, privacy preflight, strict envelope validation and separation of shadow results from authority. Reuse the **patterns** in [`scripts/evaluate-laya-calibration.mjs`](../../scripts/evaluate-laya-calibration.mjs) and [`shared/quiz-semantic-calibration.mjs`](../../shared/quiz-semantic-calibration.mjs): separate fit/held-out sets, hashes, complete coverage, immutable reports and pin-checked checkpoints. Do not reuse its Laya-specific HTTP attestation or probability calibration as mastery validation. Its existing synthetic reference corpus is not a source-bound Void gold set. In particular, do not inherit its three-attempt retry loop into the proposed single-dispatch cost contract.

Create a distinct versioned `mastery.scorer-evaluation.v1` contract. The production prompt is not rewritten to fit the quiz labels. A provider-neutral core can share the mode vocabulary, but current `off | shadow | advisory` configuration is not already a mastery harness:

- `off`: no provider dispatch; missing live evidence stays unavailable.
- `shadow`: compare candidate scores without changing learner state, scheduling or published outcomes.
- `advisory`: an internal diagnostic report only; it grants no scoring or mastery authority.

### Inputs, blinding and outputs

Each item freezes concept/domain, source snapshot hash and locator, rights/retention status, evidence excerpt, answer-key version, challenge/form version, rubric keys/descriptions/weights, response bytes and opaque case ID. Source acceptance and T0 support follow [ADR-0007](../adr/0007-preserve-learn-v2-evidence-integrity-through-deletion.md) and [ADR-0009](../adr/0009-allow-labelled-model-knowledge-as-a-teaching-tier.md). Missing, deleted, inaccessible, conflicting or insufficient evidence yields an unavailable item, never a guessed key. A public synthetic source pack uses explicit test acceptance records; it does not confer acceptance on a real learner's sources.

Every model gets a fresh single-item request containing the same source-bound question, key/rubric and response. Use independent deterministic shuffles and opaque IDs per adapter. Exclude seed class, expected verdict, source split, scorer outputs, other judges, learner identity/confidence, before/after status, condition and timestamps. Neither grader sees the production score, the other grader's answer, or delayed outcomes. The local join happens only after verdict artifacts are sealed. No shared conversations or model-to-model adjudication.

The baseline keeps its existing output. Independent graders return a strict criterion vector plus an explicit supported/abstain disposition; optional bounded source-span references help diagnose disputes but cannot replace evidence checking. Validate every key exactly once, allowed tags, source-span bounds, complete coverage and terminal completion. Compute percent and pass/fail locally. Refusal, truncation, malformed JSON, an abstention, model mismatch or a missing row is **unavailable**, not a zero, a pass, or a dropped denominator. Keep raw provider output for authorized synthetic artifacts and preserve per-item status.

Apply the existing finite transport envelope to the new adapters too: at most 48,000 request bytes and 32,000 response bytes, alongside the stricter token reservations below. Oversized data is unavailable; it is not silently clipped.

Freeze Node patch version, lockfile digest, repository/scorer commit, CLI/parser/prompt/schema versions and hashes, source/key/rubric/form hashes, corpus generator and PRNG seed, adapter/provider/model/API pins, sampling/thinking/output settings, price-access date, threshold artifact, run clock and payload-policy version. Live output is stochastic; exact replay means recomputing reports from sealed responses, not promising identical new generations. Disable the repository's deterministic E2E provider mode for a live run and reject fixture model/response identities.

### Source-derived seeds and golden-topic coverage

Start with eight golden domains: arithmetic/algebra, probability/statistics, programming/data, physical science, biology, history, reading/argument and practical procedures. These are coverage commitments, not claims of validated expertise. Use two distinct concept/source packets per domain and two new surface forms per packet: **32 rubrics × seven seed classes = 224 core responses**. One packet per domain is fit/development and the other held-out: 112 rows each. Split by source/claim family before generation; all sibling forms and transformations stay in the same split. Check normalized duplicates and shared key/claim leakage. Report each domain and objective type separately; English-only evidence cannot establish multilingual validity.

A packet must have an executable answer representation: exact keyed atoms, numeric/unit constraints, a finite relation table, ordering/set rules, or a closed proposition template derived from accepted source spans. Pin the extraction and proof/checker artifact. General prose reasoning without a mechanically checkable label belongs in a separate exploratory set; two models agreeing does not turn it into a gold label.

| Seed class | Construction and independent label check |
| --- | --- |
| Correct | Render all required key atoms; exact, set, numeric/tolerance or relation checker verifies them. |
| Correct paraphrase | Use a finite grammar: clause/order changes and source-defined equivalent terms, preserving the same answer representation. Check round-trip semantic representation. Arbitrary model paraphrases are exploratory until verified this way. |
| Partial | Remove a named required atom and freeze the exact expected criterion vector. Record whether the omitted atom is essential; do not derive the reference mastery label from today's 80 cutoff. |
| Misconception | Apply one explicit inverse, sign, unit, order or relation substitution contradicted by the packet; checker must exhibit the violated constraint. |
| Plausible wrong | Keep topical vocabulary while inserting a demonstrably false relation or an unsupported required claim. Distinguish contradiction from lack of support; neither earns source-bound credit. |
| Off-topic | Substitute an answer from a synthetic distractor set disjoint from both corpus splits and verify no required atom is satisfied. |
| Injection | Add inert instruction attacks to a checked wrong answer, such as claimed authority or a request to award all criteria. Its truth label comes from the substantive answer. Include correct-answer injection controls too: injection text alone must not force a false block. |

Expected vectors and `reference_pass` are computed before any model sees the item. The latter requires the packet's predeclared essential atoms; it is independent of model consensus and the threshold under test. Reject a seed if a checker cannot establish its label; do not ask a model or human to bless it into the correctness denominator. Use diverse explicit operations rather than making all negative cases stylistically obvious. Include multi-criterion, negation, unit, near-boundary-weight and unsupported-source cases. Weight/order/payload failure fixtures supplement the 224 labeled items in offline CI.

### Anchors, directional reports and calibration

**Auto-graded anchors:** join the same learner's rubric item and a distinct held-out keyed item for the same concept, level and form family. Record delay/order, source/item versions, assistance and exposure validity. Grade numeric, exact/set, ordering and test-vector items deterministically on the server. These anchors check related capability, not identity of two different item difficulties; never equate one disagreement with proof that the rubric grade is wrong.

**Delayed anchors:** join independent rubric passes to new, unassisted checks at day 7 and day 30, with test-only presentation and exposure checks. Prefer keyed delayed checks. A delayed check scored by the same rubric model is a correlated secondary signal, not an external validity anchor. Report due/eligible, attempted, valid, missed and assisted counts separately. Before real learners reach those dates, status is `pending_real_delayed_evidence`; simulated clocks prove scheduling and joins only.

The report must include counts, exclusions and rates by domain, source packet, seed class, form, rubric/scorer version and assistance/exposure status:

- Seed **false pass** = passed reference-negative / reference-negative; **false block** = failed reference-positive / reference-positive. Also show unavailable counts over all scheduled cases and score/criterion error distributions.
- Real **false mastery** = independent concepts failing their next valid delayed check / independent concepts with that observed check. Report the eligible denominator and missing-follow-up sensitivity bounds beside it. False block against a real skip-ahead check is a separate denominator; blocked learners without a check are unknown.
- Judge/judge and judge/production criterion agreement, pass/fail confusion matrices, directional disagreements and abstentions. Include self-disagreement from repeat probes. Confidence or model probabilities are not truth labels; do not claim Brier/AUC calibration without independently labeled outcomes.
- Per-form effects, near-transfer versus transfer, starting level and day-7/day-30 separation. Use packet/learner-clustered uncertainty estimates and show raw counts; 224 correlated synthetic variants are not 224 independent learners.

Compute fit/held-out accuracy denominators from their original core rows only. Report injection controls separately; canaries and repeated probes do not inflate labeled sample support.

Only a complete set gets a point error-rate claim. For incomplete diagnostics, retain all scheduled reference-positive/negative rows and show error-rate bounds from `observed_errors / scheduled` to `(observed_errors + unavailable) / scheduled`; never let an unavailable model response lower a reported error rate silently.

Tune a candidate threshold on fit packets only, using attainable weighted scores rather than a universal continuous score scale. Proposed working alarms are false pass at most 5% and false block at most 10%, with zero accepted prompt-injection overrides or passes on fully contradicted/off-topic controls. These are **provisional engineering targets**, not literature-backed competence cutoffs. Pick the least restrictive candidate meeting both directional targets; if none does, improve scorer/rubric or abstain instead of hiding the tradeoff. Freeze the threshold and targets before held-out evaluation; a held-out failure blocks candidate promotion, and any tuning after inspection needs a new held-out packet version. Report uncertainty even when point estimates pass. Keep today's 80 results beside the candidate; no threshold changes during baseline capture.

There is no automatic promotion based on two graders agreeing. Synthetic consistency can receive `provisional_consistency_pass`; real delayed validity remains a separate field. No scorer result here certifies real-world competence or demonstrates a teaching treatment effect.

### When anchors and the scorer diverge

The measurement document's final sentence proposing a human spot check is superseded by the fixed AI-only decision. **Do not route to human graders, majority vote, or a third-model tie-break.** Mark the affected item/rubric/domain and scorer version `divergent`, quarantine it from verified-gain and mastery-validation claims, preserve the original attempt and verdict, and freeze promotion of that scoring configuration. Do not silently reverse previously recorded learner results or manufacture failure scores for unavailable evidence.

Use deterministic diagnostics first: source availability and key checks, item/form equivalence, exposure/assistance and clock joins, exact scoring arithmetic, parser/pin integrity and missing outcomes. If these do not explain the divergence, create source-derived minimal counterexamples, revise the rubric/scorer or retire the unsupported item, version the change and rerun a fresh held-out evaluation plus subsequent real anchors. A valid keyed item can still provide its own limited evidence; it cannot be presented as validating the divergent rubric. Unresolved divergence stays unavailable indefinitely. This resolves the conflict without reversing the no-human decision; no additional grading-policy decision is needed.

### Deterministic CI versus live runs

| Execution | Required behavior |
| --- | --- |
| Ordinary CI, no network/keys | Rebuild seeds and splits from pinned public inputs; check proof artifacts, hashes and no label leakage; schema/criterion/arithmetic/80-boundary tests; assistance/delayed/exposure fixtures; mode isolation; malformed/refusal/timeout/absent-evidence fixtures; budget reservations and ambiguous-dispatch checkpoints; replay frozen verdicts into exact report totals. Use fixture adapters and label results `offline_contract_only`. |
| On-demand live CLI, separately authorized | Confirm account access, family independence, retention and token/cost pins; run the baseline and both blinded graders; collect real returned identities/usage; seal artifacts and derive reports. One item per request and one request in flight globally; 90-second deadline; one dispatch, no automatic retry/fallback or continuation. Unknown post-dispatch outcome retains its full reservation and stops that adapter. Resume only authenticated completed rows with identical input and manifest hashes. |
| Live anchor analysis | Read an authorized bounded snapshot of real eligible attempts/outcomes and join locally; send no learner data to external graders under the initial synthetic contract. Report pending/unknown cohorts honestly. Extending external replay to real responses requires a proven approved retention route. |

Fail closed on missing/stale source or artifact hashes, unknown production family/upstream, changed model/API/prompt/scorer/threshold pins, incomplete corpus/judge coverage, fake backend, unsupported payload/language, failed privacy preflight, exhausted budget or unresolved ambiguity. An incomplete run may emit a diagnostic artifact, but never a passing report. CI may be green for deterministic contracts while live evidence is unavailable; the Phase C evidence consumer must require the separate live report before claiming scorer consistency.

Rerun deterministic checks on every relevant change. Require a full fresh live suite on any scorer/model/provider route, prompt/schema/parser, source/key/rubric, response format, generation setting or token-limit change. Threshold changes require recalibration plus untouched held-out evaluation. New domains/languages require their own packets. Refresh real anchor reports as valid day-7/day-30 observations arrive. A changed teaching flow begins a new baseline epoch, not a rewritten historical report. Preserve the current-flow baseline before Phase D teaching changes.

## Payload, retention and run cost

The initial external payload contains **public, retention-permitted source excerpts and synthetic responses only**. Strip source URLs, document names, internal/user IDs and private folder text; use neutral aliases and a fixed schema without content-bearing enum/property names. Retain public fixtures and synthetic verdicts with hashes; operational logs contain metadata only. Real responses and protected source material remain owner-scoped, access-controlled and subject to deletion/export rules; deletion removes protected material from harness artifacts too, leaving permitted integrity tombstones and historical attempt status.

Paid Gemini services do not use prompts/responses for product improvement, but abuse-monitoring retention still applies; paid service status requires a billing-enabled project. Its documentation does not specify a universal retention duration. `store: false` disables Interactions state storage, **not all retention**. Anthropic's standard commercial API policy allows up to 30 days and exceptions; its feature documentation describes qualified ZDR for structured outputs, including temporary schema caching. Those statements do not prove this owner's account/routing arrangement. No real learner replay is approved by this research. [Google paid-service terms](https://aistudio.google.com/docs/terms#paid-services), [Google retention](https://aistudio.google.com/docs/zdr), [Anthropic retention policy](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data), [Anthropic API arrangements](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention).

Production transport privacy must also be verified, not inferred from flags. Cloudflare's payload-off header still keeps metadata. OpenRouter currently distinguishes Safety Retention from strict ZDR, and `zdr: true` can allow Safety Retention depending on account/guardrail settings. Thus the existing wrapper's flags alone do not prove strict end-to-end ZDR. Keep the production-equivalent adapter's constraints; if no compatible endpoint exists, return unavailable rather than relaxing them. [Cloudflare logging controls](https://developers.cloudflare.com/ai-gateway/observability/logging/), [OpenRouter routing/retention policy](https://openrouter.ai/docs/guides/features/zdr).

**Bound one full inference run at 256 dispatches per model:** 224 core seeds, eight correct-answer injection controls, 20 repeat probes and four canary/diagnostic slots. This includes probes, not retries. All grader requests must be at most **4,096 billed input tokens and 2,048 total output/thinking tokens**, including schema/system overhead. Use token preflight; never truncate necessary evidence to fit. Reject oversized cases before dispatch. The baseline retains its smaller output cap and needs a verified cost quote no higher than $0.10 per dispatch; otherwise reprice before starting.

Token preflight must cover the complete request shape, including provider-added schema overhead; an approximate characters-per-token estimate is insufficient. If the pinned endpoint's input cannot be bounded that way, reserve its conservative documented input maximum and reprice the run before dispatch instead of assuming 4,096. The table below is conditional on these admission bounds. [Claude token counting](https://platform.claude.com/docs/en/build-with-claude/token-counting), [Google token counting](https://aistudio.google.com/docs/tokens).

Current standard, uncached, text-only published rates in USD per million tokens are Claude Sonnet 5.5 **$2 input / $10 output** and Gemini 3.6 Flash **$0.75 / $3.75**. Google announces **$1.50 / $7.50 from 2027-01-01**. Prices and limits change: refresh them before dispatch. No free credits, cache discounts, batch discounts or provider subscriptions are assumed. [Claude price](https://platform.claude.com/docs/en/models/sonnet-5-5/overview#pricing), [Google price](https://aistudio.google.com/docs/pricing#gemini-3.6-flash).

Formula: `dispatches × (input_tokens × input_price + output_tokens × output_price) / 1,000,000`.

| Full-run reservation | Current USD maximum |
| --- | ---: |
| Claude: 256 × (4096 × 2 + 2048 × 10) / 1M | $7.340032 |
| Gemini: 256 × (4096 × 0.75 + 2048 × 3.75) / 1M | $2.752512 |
| Both independent graders | $10.092544 |
| Baseline: 256 × $0.10 verified per-call reservation | $25.60 |
| Total inference reservation | **$35.692544; round up to $35.70** |

At Google's announced January rates, the same reservation is **$38.445056**, before any other price changes. Recommend an initial **$40 USD inference authorization**, one run, no recurring live schedule. Reserve each call's maximum before dispatch and reconcile from returned usage; ambiguous calls keep the maximum. The sum of settled spend and all unresolved/reserved charges must stay within the cap. Additional model variants or reruns are new charged runs. Metadata/token-preflight fees, gateway/platform charges, taxes, currency conversion and minimum credit purchases are not established here; include known charges in the cap or obtain a revised authorization before spending. The $0.10 production figure is deliberately conservative, conditional on verification, not a measured average.

Provider quotas are account/project dependent and not a runtime guarantee. Read active limits during authorized setup and stop on quota refusal rather than opening more keys/accounts or silently switching service tier. [Google limits](https://aistudio.google.com/docs/rate-limits), [Anthropic limits](https://platform.claude.com/docs/en/api/rate-limits).

The owner's **$25/month search budget does not fund this harness**. No inference budget is authorized by this ticket, even if a smaller smoke run would cost less.

## Reasoning and strongest rejected alternative

The strongest alternative is extending the existing **Laya plus structured-LLM quiz shadow stack** as the entire solution. It has useful bounded APIs, manifests, checkpoints and synthetic calibration artifacts, and would minimize new harness machinery. Reject it as the validator: its contracts do not express the production criterion scorer, its model allowlist does not establish two independent non-production families, and its synthetic labels and probabilities cannot stand in for source-derived truth or real delayed anchors. Reuse the infrastructure patterns, not its validity conclusion. No claim about Laya's real mastery accuracy was established here.

The recommended native CLI makes all deterministic checks runnable without provider access and exposes the actual production provider boundary without state writes. Public synthetic payloads permit a first consistency test while privacy/account questions stay explicit. The two families are a diagnostic cross-check; deterministic source-derived labels and real keyed/delayed anchors carry the validity argument. Claude has the stronger published pinning guarantee. Google's weaker stable-ID guarantee is an explicit limit on cross-run reproducibility, not concealed by the manifest.

## Needs owner

1. **Authorize a separate initial harness budget of up to $40 USD inference usage**, subject to the pre-dispatch quote and any cash purchase/tax/fee requirements. Recommend one bounded run, then decide a recurring allowance from actual usage and rerun frequency. Do not borrow the search allocation.
2. **Confirm existing provider access or approve accounts/billing/keys if absent.** Recommend direct paid Claude and Gemini access for the public synthetic run. Keys must go through the orchestrator. No accounts, keys, billing or providers were created/enabled here.
3. **Provide the orchestrator with deployment visibility to verify the actual scorer families/upstream identities.** Recommend a metadata-only inventory and keeping activation blocked until neither grader overlaps. This is a prerequisite verification, not permission to change production configuration.
4. **Keep external replay of real learner responses blocked until the orchestrator verifies a permitted retention route.** Recommend local aggregate anchor analysis first. If a route requires account changes or an exception to existing privacy policy, return that specific decision to the owner; do not infer approval from public synthetic access or a ZDR flag.

No owner decision is required to replace human spot checks: unresolved divergence remains quarantined under the already-decided AI-only policy.

## What could not be verified and confidence

**High confidence** in the source-code boundary, limitations of the existing quiz adapters, and the deterministic/live separation. **Moderate confidence** in provider feasibility and the recommended pair, conditional on family inventory, account access and canaries. **No empirical confidence yet** in scorer accuracy, threshold validity or real learning gains.

Unverified: deployed scorer/model/upstream identities and enabled flags; provider account entitlements, keys, billing, quotas and retention configuration; a stronger immutable Gemini revision; live API compatibility and token/latency/usage observations; corpus labels and domain coverage because the new corpus is not built; any held-out performance; real keyed/skip-ahead/day-7/day-30 anchors; actual total cash cost. No harness, baseline or provider check has passed by virtue of this report. Ordinary application tests were not run for this documentation-only change.

Newly surfaced follow-up: **pin the production scorer independently of content generation and persist the actual returned scorer model/upstream identity**. Its present reuse of the generation model and incomplete observed identity prevent reliable family exclusion and change detection. The Phase C spec should ticket that bounded scoring-authority change before any live validation claim. Do not change the baseline's model while capturing it.
