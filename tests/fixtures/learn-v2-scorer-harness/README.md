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

The exit suite runs the ledger matrix in two complementary serial subprocesses, retaining every case and the existing 360-second child and 480-second CI wrapper timeouts. The ledger fixtures regenerate and verify the fixed corpus once per subprocess and clone it per consumer; the full CLI and corpus suites regenerate independently.

Ordinary `pnpm test` includes the harness exit suite and a separate wrapper that runs both C3.1 corpus `verify` and its Node test suite. No package scripts or workflows are needed.

## Seals and pins

The manifest contains the Node patch version, repository commit, lockfile digest, CLI/module/dependency-source hashes, baseline configuration snapshots and implementation pins, prompt/parser/schema versions and hashes, corpus/manifest/source/split hashes, generator/seed pins, adapters, provider/model/API endpoints, sampling/thinking/output settings, price-access date, threshold policy, explicit run clock and payload-policy version. Every new dispatch must match the current checkout. Source changes, missing pins or a different checkout require a fresh dispatch run; historical artifacts remain intact.

The live ledger protects against crashes, partial writes, concurrency, races and accidental corruption. It does not protect against a local adversary with ledger write access who recomputes digests: that adversary can equally edit the harness or delete the ledger. Live runs are owner-operated on the owner's machine under explicit owner approval. Unkeyed seals establish self-consistency and linkage, not authenticity against that adversary.

Global admission verifies resolved historical runs by sealed-digest self-consistency and structure only. It checks canonical manifest, approval-consumption, complete reservation/intent, observation, terminal, metadata and reconciliation seals and their links. Each resolution must name its own sealed record, intent and status. Missing, unreadable, truncated, inconsistent or interrupted evidence blocks admission. Historical source reconstruction and execution are not part of admission: replaying the old code would reproduce its own bugs and defend only against the excluded local rewrite attack. A Node patch, minor or major upgrade, unavailable git history (including shallow clones, rewritten history or garbage-collected commits), or a moved repository does not block a separately approved fresh run when the historical evidence remains available and consistent. Run artifact directories must remain at the paths recorded by their approval-consumption seals.

A run's own restart and reconciliation retain authoritative replay with the current code when implementation and corpus pins match. When they differ, recovery verifies already-sealed known records by digest and structure, without reinterpreting old responses or making metadata calls. Explicit reconciliation can finish a known sealed outcome's missing global resolution; an unresolved older-version intent stays charged and blocked until its original pins are restored and it is explicitly reconciled. A new directory, approval or runtime never resolves that intent automatically. Changed-pin `replay`/recovery returns a `sealed_digest_consistency` evidence summary with `report: null` and `complete: false`; it does not regenerate or claim an authoritative historical report. Original signed approval/cost digests are still required for explicit reconciliation.

Requests use only the regenerated, permitted public synthetic corpus. Each has a fresh opaque item ID and neutral criterion IDs, independently shuffled by adapter. Locators, class/split labels, expected vectors, essential-atom labels, learner/teaching/time fields and other grades stay local. The unchanged baseline request builder/parser and C3.2 configuration/receipt service remain authoritative for baseline scoring. Independent graders return a strict supported/abstain vector with checked source-span bounds. All scores use the existing local criterion arithmetic.

Each dispatch first publishes an fsynced, exclusive `item_*.intent.json`, retaining the complete non-secret request and maximum reservation. Its immutable `item_*.terminal.json` seals the raw synthetic envelope, outcome, observed identity, usage and locally validated score. An intent without a terminal, a timeout or an unknown post-dispatch outcome keeps the full reservation and blocks that adapter. No request ID is reused. Reconciliation is explicit: replay usable saved evidence locally first, then consider the bounded metadata-only lookup. There is no inference retry, fallback, continuation or refund for dispatched work. A crashed lock or interrupted publication requires owner investigation; the CLI never steals locks.

Immediately before transport, the runner checks both the remaining durable intent lease and the signed `approval.validUntil` on the real clock, including after asynchronous baseline preparation. The remaining intent lease bounds the transport timeout; approval must also be valid when transport starts. Either expiry prevents inference and seals `item_*.not-dispatched.json`, linking the intent to the checked time and `lease_expired_before_transport` or `approval_expired_before_transport`. Its matching global resolution releases that unused reservation and dispatch count while retaining the original reservation and intent as audit history. A crash before that cancellation is durable remains uncertain and charged. A crash after it is durable can recover the terminal/resolution locally, without inference or metadata. A cancellation cannot coexist with transport observations or metadata evidence.

