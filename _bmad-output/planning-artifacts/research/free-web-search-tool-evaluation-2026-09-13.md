# Hound web-search evaluation for Learn Anything

**Date:** 2026-09-13
**Decision:** Reject Hound as a production search backend. Evaluate it only as a local benchmark and selectively adapt its result-envelope ideas.

## Executive conclusion

Hound is an impressive personal-agent research tool, but it is not a sound backend for Budds Learn Anything.

The decisive issues are:

1. **Hound is abandoned.** The current repository explicitly says it is no longer maintained and directs users to DonSeTch. The Reddit post links an older repository, while the current PyPI package points to a different fork. This provenance split makes pinning, support, and security ownership unclear.
2. **The “free search” is unlicensed HTML scraping of consumer search engines.** Hound itself calls the posture “gray-area” and makes no search-engine terms-of-service compliance claim. It uses browser impersonation, anti-bot behavior, proxy rotation, and challenge bypass. That is unsuitable as a customer-facing product dependency.
3. **It is not a Cloudflare Worker library.** Hound needs Python 3.11+, native packages, SQLite, and—at full capability—Chromium/Playwright and ONNX. It requires a container or VM, adding a new paid, stateful service beside the current Nuxt/Cloudflare/AI Gateway/OpenRouter path.
4. **Its network service is not production-safe by default.** The HTTP MCP endpoint has no authentication, the supplied Compose file maps it to `0.0.0.0`, and the source code acknowledges that its SSRF DNS check cannot eliminate DNS-rebinding risk.
5. **Its output is discovery metadata, not learning-grade evidence.** It returns useful URLs, snippets, engine consensus, and extracted page metadata, but it does not establish publishing rights, evidence completeness, or statement-level citation support.

The right Budds move is to retain the planned provider-neutral, free-first search router. We should borrow Hound's good ideas—multi-source consensus, typed failure reasons, focused extraction, source-type hints, and fetch-quality fields—while retrieving through authorized APIs and a separately secured fetcher.

## Verified facts

### Project identity, provenance, and maintenance

