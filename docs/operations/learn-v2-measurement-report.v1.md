# Offline measurement report replay v2

The Node 24 entry point calls the frozen C6.1 `buildPublishedLearningMeasurementReport`
reducer. It computes no metric arithmetic of its own. Report output v3, source v4,
query v1, `verified_learning_gain.v1` and `false_mastery_next_delayed.v1` retain
their [C1 contract](../plans/learn-v2-c1-public-api-contract.md#frozen-report-output-v3).
The retained synthetic operational/outcome CLIs are unchanged.

## Commands

Run from the repository root with Node 24 and the existing dependencies. No
installation, package script, application server, provider or network is needed.

```sh
node --version
node scripts/learn-v2-measurement-report.mjs
node scripts/learn-v2-measurement-report.mjs --fixture scripts/learn-v2-measurement-report.fixture.v1.json > /tmp/measurement-fixture.json
node scripts/learn-v2-measurement-report.mjs --sealed-input /permitted/private/retained-snapshot.json > /permitted/aggregate-replay.json
```

The first report command returns unavailable diagnostics and exits 2. Fixture
replay exits 0 and labels the output `fixture_diagnostic` / `fixture_only`.
The sealed-input command labels it `sealed_input_replay` / `offline_replay_only`.
Only use the latter inside a separately authorized, purpose-scoped process that
already has permission to handle the retained normalized inputs. Aggregate-viewer
permission alone grants no right to acquire another learner's input rows. There
is no raw-input download command or public raw-input endpoint.

For a reproducible sealed-format diagnostic using only the checked-in fixture:

```sh
node scripts/learn-v2-measurement-report.mjs --sealed-input scripts/learn-v2-measurement-report.fixture.v1.json > /tmp/measurement-sealed-format.json
shasum -a 256 /tmp/measurement-fixture.json /tmp/measurement-sealed-format.json
```

Expected complete stdout SHA-256 values, including formatting and final newline:

```text
39162b65275a145a97ce0cc436fc022be5237ed7dffa7a43f050ac86bec319ba  fixture
796a26fd22e77d73559530e0b611a324743c4a0c09b7ce6d358e2e60843ba3fa  sealed-format
```

These two outputs differ only in the input-class and replay reason labels. Both
are fixture evidence. The checked-in fixture has two learners, below the
publication minimum of five distinct contributing learners. Every cell therefore
includes `insufficient_learners`: all values, bounds, intervals, counts and
value-bearing breakdowns are null, as are the published provenance's episode
count and input bytes. The unassigned day-30 horizon retains
`no_eligible_population` alongside suppression. Exit 0 confirms a successful
suppressed replay, not permission to publish the underlying arithmetic.

The independent unpublished reducer oracles remain day-7 VLG −20 percentage
points with bounds [−30,20], and first-check N=2, M=1, F=1 with observed failure 1
and bounds [0.5,1]. They are test expectations, not CLI output. Counts and repeated
inventory context must not be summed across strata, horizons or weightings.

For a five-learner example, see `publishes replayed values only once five distinct
learners contribute` in [the CLI tests](../../scripts/learn-v2-measurement-report.test.ts).
It constructs inputs with [the computation fixtures](../../tests/fixtures/learn-v2-measurement-computation.ts),
replays them through the CLI, and publishes day-7 VLG −20 with five comparable
pairs and bounds [−20,−20]. Removing one learner suppresses those fields. Five
learners do not meet the separate 20-learner minimum for bootstrap intervals.

## Accepted input and failures

Both modes consume the same strict JSON envelope:

```text
{
  version: "learn-v2.measurement-report-replay.v2",
  report: <frozen report-v3 sealed manifest>,
  roster: <retained run-scoped learner keys>,
  rows: <retained normalized source-v4 rows>
}
```

`report` carries `reportRunId`, the fixed query and provenance. The query pins
cohort/epoch/protocol, the half-open enrollment range and evaluation cutoff.
Provenance pins extraction dates, adapter/code/source/query versions, coverage,
canonical input/roster digests, normalized byte/episode counts and the seed plus
10,000 bootstrap replicates. The supported reducer code pin is
`learn-v2.report-code.c6.2.v4`. A future reducer needs an explicit
compatibility decision and updated replay version/expectations; editing an old
manifest's code pin to bypass rejection does not constitute exact replay. Replay
v2 consumes legacy and v2 first-Independent claims. An unresolved slot has a null
horizon and unknown scorer stratum; it keeps its reason and contributes once to
N after seven local calendar days, with no fabricated opportunity or clock.
Late links keep the original slot and outcome. Older replay envelopes and code
pins are rejected; retain the earlier checkout to replay its saved inputs.

The CLI uses Node's native type stripping with a temporary resolver limited to
extensionless imports within this checkout's `shared` directory. It does not
bundle a second reducer, import runtime application handlers or load a Vite config.

The file must be regular JSON, at most 65 MiB including its wrapper. Whole-run
fingerprinting enforces the frozen 64 MiB normalized-input, 10,000-episode and
40,000-row limits; individual normalized records remain bounded by the shared
contract. Inputs are normalized/validated, then whole-run
`reconcileLearnReportSourceRows` runs **before** report computation. Missing owner
watermarks, missing assigned horizons, duplicates and conflicts return
`incomplete` with the reducer's sorted reason codes, no manifest and no cells.
No row is silently dropped. The reducer verifies the saved fingerprint,
cutoff/counts/seed and cohort/protocol pins. The CLI never fixes these saved pins.

| Condition | Result |
| --- | --- |
| Replayed sealed or fixture input | Exit 0; aggregate cells and dated safe manifest; source/grant/real-evidence readiness still pending/unverified |
| No input, missing protocol or no admitted population | Exit 2; explicit unavailable reason, no numerical cells |
| Stale manifest | Exit 2; `stale`, `snapshot_stale`, no cells |
| Disabled/building/unavailable/failed saved manifest | Exit 2; explicit `snapshot_*` diagnostic, no cells; saved free-text reasons are withheld |
| Wrong replay/report/source/query/code version | Exit 1; `incompatible_version`, no cells |
| Malformed fields, unknown fields, invalid rows or limits | Exit 1; generic `invalid_input`, no cells |
| Missing/unreadable/nonregular/oversize file or malformed JSON | Exit 1; `input_unreadable_or_malformed`, no cells |
| Incomplete reconciliation or mismatched saved fingerprint | Exit 1; payload-free reason codes, no cells |
| Unsupported runtime or arguments | Exit 1; `node_24_required` or `invalid_arguments` |

Exceptions, source paths, offending values and validation stacks are never
serialized. Standard output is one JSON object; ordinary errors emit no stderr.
Unknown source coverage is explicitly flagged, with the reducer's null
all-eligible/unknown-bound states retained. No observed outcomes adds
`no_observed_outcomes`; absence never becomes an observed zero. Negative gain,
wrong-answer failures, non-returners, partial coverage, null precision and
provisional validity remain visible. Exit 0 means replay succeeded; it is never
a numerical pass, baseline capture, sample-adequacy or release decision.

## Provenance, privacy and retention

A file, a matching digest, its adapter label, a declared sealed status and a
`synthetic: false` assertion cannot establish live provenance. Unknown top-level
fields, including `synthetic` and `grant`, are rejected. Neither mode verifies a
current viewer grant, current deletion state, canonical enrollment completeness,
real observations or scorer/form validity. Every result therefore retains:

```text
sourceAdmission = pending
viewerGrant = unverified_offline
realObservations = unverified_offline
baselineCapture = unproven
```

Trusted-source admission is a separate C6.2/final-integration obligation. It must
check canonical joins, complete roster/pages/facts, owner watermarks, grant
scope/expiry/revocation and source/account invalidation. There is deliberately no
`--live`, `--trust`, client grant or network verifier switch. Invoking sealed mode
on fixture bytes does not upgrade their provenance.

Output contains only closed aggregate cell DTOs and the safe dated query/version
manifest. Run IDs, page cursors, roster, computation keys, learner/assignment/
attempt identifiers, individual pair rows, response text, prompts, scoring keys,
rubrics, source locators and unrestricted source rows are withheld. The input
file is sensitive even though stdout is aggregate-only. The script reads it
without modifying it and does not persist private intermediate state.

Replay promises apply only while the same **permitted** sealed snapshot remains
retained and its code/version is supported. Deletion or integrity invalidation
may require discarding a local snapshot and its derived output. Offline replay
cannot discover revocation or deletion and must never be used to bypass them.
Do not retain private inputs merely to reproduce a historical digest. A refresh
uses a new run/cutoff and newly permitted source facts; it does not rewrite the
old report or invent missing historical coverage.

## Online aggregate access audits

When reports are enabled, online consumers use the mutations
`readReportManifest`, `readReportCells`, `exportReportPage` and
`downloadReportPage`. Each successful page acquisition commits its owner-scoped,
payload-free access record before returning. Download records describe server
page acquisition; saving already acquired bytes locally is not a new server
access. The legacy queries `getReport`, `getReportCells` and
`exportAggregateReport` withhold enabled report data with
`unavailable` / `audited_access_required`, because cached queries cannot commit per-access logs.
Their capability-off behavior is unchanged. Requests and scheduled refreshes are
audited as well; denied attempts emit only a status.

Online revocation checks use the additive `by_userId_and_fact_kind_and_sequence`
index to find one integrity fact after each owner's pinned watermark across all
epochs. The existing required `fact.kind` covers historical rows without a
migration or backfill. Unrelated score history is never scanned. Validation has
shared 3,000-range and 8-MiB document-read budgets, reserving five maximum-size
documents before each owner; exhaustion withholds output with
`source_validation_incomplete`. See [snapshot operations](learn-v2-measurement-snapshots.v1.md)
for the remaining deletion, watermark and invalidation guards.

The separate audit table stores only actor, run reference, action/status and
time, with at most 128 records per actor, 30-day retention and account deletion.
It is excluded from personal exports, activity events and analytics. Offline
replay does not authenticate a viewer or acquire a server report, and remains
separate from these online access records.

## Separate collection actions

The owner must approve and freeze the actual protocol/epoch, anchor/windows,
cohort, enrollment/sample and release boundaries under #362. Deployment,
environment/flags/entitlements, participant reach, migrations/backfills and
production principal provisioning require their separate approvals. A verified
application `tokenIdentifier` needs a current server-managed scoped viewer grant;
repository ownership supplies no application permission or raw-evidence access.

C6.2 supplies the canonical bounded snapshot adapter, sealing, authorization and
invalidation; C6.4 supplies deterministic collection-readiness proof. Actual
collection also needs the separately authorized scorer/provider operations and
real cold/delayed/first-check observations. Day 7 does not prove day 30, Today does
not admit Canvas, and fixture/application readiness proves no learning benefit
or teaching release. This CLI enables none of those operations.

## Local validation

Tests invoke the actual Node 24 executable. They pin complete serialized outputs,
assert the independent numerical oracles, exercise failure/null states, scan
protected-field canaries and intercept networking, provider/application imports
and subprocess dispatch. Every replay must finish with zero attempted calls.
The test path participates in ordinary `pnpm test`.

For a worktree with shared read-only dependencies, keep Vite's writable cache
inside this worktree. After `pnpm exec nuxt prepare`, an ignored native config can
extend the tracked configuration without editing it:

```sh
cat > .nuxt/vitest.c6.config.mts <<'EOF'
import config from '../vitest.config.ts'
import { fileURLToPath } from 'node:url'
export default { ...config, cacheDir: fileURLToPath(new URL('./vite-c6', import.meta.url)) }
EOF
VITEST_MAX_WORKERS=1 pnpm exec vitest run --config .nuxt/vitest.c6.config.mts --configLoader native scripts/learn-v2-measurement-report.test.ts shared/learn-v2-measurement-report*.test.ts
VITEST_MAX_WORKERS=1 pnpm run test --config .nuxt/vitest.c6.config.mts --configLoader native
```
