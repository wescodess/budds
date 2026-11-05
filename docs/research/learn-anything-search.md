# Near-$0 search for the Void

Date: 2026-11-04
Status: Proposed design for review; nothing here is implemented
Parent: [learn-anything-deep-dive.md](./learn-anything-deep-dive.md)

## Bottom line

Lifting the limit is affordable. The product-wide cap of 25 searches a day exists because Tavily's free tier is the only search path. Three things remove it:

1. **Stop searching for what doesn't need a search.** Most sources for a learning topic can be found without a search API.
2. **Use several providers' free tiers, one account each.** That gives about 4,000 searches a month with no card, five times today's 800.
3. **Pay for overflow only at about $4 per 1,000.** At that price search is unlikely to be a meaningful cost next to the LLM calls.

A learner should also never be blocked for lack of search. If every lane is exhausted, teaching continues on model knowledge, labelled as such.

## What the repo does today

- `tavily_free` is the only discovery provider, hard-coded in `convex/learnV2Search.ts:11`.
- Limits: 800 per month, 25 per day product-wide, 4 per user per day, 2 broad per void, 8 results per request (`shared/learn-v2-contract.ts:466`).
- **The free-first routing in spec #180 isn't built.** The UI has an "Open databases" group and the schema has an `open_database` origin, but a search of `origin/dev` found no Wikimedia, OpenAlex, Crossref or PubMed adapter. This is the biggest cheap win.
- The strong parts stay: the public-query privacy screen, transactional reservations, kill switch, and a safe fetcher that re-fetches the original publisher and honours robots.

## The waterfall

Each lane runs only if the previous one left a coverage gap. Stop as soon as the concept has enough sources.

| Lane | Source | Cost | Notes |
| --- | --- | --- | --- |
| 0 | Sources already accepted in this void; shared public source pack for this concept | $0 | Grows more valuable with use |
| 1 | **Model-nominated URLs:** the model names likely authoritative pages (official docs, textbooks, standards), and the safe fetcher checks each one | About $0 | The spec already allows model knowledge to help find sources. Invented URLs simply fail to fetch. Fetched content is judged, never the model's claim about it |
| 2 | **Citation hopping:** follow references and links from pages already fetched, such as a Wikipedia article's references | $0 | Uses the existing fetcher, so robots rules still apply |
| 3 | **Open databases:** Wikimedia, OpenAlex, then Crossref, PubMed, arXiv, Stack Exchange, by topic | $0 | Build these adapters. Details below |
| 4 | **Free search pool:** Exa, Tavily, Firecrawl | $0 | About 4,000 per month |
| 5 | **Paid overflow:** Exa Lite | About $4 per 1,000 | Budget-capped, with a kill switch |
| 6 | Nothing left | $0 | Continue on labelled model knowledge, name the gap, retry later |

Lanes 1 and 2 will probably bias toward well-known sources. That suits foundational material but is weaker for recent topics, so a query about something recent or niche should go to search sooner.

## Provider numbers

Read from first-party pages on 2026-11-04. These change often, so the adapter should keep them in config.