- The [Reddit post](https://www.reddit.com/r/PiCodingAgent/comments/1v1bvrg/i_built_a_completely_free_tool_that_gives_your_ai/) links `dondai1234/master-fetch` and presents Hound as an MCP server offering keyless search, fetch, crawl, screenshot, OCR, and local reranking.
- That original repository's latest release is `v12.4.1`, published 2026-07-24. PyPI now lists `hound-mcp` `13.2.0`, uploaded 2026-08-26, and points to `dondai44423/master-fetch`, not the repository linked from Reddit. See the [PyPI project](https://pypi.org/project/hound-mcp/) and [PyPI JSON metadata](https://pypi.org/pypi/hound-mcp/json).
- The current fork's README states that Hound is abandoned and will receive no further updates; it recommends DonSeTch instead. [Hound README at the audited commit](https://github.com/dondai44423/master-fetch/blob/4f94d88a04595688d862c53940fa5c1be4ab49b8/README.md#L1-L17)
- Hound is marked beta and requires Python 3.11 or newer. Its core dependencies include MCP, Pydantic, Trafilatura, SQLite support, `primp`, HTTPX, lxml, and Markdownify. Browser/PDF/OCR/reranking add Playwright, Patchright, PDFium, RapidOCR, ONNX Runtime, and tokenizers. [Package manifest](https://github.com/dondai44423/master-fetch/blob/4f94d88a04595688d862c53940fa5c1be4ab49b8/pyproject.toml)
- Hound's own code is MIT-licensed, including an attribution notice for vendored MIT-licensed `ddgs` metasearch code. [Hound license](https://github.com/dondai44423/master-fetch/blob/4f94d88a04595688d862c53940fa5c1be4ab49b8/LICENSE), [ddgs notice](https://github.com/dondai44423/master-fetch/blob/4f94d88a04595688d862c53940fa5c1be4ab49b8/NOTICE.ddgs.txt)
- The successor, DonSeTch, is a separate Rust project under AGPL-3.0. It should receive its own technical, legal, and operational evaluation rather than being treated as a drop-in approval for Hound. [DonSeTch repository](https://github.com/dondai44423/donsetch)

### Search and retrieval behavior

- Keyless search scrapes DuckDuckGo, Brave, Mojeek, Yahoo, Yandex, Startpage, Google, and Qwant in parallel; Wikipedia and Grokipedia are optional. It merges duplicate URLs and ranks using engine consensus, heuristics, and an optional local ONNX cross-encoder. [Search documentation](https://github.com/dondai44423/master-fetch/blob/4f94d88a04595688d862c53940fa5c1be4ab49b8/README.md#L179-L217)
- Search returns URLs and snippets rather than fetched page content. Its structured result includes backend names, relative relevance, consensus, source type, blocked engines, and reranking mode. [Search response models](https://github.com/dondai44423/master-fetch/blob/4f94d88a04595688d862c53940fa5c1be4ab49b8/src/master_fetch/search.py#L455-L480)
- Fetch can return extracted Markdown, page metadata, freshness and page-type hints, outgoing-link classifications, and PDF extraction quality. These are useful routing signals, but the `is_official` and source-type values are URL/domain heuristics rather than verified authorship or authority. [Fetch response contract](https://github.com/dondai44423/master-fetch/blob/4f94d88a04595688d862c53940fa5c1be4ab49b8/src/master_fetch/server.py#L181-L258), [authority classifier](https://github.com/dondai44423/master-fetch/blob/4f94d88a04595688d862c53940fa5c1be4ab49b8/src/master_fetch/envelope.py#L35-L96)
- Hound has no published service quota or SLA because it does not operate a search service. Actual capacity depends on upstream engines, the deployment IP, CAPTCHA/rate-limit behavior, local compute, and any proxies. The README warns that sustained keyless use is rate-limited and recommends rotating proxies for heavier use. [Search limits and proxy behavior](https://github.com/dondai44423/master-fetch/blob/4f94d88a04595688d862c53940fa5c1be4ab49b8/README.md#L197-L225)

### Terms, robots, and content rights

- Hound explicitly states that keyless search has the same “gray-area posture” as SearXNG/ddgs and claims no search-engine terms-of-service compliance. [Hound's disclaimer](https://github.com/dondai44423/master-fetch/blob/4f94d88a04595688d862c53940fa5c1be4ab49b8/README.md#L197-L213)
- Google's current terms prohibit bypassing protective measures and automated access that violates machine-readable instructions, and allow suspension for scraping content that does not belong to the user. [Google Terms of Service](https://policies.google.com/terms?hl=en)
- DuckDuckGo requires compliance with its acceptable-use policy and reserves suspension rights; that policy prohibits interfering with service integrity and selling or reselling portions of the service. [DuckDuckGo terms](https://duckduckgo.com/terms), [acceptable-use policy](https://duckduckgo.com/acceptable-use)
- Hound disables `robots.txt` checks by default and says this is intentional because enabling them would reduce usefulness. [Known gotchas](https://github.com/dondai44423/master-fetch/blob/4f94d88a04595688d862c53940fa5c1be4ab49b8/README.md#L574-L584)
- Even with robots checking enabled, robots rules govern crawler access; they are not authorization or a content license. [IETF Robots Exclusion Protocol](https://www.rfc-editor.org/rfc/rfc9309.html#section-1)
- Hound does not supply a license or redistribution entitlement for fetched third-party pages. Budds would still own source eligibility, excerpt limits, retention, takedown, attribution, and jurisdiction-specific legal review.

### Runtime, security, and operability

- Hound's full Docker image installs browser system libraries, Playwright/Patchright Chromium, Python dependencies, and an optional real Chrome. The Dockerfile warns that the HTTP endpoint has no authentication. [Dockerfile](https://github.com/dondai44423/master-fetch/blob/4f94d88a04595688d862c53940fa5c1be4ab49b8/Dockerfile#L20-L86)
- The supplied Compose file says the port is bound to loopback, but actually maps `0.0.0.0:8765:8765`; it also documents browser/OCR workloads peaking around 1.5–2 GB and suggests a 3 GB memory ceiling. [Docker Compose](https://github.com/dondai44423/master-fetch/blob/4f94d88a04595688d862c53940fa5c1be4ab49b8/docker-compose.yml#L18-L60)
- The Docker CI endpoint probe and in-container test command both end with `|| true`, so those steps cannot fail the job. The image also does not copy the test directory before attempting the in-container test. A green Docker workflow therefore does not prove the endpoint or tests succeeded. [Docker CI](https://github.com/dondai44423/master-fetch/blob/4f94d88a04595688d862c53940fa5c1be4ab49b8/.github/workflows/docker-ci.yml#L30-L57), [Docker build inputs](https://github.com/dondai44423/master-fetch/blob/4f94d88a04595688d862c53940fa5c1be4ab49b8/Dockerfile#L48-L64)
- Hound includes meaningful initial URL validation, private-network blocking, alternate-IP checks, DNS resolution, and redirect revalidation. However, its own source notes that the DNS check is vulnerable to time-of-check/time-of-use rebinding unless the resolved address is pinned or egress is constrained. [SSRF guard](https://github.com/dondai44423/master-fetch/blob/4f94d88a04595688d862c53940fa5c1be4ab49b8/src/master_fetch/security.py#L130-L145), [redirect revalidation](https://github.com/dondai44423/master-fetch/blob/4f94d88a04595688d862c53940fa5c1be4ab49b8/src/master_fetch/fetcher.py#L465-L505)
- Fetched content is cached in a local SQLite database for one hour by default. This is operationally convenient but would require Budds-specific tenant isolation, encryption, retention, erasure, and observability controls. [Cache implementation](https://github.com/dondai44423/master-fetch/blob/4f94d88a04595688d862c53940fa5c1be4ab49b8/src/master_fetch/cache.py#L1-L65)
- Cloudflare Python Workers run inside Pyodide and support pure/PyEmscripten packages, not this CPython/native-browser stack. Cloudflare Containers can run arbitrary container images, but require Workers Paid and bill container compute, storage, egress, Worker, and Durable Object usage. [Python package constraints](https://developers.cloudflare.com/workers/languages/python/packages/), [Cloudflare Containers](https://developers.cloudflare.com/containers/), [Containers pricing](https://developers.cloudflare.com/containers/platform/pricing/)

## Analysis and inference

The following conclusions are engineering judgments derived from the verified facts above:

- “Free” means no Hound per-query fee. It does not mean zero production cost: Budds would pay for container/VM capacity, egress, monitoring, patching, IP reputation, and likely proxies as usage grows.
- Hound's multi-engine resilience is optimized for one person's agent traffic. A multi-tenant learning product would concentrate queries behind server egress IPs and reach rate limits or blocks much sooner.
- Browser impersonation, CAPTCHA handling, proxy rotation, and search-result scraping create avoidable contractual and reputational risk. They should not sit behind a user-visible “Search the web” feature without written authorization from every upstream provider.
- Hound's metadata can help discover candidate pages, but it is not enough for a Learn Anything source ledger. Budds must fetch and freeze the exact evidence used, hash it, retain retrieval timestamps, map statements to evidence, distinguish archive/live sources, and enforce content-retention policy.
- Directly exposing Hound's MCP endpoint would create an arbitrary-fetch service. Authentication alone would not close SSRF, prompt-injection, resource-exhaustion, browser-action, or cross-tenant cache risks.

## Comparison with the Learn Anything plan

| Requirement | Hound | Budds decision |
|---|---|---|
| Zero per-query vendor bill | Yes, for keyless mode | Useful only for local evaluation; infrastructure is still paid |
| Authorized, supportable upstream | No compliance claim | Keep official/open APIs and contracted providers |
| Cloudflare-native | No | Do not add a Python/browser container for v2 search |
| Stable maintenance | Abandoned | Disqualifying for a new production dependency |
| Search provenance | Engine names, URL, snippet, consensus | Adapt these fields into Budds' provider-neutral candidate schema |
| Evidence provenance | Page metadata and extracted text | Budds must add immutable snapshots and statement-level references |
| Rights metadata | Not provided | Budds owns license/access/retention classification |
| Robots behavior | Off by default | Budds fetcher must be policy-controlled and respect publisher restrictions |
| Authentication | None in Hound HTTP mode | All search/fetch calls stay server-owned and authenticated |
| SSRF isolation | Application guard with admitted DNS-rebinding gap | Enforce network-layer egress denial and URL revalidation |

Hound also does not replace Cloudflare AI Gateway or OpenRouter. If it were used, it would sit **before** model generation:

`Nuxt server route → search adapter → candidate URLs → secured fetch/extraction → immutable evidence snapshot → AI Gateway/OpenRouter → validated blueprint/session`

The AI Gateway should continue to own model routing, budgets, and inference telemetry. Search and content retrieval need separate provider, policy, and provenance records.

## Recommended Budds integration boundary

Do not add Hound to the production path. Implement the Learn Anything source layer behind these internal interfaces:

```ts
interface WebSearchProvider {
  search(request: SearchRequest): Promise<SearchCandidate[]>
}

interface EvidenceFetcher {
  fetch(request: FetchEvidenceRequest): Promise<RetrievedEvidence>
}

interface SearchCandidate {
  provider: string
  queryId: string
  url: string
  title: string
  snippet?: string
  providerRank?: number
  consensusCount?: number
  discoveredAt: number
}
```

Production providers should remain:

1. User-provided URLs.
2. Wikimedia and subject-specific authorized APIs such as Crossref, OpenAlex, and PubMed.
3. Cloudflare AI Search for Budds-controlled or user-authorized indexed material.
4. A budget-gated contracted general-search provider through the existing server-side routing layer when free sources leave a visible coverage gap.

The fetcher must be separate from search and must enforce:

- HTTPS-only URLs and per-hop redirect validation.
- DNS resolution pinned to the outbound connection plus network-level denial of private, loopback, link-local, metadata, and internal-service ranges.
- No cookies, user headers, browser actions, login sessions, or arbitrary proxy configuration.
- Publisher/robots policy, MIME and byte limits, timeout, decompression limits, and executable-content rejection.
- Sanitized queries that never contain private folder text.
- Short bounded excerpts, immutable hashes, retrieval timestamps, source URLs, access/licensing classification, and deletion/takedown support.
- Treating every fetched byte as untrusted data, never as tool or system instructions.

### Bounded evaluation, if the team still wants to test Hound

A local-only benchmark is reasonable because it can test whether Hound's ranking ideas are worth reproducing:

- Pin `hound-mcp==13.2.0` by package hash in an isolated Docker environment; never auto-update it.
- Use public synthetic learning topics only. Do not send user queries, folder names, excerpts, credentials, or production URLs.
- Disable the browser, CAPTCHA bypass, proxies, crawl, screenshots, archive recovery, custom headers/cookies, and page actions.
- Set `respect_robots=true`, a small result limit, strict request/byte deadlines, and no persistent content cache.
- Bind the service to loopback only. If called across a network, put it behind an authenticated gateway and deny all internal egress at the network layer.
- Compare 50 representative queries against the planned free-first providers on primary-source recall, successful evidence fetch rate, duplicate rate, latency, block rate, unsupported citations, and compute use.
- Do not graduate it to production. Use the results only to decide whether Budds should independently implement consensus scoring or focused extraction against approved providers.

## Final recommendation

**Reject Hound for production adoption.** The abandonment/provenance mismatch alone is sufficient; the upstream-search terms posture, anti-bot design, non-Worker runtime, unauthenticated MCP endpoint, and incomplete SSRF boundary reinforce that decision.

**Adapt the concepts, not the dependency:** provider consensus, clear blocked-provider reporting, typed fetch quality, content freshness, focused extraction, and honest failure states fit Learn Anything well. Put those concepts inside Budds' provider-neutral source pipeline, backed by authorized sources and a locked-down evidence fetcher.

**Treat DonSeTch as a separate future evaluation.** Its active development and authenticated HTTP option may improve engineering ergonomics, but its AGPL license and continued keyless-search/anti-bot model require fresh legal and security review before any product use.