Reports preserve all 224 core denominators, directional false passes/blocks and unavailable sensitivity bounds. Domain, source packet, seed class, form and scorer configuration counts remain separate. Pairwise grader/baseline disagreement and the 20 repeats have explicit unavailable pairs. Eight injection controls and four diagnostic slots remain outside core support. Only complete support receives point rates. Synthetic variants are correlated; per-packet counts describe coverage, not independent learners or population accuracy.

Candidate thresholds use only the 112 fit core rows and attainable scores. The least restrictive candidate meeting the provisional 5% false-pass and 10% false-block alarms is frozen before any of the 112 held-out dispatches. Incomplete fit support or no acceptable candidate produces an unavailable candidate. The baseline remains 80. Reports grant no promotion authority. Unresolved/source-established divergence quarantines validation claims, without human grading, model voting or changes to application results.

Optional `--anchors FILE` accepts only bounded synthetic join checks. They exercise clock, assistance, exposure, novelty, source/item pin consistency, separate Today/Canvas strata and three distinct cases for cold/day-7/day-30. A valid delayed failure remains in its observed numerator and denominator even when its validation claim is quarantined. Real anchor validity always remains `pending_real_delayed_evidence`; the CLI accepts no real learner snapshot or external replay.

## Separately approved live capture — unrun

Building these adapters authorizes no spending. No live call is part of these fixtures or CI. The live interface is `init --mode live` followed by one `dispatch --id <opaque ID>` per separately reviewed invocation. `plan` exposes the frozen request digests for reservation preparation. All three canaries must validate before core dispatches. There is one fixed machine-wide lock under `/tmp/budds-learn-v2-scorer-live`, a 90-second deadline, and at most 256 dispatches per model/configuration. Before transport, every global reservation also records an unresolved intent. Only a matching durable terminal or reconciliation record accounts for that intent. Exceptions publishing observations, terminal records, reconciliation markers or ledger resolutions leave every run blocked, including runs with distinct approvals; transient lock cleanup cannot clear this block.

A live inventory must list all reviewed published baseline configurations, their expected C3.2 digests, canonical family mappings, inventory evidence, observed upstreams and exact gateway URLs. One reserved run selects one baseline configuration with `--configuration`; every inventory family is checked for overlap with both graders. Unknown models/families/upstreams, unreviewed aliases and any Claude/Gemini overlap block admission. Automatic legacy routing stays automatic; it cannot establish a fixed upstream endpoint. Returned identity and repeat results remain necessary evidence. An unverified immutable Gemini revision is recorded explicitly.

Live dispatch requires three separate local inputs: `--approval FILE`, `--cost-evidence FILE`, and `--owner-public-key FILE`. The first two are independently signed Ed25519 envelopes `{payload, signature}`; signatures cover the canonical JSON payload. The public key must be the owner's established approval key. Tests generate ephemeral synthetic signing keys only. Constructing or signing a document here does not provide owner approval.

The versioned owner approval binds the entire manifest digest, owner/approval ID, finite budget, separate budget/provider/privacy approvals, public-synthetic payload policy, issuance/expiry and the cost-evidence digest. Cost evidence binds all 768 complete request digests, refreshed prices, conservative billed-input bounds including schema/system overhead, output plus thinking limits, fees/taxes/purchases and each maximum reservation. Estimated token counts alone are rejected. The full reservation must fit the approved cap; each dispatch reserves its maximum first. Full reservations are retained conservatively even if returned usage is smaller. Missing or expired approval, incomplete price/token coverage, changed gateway settings, deterministic E2E mode or an exhausted cap blocks dispatch. The exact schemas and integer cost calculation are in `scripts/lib/learn-v2-scorer/live-approval.mjs`.

## Explicit metadata reconciliation — live use unrun

Live use of `reconcile` still requires owner approval. It accepts only a recorded unresolved intent in its original live run, with its unchanged pins and the same signed approval, cost evidence, owner key and gateway checks as dispatch. Local replay verifies approval validity at the recorded dispatch time, so expiry cannot strand saved evidence. New metadata I/O also requires current approval, price freshness and the original lookup lease:

```sh
node scripts/learn-v2-scorer-harness.mjs reconcile \
  --output /path/to/original-live-run --id item_<original-opaque-id> \
  --approval /path/to/original-approval.json \
  --cost-evidence /path/to/original-cost.json \
  --owner-public-key /path/to/owner-public.pem
```

