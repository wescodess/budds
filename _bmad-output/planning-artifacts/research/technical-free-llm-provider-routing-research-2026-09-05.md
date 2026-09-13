---
stepsCompleted: [1, 2, 3, 4, 5, 6]
inputDocuments: []
workflowType: 'research'
lastStep: 6
research_type: 'technical'
research_topic: 'free LLM provider and model routing for Budds generation'
research_goals: 'Select the strongest production-appropriate free-default LLM provider and model with tool calling, minimize cost, preserve user model overrides, and define safe fallback and routing policies before implementation.'
user_name: 'palmwine'
date: '2026-09-05'
web_research_enabled: true
source_verification: true
---

# Free by Default, Safe by Design: Budds LLM Provider and Model Routing Research

**Date:** 2026-09-05
**Author:** palmwine
**Research Type:** technical

---

## Research Overview

This report evaluates how Budds can make generation free by default while preserving quality, tool calling, privacy, and production safety. It combines a read-only audit of every current generation path with current primary documentation from Google, Cloudflare, Groq, OpenRouter, Mistral, Cerebras, Hugging Face, and GitHub.

The core conclusion is that provider, model, gateway, and application tool support are separate decisions. Budds should keep Cloudflare AI Gateway, pilot Groq GPT-OSS 120B as the leading free inference route, benchmark Workers AI as its privacy-safe fallback, and restrict unpaid Gemini to an explicit non-sensitive policy despite its stronger raw model proposition. The full rationale, architecture, risks, and phased validation plan follow.

---

<!-- Content will be appended sequentially through research workflow steps -->

## Executive Summary

Budds currently routes text generation through Cloudflare AI Gateway to OpenRouter, with paid GPT-4o Mini as the general default and Gemini 2.5 Flash for audio scripting. Contrary to the starting premise, OpenRouter supports tool calling. Budds does not: its local adapter is text-only and cannot send tools, receive tool calls, append tool results, or run a bounded execution loop. Most current Budds workflows do not need tools; the clearest immediate use is making `web-only` course generation perform controlled web retrieval instead of relying on model memory.

No option provides the best model, recurring free inference, private-data-safe terms, production SLA, and unlimited capacity simultaneously. Gemini 3.8 Flash is the strongest quality-first free candidate on current provider evidence and has excellent tool/structured-output support, but Google's unpaid-service terms permit product improvement and human review of submitted content. It should not silently process arbitrary user documents. Groq's production GPT-OSS 120B provides the strongest direct recurring-free proposition: tool calling, strict structured output when used separately from tools/streaming, 200K published tokens/day, and optional zero data retention. Cloudflare Workers AI offers the best existing-stack and privacy fit with 10,000 neurons/day and several tool-capable models, though the winning model must be established with Budds-specific evaluation.

**Recommendation:** keep Cloudflare AI Gateway as the control plane; introduce a server-side `auto-free` policy; pilot Groq GPT-OSS 120B as primary; select a Workers AI fallback through evaluation; keep Gemini 3.8 Flash opt-in for eligible non-sensitive content; retain OpenRouter only for explicit model choice or tertiary free capacity. Enforce a hard rule that free exhaustion queues or fails clearly and never spills into paid inference without prior authorization.

## Table of Contents

1. Technical Research Scope Confirmation
2. Technology Stack Analysis
3. Integration Patterns Analysis
4. Architectural Patterns and Design
5. Implementation Approaches and Technology Adoption
6. Research Synthesis and Decision
7. Source Verification and Limitations

## Technical Research Scope Confirmation

**Research Topic:** Free LLM provider and model routing for Budds generation
**Research Goals:** Select the strongest production-appropriate free-default LLM provider and model with tool calling, minimize cost, preserve user model overrides, and define safe fallback and routing policies before implementation.

**Technical Research Scope:**

- Architecture analysis - provider abstraction, capability-aware routing, fallbacks, and budget controls
- Implementation approaches - changes needed across Budds generation paths without implementing them yet
- Technology stack - current SDKs, providers, models, endpoints, and free-tier constraints
- Integration patterns - tool calling, structured output, streaming, model overrides, and observability
- Performance considerations - quality, latency, quota, reliability, privacy, and cost

