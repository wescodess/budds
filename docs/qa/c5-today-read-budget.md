# Today check preparation and first-page read budgets

The comparison pins dev to `e1ef707a0e3cd6ec1ee9017095d73a684cbbc819` and the
reviewed feature head to `7c65027218cabbf5da69e8811d13203180a3a43f`. Dev advanced
with #581 during measurement; its changed pointer metadata is excluded from this
comparison. Both maximum fixtures use the same persisted records, public entry
points, native transaction limits, one test worker and unchanged 60-second test
timeouts.

The host was also running deliberate parallel stress checks for #578. These
back-to-back wall times are observations under changing load, not a production
latency claim or a replacement for the hosted timing check.

| Fixture | Dev wall seconds | Reviewed head | Optimized | Head / dev | Optimized / head |
| --- | ---: | ---: | ---: | ---: | ---: |
| 12 maximum families, including preparation and paging | 25.643 | 22.231 | 33.765 | 0.87 | 1.52 |
| Four maximum ready checks, including preparation | 6.317 | 7.618 | 9.009 | 1.21 | 1.18 |

The first Today page has identical native read counts on all three versions:

| Fixture | Queries | Documents | Bytes |
| --- | ---: | ---: | ---: |
| 12 maximum families | 1,925 | 3,179 | 2,645,110 |
| Four maximum ready checks | 2,809 | 4,818 | 4,161,178 |

The wider open-check collection did not increase these first-page counts. It
already uses the owner/phase index with `closeAt > now`. In the traced 12-family
case, its twelve admission calls used 125 ms of a 20,455 ms run. Read-only point
lookups were already deduplicated: the four-ready page made 1,436 point lookups
for 1,436 distinct IDs.

The avoidable cost was preparation invalidating every cached point lookup after
each write. Starting the fourth maximum ready check read 366 distinct IDs 1,058
times, including unchanged evidence. Retaining unchanged point values reduces
that to 367 point lookups; the modified document still requires another read.

| Fourth maximum check preparation | Queries | Documents | Bytes |
| --- | ---: | ---: | ---: |
| Dev | 1,885 | 2,921 | 2,312,721 |
| Reviewed head | 1,885 | 2,921 | 2,312,833 |
| Optimized | 1,194 | 2,230 | 2,040,683 |
| Reduction | 36.7% | 23.7% | 11.8% |

After every write, all indexed and derived authority memoization is cleared.
The written ID is evicted from the point cache. A failed write or unknown ID
clears the entire point cache. Values remain scoped to one owner and invocation.
No evidence check, publication proof, window rule, overflow rule, schema or
capability default changes.

These counts do not reproduce a first-page database regression from #576. The
duplicate preparation reads also exist on the dev pin. The optimization reduces
that shared preparation cost; whether it resolves the hosted timeout remains
unproven until the hosted timing check.

`learnV2TodayPointers.test.ts` now bounds queries, documents and bytes for the
maximum first pages and for preparation. The preparation bound fails on the
reviewed implementation at 1,885 queries against a ceiling of 1,250. Persisted
same-transaction controls recheck newly inserted exposure, deletion, source
replacement and evidence revocation. The existing Today startable/delivers
sweep and C4 parity suites remain required.

The completed focused run passed 953 tests in nine files: Today pointers and
delivery, all four post-seal suites, help admission and both C4 parity suites.
The full pointer sweep and both maximum fixtures passed without longer
timeouts. An earlier, broader run was stopped after four pointer failures near
or beyond their time limits under load; all four passed in the focused retry.
Another 368 tests passed in nine coupled suites covering measurement, due work,
assessment delivery, responses, privacy budgets, help consumers, C5 off parity,
account deletion and export. Convex typecheck and lint on the changed TypeScript
files also passed. Full build, verify and beta pipelines were not rerun for this
performance follow-up.

The serial timing comparison used this filter on each pinned checkout, with
identical test instrumentation and the CI environment sourced without output:

```sh
pnpm exec vitest run convex/learnV2TodayPointers.test.ts --maxWorkers=1 --reporter=verbose \
  -t '^(12 maximum-sized families return bounded pointer pages without exhausting Today|4 maximum checks appear together on the first Today page)$'
```