The command first replays a saved observation through the same request, identity, output, criterion and lease validation used by dispatch and restart. It seals a missing terminal locally when possible, without a lookup or inference. Only an unresolved baseline observation with an eligible saved generation ID can use the C3.2 metadata lookup, at most once and with a timeout of at most ten seconds within the original dispatch lease. Reconciliation cannot call inference. A live observation is sealed before terminal publication so its generation ID survives a later terminal-write failure. The lookup allowance is sealed before metadata I/O; restarting after a crash never grants another lookup.

Metadata responses are sealed separately as `item_*.metadata-observation.json` before a reconciled verdict is published. Restart replays those saved bytes through C3.2, with the recorded lookup timing. An expired lease or late metadata cannot produce a resolution. The lookup intent consumes the allowance even if the process stops before I/O or before the response is saved. No restart issues a second lookup.

The first reconciliation attempt is `item_*.reconciled.json`; later attempts append `item_*.reconciled-1.json`, and so on, linking each predecessor's digest. `still_unknown` is a retained observation of uncertainty, not a terminal decision. Repeating with the same evidence is idempotent; later saved observation or metadata evidence can supersede it without erasing history. Missing evidence stays blocked pending investigation, rather than authorizing inference. Known reconciliations cannot be superseded.

Every global resolution verifier checks the original run's sealed manifest, approval consumption, request/intent, observation, terminal or reconciliation history, metadata response, links and recorded status. It executes no historical code. Own-run recovery replays only when pins match; otherwise it accepts only already-sealed known outcomes. Unknown attempts do not publish a clearing resolution. An earlier unknown global resolution, if present, remains in history when a known resolution is added. Reconciliation successors cannot predate their predecessors. Dispatched reservations remain fully charged, including failures and unresolved dispatches; only a verified pre-transport cancellation releases an unused reservation.

## Live crash-point contract

The durable dispatch sequence is:

```text
approval consumption → global reservation with complete intent → local intent
  → real-clock lease and approval-expiry check → single dispatch → observation saved → terminal sealed
  → global resolution recorded → optional uncertainty marker/report → locks released

expired before transport → not-dispatched record → not-dispatched terminal
  → verified global cancellation resolution → unused reservation released
```

The explicit reconciliation sequence is:

```text
restore a missing local intent from its reservation → replay saved observation
  → seal missing terminal if possible → otherwise seal metadata lookup intent
  → at most one metadata lookup → metadata response saved → replay metadata
  → append reconciliation attempt → global resolution recorded
  → clear resolved marker → report → locks released
```

Each row covers a stop or exception immediately before and after that publication. A published artifact remains immutable. A publication that throws after publishing is treated as published on restart. The regression suite uses synthetic transport and publication faults; it does not establish filesystem or provider reliability.

