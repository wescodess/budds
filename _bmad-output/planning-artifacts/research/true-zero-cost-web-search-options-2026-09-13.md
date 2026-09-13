# True zero-cost web search for Budds Learn Anything

**Research date:** 2026-09-13
**Decision scope:** a production-usable, genuinely zero-cash-spend web-research lane for Learn Anything
**Evidence rule:** factual claims below link to primary sources: official documentation, pricing, terms, policies, or source repositories.

## Executive verdict

Budds can offer **real, current, broad-web search for $0 during a deliberately capped beta**. It cannot offer unlimited, SLA-backed, permanently free general-web search.

The best current zero-spend implementation is:

1. Keep Cloudflare AI Search for folder files and Budds-controlled websites.
2. Route scholarly and reference questions to free, authoritative vertical APIs.
3. Run a controlled eligibility and terms evaluation of Cloudflare's new experimental Web Search binding. The exact Wrangler version already installed in Budds exposes this public-web discovery API, but Cloudflare has not published pricing, quota, availability, retention rights, or an SLA. It therefore cannot yet be called a $0 production dependency.
4. Until Cloudflare confirms those points, route only the remaining broad-web discovery queries directly to Tavily's no-card Free plan, with a hard Budds allowance below its recurring 1,000 credits.
5. Fetch selected original pages with a Cloudflare Worker; use Browser Rendering only when ordinary HTTP retrieval cannot render a selected page.
6. Stop broad search when any quota, credit, terms, or safety check fails. Never fall back silently to a paid search or to uncited model memory.

This is genuine web search, but **"$0" is an operating mode enforced by quotas**, not a sustainable unlimited price. Every commercial provider can change or remove its free allowance.

## What counts as web search

The distinctions matter because several products called “search” solve different problems.

| Capability | What it actually does | Examples | General-web discovery? |
|---|---|---|---|
| General web index/search | Accepts a topic query and returns ranked, current URLs from a broad web index | Parallel, Tavily, Exa, Brave | Yes |
| AI answer with search | Searches internally and returns a synthesized answer plus citations or links | Gemini with Google Search grounding | Partly; not a raw reusable result set |
| Vertical/open search | Searches one knowledge domain or dataset | Wikimedia, OpenAlex, Crossref, PubMed | No, but often better for learning |
| Managed corpus search | Indexes files/sites supplied or controlled by Budds | Cloudflare AI Search | No |
| Fetch/crawl | Downloads a known URL or follows links from a seed URL | Workers `fetch`, Browser Rendering `/crawl` | No |
| Metasearch proxy | Sends queries to other search engines and merges their results | SearXNG | No independent index |

Budds should present these honestly in the UI as **Your sources**, **Open research databases**, and **Live web search**. A fetched page is not a newly discovered result, and an AI-generated answer is not a search index.

## Cloudflare assessment

### Experimental Cloudflare Web Search binding: promising, but not launchable yet

