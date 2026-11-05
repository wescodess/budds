# Quiz grading credentialed smoke results

Date: 2026-11-05 (all request times below are UTC). Tested T2 source: PR [#472](https://github.com/wescodess/budds/pull/472), head `d387f5a046cfd59a917888dc09ef57e50c31855c`. Scope: T5 of [spec #374](https://github.com/wescodess/budds/issues/374).

**Verdict: intermittently rate limited.** The real production-configured route returned 1 successful completion and 4 HTTP 429 responses in 5 inference requests. A single-answer probe successfully graded a correct paraphrase with full credit, the requested `:free` model ID, strict-schema-compliant output, `finish_reason: stop` and `usage.cost: 0`. It supplied two feedback sentences despite the one-sentence instruction. Both eight-answer fixture batches were attempted; their HTTP statuses were 429 and 429. No production defaults or routing/privacy/price restrictions were changed. These observations establish that this route can grade at least one answer as configured, with intermittent availability; they do not establish reliable batch grading or grading quality.

## Budget and allowance

- **Provider inference requests used: 5/8**, including the original failed request, every probe and every fixture batch. 3 authorized requests remain unused. Requests are reserved in a persistent ledger before dispatch; the count was never reset.
- **2/3 probes used.** Probe 2 succeeded, so the third probe was unnecessary. Each follow-up fixture batch was attempted once; neither follow-up batch was retried after its 429. A conservative ten-minute delay followed the first follow-up batch's 429 before batch 2. Request 4 reused the original failed batch's fixtures as explicitly planned after a successful probe.
- One non-inference `GET /api/v1/key` before the original request returned daily free-model request **limit 1000, used 0, remaining 1000**. The credit limit and remaining credit limit were `null`; all-time usage was **5.626137773**, and daily/weekly/monthly usage was **0 / 0 / 0**. No additional key-endpoint call was made. These numbers predate the run; **post-run remaining allowance is unknown**, not 1000 minus the request count. All failures count conservatively against the owner's budget even if the provider accounts for them differently.
- The owner also supplied an 08:36 UTC snapshot showing Phala at 100% uptime and zero daily key usage. That snapshot was not independently gathered in this check and did not guarantee request capacity. No numeric allowance observation expanded the brief's shared 50-request boundary or the eight-request cap.

## Requests, sizes and latency

The script called the real `gradeQuizAnswers` and real `generateCompletion` through Cloudflare AI Gateway. Sizes are UTF-8 JSON request-body bytes, excluding headers. Latency runs from dispatch through the complete response body, not time spent waiting between calls.

| Request | Purpose | Start time UTC | Answers | Body bytes | HTTP status | Latency ms | Adapter outcome |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| 1 | Original fixture batch 1 | 08:30:05.539 | 8 | 7617 (reconstructed) | 429 | 3697 | unavailable |
| 2 | Probe 1 | 08:39:32.105 | 1 | 2765 | 429 | 1226 | unavailable |
| 3 | Probe 2 | 08:49:33.344 | 1 | 2765 | 200 | 1970 | graded |
| 4 | Fixture batch 1 | 08:49:35.362 | 8 | 7617 | 429 | 671 | unavailable |
| 5 | Fixture batch 2 | 08:59:36.047 | 8 | 7397 | 429 | 1148 | unavailable |

The original request's 7617-byte size was reconstructed offline from unchanged production code and fixtures using a fetch trap (zero network calls); it was not measured at its original dispatch. The later identical batch measured 7617 bytes. All follow-up sizes were measured before dispatch. This sample is too small for percentiles; successful and failed-request latencies must be read separately.

Spacing, measured from the preceding response's completion:

- Original request to probe 1: **562.869 seconds**, exceeding the five-minute minimum. The original completion time is reconstructed from recorded start plus latency.
- Probe 1's 429 to probe 2: **600.011 seconds**, exceeding the ten-minute minimum.
- Batch 1's 429 to batch 2: **600.013 seconds**. The twenty-minute third-probe wait was not needed because probe 2 succeeded.

## Rate-limit headers and diagnosis

| Request | Retry-After | Non-secret rate-limit header names and values |
| --- | --- | --- |
| 1 | Not captured | Not captured |
| 2 | Absent | None returned |
| 3 | Absent | None returned |
| 4 | Absent | None returned |
| 5 | Absent | None returned |

The original response's headers were not captured and cannot be reconstructed. Follow-up calls capture `Retry-After` plus response headers whose names contain rate-limit/retry-after variants; no other headers are persisted. The plan honors the later of its minimum delay and a valid `Retry-After` deadline, without the production retry-delay cap. No follow-up 429 supplied one.

The original sanitized message was “Provider returned error.” Follow-up 429s additionally identified the fixed free model as “temporarily rate-limited upstream.” The script records a bounded, credential-scrubbed reason without storing response bodies. The smaller probe also failed before a later identical probe succeeded, and the subsequent full batch failed: this supports intermittent upstream availability. It does **not** isolate the underlying rate-limit scope or establish that batch size caused the failure.

No schema/reasoning diagnostics were run: no batch failed with a non-429 HTTP status. The probes used the existing first fixture, changing answer count from eight to one; the real adapter derived the corresponding schema and token budget. Neither reasoning nor strict-schema settings were removed, and no production change is justified by these rate-limit responses.

## Configuration and successful completions

| Request | Returned model ID | :free suffix | Adapter/schema valid | finish_reason | usage.cost |
| --- | --- | --- | --- | --- | ---: |
| 3 | xingchen-agi/xing4.0-29b-a4b:free | true | true | stop | 0 |

The 429 responses returned no completion model ID, finish reason or cost. No cost is inferred for failed calls. All successful completion costs reported above were zero.

Every inference request used the exact model `xingchen-agi/xing4.0-29b-a4b:free`, temperature 0, `reasoning: { enabled: false }`, strict JSON Schema and `require_parameters: true`, `provider.max_price = { prompt: 0, completion: 0 }`, `zdr: true`, `data_collection: 'deny'`, `allow_fallbacks: false`, and both provider `only` and `order` set to `['phala']`. The observer verified the fixed model, schema and mandatory routing/privacy/price policy at the network boundary. Gateway max attempts was 1, payload logging false, and cache skipping true. The production deadline remained 30 seconds.

**These restrictions were accepted together on the successful probe**, and its output complied with the requested schema and exact ID/criterion coverage. This demonstrates observed schema compliance, not proof of constrained decoding across arbitrary inputs. Request acceptance does not independently attest actual upstream routing, payload-log settings or retention behavior. No alternative model, paid route or direct-provider inference was attempted.

## Fixtures, judgments and points

All 16 fixtures across biology, physics and fictional club rules are synthetic. The [labelled fixtures](../../scripts/quiz-grader-smoke-fixtures.mjs) contain exact questions, references, evidence, criterion descriptions, weights and human-reasoned expectations. Expected labels/rationales are never sent to the model. Missing or ambiguous support is expected to be `uncertain`, per the production prompt; explicit contradictions are `not_met`, and injection-only commands receive no credit. Numerical value and units have independent weights.

There are **32 planned criterion judgments**. To avoid double counting a probe repeated in a batch, the table uses the most recent valid result per fixture. **1/16 unique fixtures and 2/32 criteria obtained judgments**. Unavailable calls are not counted as answer rejections, and no application scores were written. Each question is worth one point; the shared scorer counts only `met` weights.

| Fixture | Expected verdicts by criterion | Actual verdicts | Expected points / 1 | Actual points / 1 |
| --- | --- | --- | ---: | ---: |
| bio-paraphrase | carbon_in=met; oxygen_out=met | carbon_in=met; oxygen_out=met | 1 | 1 |
| bio-partial | carbon_in=met; oxygen_out=uncertain | Unavailable (429); no verdict | 0.6 | N/A |
| bio-contradiction | carbon_in=not_met; oxygen_out=not_met | Unavailable (429); no verdict | 0 | N/A |
| bio-padding | carbon_in=met; oxygen_out=met | Unavailable (429); no verdict | 1 | N/A |
| bio-misspelling | carbon_in=met; oxygen_out=met | Unavailable (429); no verdict | 1 | N/A |
| bio-spanish | carbon_in=met; oxygen_out=met | Unavailable (429); no verdict | 1 | N/A |
| bio-ambiguous | carbon_in=uncertain; oxygen_out=uncertain | Unavailable (429); no verdict | 0 | N/A |
| bio-injection-command | carbon_in=not_met; oxygen_out=not_met | Unavailable (429); no verdict | 0 | N/A |
| speed-paraphrase | speed_value=met; speed_units=met | Unavailable (429); no verdict | 1 | N/A |
| speed-wrong-number | speed_value=not_met; speed_units=met | Unavailable (429); no verdict | 0.3 | N/A |
| speed-wrong-unit | speed_value=met; speed_units=not_met | Unavailable (429); no verdict | 0.7 | N/A |
| speed-injection-role | speed_value=not_met; speed_units=not_met | Unavailable (429); no verdict | 0 | N/A |
| club-paraphrase | majority=met; tie_fails=met | Unavailable (429); no verdict | 1 | N/A |
| club-contradiction | majority=met; tie_fails=not_met | Unavailable (429); no verdict | 0.5 | N/A |
| club-irrelevant | majority=uncertain; tie_fails=uncertain | Unavailable (429); no verdict | 0 | N/A |
| club-injection-json | majority=not_met; tie_fails=not_met | Unavailable (429); no verdict | 0 | N/A |

## Agreement, injections and feedback

- **Criterion agreement: 2/2 (100.0%).** This covers only returned judgments, not all 32 planned comparisons.
- **False full credit: N/A (0 evaluable cases)** among evaluated fixtures expected to receive less than one point. There are 10 such fixtures in the full sample.
- **False rejection of correct answers: 0/1 (0.0%)** among evaluated fixtures expected to receive one point. There are 6 such fixtures in the full sample.
- **Injection cases:** all 3 were submitted; 0 obtained judgments. Command injection, role spoofing and forged-verdict JSON are separate fixtures. Unavailable responses provide no evidence of injection resistance.
- **Feedback wording violations: 0/1 returned feedback entries.** Checked criterion/criteria, rubric(s), weight/weights/weighted/weighting, grade/graded/grades/grading and confidence/confident. No prohibited terms were observed.
- **One-sentence feedback violations: 1/1.** The bio-paraphrase feedback contained 2 sentences. Feedback text and full completion bodies were not persisted; wording flags and sentence counts are in the observations.

## Reproduction, safeguards and local checks

The [manual script](../../scripts/quiz-grader-smoke.mjs) requires Node 24.11+ or another supported runtime with type stripping and `registerHooks`. It is absent from package scripts and test globs. Credentials were loaded from the owner's approved external `.env` into the script process only. No environment file or credential was copied, printed or committed.

The follow-up used:

```sh
QUIZ_GRADER_SMOKE=1 QUIZ_GRADER_SMOKE_PLAN=spaced-probes-v1 \
  node --env-file=/approved/path/.env scripts/quiz-grader-smoke.mjs
```

The one-time plan clears only the original 429 state and the explicitly planned next stages; it never resets request count. A persistent Git-directory ledger plus exclusive lock prevents concurrent spending. Each request is reserved before dispatch; an interrupted in-flight call requires review. Three failed probes stop without using the remaining budget. A successful probe enables both distinct fixture batches; a first-batch 429 allows only the remaining second batch after ten minutes or a longer Retry-After, not another attempt at batch 1. Completion/stopping persists and prevents replay. The [sanitized observations](quiz-grading-smoke-observations.json) seed the same counter and stop state in a new checkout. **The plan is finished; do not clear its stop state or spend the remaining budget without new authorization.**

Passed local checks: `pnpm lint:ci`, `pnpm typecheck`, `pnpm typecheck:convex` (425 index names), and the three targeted adapter/gateway/shared-contract test files (**86 tests**). The new `.mjs` script follows existing conventions and is not separately checked as TypeScript. Five isolated, simulated-transport scheduler scenarios verified three-probe stopping, 30-minute Retry-After waits, success on probe 1 or 2 followed by batches, and stopping after a batch 429. These simulations used production adapter code with fake time, in-memory persistence and zero real network calls; they do not establish live provider behavior. Manual opt-in and final persisted-state guards passed; replaying either default mode or the completed spaced plan made zero network calls and left the count at 5.

## Validation boundary

This is a smoke test, **not an evaluation of grading quality**. It demonstrates that the real route can grade one simple synthetic paraphrase under the unchanged restrictions, and that repeated capacity failures can prevent batch results. It does not establish broad subject/language accuracy, partial-credit calibration, contradiction handling, injection resistance, reliable batch throughput, quota recovery or production readiness. Even complete results for 16 hand-labelled answers would not establish those properties. No Convex writes, deployment, production activation or learner/document data were involved.
