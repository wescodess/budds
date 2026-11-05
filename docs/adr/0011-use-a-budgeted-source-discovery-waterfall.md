---
status: accepted
---

# Use a budgeted source-discovery waterfall

This replaces the zero-paid-search lane in the Learn V2 contract, whose product-wide limit of 25 searches a day cannot support open use. Source discovery will run as an ordered waterfall that stops once coverage is sufficient: existing and shared public sources, model-nominated URLs verified by the safe fetcher, citation hopping, open databases, one account each on free search tiers, then paid overflow under a low monthly budget with a kill switch. Search exhaustion stops discovery but not learning, which continues on labelled model knowledge under ADR-0009. Reservations, failing closed when the ledger is unavailable, query privacy screening, and payload-free logs all remain. A shared cache may hold only Budds' own fetches of public publisher pages, never raw provider responses, learner queries, or private material; it is the one deliberate exception to ADR-0005's owner-scoped tables. See `docs/research/learn-anything-search.md`.
