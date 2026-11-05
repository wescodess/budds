# Quiz grading

`QUIZ_GRADING_MODE` belongs on the **Convex deployment**. It defaults off: only the exact value `graded` enables rubric grading for newly submitted free-response and fill-in-the-blank answers. Activation is an owner decision. This change sets no environment variables and performs no deployment.

The action reuses the existing Cloudflare AI Gateway and OpenRouter credentials from Convex environment configuration. Nuxt runtime configuration and the learner's generation-model selection do not configure the grader. The fixed policy requests `xingchen-agi/xing4.0-29b-a4b:free` from Phala, caps prompt and completion prices at zero, requires ZDR and no data collection, disables provider fallbacks and payload logging, and skips the gateway cache. The route fails closed when unavailable; it never selects a paid alternative.

All three attempt-completion paths schedule pending rubric answers in batches of at most eight. Exact matches and empty answers finish deterministically. Each provider batch has a two-minute lease and a separately scheduled recovery mutation. Requests time out after 30 seconds. Timeouts, 429 responses and server failures back off for three attempts per retry cycle; `Retry-After` is capped at 15 minutes. Exhausted or malformed results become unavailable and earn no credit, remaining in the denominator. Provider failures never create an incorrect verdict. The learner can manually retry unavailable answers twice per row or self-assess them instead.

Convex validates every answer and criterion key and computes fractional points from the stored weights. Met criteria count even when another criterion is uncertain. Self-assessment replaces the credit with 1, 0.5 or 0 and retains the model's criterion results. Only the latest completed attempt can update the quiz's displayed score. Criteria, weights and verdicts stay internal; results expose points, plain feedback, the grade source and the answer ID for self-assessment.

## Rollback

Turn the Convex flag off to stop creating new rubric work. Assessments retain their mode through `rubricVersion`, so already-created rubric rows continue through completion, recovery and bounded manual retries even after the flag changes. Historical advisory rows and attempts without rubric rows are not rewritten. The existing Laya and shadow paths continue to ignore rubric rows.

Keep the additive schema fields/indexes and the grading functions deployed until existing pending rows have drained. Reverting only the dispatch/commit implementation with work in flight would remove lease recovery. Turning the flag off does not reverse already-recorded grades or self-assessments; reversing those requires a separate, reviewed data operation.

## Validation boundary

Local tests use a mocked gateway and synthetic answers. They establish request construction, key validation, score arithmetic, retry limits, leases and deletion fencing. The [T5 credentialed smoke results](quiz-grading-smoke-results.md) record the real run on 2026-11-05: the first batch returned HTTP 429, and testing stopped after one provider request. No grading completion was obtained, so schema support, ZDR behavior, returned model suffix, completion cost and semantic injection resistance remain unproven. The observed failure latency does not establish successful grading latency. This run does not support production activation.