| Point | Durable state at interruption | Required recovery | Implementation / regression |
| --- | --- | --- | --- |
| D0: approval consumption | No reservation or transport; approval may be saved | Retry admission with the original approval; charge before transport | `claimLiveApproval`, `reserveLiveDispatch`; `crash table: approval and reservation publication` |
| D1: global reservation → local intent | Full charge and exact intent saved globally; local intent may be absent | Block all dispatches; explicit reconciliation restores the exact intent, never dispatches it, and retains the charge | `reconcileLive`, `verifyLiveRun`; D0 test and `an interruption between global charging` |
| D2: local intent → dispatch | Intent exists; transport may not have started | Never redispatch; retain charge and uncertainty; reconcile again when evidence is available | `dispatch`, `reconcileLive`; `crash table: local intent before transport` |
| D2a: expired lease or signed approval → not-dispatched record | Intent and full reservation exist; expiry guard prevents transport | Before durable cancellation, retain charge and uncertainty. After durable cancellation, verify expiry/linkage and recover terminal/resolution without I/O; release only the unused reservation/count | `dispatch`, `openRun`, `reconcileLive`, `usage`; `A4 lease`, `A5 approval expiry`, `A4 crash table` and `A4 cancellation integrity` |
| D2b: not-dispatched terminal → cancellation resolution | Cancellation/terminal may be saved; global charge may remain | Replay the cancellation and terminal, finish exclusive global resolution publication, and release exactly once; preserve original intent/reservation and forbid redispatch | `recordLiveResolution`, `verifyResolution`; `A4 crash table` (both publication sides) |
| D3: dispatch → observation | Transport may have occurred; no usable saved response | Keep the global block; no lookup without an eligible saved generation ID; permit later saved evidence | `reconcileLive`; `crash table: absent observations` (all adapters) |
| D4: observation → terminal | Saved observation exists; terminal absent or publication threw | Re-derive and seal the terminal through authoritative local replay, even after approval expiry; use metadata only if still unresolved and currently authorized | `evaluate`, `reconcileLive`; `A3 M1 and crash table` (all adapters, valid and refused) |
| D5: terminal → global resolution | Replayed terminal exists; resolution absent | Verify the saved response and publish its resolution, with no inference or lookup | `recordLiveResolution`, `openRun`; A3 M1 matrix and `known durable terminal` |
| D6: global resolution → marker/report | Resolution may already exist, or unknown outcome has no clearing resolution | Re-verify every linked record before admission; known restart is idempotent; unknown remains blocked even if marker publication fails | `openLiveLedger`, `verifyResolution`, `dispatchLive`; `crash table: durable resolution` and `post-dispatch publication failures` |
| H0: runtime, repository, source, lockfile or history changes | Historical reservations/resolutions retain their original manifest digest | Global admission checks sealed digests and structure without historical code/runtime/git. Own recovery replays matching pins or verifies sealed known outcomes; unresolved old intents stay blocked pending explicit reconciliation with matching pins | `openRun` (sealed-only), `openRecoveryRun`, `openLiveLedger`, `reconcileLive`; `A5 historical admission`, `A5 historical structure`, `A5 own recovery`, `A5 recovery` |
| R0: restore local intent / seal recovered terminal | Original reservation/observation remains durable | Retry the same exclusive publication; retain charge and block until replay proves a known outcome | `reconcileLive`; D1 and A3 M1 matrices |
| R1: metadata lookup intent | No lookup intent means no allowance used; published intent means allowance consumed | Retry only an unpublished intent; once published, never repeat metadata I/O, even if the process stopped before lookup | `reconcileLive`, `captureMetadata`; `crash table: metadata intent, saved response and reconciled verdict` |
| R2: lookup → metadata response | Lookup allowance consumed; response may be absent or saved | Replay saved metadata locally; absent response stays unknown and may accept later saved evidence; no second lookup | `captureMetadata`, `replayMetadata`; R1 matrix and `unknown reconciliation history accepts later saved metadata` |
| R3: metadata response → reconciliation attempt | Saved response survives verdict publication failure | Replay and append the verdict; a prior unknown attempt remains intact and can be superseded | `openReconciliation`, `reconcileLive`; R1 matrix and history tests |
| R4: reconciliation attempt → global resolution | Known verdict saved, global publication incomplete | Replay the complete history and metadata response, then finish publication without another lookup | `recordLiveResolution`, `verifyResolution`; `interrupted global resolution publication` |
| R5: resolution → marker removal | Resolution known; marker may remain or unlink may already have succeeded | Re-verify resolution and idempotently finish marker removal/report; no second lookup or inference | `clearResolvedMarker`, `reconcileLive`; `crash table: marker removal` |
| D7/R6: locks released | Durable reservation/resolution is independent of transient mutexes | Exceptions releasing locks cannot clear uncertainty. A surviving owner lock is never stolen; its owner must investigate and release it before replay/reconciliation | `exclusiveLock`; `crash table: durable resolution` and `exclusive locks refuse overlapping dispatchers` |
| Publication internals | Ordinary write/fsync/link exception, or abrupt process death with a temporary file | Ordinary exceptions clean their temporary inode while preserving any published artifact. Abrupt death retains the lock and temporary evidence for owner investigation; preserve/validate the artifact before resuming explicit reconciliation | `seal`, `exclusiveLock`; publication matrices and interrupted-write regressions |

Missing or digest/link-inconsistent terminal, resolution or metadata evidence blocks admission. With matching pins, an original-run restart additionally rejects verdicts that disagree with authoritative replay. Tests retain the A3 rehashed-terminal reproduction for every adapter within the A5 threat model, along with resolution-record link/status validation, metadata tampering, history gaps and both expiry boundaries. A coherently rehashed local chain is outside that threat model. Deleting artifacts, changing approvals or starting another run does not reconcile an unknown outcome.

The direct pins remain Claude `claude-sonnet-5-5`, Messages API `2026-10-21`, adaptive/high, 2,048 output/thinking tokens; and Gemini `gemini-3.6-flash`, `/v1beta/interactions`, `Api-Revision: 2026-05-20`, medium thinking, 2,048 combined output/thinking tokens, `store: false`. Access, protocol compatibility, retention, billed-token bounds and actual costs remain unverified until separately authorized owner setup and canaries. There is no silent substitute or endpoint downgrade. No provider account/key creation, application/mastery writes, deployment or environment/flag change is included.