| Provider | Free allowance | Searches | Card | Overflow |
| --- | --- | --- | --- | --- |
| [Exa](https://exa.ai/pricing) | $10, resets monthly | Up to 2,500 Lite | No | $4 per 1,000 Lite |
| [Tavily](https://docs.tavily.com/documentation/api-credits) | 1,000 credits a month | 1,000 basic | No | $8 per 1,000 ($0.008 per credit) |
| [Firecrawl](https://www.firecrawl.dev/pricing) | 1,000 credits a month | 500 (2 credits per 10 results) | No | Not priced here |
| **No-card total** | | **4,000 a month, about 133 a day** | | |
| [Brave](https://brave.com/search/api/) (held back) | $5 credit monthly; the page's banner says "up to $20", which conflicts | About 1,000 | Asked for | $5 per 1,000 |

| Open source | Limit | Status |
| --- | --- | --- |
| [Wikimedia](https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits) | 200 requests a minute with a compliant User-Agent; 3 concurrent or fewer. New in 2026 and subject to change. High-volume commercial users are pointed to Wikimedia Enterprise, which has a free tier | Checked |
| [OpenAlex](https://help.openalex.org/how-to-use-the-api/rate-limits-and-authentication) | $1 a day free with a key, 30 requests a second; semantic search 1 a second | Checked; I didn't confirm cost per query |
| Crossref, PubMed, arXiv, Stack Exchange | Not checked | Confirm limits and terms before building |

Text from Wikimedia and Stack Exchange is share-alike licensed, so attribution has to carry through to what the learner sees. Budds' existing rights fields can record this.

## What "as many as we need" costs

Illustrative only, assuming 4 searches for each new void that reaches lane 4. I have no real usage data, and I don't yet know what share of voids lanes 0 to 3 will satisfy, so these should be replaced with measured values.

| New voids per month | Share needing search | Searches | Paid searches | Cost at $4 per 1,000 |
| --- | --- | --- | --- | --- |
| 1,000 | 100% | 4,000 | 0 | $0 |
| 5,000 | 50% | 10,000 | 6,000 | $24 |
| 20,000 | 30% | 24,000 | 20,000 | $80 |
| 100,000 | 30% | 120,000 | 116,000 | $464 |

For scale, the pilot manifest's ceiling for one scored attempt is $0.10. That's a limit rather than an actual cost, but it would buy 25 Exa Lite searches. **LLM calls, not search, look likely to be the main cost**, so that's the number to watch.

## Shared source packs

Caching across learners is the most effective saving, and also the most delicate part, so it has limits:

- **What's cached:** Budds' **own fetch** of a public publisher page: canonical URL, content hash, retrieval date, rights status, and the concepts it covers.
- **What isn't:** raw search-provider responses (see the terms below), or anything originating from a learner's folder or private URL.
- **Rights still apply.** Pages with unknown retention rights keep metadata and hashes only, and get re-fetched when used.
- **Acceptance stays per-learner.** A shared page is a candidate. Whether it becomes T0 for a given void remains that learner's decision, with T1 as the default.
- **This is a new kind of table.** ADR-0005 expects every V2 table to be owner-scoped, so a global table needs its own rules on deletion and export. It should hold public data only, and the query must never appear in it.
- **Queries stay private.** Keep the existing public-query screen. Cache by concept rather than by query text.

## Rejected

| Option | Why not |
| --- | --- |
| Many accounts to multiply free tiers | [Tavily's terms](https://www.tavily.com/terms) give each customer a single account (§3.1) and prohibit exceeding limits or concealing identity (§3.2). It risks losing the service |
| Self-hosted SearXNG | Works by querying other engines' results, which raises terms and reliability problems. I did not verify its current state |
| Scraping search engines directly | Same problem, and at odds with the fetcher's rules against bypassing controls |
| Common Crawl as a search index | Its index looks up URLs rather than searching by topic. Secondary sources also report that crawl size is shrinking and major publishers block it |
| Cloudflare `WebSearch` binding | I still can't find public docs, so spec #180's decision to leave it off stands. Worth rechecking |

[Cloudflare's `/crawl` endpoint](https://developers.cloudflare.com/browser-rendering/rest-api/crawl-endpoint/) isn't search, but it's useful in lane 2 for expanding a documentation site. With `render: false` it's unbilled during beta and honours robots.

## Terms to confirm

The owner decided on 2026-11-04 that no separate review is needed. These clauses are recorded because they shaped the design, in particular not caching provider payloads:

- **Tavily §2** limits API use to "internal business purposes" and says it may not be "made available to any third party". Whether results powering a consumer feature fit that is unclear.
- **Exa §4.2(a)** restricts copying or distributing information obtained through the service, unless otherwise permitted, which is why provider payloads aren't cached above. **Exa §1.2(c)** also gives Exa a broad licence over input and output, so the query privacy screen matters.
- **Brave's** FAQ says storing results needs a plan with storage rights, without saying which plans. It stays out until that's clear.

## Required code and contract changes

- Replace `provider: 'tavily_free'` with an ordered adapter list. Split `server/utils/tavily-free-search.ts` behind one interface, and make `searchQuotaBuckets` and reservations per-provider. The reconciliation logic is Tavily-specific today.
- Replace `costCeilingUsd: 0`, `allowsOverage: false` and `paidFallback: false` with a monthly budget of $25 (decided 2026-11-04), alerting early and held in config.
- Replace the product-wide daily cap with fair-use limits per user and per void, to stop abuse rather than ration normal use.
- Keep: failing closed when the ledger is unavailable, reservations, the kill switch, and no query or result payloads in logs.
- Change what "exhausted" means: search stops, teaching continues on labelled model knowledge.
- Record lane, cost and hit rate per void, so the table above can use real numbers.

This reverses spec #180's "zero-paid-search" principle, recorded in [ADR-0011](../adr/0011-use-a-budgeted-source-discovery-waterfall.md).
