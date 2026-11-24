# Learn V2 delayed-check due-work runbook

This runbook covers `learnMeasurementDueWork` records that the delayed-check scheduler could not process. The state contract is in [snapshot operations](learn-v2-measurement-snapshots.v1.md#delayed-due-work-coverage).

## Signals

Every recorded fault writes one error log line:

```text
learn_due_work_fault {"workId":"…","kind":"open","assignmentId":"…","assessmentOpportunityId":"…","errorClass":"Error","state":"pending","attempts":3,"recoveryAttempts":0,"nextAttemptAt":1807056000000}
```

The line has no learner identifier, error message or learner content. `errorClass` is `scheduled_function_failed` when the scheduled job failed before its handler recorded a result. Search deployment logs for `learn_due_work_fault`:

```sh
npx convex logs --prod | grep learn_due_work_fault
```

Error-class bursts indicate an incident. A record whose `state` is `parked` or `terminal` has exhausted its regular retries.

## States

| State | Meaning | Automatic retry |
|---|---|---|
| `pending` | Due, or backing off after up to seven faults | 1, 2, 4 … 60 minutes |
| `parked` | Eight faults (`retries_exhausted`) | Hourly until close for an opening record inside its window; otherwise after 1, 2 and 4 hours |
| `terminal` | Three failed recovery attempts | After 8 and 16 hours, then every 24 hours |

No state is permanent. A record is deleted only after its work is processed successfully, or after the outcome is recorded by a normal close, materialization or complete owner scan. While a pending, parked or terminal record exists, C6 coverage for that learner stays `unknown`.

## List records

Both functions are internal. Run them from a trusted operator shell against the intended deployment. They return at most 100 records and no learner identifiers.

```sh
npx convex run --prod learnV2MeasurementDueWork:listDelayedCheckFaults '{"state":"terminal"}'
npx convex run --prod learnV2MeasurementDueWork:listDelayedCheckFaults '{"state":"parked","limit":50}'
```

Each row has `workId`, `kind` (`owner`, `assignment`, `open`, `close`), `state`, `assignmentId`, `assessmentOpportunityId`, `attempts`, `recoveryAttempts`, `dueAt`, `nextAttemptAt`, `windowFaultAt` and `updatedAt`. `windowFaultAt` is set when an opening record faulted before its check closed. Such a check, if never offered, closes as `system_due_work_late`.

## Requeue after an incident

Terminal records recover on their own within 24 hours of the incident ending. To recover sooner, fix the cause, then requeue up to 100 listed records:

```sh
npx convex run --prod learnV2MeasurementDueWork:requeueDelayedCheckWork '{"workIds":["<workId>","<workId>"]}'
```

Requeue resets the fault counters and makes the record due now. It fences any in-flight job and keeps `windowFaultAt`, so C6 still attributes an in-window fault to the system. It skips records that are no longer parked or terminal, and does nothing while the scheduler gates are off. The next one-minute cron dispatches requeued records. List again to confirm they have been retired.

## Settled assignments

Owner and assignment records do not wait for a Void to be unarchived or for protocol pins to change. An archived or deleted Void or folder, a protocol-pin mismatch and a missing cold slot settle the record and do not appear here. Archived is a terminal Void state. If a deployment changes the frozen protocol so that a settled assignment should materialize again, enqueue its owner and assignment work through a reviewed migration or one-off internal mutation. This runbook does not cover that path.
