# Bounded scorer harness

[Ticket #428](https://github.com/wescodess/budds/issues/428), part of [spec #415](https://github.com/wescodess/budds/issues/415). These fixtures are synthetic. They establish deterministic contracts, without establishing scorer accuracy, provider access, empirical form equivalence or Verified Learning Gain.

## Offline capture and replay

Use Node 24 and the repository's frozen lockfile installation. Run artifacts must be outside the repository. An example, with a fresh directory:

```sh
node scripts/learn-v2-scorer-harness.mjs init \
  --output /tmp/budds-scorer-example \
  --inventory tests/fixtures/learn-v2-scorer-harness/inventory.json \
  --fixture tests/fixtures/learn-v2-scorer-harness/valid.json \
  --clock 1793966400000 \
  --seed public-synthetic-exit-test-v1 \
  --price-access-date 2026-11-06 \
  --budget-micro-usd 100000
node scripts/learn-v2-scorer-harness.mjs run --output /tmp/budds-scorer-example
node scripts/learn-v2-scorer-harness.mjs replay --output /tmp/budds-scorer-example
node --test --test-concurrency=1 scripts/lib/learn-v2-scorer/exit.test.mjs
```

`init` freezes the complete input inventory and fixture transport. `run` makes 256 fixture dispatches for each of the three adapters, with network entry points disabled. It can resume the same directory; a sealed intent is never dispatched again. `replay` revalidates each raw envelope, baseline receipt, request and pin, refits from the sealed fit rows, and recreates the same report bytes. `--expected-report report-<digest>.json` also checks the report filename. Every offline report says `offline_contract_only`; a successful CLI exit can produce an incomplete diagnostic report, so consumers must inspect `complete`, availability and the evidence status.

`failures.json` exercises supported output, abstention, refusal, truncation, malformed JSON, identity mismatch, missing criteria, exhausted reservations and ambiguous outcomes. `--stop-after N` pauses after N durable intents. The offline-only `--crash-after-intent true` leaves an intent without a terminal; it simulates process death at the dispatch boundary. A deadline fixture can return a complete envelope at exactly 90 seconds; its grade remains unavailable. The Node exit suite runs these paths through separate CLI processes, with an additional network tripwire and provider credentials removed.

Ordinary `pnpm test` includes the harness exit suite and a separate wrapper that runs both C3.1 corpus `verify` and its Node test suite. No package scripts or workflows are needed.

## Seals and pins

The manifest contains the Node patch version, repository commit, lockfile digest, CLI/module/dependency-source hashes, baseline configuration snapshots and implementation pins, prompt/parser/schema versions and hashes, corpus/manifest/source/split hashes, generator/seed pins, adapters, provider/model/API endpoints, sampling/thinking/output settings, price-access date, threshold policy, explicit run clock and payload-policy version. Replay and every dispatch check these pins. Source changes, missing pins or a different checkout require a fresh run; historical artifacts remain intact.

Requests use only the regenerated, permitted public synthetic corpus. Each has a fresh opaque item ID and neutral criterion IDs, independently shuffled by adapter. Locators, class/split labels, expected vectors, essential-atom labels, learner/teaching/time fields and other grades stay local. The unchanged baseline request builder/parser and C3.2 configuration/receipt service remain authoritative for baseline scoring. Independent graders return a strict supported/abstain vector with checked source-span bounds. All scores use the existing local criterion arithmetic.

Each dispatch first publishes an fsynced, exclusive `item_*.intent.json`, retaining the complete non-secret request and maximum reservation. Its immutable `item_*.terminal.json` seals the raw synthetic envelope, outcome, observed identity, usage and locally validated score. An intent without a terminal, a timeout or an unknown post-dispatch outcome keeps the full reservation and blocks that adapter. No request ID is reused. Reconciliation is explicit and metadata-only; there is no retry, fallback, continuation or refund. A crashed lock or interrupted publication requires owner investigation; the CLI never steals locks.

Reports preserve all 224 core denominators, directional false passes/blocks and unavailable sensitivity bounds. Domain, source packet, seed class, form and scorer configuration counts remain separate. Pairwise grader/baseline disagreement and the 20 repeats have explicit unavailable pairs. Eight injection controls and four diagnostic slots remain outside core support. Only complete support receives point rates. Synthetic variants are correlated; per-packet counts describe coverage, not independent learners or population accuracy.

Candidate thresholds use only the 112 fit core rows and attainable scores. The least restrictive candidate meeting the provisional 5% false-pass and 10% false-block alarms is frozen before any of the 112 held-out dispatches. Incomplete fit support or no acceptable candidate produces an unavailable candidate. The baseline remains 80. Reports grant no promotion authority. Unresolved/source-established divergence quarantines validation claims, without human grading, model voting or changes to application results.

Optional `--anchors FILE` accepts only bounded synthetic join checks. They exercise clock, assistance, exposure, novelty, source/item pin consistency, separate Today/Canvas strata and three distinct cases for cold/day-7/day-30. A valid delayed failure remains in its observed numerator and denominator even when its validation claim is quarantined. Real anchor validity always remains `pending_real_delayed_evidence`; the CLI accepts no real learner snapshot or external replay.

## Separately approved live capture — unrun

Building these adapters authorizes no spending. No live call is part of these fixtures or CI. The live interface is `init --mode live` followed by one `dispatch --id <opaque ID>` per separately reviewed invocation. `plan` exposes the frozen request digests for reservation preparation. All three canaries must validate before core dispatches. There is one fixed machine-wide lock under `/tmp/budds-learn-v2-scorer-live`, a 90-second deadline, and at most 256 dispatches per model/configuration. Before transport, every global reservation also records an unresolved intent. Only a matching durable terminal or reconciliation record accounts for that intent. Exceptions publishing observations, terminal records, reconciliation markers or ledger resolutions leave every run blocked, including runs with distinct approvals; transient lock cleanup cannot clear this block.

A live inventory must list all reviewed published baseline configurations, their expected C3.2 digests, canonical family mappings, inventory evidence, observed upstreams and exact gateway URLs. One reserved run selects one baseline configuration with `--configuration`; every inventory family is checked for overlap with both graders. Unknown models/families/upstreams, unreviewed aliases and any Claude/Gemini overlap block admission. Automatic legacy routing stays automatic; it cannot establish a fixed upstream endpoint. Returned identity and repeat results remain necessary evidence. An unverified immutable Gemini revision is recorded explicitly.

Live dispatch requires three separate local inputs: `--approval FILE`, `--cost-evidence FILE`, and `--owner-public-key FILE`. The first two are independently signed Ed25519 envelopes `{payload, signature}`; signatures cover the canonical JSON payload. The public key must be the owner's established approval key. Tests generate ephemeral synthetic signing keys only. Constructing or signing a document here does not provide owner approval.

The versioned owner approval binds the entire manifest digest, owner/approval ID, finite budget, separate budget/provider/privacy approvals, public-synthetic payload policy, issuance/expiry and the cost-evidence digest. Cost evidence binds all 768 complete request digests, refreshed prices, conservative billed-input bounds including schema/system overhead, output plus thinking limits, fees/taxes/purchases and each maximum reservation. Estimated token counts alone are rejected. The full reservation must fit the approved cap; each dispatch reserves its maximum first. Full reservations are retained conservatively even if returned usage is smaller. Missing or expired approval, incomplete price/token coverage, changed gateway settings, deterministic E2E mode or an exhausted cap blocks dispatch. The exact schemas and integer cost calculation are in `scripts/lib/learn-v2-scorer/live-approval.mjs`.

## Explicit metadata reconciliation — live use unrun

Live use of `reconcile` still requires owner approval. It accepts only a recorded unresolved intent in its original live run, with its unchanged pins and the same signed approval, cost evidence, owner key, freshness and gateway checks as dispatch:

```sh
node scripts/learn-v2-scorer-harness.mjs reconcile \
  --output /path/to/original-live-run --id item_<original-opaque-id> \
  --approval /path/to/original-approval.json \
  --cost-evidence /path/to/original-cost.json \
  --owner-public-key /path/to/owner-public.pem
```

The command uses the saved generation ID and C3.2 metadata lookup, with at most one lookup and a timeout of at most ten seconds within the original dispatch lease. It cannot call inference. A live observation is sealed before terminal publication so its generation ID survives a later terminal-write failure. The lookup allowance is sealed before metadata I/O; restarting after a crash never grants another lookup.

Each reconciliation seals `item_*.reconciled.json` as `resolved`, `failed` or `still_unknown`, and records its digest in the global ledger. The global block clears only when every reservation has a durable resolved or failed record. A verified completed result can resolve; matching metadata that establishes cancellation or terminal failure records failure without a grade. Missing or contradictory identity, an unavailable lookup, an expired original lease, an absent saved generation ID or an adapter without the existing metadata seam stays unknown. Interrupted writes keep the block. A durable reconciliation can finish its ledger publication on restart without another lookup. Reservations remain fully charged, and replay uses only saved metadata. Unresolved cases outside this bounded lookup require owner investigation; deleting artifacts or starting a new run does not reconcile them.

The direct pins remain Claude `claude-sonnet-5-5`, Messages API `2026-10-21`, adaptive/high, 2,048 output/thinking tokens; and Gemini `gemini-3.6-flash`, `/v1beta/interactions`, `Api-Revision: 2026-05-20`, medium thinking, 2,048 combined output/thinking tokens, `store: false`. Access, protocol compatibility, retention, billed-token bounds and actual costs remain unverified until separately authorized owner setup and canaries. There is no silent substitute or endpoint downgrade. No provider account/key creation, application/mastery writes, deployment or environment/flag change is included.
