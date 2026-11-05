# Free-form quiz grading for Budds

Research date: **2026-11-05**. Scope: formative study quizzes with typed, constructed responses. Platform statements below describe first-party documentation; paper results describe the authors' experiments; recommendations are a synthesis to evaluate locally. No local model comparison or provider benchmark was performed.

> **Correction, 2026-11-05:** the code findings below were inspected on `main` at `820fef8`, which is 146 commits behind the `dev` integration branch. `dev` already has `quizAnswerAssessments`, attempt-time snapshots, claim/lease handling, a provider-neutral adapter, a shadow-only structured LLM adapter, and an advisory results card (#217, #218, #283, #285). Its Laya advisory gate is closed after 27.5% reference agreement. "What the code does today" therefore understates the starting point. The implementation extends that pipeline rather than creating a parallel one.

## Main finding

For Budds, reuse the criterion-scoring pattern in [Learn V2](../../convex/learnV2Mastery.ts): a model judges the frozen rubric, and Convex validates judgments, calculates points, and stores the grade. Keep objective answers deterministic. **For hosted grading with zero model charges, the current first candidate is `xingchen-agi/xing4.0-29b-a4b:free` through OpenRouter's Phala endpoint and the existing Cloudflare gateway.** This is a model-selection recommendation based on live pricing, format support, and endpoint policy; grading accuracy and latency remain untested. See [free model selection](#hosted-model-selection-with-zero-inference-cost), [the classifier alternative](#latency-priority-pretrained-decision-models-without-budds-specific-training), and [implementation architecture](#architecture-specific-recommendation).

**Recommendation:** choose the grading method from the answer contract. Use configured matching for constrained terms and numbers; evaluate conceptual explanations against explicit, source-grounded criteria with partial credit and a review path. Existing platforms document both automated matching and human judgment, while comparative research finds substantial variation in LLM grading by question and rubric. This evidence does not establish a universally best model or confidence cutoff. [Moodle short answers](https://docs.moodle.org/en/Short-Answer_question_type), [Moodle essays](https://docs.moodle.org/en/Essay_question_type), [Bolgova et al., 2025](https://doi.org/10.1080/10872981.2025.2550751).

## What platforms actually document

### Quizlet: semantic acceptance with configurable strictness

Quizlet's first-party documentation describes a meaning-based grading option for study answers. Its [Write mode guide](https://help.quizlet.com/hc/en-us/articles/360030990531-Studying-with-Write-mode) says smart grading uses natural language processing and provides a learner override for a spelling error. Its more detailed [US grading-options guide](https://help.quizlet.com/hc/en-us/articles/360048313652-Using-grading-options-US) distinguishes relaxed semantic acceptance, moderate spelling tolerance, and strict matching, with language/subject-dependent availability.

**Lesson for Budds:** match grading strictness to the learning objective. Accept conceptual paraphrases while preserving exactness when notation or vocabulary is being tested. An explicit self-assessment/correction path is useful in a study product, but should remain separate from the original automated judgment.

These docs establish product behavior, not Quizlet's internal model, rubric format, scoring thresholds, or measured accuracy. They do not establish support for every language or arbitrary essay grading.

### Moodle: configured short-answer matches; manually graded essays

Short-answer questions accept configured words or phrases, with optional case sensitivity, a grade and feedback for each accepted answer, and `*` wildcards. Matching proceeds in order and stops at the first match. Moodle explicitly warns that a wildcard pattern intended to recognize two concepts can also accept a statement negating their relationship. This supports bounded vocabulary checks, but does not establish conceptual understanding. [Official short-answer documentation](https://docs.moodle.org/en/Short-Answer_question_type).

Core Quiz essay questions require manual marking. Authors can provide grader information such as criteria and sample solutions; graders assign scores and comments. Automated essay extensions linked from the page are separate from that documented core behavior. [Official essay documentation](https://docs.moodle.org/en/Essay_question_type).

### Canvas: text rules, numerical tolerances, and separate rubric assessment

In **New Quizzes**, fill-in-the-blank Open Entry supports Contains, Close Enough, Exact Match, Specify Correct Answers, and Regular Expression Match. Close Enough uses **Levenshtein character-edit distance**. The guide awards an equal share of question points for each correct blank, without subtracting points for incorrect blanks. [Official fill-in-the-blank guide](https://community.instructure.com/en/kb/articles/661054-how-do-i-create-a-fill-in-the-blank-question-in-new-quizzes).

Numeric questions support exact values, absolute or percentage error margins, inclusive ranges, and precision in significant digits or decimal places. Non-numeric student responses are not automatically graded. [Official numeric guide](https://community.instructure.com/en/kb/articles/661060-how-do-i-create-a-numeric-question-in-new-quizzes).

Rubrics can be attached to Classic and New Quizzes to communicate expectations and criteria. The documented free-form-comments option assigns criterion values manually. Attaching a rubric is not evidence that the text matcher applies it semantically. [Official quiz-rubric guide](https://community.instructure.com/en/kb/articles/661104-how-do-i-add-a-rubric-to-a-quiz).

### Gradescope: suggested answer groups followed by human rubric decisions

The accessible first-party help documents AI-suggested groups for supported questions in fixed-template assignments, including text and math fill-in answers. Staff review groups, remove mismatched answers, merge groups, and confirm them before applying rubric items. Ungrouped answers can be graded individually; individual overrides and regrade requests are supported. Changing a rubric item updates submissions receiving that item. This is evidence for assisted grouping and consistent rubric application, not an autonomous LLM deciding conceptual scores. Proprietary grouping internals are not inferred here. [Official help: answer groups and grading](https://www.gradescope.com/help).

**Access limitation:** that help page identifies itself as moved documentation. Its replacement guide could not be retrieved, so these claims describe the accessible first-party workflow, not an independently verified inventory of every current feature. [Help migration notice](https://www.gradescope.com/help).

### PrairieLearn: rubric-based AI judgments with human review

PrairieLearn's AI grader sends grading instructions, the question, correct answer, rubric, and student submission to a selected model. It returns rubric-item judgments and explanations. Instructors can review and override them; AI and human decisions remain visible, including item-level disagreements. The exact grading prompt is inspectable. The guide recommends clear criteria and a small trial batch before grading the whole set. [Official AI grading documentation](https://docs.prairielearn.com/aiGrading/).

Its separate custom-grading lifecycle exposes per-answer `partial_scores`, a total score between zero and one, and feedback. Parsing errors can make a response invalid rather than incorrect. [Official grading lifecycle](https://docs.prairielearn.com/question/server/).

The AI guide publishes selected cost and runtime examples, but cautions that batch throughput with concurrent submissions is faster than grading a single answer alone. Those examples are not Budds cost or latency measurements. [Benchmark caveats](https://docs.prairielearn.com/aiGrading/#benchmarks).

## What primary LLM studies establish

### Accuracy and rubrics are question dependent

**Paper finding:** Bolgova et al. (2025) compared five LLMs with three faculty graders on **804 responses to four medical short-answer questions**. Expert rubrics improved some model–question combinations and worsened others; no model consistently led. **Interpretation:** criteria must be evaluated alongside the grader. These specialist questions and model snapshots provide limited evidence for generalization. [Original study](https://doi.org/10.1080/10872981.2025.2550751), [authors' abstract](https://pubmed.ncbi.nlm.nih.gov/40849930/).

### Fairness and agreement are different questions

**Paper finding:** Rodrigues et al. (2025) studied 7,380 responses across 738 science questions, including human and model-written responses. With a generic rubric covering content completeness, style, and argument, `gpt-4-0613` assigned a mean **4.07/5**, versus **3.29/5** for humans. The authors found broadly consistent grading discrepancies across the tested gender, native-language, subject, and Bloom-level groups, despite only slight agreement with human scores. **Interpretation:** this is bounded evidence of group consistency, not proof of accurate scores or fairness across other identities, dialects, languages, or prompts. [Original fairness study](https://www.sciencedirect.com/science/article/pii/S2666920X25000682).

### Confidence requires empirical calibration and a defined target

**Paper finding:** Cong et al. (2026, **preprint**, v2) compared verbalized, token-probability, and repeated-prediction confidence using one open-weight model. Their binary SciEntsBank experiment found weaknesses in individual confidence signals and better selective grading from a calibrated hybrid incorporating response-cluster heterogeneity. Calibration used a stratified subset of the selected benchmark split. This is not validation of granular partial credit or future curricula. **Recommendation:** define whether a probability concerns student correctness or the correctness of the assigned grade; they are different events. A model's self-reported confidence is not a measured probability of grading reliability. [Original confidence study](https://arxiv.org/html/2605.00200v2).

### Student answers can attack the grader

**Paper finding:** Li et al. (2026, **preprint**, v1), *GradingAttack*, demonstrate token-level and prompt-level manipulation of short-answer graders. Token attacks assume gradient access; prompt attacks can operate using model outputs. Experiments include science responses and model-generated mathematics answers. Results establish vulnerabilities in the tested setups, not the attack prevalence or success rate of a deployed study product. The authors identify effective defenses as further work. [Original attack study](https://arxiv.org/html/2602.00979v1).

## Why exact match and embedding similarity alone are insufficient

**Evidence:** Moodle warns that strict matches miss differently phrased valid answers and that permissive wildcards can accept incorrect relationships. The original SemEval student-response task distinguishes complete correctness, incomplete correctness, contradiction, domain-relevant irrelevance, and non-domain responses. It also explains why question context matters when interpreting an answer. These are substantive distinctions beyond shared words or topic. [Moodle examples](https://docs.moodle.org/en/Short-Answer_question_type), [original task and SciEntsBank lineage](https://aclanthology.org/S13-2045.pdf).

**Inference and recommendation:** a scalar embedding similarity is not, by itself, a decision rule for whether required claims, causal direction, quantities, units, conditions, and contradictions satisfy a rubric. Related statements can differ on exactly the concept being assessed. Use similarity as a retrieval/grouping aid or evaluated baseline; do not convert an arbitrary similarity cutoff into conceptual correctness. Conversely, keep exact or tolerant matching where the question deliberately requires a particular term or numerical result. This is a design inference, not a claim that every embedding system fails every such example. [Task definitions](https://aclanthology.org/S13-2045.pdf), [Canvas numerical contracts](https://community.instructure.com/en/kb/articles/661060-how-do-i-create-a-numeric-question-in-new-quizzes).

## Limitations

Documentation can change and tenant/version settings matter. Gradescope's accessible source is explicitly legacy documentation. The papers use bounded subject matter, prompts, datasets, and model snapshots; benchmark classification, agreement with human raters, helpful feedback, and improved learning are separate claims. No local learner evaluation, comparative model run, cost measurement, privacy audit, or production validation was conducted. Source-grounded rubrics and human labels also require quality review. [Gradescope notice](https://www.gradescope.com/help), [medical study](https://doi.org/10.1080/10872981.2025.2550751), [confidence study](https://arxiv.org/html/2605.00200v2).

## Direct source list

Primary source sets for the platform and research findings; current infrastructure documentation is cited in the architecture recommendation below:

1. **MoodleDocs:** [Short-Answer question type](https://docs.moodle.org/en/Short-Answer_question_type); [Essay question type](https://docs.moodle.org/en/Essay_question_type). Official core behavior.
2. **Canvas LMS Instructor Guide:** [New Quizzes fill-in-the-blank](https://community.instructure.com/en/kb/articles/661054-how-do-i-create-a-fill-in-the-blank-question-in-new-quizzes); [Numeric questions](https://community.instructure.com/en/kb/articles/661060-how-do-i-create-a-numeric-question-in-new-quizzes); [Quiz rubrics](https://community.instructure.com/en/kb/articles/661104-how-do-i-add-a-rubric-to-a-quiz). Official documented controls.
3. **Gradescope:** [Official help](https://www.gradescope.com/help), sections “AI-Assisted Grading and Answer Groups” and “Grading submissions.” Legacy first-party source; replacement guide was inaccessible.
4. **Quizlet:** [Write mode](https://help.quizlet.com/hc/en-us/articles/360030990531-Studying-with-Write-mode); [US grading options](https://help.quizlet.com/hc/en-us/articles/360048313652-Using-grading-options-US). Official semantic acceptance and strictness controls.
5. **PrairieLearn:** [AI grading](https://docs.prairielearn.com/aiGrading/); [Question-authoring documentation source](https://github.com/PrairieLearn/PrairieLearn/blob/master/docs/question/overview.md); [server.py lifecycle](https://docs.prairielearn.com/question/server/); [Manual grading](https://docs.prairielearn.com/manualGrading/). Official authoring and grading contracts.
6. **Bolgova, Ganguly, Ikram & Mavrych (2025):** [Evaluating large language models as graders of medical short answer questions: a comparative analysis with expert human graders](https://doi.org/10.1080/10872981.2025.2550751). Published comparative study; [retrievable author abstract](https://pubmed.ncbi.nlm.nih.gov/40849930/).
7. **Rodrigues et al. (2025):** [Is GPT-4 fair? An empirical analysis in automatic short answer grading](https://www.sciencedirect.com/science/article/pii/S2666920X25000682). Published study; DOI `10.1016/j.caeai.2025.100428`.
8. **Cong et al. (2026), preprint v2:** [Confidence Estimation in Automatic Short Answer Grading with LLMs](https://arxiv.org/html/2605.00200v2). Benchmark lineage: Dzikovska et al. (2013), [SemEval-2013 Task 7](https://aclanthology.org/S13-2045.pdf), the original task paper for the SciEntsBank-based evaluation and response categories.
9. **Li et al. (2026), preprint v1:** [GradingAttack: Attacking Large Language Models Towards Short Answer Grading Ability](https://arxiv.org/html/2602.00979v1). Grading-specific adversarial experiments.

## Hosted model selection with zero inference cost

Checked on 2026-11-05 against OpenRouter's public [model catalog](https://openrouter.ai/api/v1/models), per-model endpoints, and [ZDR endpoint list](https://openrouter.ai/api/v1/endpoints/zdr). No authenticated inference was run.

### Recommended initial candidate

**`xingchen-agi/xing4.0-29b-a4b:free`, served by Phala**, is the first candidate for Budds's source-grounded short-answer grader. The live endpoint metadata reports zero input/output token prices and advertises `response_format`, `structured_outputs`, and configurable reasoning. Its free Phala endpoint is also present in OpenRouter's ZDR list with `safety_retention: false`. These are advertised service properties, not an independent privacy audit or proof of grading accuracy. [Model and provider page](https://openrouter.ai/xingchen-agi/xing4.0-29b-a4b:free), [endpoint metadata](https://openrouter.ai/api/v1/models/xingchen-agi/xing4.0-29b-a4b:free/endpoints), [ZDR list](https://openrouter.ai/api/v1/endpoints/zdr).

The author describes it as a general instruction/reasoning model with English and Chinese support and publishes general reasoning/instruction-following results. None of those results establishes performance on Budds rubrics. Treat it as a practical free candidate that can receive the question, rubric, reference answer, evidence, and learner response directly, with no custom training prerequisite. [Author's model card](https://huggingface.co/XingChen-AGI/Xing4.0-29B-A4B).

Other checked options:

| Model | Verified endpoint properties | Recommendation |
| --- | --- | --- |
| `xingchen-agi/xing4.0-29b-a4b:free` | Zero input/output pricing; explicit structured-output support; free Phala endpoint listed as ZDR without Safety Retention | First private-source grading candidate to test |
| `nvidia/nemotron-3.5-super-vl:free` | Zero input/output pricing; explicit structured-output support; reasoning can be disabled | Public/synthetic material comparison only: its free endpoint asks users not to send confidential or personal information and records usage |
| `google/gemma-4-31b-it:free` | Zero input/output pricing; current free Google AI Studio endpoint advertises `response_format` but does not explicitly list `structured_outputs` | Alternative for a separate format/policy test; strict schema compatibility is not verified |

Sources: [Xing endpoint](https://openrouter.ai/api/v1/models/xingchen-agi/xing4.0-29b-a4b:free/endpoints), [NVIDIA free-endpoint notice](https://openrouter.ai/nvidia/nemotron-3.5-super-vl:free), [Gemma endpoint](https://openrouter.ai/api/v1/models/google/gemma-4-31b-it:free/endpoints). Absence of a metadata flag is not proof that a schema request fails; no authenticated request was attempted. General benchmark rankings and active parameter counts were not converted into a grading-quality ranking.

### What free includes

OpenRouter documents 20 requests/minute and 50 requests/day for free variants without the qualifying credit purchase. Purchasing $10 in credits raises the advertised daily allowance to 1,000 requests (the higher tier begins at $9 to account for top-up fees). Failed attempts count toward the daily cap. This is shared account capacity, not a per-learner quota; extra keys/accounts do not provide a supported bypass. The model inference remains zero-priced, but buying credits is not a zero-spend setup. Confirm the account's actual allowance using its authenticated key endpoint when credentials are available. [Free-model FAQ](https://openrouter.ai/collections/free-models#frequently-asked-questions), [rate limits](https://openrouter.ai/docs/api_reference/limits).

Cloudflare AI Gateway's core analytics/caching/rate-limiting features are free; logging and other services can have separate charges. It proxies inference and does not make a paid upstream model free. Workers AI separately offers 10,000 neurons/day at no charge for eligible models; paid plans bill overages, and some frontier models require paid billing. These are bounded allowances rather than unlimited free production capacity. [Gateway pricing](https://developers.cloudflare.com/ai-gateway/reference/pricing/), [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/).

### Fit to the current gateway

The [existing transport](../../server/utils/ai-gateway.ts) already routes chat completions through Cloudflare to OpenRouter and can request strict JSON Schema with required parameter support. Add a dedicated fixed grader configuration and narrow provider options for the approved free route. Keep those options local to grading.

The current [model allowlist](../../server/utils/models.ts) contains no checked free model, and the [quiz generation route](../../server/api/quiz/generate.post.ts) replaces unrecognized model IDs with the paid `openai/gpt-4o-mini` default. Reusing that selection policy for a free grader would defeat the cost requirement. Reject unsupported grader IDs instead of using that default; preserve unrelated generation configuration.

Use a free-only model ID/allowlist, zero `provider.max_price` input/output caps, required schema support, and explicit provider/data-policy filters. For the proposed route, restrict to Phala and require ZDR; account settings must exclude Safety Retention if strict ZDR is intended. Do not configure a paid model fallback or allow paid plugins/tools. If no compliant free endpoint remains, return a pending/unavailable result. The gateway helper currently lacks these price/privacy options and reasoning controls, so these are proposed changes, not existing guarantees. [Provider routing](https://openrouter.ai/docs/guides/routing/provider-selection), [ZDR enforcement](https://openrouter.ai/docs/guides/features/zdr).

For latency and quota efficiency, send a bounded batch of submitted answers in one request, ask only for brief criterion judgments/feedback, and calculate totals in Convex. Immediate per-question feedback uses more requests than end-of-quiz grading. Compare reasoning disabled versus enabled on representative answers; do not infer accuracy or speed from the presence of a reasoning toggle. Persist the resolved model/provider and reuse completed judgments on retries. Treat 429/capacity failures as unavailable grading, not incorrect answers.

### Validation boundary

Pricing, advertised capabilities, current endpoint availability, and ZDR-list membership were checked live. This checkout has no OpenRouter/gateway credentials configured in the process and only `.env.example`, so no provider call, schema smoke test, grading comparison, or end-to-end latency measurement was performed. No dependencies or models were installed and no application configuration changed. Before rollout, verify the actual credentialed route, zero returned inference cost, schema adherence, representative rubric agreement, latency, and quota-exhaustion behavior. A zero token price does not establish correct grading or dependable availability.

## Latency priority: pretrained decision models without Budds-specific training

This section describes the alternative for minimizing generation latency or avoiding external provider calls. It remains a candidate architecture when self-hosted inference is acceptable; the zero-priced hosted-model recommendation above is the current choice for the free OpenRouter constraint. The criterion/Convex authority boundary applies to both approaches.

### Shortlist and evidence

- **Pretrained NLI: the first self-hosted baseline.** Natural language inference classifies the relationship between a premise and a hypothesis. The published English `tasksource/ModernBERT-base-nli` checkpoint exposes entailment, contradiction, and neutral judgments and is usable directly through its inference pipeline. Its output aligns with a narrow test of whether the submitted answer expresses a required rubric claim. It requires no new Budds training to run. Its general NLI benchmarks do not establish quiz-grading accuracy. [Author's model card](https://huggingface.co/tasksource/ModernBERT-base-nli).
- **GLiClass-Instruct: a second self-hosted candidate.** Released checkpoints support task prompts, label descriptions, and examples supplied during inference, without fine-tuning. The author lists NLI and rule verification among the supported tasks. These features are useful for testing question-conditioned rubric checks. The NLI example recommends one hypothesis at a time, so batch criterion pairs rather than assuming that one multi-label call will grade an entire rubric correctly. General classification results do not establish superiority to NLI or Laya for Budds. [Model card](https://huggingface.co/knowledgator/gliclass-instruct-base-v1.0), [pretrained model documentation](https://docs.knowledgator.com/docs/frameworks/gliclass/pretrained-models/).
- **Jev: the closest hosted alternative to Laya.** Its API accepts structured state and independent typed questions, returning values and distributions without generating prose. Reference answers, criteria, and the learner submission can be request inputs; customer fine-tuning is not part of the documented quick start. It retains an external HTTP call, but avoids autoregressive feedback generation. The provider recommends atomic judgments combined with application-owned weights. [Introduction](https://docs.typesafe.ai/introduction), [quick start](https://docs.typesafe.ai/introduction/quickstart), [composite scoring](https://docs.typesafe.ai/patterns/composite-scoring).
- **Laya clarification.** Released checkpoints can execute without new training. Its maintainers nevertheless report weak base-model transfer on their complex typed-decision benchmark, with stronger results coming from specialization on that benchmark. That is a reason to test a different pretrained judge, not a technical requirement to train Laya before it can execute. [Maintainer's reported limits](https://github.com/NandhaKishorM/laya#honest-limits).

These options all perform model inference. Self-hosting removes the external provider dependency; a classifier removes token-by-token text generation. Neither implies zero computation, zero network latency, or demonstrated correctness.

### Move the expensive work before the attempt

During quiz creation, prepare and validate an immutable grading pack: the question, reference answer, atomic rubric assertions, weights, accepted exact variants, source evidence, and criterion-specific feedback for met/missing/contradicted outcomes. This is ordinary authoring work, not training a model for each question.

At answer submission, apply deterministic matching where appropriate, then send the remaining answer/criterion pairs to the resident pretrained judge in one bounded batch. The application maps supported criterion judgments to credit and sums the frozen weights. Compose feedback from the prepared criterion messages; requesting newly generated explanations for every answer would reintroduce the avoided latency.

For the NLI baseline, the direction matters: **does the student's answer entail the required assertion?** Neutral means the assertion is not established by that answer; it does not mean the student explicitly contradicted it. Contradiction is a separate judgment. Whether an output is reliable enough to act on is another, independently evaluated policy.

Do not concatenate the canonical answer or supporting passage into the NLI premise as if the student had written it: that could award credit for information the reference supplied. Use sources to establish the grading assertions and keep student evidence distinct. Evaluate how question context is represented, particularly for short fragments and pronouns. Test rubric gaps, relevant contradictions, calculations, and correct but unexpected wording; uncertain cases may remain ungraded or use optional deeper review.

### Serving is part of the latency decision

The current [evaluator container](../../workers/laya-evaluator/src/index.ts) sleeps after five minutes, waits for model readiness, and admits one active evaluation at a time. These are repository facts, not measured production delays. Simply replacing Laya weights would preserve cold starts and saturation behavior. A low-latency grading service needs a resident, warmed model or a readiness lifecycle initiated before the learner submits, with concurrency and a serving budget chosen from measurements.

Keep Python/ONNX inference outside Nuxt and Convex. Reuse the provider-neutral evaluator design, adding a rubric-response contract and adapter; the current `quiz_quality` request is not sufficient. Use a dedicated service/model identity for grading so the shadow pilot retains its existing authority boundary. Preserve Convex ownership checks, version pins, idempotency, and score arithmetic. If browser inference is later evaluated, treat its results as local study feedback; server-owned grades require trusted recomputation.

**Classifier alternative:** compare an unchanged three-way NLI checkpoint with GLiClass-Instruct on representative Budds short answers if avoiding external provider calls becomes a requirement. Jev can be a hosted decision-model comparison, but it does not satisfy the zero-inference-price requirement. Local evaluation and optional threshold calibration do not mean retraining model weights. Measure warm/cold end-to-end p50/p95, whole-rubric latency, queueing, and grading errors on the intended CPU/GPU before promising instant feedback. No candidate model, weights, serving deployment, or performance benchmark was installed or run in this research.

## Architecture-specific recommendation

The recommendation below is an engineering proposal for Budds, based on source inspection at commit `820fef8cf45f9a9260a2ad23e09e6b6ae70b92aa`. It is not an implemented feature or a claim about the deployed environment.

**Use rubric-based semantic grading for conceptual free responses, deterministic rules for objective items, and Convex as the authority for grades and attempt history. Reuse Learn V2's scoring pattern, with a provider-neutral judgment adapter. For zero-priced hosted inference, test the fixed free OpenRouter route above through the existing completion gateway; self-hosted classifiers remain an alternative.**

### What the code does today

| Area | Observed behavior | Consequence |
| --- | --- | --- |
| Quiz scoring | [`scoreAnswer`](../../convex/quizzes.ts) compares multiple-choice/true-false strings directly; free response and blanks use equality after trimming, lowercasing, and collapsing whitespace. | Valid paraphrases can fail; conceptual answers get no partial credit. Global lowercasing is also unsuitable for case-sensitive notation. |
| Generation | [`quiz-prompt.ts`](../../server/utils/quiz-prompt.ts) requests one canonical short answer; [`quiz/generate`](../../server/api/quiz/generate.post.ts) stores the chosen source passage, document ID when resolvable, and filename. | Evidence is already available, but there is no grading rubric, pinned grading policy, or semantic verdict. |
| Attempt data | [`schema.ts`](../../convex/schema.ts) stores Boolean `attemptAnswers.isCorrect`; attempt scores count correct questions. | Partial, pending, and uncertain judgments cannot be represented honestly by the present contract. |
| Active quiz flow | [`Shell.vue`](../../app/components/quiz/Shell.vue) selects `ActiveView → TakingView`, using `startAttempt`, `submitAnswer`, `submitAllAnswers`, and `completeAttempt`. Results are reactive Convex queries. | The new grader must support sequential and submit-all modes, immediate/delayed feedback, refresh, and resume. |
| Other consumers | [`Taker.vue`](../../app/components/quiz/Taker.vue) still calls legacy `submitAttempt`; [`learn/QuizBlock.vue`](../../app/components/learn/QuizBlock.vue) compares answers in the browser, including offline practice. | Updating one mutation would leave inconsistent grading in other consumers. Introduce one scoring contract; migrate or explicitly retain a versioned legacy path. |
| Historical results | [`getAttemptResults`](../../convex/quizzes.ts) joins stored judgments to current editable questions. | Pin question/reference/rubric/evidence revisions so later edits do not change what a past grade means. |
| Learn V2 | [`learnV2Mastery.ts`](../../convex/learnV2Mastery.ts) already reserves scoring jobs, pins evidence/rubrics, requests criterion judgments, and records results in an internal mutation. [`scoreCriteria`](../../shared/learn-v2-mastery.ts) validates criterion keys and calculates weighted credit in code. | This is the closest local precedent. Reuse the scoring mechanics; keep quiz practice separate from Learn-specific mastery and scheduling rules. |
| AI transport | [`ai-gateway.ts`](../../server/utils/ai-gateway.ts) already supports strict JSON Schema, required provider parameters, bounded responses, and disabling provider fallbacks/retries. It reads configuration in both Nitro and Convex runtimes. | Reuse it for the hosted grader, adding grading-specific free-only price/provider/data-policy controls. Non-generative providers need an appropriate typed adapter; self-hosted inference needs a separate serving process. Live readiness and quality require verification. |
| Laya pilot | [`learning-decisions`](../../server/utils/learning-decisions/index.ts) supports only `off/shadow`; its `quiz_quality` request has no learner response, rubric, or evidence fields. Its result is discarded by quiz generation. | This is question-quality checking, not learner grading. Preserve the existing [pilot boundary](../plans/laya-cloudflare-container-pilot.md); any authoritative grading mode needs a separate contract and validation. |

### Grade by answer type

- **Multiple choice and true/false:** deterministic option matching. No model call.
- **Blanks and short factual tokens:** explicit accepted aliases and a per-question normalization policy. Preserve case, symbols, units, and signs when they carry meaning. Add numerical tolerance/unit rules only for an explicitly authored numerical grading mode.
- **Conceptual free response:** judge a small, frozen rubric against the learner response and the exact supporting passages. Accept correct paraphrases; award credit across independent criteria.
- **Essays, proofs, executable code, and subjective arguments:** outside the first release. They require their own rubrics, validators, and evaluation sets.

An exact match to an explicitly accepted, validated answer can short-circuit semantic grading. A mismatch on a conceptual answer must continue to the rubric grader. Do not add generic fuzzy-string or embedding thresholds as a grading authority.

### Author and freeze the rubric before the learner answers

Extend generation to produce a bounded rubric with stable criterion keys, clear descriptions, positive integer weights totaling 100, unique keys, an example answer, and source references. Validate the weights and source references in code; check whether the cited evidence actually supports the question, reference answer, and criteria before enabling automated grading.

The generation route currently falls back from an invalid `sourceIndex` to an unrelated positional chunk or the first chunk. Reject or repair that condition for grading-enabled questions; a stored passage is not sufficient evidence that it is the right passage.

Use the existing source passage snapshot as the starting point, adding an evidence digest and explicit revision pins. Avoid a fresh broad RAG search on every submitted answer: the marking basis must remain stable across attempts. Follow the existing evidence-deletion policy when snapshots are purged; never reconstruct deleted evidence silently.

For manually authored questions without sources, ask the author to supply/approve the rubric and reference answer, mark the basis as author supplied, and avoid presenting it as source verified. Legacy questions without rubrics can gain a reviewed rubric for future attempts; preserve existing grades.

Illustrative two-criterion question: “What does mitosis produce?”

| Criterion | Credit |
| --- | --- |
| Describes division into two daughter cells | 50% |
| States that the daughter cells are genetically identical | 50% |

“One cell divides into two daughter cells” earns 50%; an accurate paraphrase covering both criteria earns 100%. A response that asserts genetically different daughter cells fails the second criterion despite sharing most reference-answer words. This is an illustration, not a scored production example.

### Keep criterion judgment separate from score calculation

The provider should return a strict, bounded result: each expected criterion key exactly once, `met | not_met | uncertain`, brief learner-facing feedback, and evidence references where useful. It should judge relevant contradictions as well as omissions; prose style and length should not earn credit unless the rubric explicitly assesses them.

Convex validates the schema, keys, allowed evidence references, and limits; it converts determinate criteria to the existing weighted-scoring shape and calculates the score. A non-generative adapter maps its native results into this contract; learner-facing feedback can use the prepared criterion messages. For an optional generative provider, structured output controls format, not factual accuracy. OpenRouter documents schema enforcement and provider support requirements in [Structured Outputs](https://openrouter.ai/docs/guides/features/structured-outputs).

Partial credit can initially come from several binary criteria, matching Learn V2's existing `scoreCriteria` approach. Do not ask the model for an unconstrained overall percentage. If a criterion is uncertain, keep the item unresolved instead of silently treating uncertainty as failure. A bounded adjudication pass is an option to evaluate later; persistent uncertainty needs a visible review/self-assessment path.

A small feature-owned interface can live beside the current portable gateway code. Keep pure contracts and arithmetic in a shared module, provider transport in one adapter, and jobs/persistence in Convex. Extract a general scoring helper only where both quiz and Learn V2 actually need it; do not import Learn V2's mastery threshold, session transitions, or scheduling policy into quiz grading.

### Recommended execution flow

```text
Vue submits answer
  → authenticated Convex mutation saves answer and pins grading inputs
  → objective item: calculate and persist result in the mutation
  → conceptual item: reserve a job and schedule an internal action
       → action calls the fixed free model through the completion gateway
         (or a pretrained classifier adapter for a self-hosted variant)
       → internal mutation validates judgment, calculates points, commits grade
  → existing Convex subscription updates feedback and results
```

Scheduling inside a Convex mutation is transactional; scheduled actions are not automatically retried and scheduled auth context is not propagated. Derive ownership in the public mutation, pass only internal job identity to the action, and recheck ownership/deletion/state before dispatch and commit. Application job state must handle recovery. See [Convex scheduled functions](https://docs.convex.dev/scheduling/scheduled-functions).

Use a distinct quiz job table or feature-owned module following Learn V2's reservation, dispatch, and commit pattern. Do not insert quiz work into `learnJobs`, whose schema requires Learn-specific IDs. Use bounded indexed queries for jobs/answers and explicit per-quiz, response, and rubric limits. Key jobs to the answer plus its pinned grading versions, enforce a lease, reserve a bounded provider budget, and reject stale results. Duplicate submissions must return the existing answer/job, even when the caller supplies a new request ID.

Record provider dispatch before the call. Retry known non-dispatch or definitive failures within a bound; an ambiguous timeout after dispatch requires reconciliation or an explicitly budgeted replacement evaluation. Only one result may commit. Do not assume a scheduler or model request provides end-to-end exactly-once execution.

Persist accepted answers independently of provider availability. A transient provider failure is `pending/retryable`; inadequate evidence or ambiguous grading is `needs_review`. Neither means “incorrect.” Allow refresh and resume while grading continues. For delayed-feedback mode, gate answer/rubric feedback on the submission policy even if the grade has already been calculated.

### Data and UI changes required

1. **Question grading specification and revision pins.** Store the rubric/accepted answers, normalization policy, version, evidence digest, and authorship basis. Preserve an immutable bounded question snapshot or revision referenced by each attempt. Editing creates a new revision for future attempts.
2. **Answer result state.** Add an explicit grading version and `pending | graded | needs_review` states; optional points and criterion results exist only when appropriate. Widen the Boolean schema for pending rows; never use `isCorrect: false` as an ungraded placeholder. Keep the legacy Boolean readable for older rows.
3. **Attempt totals.** Introduce separate `pointsEarned/pointsPossible` and grading progress. Preserve the old correct-count meaning of `score/total` for legacy attempts; do not reinterpret historical rows. For a first release, give every question the same maximum points and award fractions within it. Calculate percentages from the versioned fields. Completed totals include every distinct persisted answer, including those already graded before submit-all; reconcile omitted/unanswered questions against the frozen question list. Pending items must not disappear from the denominator or produce a misleading final percentage.
4. **Feedback and review.** Show “Correct,” “Partially correct,” “Incorrect,” “Grading,” and “Needs review,” with criterion-specific feedback and a source link. A challenge/correction creates an explicit review record; a learner's self-assessment remains distinguishable from an automated grade. The existing flag editor corrects question content; it is not an instructor review system.
5. **All read/write paths.** Update sequential, show-all, resume, history, results, legacy submission, course practice, and any offline payload consumers. Offline conceptual answers should queue for online grading or remain explicitly self-assessed. Add new answer/job/snapshot tables to quiz/course/account deletion and data export; fence late job writes after deletion or abandonment.

### Reliability, privacy, and model choice

Choose the grader independently of the user's quiz-generation model. Use a fixed, evaluated grader configuration with strict output, bounded input/output and timeout, explicit retry policy, and recorded requested/returned model identity, prompt/rubric versions, input digest, provider response ID, usage, and duration. Low temperature reduces variation but does not prove determinism. Reuse a persisted verdict for the same answer/version, rather than paying for another judgment on reload.

Treat source passages and learner text as untrusted data, give the grader no tools, and test instruction attacks. Citation IDs and exact quote checks are useful validation but do not prove semantic correctness.

Minimize transmitted content and avoid learner names/identifiers in prompts. The current gateway helper does not set grading-specific payload-log controls. Cloudflare supports metadata-only logs with `cf-aig-collect-log-payload: false`; those headers do not control Logpush exports. OpenRouter and downstream providers have separate retention/training policies, so confirm the whole configured path before sending learner answers. See [Cloudflare logging](https://developers.cloudflare.com/ai-gateway/observability/logging/) and [OpenRouter provider logging](https://openrouter.ai/docs/guides/privacy/provider-logging).

For the zero-price requirement, test the fixed Xing free endpoint first and keep broader model selection outside the learner-controlled request. The existing completion transport can serve that path with the explicit controls described above. The available evidence does not establish a best grading model, a safe confidence cutoff, credentialed service readiness, or per-answer latency for this workload. A second-stage adjudicator remains an option to evaluate and must also satisfy the free-only policy if enabled.

### Implementation order and acceptance

1. **Contract and data foundation:** introduce versioned rubrics, question/evidence pins, pending/partial states, and additive history compatibility. Unify deterministic grading consumers.
2. **Shadow evaluation:** compare rubric judgments with independently labeled Budds answers without changing existing scores. Keep experimental judgments separate from canonical results.
3. **Formative feedback pilot:** show explainable feedback with an explicit provisional/advisory status; provide a disagreement path. Do not present the current exact-match outcome as definitive semantic truth during this stage.
4. **Versioned semantic scoring:** enable authoritative rubric points for new opted-in attempts after evaluation. A rollback disables new semantic dispatch without converting pending answers to failures or rewriting completed grades.

Start with a few hundred independently labeled answers across representative subjects and question types; this is a proposed pilot size, not evidence that it is statistically sufficient. Keep all answers from a question/source together when splitting development and held-out sets. Include paraphrases, partial answers, near-identical contradictions, irrelevant padding, spelling variants, multilingual answers where supported, numbers/units/notation, ambiguous rubrics, and injection attempts. Resolve human disagreements rather than treating a single label as ground truth.

Measure criterion agreement, score error, false rejection of correct answers, false full-credit awards, repeatability, abstention coverage, performance by subject/language, and cost and p50/p95 latency per finalized answer. Agree release tolerances before inspecting held-out results. Do not import generic paper accuracy numbers, Learn V2's mastery threshold, the existing Laya pilot's targets, or a model's self-reported confidence as a validated quiz release gate.

Implementation checks must cover exactly one committed grade under concurrent duplicate submission, refresh/resume, stale edits, missing/purged evidence, malformed model output, uncertain judgments, provider failure/quota limits, mixed deterministic/semantic submit-all, historical totals, offline recovery, and late completion after deletion/abandonment.

### Verification performed for this research

Source inspection covered quiz generation, all current quiz mutation paths, active/legacy/course quiz consumers, schema, Learn V2 mastery scoring, gateway transport, and the Laya pilot boundary. No live provider, deployment, or learner grading was exercised.

Attempted `pnpm test convex/quizzes.test.ts convex/learnV2Mastery.pure.test.ts`. It exited before tests ran with `vitest: command not found`; `node_modules` is absent. No dependencies were installed. Application code remains unchanged.
