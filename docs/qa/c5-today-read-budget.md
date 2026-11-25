# Today check preparation and first-page read budgets

The final comparison pins dev to `eaa835f2ded43701ea7437ec1f1d888b1029a7bc`
and the merged feature runtime to `26217af11c0e8a92002da7094bd3f1269c139383`.
The latter is a normal merge with dev, retaining #582's optional stored
`checkSurface` and #581's pointer v2, topic authority and teaching-age lookup.
This supersedes the initial pre-integration comparison at `e1ef707a`/`7c650272`.

All versions use identical persisted-record fixtures and measurement
instrumentation, native Convex transaction limits, one test worker and unchanged
60-second test timeouts. The control reverses only the two-file selective-cache
optimization on the merged tree. The optimized run uses the merged runtime;
subsequent test-budget and documentation changes do not change production reads.

Each measured first page requests pointer v2. The twelve-family continuation
also repeats that version. Cold checks use `this_session` without a teaching-age
lookup. A separate four-delayed-check fixture seeds owned granted teaching
receipts, as the existing maximum delayed-family budget fixture does, so the
measurements include four actual indexed teaching-receipt reads. These receipt
seeds are synthetic; other #581 journey tests cover real teaching delivery.

The host was also running deliberate parallel stress checks for #578. Runs
were serial and back-to-back; changing load still limits timing conclusions.
Native read counts are the primary evidence.

| Complete fixture wall seconds | Dev | Merged control | Optimized | Optimized / dev |
| --- | ---: | ---: | ---: | ---: |
| 12 maximum families, including preparation and paging | 23.569 | 24.606 | 23.228 | 0.99 |
| Four maximum ready checks, including preparation | 9.080 | 9.599 | 9.227 | 1.02 |
| Four maximum delayed checks, including preparation | 15.180 | 16.337 | 14.882 | 0.98 |

| First Today page wall seconds | Dev | Merged control | Optimized |
| --- | ---: | ---: | ---: |
| 12 maximum families | 2.070 | 2.095 | 1.961 |
| Four maximum ready checks | 1.812 | 1.846 | 1.797 |
| Four maximum delayed checks | 1.864 | 2.161 | 1.890 |

All three versions have identical native first-page read counts:

| Fixture | Queries | Documents | Bytes |
| --- | ---: | ---: | ---: |
| 12 maximum families | 1,925 | 3,179 | 2,645,110 |
| Four maximum ready checks | 2,809 | 4,818 | 4,161,178 |
| Four maximum delayed checks | 2,817 | 4,831 | 4,213,897 |

The delayed v2 page adds four queries over its v1 counterpart, one per
assignment's first teaching receipt. The 896-read pointer reservation is
unchanged, including its maximum delayed-family control.

These counts do not reproduce a first-page database regression from #576.
The shared window collector already uses the owner/phase/close-time index with
`closeAt > now`. An initial trace before integration measured its twelve calls
at 125 ms of a 20,455 ms run. Window selection, future/current overflow caps,
scope matching and admission semantics are unchanged by this optimization.

The avoidable cost is preparation invalidating every cached point lookup after
each write. Starting the fourth maximum ready check previously read 366 distinct
IDs 1,058 times, including unchanged evidence. Retaining unchanged point values
reduces that to 367 point lookups; the modified document still needs another read.

| Fourth maximum check preparation | Queries | Documents | Bytes |
| --- | ---: | ---: | ---: |
| Dev | 1,885 | 2,921 | 2,312,721 |
| Merged control | 1,885 | 2,921 | 2,312,833 |
| Optimized | 1,194 | 2,230 | 2,040,683 |
| Reduction from merged control | 36.7% | 23.7% | 11.8% |

After every write, all indexed and derived authority memoization is cleared.
The written ID is evicted from the point cache. A failed write or unknown ID
clears the entire point cache. Values remain scoped to one owner and invocation.
No evidence check, publication proof, capability default or timeout changes.

Native query, document and byte ceilings now cover the twelve-family first page,
four-ready first page, four-delayed first page and preparation. Reversing the
optimization at the merged tree makes the preparation assertion fail at 1,885
queries against its 1,250 ceiling. Persisted same-transaction controls recheck a
new practice exposure, source replacement, evidence deletion and revocation.

The serial timing comparison used this filter on each tree, with the CI
environment sourced without output:

```sh
pnpm exec vitest run convex/learnV2TodayPointers.test.ts --maxWorkers=1 --reporter=verbose \
  -t '^(12 maximum-sized families return bounded pointer pages without exhausting Today|4 maximum checks appear together on the first Today page|four maximum delayed checks include teaching receipts in the first-page read budget)$'
```

The observations are close to dev's runtime, but they do not establish the
hosted timeout's cause or resolution. Hosted timing remains a separate check.

The merged-head validation passed 991 tests in the nine requested suites:
Today pointers and delivery, all four post-seal suites, help admission and both
C4 parity suites. This includes the full startable/delivers sweep. Another 472
tests passed in eleven coupled suites covering measurement, due work, assessment
delivery, responses, privacy read budgets, help consumers, C5 off parity,
Independent claims, report contracts, account deletion and export. Both app and
Convex typechecks and lint on the changed TypeScript files passed.

Before integration, an earlier broad run was stopped after four pointer failures
at or beyond their time limits under load. All four passed in the focused retry;
the final merged-head runs had no failures. Full build, verify and beta pipelines
were not rerun for this performance follow-up.