**Research Methodology:**

- Current web data with primary-source verification
- Repository evidence for Budds-specific integration claims
- Multi-source validation for critical technical claims
- Explicit separation of provider capability, model capability, and free-tier availability
- Confidence levels and unknowns where public evidence is incomplete

**Scope Confirmed:** 2026-09-05

## Technology Stack Analysis

### Current Budds generation stack

Budds is a Nuxt 4 / TypeScript application whose server-side generation wrapper sends OpenAI-compatible Chat Completions requests through Cloudflare AI Gateway to OpenRouter. The wrapper supports plain and streaming text plus JSON object / JSON Schema output. It does not currently model tool declarations, tool choice, assistant tool calls, tool-result messages, or an execution loop. Consequently, changing the upstream provider alone will not add tool calling.

The default model is hard-coded independently in the client and server as `openai/gpt-4o-mini`. The allowlist contains several older or preview model identifiers. Audio-overview dialogue planning and claim-entailment verification bypass the default and use `google/gemini-2.5-flash` through the same OpenRouter-backed wrapper. TTS and transcription are separate systems and should not be coupled to this text-LLM routing decision.

Budds already has the most useful gateway layer for a multi-provider design: Cloudflare AI Gateway. Its current OpenAI-compatible API can reach Workers AI, Groq, Google AI Studio, Mistral, OpenRouter, and other providers while retaining centralized analytics and policy controls. Cloudflare Dynamic Routing supports conditions, request/budget limits, versioned routes, and fallbacks. This means Budds can retain Cloudflare as the gateway/control plane while replacing OpenRouter as the default inference provider.

