# Adaptive Learn provider admission and product budgets

ALA 6.3a extends the existing V2 scoring authority with finite product-wide accounting. The shipped configuration remains unapproved, with zero product budgets and no assigned rollback owner. Local fixtures do not authorize provider activation.

## Configuration boundary

`shared/adaptive-v2-pilot-policy.ts` owns the pinned pilot configuration. The `adaptive-v2-product-budget.utc-hour-day.v1` product policy uses explicit UTC hour/day windows, while existing per-learner rolling quotas remain separate. Product limits include dispatch counts, concurrent work, and a daily conservative reservation ceiling in integer USD micro-units.

The `adaptive-v2-provider-rollback.v1` policy records the rollback state and an owner hash under `adaptive-v2-rollback-owner.tokenIdentifier-sha256.v1`. The hash represents the canonical issuer-linked identity, not a bare subject or client-claimed owner. Approved operation requires real approval evidence and an assigned owner; the default null owner and zero limits carry no activation authority.

Configuration validation rejects missing shapes, unsupported version/provider/policy pins, fractional counts, non-finite values, and limits outside the bounded contract before provider I/O. Positive configurations in tests remain synthetic and must be restored afterward. Do not copy those fixture values into a production activation decision.

## Accounting and safety boundaries

The canonical scoring job remains the authority for one dispatch attempt; product controls do not create a second provider dispatcher. The dispatch transaction reserves a conservative cost upper bound and product quota before I/O. Reservations, configured ceilings, and pricing-derived upper bounds are not recorded actual provider cost.

Product concurrency spans UTC window boundaries. Post-dispatch ambiguity remains reconciling and cannot automatically replay or imply mastery. A safety review or rollback latch must not silently clear through midnight, lease expiry, account deletion, or a configuration-version change.

The safety counter records eligible starts once per admitted job attempt over the lifetime of the pinned manifest. It latches review when ambiguity exceeds 1% or budget denial exceeds 5% of those starts. This is a lifetime guardrail denominator, not a UTC daily metric or the separate first-value denominator. The latch survives UTC window expiry and does not authorize activation or reset itself.

Owner-visible job exports contain only bounded reservation and policy metadata. Anonymous product totals remain outside owner export/deletion, so deleting a learner's account cannot refund dispatched work or reset product budget. Unresolved dispatched work needs authoritative reconciliation; disappearance of its owner-linked job does not prove settlement.

There is no operator recovery or counter-reset API in this slice. If account deletion removes an outstanding job, its anonymous concurrency reservation remains conservatively occupied, including after a late provider reply. Authoritative orphan reconciliation is a separate operational requirement; do not claim the local deletion fixture completes it or external provider cleanup.

## Evidence and activation limits

Public Convex fixtures verify default denial, finite admission, exactly-once reservation, quota/cost refusal before dispatch, ambiguity, and owner-visible lifecycle behavior. Use controlled clocks and stalled external fetches for local deadline and concurrency checks. These fixtures do not contact a live provider or establish actual billed cost.

Run the bounded lifecycle regression suite with:

```sh
pnpm exec vitest run convex/learnV2Mastery.test.ts convex/accountDeletion.test.ts convex/dataExport.test.ts shared/adaptive-v2-pilot-policy.test.ts shared/adaptive-learn-storage-manifest.test.ts
```

The final reply boundary rechecks the live pilot, rollback and guardrail state, owner/activity authority, lease, and outstanding reservation before accepting an adaptive learning result. Local public-action fixtures cover pending replies after rollback, thread deletion, and lease expiry. The account-deletion fixture uses the existing server-owned authentication deletion hook and bounded maintenance, then verifies public export denial and another learner's submission. It proves local database/tombstone behavior, not completed external cleanup.

The repository gate includes lint, application/Convex typechecks, all test suites, dependency audits, strict synthetic configuration/build checks, and a redacted full-history secret scan. Record the exact tested commit and distinguish local evidence from hosted, provider, and production results.

Product limits and the rollback owner remain unapproved until the responsible operator supplies a reviewed activation decision. Provider activation, trusted live cost telemetry, operational reconciliation, release audits, and cohort exposure remain separate gates. No runtime gate should accept a client approval claim or resume previously ambiguous work as a side effect of reactivation.
