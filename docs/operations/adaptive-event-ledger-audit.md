# Adaptive Learn event-ledger audit

The ALA 6.1 audit checks the existing semantic ledger without changing event writers, taxonomy, or metric definitions. The fixtures verify local behavior; they do not establish a deployed scheduled purge or a real transport timeout.

## Repeatable local checks

Run the following command from the repository root after installing dependencies and running `pnpm exec nuxt prepare`. The command checks the ledger contract, lifecycle boundaries, owner exports, account deletion, retention, ambiguity, and rollback.

```sh
pnpm exec vitest run shared/learn-adaptive-events.test.ts convex/learnAdaptiveEvents.test.ts convex/learnAdaptiveEvidence.test.ts convex/dataExport.test.ts convex/accountDeletion.test.ts convex/learnActivityEventRetention.test.ts convex/learnAdaptiveOperationalEvents.test.ts convex/learnV2Mastery.test.ts convex/learnAdaptiveRollback.test.ts
```

The matrix identifies the executable evidence and the limits of each check. Use `pnpm verify` for the repository-wide gate; a focused fixture pass does not replace that gate.

| Boundary | Executable evidence | What the fixture establishes |
| --- | --- | --- |
| Closed taxonomy and redaction | `shared/learn-adaptive-events.test.ts` | The exact v6 event/type pairing remains closed, and metadata rejects private content and unbounded fields. |
| One event per semantic boundary | `convex/learnAdaptiveEvents.test.ts` | Identical requests replay across taxonomy upgrades and metadata key order; owner mismatches and private payloads fail before a write. An authoritative transaction rollback also rolls back its event. |
| Invalidation | `convex/learnAdaptiveEvidence.test.ts` | Source purge emits bounded, exactly-once invalidation and gap events, keeps distinct reasons, and preserves historical attempts. |
| Bounded owner export | `convex/dataExport.test.ts` | Cursor pages exhaust the event collection without duplicates, enforce the eight-row cap, isolate owners, and redact authority/replay fields. |
| Account deletion | `convex/accountDeletion.test.ts` | Nine event rows drain across the eight-row batch boundary before their thread parents, without deleting another owner's data. |
| Lost acknowledgement recovery | `convex/learnAdaptiveOperationalEvents.test.ts` | After a successful diagnostic save whose acknowledgement the fixture discards, public Canvas returns the committed response. Repeated same-key retries leave paginated events and command receipts unchanged, omit response content from those exports, and create no mastery or provider jobs. |
| Provider ambiguity | `convex/learnV2Mastery.test.ts`, test “atomically projects an ambiguous linked V2 job as reconciliation-needed without inventing learning state” | An expired dispatched lease produces one redacted `provider_ambiguity` event. Repeated recovery and public submission retries remain blocked, preserve that event, and do not invent attempts or mastery. |
| Access rollback | `convex/learnAdaptiveRollback.test.ts` | Public denied commands return named fallback destinations; repeated retries leave exported owner state unchanged, and restoring access recovers the original projection and receipts. |
| Ninety-day retention | `convex/learnActivityEventRetention.test.ts` | Internal maintenance deletes events at or before the fixed cutoff in owner batches of at most 128, continues through backlog, and preserves newer events. The scheduled-sweep entry point discovers expired events in the synthetic scheduler. |

The lost-acknowledgement fixture deliberately discards a successful result; it does not inject a network timeout. The ambiguity fixture uses an expired dispatched lease; it does not contact or reconcile a live provider. Both checks exercise recovery decisions through the approved public APIs and owner-visible projections, with internal maintenance used for the scheduled recovery boundary.

## Deployed scheduled-purge gate

Status: **Unknown / blocked pending deployed operational evidence.** Local timer execution and the presence of the 24-hour cron in `convex/crons.ts` do not prove that the deployed scheduler runs the maintenance job. Keep issue #271 open until the operational evidence receives review.

A deployment operator must collect the following evidence in the authorized environment. Use approved test owners and redacted records; do not create synthetic expired events in production or manually trigger production maintenance without separate authorization.

1. Record the deployed revision, environment, cron registration, scheduled invocation time, and maintenance completion or failure from the platform's operational records.
2. Record the fixed 90-day cutoff and observed owner-batch counts. Verify that no batch exceeds 128 and that continuations retain the original cutoff.
3. Compare bounded owner-visible event exports before and after the scheduled run. Show expired events removed, recent events retained, and owner isolation preserved; retain only the minimum redacted evidence needed for review.
4. Record backlog completion, any failure/retry outcome, and the reviewing operator's sign-off. Link the evidence to #271 without labeling a manual run or local fixture as a scheduled deployed run.

No live purge, production approval, provider activation, or physical-device accessibility result follows from this audit document.
