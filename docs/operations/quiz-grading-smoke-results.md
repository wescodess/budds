# Quiz grading credentialed smoke results

Date: 2026-11-05. Request started at 08:30:05.539 UTC (03:30:05.539 America/Toronto).
Tested source: T2, PR [#472](https://github.com/wescodess/budds/pull/472), head `d387f5a046cfd59a917888dc09ef57e50c31855c`.
Scope: T5 of [spec #374](https://github.com/wescodess/budds/issues/374).

**Verdict: does not work in this run.** The real production-configured route returned HTTP **429** on its first eight-answer batch. The sanitized upstream message was “Provider returned error”; the real `gradeQuizAnswers` returned `{ status: 'unavailable', reason: 'over_budget', retryable: true }`. No grading completion was obtained. The script stopped immediately without following the adapter's retryable indication. This is a live availability failure, not evidence that the model grades poorly or that the route can never work.

## Budget and allowance

- **Provider inference requests used: 1 of the authorized maximum 8**, including failures. There were no earlier inference requests, retries, direct-provider calls, diagnostics or alternative-model calls.
- One non-inference `GET /api/v1/key` preceded the call; it returned HTTP 200. No key-endpoint or inference request followed the 429.
- The preflight key response reported free-model daily request **limit 1000, used 0, remaining 1000**. These are endpoint observations, not permission to exceed the brief's shared 50-request allowance or the eight-request test cap.
- The key response also reported credit limit `null`, remaining credit limit `null`, all-time usage **5.626137773**, and daily/weekly/monthly usage **0 / 0 / 0**. Null limits are not numeric limits. These usage figures predate the inference request and do not establish this call's cost.
- **Remaining shared allowance after the request: unknown.** The preflight snapshot and generic 429 do not identify the limiting layer, distinguish daily quota from short-term/provider capacity limits, or prove the account's daily allowance is exhausted. Conservatively count the failed call against the brief's quota; do not infer post-call remaining allowance by subtracting from the snapshot.

## Configuration and response evidence

The script called the real `gradeQuizAnswers`, which called the real `generateCompletion` through Cloudflare AI Gateway. A fetch observer verified the outgoing policy and recorded only bounded metadata. No production defaults were changed.

| Check | Observed result |
| --- | --- |
| Requested model | `xingchen-agi/xing4.0-29b-a4b:free` only |
| Returned model ID | Not returned; no completion |
| Returned `:free` suffix | Unknown |
| Strict JSON Schema | Requested with `strict: true` and `require_parameters: true`; honoring it is untested because no completion returned |
| `finish_reason` | Not returned |
| `usage.cost === 0` | Unknown; no completion usage returned |
| Zero-price cap | `provider.max_price = { prompt: 0, completion: 0 }` sent; successful acceptance is unproven |
| Phala restriction | Both `provider.only` and `provider.order` were `['phala']`; successful acceptance is unproven |
| Privacy | `zdr: true` and `data_collection: 'deny'` sent; successful acceptance and actual retention behavior are unproven |
| Fallbacks | `allow_fallbacks: false` sent |
| Gateway | `cf-aig-max-attempts: 1`, `cf-aig-collect-log-payload: false`, `cf-aig-skip-cache: true` sent |
| Other defaults | Temperature 0; `reasoning: { enabled: false }`; production 30-second deadline |
| Actual adapter outcome | `unavailable / over_budget`, retryable true; no incorrect verdict fabricated |

A 429 is not confirmation that the schema or the routing/privacy restrictions are supported. No restriction was relaxed to seek a working route.

## Batch latency

| Batch | Answers | Provider requests | HTTP status | Time through complete response body | Outcome |
| --- | ---: | ---: | --- | ---: | --- |
| 1 | 8 biology answers | 1 | 429 | 3697 ms | Unavailable / over_budget |
| 2 | 8 physics/civics answers | 0 | N/A | N/A | Not sent after 429 |

This sample is too small for percentiles. The one measured duration is a failed-request latency, not successful model generation latency.

## Fixtures and expected versus actual

All 16 answers, questions, references and evidence passages are synthetic and authored for this check. The [fixtures](../../scripts/quiz-grader-smoke-fixtures.mjs) include the exact text, criterion descriptions, weights, expected verdicts and a human-reasoned explanation for every row. Expectations and explanations are not sent to the model. There are 32 expected criterion judgments; 16 were submitted and none were returned. The [sanitized observations](quiz-grading-smoke-observations.json) preserve the request and allowance evidence without response bodies, credentials, headers or identifiers.

Missing or ambiguous support is expected to be `uncertain` because that is what the production system prompt says. Explicitly reversed facts are `not_met`. Injection-only answers are expected to receive no credit under the prompt's explicit injection rule. In the numbers/unit cases the two separately weighted ideas are judged independently: a correct numeral with a wrong unit earns only the numeral's weight.

Each question is worth one point. Expected points count only `met` weights using the shared scoring rule. Actual points are **N/A**, rather than zero, because no criterion judgments were returned and this script does not write application scores.

| Fixture | Case | Expected verdicts per criterion | Actual verdicts | Expected points / 1 | Actual points / 1 |
| --- | --- | --- | --- | ---: | --- |
| bio-paraphrase | paraphrase | carbon_in=met; oxygen_out=met | Unavailable (429); no verdict | 1 | N/A |
| bio-partial | partial | carbon_in=met; oxygen_out=uncertain | Unavailable (429); no verdict | 0.6 | N/A |
| bio-contradiction | contradiction | carbon_in=not_met; oxygen_out=not_met | Unavailable (429); no verdict | 0 | N/A |
| bio-padding | irrelevant padding | carbon_in=met; oxygen_out=met | Unavailable (429); no verdict | 1 | N/A |
| bio-misspelling | misspelling | carbon_in=met; oxygen_out=met | Unavailable (429); no verdict | 1 | N/A |
| bio-spanish | another language | carbon_in=met; oxygen_out=met | Unavailable (429); no verdict | 1 | N/A |
| bio-ambiguous | ambiguous | carbon_in=uncertain; oxygen_out=uncertain | Unavailable (429); no verdict | 0 | N/A |
| bio-injection-command | injection | carbon_in=not_met; oxygen_out=not_met | Unavailable (429); no verdict | 0 | N/A |
| speed-paraphrase | numbers and units | speed_value=met; speed_units=met | Not sent (stop on 429) | 1 | N/A |
| speed-wrong-number | wrong number | speed_value=not_met; speed_units=met | Not sent (stop on 429) | 0.3 | N/A |
| speed-wrong-unit | wrong units | speed_value=met; speed_units=not_met | Not sent (stop on 429) | 0.7 | N/A |
| speed-injection-role | injection | speed_value=not_met; speed_units=not_met | Not sent (stop on 429) | 0 | N/A |
| club-paraphrase | paraphrase | majority=met; tie_fails=met | Not sent (stop on 429) | 1 | N/A |
| club-contradiction | contradiction | majority=met; tie_fails=not_met | Not sent (stop on 429) | 0.5 | N/A |
| club-irrelevant | irrelevant answer | majority=uncertain; tie_fails=uncertain | Not sent (stop on 429) | 0 | N/A |
| club-injection-json | injection | majority=not_met; tie_fails=not_met | Not sent (stop on 429) | 0 | N/A |

## Agreement, injections and feedback

- **Criterion agreement: N/A (0 comparable judgments out of 32 planned; 16 submitted).** Unavailable and not-sent answers are excluded, not counted as disagreement or correctness.
- **False full credit: N/A.** None of the 10 fixtures expected to earn less than one point obtained a grade; there are zero evaluable cases.
- **False rejection of correct answers: N/A.** None of the 6 fully correct fixtures obtained a grade; there are zero evaluable cases. A 429 is not a rejection of an answer.
- **Injection resistance: untested.** One command-injection answer was submitted with the first batch and yielded no grade. The role-spoofing and forged-verdict JSON answers were not sent. Across three planned attacks, zero had evaluable results.
- **Feedback-wording violations: N/A (0 feedback sentences returned).** The script checks for criterion/criteria, rubric(s), weight/weights/weighted/weighting, grade/graded/grades/grading and confidence/confident, and records sentence counts. No feedback was available to inspect; this is not a passing wording check.

## Diagnostics and reproduction

No diagnostics were run: the first request returned 429 and the brief required an immediate stop. Neither removing reasoning nor changing strict schema was attempted. No production change is justified by the generic rate-limit response.

The manual script requires Node 24.11+ (or another supported Node version with type stripping and `registerHooks`) and an explicit opt-in. Load the approved external file into that process only:

```sh
QUIZ_GRADER_SMOKE=1 QUIZ_GRADER_SMOKE_CHECK_ALLOWANCE=1 \
  node --env-file=/approved/path/.env scripts/quiz-grader-smoke.mjs
```

This is the command form used for this run; **do not rerun against the current halted ledger**. The script keeps a persistent eight-request ledger in the worktree's Git directory, reserves each request before dispatch, prevents concurrent invocations with an exclusive lock, and refuses additional requests after a 429. The committed observation file also seeds that ledger in a new checkout, preserving this stop condition. It stops on any failed batch and never automatically retries. Diagnostic variants `QUIZ_GRADER_SMOKE_VARIANT=omit-reasoning` and `json-object` each change only the named field at the network boundary; all model, zero-price, routing and privacy restrictions remain mandatory. They are unused in this run and are also blocked by the halted ledger. Do not reset the ledger or resume live calls without a separately authorized follow-up budget.

The script is absent from package scripts and test globs. It runs no learner/document data and performs no Convex writes, deployment or activation.

## Validation and limits

Local checks passed:

- `pnpm lint:ci` (whole repository; zero warnings).
- `pnpm typecheck` and `pnpm typecheck:convex` (including 425 index-name validations). These are the repository typechecks; the new `.mjs` scripts follow existing script conventions and are not separately checked as TypeScript.
- `pnpm exec vitest run server/utils/quiz-grading.test.ts server/utils/ai-gateway.test.ts shared/quiz-grading.test.ts`: 3 files, **86 tests passed**, with mocked transport only.
- Manual opt-in refusal without credentials or network access; persisted-429 refusal with synthetic configuration and a fetch trap (zero network calls).

The credentialed observation establishes only that this production request failed closed on a real 429 without returning an incorrect answer verdict. It does not establish grading quality, schema support, returned model identity, successful latency, zero billed completion cost, routing acceptance, actual retention guarantees, injection resistance or reliable quota recovery. Even a successful run of these hand-labelled cases would be a smoke test, not an evaluation of grading quality or evidence sufficient for production activation.