Sources: [Cloudflare unified API](https://developers.cloudflare.com/ai-gateway/usage/chat-completion/), [Cloudflare dynamic routing](https://developers.cloudflare.com/ai-gateway/features/dynamic-routing/)

### Provider and model candidates

| Candidate | Strongest relevant free model | Tools | Structured output | Durable free capacity | Production/data caveat | Initial fit |
|---|---|---|---|---|---|---|
| Groq direct or through Cloudflare AI Gateway | `openai/gpt-oss-120b` | Yes | Strict JSON Schema; cannot combine strict output with tools or streaming | 30 RPM, 1,000 RPD, 8K TPM, 200K TPD on published free limits | Free tier has no SLA; long Budds prompts may hit 8K TPM | Leading default candidate |
| Cloudflare Workers AI | Benchmark GPT-OSS 120B, Gemma 4 26B, and GLM-4.7 Flash | Model-specific; all three advertise function calling | JSON mode/schema available, but schema conformance is not universally guaranteed | Shared 10,000 neurons/day | Paid Workers accounts bill excess unless Budds enforces a hard zero-spend guard | Best operational/privacy fit |
| Google Gemini API | `gemini-3.8-flash` | Native, parallel, compositional | Native structured outputs; tools can be combined with schema-constrained final output | Tokens are free on the free tier, but actual RPM/TPM/RPD are account-specific in AI Studio | Unpaid inputs/outputs may be used for product improvement and reviewed by humans | Quality challenger; not a silent user-content default |
| OpenRouter free routing | `openrouter/free` or explicit `:free` models | Yes when the selected endpoint supports it | Capability-filtered | 50 RPD, or 1,000 RPD after purchasing at least $10 credits | Random model selection, model churn, variable privacy, and OpenRouter calls it unsuitable for most production workloads | Tertiary/opportunistic only |
| Mistral free plan | Task-dependent Mistral model | Yes | Supported by current APIs | $10/month included credit; exact limits are account-specific | Mistral describes Free as evaluation/prototyping | Evaluation challenger only |
| Cerebras | GPT-OSS 120B | Yes | Supported | Current docs conflict between a Free tier and a one-time $5 trial | Cannot treat as recurring free until the live account proves it | Trial/benchmark only |
| Hugging Face Inference Providers | Provider-dependent | Provider/model-dependent | Provider/model-dependent | $0.10/month for free users | Negligible application capacity | Exclude |
| GitHub Models | None | N/A | N/A | Retired July 30, 2026 | API is no longer available | Exclude |

Sources: [Groq rate limits](https://console.groq.com/docs/rate-limits), [Groq models](https://console.groq.com/docs/models), [Groq structured outputs](https://console.groq.com/docs/structured-outputs), [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/), [Workers AI models](https://developers.cloudflare.com/workers-ai/models/), [Gemini 3.8 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash), [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing), [OpenRouter free router](https://openrouter.ai/docs/guides/routing/routers/free-router), [OpenRouter FAQ](https://openrouter.ai/docs/faq), [Mistral pricing](https://mistral.ai/pricing/), [Cerebras pricing](https://www.cerebras.ai/pricing), [Hugging Face pricing](https://huggingface.co/docs/inference-providers/pricing), [GitHub Models retirement](https://github.blog/changelog/2026-07-01-github-models-is-being-fully-retired-on-july-30-2026/)

### Tool-calling correction

OpenRouter supports user-defined tool/function calling and standardizes it across compatible models and providers. It also publishes model capability filters and tool-call reliability metrics. Its free router filters for requested capabilities, including tools and structured output. The real limitations are the selected model/endpoint, free-tier quotas and availability, and Budds' own wrapper. Requests should require parameter support rather than allowing a router to silently drop unsupported fields.

Sources: [OpenRouter tool calling](https://openrouter.ai/docs/guides/features/tool-calling), [OpenRouter provider routing](https://openrouter.ai/docs/guides/routing/provider-selection), [OpenRouter model capabilities](https://openrouter.ai/docs/guides/overview/models)

### Data handling and deployment implications

Cloudflare says Workers AI customer content is not used to train models or improve Cloudflare or third-party services without explicit consent. Groq does not retain inference content by default except limited reliability/abuse cases and allows all customers to enable zero-data-retention controls. Google explicitly permits product improvement and human review for unpaid Gemini API services outside its stated regional exception, making unpaid Gemini inappropriate as a silent default for arbitrary uploaded study material in Canada.

Cloudflare AI Gateway logging is a separate privacy boundary: prompt/response payload collection should be disabled for user content while metadata telemetry is retained. No free tier reviewed offers a production SLA.

Sources: [Workers AI data usage](https://developers.cloudflare.com/workers-ai/platform/data-usage/), [Groq data controls](https://console.groq.com/docs/your-data), [Gemini API terms](https://ai.google.dev/gemini-api/terms), [Cloudflare AI Gateway logging](https://developers.cloudflare.com/ai-gateway/observability/logging/)

### Technology adoption conclusion

The suitable architecture is a capability-aware model policy rather than one permanent model string. Keep Cloudflare AI Gateway as the provider-neutral control plane; evaluate Groq GPT-OSS 120B as the leading direct free provider; retain Workers AI as the privacy-safe, operationally simple fallback; and evaluate Gemini 3.8 Flash as the raw-quality challenger only under an explicit data-policy decision. OpenRouter remains useful for explicit user-selected paid models or as a low-volume free tertiary route, but its random free router should not define Budds' product quality.

## Integration Patterns Analysis

### Canonical generation contract

Budds should own a provider-neutral request/response contract and translate it at one boundary. The contract needs more than the current text-only `ChatMessage` shape:

- requested policy (`auto-free`) or explicit user-selected model
- task class (`chat`, `grounded-chat`, `structured-generation`, `verification`, `tool-agent`)
- required capabilities (`stream`, `json_schema`, `tools`, `parallel_tools`, multimodal inputs)
- messages including `assistant.tool_calls` and `tool` results
- tool definitions and `tool_choice`
- privacy class and whether an unpaid data-improvement endpoint is permitted
- zero-spend requirement, deadline, token limits, and retry budget
- normalized output plus actual provider/model, finish reason, usage, and estimated/actual cost

OpenAI-compatible Chat Completions is the smallest migration surface because Budds already speaks that shape and Groq, Workers AI, Gemini through Cloudflare, and OpenRouter expose compatible endpoints. Provider-native adapters should still be allowed where compatibility layers omit advanced capabilities; Google explicitly recommends its native API for full Gemini feature fidelity.

Sources: [Groq OpenAI compatibility](https://console.groq.com/docs/openai), [Workers AI OpenAI compatibility](https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/), [Gemini OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai), [Cloudflare unified API](https://developers.cloudflare.com/ai-gateway/usage/chat-completion/)

### Tool execution loop

Tool calling is a multi-turn protocol, not a boolean provider feature. Budds sends schemas; the model returns one or more structured tool calls; Budds validates the tool name and arguments, performs authorization, executes the function, appends tool-result messages, and asks the model to continue until a final response or a bounded step limit. The application—not the model—must remain authoritative over side effects.

The integration should enforce:

1. allowlisted tools selected by task and user permissions;
2. JSON Schema validation of every argument payload;
3. a maximum tool-step count, timeout, and output-size limit;
4. idempotency keys for mutating tools;
5. explicit confirmation for consequential actions;
6. tool-call/result audit metadata without logging confidential payloads;
7. separate support flags for parallel tool calls and strict argument validation.

Sources: [OpenRouter tool calling](https://openrouter.ai/docs/guides/features/tool-calling), [Groq local tool calling](https://console.groq.com/docs/tool-use/local-tool-calling), [Gemini function calling](https://ai.google.dev/gemini-api/docs/function-calling), [Workers AI traditional function calling](https://developers.cloudflare.com/workers-ai/features/function-calling/traditional/)

### Structured-output pattern

Budds' quiz, flashcard, course, and audio-overview flows require validated structured data, but most do not need tools in the same inference turn. Keep these as a distinct task class. Always validate provider output with the existing Zod/domain parsers even when a provider advertises strict decoding. Groq currently cannot combine strict Structured Outputs with tools or streaming, and Workers AI warns that JSON mode does not universally guarantee schema conformance. A two-pass flow—tool acquisition first, schema-constrained synthesis second—is therefore more portable than requiring every provider to combine tools and strict output.

Sources: [Groq structured outputs](https://console.groq.com/docs/structured-outputs), [Workers AI JSON mode](https://developers.cloudflare.com/workers-ai/features/json-mode/), [Gemini structured outputs](https://ai.google.dev/gemini-api/docs/structured-output)

### Routing and fallback pattern

Resolve `auto-free` server-side to a versioned route. Filter candidates by capability and privacy first, then rank by task-specific evaluation score, remaining quota, reliability, and latency. A provider error may trigger the next zero-cost candidate, but no fallback may enter a billable route unless the user or an administrator has explicitly enabled it.

Recommended initial route order, subject to evaluation:

- general/grounded chat: Groq GPT-OSS 120B -> Workers AI evaluated winner -> fail closed or queue;
- structured learning generation: Groq GPT-OSS 120B -> Workers AI evaluated winner -> fail closed or queue;
- tool-agent tasks: Groq GPT-OSS 120B -> Workers AI model proven on Budds tool evals -> fail closed;
- approved non-sensitive quality route: Gemini 3.8 Flash -> normal zero-cost route;
- explicit user model: exactly that allowlisted model, with a clearly disclosed fallback policy rather than silently substituting the default.

Cloudflare Dynamic Routing can implement versioned conditions, budget/rate nodes, and provider fallbacks, but Budds should keep a small application-side capability registry so correctness does not depend on dashboard state alone.

Sources: [Cloudflare dynamic routing](https://developers.cloudflare.com/ai-gateway/features/dynamic-routing/), [Cloudflare routing configuration](https://developers.cloudflare.com/ai-gateway/features/dynamic-routing/json-configuration/), [OpenRouter parameter enforcement](https://openrouter.ai/docs/guides/routing/provider-selection)

### Streaming and resilience

Streaming chat should preserve normalized provider/model metadata before or alongside text deltas. Tool calls need a structured event channel, not concatenation into text. On `429`, out-of-capacity, timeout, or provider `5xx`, use capped exponential backoff only when the request is safe to repeat; retain the existing ambiguity protection around potentially billable audio generation. Route-level circuit breakers should temporarily remove a quota-exhausted free provider rather than making every user wait through identical failures.

### Security and privacy

Keys remain server-side and provider credentials should be scoped independently. Every route must apply a content privacy class before provider selection. Disable AI Gateway prompt/response payload logging for user documents, retain only operational metadata, redact tool arguments/results, and record the concrete provider/model that processed each generation. Google unpaid endpoints must be excluded from confidential/personal content unless product policy and user consent explicitly permit their data terms.

Sources: [Cloudflare AI Gateway logging](https://developers.cloudflare.com/ai-gateway/observability/logging/), [Workers AI data usage](https://developers.cloudflare.com/workers-ai/platform/data-usage/), [Groq data controls](https://console.groq.com/docs/your-data), [Gemini API terms](https://ai.google.dev/gemini-api/terms)

## Architectural Patterns and Design

### Decision

Adopt a policy-based multi-provider architecture with four separate concepts:

1. **Gateway:** Cloudflare AI Gateway remains the common control plane.
2. **Inference provider:** Groq, Workers AI, Google AI Studio, or OpenRouter.
3. **Model:** A concrete provider model such as GPT-OSS 120B or Gemini 3.8 Flash.
4. **Task policy:** `auto-free`, an explicit user selection, or a deliberately authorized paid route.

This avoids coupling “the default model” to one provider and prevents a future provider outage, model retirement, or free-tier change from requiring edits across every endpoint.

### System architecture

```text
Budds endpoint
  -> Generation service
     -> task + capability + privacy classification
     -> versioned model-policy registry
     -> zero-spend and quota guard
     -> Cloudflare AI Gateway
        -> Groq / Workers AI / approved Gemini / explicit OpenRouter model
     <- normalized response + actual provider/model/usage
  -> domain validator / tool executor
  -> Convex persistence and product response
```

The generation service should expose `generate`, `stream`, and a bounded `runTools` orchestration function. Provider adapters should be stateless. Policy resolution should be deterministic and testable without making network requests.

### Design principles

- **Capability before preference:** Eliminate candidates that cannot satisfy strict JSON, tools, streaming, context, or privacy before ranking quality or speed.
- **Fail closed on cost:** `auto-free` must never select a paid endpoint. Exhaustion returns a typed `free_capacity_exhausted` result or queues eligible background work.
- **Explicit override semantics:** A user-selected model is a distinct policy; Budds must state whether failure stops, retries the same model, or offers the free default. Silent substitution is misleading.
- **Task-specific quality:** Chat fluency, evidence-grounded entailment, long-form pedagogy, JSON reliability, and tool accuracy are different scorecards.
- **Recorded provenance:** Persist the resolved provider/model and policy version, not merely the requested alias.
- **Audio separation:** Text planning, TTS rendering, and transcription remain separate capability lanes.

### Scalability and performance

Free quotas are shared scarce resources. Track per-provider rolling RPM/TPM/RPD estimates, provider response headers, daily Workers AI neurons, latency, schema failures, and tool-call failures. Use a short-lived circuit breaker after quota or capacity errors. Concurrency limits are especially important for course sections, which currently fan out three generation calls in parallel, and audio overviews, which may make multiple planning and verification calls.

For a representative mixed request, the theoretical Workers AI allowance depends heavily on model choice. The 10,000-neuron daily allocation can cover far more GLM-4.7-Flash traffic than GPT-OSS 120B or Qwen 3.8 output. Therefore routing solely by perceived intelligence can reduce free throughput by several times. Cloudflare's published per-model prices/neuron equivalents should feed forecast tests, but live usage must decide the final thresholds.

Sources: [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/), [Groq rate limits](https://console.groq.com/docs/rate-limits)

### Reliability and fallback

No candidate's free tier carries a production SLA. Use provider/model health state and bounded failover across only zero-cost candidates. Do not retry ambiguous audio/script calls unless the existing provider-attempt marker proves a definitive failure. Preserve the current audio reservation and idempotency pattern when moving its text-planning model.

Cloudflare Dynamic Routing is useful for provider failover and instant rollback, but route definitions must be version-controlled or exported and tested. Application-side policy remains authoritative for privacy, user override semantics, and cost classification.

Sources: [Cloudflare dynamic routing](https://developers.cloudflare.com/ai-gateway/features/dynamic-routing/), [Groq performance tiers](https://console.groq.com/docs/performance-tier)

### Security and data architecture

Store independent provider credentials and never expose them to the client. Tag requests with pseudonymous operational identifiers, not raw user identity. Retain aggregate usage, route policy version, provider/model, status, latency, token/neuron counts, and cost; do not persist prompt or response bodies in gateway logs. Tool execution needs a separate authorization boundary because model selection is never authorization to perform an action.

The privacy classifier should default uploaded files, retrieved chunks, and personal workspace history to `private_user_content`. That class excludes unpaid Gemini under the current terms. Public or synthetic prompts may be eligible for an explicitly approved Gemini quality route.

### Operations

Model catalog entries require an owner, source URL, last-verified date, retirement status, capabilities, free-tier rule, privacy classification, and fallback order. A scheduled or release-time validation should detect model-ID drift. Provider changes should roll out by task behind a policy version, starting with offline evaluation, then shadow/canary traffic, then a reversible default switch.

## Implementation Approaches and Technology Adoption

### Adoption strategy

Use a staged migration, not a global model-string replacement:

1. **Measure current behavior:** Capture a redacted corpus of representative Budds prompts and expected properties from chat, RAG, quiz, flashcards, courses, audio dialogue, and entailment.
2. **Build the provider-neutral boundary:** Extend the internal types and response normalization while leaving existing OpenRouter behavior as the control.
3. **Add zero-cost candidates:** Integrate Groq GPT-OSS 120B and selected Workers AI models behind capability flags.
4. **Run offline/provider evals:** Compare candidates on identical cases and record exact provider/model versions, latency, tokens/neurons, schema validity, and error modes.
5. **Canary by task:** Start with low-risk general chat, then quiz/flashcards, course generation, and finally the highly constrained audio planning/entailment workflow.
6. **Introduce tools separately:** Add the bounded tool loop first for genuine `web-only` course research; do not mix that change into every generation path.
7. **Switch the default alias:** Point `auto-free` to the best passing task routes only after capacity and privacy gates pass.

### Evaluation matrix

The first benchmark should compare:

- Groq `openai/gpt-oss-120b`
- Workers AI `@cf/openai/gpt-oss-120b`
- Workers AI `@cf/google/gemma-4-26b-a4b-it`
- Workers AI `@cf/zai-org/glm-4.7-flash`
- Gemini API `gemini-3.8-flash` on redacted/non-sensitive cases only
- current OpenRouter/GPT-4o Mini and current audio-script model as controls

Score each task on:

- grounded factual faithfulness and citation/source binding;
- pedagogical usefulness and completeness;
- strict schema success on the first attempt and after bounded repair;
- tool selection, argument validity, refusal behavior, and multi-step completion;
- streaming correctness and cancellation;
- p50/p95 latency and timeout/429/capacity rate;
- input/output tokens, Workers AI neurons, and effective generations per free day;
- safety behavior and privacy eligibility;
- exact model availability over a 7- to 14-day soak period.

A model can win one task and lose another. Do not average away a failing hard requirement: an audio dialogue candidate with excellent prose but unreliable schema or entailment must fail that route.

### Development workflow

When implementation is authorized, keep the changes reviewable:

- central model/provider registry and canonical types;
- adapters and contract tests;
- router plus zero-spend guards;
- tool executor and authorization tests;
- endpoint-by-endpoint migrations;
- UI copy for `Auto (free)` versus explicit models;
- environment validation and deploy checks;
- telemetry/dashboard and runbook;
- removal of obsolete model IDs only after migration evidence.

### Quality assurance

Testing must include deterministic unit tests for capability filtering and cost classification; contract tests with recorded provider-shaped fixtures; live smoke tests against each free account; malformed tool-call and schema cases; quota-exhaustion/fallback tests; privacy-route tests; and end-to-end assertions that the returned/persisted provider and model are the ones actually used.

The critical cost assertion is negative: no `auto-free` request may reach a non-zero-price route, including retries and Cloudflare dynamic fallbacks. If a paid Workers plan is attached, an application/gateway budget guard must stop inference before the daily free allocation can spill into billing.

### Deployment and operations

Canary one task class at a time and keep the previous route instantly reversible. Alert on free-capacity exhaustion, sudden model disappearance, schema/tool regression, provider mismatch, unclassified privacy traffic, and any positive cost on `auto-free`. Refresh account-specific quotas from the authenticated Groq, Cloudflare, and Gemini dashboards before launch because public limits can differ from the project's active limits.

### Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Free quota changes or disappears | High | High | Versioned registry, live quota checks, two free providers, fail closed |
| “Best” model changes | High | Medium | Scheduled Budds-specific evals; alias rather than hardcoded ID |
| User content reaches a training-enabled free endpoint | Medium | High | Privacy classifier; exclude unpaid Gemini by default |
| Paid spillover after free allowance | Medium | High | Separate credentials/routes, hard gateway/app budgets, billing alerts |
| Tool call causes unauthorized side effect | Medium | High | Server authorization, validation, confirmation, idempotency |
| Strict JSON/tool incompatibility | High | Medium | Capability filter and two-pass tool-then-synthesis pattern |
| Long prompts exceed Groq free TPM | High | Medium | Accurate token limits, queue/backoff, Workers AI fallback, prompt budgeting |
| Random OpenRouter free model changes quality | High | Medium | Do not use random router as primary; pin evaluated model variants |
| Model retirement breaks allowlist | High | Medium | Catalog validation and release-time live smoke test |

## Technical Research Recommendations

### Recommended decision

Use **Cloudflare AI Gateway as the permanent gateway/control plane** and pilot **Groq `openai/gpt-oss-120b` as the leading `auto-free` inference provider/model**. Use a Budds-evaluated **Workers AI model as the second zero-cost route**. Keep **Gemini 3.8 Flash as the raw-quality benchmark and opt-in route for non-sensitive content**, not the silent default under unpaid terms. Keep OpenRouter for explicit model choice and, at most, an opportunistic tertiary free route.

This is a recommendation to evaluate, not yet a production selection. The final default should be assigned only after Budds-specific quality and live-quota evidence.

### Implementation roadmap

**Phase 0 — decision gates:** Confirm product privacy policy, inspect authenticated free quotas, and approve whether queued degradation is preferable to paid fallback.

**Phase 1 — evaluation harness:** Create the task corpus, scorers, live provider probes, and cost/quota report. Run the 7- to 14-day comparison.

**Phase 2 — provider abstraction:** Add canonical messages/tools/results, capability registry, adapters, normalized telemetry, and `auto-free` resolution. Preserve existing behavior as control.

**Phase 3 — free routing:** Add Groq and Workers AI routes through Cloudflare AI Gateway, hard zero-spend enforcement, circuit breakers, and explicit provider/model provenance.

**Phase 4 — task migration:** Migrate chat/RAG, then learning artifacts, courses, and audio script/verification only when each task's acceptance threshold is met.

**Phase 5 — tools:** Add controlled web retrieval for `web-only` courses and any future agents using the authorized bounded loop.

**Phase 6 — UI and operations:** Present `Auto (free)` as the default, keep useful explicit choices, document failure/queue behavior, and activate quota/cost/privacy alerts.

### Success criteria

- At least one primary and one fallback route pass every hard capability test for each migrated task.
- `auto-free` produces $0 provider cost in live canary and forced-exhaustion tests.
- No private-user-content test reaches an unpaid training-enabled endpoint.
- Resolved provider/model provenance is visible and persisted for every generation.
- Quality meets or exceeds the current control on groundedness and domain validation; no statistically meaningful regression in first-pass schema validity.
- Quota exhaustion produces a clear retry/queue response rather than a silent paid call or undisclosed model substitution.

## Research Synthesis and Decision

### Ranked decision

| Rank | Role | Choice | Why | Blocking qualification |
|---:|---|---|---|---|
| 1 | Primary `auto-free` pilot | Groq `openai/gpt-oss-120b` | Recurring published free limits, production-labelled model, tools, strict JSON, strong data controls, OpenAI compatibility | Live account quota and Budds eval must pass; 8K TPM may constrain long prompts |
| 2 | Zero-cost fallback pilot | Cloudflare Workers AI | Existing credentials/infrastructure, 10K neurons/day, strong no-training policy, tool-capable models | Benchmark GPT-OSS 120B, Gemma 4 26B, and GLM-4.7 Flash; hard-cap paid accounts |
| 3 | Quality benchmark / opt-in | Gemini `gemini-3.8-flash` | GA, 1M context, excellent tools and structured output, free tokens | Unpaid data terms and unknown account-specific quota prevent silent use for private content |
| 4 | Explicit selection / tertiary | OpenRouter | Broad catalog, tool support, capability filtering, existing integration | Free router is random, 50 RPD without purchased credits, and not positioned for production |

Mistral's $10/month free allowance is worth including in the benchmark if account setup is acceptable, but the vendor describes the tier as evaluation/prototyping. Cerebras should be treated as a trial because its current official pages conflict between a “Free” tier and $5 one-time trial credits. Hugging Face's $0.10/month is negligible. GitHub Models has retired.

### Answer to the original premise

- **Should Budds leave OpenRouter because it cannot call tools?** No. That premise is incorrect. OpenRouter supports tools; Budds' adapter does not.
- **Should OpenRouter remain the free default?** Also no. Its random free router and low quota are not a stable product-quality policy.
- **What should become the default?** A task-aware `auto-free` route, initially piloting Groq GPT-OSS 120B with a Workers AI fallback.
- **What is the “best free model”?** Gemini 3.8 Flash is the raw-quality candidate; GPT-OSS 120B on Groq is the better default candidate once privacy, recurring quota, and production shape are included. The final answer must come from the Budds eval, not vendor marketing.
- **Does this change TTS?** No. Gemini TTS and Workers AI transcription remain separate audio-provider decisions.

### Required decision gates before implementation

1. Approve the privacy rule that unpaid Gemini cannot receive private user content by default.
2. Confirm authenticated Groq, Cloudflare, and Gemini quotas; public documentation is not proof of this project's active entitlement.
3. Approve fail/queue behavior at free exhaustion and keep paid spillover disabled.
4. Run the benchmark and choose task-specific winners.
5. Only then implement the provider abstraction, routing policy, and tool loop.

## Source Verification and Limitations

Research was performed on 2026-09-05 using the live repository and primary provider documentation. Provider and model claims were not normalized into a fictional universal benchmark; vendor descriptions are treated as candidate evidence and the report requires Budds-specific evaluation for the final quality decision.

**High-confidence findings:** Budds' current adapter lacks tool support; OpenRouter supports tool calling; Groq's published free GPT-OSS limits; Workers AI's 10,000-neuron allocation and data policy; Gemini 3.8 Flash's capabilities and unpaid data terms; GitHub Models retirement.

**Unresolved until authenticated or empirical validation:** active quota for each Budds-owned provider account, sustained free-tier capacity, comparative Budds generation quality, real tool-call and schema reliability, model-license acceptability, and the product/legal decision governing unpaid-provider data use.

Primary references: [OpenRouter tool calling](https://openrouter.ai/docs/guides/features/tool-calling), [OpenRouter free limits](https://openrouter.ai/docs/faq), [Groq rate limits](https://console.groq.com/docs/rate-limits), [Groq data controls](https://console.groq.com/docs/your-data), [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/), [Workers AI data usage](https://developers.cloudflare.com/workers-ai/platform/data-usage/), [Gemini 3.8 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash), [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing), [Gemini terms](https://ai.google.dev/gemini-api/terms), [Cloudflare dynamic routing](https://developers.cloudflare.com/ai-gateway/features/dynamic-routing/), [GitHub Models retirement](https://github.blog/changelog/2026-07-01-github-models-is-being-fully-retired-on-july-30-2026/)

---

**Technical Research Completion Date:** 2026-09-05

**Confidence:** High on architecture and documented capability/cost/privacy facts; medium on the final model winner pending Budds-specific evaluation and authenticated quota checks.