There is a newer Cloudflare-native possibility that is easy to miss because it does not yet have a public product page. Cloudflare merged Workers SDK support on 2026-05-28 for a zero-configuration Web Search binding backed by one shared public-web corpus. The binding exposes `search()` and returns URLs plus catalog metadata; the same change added a `wrangler websearch search` command and a public REST endpoint. The pull request explicitly says public documentation would be added when the product is released. [Cloudflare Workers SDK PR #13955](https://github.com/cloudflare/workers-sdk/pull/13955)

A follow-up Workers SDK change renamed the configuration key from `web_search` to `websearch` before launch. [Cloudflare Workers SDK PR #14164](https://github.com/cloudflare/workers-sdk/pull/14164)

The Budds repository's generated Worker types already include `WebSearch.search()`, a 20-result cap, a discovery-only response, and the instruction to fetch page bodies separately; the audio worker package also declares Wrangler `^4.128.0`. This confirms client/tooling exposure, not commercial availability. [Generated binding types](../../../workers/audio-overview/worker-configuration.d.ts), [audio worker package](../../../workers/audio-overview/package.json)

No public Cloudflare pricing, free allocation, account-eligibility rules, production terms, retention rights, API stability statement, or SLA for this binding was found in this review. That absence is decisive: **Budds must not call it free, production-ready, or approved for user data.**

**Budds role now:** make this the first candidate to evaluate with Cloudflare because it could remove a third-party search key. Keep the adapter behind a default-off flag. Test only in a separate non-production Cloudflare project after the dashboard or Cloudflare confirms that the account is eligible, calls are $0, and no charge can be created. Do not make it the beta dependency yet; keep the Tavily path ready.

### Cloudflare AI Search: use it for the learning corpus, not the whole web

Cloudflare AI Search is an excellent fit for folder-scoped retrieval. On Workers Free it currently allows 20,000 queries per month, 100 instances, 100,000 files per instance, and at most 500 newly crawled pages per day. It is free during open beta; Cloudflare says it will announce pricing at least 30 days before billing begins, and Workers AI and AI Gateway use are metered separately. These are beta terms, not a permanent-free commitment. [Cloudflare AI Search limits and pricing](https://developers.cloudflare.com/ai-search/platform/limits-pricing/)

It is not a free general-web index. A website data source must be a domain onboarded to the same Cloudflare account; the other sources are R2 and uploaded files. [Cloudflare AI Search website-source requirements](https://developers.cloudflare.com/ai-search/configuration/data-source/website/)

**Budds role:** index a user's folder and any Budds-controlled public corpus, preserve source metadata, and answer folder-grounded questions. Do not describe it as “searching the web.”

### Cloudflare AI Gateway: free control plane, not free search supply

AI Gateway can proxy search-capable model providers and search-first providers. It has a native Parallel proxy at `/parallel/v1beta/search`, but Cloudflare explicitly says there is no provider-agnostic search abstraction. Search requests are billed at the upstream provider's rates; AI Gateway adds no separate web-search fee. [Cloudflare AI Gateway web search](https://developers.cloudflare.com/ai-gateway/usage/web-search/)

Core gateway features such as analytics, caching, and rate limiting are currently free; provider inference/search remains separately priced. [Cloudflare AI Gateway pricing](https://developers.cloudflare.com/ai-gateway/reference/pricing/)

AI Gateway logs can contain prompts and responses. Logging is enabled by default; Budds should send `cf-aig-collect-log: false` for external search, or at minimum disable payload collection with `cf-aig-collect-log-payload: false`. [Cloudflare AI Gateway logging controls](https://developers.cloudflare.com/ai-gateway/observability/logging/)

**Budds role:** authentication boundary, routing, observability without payloads, and a kill switch. It does not make a paid upstream search free.

### Workers: zero-cost router and bounded evidence fetcher

Workers Free currently includes 100,000 requests per day, 10 ms CPU per HTTP invocation, 50 external subrequests per invocation, and six simultaneous outgoing connections. Operations fail after the applicable free quota is exceeded. [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)

Cloudflare does not add a separate egress charge for Worker subrequests. [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)

**Budds role:** classify queries, reserve quota, call one search adapter, validate returned URLs, fetch selected public pages, and normalize evidence. Workers do not provide a web index.

### Browser Rendering: last-mile retrieval only

Browser Rendering's free allowance is currently 10 browser-minutes per day with three concurrent browsers. [Cloudflare Browser Rendering pricing](https://developers.cloudflare.com/browser-run/pricing/)

The `/crawl` endpoint starts from a known URL, follows site links, honors robots and content signals, and cannot bypass CAPTCHA. Its `render: false` crawling mode is currently free in beta but Cloudflare says it will later be billed as Workers usage. [Cloudflare Browser Rendering crawl endpoint](https://developers.cloudflare.com/browser-run/quick-actions/crawl-endpoint/)

**Budds role:** render an already selected JavaScript-dependent page. It is neither keyword discovery nor a global crawler, and its beta/free conditions make it unsuitable as the primary retrieval path.

### Workers AI: useful inference quota, no web index

Workers AI currently gives Workers Free accounts 10,000 neurons per day; further operations fail after the limit, and some models require a paid billing method. It supplies inference, embeddings, and reranking—not general-web discovery. [Cloudflare Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)

**Budds role:** optional query classification, reranking, or extraction inside the free allocation. Search-provider cost and lesson-generation cost must remain separate ledgers.

### Cloudflare conclusion

Cloudflare can provide almost the entire zero-cost **control and retrieval plane**:

```text
request -> classify -> quota reserve -> provider proxy -> URL validation
        -> ordinary fetch -> optional browser render -> evidence extraction
```

Cloudflare's established, documented products do not provide free broad-web discovery on their own. The experimental Web Search binding may change that conclusion after public launch, but its present client-code availability is not evidence of a $0 production entitlement. Until Cloudflare confirms its commercial and production conditions, a documented general-web provider is still required.

## General-web options

### Parallel Search API

Parallel currently advertises up to 5,000 requests per month from $5 in recurring monthly credits. Its Search API returns ranked URLs and compressed excerpts and costs $0.001-$0.005 per request for ten results, depending on processor. [Parallel pricing](https://parallel.ai/pricing)

Cloudflare documents a native Parallel Search proxy, so Budds can use a Parallel API key behind the existing AI Gateway control plane. [Cloudflare Parallel proxy example](https://developers.cloudflare.com/ai-gateway/usage/web-search/#parallel)

Parallel's customer terms explicitly define customer applications and end customers and allow API integration into an application offered to those end customers. The terms also require one query's output to be primarily for one end customer and restrict cross-customer caching, data resale, model training, and competitive uses. [Parallel customer terms, sections 1-2](https://parallel.ai/customer-terms)

The same terms give Parallel a license to use customer inputs/outputs to operate, develop, and improve its services and create aggregated de-identified data. Therefore Budds should send only minimized public-topic queries—not folder excerpts, private names, private filenames, notes, or user identifiers—unless a later written agreement gives stronger privacy protection. [Parallel customer terms, section 4](https://parallel.ai/customer-terms)

The recurring $5 credit requires an eligible organization to attach a payment card, and usage beyond the credit is billed at standard rates. That is not a hard zero-spend boundary. Parallel also offers a no-auth Search MCP for exploration and light use, but publishes no production entitlement or dependable quota for that anonymous lane. [Parallel monthly-credit announcement](https://parallel.ai/blog/free-tier-parallel), [Parallel Search MCP quickstart](https://docs.parallel.ai/integrations/mcp/quickstart)

**Assessment:** technically attractive and the best Cloudflare AI Gateway integration, but not the default for a guaranteed-$0 beta. Reconsider if Parallel adds a provider-enforced zero-overage mode or explicitly approves its anonymous MCP for Budds' product usage.

### Recommended documented fallback: Tavily

Tavily currently provides 1,000 free API credits per month without a credit card. Basic and fast search cost one credit; advanced search costs two. [Tavily API credits](https://docs.tavily.com/documentation/api-credits)

Its Search endpoint is a general web-search/extraction API intended for AI applications. [Tavily Search API](https://docs.tavily.com/documentation/api-reference/endpoint/search)

Tavily's privacy policy says service inputs and outputs may be used to improve or train Tavily and third-party AI models, and search queries may be shared with external search-index providers. [Tavily privacy policy](https://www.tavily.com/privacy)

**Assessment:** the strongest documented exact-$0 broad-web fallback because the Free plan recurs monthly and requires no card. Enable only for sanitized public-topic queries, keep pay-as-you-go disabled, and complete a product/legal review of the current terms before launch.

### Exa

Exa's Starter tier currently provides $20 of signup credit plus $10 of recurring monthly credit without a payment method. Base search is listed at $7 per 1,000 requests, so recurring credit is approximately 1,428 base searches per month if nothing else consumes the credit. [Exa pricing](https://exa.ai/pricing)

Exa returns HTTP 402 when credits or a configured budget are exhausted, and its team API supports a per-key budget in cents. [Exa error codes](https://exa.ai/docs/reference/error-codes), [Exa API-key budget](https://exa.ai/docs/reference/team-management/create-api-key)

Exa's published terms grant API access but contain restrictions on copying/distributing information obtained through the service and grant Exa broad rights over inputs and outputs for service improvement. [Exa Terms of Service](https://exa.ai/assets/Exa_Labs_Terms_of_Service.pdf)

**Assessment:** useful prototype candidate with good technical budget controls; do not make it a production fallback until storage, excerpt use, end-user delivery, and data-use rights are confirmed in writing.

### Firecrawl

Firecrawl's current Free plan provides 1,000 credits every month with no card. Search costs two credits for ten results, so the allowance covers up to 500 searches if it is used only for discovery. The Free plan cannot enable pay-as-you-go. [Firecrawl pricing](https://www.firecrawl.dev/pricing)

Its Search API returns titles, descriptions, and URLs and can optionally fetch full page content in the same call. [Firecrawl Search documentation](https://docs.firecrawl.dev/features/search)

**Assessment:** a legitimate second no-card candidate and potentially simpler when combined search-and-extraction is desirable. Tavily provides twice the basic discovery allowance, while Budds already has a Cloudflare retrieval plane, so keep Firecrawl disabled for the first beta and revisit if its result quality is materially better.

### Brave Search API

Brave operates an independent web index and currently prices Search at $5 per 1,000 requests while applying $5 of monthly credits to every plan—equivalent to 1,000 searches if used only for Search. [Brave Search API pricing](https://brave.com/search/api/)

Brave requires a payment card even when only free credits are used. Its billing help says prepayment can be set to $0 and service pauses once the balance reaches zero. [Brave Search API billing help](https://api-dashboard.search.brave.com/documentation/resources/help-feedback)

Current Brave plans distinguish whether search results may be stored, so storage rights cannot be assumed from the base plan. [Brave Search API pricing and plan rights](https://brave.com/search/api/)

**Assessment:** legitimate broad search, but not the cleanest “no-spend” default because it requires a card and evidence-ledger storage needs explicit rights. Consider only after product/legal review and keep prepayment at zero.

### Google Programmable Search and Bing

Google's Custom Search JSON API is closed to new customers. Existing customers receive 100 free queries per day only until the product ends on 2027-01-01. [Google Custom Search JSON API overview](https://developers.google.com/custom-search/v1/overview)

New Programmable Search Engines are restricted to site-specific search over at most 50 domains; existing whole-web engines must transition by 2027-01-01. [Google Programmable Search transition notice](https://support.google.com/programmable-search/answer/12397162?hl=en)

Microsoft retired Bing Search APIs on 2025-08-11. [Microsoft Bing Search API retirement](https://learn.microsoft.com/en-us/lifecycle/announcements/bing-search-api-retirement)

Microsoft's replacement is Grounding with Bing in Azure AI/Foundry, a paid tool rather than a permanently free general-search API. [Microsoft Bing APIs](https://www.microsoft.com/en-us/bing/apis)

**Assessment:** neither is a viable new zero-cost raw-search integration for Budds.

### Gemini with Google Search grounding

Gemini's `google_search` tool connects supported Gemini models to Google Search and returns a synthesized response with search-query metadata, source URLs/titles, and claim-to-source grounding metadata. It is an **answer-with-search** product, not a raw ranked SERP API. [Gemini Google Search grounding](https://ai.google.dev/gemini-api/docs/google-search)

Gemini 2.5 Flash and Flash-Lite currently include up to 500 grounded prompts per day on the free tier, shared across those models, with model input/output also free at that tier. [Gemini Developer API pricing](https://ai.google.dev/gemini-api/docs/pricing)

The Gemini API additional terms say unpaid-service inputs and outputs may be used to improve Google products and machine-learning technologies and may be read by human reviewers; users are told not to submit sensitive, confidential, or personal information. [Gemini API additional terms](https://ai.google.dev/gemini-api/terms)

Those terms also impose specific display and use restrictions on Grounded Results and Search Suggestions, including restrictions on caching, collecting links, and using returned links to crawl or build a search index. [Gemini API additional terms for grounding](https://ai.google.dev/gemini-api/terms)

**Assessment:** do not use it as Learn Anything's source-discovery and evidence-ingestion pipeline. It may be suitable only as a separately designed, transient answer mode for eligible users and sanitized public prompts after a full terms review.

### OpenRouter web search

OpenRouter's web plugin is not zero-cost even when the selected model is free: it charges a web-search fee, commonly $0.005 per request for Exa/Parallel-backed search, in addition to any model tokens. [OpenRouter web search pricing](https://openrouter.ai/docs/guides/features/server-tools/web-search)

**Assessment:** retain OpenRouter for model routing if useful, but call a free search provider directly for the zero-spend web lane.

## Open and vertical sources

These sources do not replace the whole web. They should be preferred when their domain matches because they are authoritative, cheaper to verify, and less noisy.

### Wikimedia

Wikimedia exposes free APIs across Wikipedia, Wikidata, and related projects. Clients must identify themselves, respect throttling and robots rules, and comply with the license attached to the returned content. [Wikimedia APIs](https://www.mediawiki.org/wiki/Wikimedia_APIs), [Wikimedia API Usage Guidelines](https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_API_Usage_Guidelines)

**Use for:** definitions, concepts, historical orientation, entity disambiguation, and references leading to original sources.

### OpenAlex

OpenAlex is a scholarly graph whose data is CC0. A free account currently receives a $1 daily API budget without a card; at the published $1 per 1,000 search calls, that is about 1,000 searches per day if the budget is used only for search. [OpenAlex pricing](https://help.openalex.org/access/pricing/), [OpenAlex example costs](https://help.openalex.org/access/example-costs/)

**Use for:** paper discovery, authors, institutions, concepts, citations, and open-access location metadata.

### Crossref

Crossref's REST API exposes public scholarly metadata without signup. Its current public and polite pools are rate limited, and most metadata is reusable; abstracts may still be copyrighted. [Crossref REST API access](https://www.crossref.org/documentation/retrieve-metadata/rest-api/access-and-authentication/), [Crossref metadata reuse](https://www.crossref.org/documentation/retrieve-metadata/rest-api/)

**Use for:** DOI lookup, publication metadata, references, corrections, and retractions—not as a general full-text source.

### PubMed / NCBI E-utilities

NCBI E-utilities allows up to three requests per second without an API key and ten per second with a free key. PubMed abstracts can remain copyrighted by publishers or authors. [NCBI E-utilities usage guidelines](https://www.ncbi.nlm.nih.gov/books/NBK25497/)

**Use for:** biomedical discovery and metadata. Fetch licensed full text separately when available.

### Common Crawl

Common Crawl provides its crawl archive and index for free over HTTP. [Common Crawl getting started](https://commoncrawl.org/get-started)

Its public index is a URL index: it answers which crawl records match a URL or URL pattern, not which pages best answer an arbitrary topic query. [Common Crawl URL index](https://commoncrawl.org/url-index)

Content in the archive remains subject to the original publisher's terms and rights. [Common Crawl terms](https://commoncrawl.org/terms-of-use)

**Assessment:** useful for known-URL recovery, historical pages, or a future funded indexing project. Building and operating a fresh full-text index, ranking system, storage layer, abuse controls, and crawl pipeline is not honestly zero-cost.

## Self-hosted SearXNG

SearXNG is legitimate AGPL-3.0 open-source software, but it is a metasearch engine: it submits a query to configured upstream search services and aggregates their results. [SearXNG repository and license](https://github.com/searxng/searxng), [SearXNG Search API](https://docs.searxng.org/dev/search_api.html)

Official deployment guidance requires separately operated application infrastructure and commonly Valkey for limiter/bot-detection support. [SearXNG container installation](https://docs.searxng.org/admin/installation-docker.html), [SearXNG limiter](https://docs.searxng.org/admin/searx.limiter.html)

SearXNG's own documentation warns that automated traffic can trigger CAPTCHA or bans from upstream engines and that operators of public instances can observe queries. [SearXNG limiter rationale](https://docs.searxng.org/admin/searx.limiter.html), [SearXNG instance privacy guidance](https://docs.searxng.org/own-instance.html)

**Assessment:** the software costs $0, but reliable hosting, proxies, maintenance, abuse handling, and upstream access do not. It has no independent index and inherits upstream terms and blocking. It is suitable for personal experimentation, not Budds' zero-cost production search path.

## Free-tier truth table

| Option | Current free status | Persistent promise? | Production fit at $0 | Primary constraint |
|---|---|---|---|---|
| Experimental Cloudflare Web Search binding | Unknown; no public pricing found | Unknown | No, pre-launch evaluation only | No public pricing, eligibility, terms, limits, or SLA |
| Cloudflare AI Search | Free open beta within limits | No; pricing forthcoming | Yes, for folder/owned corpus | Not a web index |
| Cloudflare AI Gateway | Core gateway features free | Current product pricing only | Yes, as control plane | Upstream search still billed |
| Cloudflare Workers | Recurring Free plan quotas | Current plan, subject to change | Yes, low-volume router/fetcher | CPU/subrequest/daily limits |
| Browser Rendering | 10 min/day free | Current plan; crawl mode partly beta | Last-resort fetch only | Very small browser budget |
| Parallel | Up to 5,000 requests/month from credit; card required | No permanent guarantee | No for guaranteed $0 | Overage billing and mutable terms |
| Tavily | 1,000 credits/month, no card | No permanent guarantee | Best documented broad-search beta option | Input/output and third-party data use |
| Exa | $10 recurring monthly credit | No permanent guarantee | Prototype pending terms review | Output/use rights and variable costs |
| Firecrawl | 1,000 credits/month; 500 searches; no card | No permanent guarantee | Viable second no-card option | Smaller discovery allowance and provider retention |
| Brave | $5 monthly credit; card required | No permanent guarantee | Possible, not preferred | Card and result-storage rights |
| Gemini grounding | 500 grounded prompts/day on cited free models | No permanent guarantee | No for evidence ingestion | Answer product and restrictive data/use terms |
| Wikimedia/OpenAlex/Crossref/PubMed | Open/free subject to rate policies | Policies and quotas can change | Yes, within their verticals | Not general web |
| Common Crawl | Open data access | Dataset access is open; operation is not free | No as live topic search | Requires independent index/infrastructure |
| SearXNG | Open-source code | AGPL source remains usable | No as reliable $0 production service | Hosting and upstream fragility |

No reviewed commercial provider contractually promises an unchangeable free allowance. “Permanently free” should not appear in Budds product copy.

## Recommended exact-zero-spend architecture

### Request routing

```text
Learn Anything request
        |
        +-- folder evidence ----------> Cloudflare AI Search
        |
        +-- user-supplied URL --------> safe Worker fetch
        |
        +-- reference topic ----------> Wikimedia
        |
        +-- scholarly topic ----------> OpenAlex -> Crossref -> PubMed
        |
        +-- coverage gap remains -----> provider adapter
                                              |
                                              +-> Cloudflare Web Search only if
                                              |   $0 eligibility and terms are confirmed
                                              |
                                              +-> otherwise sanitized Tavily
                                              |   Search directly from Worker
                                              |
                                              +-> validate/rank URLs
                                              +-> fetch selected originals
                                              +-> optional Browser Rendering
```

The broad provider adapters for Parallel, Exa, Firecrawl, and Brave can exist behind the same interface, but they should remain disabled until their billing, terms, and privacy posture are accepted. Do not concatenate free tiers merely to advertise a larger quota; every added provider increases privacy, reliability, attribution, and terms-monitoring work.

### Hard beta budgets

Configure the following initial server-owned limits:

| Resource | Budds hard limit | Reason |
|---|---:|---|
| Tavily basic searches | 800/month | 20% reserve below the recurring 1,000-credit Free plan |
| Tavily basic searches | 25/day | Smooths usage across a 31-day month |
| New Learn Anything Void | 2 broad searches maximum | Supports at most 400 fully searched Voids/month before lower limits apply |
| Per user | 4 broad searches/day | Limits abuse and noisy iterative regeneration |
| Search results | 8/request | Keeps validation and fetching bounded |
| Retry | 1 only for timeout/5xx | Never retry 402, 401/403, 429, invalid input, or policy failures |
| Original page fetches | 12/Void | Prevents fan-out and Worker subrequest exhaustion |
| Page bytes | 1 MiB/page, 8 MiB/Void | Prevents decompression and memory abuse |
| Browser Rendering | 8 minutes/day, one concurrent | Reserves margin below the 10-minute free allowance |

These are product guardrails, not provider entitlements. Budds must read live provider usage where available and use the lower of provider-reported remaining credit and the internal ledger.

### Zero-spend enforcement

1. Use Tavily's no-card Free plan directly from the Cloudflare Worker; do not enable pay-as-you-go.
2. Do not attach a paid fallback provider to the zero-cost route.
3. Set `SEARCH_PAID_FALLBACK=false` and `costCeilingUsd=0`; make production startup fail if either guard is absent.
4. Reserve estimated provider cost/requests transactionally before dispatch. Reconcile after response.
5. Fail closed if the quota ledger is unavailable; never “try anyway.”
6. Treat provider 402/credit-exhausted responses as terminal for that allowance period.
7. Use one account and one approved key per provider. Never rotate accounts or keys to evade free limits.
8. Set provider-side key budgets to zero or the minimum hard amount wherever supported; do not add payment details unless a provider requires them and the user explicitly accepts that exposure.
9. Disable request/response payload logging at every search gateway, provider, and application layer.
10. Add an emergency provider kill switch and a scheduled monthly review of official pricing, terms, privacy, and API behavior.
11. Use separate provider keys and Cloudflare projects for zero-cost search versus any paid AI workloads so a billing configuration cannot leak across lanes.

### Query privacy boundary

The external broad-search query may include:

- public subject names;
- public terminology;
- explicit date/language/region constraints;
- a user-approved public research question.

It must not include:

- file contents or excerpts;
- private filenames or folder names;
- names, email addresses, IDs, or account metadata;
- unpublished notes or inferred personal facts;
- secrets, credentials, URLs containing tokens, or private repository paths.

Create search queries from an abstract topic representation, run a secret/PII scanner, show the query to the user when risk is detected, and require approval before sending a flagged query.

### Evidence retrieval boundary

For each selected result:

1. Accept only `https` URLs.
2. Resolve DNS and block private, loopback, link-local, metadata-service, and reserved addresses before every request and redirect.
3. Allow at most three redirects and revalidate every destination.
4. Use an explicit MIME allowlist and byte/decompression limits.
5. Use an eight-second timeout and at most three concurrent page fetches.
6. Do not log in, submit forms, send user cookies, bypass access controls, or solve CAPTCHA.
7. Respect robots directives, publisher access controls, and content signals.
8. Store the canonical URL, title, publisher, retrieval timestamp, content hash, access status, rights note, and only the excerpts necessary to support claims.
9. Attribute each learning claim to the original page. Search snippets are discovery hints, not evidence.
10. Keep provider-returned output scoped to the requesting user and do not build a cross-user cache of provider excerpts without explicit rights.

## Failure and exhaustion UX

The product must make reduced coverage obvious without making the experience feel broken.

### Quota exhausted

> Free live-web search capacity is used up for this period. Your folder and open research databases are still available. Add a source link, continue with the available evidence, or try again after **{reset time}**. No paid search was used.

Actions:

- **Continue with available sources** — generate a narrower plan and label coverage gaps.
- **Add a source link** — validate and fetch a URL supplied by the user.
- **Search manually** — open a normal browser search using a sanitized, user-approved query; the user pastes selected URLs back into Budds.
- **Try after reset** — show the provider-independent reset time from Budds' ledger.

### Search provider unavailable

> Live web discovery is temporarily unavailable. We can still use your folder, sources you add, and the open research databases shown below.

Do not automatically switch providers unless that provider has already passed privacy/terms review and has a reserved free allowance. Do not substitute uncited model recollection while displaying “web searched.”

### Weak or conflicting evidence

Show:

- what was searched;
- which source lanes responded;
- unsupported topics;
- conflicting claims side by side;
- publication and retrieval dates;
- a **Find another source** action that consumes a visible search allowance.

## Prototype versus scalable production

### Appropriate for a zero-spend beta

- Low-volume, invitation-controlled use.
- Folder-first learning with web search used only to close material gaps.
- Four or fewer broad searches per new Void.
- Transparent exhaustion and manual-source fallback.
- No uptime promise for external discovery.
- Monthly terms/quota audit and immediate feature kill switch.

### Not supportable at guaranteed $0

- Unlimited or anonymous public usage.
- An SLA for current whole-web coverage.
- Deep recursive crawling of every returned site.
- Storing full third-party pages without a rights basis.
- Cross-user reuse of provider excerpts contrary to provider terms.
- Generating all lessons, audio, embeddings, web search, reminders, and calendar operations under one undifferentiated “free” promise.
- Operating an independent Common Crawl-scale full-text index.

At meaningful scale, Budds must choose at least one of: a paid search budget, user-supplied search API keys, a sponsored/contracted provider allocation, or a deliberately narrower product promise centered on user folders and open vertical datasets.

## Decision

Adopt the following for Learn Anything V2:

- **Experimental Cloudflare Web Search binding:** first-choice candidate behind a default-off adapter; enable only after Cloudflare confirms $0 eligibility, hard limits, retention/use rights, privacy, and availability. SLA is optional for a clearly labeled beta, but unknown billing is not.
- **Cloudflare AI Search:** folder and owned-corpus retrieval.
- **Wikimedia/OpenAlex/Crossref/PubMed:** first-choice open vertical discovery.
- **Tavily Free via Cloudflare Worker:** only approved broad-web discovery adapter for the first zero-spend beta, subject to final terms review.
- **Workers `fetch`:** primary evidence retrieval.
- **Browser Rendering:** bounded last resort for selected JavaScript-only pages.
- **Workers AI:** optional free-quota classifier/reranker, never represented as web search.
- **Parallel, Exa, Firecrawl, Brave, Gemini grounding, SearXNG:** disabled by default for the reasons above.

The feature can truthfully say **“Live web search is available within a shared free allowance.”** It should not say **“unlimited,” “permanently free,”** or imply that Cloudflare itself supplies whole-web results.

## Implementation acceptance gates

Before enabling the feature:

- Cloudflare Web Search is either documented/confirmed as zero-charge with acceptable terms, or remains disabled without issuing a live query.
- A real Tavily basic-search request succeeds from the Cloudflare Worker, and the provider account has no payment method or pay-as-you-go mode.
- Search request/response payloads are absent from Cloudflare and application logs.
- The monthly, daily, per-user, and per-Void limits fail closed in tests.
- A simulated 402 never calls another paid or unapproved provider.
- Query-redaction tests cover secrets, emails, private filenames, private URLs, and folder excerpts.
- SSRF tests cover redirects, DNS rebinding defenses, IPv4/IPv6 private ranges, metadata addresses, decompression bombs, and disallowed MIME types.
- Evidence records point to fetched original URLs rather than provider snippets.
- A claim without fetched evidence is labeled unsupported and is not converted into authoritative learning content.
- Exhaustion UI shows the reset time and all three zero-cost continuation choices.
- Official provider pricing, terms, and privacy pages are reviewed again immediately before production launch.

## Primary-source index

- [Cloudflare AI Search limits and pricing](https://developers.cloudflare.com/ai-search/platform/limits-pricing/)
- [Cloudflare Workers SDK Web Search binding PR](https://github.com/cloudflare/workers-sdk/pull/13955)
- [Cloudflare Workers SDK Web Search configuration rename](https://github.com/cloudflare/workers-sdk/pull/14164)
- [Cloudflare AI Search website sources](https://developers.cloudflare.com/ai-search/configuration/data-source/website/)
- [Cloudflare AI Gateway web search](https://developers.cloudflare.com/ai-gateway/usage/web-search/)
- [Cloudflare AI Gateway pricing](https://developers.cloudflare.com/ai-gateway/reference/pricing/)
- [Cloudflare AI Gateway logging](https://developers.cloudflare.com/ai-gateway/observability/logging/)
- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Cloudflare Browser Rendering pricing](https://developers.cloudflare.com/browser-run/pricing/)
- [Cloudflare Browser Rendering crawl endpoint](https://developers.cloudflare.com/browser-run/quick-actions/crawl-endpoint/)
- [Cloudflare Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- [Parallel pricing](https://parallel.ai/pricing)
- [Parallel customer terms](https://parallel.ai/customer-terms)
- [Parallel monthly-credit announcement](https://parallel.ai/blog/free-tier-parallel)
- [Parallel Search MCP quickstart](https://docs.parallel.ai/integrations/mcp/quickstart)
- [Tavily API credits](https://docs.tavily.com/documentation/api-credits)
- [Tavily privacy policy](https://www.tavily.com/privacy)
- [Exa pricing](https://exa.ai/pricing)
- [Exa Terms of Service](https://exa.ai/assets/Exa_Labs_Terms_of_Service.pdf)
- [Firecrawl pricing](https://www.firecrawl.dev/pricing)
- [Firecrawl Search documentation](https://docs.firecrawl.dev/features/search)
- [Brave Search API pricing](https://brave.com/search/api/)
- [Brave Search API help](https://api-dashboard.search.brave.com/documentation/resources/help-feedback)
- [Google Custom Search JSON API](https://developers.google.com/custom-search/v1/overview)
- [Microsoft Bing Search API retirement](https://learn.microsoft.com/en-us/lifecycle/announcements/bing-search-api-retirement)
- [Gemini Google Search grounding](https://ai.google.dev/gemini-api/docs/google-search)
- [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Gemini API terms](https://ai.google.dev/gemini-api/terms)
- [OpenRouter web search](https://openrouter.ai/docs/guides/features/server-tools/web-search)
- [Wikimedia API Usage Guidelines](https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_API_Usage_Guidelines)
- [OpenAlex pricing](https://help.openalex.org/access/pricing/)
- [Crossref REST API](https://www.crossref.org/documentation/retrieve-metadata/rest-api/)
- [NCBI E-utilities usage guidelines](https://www.ncbi.nlm.nih.gov/books/NBK25497/)
- [Common Crawl getting started](https://commoncrawl.org/get-started)
- [Common Crawl URL index](https://commoncrawl.org/url-index)
- [SearXNG repository](https://github.com/searxng/searxng)
- [SearXNG Search API](https://docs.searxng.org/dev/search_api.html)
