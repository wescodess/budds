# Offline measurement report replay v1

The Node 24 entry point calls the frozen C6.1 `buildLearningMeasurementReport`
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
af2e8c6dc4ed9fe469cd3a91289b0345be34ebfff44cc5d2c367fb410948cf30  fixture
fca08e857680b597e4cbc52070987cd94982cdd2516f8c29cf1c75376647e79b  sealed-format
```

These two outputs differ only in the input-class and replay reason labels. Both
are fixture evidence. The day-7 VLG oracle is −20 percentage points with missing
outcome bounds [−30,20], two matured episodes and one comparable pair. The
first-check oracle has N=2, M=1, F=1, observed failure 1 and bounds [0.5,1]. Both
all-eligible points are null. The unassigned day-30 horizon has no eligible
population and null values. Counts and repeated inventory context must not be
summed across strata, horizons or weightings.

## Accepted input and failures

Both modes consume the same strict JSON envelope:

```text
{
  version: "learn-v2.measurement-report-replay.v1",
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
`0305f427ace92222c2ea3e9ef000abdaae7e2542`. A future reducer needs an explicit
compatibility decision and updated replay version/expectations; editing an old
manifest's code pin to bypass rejection does not constitute exact replay.

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
